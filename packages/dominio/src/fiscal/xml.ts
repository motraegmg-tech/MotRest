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
 * Lo que aporta quien tiene el CSD. Sin esto el comprobante está incompleto y
 * el PAC no lo acepta.
 */
export interface SelloDelCsd {
  sello: string;
  no_certificado: string;
  certificado: string;
}

/**
 * Serializa el comprobante a XML del SAT.
 *
 * Sin `sello`, sale el comprobante en borrador —útil para previsualizar—. Con
 * él, sale lo que se le manda al PAC.
 *
 * El orden de los atributos sigue el del Anexo 20 aunque XML no lo exija: los
 * validadores del SAT y de los PAC se han cerrado alguna vez ante un
 * comprobante correcto pero desordenado, y no hay nada que ganar apartándose.
 */
export function comprobanteAXml(c: Comprobante, sello?: SelloDelCsd): string {
  const encabezado = atributos({
    "xmlns:cfdi": "http://www.sat.gob.mx/cfd/4",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation":
      "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd",
    Version: c.version,
    Serie: c.serie,
    Folio: c.folio,
    Fecha: c.fecha,
    Sello: sello?.sello,
    FormaPago: c.forma_pago,
    NoCertificado: sello?.no_certificado,
    Certificado: sello?.certificado,
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

/** El Timbre Fiscal Digital: lo que el PAC agrega y convierte el CFDI en factura. */
export interface TimbreFiscal {
  uuid: string;
  fecha_timbrado: string;
  sello_cfd: string;
  no_certificado_sat: string;
  sello_sat: string;
  rfc_pac: string;
}

/**
 * Lee el timbre del XML que devolvió el PAC.
 *
 * Se extrae del XML en vez de confiar en los campos sueltos que cada PAC
 * devuelve a su manera: el XML timbrado es el documento fiscal, y lo que valga
 * ahí es lo que vale ante el SAT. Si un PAC informara un UUID distinto del que
 * puso en el XML, manda el XML.
 *
 * Es una lectura por expresión regular sobre un atributo, no un analizador de
 * XML: alcanza para un elemento plano y sin contenido como este, y evita traer
 * una dependencia entera al Hub para leer seis atributos.
 */
export function leerTimbre(xmlTimbrado: string): TimbreFiscal | null {
  const bloque = /<tfd:TimbreFiscalDigital\b([^>]*)\/?>/i.exec(xmlTimbrado);
  if (!bloque) return null;

  const leer = (nombre: string): string => {
    const encontrado = new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`, "i").exec(bloque[1]!);
    return encontrado ? desescaparXml(encontrado[1]!) : "";
  };

  const uuid = leer("UUID");
  if (!uuid) return null;

  return {
    uuid,
    fecha_timbrado: leer("FechaTimbrado"),
    sello_cfd: leer("SelloCFD"),
    no_certificado_sat: leer("NoCertificadoSAT"),
    sello_sat: leer("SelloSAT"),
    rfc_pac: leer("RfcProvCertif"),
  };
}

function desescaparXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // El ampersand va al final: deshacerlo primero volvería a interpretar las
    // entidades que él mismo produce.
    .replace(/&amp;/g, "&");
}
