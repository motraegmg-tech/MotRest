/**
 * Del cobro a la factura, de punta a punta.
 *
 * La caja emite «se generó este comprobante» y el Hub reacciona: lo sella con
 * el CSD del restaurante, lo encola y lo timbra. Aquí se ejercita esa cadena
 * completa contra un log real, un CSD real y una cola real; lo único fingido es
 * el PAC, que es lo que no se puede llamar desde una prueba.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import { X509Certificate, verify } from "node:crypto";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import {
  cadenaOriginal,
  FabricaEventos,
  leerTimbre,
  pesos,
  type Comprobante,
  type EventoComanda,
  type EventoFiscal,
} from "@motrest/dominio";
import { ColaDeTimbrado } from "../fiscal/cola-timbrado.js";
import { Facturador } from "../fiscal/facturador.js";
import { Sellador } from "../fiscal/sellador.js";
import { clasificar, type Pac, type ResultadoTimbrado } from "../fiscal/pac.js";
import { generarCsdDePrueba, type CsdDePrueba } from "./csd-de-prueba.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const RFC = "AAA010101AAA";
const UUID = "11111111-2222-3333-4444-555555555555";

let csd: CsdDePrueba;
let log: LogHub;
let db: TipoDb;
let carpeta: string;
let sellador: Sellador;
let cola: ColaDeTimbrado;
let facturador: Facturador;
let avisos: string[];

/*
 * La fábrica va parametrizada con los eventos que esta prueba emite. Sin el
 * parámetro, el cuerpo queda tipado como `never` y TypeScript rechaza todo —
 * cosa que Vitest no ve, porque borra los tipos antes de ejecutar.
 */
const fabrica = () =>
  new FabricaEventos<EventoFiscal | EventoComanda>({
    device_id: "dev-caja",
    empleado_id: "emp-lucia",
    sucursal_id: SUC,
  });

function comprobante(folio: string, total = 58000): Comprobante {
  return {
    version: "4.0",
    serie: "A",
    folio,
    fecha: "2026-07-23T21:15:00",
    forma_pago: "01",
    metodo_pago: "PUE",
    lugar_expedicion: "06000",
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal: pesos(500),
    descuento: pesos(0) as never,
    total: total as never,
    no_certificado: "",
    emisor: { rfc: RFC, nombre: "RESTAURANTE DE PRUEBA", regimen_fiscal: "601", codigo_postal: "06000" },
    receptor: {
      rfc: "XEXX010101000",
      nombre: "PUBLICO EN GENERAL",
      regimen_fiscal: "616",
      codigo_postal: "06000",
      uso_cfdi: "S01",
    },
    conceptos: [
      {
        clave_prod_serv: "90101501",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: "Pizza familiar",
        valor_unitario: pesos(500),
        importe: pesos(500),
        descuento: pesos(0) as never,
        objeto_imp: "02",
        traslados: [
          { base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) },
        ],
      },
    ],
    traslados: [
      { base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) },
    ],
    total_impuestos_trasladados: pesos(80),
    orden_id: "ord-1",
  } as Comprobante;
}

/** La caja factura una cuenta: emite el hecho al log del local. */
function cobrarYFacturar(ordenId: string, folio: string): void {
  const f = fabrica();
  log.ingerir([
    f.crear("cfdi_generado", `fiscal:${SUC}`, {
      cfdi_id: `cfdi-${folio}`,
      orden_id: ordenId,
      serie: "A",
      folio,
      comprobante: { ...comprobante(folio), orden_id: ordenId },
    }) as never,
  ]);
}

function xmlTimbrado(uuid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0"><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" FechaTimbrado="2026-07-23T21:20:00" SelloCFD="SELLOCFD123==" NoCertificadoSAT="00001000000504465028" SelloSAT="SELLOSAT456==" RfcProvCertif="SPR190613I52" /></cfdi:Complemento></cfdi:Comprobante>`;
}

class PacFalso implements Pac {
  readonly nombre = "PAC de prueba";
  recibidos: string[] = [];
  constructor(private responder: (n: number) => ResultadoTimbrado) {}
  async timbrar(xml: string): Promise<ResultadoTimbrado> {
    this.recibidos.push(xml);
    return this.responder(this.recibidos.length);
  }
}

const timbraBien = () => clasificar({ xml: xmlTimbrado(UUID) });

beforeAll(async () => {
  csd = await generarCsdDePrueba({ rfc: RFC });
});

beforeEach(() => {
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  carpeta = mkdtempSync(join(tmpdir(), "motrest-fact-"));
  sellador = new Sellador(carpeta);
  avisos = [];
  cola = new ColaDeTimbrado(db, new PacFalso(timbraBien), (n, m) => avisos.push(`${n}: ${m}`));
  facturador = new Facturador(log, sellador, cola, db, (n, m) => avisos.push(`${n}: ${m}`));
});

afterEach(() => {
  log.cerrar();
  db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

function instalarCsd(): void {
  const r = sellador.instalar(csd.cer, csd.key, csd.contrasena, RFC);
  expect(r).toEqual({ ok: true });
}

// --- El camino completo ------------------------------------------------------------------

describe("del cobro a la factura", () => {
  it("un comprobante generado se sella y entra a la cola", () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");

    expect(facturador.procesar()).toMatchObject({ encolados: 1 });
    expect(cola.resumen().pendientes).toBe(1);
  });

  /**
   * La prueba que de verdad importa: que el sello del XML corresponda a la
   * cadena original de ESE comprobante, firmada con ESE certificado.
   *
   * Es exactamente lo que el PAC va a recalcular. Si esto pasa aquí y falla
   * allá, el problema está en el orden de la cadena original, no en el sellado.
   */
  it("el sello del XML corresponde a la cadena original del comprobante", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();

    const pac = new PacFalso(timbraBien);
    await new ColaDeTimbrado(db, pac).procesar();
    const enviado = pac.recibidos[0]!;

    expect(enviado).toContain('NoCertificado="30001000000500003416"');
    expect(enviado).toContain('Certificado="');

    const sello = /Sello="([^"]+)"/.exec(enviado)![1]!;
    const cadena = cadenaOriginal({
      ...comprobante("1001"),
      orden_id: "ord-1",
      no_certificado: "30001000000500003416",
    } as Comprobante);

    const certificado = new X509Certificate(Buffer.from(csd.cer));
    expect(
      verify("sha256", Buffer.from(cadena, "utf8"), certificado.publicKey, Buffer.from(sello, "base64")),
    ).toBe(true);
  });

  it("el certificado que viaja en el XML es el del restaurante", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();

    const pac = new PacFalso(timbraBien);
    await new ColaDeTimbrado(db, pac).procesar();

    // El espacio delante importa: sin él, `Certificado=` casa dentro de
    // `NoCertificado=` y se compararía el atributo equivocado.
    const enBase64 = /\sCertificado="([^"]+)"/.exec(pac.recibidos[0]!)![1]!;
    expect(Buffer.from(enBase64, "base64")).toEqual(Buffer.from(csd.cer));
  });

  it("se timbra y la factura queda disponible", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();
    await cola.procesar();

    expect(cola.resumen()).toMatchObject({ timbradas: 1, pendientes: 0 });
    expect(cola.facturaDe("ord-1")?.uuid).toBe(UUID);
    expect(leerTimbre(cola.facturaDe("ord-1")!.xml)?.uuid).toBe(UUID);
  });
});

// --- Sin CSD todavía ---------------------------------------------------------------------

describe("cuando el restaurante aún no tiene CSD", () => {
  /*
   * El caso real de Rodizio: se opera antes de tener el certificado. Esos
   * comprobantes NO se pierden ni bloquean la venta; esperan.
   */
  it("los comprobantes esperan en vez de perderse", () => {
    cobrarYFacturar("ord-1", "1001");
    cobrarYFacturar("ord-2", "1002");

    expect(facturador.procesar()).toMatchObject({ encolados: 0, sinCsd: 2 });
    expect(facturador.esperandoCsd()).toBe(2);
  });

  /*
   * Lo importante: la marca NO avanza sin CSD. Si avanzara, esas facturas
   * quedarían saltadas para siempre — cobradas y sin comprobante.
   */
  it("al instalar el CSD se sella TODO lo acumulado", () => {
    cobrarYFacturar("ord-1", "1001");
    cobrarYFacturar("ord-2", "1002");
    cobrarYFacturar("ord-3", "1003");
    facturador.procesar();

    instalarCsd();

    expect(facturador.procesar(1000)).toMatchObject({ encolados: 3 });
    expect(cola.resumen().pendientes).toBe(3);
    expect(facturador.esperandoCsd()).toBe(0);
  });
});

// --- Que no se duplique ni se salte ------------------------------------------------------

describe("ni duplicar ni saltarse una factura", () => {
  it("barrer dos veces no encola la misma factura dos veces", () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");

    facturador.procesar();
    facturador.procesar();
    facturador.procesar();

    expect(cola.listar()).toHaveLength(1);
  });

  it("solo toma lo nuevo desde la última vez", () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    expect(facturador.procesar().encolados).toBe(1);

    cobrarYFacturar("ord-2", "1002");
    expect(facturador.procesar().encolados).toBe(1);
    expect(cola.listar()).toHaveLength(2);
  });

  /*
   * La marca vive en disco: si el Hub se apaga entre el sellado y el reinicio,
   * no puede volver a encolar lo ya encolado ni saltarse lo que faltaba.
   */
  it("la marca sobrevive al reinicio del Hub", () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();

    const otroArranque = new Facturador(log, sellador, cola, db);
    cobrarYFacturar("ord-2", "1002");

    expect(otroArranque.procesar().encolados).toBe(1);
    expect(cola.listar()).toHaveLength(2);
  });

  /*
   * Un evento roto no puede detener la cola entera detrás de él, pero tampoco
   * puede desaparecer sin dejar rastro.
   */
  it("un comprobante ilegible se omite con aviso y no frena a los demás", () => {
    instalarCsd();
    const f = fabrica();
    log.ingerir([
      // Sin comprobante ni orden: es exactamente el evento que no debe existir,
      // y por eso el tipo hay que forzarlo para poder probarlo.
      f.crear("cfdi_generado", `fiscal:${SUC}`, { cfdi_id: "roto" } as never),
    ]);
    cobrarYFacturar("ord-2", "1002");

    expect(facturador.procesar().encolados).toBe(1);
    expect(avisos.some((a) => a.includes("ilegible"))).toBe(true);
  });

  it("otros eventos del log no se confunden con comprobantes", () => {
    instalarCsd();
    const f = fabrica();
    log.ingerir([
      f.crear("orden_creada", "ord-9", { orden_id: "ord-9", mesa_id: "m1", abierta_ts: 1 }),
      f.crear("pago_registrado", "ord-9", {
        orden_id: "ord-9",
        monto: pesos(100),
        forma: "efectivo",
      }),
    ]);

    expect(facturador.procesar()).toMatchObject({ encolados: 0 });
  });
});

// --- El resultado vuelve a la caja -------------------------------------------------------

/**
 * El folio fiscal no sirve de nada encerrado en la base del Hub.
 *
 * La caja necesita saber que la factura salió para poder entregársela al
 * comensal, y necesita enterarse de un rechazo sin que alguien abra la pantalla
 * de facturación a buscarlo. Por eso el desenlace vuelve al event log, que es
 * lo que se replica a todas las terminales.
 */
describe("publicar el desenlace en el registro del local", () => {
  function fiscalesDelLog(): EventoFiscal[] {
    return log.porTipo("cfdi_timbrado", 0, 100).concat(
      log.porTipo("cfdi_rechazado", 0, 100),
    ) as unknown as EventoFiscal[];
  }

  it("un timbrado queda anotado con su UUID", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();
    await cola.procesar();

    expect(facturador.publicarResultados()).toBe(1);

    const [evento] = fiscalesDelLog();
    expect(evento).toMatchObject({ tipo: "cfdi_timbrado", cfdi_id: "cfdi-1001", uuid: UUID });
    /*
     * Los sellos viajan en el evento —leídos del XML timbrado, no
     * recalculados— para que la caja pueda imprimir la representación con su QR
     * de verificación sin volver a pedirle nada al Hub.
     */
    expect(evento).toMatchObject({
      sello_cfd: "SELLOCFD123==",
      sello_sat: "SELLOSAT456==",
      no_certificado_sat: "00001000000504465028",
    });
  });

  it("un rechazo también, para que nadie tenga que ir a buscarlo", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();

    const conRechazo = new ColaDeTimbrado(
      db,
      new PacFalso(() => clasificar({ codigo: "302", mensaje: "Sello inválido" })),
    );
    await conRechazo.procesar();
    facturador.publicarResultados();

    const [evento] = fiscalesDelLog();
    expect(evento).toMatchObject({ tipo: "cfdi_rechazado", codigo: "302" });
  });

  /*
   * Si el Hub se apaga entre timbrar y publicar, al volver tiene que anotar el
   * hecho UNA vez. Sin la marca en disco, cada ciclo anexaría el mismo hecho
   * con otro id y la factura aparecería repetida en el historial de la caja.
   */
  it("publicar dos veces no duplica el hecho", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();
    await cola.procesar();

    facturador.publicarResultados();
    facturador.publicarResultados();
    facturador.publicarResultados();

    expect(fiscalesDelLog()).toHaveLength(1);
  });

  it("lo que sigue pendiente todavía no se publica", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();

    const sinRed = new ColaDeTimbrado(db, new PacFalso(() => ({
      estado: "reintentable" as const,
      motivo: "sin conexión",
    })));
    await sinRed.procesar();

    expect(facturador.publicarResultados()).toBe(0);
    expect(fiscalesDelLog()).toHaveLength(0);
  });

  /*
   * El Hub firma a su propio nombre. Timbrar ocurre solo, quizá con el local
   * cerrado; atribuirlo a quien facturó sería escribir en la bitácora algo que
   * esa persona no hizo.
   */
  it("el hecho lo firma el sistema, no la persona que cobró", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();
    await cola.procesar();
    facturador.publicarResultados();

    const [evento] = fiscalesDelLog();
    expect(evento!.empleado_id).toBe("sistema");
    expect(evento!.empleado_id).not.toBe("emp-lucia");
  });

  it("vuelve a la sucursal de donde salió el comprobante", async () => {
    instalarCsd();
    cobrarYFacturar("ord-1", "1001");
    facturador.procesar();
    await cola.procesar();
    facturador.publicarResultados();

    const [evento] = fiscalesDelLog();
    expect(evento!.sucursal_id).toBe(SUC);
    expect(evento!.stream_id).toBe(`fiscal:${SUC}`);
  });
});
