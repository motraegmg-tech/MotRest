/**
 * Series por terminal: cómo se evita que dos cajas emitan el mismo folio.
 *
 * EL PROBLEMA
 *
 * El folio se calcula como «el mayor que conozco, más uno». En una sola caja
 * eso basta. Con dos terminales no: si ambas están sin red —o simplemente no se
 * han sincronizado todavía— las dos ven el mismo máximo y las dos emiten el
 * 1001. Dos comprobantes distintos con el mismo identificador es un problema
 * fiscal, no un detalle cosmético.
 *
 * LA SOLUCIÓN, Y POR QUÉ ESTA
 *
 * El SAT identifica un comprobante por el par **Serie + Folio**, y la Serie
 * existe precisamente para esto. Dándole a cada terminal su propia serie, cada
 * una lleva su propio consecutivo y **jamás colisiona con otra, ni sin red**.
 * Es lo que hace cualquier punto de venta con varias cajas.
 *
 * La alternativa —que el Hub reparta los folios— obligaría a pedirle permiso
 * antes de facturar, y una terminal en modo isla no podría emitir. Cambiar la
 * disponibilidad por la estética de un consecutivo único sería mal negocio: el
 * TRD manda que se pueda vender y facturar sin el Hub (R3).
 */
import type { ID } from "../comun/ids.js";

/**
 * Alfabeto del sufijo. Sin vocales, para no formar palabras por accidente en
 * un dato que va impreso en la factura del cliente.
 */
const LETRAS = "BCDFGHJKLMNPQRSTVWXYZ";

/**
 * Serie de una terminal: la base del local más dos letras estables suyas.
 *
 * `A` + `KP` → `AKP`. Se deriva del identificador del dispositivo con una mezcla
 * simple y determinista: la misma terminal saca siempre la misma serie, aunque
 * se reinstale la aplicación, porque el identificador se conserva.
 *
 * Dos letras dan 441 combinaciones. Para un restaurante con tres o cuatro
 * terminales el riesgo de que dos coincidan es despreciable, y si llegara a
 * pasar se resuelve cambiando la serie base de una de ellas a mano.
 */
export function serieDeTerminal(serieBase: string, deviceId: ID): string {
  let mezcla = 0;
  for (let i = 0; i < deviceId.length; i++) {
    // Mezcla determinista y barata; no necesita ser criptográfica, solo repartir.
    mezcla = (mezcla * 31 + deviceId.charCodeAt(i)) >>> 0;
  }
  const primera = LETRAS[mezcla % LETRAS.length]!;
  const segunda = LETRAS[Math.floor(mezcla / LETRAS.length) % LETRAS.length]!;
  return `${serieBase}${primera}${segunda}`;
}

/**
 * El siguiente folio de una serie.
 *
 * Solo mira los comprobantes de ESA serie: los de otra terminal llevan su
 * propio consecutivo y no deben correr el de esta. Arranca en 1001 para que un
 * folio nunca se confunda con un número de mesa o de orden.
 */
export function siguienteFolio(
  registros: readonly { serie: string; folio: string }[],
  serie: string,
): string {
  const numeros = registros
    .filter((r) => r.serie === serie)
    .map((r) => Number(r.folio))
    .filter((n) => Number.isFinite(n));

  return String(numeros.length > 0 ? Math.max(...numeros) + 1 : 1001);
}
