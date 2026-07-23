/**
 * La representación impresa del CFDI: lo que el comensal se lleva en papel.
 *
 * El XML es el documento fiscal; esto es su versión legible para una persona.
 * El SAT (Anexo 20, regla 2.7.1.7) exige que incluya ciertos datos y, cuando ya
 * está timbrado, el **código QR de verificación**, el UUID, los sellos y la
 * cadena original del complemento de timbrado.
 *
 * Este módulo NO dibuja nada: arma el modelo de datos y la cadena del QR. Cómo
 * se pinte —en una térmica de 80 mm o en pantalla— es cosa de quien imprime.
 */
import type { Centavos } from "../comun/dinero.js";
import { importeSat } from "./comprobante.js";
import type { Comprobante } from "./comprobante.js";
import { importeConLetra } from "./importe-letra.js";
import type { TimbreFiscal } from "./xml.js";

const URL_VERIFICADOR = "https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx";

/**
 * Los últimos 8 caracteres del sello, como pide el SAT para el QR.
 *
 * No es el sello completo: el verificador solo usa esa cola para cotejar. Si el
 * sello viniera vacío —comprobante sin timbrar aún— el campo va vacío y el SAT
 * lo trata como no coincidente, que es justo lo que debe pasar.
 */
function colaDelSello(sello: string): string {
  return sello.length > 8 ? sello.slice(-8) : sello;
}

/**
 * La URL que codifica el QR de verificación del SAT.
 *
 * El comensal la escanea y el portal del SAT le dice si la factura es válida y
 * está vigente. Los parámetros y su orden son los que define el Anexo 20; el
 * total va con la longitud y el formato exactos que el verificador espera
 * (`importeSat`, con decimales), o el cotejo falla.
 */
export function urlVerificacionSat(comprobante: Comprobante, timbre: TimbreFiscal): string {
  const parametros = [
    `id=${timbre.uuid}`,
    `re=${comprobante.emisor.rfc}`,
    `rr=${comprobante.receptor.rfc}`,
    `tt=${importeSat(comprobante.total)}`,
    `fe=${colaDelSello(timbre.sello_cfd)}`,
  ];
  return `${URL_VERIFICADOR}?${parametros.join("&")}`;
}

/**
 * La cadena original del Complemento de Certificación Digital del SAT.
 *
 * Es distinta de la cadena original del comprobante: esta la arma el PAC al
 * timbrar y va en la representación impresa por requisito del Anexo 20. Su orden
 * es fijo y empieza y termina con `||`.
 */
export function cadenaOriginalTimbre(timbre: TimbreFiscal, version = "1.1"): string {
  return [
    version,
    timbre.uuid,
    timbre.fecha_timbrado,
    timbre.rfc_pac,
    timbre.sello_cfd,
    timbre.no_certificado_sat,
  ]
    .map((c) => c.trim())
    .join("|")
    .replace(/^/, "||")
    .concat("||");
}

export interface ConceptoImpreso {
  cantidad: string;
  clave_unidad: string;
  clave_prod_serv: string;
  descripcion: string;
  valor_unitario: string;
  importe: string;
}

/** Todo lo que hace falta para pintar la representación impresa. */
export interface RepresentacionImpresa {
  emisor: { rfc: string; nombre: string; regimen_fiscal: string };
  receptor: { rfc: string; nombre: string; codigo_postal: string; regimen_fiscal: string; uso_cfdi: string };
  comprobante: {
    serie_folio: string;
    fecha: string;
    lugar_expedicion: string;
    forma_pago: string;
    metodo_pago: string;
    moneda: string;
    tipo: string;
  };
  conceptos: ConceptoImpreso[];
  subtotal: string;
  descuento?: string;
  total_impuestos: string;
  total: string;
  total_en_letra: string;

  /** Presente solo si el CFDI ya está timbrado. Sin esto es un borrador. */
  timbre?: {
    uuid: string;
    fecha_timbrado: string;
    no_certificado_emisor: string;
    no_certificado_sat: string;
    sello_cfd: string;
    sello_sat: string;
    rfc_pac: string;
    cadena_original: string;
    /** La URL que se codifica en el QR de verificación del SAT. */
    url_qr: string;
  };

  /** La leyenda obligatoria al pie. */
  leyenda: string;
}

const pesos = (c: Centavos) => `$${importeSat(c)}`;

/**
 * Arma la representación impresa a partir del comprobante y, si existe, su
 * timbre.
 *
 * Sin timbre, devuelve el modelo marcado como borrador —útil para
 * previsualizar antes de timbrar—; con timbre, el documento completo con QR.
 */
export function representacionImpresa(
  comprobante: Comprobante,
  timbre?: TimbreFiscal,
): RepresentacionImpresa {
  const base: RepresentacionImpresa = {
    emisor: {
      rfc: comprobante.emisor.rfc,
      nombre: comprobante.emisor.nombre,
      regimen_fiscal: comprobante.emisor.regimen_fiscal,
    },
    receptor: {
      rfc: comprobante.receptor.rfc,
      nombre: comprobante.receptor.nombre,
      codigo_postal: comprobante.receptor.codigo_postal,
      regimen_fiscal: comprobante.receptor.regimen_fiscal,
      uso_cfdi: comprobante.receptor.uso_cfdi,
    },
    comprobante: {
      serie_folio: `${comprobante.serie}-${comprobante.folio}`,
      fecha: comprobante.fecha,
      lugar_expedicion: comprobante.lugar_expedicion,
      forma_pago: comprobante.forma_pago,
      metodo_pago: comprobante.metodo_pago,
      moneda: comprobante.moneda,
      tipo: comprobante.tipo_comprobante,
    },
    conceptos: comprobante.conceptos.map((c) => ({
      cantidad: String(c.cantidad),
      clave_unidad: c.clave_unidad,
      clave_prod_serv: c.clave_prod_serv,
      descripcion: c.descripcion,
      valor_unitario: pesos(c.valor_unitario),
      importe: pesos(c.importe),
    })),
    subtotal: pesos(comprobante.subtotal),
    descuento: comprobante.descuento > 0 ? pesos(comprobante.descuento) : undefined,
    total_impuestos: pesos(comprobante.total_impuestos_trasladados),
    total: pesos(comprobante.total),
    total_en_letra: importeConLetra(comprobante.total),
    leyenda: "Este documento es una representación impresa de un CFDI 4.0",
  };

  if (!timbre) return base;

  return {
    ...base,
    timbre: {
      uuid: timbre.uuid,
      fecha_timbrado: timbre.fecha_timbrado,
      no_certificado_emisor: comprobante.no_certificado ?? "",
      no_certificado_sat: timbre.no_certificado_sat,
      sello_cfd: timbre.sello_cfd,
      sello_sat: timbre.sello_sat,
      rfc_pac: timbre.rfc_pac,
      cadena_original: cadenaOriginalTimbre(timbre),
      url_qr: urlVerificacionSat(comprobante, timbre),
    },
  };
}
