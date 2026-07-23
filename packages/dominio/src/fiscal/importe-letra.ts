/**
 * Importe con letra, como lo exige la representación impresa del CFDI.
 *
 * El SAT pide el total escrito en palabras, con el formato
 * `... PESOS NN/100 M.N.`. No es decoración: si el número y la letra no
 * coinciden, la factura impresa es inconsistente con el XML.
 *
 * SIN ACENTOS a propósito. En mayúsculas el español suele prescindir de ellos,
 * y así se imprime igual en una térmica CP437 que en pantalla, sin depender de
 * que la fuente o el códec conserven la tilde.
 */
import { aPesos, type Centavos } from "../comun/dinero.js";

const UNIDADES = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const ESPECIALES = [
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE",
  "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
];
const VEINTI = [
  "VEINTE", "VEINTIUN", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO",
  "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = [
  "", "", "", "TREINTA", "CUARENTA", "CINCUENTA",
  "SESENTA", "SETENTA", "OCHENTA", "NOVENTA",
];
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

/**
 * Escribe 1..999 en palabras, ya apocopado ("UN", no "UNO").
 *
 * La apócope es obligatoria en el uso monetario: se dice "UN PESO", "VEINTIUN
 * PESOS", "CIENTO UN PESOS" — nunca "UNO".
 */
function tresCifras(n: number): string {
  if (n === 100) return "CIEN";

  const centena = Math.floor(n / 100);
  const resto = n % 100;

  const partes: string[] = [];
  if (centena > 0) partes.push(CENTENAS[centena]!);

  if (resto >= 1 && resto <= 9) {
    partes.push(UNIDADES[resto]!);
  } else if (resto >= 10 && resto <= 19) {
    partes.push(ESPECIALES[resto - 10]!);
  } else if (resto >= 20 && resto <= 29) {
    partes.push(VEINTI[resto - 20]!);
  } else if (resto >= 30) {
    const decena = DECENAS[Math.floor(resto / 10)]!;
    const unidad = resto % 10;
    partes.push(unidad === 0 ? decena : `${decena} Y ${UNIDADES[unidad]}`);
  }

  return partes.join(" ");
}

/** Escribe un entero 0..999,999,999 en palabras. */
export function enLetras(n: number): string {
  if (n === 0) return "CERO";

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  if (millones === 1) partes.push("UN MILLON");
  else if (millones > 1) partes.push(`${tresCifras(millones)} MILLONES`);

  if (miles === 1) partes.push("MIL");
  else if (miles > 1) partes.push(`${tresCifras(miles)} MIL`);

  if (resto > 0) partes.push(tresCifras(resto));

  return partes.join(" ");
}

/**
 * El total en letra para la representación impresa.
 *
 * Ej.: `pesos(1160)` → "MIL CIENTO SESENTA PESOS 00/100 M.N.".
 *
 * Los centavos van como fracción sobre 100, no en palabras: es lo que exige el
 * formato del SAT y lo que evita ambigüedad ("cincuenta centavos" vs "50/100").
 */
export function importeConLetra(monto: Centavos): string {
  const pesosExactos = aPesos(monto);
  const entero = Math.floor(Math.abs(pesosExactos));
  const centavos = Math.round((Math.abs(pesosExactos) - entero) * 100);

  // El redondeo de centavos puede empujar a 100: eso es un peso más.
  const [enteroFinal, centavosFinal] =
    centavos === 100 ? [entero + 1, 0] : [entero, centavos];

  const moneda = enteroFinal === 1 ? "PESO" : "PESOS";
  const cc = String(centavosFinal).padStart(2, "0");
  return `${enLetras(enteroFinal)} ${moneda} ${cc}/100 M.N.`;
}
