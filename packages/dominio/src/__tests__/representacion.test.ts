/**
 * La representación impresa del CFDI y el QR de verificación del SAT.
 *
 * Lo que más importa aquí es el QR: si su URL no lleva los parámetros exactos
 * —RFC del emisor, RFC del receptor, total con su formato, cola del sello— el
 * comensal escanea y el portal del SAT dice "no encontrado", aunque la factura
 * exista.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import type { Comprobante } from "../fiscal/comprobante.js";
import type { TimbreFiscal } from "../fiscal/xml.js";
import {
  cadenaOriginalTimbre,
  representacionImpresa,
  urlVerificacionSat,
} from "../fiscal/representacion.js";

function comprobante(extra: Partial<Comprobante> = {}): Comprobante {
  return {
    version: "4.0",
    serie: "A",
    folio: "1001",
    fecha: "2026-07-23T21:15:00",
    forma_pago: "01",
    metodo_pago: "PUE",
    lugar_expedicion: "06000",
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal: pesos(500),
    descuento: pesos(0) as never,
    total: pesos(580),
    no_certificado: "30001000000500003416",
    emisor: { rfc: "AAA010101AAA", nombre: "RODIZIO SA DE CV", regimen_fiscal: "601", codigo_postal: "06000" },
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
    ...extra,
  } as Comprobante;
}

const timbre: TimbreFiscal = {
  uuid: "A1B2C3D4-1111-2222-3333-444455556666",
  fecha_timbrado: "2026-07-23T21:20:00",
  sello_cfd: "abcdefghIJKLMNOPqrstuvwx0123456789YZ==",
  no_certificado_sat: "00001000000504465028",
  sello_sat: "SELLOSATxxxxYYYY",
  rfc_pac: "SPR190613I52",
};

// --- El QR del SAT -----------------------------------------------------------------------

describe("URL de verificación del SAT (el QR)", () => {
  it("lleva UUID, ambos RFC, total y la cola del sello", () => {
    const url = urlVerificacionSat(comprobante(), timbre);

    expect(url).toContain("verificacfdi.facturaelectronica.sat.gob.mx");
    expect(url).toContain(`id=${timbre.uuid}`);
    expect(url).toContain("re=AAA010101AAA");
    expect(url).toContain("rr=XEXX010101000");
    expect(url).toContain("tt=580.00");
  });

  /*
   * El SAT usa SOLO los últimos 8 caracteres del sello, no el sello entero.
   * Mandar el sello completo hace que el cotejo falle.
   */
  it("usa los últimos 8 caracteres del sello, no el sello completo", () => {
    const url = urlVerificacionSat(comprobante(), timbre);
    expect(url).toContain(`fe=${timbre.sello_cfd.slice(-8)}`);
    expect(url).not.toContain(timbre.sello_cfd);
  });

  it("el total va con dos decimales, como espera el verificador", () => {
    const url = urlVerificacionSat(comprobante({ total: pesos(1234.5) }), timbre);
    expect(url).toContain("tt=1234.50");
  });
});

// --- La cadena original del timbre -------------------------------------------------------

describe("cadena original del complemento de timbrado", () => {
  it("empieza y termina con doble barra y sigue el orden del Anexo 20", () => {
    const cadena = cadenaOriginalTimbre(timbre);
    expect(cadena.startsWith("||")).toBe(true);
    expect(cadena.endsWith("||")).toBe(true);
    expect(cadena).toBe(
      `||1.1|${timbre.uuid}|${timbre.fecha_timbrado}|${timbre.rfc_pac}|${timbre.sello_cfd}|${timbre.no_certificado_sat}||`,
    );
  });
});

// --- El modelo impreso -------------------------------------------------------------------

describe("representación impresa", () => {
  it("sin timbre es un borrador: no trae QR ni UUID", () => {
    const r = representacionImpresa(comprobante());
    expect(r.timbre).toBeUndefined();
    expect(r.total).toBe("$580.00");
    expect(r.total_en_letra).toBe("QUINIENTOS OCHENTA PESOS 00/100 M.N.");
  });

  it("con timbre trae el QR, el UUID y los sellos", () => {
    const r = representacionImpresa(comprobante(), timbre);
    expect(r.timbre?.uuid).toBe(timbre.uuid);
    expect(r.timbre?.url_qr).toContain(`id=${timbre.uuid}`);
    expect(r.timbre?.no_certificado_emisor).toBe("30001000000500003416");
    expect(r.timbre?.no_certificado_sat).toBe(timbre.no_certificado_sat);
  });

  it("incluye emisor, receptor y conceptos legibles", () => {
    const r = representacionImpresa(comprobante(), timbre);
    expect(r.emisor.rfc).toBe("AAA010101AAA");
    expect(r.receptor.uso_cfdi).toBe("S01");
    expect(r.conceptos[0]).toMatchObject({
      descripcion: "Pizza familiar",
      importe: "$500.00",
      valor_unitario: "$500.00",
    });
  });

  it("lleva la leyenda obligatoria de representación impresa", () => {
    expect(representacionImpresa(comprobante()).leyenda).toMatch(/representación impresa de un CFDI/i);
  });

  it("muestra el descuento solo cuando lo hay", () => {
    expect(representacionImpresa(comprobante()).descuento).toBeUndefined();
    expect(representacionImpresa(comprobante({ descuento: pesos(50) as never })).descuento).toBe("$50.00");
  });
});
