/**
 * FacturAPI como PAC: traducir, clasificar y no timbrar dos veces.
 *
 * Todo contra un FacturAPI de mentira (`facturapi-falsa.ts`): lo que se prueba
 * es lo que decide el Hub con cada respuesta, que es lo que no cambia aunque
 * FacturAPI cambie de humor.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { pesos, type Comprobante } from "@motrest/dominio";
import {
  CanceladorFacturapi,
  ClienteFacturapi,
  PacFacturapi,
  clasificarFalloFacturapi,
  comprobanteAFacturapi,
  probarLlaveFacturapi,
} from "../fiscal/facturapi.js";
import { FacturapiFalsa, LLAVE_PRUEBA } from "./facturapi-falsa.js";

const AHORA = new Date(2026, 8, 19, 21, 30).getTime();

/** Pizza de 249 con IVA dentro y tres cervezas de 49 (una regalada), 10 % de cuenta. */
function comprobante(extra: Partial<Comprobante> = {}): Comprobante {
  return {
    version: "4.0",
    serie: "A",
    folio: "1042",
    fecha: "2026-09-19T21:15:00",
    forma_pago: "04",
    metodo_pago: "PUE",
    lugar_expedicion: "44100",
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal: pesos(341.38),
    descuento: pesos(93.58),
    total: pesos(291.82),
    emisor: { rfc: "AAA010101AAA", nombre: "RODIZIO", regimen_fiscal: "601", codigo_postal: "44100" },
    receptor: { rfc: "GODE561231GR8", nombre: "JUAN PEREZ LOPEZ", regimen_fiscal: "612", codigo_postal: "44650", uso_cfdi: "G03" },
    conceptos: [
      {
        clave_prod_serv: "90101501", cantidad: 1, clave_unidad: "E48", descripcion: "Pizza",
        valor_unitario: pesos(214.66), importe: pesos(214.66), descuento: pesos(21.47), objeto_imp: "02",
        traslados: [{ base: pesos(193.19), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(30.91) }],
      },
      {
        clave_prod_serv: "50202201", cantidad: 3, clave_unidad: "E48", descripcion: "Cerveza",
        valor_unitario: pesos(42.24), importe: pesos(126.72), descuento: pesos(72.11), objeto_imp: "02",
        traslados: [
          { base: pesos(54.61), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(8.74) },
          { base: pesos(54.61), impuesto: "003", tipo_factor: "Tasa", tasa_o_cuota: 0.08, importe: pesos(4.37) },
        ],
      },
    ],
    traslados: [],
    total_impuestos_trasladados: pesos(44.02),
    orden_id: "ord-1042",
    ...extra,
  };
}

/** Lo que calcularía FacturAPI con lo que le mandamos: precio × cantidad − descuento, más impuestos. */
function totalSegunFacturapi(cuerpo: Record<string, unknown>): number {
  let total = 0;
  for (const item of cuerpo.items as {
    quantity: number;
    discount?: number;
    product: { price: number; taxes: { rate: number }[] };
  }[]) {
    const neto = item.product.price * item.quantity - (item.discount ?? 0);
    total += neto * (1 + item.product.taxes.reduce((n, t) => n + t.rate, 0));
  }
  return Math.round(total * 100);
}

describe("del comprobante al JSON de FacturAPI", () => {
  it("receptor, uso, forma de pago, serie y folio donde van", () => {
    const cuerpo = comprobanteAFacturapi(comprobante(), "cfdi-1042", { ahora: AHORA, correo: "juan@correo.mx" });
    expect(cuerpo.customer).toEqual({
      legal_name: "JUAN PEREZ LOPEZ",
      tax_id: "GODE561231GR8",
      tax_system: "612",
      address: { zip: "44650" },
      email: "juan@correo.mx",
    });
    expect(cuerpo.use).toBe("G03");
    expect(cuerpo.payment_form).toBe("04");
    expect(cuerpo.payment_method).toBe("PUE");
    expect(cuerpo.series).toBe("A");
    expect(cuerpo.folio_number).toBe(1042);
    expect(cuerpo.global).toBeUndefined();
  });

  it("idempotency_key = el comprobante, external_id = la orden", () => {
    const cuerpo = comprobanteAFacturapi(comprobante(), "cfdi-1042", { ahora: AHORA });
    expect(cuerpo.idempotency_key).toBe("cfdi-1042");
    expect(cuerpo.external_id).toBe("ord-1042");
  });

  it("los conceptos van sin IVA incluido, con su clave, unidad e impuestos", () => {
    const cuerpo = comprobanteAFacturapi(comprobante(), "c", { ahora: AHORA });
    const [pizza, cerveza] = cuerpo.items as Record<string, any>[];
    expect(pizza!.product).toMatchObject({
      description: "Pizza",
      product_key: "90101501",
      unit_key: "E48",
      tax_included: false,
      taxability: "02",
      taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa" }],
    });
    expect(cerveza!.quantity).toBe(3);
    expect(cerveza!.product.taxes).toEqual([
      { type: "IVA", rate: 0.16, factor: "Tasa" },
      { type: "IEPS", rate: 0.08, factor: "Tasa", ieps_mode: "break_down" },
    ]);
    // Se ve la cortesía: el descuento cubre la cerveza regalada y el 10 %.
    expect(cerveza!.discount).toBeGreaterThan(72);
  });

  it("FacturAPI llega al MISMO total que el ticket, para que el QR verifique", () => {
    const cuerpo = comprobanteAFacturapi(comprobante(), "c", { ahora: AHORA });
    expect(totalSegunFacturapi(cuerpo)).toBe(comprobante().total);
  });

  it("un concepto regalado entero va como no objeto de impuesto", () => {
    const c = comprobante({
      conceptos: [
        {
          clave_prod_serv: "90101501", cantidad: 1, clave_unidad: "E48", descripcion: "Postre",
          valor_unitario: pesos(85), importe: pesos(85), descuento: pesos(85), objeto_imp: "01", traslados: [],
        },
      ],
    });
    const [postre] = comprobanteAFacturapi(c, "c", { ahora: AHORA }).items as Record<string, any>[];
    expect(postre!.product.taxability).toBe("01");
    expect(postre!.product.taxes).toEqual([]);
    expect(postre!.discount).toBe(85);
  });

  it("la fecha del cobro va solo dentro de las 72 horas que admite FacturAPI", () => {
    expect(comprobanteAFacturapi(comprobante(), "c", { ahora: AHORA }).date).toBe(
      new Date(2026, 8, 19, 21, 15).toISOString(),
    );
    const cuatroDiasDespues = AHORA + 4 * 86_400_000;
    expect(comprobanteAFacturapi(comprobante(), "c", { ahora: cuatroDiasDespues }).date).toBeUndefined();
  });

  it("un ticket al público en general lleva el nodo global del día", () => {
    const c = comprobante({
      receptor: { rfc: "XAXX010101000", nombre: "PUBLICO EN GENERAL", regimen_fiscal: "616", codigo_postal: "", uso_cfdi: "S01" },
    });
    const cuerpo = comprobanteAFacturapi(c, "c", { ahora: AHORA });
    expect(cuerpo.global).toEqual({ periodicity: "day", months: "09", year: 2026 });
    expect((cuerpo.customer as { address: { zip: string } }).address.zip).toBe("44100");
  });
});

describe("qué error tiene arreglo", () => {
  it("la llave y el comprobante se rechazan; red, 5xx, 429 y 402 se reintentan", () => {
    expect(clasificarFalloFacturapi({ status: 401, red: false, mensaje: "x" }).estado).toBe("rechazado");
    expect(clasificarFalloFacturapi({ status: 403, red: false, mensaje: "x" }).estado).toBe("rechazado");
    expect(clasificarFalloFacturapi({ status: 400, red: false, mensaje: "RFC inválido" })).toEqual({
      estado: "rechazado",
      codigo: "400",
      motivo: "RFC inválido",
    });
    expect(clasificarFalloFacturapi({ status: 422, red: false, mensaje: "x" }).estado).toBe("rechazado");
    for (const status of [500, 502, 429, 402]) {
      expect(clasificarFalloFacturapi({ status, red: false, mensaje: "x" }).estado).toBe("reintentable");
    }
    expect(clasificarFalloFacturapi({ status: null, red: true, mensaje: "x" }).estado).toBe("reintentable");
  });
});

describe("el PAC de FacturAPI", () => {
  let api: FacturapiFalsa;
  let pac: PacFacturapi;
  let avisos: string[];
  const cuerpo = (correo?: string) =>
    JSON.stringify(comprobanteAFacturapi(comprobante(), "cfdi-1042", { ahora: AHORA, correo }));

  beforeEach(() => {
    api = new FacturapiFalsa();
    avisos = [];
    pac = new PacFacturapi(new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch }), {
      anotar: (_n, m) => avisos.push(m),
    });
  });

  it("timbra, baja el XML y devuelve el timbre con el id de FacturAPI", async () => {
    const r = await pac.timbrarDatos(cuerpo(), null);
    expect(r.estado).toBe("timbrado");
    expect(r.externo_id).toBe("inv_1");
    if (r.estado === "timbrado") expect(r.timbrado.timbre.uuid).toMatch(/AAAA-BBBB/);
    expect(api.peticiones.map((p) => `${p.metodo} ${p.ruta}`)).toEqual(["POST /invoices", "GET /invoices/inv_1/xml"]);
    expect(api.peticiones[0]!.autorizacion).toBe(`Bearer ${LLAVE_PRUEBA}`);
  });

  it("si el comensal dio correo, FacturAPI se la manda", async () => {
    await pac.timbrarDatos(cuerpo("juan@correo.mx"), null);
    expect(api.peticiones.some((p) => p.metodo === "POST" && p.ruta === "/invoices/inv_1/email")).toBe(true);
  });

  it("esperando al SAT: reintentable, y el siguiente intento PREGUNTA en vez de crear otra", async () => {
    api.alCrear = "pending";
    const primero = await pac.timbrarDatos(cuerpo(), null);
    expect(primero).toMatchObject({ estado: "reintentable", externo_id: "inv_1" });

    api.timbrarPendiente("inv_1");
    const segundo = await pac.timbrarDatos(cuerpo(), "inv_1");
    expect(segundo.estado).toBe("timbrado");
    expect(api.peticiones.filter((p) => p.metodo === "POST" && p.ruta === "/invoices")).toHaveLength(1);
  });

  it("un reintento con la misma llave de idempotencia recupera la que ya existe", async () => {
    await pac.timbrarDatos(cuerpo(), null); // timbró, pero digamos que la respuesta se perdió
    const reintento = await pac.timbrarDatos(cuerpo(), null);
    expect(reintento).toMatchObject({ estado: "timbrado", externo_id: "inv_1" });
    expect(api.facturas.size).toBe(1);
    expect(api.peticiones.some((p) => p.ruta.startsWith("/invoices?external_id=ord-1042"))).toBe(true);
  });

  it("sin red se reintenta; con la llave revocada se rechaza, sin la llave en el motivo", async () => {
    api.caida = true;
    expect((await pac.timbrarDatos(cuerpo(), null)).estado).toBe("reintentable");

    api.caida = false;
    api.llaves.clear();
    const r = await pac.timbrarDatos(cuerpo(), null);
    expect(r).toMatchObject({ estado: "rechazado", codigo: "401" });
    expect(JSON.stringify(r)).not.toContain(LLAVE_PRUEBA);
  });

  it("un 400 de FacturAPI se rechaza con su mensaje", async () => {
    api.errorAlCrear = {
      status: 400,
      cuerpo: { message: "El RFC del receptor no existe", status: 400, ok: false, code: "invalid", errors: [{ message: "tax_id", code: "tax_id_not_found", source: "sat" }] },
    };
    const r = await pac.timbrarDatos(cuerpo(), null);
    expect(r).toMatchObject({ estado: "rechazado", codigo: "400" });
    if (r.estado === "rechazado") expect(r.motivo).toContain("El RFC del receptor no existe");
  });
});

describe("probar una llave", () => {
  it("válida: trae la organización para el semáforo", async () => {
    const api = new FacturapiFalsa();
    const r = await probarLlaveFacturapi(LLAVE_PRUEBA, { fetch: api.fetch });
    expect(r).toMatchObject({
      estado: "valida",
      organizacion: { id: "org_rodizio", razon_social: "RODIZIO", rfc: "AAA010101AAA", cp: "44100", lista: true },
    });
  });

  it("revocada: inválida; sin red: no se sabe", async () => {
    const api = new FacturapiFalsa();
    const otra = `sk_${"test"}_OTRA0000000000000000`;
    expect((await probarLlaveFacturapi(otra, { fetch: api.fetch })).estado).toBe("invalida");
    api.caida = true;
    expect((await probarLlaveFacturapi(LLAVE_PRUEBA, { fetch: api.fetch })).estado).toBe("sin_red");
  });
});

describe("cancelar con FacturAPI", () => {
  it("al momento, o esperando al receptor y luego preguntando", async () => {
    const api = new FacturapiFalsa();
    const cliente = new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch });
    const pac = new PacFacturapi(cliente);
    await pac.timbrarDatos(JSON.stringify(comprobanteAFacturapi(comprobante(), "c1", { ahora: AHORA })), null);
    const cancelador = new CanceladorFacturapi(cliente);

    api.alCancelar = "pending";
    expect((await cancelador.cancelar("inv_1", "02")).estado).toBe("en_espera");
    expect(api.peticiones.at(-1)?.ruta).toBe("/invoices/inv_1?motive=02");
    expect((await cancelador.consultar("inv_1")).estado).toBe("en_espera");

    api.facturas.get("inv_1")!.status = "canceled";
    expect((await cancelador.consultar("inv_1")).estado).toBe("cancelado");
  });

  it("un «ya está cancelada» tras un corte no se toma por rechazo", async () => {
    const api = new FacturapiFalsa();
    const cliente = new ClienteFacturapi({ llave: LLAVE_PRUEBA, fetch: api.fetch });
    await new PacFacturapi(cliente).timbrarDatos(
      JSON.stringify(comprobanteAFacturapi(comprobante(), "c1", { ahora: AHORA })),
      null,
    );
    const cancelador = new CanceladorFacturapi(cliente);
    await cancelador.cancelar("inv_1", "02"); // llegó, la respuesta se perdió
    expect((await cancelador.cancelar("inv_1", "02")).estado).toBe("cancelado");
  });
});
