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
 *   - No se puede ADIVINAR: 16 caracteres de un alfabeto de 30 son 78,5 bits.
 *   - No se puede ENUMERAR: tener el enlace de tu mesa no da el de la de al lado.
 *   - No hay que registrarse ni dar el teléfono para opinar.
 *
 * El secreto es del Hub y NO es la clave del local: si un enlace se filtrara,
 * lo que se expone es una cuenta, no la sincronización del restaurante.
 */
import type { ID } from "../comun/ids.js";

/**
 * Longitud de la firma en el enlace: **78,5 bits**, no 80.
 *
 * Aquí decía «16 × 5 bits = 80 bits» y la cuenta no sale: cinco bits por
 * carácter serían 32 símbolos, y el alfabeto tiene 30 —se quitaron los
 * ambiguos—. Lo real es 16 × log₂(30) = 78,5 bits.
 *
 * La diferencia no cambia nada en la práctica: adivinar un enlace sigue estando
 * a 2⁷⁸ intentos contra un Hub que además limita el ritmo. Se corrige porque una
 * cifra inflada en un comentario es la que alguien cita el día que decide si
 * puede acortar la firma «que total, sobra margen». Si algún día se quieren 80
 * bits de verdad, son 17 caracteres (83,4 bits) y una línea.
 */
const LARGO_FIRMA = 16;

/** Sin I, L, O, U ni dígitos ambiguos: un QR mal leído se teclea a mano. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * El mayor múltiplo de 30 que cabe en un byte.
 *
 * 256 no es múltiplo de 30: al hacer `byte % 30`, los valores 0..15 salen nueve
 * veces de 256 y los 16..29 solo ocho. Es decir, la mitad del alfabeto aparece
 * un 12 % más a menudo que la otra. Se descartan los bytes por encima de 240 y
 * el reparto queda plano.
 */
const TOPE_SIN_SESGO = 240;

const cifrador = new TextEncoder();

/**
 * Convierte el HMAC en caracteres del alfabeto, sin sesgo.
 *
 * **Descarta bytes en vez de doblarlos**, que es lo que hacía antes con `%`. Y
 * se puede descartar aunque esto tenga que ser determinista —el Hub y el enlace
 * del comensal tienen que llegar al mismo resultado— porque el descarte depende
 * solo de los bytes del HMAC, que son los mismos en los dos lados.
 *
 * El HMAC trae 32 bytes y hacen falta 16 caracteres: de media pasan 30, así que
 * quedarse corto tiene una probabilidad de una entre miles de millones. Aun así
 * hay respaldo, porque una firma corta rompería el enlace de esa cuenta **para
 * siempre**, y «no puede pasar» no es lo mismo que «no pasa».
 */
export function aBase32(bytes: Uint8Array, largo: number): string {
  let salida = "";

  for (const byte of bytes) {
    if (salida.length === largo) break;
    if (byte >= TOPE_SIN_SESGO) continue;
    salida += ALFABETO[byte % ALFABETO.length];
  }

  // Respaldo: solo si el HMAC trajera una racha de bytes altos irrepetible.
  for (let i = 0; salida.length < largo; i++) {
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
