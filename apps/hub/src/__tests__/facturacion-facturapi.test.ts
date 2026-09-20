/**
 * Del cobro a la factura con FacturAPI, de punta a punta en el Hub.
 *
 * Log real, cola real, facturador y cancelador reales; lo único fingido es
 * FacturAPI. Se comprueba que la cola conserva lo que ya prometía —durable,
 * sin timbrar dos veces— ahora que no sella el Hub sino FacturAPI.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import { FabricaEventos, pesos, type Comprobante, type EventoFiscal } from "@motrest/dominio";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { ColaDeTimbrado } from "../fiscal/cola-timbrado.js";
import { Facturador } from "../fiscal/facturador.js";
import { Cancelador } from "../fiscal/cancelador.js";
import { Sellador } from "../fiscal/sellador.js";
import { CanceladorFacturapi, ClienteFacturapi, PacFacturapi } from "../fiscal/facturapi.js";
import { FacturapiFalsa, LLAVE_PRUEBA } from "./facturapi-falsa.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";

let log: LogHub;
let db: TipoDb;
let carpeta: string;
let cola: ColaDeTimbrado;
let facturador: Facturador;
let api: FacturapiFalsa;
let enGlobal: Set<string>;

const fabrica = () =>
  new FabricaEventos<EventoFiscal>({ device_id: "dev-caja", empleado_id: "emp", sucursal_id: SUC });

function comprobante(ordenId: string): Comprobante {
  return {
    version: "4.0", serie: "A", folio: "7", fecha: "2020-01-01T12:00:00", forma_pago: "01",
    metodo_pago: "PUE", lugar_expedicion: "44100", moneda: "MXN", tipo_comprobante: "I",
    exportacion: "01", subtotal: pesos(500), descuento: pesos(0), total: pesos(580),
    emisor: { rfc: "AAA010101AAA", nombre: "RODIZIO", regimen_fiscal: "601", codigo_postal: "44100" },
    receptor: { rfc: "GODE561231GR8", nombre: "JUAN PEREZ", regimen_fiscal: "612", codigo_postal: "44650", uso_cfdi: "G03" },
    conceptos: [
      {
        clave_prod_serv: "90101501", cantidad: 1, clave_unidad: "E48", descripcion: "Pizza familiar",
        valor_unitario: pesos(500), importe: pesos(500), descuento: pesos(0), objeto_imp: "02",
        traslados: [{ base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) }],
      },
    ],
    traslados: [{ base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) }],
    total_impuestos_trasladados: pesos(80),
    orden_id: ordenId,
  };
}

function facturar(ordenId: string, cfdiId: string, correo?: string): void {
  log.ingerir([
    fabrica().crear("cfdi_generado", `fiscal:${SUC}`, {
      cfdi_id: cfdiId, orden_id: ordenId, serie: "A", folio: "7",
      comprobante: comprobante(ordenId),
      ...(correo ? { correo_receptor: correo } : {}),
    }),
  ]);
}

function publicados<T extends EventoFiscal["tipo"]>(tipo: T): Extract<EventoFiscal, { tipo: T }>[] {
  return log.porTipo(tipo, 0, 100) as never;
}

beforeEach(() => {
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  carpeta = mkdtempSync(join(tmpdir(), "motrest-fapi-"));
  api = new FacturapiFalsa();
  enGlobal = new Set();
  cola = new ColaDeTimbrado(db, null);
  cola.usarFacturapi(new PacFacturapi(new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch })));
  // Sin CSD en la caja: con FacturAPI no hace falta.
  facturador = new Facturador(log, new Sellador(join(carpeta, "csd")), cola, db, () => {}, {
    facturapi: {
      activa: () => true,
      nombre: () => "FacturAPI (pruebas)",
      enGlobal: (orden) => (enGlobal.has(orden) ? "2026-08" : null),
    },
  });
});

afterEach(() => {
  log.cerrar();
  db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

describe("timbrar con FacturAPI", () => {
  it("sin CSD: encola el JSON, timbra y devuelve el timbre a la caja", async () => {
    facturar("ord-1", "cfdi-1", "juan@correo.mx");
    expect(facturador.esperandoCsd()).toBe(0);
    expect(facturador.procesar()).toEqual({ encolados: 1, sinCsd: 0 });

    expect(await cola.procesar()).toMatchObject({ timbradas: 1 });
    expect(api.peticiones[0]!.cuerpo).toMatchObject({ idempotency_key: "cfdi-1", external_id: "ord-1" });
    expect(api.peticiones.some((p) => p.ruta === "/invoices/inv_1/email")).toBe(true);

    facturador.publicarResultados();
    const [timbrado] = publicados("cfdi_timbrado");
    expect(timbrado).toMatchObject({
      cfdi_id: "cfdi-1",
      pac: "FacturAPI (pruebas)",
      no_certificado_emisor: "30001000000500003416",
      total_timbrado: pesos(580),
    });
    expect(cola.externoDeCfdi("cfdi-1")).toBe("inv_1");
  });

  it("esperando al SAT, la cola guarda el id y después solo pregunta", async () => {
    api.alCrear = "pending";
    facturar("ord-1", "cfdi-1");
    facturador.procesar();
    await cola.procesar();
    expect(cola.resumen().pendientes).toBe(1);
    expect(cola.externoDeCfdi("cfdi-1")).toBe("inv_1");

    api.timbrarPendiente("inv_1");
    await cola.procesar(20, Date.now() + 3_600_000);
    expect(cola.resumen().timbradas).toBe(1);
    expect(api.peticiones.filter((p) => p.metodo === "POST" && p.ruta === "/invoices")).toHaveLength(1);
  });

  it("un XML sellado de antes no se le manda a FacturAPI ni frena la cola", async () => {
    cola.encolar({ orden_id: "vieja", cfdi_id: "c-vieja", sucursal_id: SUC, serie: "A", folio: "1", total: 1, xml: "<xml/>" });
    facturar("ord-1", "cfdi-1");
    facturador.procesar();
    await cola.procesar(1);
    expect(cola.resumen()).toMatchObject({ timbradas: 1, pendientes: 1 });
    expect(api.peticiones.every((p) => p.ruta !== "/invoices" || (p.cuerpo as { external_id: string }).external_id === "ord-1")).toBe(true);
  });

  it("rechazada por la llave, se reintenta sola cuando llega otra", async () => {
    api.llaves.clear();
    facturar("ord-1", "cfdi-1");
    facturador.procesar();
    await cola.procesar();
    expect(cola.resumen().rechazadas).toBe(1);

    api.llaves.add(LLAVE_PRUEBA);
    expect(cola.reintentarPorLlave()).toBe(1);
    await cola.procesar();
    expect(cola.resumen()).toMatchObject({ timbradas: 1, rechazadas: 0 });
  });

  it("un ticket que ya está en la global se rechaza con el motivo, sin llegar a FacturAPI", async () => {
    enGlobal.add("ord-1");
    facturar("ord-1", "cfdi-1");
    facturador.procesar();
    await cola.procesar();
    expect(api.peticiones).toHaveLength(0);

    facturador.publicarResultados();
    const [rechazo] = publicados("cfdi_rechazado");
    expect(rechazo).toMatchObject({ cfdi_id: "cfdi-1", codigo: "GLOBAL" });
    expect(rechazo!.motivo).toMatch(/factura global de 2026-08/);
  });
});

describe("cancelar con FacturAPI", () => {
  it("una en espera del receptor no frena a las demás, y nada se publica dos veces", async () => {
    facturar("ord-1", "cfdi-1");
    facturar("ord-2", "cfdi-2");
    facturador.procesar();
    await cola.procesar();

    const cliente = new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch });
    const cancelador = new Cancelador(log, new Sellador(join(carpeta, "csd")), db, null);
    cancelador.usarFacturapi(new CanceladorFacturapi(cliente), (c) => cola.externoDeCfdi(c));

    log.ingerir([
      fabrica().crear("cfdi_cancelacion_solicitada", `fiscal:${SUC}`, { cfdi_id: "cfdi-1", motivo: "02" }),
    ]);
    api.alCancelar = "pending";
    await cancelador.procesar();

    api.alCancelar = "canceled";
    log.ingerir([
      fabrica().crear("cfdi_cancelacion_solicitada", `fiscal:${SUC}`, { cfdi_id: "cfdi-2", motivo: "03" }),
    ]);
    await cancelador.procesar();
    expect(publicados("cfdi_cancelado").map((e) => e.cfdi_id)).toEqual(["cfdi-2"]);

    // Otra vuelta: la primera sigue en espera (solo se pregunta), la segunda no se repite.
    await cancelador.procesar();
    expect(publicados("cfdi_cancelado")).toHaveLength(1);
    expect(api.peticiones.filter((p) => p.metodo === "DELETE" && p.ruta.startsWith("/invoices/inv_1"))).toHaveLength(1);

    // El receptor acepta: al preguntar, se publica.
    api.facturas.get("inv_1")!.status = "canceled";
    await cancelador.procesar();
    expect(publicados("cfdi_cancelado").map((e) => e.cfdi_id)).toEqual(["cfdi-2", "cfdi-1"]);
  });
});
