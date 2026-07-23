/**
 * Cadena original del CFDI 4.0 — lo que se firma con el CSD.
 *
 * QUÉ ES
 *
 * Una representación del comprobante como una sola línea de texto, con los
 * datos en un orden que el SAT define exactamente. Sobre esa línea se calcula
 * el sello digital. El PAC la vuelve a calcular al recibir el comprobante: si
 * no le da idéntica, el sello no cuadra y **rechaza la factura**.
 *
 * POR QUÉ ESTE ARCHIVO ES DELICADO
 *
 * No hay margen. Un atributo fuera de orden, un espacio de más o un campo
 * opcional que se emite vacío en vez de omitirse producen una cadena distinta,
 * y entonces NINGUNA factura se timbra. No falla una de cada cien: fallan
 * todas, y el error que devuelve el PAC —"sello inválido"— no dice cuál fue la
 * diferencia.
 *
 * Por eso el orden va declarado como una lista visible y no repartido por el
 * código: así se puede cotejar contra el Anexo 20 sin leer lógica.
 *
 * REGLAS DEL SAT
 *
 *   - La cadena empieza con `||` y termina con `||`.
 *   - Los datos van separados por `|`.
 *   - Un atributo opcional AUSENTE se omite por completo. No deja un campo
 *     vacío: si lo dejara, habría un `|` de más y la cadena no cuadraría.
 *   - Los espacios al inicio y al final se recortan, y los internos seguidos
 *     se colapsan a uno solo.
 *   - `Sello`, `NoCertificado` y `Certificado` NO entran... salvo
 *     `NoCertificado`, que sí va. Ver la nota abajo.
 *
 * Referencia: Anexo 20 versión 4.0, "Secuencia de formación para generar la
 * cadena original".
 */
import type { Comprobante, ConceptoCfdi } from "./comprobante.js";
import { importeSat, tasaSat } from "./comprobante.js";

/**
 * Normaliza un valor como exige el SAT.
 *
 * El colapso de espacios internos no es cosmético: el nombre de un cliente
 * capturado como "Juan  Pérez" con dos espacios daría una cadena distinta a la
 * que calcula el PAC leyendo el XML, y la factura se rechazaría.
 */
function normalizar(valor: string): string {
  return valor.trim().replace(/\s+/g, " ");
}

/**
 * Une los campos presentes.
 *
 * `undefined` significa "atributo ausente" y desaparece; una cadena vacía
 * también, porque el XML tampoco la emitiría.
 */
function unir(campos: (string | undefined)[]): string {
  return campos
    .filter((c): c is string => c !== undefined && c !== "")
    .map(normalizar)
    .join("|");
}

/** Los datos del comprobante, en el orden del Anexo 20. */
function tramoComprobante(c: Comprobante): string {
  return unir([
    c.version,
    c.serie,
    c.folio,
    c.fecha,
    c.forma_pago,
    /*
     * NoCertificado SÍ forma parte de la cadena, a diferencia de Sello y
     * Certificado. Es el número de serie del CSD con el que se va a firmar, y
     * lo aporta quien sella —no está en el comprobante hasta ese momento—.
     */
    c.no_certificado,
    // CondicionesDePago: no se usa en venta de mostrador.
    undefined,
    importeSat(c.subtotal),
    c.descuento > 0 ? importeSat(c.descuento) : undefined,
    c.moneda,
    // TipoCambio: solo si la moneda no es MXN.
    undefined,
    importeSat(c.total),
    c.tipo_comprobante,
    c.exportacion,
    c.metodo_pago,
    c.lugar_expedicion,
    // Confirmacion: solo para importes fuera de rango autorizados por el SAT.
    undefined,
  ]);
}

function tramoEmisor(c: Comprobante): string {
  return unir([
    c.emisor.rfc,
    c.emisor.nombre,
    c.emisor.regimen_fiscal,
    // FacAtrAdquirente: solo para factura por cuenta de terceros.
    undefined,
  ]);
}

function tramoReceptor(c: Comprobante): string {
  return unir([
    c.receptor.rfc,
    c.receptor.nombre,
    c.receptor.codigo_postal,
    // ResidenciaFiscal y NumRegIdTrib: solo para receptores del extranjero.
    undefined,
    undefined,
    c.receptor.regimen_fiscal,
    c.receptor.uso_cfdi,
  ]);
}

function tramoConcepto(concepto: ConceptoCfdi): string {
  const propios = unir([
    concepto.clave_prod_serv,
    // NoIdentificacion: el código interno del producto, opcional.
    undefined,
    String(concepto.cantidad),
    concepto.clave_unidad,
    // Unidad: descripción libre de la unidad, opcional.
    undefined,
    concepto.descripcion,
    importeSat(concepto.valor_unitario),
    importeSat(concepto.importe),
    concepto.descuento > 0 ? importeSat(concepto.descuento) : undefined,
    concepto.objeto_imp,
  ]);

  if (concepto.traslados.length === 0) return propios;

  const traslados = concepto.traslados.map((t) =>
    unir([
      importeSat(t.base),
      t.impuesto,
      t.tipo_factor,
      tasaSat(t.tasa_o_cuota),
      importeSat(t.importe),
    ]),
  );

  return [propios, ...traslados].join("|");
}

/** Los impuestos del pie del comprobante. */
function tramoImpuestos(c: Comprobante): string {
  if (c.traslados.length === 0) return "";

  const traslados = c.traslados.map((t) =>
    unir([
      importeSat(t.base),
      t.impuesto,
      t.tipo_factor,
      tasaSat(t.tasa_o_cuota),
      importeSat(t.importe),
    ]),
  );

  // TotalImpuestosTrasladados va DESPUÉS del detalle, no antes.
  return [...traslados, importeSat(c.total_impuestos_trasladados)].join("|");
}

/**
 * Construye la cadena original de un comprobante ya listo para sellar.
 *
 * `no_certificado` tiene que venir puesto: es parte de la cadena y sale del
 * CSD con el que se va a firmar.
 */
export function cadenaOriginal(c: Comprobante): string {
  if (!c.no_certificado) {
    throw new Error(
      "Falta el número de certificado: sin él la cadena original queda incompleta y el PAC rechazaría el sello",
    );
  }

  const tramos = [
    tramoComprobante(c),
    tramoEmisor(c),
    tramoReceptor(c),
    ...c.conceptos.map(tramoConcepto),
    tramoImpuestos(c),
  ].filter((t) => t !== "");

  return `||${tramos.join("|")}||`;
}
