/**
 * Sello del corte de caja.
 *
 * Un corte impreso sin sello es una hoja que cualquiera puede rehacer con otras
 * cifras. El sello es una huella de los números del corte: si alguien altera el
 * registro después de cerrarlo, deja de coincidir con el papel que se firmó.
 *
 * Qué es y qué NO es, para no venderlo como lo que no:
 *   - **Sí** detecta que las cifras cambiaron después del cierre.
 *   - **No** impide que alguien con acceso al sistema genere un corte falso
 *     desde el principio. Para eso hace falta una firma con llave privada, que
 *     llega cuando el Hub tenga su propio par de llaves.
 *
 * Se usa SHA-256 vía WebCrypto, disponible igual en el navegador, en Tauri y en
 * Node — el mismo corte da el mismo sello en cualquiera de los tres.
 */
import type { Centavos } from "@motrest/dominio";

/** Las cifras que quedan selladas. Cambiar cualquiera cambia el sello. */
export interface CifrasCorte {
  sesion_id: string;
  cajero_id: string;
  abierta_ts: number;
  cerrada_ts: number;
  fondo_inicial: Centavos;
  total_vendido: Centavos;
  efectivo_esperado: Centavos;
  declarado: Centavos;
  diferencia: Centavos;
  propinas: Centavos;
  cuentas_cerradas: number;
}

/**
 * Serializa las cifras de forma estable.
 *
 * El orden de las claves es EXPLÍCITO y no el que devuelva `Object.keys`: si el
 * orden cambiara entre versiones, el mismo corte daría dos sellos distintos y
 * la verificación sería inútil.
 */
function canonizar(cifras: CifrasCorte): string {
  return [
    cifras.sesion_id,
    cifras.cajero_id,
    cifras.abierta_ts,
    cifras.cerrada_ts,
    cifras.fondo_inicial,
    cifras.total_vendido,
    cifras.efectivo_esperado,
    cifras.declarado,
    cifras.diferencia,
    cifras.propinas,
    cifras.cuentas_cerradas,
  ].join("|");
}

/**
 * Calcula el sello.
 *
 * Se devuelven 16 caracteres en mayúsculas, agrupados de cuatro en cuatro: es
 * lo que una persona puede cotejar a ojo entre el papel y la pantalla. El hash
 * completo no lo compara nadie.
 */
export async function sellarCorte(cifras: CifrasCorte): Promise<string> {
  const datos = new TextEncoder().encode(canonizar(cifras));
  const resumen = await crypto.subtle.digest("SHA-256", datos);
  const hex = [...new Uint8Array(resumen)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
    .toUpperCase();

  return hex.replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Comprueba que un corte no haya sido alterado desde que se selló.
 *
 * Se compara carácter por carácter recorriendo SIEMPRE toda la cadena, sin
 * cortar en la primera diferencia: es la misma precaución que en la
 * verificación de credenciales, para no filtrar información por el tiempo que
 * tarda la comparación.
 */
export async function verificarSello(
  cifras: CifrasCorte,
  sello: string,
): Promise<boolean> {
  const esperado = await sellarCorte(cifras);
  if (esperado.length !== sello.length) return false;

  let diferencia = 0;
  for (let i = 0; i < esperado.length; i += 1) {
    diferencia |= esperado.charCodeAt(i) ^ sello.charCodeAt(i);
  }
  return diferencia === 0;
}
