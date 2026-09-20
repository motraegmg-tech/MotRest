/**
 * La factura global del mes, emitida por el Hub.
 *
 * Contra un registro real con cuentas de septiembre y un FacturAPI de mentira:
 * que salga sola a su hora y no antes, con lo que nadie facturó y nada más, una
 * sola vez aunque se reintente, y que avise si pasan las 72 horas del SAT.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import {
  FabricaEventos,
  IVA_16,
  pesos,
  snapshotTasas,
  uuidv7,
  type Comprobante,
  type EventoComanda,
  type EventoFiscal,
  type ModoFacturapi,
} from "@motrest/dominio";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { FacturaGlobalMensual } from "../fiscal/factura-global.js";
import { ClienteFacturapi } from "../fiscal/facturapi.js";
import { FacturapiFalsa, LLAVE_PRUEBA } from "./facturapi-falsa.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const CTX = { device_id: "dev-caja", empleado_id: "emp", sucursal_id: SUC };
const DESDE = new Date(2026, 8, 10).getTime(); // FacturAPI conectado el 10 de septiembre
const CIERRE = new Date(2026, 9, 1, 6).getTime();

let log: LogHub;
let db: TipoDb;
let api: FacturapiFalsa;
let global: FacturaGlobalMensual;
let bitacora: string[];
let modo: ModoFacturapi;

function cobrar(orden: string, cuando: Date, precio: number, regalada = false): void {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden, { orden_id: orden, mesa_id: "m1", abierta_ts: cuando.getTime() - 3_600_000 }),
    f.crear("item_agregado", orden, {
      orden_id: orden,
      renglon: {
        id: uuidv7(), producto_id: "p", descripcion: "Pizza", cantidad: 1, precio_unitario: pesos(precio),
        costo_unitario: pesos(1), impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
    ...(regalada ? [f.crear("cortesia_otorgada", orden, { orden_id: orden, motivo: "Casa" })] : []),
    f.crear("pago_registrado", orden, { orden_id: orden, monto: pesos(precio * 1.16), forma: "tarjeta_debito" }),
    { ...f.crear("cuenta_cerrada", orden, { orden_id: orden }), ts: cuando.getTime() },
  ];
  log.ingerir(eventos);
}

function facturadaAParte(orden: string): void {
  log.ingerir([
    new FabricaEventos<EventoFiscal>(CTX).crear("cfdi_generado", `fiscal:${SUC}`, {
      cfdi_id: `cfdi-${orden}`, orden_id: orden, serie: "A", folio: "1",
      comprobante: { total: pesos(100) } as Comprobante,
    }),
  ]);
}

function emitidas(): Extract<EventoFiscal, { tipo: "factura_global_emitida" }>[] {
  return log.porTipo("factura_global_emitida", 0, 100) as never;
}

function crearFacturas(): typeof api.peticiones {
  return api.peticiones.filter((p) => p.metodo === "POST" && p.ruta === "/invoices");
}

beforeEach(() => {
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  api = new FacturapiFalsa();
  bitacora = [];
  modo = "produccion";
  global = new FacturaGlobalMensual({
    db,
    log,
    sucursal: () => SUC,
    facturapi: () => ({
      cliente: new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch }),
      modo,
      desde_ts: DESDE,
      cp: "44100",
    }),
    anotar: (_n, m) => bitacora.push(m),
  });

  cobrar("ord-1", new Date(2026, 8, 12, 21), 250);
  cobrar("ord-2", new Date(2026, 8, 13, 21), 300); // se facturó a nombre del cliente
  cobrar("ord-3", new Date(2026, 8, 14, 21), 180, true); // cortesía completa: $0
  cobrar("ord-4", new Date(2026, 8, 30, 23, 50), 120); // la última del mes
  cobrar("ord-5", new Date(2026, 9, 1, 0, 30), 99); // ya es octubre
  cobrar("ord-6", new Date(2026, 7, 28, 21), 400); // agosto: antes de FacturAPI
  facturadaAParte("ord-2");
});

afterEach(() => {
  log.cerrar();
  db.close();
});

describe("la global de septiembre", () => {
  it("no sale antes de las 06:00 del día 1", async () => {
    await global.revisar(CIERRE - 60_000);
    expect(crearFacturas()).toHaveLength(0);
  });

  it("sale sola con lo que nadie facturó, y nada de agosto", async () => {
    const r = await global.revisar(CIERRE + 3_600_000);
    expect(r.emitidas).toBe(1);

    const [peticion] = crearFacturas();
    expect(peticion!.cuerpo).toMatchObject({
      customer: { legal_name: "PUBLICO EN GENERAL", tax_id: "XAXX010101000", tax_system: "616", address: { zip: "44100" } },
      use: "S01",
      payment_form: "28",
      payment_method: "PUE",
      global: { periodicity: "month", months: "09", year: 2026 },
      idempotency_key: `global-${SUC}-2026-09`,
    });
    const items = (peticion!.cuerpo as { items: { product: Record<string, unknown> }[] }).items;
    expect(items.map((i) => i.product.sku)).toEqual(["ORD-1", "ORD-4"]);
    expect(items[0]!.product).toMatchObject({ description: "Venta", product_key: "01010101", unit_key: "ACT" });

    const [evento] = emitidas();
    expect(evento).toMatchObject({ periodo: "2026-09", parte: 1, externo_id: "inv_1", modo: "produccion" });
    expect(evento!.ordenes).toEqual(["ord-1", "ord-4"]);
    expect(evento!.total).toBe(pesos(250 * 1.16 + 120 * 1.16));
    expect(global.enGlobal("ord-1")).toBe("2026-09");
    expect(global.enGlobal("ord-2")).toBeNull();
    expect(global.estado().ultima).toMatchObject({ periodo: "2026-09", cuentas: 2 });
  });

  it("una vez emitida no se vuelve a emitir, ni con la base del Hub perdida", async () => {
    await global.revisar(CIERRE + 3_600_000);
    await global.revisar(CIERRE + 7_200_000);
    expect(crearFacturas()).toHaveLength(1);

    const otraBase = new DatabaseSync(":memory:");
    const deNuevo = new FacturaGlobalMensual({
      db: otraBase,
      log,
      sucursal: () => SUC,
      facturapi: () => ({ cliente: new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch }), modo, desde_ts: DESDE, cp: "44100" }),
    });
    await deNuevo.revisar(CIERRE + 10_800_000);
    expect(crearFacturas()).toHaveLength(1);
    expect(deNuevo.enGlobal("ord-4")).toBe("2026-09");
    otraBase.close();
  });

  it("sin red se queda pendiente, reintenta con las MISMAS cuentas y avisa a las 72 horas", async () => {
    api.caida = true;
    await global.revisar(CIERRE + 3_600_000);
    expect(emitidas()).toHaveLength(0);
    expect(global.estado().pendiente).toMatchObject({ periodo: "2026-09" });

    // Mientras tanto la caja factura ord-4 (no debería, pero una tableta sin red…):
    facturadaAParte("ord-4");
    await global.revisar(CIERRE + 73 * 3_600_000);
    expect(bitacora.some((l) => /72 horas/.test(l))).toBe(true);

    api.caida = false;
    await global.revisar(CIERRE + 80 * 3_600_000);
    const [evento] = emitidas();
    // Lo congelado en el primer intento: es lo que protege la llave de idempotencia.
    expect(evento!.ordenes).toEqual(["ord-1", "ord-4"]);
    expect(global.estado().pendiente).toBeUndefined();
  });

  it("si la respuesta se perdió, el reintento recupera la que FacturAPI ya timbró", async () => {
    await global.revisar(CIERRE + 3_600_000);
    // Simula que el Hub no se enteró: se borra el hecho y su registro local.
    const antes = api.facturas.size;
    const otraBase = new DatabaseSync(":memory:");
    const otroLog = new LogHub(":memory:");
    for (const e of log.desde(0, 1000)) if (e.tipo !== "factura_global_emitida") otroLog.ingerir([e]);
    const reintento = new FacturaGlobalMensual({
      db: otraBase,
      log: otroLog,
      sucursal: () => SUC,
      facturapi: () => ({ cliente: new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch }), modo, desde_ts: DESDE, cp: "44100" }),
    });
    await reintento.revisar(CIERRE + 7_200_000);
    expect(api.facturas.size).toBe(antes);
    expect((otroLog.porTipo("factura_global_emitida", 0, 10)[0] as unknown as { externo_id: string }).externo_id).toBe("inv_1");
    otroLog.cerrar();
    otraBase.close();
  });

  it("la de pruebas no bloquea la factura individual", async () => {
    modo = "pruebas";
    await global.revisar(CIERRE + 3_600_000);
    expect(emitidas()[0]).toMatchObject({ modo: "pruebas" });
    expect(global.enGlobal("ord-1")).toBeNull();
  });
});
