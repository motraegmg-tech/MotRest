/** Formateo de moneda, porcentajes y hora para la UI (locale es-MX). */
import { aPesos, esPeriodoDiario, limitesDelPeriodo, periodoValido, type Centavos } from "@motrest/dominio";

/**
 * El periodo de una factura global, en palabras: «septiembre de 2026» o
 * «martes 23 de septiembre de 2026». Lo que no tenga forma de periodo se deja
 * como llegó, en vez de pintar «Invalid Date».
 */
export function periodoLegible(periodo: string): string {
  if (esPeriodoDiario(periodo)) {
    return new Date(limitesDelPeriodo(periodo).desde).toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (!periodoValido(periodo)) return periodo;
  return new Date(limitesDelPeriodo(periodo).desde).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

const dinero = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

const reloj = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Formatea centavos como pesos mexicanos: 24900 → "$249.00". */
export function mxn(monto: Centavos): string {
  return dinero.format(aPesos(monto));
}

/** Formatea una fracción (0..1) como porcentaje: 0.682 → "68.2%". */
export function pct(fraccion: number): string {
  return `${(fraccion * 100).toFixed(1)}%`;
}

/**
 * Formatea un epoch (ms) como hora local del dispositivo: → "20:12".
 *
 * Sirve para mostrar CUÁNDO ocurrió algo: la hora que quedó sellada en el
 * evento. La aplicación no pinta un reloj propio — la hora actual la da el
 * sistema operativo de cada máquina (ADR-17).
 */
const calendario = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" });

export function hora(ts: number): string {
  return reloj.format(new Date(ts));
}

/** El día de un hecho: «12 sep». Para listas que abarcan varias jornadas. */
export function dia(ts: number): string {
  return calendario.format(new Date(ts));
}
