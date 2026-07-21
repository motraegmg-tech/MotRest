/**
 * Validación de RFC mexicano.
 *
 * Persona moral: 3 letras + 6 dígitos de fecha + 3 de homoclave (12).
 * Persona física: 4 letras + 6 dígitos de fecha + 3 de homoclave (13).
 *
 * Se valida forma y fecha; el dígito verificador se omite a propósito porque el
 * SAT lo calcula con una tabla que cambia y rechazar un RFC válido sería peor
 * que aceptar uno mal escrito: el PAC lo verificará al timbrar.
 */

const RFC_MORAL = /^[A-ZÑ&]{3}[0-9]{6}[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$/;

export type TipoPersona = "moral" | "fisica";

export function normalizarRfc(rfc: string): string {
  return rfc.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** ¿La fecha embebida en el RFC existe? (posiciones varían por tipo). */
function fechaValida(rfc: string, desde: number): boolean {
  const anio = Number(rfc.slice(desde, desde + 2));
  const mes = Number(rfc.slice(desde + 2, desde + 4));
  const dia = Number(rfc.slice(desde + 4, desde + 6));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;

  // Se prueba contra ambos siglos: el RFC no lleva el siglo.
  for (const siglo of [1900, 2000]) {
    const f = new Date(siglo + anio, mes - 1, dia);
    if (f.getMonth() === mes - 1 && f.getDate() === dia) return true;
  }
  return false;
}

export function tipoPersonaDe(rfc: string): TipoPersona | null {
  const limpio = normalizarRfc(rfc);
  if (RFC_MORAL.test(limpio)) return "moral";
  if (RFC_FISICA.test(limpio)) return "fisica";
  return null;
}

export function rfcValido(rfc: string): boolean {
  const limpio = normalizarRfc(rfc);
  const tipo = tipoPersonaDe(limpio);
  if (!tipo) return false;
  return fechaValida(limpio, tipo === "moral" ? 3 : 4);
}

/** Mensaje de error legible, o null si el RFC es válido. */
export function problemaRfc(rfc: string): string | null {
  const limpio = normalizarRfc(rfc);
  if (limpio.length === 0) return "Escribe el RFC";
  if (limpio.length !== 12 && limpio.length !== 13) {
    return "El RFC debe tener 12 dígitos (empresa) o 13 (persona física)";
  }
  if (!tipoPersonaDe(limpio)) return "El RFC tiene un formato inválido";
  if (!rfcValido(limpio)) return "La fecha dentro del RFC no existe";
  return null;
}

/** Código postal mexicano: cinco dígitos. */
export function codigoPostalValido(cp: string): boolean {
  return /^[0-9]{5}$/.test(cp.trim());
}
