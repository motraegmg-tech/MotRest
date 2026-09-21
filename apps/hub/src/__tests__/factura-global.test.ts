/**
 * La factura global del mes, emitida por el Hub.
 *
 * Contra un registro real con cuentas de septiembre y un FacturAPI de mentira:
 * que salga sola a su hora y no antes, con lo que nadie facturó y nada más, una
 * sola vez aunque se reintente, y que avise si pasan las 72 horas del SAT.
 *
 * Desde la 1.5.6 hay dos modos, y aquí se ejercen los dos: en `automatica` lo de
 * arriba sigue igual; en `manual` —el de por omisión— el Hub NO timbra nada solo
 * y la lista de cuentas la manda el restaurantero.
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
  type ModoFacturacionGlobal,
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
let modoGlobal: ModoFacturacionGlobal;

function cobrar(
  orden: string,
  cuando: Date,
  precio: number,
  opciones: { regalada?: boolean; socio?: boolean } = {},
): void {
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
    ...(opciones.regalada ? [f.crear("cortesia_otorgada", orden, { orden_id: orden, motivo: "Casa" })] : []),
    f.crear("pago_registrado", orden, {
      orden_id: orden,
      monto: pesos(precio * 1.16),
      ...(opciones.socio ? { forma: "socio" as const, socio_id: "soc-1" } : { forma: "tarjeta_debito" as const }),
    }),
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
  // El grueso de estas pruebas es el barrido de la 1.5.5: se pide explícito,
  // porque desde la 1.5.6 el valor por omisión es el contrario.
  modoGlobal = "automatica";
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
    modo: () => modoGlobal,
    anotar: (_n, m) => bitacora.push(m),
  });

  cobrar("ord-1", new Date(2026, 8, 12, 21), 250);
  cobrar("ord-2", new Date(2026, 8, 13, 21), 300); // se facturó a nombre del cliente
  cobrar("ord-3", new Date(2026, 8, 14, 21), 180, { regalada: true }); // cortesía completa: $0
  cobrar("ord-4", new Date(2026, 8, 30, 23, 50), 120); // la última del mes
  cobrar("ord-5", new Date(2026, 9, 1, 0, 30), 99); // ya es octubre
  cobrar("ord-6", new Date(2026, 7, 28, 21), 400); // agosto: antes de FacturAPI
  cobrar("ord-socio", new Date(2026, 8, 20, 21), 200, { socio: true }); // no es venta (1.5.6)
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
      modo: () => modoGlobal,
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
      modo: () => modoGlobal,
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

  it("el consumo de socio no entra en la global automática (1.5.6)", async () => {
    await global.revisar(CIERRE + 3_600_000);
    expect(emitidas()[0]!.ordenes).not.toContain("ord-socio");
  });

  it("dice en qué modo está, para que la caja lo pinte", () => {
    expect(global.estado().modo).toBe("automatica");
  });
});

// --- El modo manual: la global la decide el restaurantero (1.5.6) -------------------------

/** Un Hub recién armado, sin decirle el modo: tiene que salir en manual. */
function sinDecirleElModo(): FacturaGlobalMensual {
  return new FacturaGlobalMensual({
    db: new DatabaseSync(":memory:"),
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
}

function aMano(ordenes: string[], extra: { autorizador?: string; ahora?: number } = {}) {
  return global.emitirManual({
    periodo: "2026-09",
    ordenes,
    autorizador_id: extra.autorizador ?? "emp-gonzalo",
    ahora: extra.ahora ?? CIERRE + 3_600_000,
  });
}

describe("en manual el Hub no emite solo", () => {
  /*
   * Es LA regla de la 1.5.6. Un local que se actualiza y no toca nada deja de
   * timbrar por su cuenta: equivocarse hacia «no emitas» cuesta un clic, y
   * equivocarse hacia «emite todo» cuesta una cancelación ante el SAT.
   */
  it("sin configuración de modo, nadie timbra nada", async () => {
    const recien = sinDecirleElModo();
    expect(recien.modo()).toBe("manual");

    const r = await recien.revisar(CIERRE + 3_600_000);
    expect(r.emitidas).toBe(0);
    expect(crearFacturas()).toHaveLength(0);
    expect(emitidas()).toHaveLength(0);
  });

  it("el barrido no timbra, pero avisa del cierre y deja dicho el plazo del SAT", async () => {
    modoGlobal = "manual";
    await global.revisar(CIERRE + 3_600_000);

    expect(crearFacturas()).toHaveLength(0);
    expect(bitacora.some((l) => /ya cerró/.test(l))).toBe(true);

    const estado = global.estado();
    expect(estado.modo).toBe("manual");
    expect(estado.pendiente).toMatchObject({
      periodo: "2026-09",
      desde_ts: CIERRE,
      plazo_sat_ts: CIERRE + 72 * 3_600_000,
      fuera_de_plazo: false,
    });
  });

  it("pasadas las 72 horas lo dice fuerte, aunque no haya nada roto", async () => {
    modoGlobal = "manual";
    await global.revisar(CIERRE + 73 * 3_600_000);

    expect(bitacora.some((l) => /fuera del plazo del SAT/.test(l))).toBe(true);
    expect(global.estado().pendiente?.fuera_de_plazo).toBe(true);
  });

  it("el aviso del cierre se da una vez, no cada hora", async () => {
    modoGlobal = "manual";
    await global.revisar(CIERRE + 3_600_000);
    await global.revisar(CIERRE + 7_200_000);

    expect(bitacora.filter((l) => /ya cerró/.test(l))).toHaveLength(1);
  });
});

describe("la emisión manual", () => {
  beforeEach(() => {
    modoGlobal = "manual";
  });

  it("timbra exactamente las cuentas que se eligieron, y deja vivas las demás", async () => {
    const r = await aMano(["ord-1"]);

    expect(r.ok).toBe(true);
    expect(r.emitidas).toBe(1);
    expect(r.cuentas).toBe(1);

    const [evento] = emitidas();
    expect(evento!.ordenes).toEqual(["ord-1"]);
    expect(evento).toMatchObject({
      periodo: "2026-09",
      parte: 1,
      modo: "produccion",
      origen: "manual",
      autorizador_id: "emp-gonzalo",
    });
    expect(evento!.total).toBe(pesos(250 * 1.16));

    // ord-4 se quedó fuera y SIGUE VIVA: se puede facturar a nombre del cliente
    // o meterla en una global posterior. Es la decisión de Gonzalo (plan §1.3).
    expect(global.enGlobal("ord-1")).toBe("2026-09");
    expect(global.enGlobal("ord-4")).toBeNull();
  });

  it("descarta lo que no puede entrar y dice cuántas y por qué", async () => {
    const r = await aMano(["ord-1", "ord-2", "ord-3", "ord-5", "ord-6", "ord-socio", "ord-fantasma"]);

    expect(r.ok).toBe(true);
    expect(r.cuentas).toBe(1);
    expect(emitidas()[0]!.ordenes).toEqual(["ord-1"]);

    const motivos = Object.fromEntries(r.descartadas.map((d) => [d.orden_id, d.motivo]));
    expect(motivos).toEqual({
      "ord-2": "ya_facturada",
      "ord-3": "sin_importe",
      "ord-5": "otro_periodo",
      "ord-6": "otro_periodo",
      "ord-socio": "consumo_socio",
      "ord-fantasma": "desconocida",
    });
    expect(r.problema).toMatch(/6 cuenta\(s\) quedaron fuera/);
  });

  it("una cuenta ya amparada por un CFDI a nombre del cliente no entra", async () => {
    const r = await aMano(["ord-2"]);

    expect(r.ok).toBe(false);
    expect(crearFacturas()).toHaveLength(0);
    expect(r.descartadas).toEqual([{ orden_id: "ord-2", motivo: "ya_facturada" }]);
    expect(r.problema).toMatch(/con factura a nombre del cliente/);
  });

  it("el consumo de socio no se factura aunque alguien lo marque", async () => {
    const r = await aMano(["ord-socio"]);

    expect(r.ok).toBe(false);
    expect(crearFacturas()).toHaveLength(0);
    expect(r.descartadas).toEqual([{ orden_id: "ord-socio", motivo: "consumo_socio" }]);
    expect(r.problema).toMatch(/consumo de socio/);
  });

  it("una cuenta de otro mes no se cuela en el mes que se factura", async () => {
    const r = await aMano(["ord-5"]);

    expect(r.ok).toBe(false);
    expect(crearFacturas()).toHaveLength(0);
    expect(r.descartadas).toEqual([{ orden_id: "ord-5", motivo: "otro_periodo" }]);
  });

  it("un mes que todavía no cierra no se puede facturar", async () => {
    const r = await aMano(["ord-1"], { ahora: CIERRE - 60_000 });

    expect(r.ok).toBe(false);
    expect(r.problema).toMatch(/todavía no cierra/);
    expect(crearFacturas()).toHaveLength(0);
  });

  it("un mes con forma rara se rechaza antes de tocar FacturAPI", async () => {
    const r = await global.emitirManual({
      periodo: "septiembre",
      ordenes: ["ord-1"],
      autorizador_id: "emp-gonzalo",
      ahora: CIERRE + 3_600_000,
    });

    expect(r.ok).toBe(false);
    expect(r.problema).toMatch(/AAAA-MM/);
    expect(api.peticiones).toHaveLength(0);
  });

  /*
   * LA QUE NO PUEDE FALLAR. Dos emisiones del mismo mes no pueden amparar la
   * misma venta dos veces, ni pueden chocar en la llave de idempotencia.
   */
  it("un mes lleva varias globales, pero cada venta va en una sola", async () => {
    expect((await aMano(["ord-1"])).ok).toBe(true);
    expect((await aMano(["ord-4"], { ahora: CIERRE + 7_200_000 })).ok).toBe(true);

    const peticiones = crearFacturas();
    expect(peticiones).toHaveLength(2);
    expect(peticiones.map((p) => (p.cuerpo as { idempotency_key: string }).idempotency_key)).toEqual([
      `global-${SUC}-2026-09`,
      `global-${SUC}-2026-09-p2`,
    ]);
    expect(emitidas().map((e) => e.ordenes)).toEqual([["ord-1"], ["ord-4"]]);

    // Y la tercera, con lo ya facturado, no timbra nada.
    const repetida = await aMano(["ord-1", "ord-4"], { ahora: CIERRE + 10_800_000 });
    expect(repetida.ok).toBe(false);
    expect(crearFacturas()).toHaveLength(2);
    expect(repetida.descartadas.map((d) => d.motivo)).toEqual(["en_global", "en_global"]);
  });

  it("si el barrido ya la emitió, la manual no la vuelve a emitir", async () => {
    modoGlobal = "automatica";
    await global.revisar(CIERRE + 3_600_000);
    expect(crearFacturas()).toHaveLength(1);

    modoGlobal = "manual";
    const r = await aMano(["ord-1", "ord-4"], { ahora: CIERRE + 7_200_000 });
    expect(r.ok).toBe(false);
    expect(crearFacturas()).toHaveLength(1);
  });

  it("una tanda que se quedó a medias se REANUDA, no se cambia por otra", async () => {
    api.caida = true;
    const primero = await aMano(["ord-1"]);
    expect(primero.ok).toBe(false);
    expect(emitidas()).toHaveLength(0);

    // Vuelve la red y alguien pide otra cosa: se termina la congelada.
    api.caida = false;
    const segundo = await aMano(["ord-4"], { autorizador: "emp-lucia", ahora: CIERRE + 7_200_000 });

    expect(segundo.ok).toBe(true);
    expect(segundo.problema).toMatch(/a medio emitir/);
    const [evento] = emitidas();
    expect(evento!.ordenes).toEqual(["ord-1"]);
    // Y la firma es la de quien armó la tanda, no la de quien reintentó.
    expect(evento).toMatchObject({ autorizador_id: "emp-gonzalo" });
  });

  it("sin llave de FacturAPI lo dice en vez de fallar en silencio", async () => {
    const huerfano = new FacturaGlobalMensual({
      db: new DatabaseSync(":memory:"),
      log,
      sucursal: () => SUC,
      facturapi: () => null,
    });
    const r = await huerfano.emitirManual({
      periodo: "2026-09",
      ordenes: ["ord-1"],
      autorizador_id: "emp-gonzalo",
      ahora: CIERRE + 3_600_000,
    });

    expect(r.ok).toBe(false);
    expect(r.problema).toMatch(/FacturAPI/);
  });

  it("el historial le llega a la caja con lo que la pantalla necesita", async () => {
    await aMano(["ord-1"]);
    await aMano(["ord-4"], { ahora: CIERRE + 7_200_000 });

    const historial = global.estado().historial!;
    // De la más nueva a la más vieja: es el orden en que se lee una tabla.
    expect(historial.map((h) => h.parte)).toEqual([2, 1]);
    expect(historial[0]).toMatchObject({
      periodo: "2026-09",
      parte: 2,
      cuentas: 1,
      modo: "produccion",
      origen: "manual",
      total: pesos(120 * 1.16),
    });
    expect(historial[0]!.uuid).toBeTruthy();
    expect(historial[0]!.emitida_ts).toBeGreaterThan(0);
  });

  it("lo que ya no está pendiente deja de estarlo", async () => {
    await global.revisar(CIERRE + 3_600_000);
    expect(global.estado().pendiente).toMatchObject({ periodo: "2026-09" });

    await aMano(["ord-1", "ord-4"], { ahora: CIERRE + 7_200_000 });
    expect(global.estado().pendiente).toBeUndefined();
  });
});
