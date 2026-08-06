/** Formato de dinero, fechas y plazos para el panel. */
import { aPesos, type Centavos } from "@motrest/dominio";

export function dinero(centavos: Centavos): string {
  return aPesos(centavos).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function fecha(ts: number): string {
  return new Date(ts).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * "hace 3 h", "hace 2 días".
 *
 * En horas hasta el día, y en días después. Un "hace 47 h" obliga a dividir
 * mentalmente, y esta cifra se lee de reojo para decidir si algo está caído.
 */
export function desde(ts: number, ahora = Date.now()): string {
  const minutos = Math.floor((ahora - ts) / 60_000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

/** "en 5 días", "hoy", "hace 2 días". */
export function plazo(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias > 0) return `en ${dias} ${dias === 1 ? "día" : "días"}`;
  const vencidos = -dias;
  return `hace ${vencidos} ${vencidos === 1 ? "día" : "días"}`;
}
