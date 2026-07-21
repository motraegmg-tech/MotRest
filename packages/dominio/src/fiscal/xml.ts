/**
 * Serialización del CFDI 4.0 a XML.
 *
 * Genera el comprobante SIN Sello ni Certificado: esos dos atributos requieren
 * el CSD que el SAT entrega al contribuyente, y se agregan justo antes de
 * timbrar. El Timbre Fiscal Digital lo incorpora el PAC.
 *
 * En otras palabras: esto es exactamente lo que se le manda al PAC.
 */
import type { Comprobante, ConceptoCfdi } from "./comprobante.js";
import { importeSat, tasaSat } from "./comprobante.js";

/** Escapa los caracteres que no pueden ir crudos en un atributo XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function atributos(pares: Record<string, string | undefined>): string {
  return Object.entries(pares)
    .filter(([, valor]) => valor !== undefined && valor !== "")
    .map(([clave, valor]) => `${clave}="${escaparXml(valor as string)}"`)
    .join(" ");
}

function conceptoXml(concepto: ConceptoCfdi, sangria: string): string {
  const propios = atributos({
    ClaveProdServ: concepto.clave_prod_serv,
    Cantidad: String(concepto.cantidad),
    ClaveUnidad: concepto.clave_unidad,
    Descripcion: concepto.descripcion,
    ValorUnitario: importeSat(concepto.valor_unitario),
    Importe: importeSat(concepto.importe),
    Descuento: concepto.descuento > 0 ? importeSat(concepto.descuento) : undefined,
    ObjetoImp: concepto.objeto_imp,
  });

  // Un concepto no gravado se cierra en la misma etiqueta.
  if (concepto.traslados.length === 0) {
    return `${sangria}<cfdi:Concepto ${propios} />`;
  }

  const traslados = concepto.traslados
    .map(
      (t) =>
        `${sangria}      <cfdi:Traslado ${atributos({
          Base: importeSat(t.base),
          Impuesto: t.impuesto,
          TipoFactor: t.tipo_factor,
          TasaOCuota: tasaSat(t.tasa_o_cuota),
          Importe: importeSat(t.importe),
        })} />`,
    )
    .join("\n");

  return [
    `${sangria}<cfdi:Concepto ${propios}>`,
    `${sangria}  <cfdi:Impuestos>`,
    `${sangria}    <cfdi:Traslados>`,
    traslados,
    `${sangria}    </cfdi:Traslados>`,
    `${sangria}  </cfdi:Impuestos>`,
    `${sangria}</cfdi:Concepto>`,
  ].join("\n");
}

/**
 * Serializa el comprobante a XML del SAT.
 * Faltan Sello, NoCertificado y Certificado: los agrega quien tiene el CSD.
 */
export function comprobanteAXml(c: Comprobante): string {
  const encabezado = atributos({
    "xmlns:cfdi": "http://www.sat.gob.mx/cfd/4",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation":
      "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
    Version: c.version,
    Serie: c.serie,
    Folio: c.folio,
    Fecha: c.fecha,
    FormaPago: c.forma_pago,
    SubTotal: importeSat(c.subtotal),
    Descuento: c.descuento > 0 ? importeSat(c.descuento) : undefined,
    Moneda: c.moneda,
    Total: importeSat(c.total),
    TipoDeComprobante: c.tipo_comprobante,
    Exportacion: c.exportacion,
    MetodoPago: c.metodo_pago,
    LugarExpedicion: c.lugar_expedicion,
  });

  const emisor = atributos({
    Rfc: c.emisor.rfc,
    Nombre: c.emisor.nombre,
    RegimenFiscal: c.emisor.regimen_fiscal,
  });

  const receptor = atributos({
    Rfc: c.receptor.rfc,
    Nombre: c.receptor.nombre,
    DomicilioFiscalReceptor: c.receptor.codigo_postal,
    RegimenFiscalReceptor: c.receptor.regimen_fiscal,
    UsoCFDI: c.receptor.uso_cfdi,
  });

  const conceptos = c.conceptos.map((x) => conceptoXml(x, "    ")).join("\n");

  const trasladosResumen = c.traslados
    .map(
      (t) =>
        `      <cfdi:Traslado ${atributos({
          Base: importeSat(t.base),
          Impuesto: t.impuesto,
          TipoFactor: t.tipo_factor,
          TasaOCuota: tasaSat(t.tasa_o_cuota),
          Importe: importeSat(t.importe),
        })} />`,
    )
    .join("\n");

  const bloqueImpuestos =
    c.traslados.length > 0
      ? [
          `  <cfdi:Impuestos TotalImpuestosTrasladados="${importeSat(c.total_impuestos_trasladados)}">`,
          "    <cfdi:Traslados>",
          trasladosResumen,
          "    </cfdi:Traslados>",
          "  </cfdi:Impuestos>",
        ].join("\n")
      : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<cfdi:Comprobante ${encabezado}>`,
    `  <cfdi:Emisor ${emisor} />`,
    `  <cfdi:Receptor ${receptor} />`,
    "  <cfdi:Conceptos>",
    conceptos,
    "  </cfdi:Conceptos>",
    bloqueImpuestos,
    "</cfdi:Comprobante>",
  ]
    .filter((linea) => linea !== "")
    .join("\n");
}
