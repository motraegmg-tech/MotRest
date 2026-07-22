/** Formateo de moneda, porcentajes y hora para la UI (locale es-MX). */
import { aPesos, type Centavos } from "@motrest/dominio";

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
export function hora(ts: number): string {
  return reloj.format(new Date(ts));
}
