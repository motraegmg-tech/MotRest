/**
 * El PAC: quien timbra.
 *
 * Un Proveedor Autorizado de Certificación es el único que puede convertir un
 * CFDI sellado en una factura con validez fiscal. MotRest sella localmente y el
 * PAC solo timbra — así el CSD nunca sale del restaurante.
 *
 * POR QUÉ ESTO ES UN CONTRATO Y NO UNA INTEGRACIÓN
 *
 * Hay una docena de PAC en México, cada uno con su API, y el restaurante puede
 * cambiar de proveedor por precio o por servicio. Atar el sistema a uno sería
 * atar al cliente. Todo lo que sigue —la cola, los reintentos, la clasificación
 * de errores— funciona igual con cualquiera; lo único que cambia por proveedor
 * es traducir su respuesta a `ResultadoTimbrado`.
 *
 * LO QUE DE VERDAD IMPORTA AQUÍ
 *
 * No es enviar la petición: es entender la respuesta. Un error del PAC puede
 * significar tres cosas muy distintas, y confundirlas cuesta caro:
 *
 *   - **Reintentable**: no hay internet, el PAC está caído, se agotó el tiempo.
 *     Se guarda y se reintenta. El restaurante sigue vendiendo.
 *   - **Rechazado**: el sello no cuadra, el CSD está revocado, el RFC del
 *     receptor no existe. Reintentar esto mil veces no lo arregla; hace falta
 *     que alguien intervenga. Reintentarlo además quema el saldo de timbres.
 *   - **Ya estaba timbrado**: el caso traicionero. Se ve como error y es un
 *     éxito. Ver abajo.
 */
import { leerTimbre, type TimbreFiscal } from "@motrest/dominio";

export interface Timbrado {
  timbre: TimbreFiscal;
  /** El XML completo con el timbre: ESTE es el documento fiscal. */
  xml: string;
}

export type ResultadoTimbrado =
  | { estado: "timbrado"; timbrado: Timbrado }
  | { estado: "reintentable"; motivo: string }
  | { estado: "rechazado"; codigo: string; motivo: string };

export interface Pac {
  readonly nombre: string;
  timbrar(xmlSellado: string): Promise<ResultadoTimbrado>;
}

/**
 * Códigos del SAT que NO tienen arreglo reintentando.
 *
 * Salen del catálogo de errores del Anexo 20. Son problemas del comprobante o
 * del certificado: el mismo XML fallará idénticamente dentro de una hora.
 */
const RECHAZOS_DEFINITIVOS = new Set([
  "301", // XML mal formado
  "302", // Sello inválido
  "303", // El sello no corresponde al emisor
  "304", // Certificado revocado o caduco
  "305", // Certificado no vigente a la fecha del comprobante
  "306", // La llave no corresponde al certificado
  "401", // RFC del emisor no está en la lista de contribuyentes
  "402", // El emisor no está en régimen de facturación
  "403", // Fecha fuera del rango permitido
]);

/**
 * "CFDI previamente timbrado": un éxito disfrazado de error.
 *
 * Ocurre justo cuando la conexión se corta después de que el PAC timbró pero
 * antes de que la respuesta llegara. Al reintentar, el PAC responde con este
 * código porque, en efecto, ese comprobante ya tiene UUID.
 *
 * Tratarlo como fallo sería el peor desenlace posible: una factura que existe
 * ante el SAT, que el restaurante no puede entregar, y un folio que se
 * volvería a usar. La mayoría de los PAC devuelven el timbre existente junto al
 * error; cuando lo hacen, se toma y se da por timbrado.
 */
export const YA_TIMBRADO = "307";

export function esRechazoDefinitivo(codigo: string): boolean {
  return RECHAZOS_DEFINITIVOS.has(codigo.trim());
}

/**
 * Traduce la respuesta cruda de un PAC a un resultado.
 *
 * Se aplica después de que el adaptador del proveedor extrajo tres cosas de su
 * formato particular: el código, el mensaje y el XML timbrado si vino.
 */
export function clasificar(entrada: {
  codigo?: string;
  mensaje?: string;
  xml?: string;
}): ResultadoTimbrado {
  const codigo = (entrada.codigo ?? "").trim();
  const mensaje = (entrada.mensaje ?? "").trim() || "El PAC no explicó el motivo.";

  // Un XML con timbre es un timbrado, venga con el código que venga: incluye el
  // caso del 307, donde el PAC devuelve el timbre que ya existía.
  if (entrada.xml) {
    const timbre = leerTimbre(entrada.xml);
    if (timbre) return { estado: "timbrado", timbrado: { timbre, xml: entrada.xml } };
  }

  /*
   * Un 307 sin XML es el caso incómodo: el comprobante está timbrado en algún
   * lado y aquí no se tiene el timbre. Reintentar no ayuda —siempre dará 307—,
   * así que se marca como rechazo para que alguien lo recupere del portal del
   * PAC. Lo importante es no volver a usar ese folio.
   */
  if (codigo === YA_TIMBRADO) {
    return {
      estado: "rechazado",
      codigo,
      motivo:
        "Este comprobante ya fue timbrado antes, pero el PAC no devolvió el timbre. " +
        "Descárgalo del portal de tu PAC: la factura existe y el folio NO debe reutilizarse.",
    };
  }

  if (codigo && esRechazoDefinitivo(codigo)) {
    return { estado: "rechazado", codigo, motivo: mensaje };
  }

  // Todo lo demás se considera pasajero. Ante la duda conviene reintentar: una
  // factura que tarda se entrega tarde; una que se descarta por error, nunca.
  return { estado: "reintentable", motivo: codigo ? `${codigo}: ${mensaje}` : mensaje };
}
