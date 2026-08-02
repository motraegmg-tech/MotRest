/**
 * Cómo entra un comensal a SU cuenta, y a nada más (M7 · F3).
 *
 * EL PROBLEMA. La encuesta de satisfacción la contesta hoy el mesero —"¿qué tal
 * estuvo?"— y la teclea él. Eso no es una encuesta: es la opinión del mesero
 * sobre su propio servicio. Para que la conteste quien comió hace falta que el
 * comensal entre desde su teléfono, y ahí aparece el problema de verdad:
 *
 *   un comensal NO es una terminal del local.
 *
 * Las terminales comparten la clave del local y ven toda la operación. Un
 * teléfono ajeno no puede tener esa llave ni acercarse al event log. Necesita
 * una puerta propia, estrecha, que abra UNA cuenta y nada más.
 *
 * LA SOLUCIÓN: UN ENLACE FIRMADO POR CUENTA.
 *
 * El ticket lleva un QR con `orden_id~firma`. La firma es un HMAC-SHA256 de ese
 * orden_id con un secreto que solo conoce el Hub, recortado a 16 caracteres.
 *
 *   - No se puede FABRICAR: sin el secreto no se puede firmar otro orden_id.
 *   - No se puede ADIVINAR: 16 caracteres base32 son 80 bits.
 *   - No se puede ENUMERAR: tener el enlace de tu mesa no da el de la de al lado.
 *   - No hay que registrarse ni dar el teléfono para opinar.
 *
 * El secreto es del Hub y NO es la clave del local: si un enlace se filtrara,
 * lo que se expone es una cuenta, no la sincronización del restaurante.
 */
import type { ID } from "../comun/ids.js";

/** Longitud de la firma en el enlace. 16 × 5 bits = 80 bits de fuerza. */
const LARGO_FIRMA = 16;

/** Sin I, L, O, U ni dígitos ambiguos: un QR mal leído se teclea a mano. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const cifrador = new TextEncoder();

function aBase32(bytes: Uint8Array, largo: number): string {
  let salida = "";
  for (let i = 0; i < largo; i++) {
    salida += ALFABETO[bytes[i % bytes.length]! % ALFABETO.length];
  }
  return salida;
}

async function hmac(secreto: string, mensaje: string): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey(
    "raw",
    cifrador.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, cifrador.encode(mensaje));
  return new Uint8Array(firma);
}

/** La firma que acompaña a un orden_id en el enlace del ticket. */
export async function firmarCuenta(ordenId: ID, secreto: string): Promise<string> {
  return aBase32(await hmac(secreto, ordenId), LARGO_FIRMA);
}

/** El código completo que va en el QR: `orden_id~firma`. */
export async function codigoDeCuenta(ordenId: ID, secreto: string): Promise<string> {
  return `${ordenId}~${await firmarCuenta(ordenId, secreto)}`;
}

/**
 * Comprueba un código y devuelve la orden, o null.
 *
 * La comparación es de tiempo constante. Comparar con `===` deja escapar por
 * cuánto tarda cuántos caracteres coincidieron, y eso permite reconstruir una
 * firma a fuerza de intentos.
 */
export async function abrirCuenta(codigo: string, secreto: string): Promise<ID | null> {
  const corte = codigo.lastIndexOf("~");
  if (corte <= 0) return null;

  const ordenId = codigo.slice(0, corte);
  const firma = codigo.slice(corte + 1).toUpperCase();
  if (firma.length !== LARGO_FIRMA) return null;

  const esperada = await firmarCuenta(ordenId, secreto);

  let diferencia = 0;
  for (let i = 0; i < LARGO_FIRMA; i++) {
    diferencia |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  }
  return diferencia === 0 ? ordenId : null;
}

/**
 * Hasta cuándo sirve el enlace de una cuenta.
 *
 * Se cierra a los tres días. La opinión se da el mismo día o no se da; dejar el
 * enlace vivo para siempre es una puerta abierta que nadie vuelve a mirar.
 */
export const VIGENCIA_ENLACE_MS = 3 * 24 * 60 * 60 * 1000;

export function enlaceVigente(cerradaTs: number, ahora: number): boolean {
  return ahora - cerradaTs <= VIGENCIA_ENLACE_MS;
}
