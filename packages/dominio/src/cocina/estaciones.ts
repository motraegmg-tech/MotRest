/**
 * Estaciones de cocina.
 *
 * Cada estación tiene sus propios tiempos: una barra sirve en dos minutos y un
 * horno tarda quince. Un solo umbral para todo el restaurante haría que la
 * pantalla estuviera siempre en rojo o siempre en verde — inútil en ambos casos.
 */
import type { ID } from "../comun/ids.js";

export interface EstacionKds {
  id: ID;
  nombre: string;
  orden: number;
  /** A partir de aquí el platillo se marca en advertencia (ámbar). */
  minutos_objetivo: number;
  /** A partir de aquí se marca demorado (rojo). */
  minutos_limite: number;
}

export type Semaforo = "normal" | "advertencia" | "demorado" | "listo";

export function semaforoDe(
  minutos: number,
  estacion: EstacionKds | undefined,
  listo: boolean,
): Semaforo {
  if (listo) return "listo";
  const objetivo = estacion?.minutos_objetivo ?? 10;
  const limite = estacion?.minutos_limite ?? 18;
  if (minutos >= limite) return "demorado";
  if (minutos >= objetivo) return "advertencia";
  return "normal";
}

/** El semáforo más urgente de un conjunto: el ticket se pinta por su peor platillo. */
export function semaforoPeor(semaforos: readonly Semaforo[]): Semaforo {
  if (semaforos.includes("demorado")) return "demorado";
  if (semaforos.includes("advertencia")) return "advertencia";
  if (semaforos.length > 0 && semaforos.every((s) => s === "listo")) return "listo";
  return "normal";
}

export function etiquetaSemaforo(semaforo: Semaforo): string {
  switch (semaforo) {
    case "normal":
      return "En tiempo";
    case "advertencia":
      return "Se está tardando";
    case "demorado":
      return "Demorado";
    case "listo":
      return "Listo";
  }
}

/** Estaciones de arranque de la demostración. */
export function estacionesPorDefecto(): EstacionKds[] {
  return [
    { id: "est-horno", nombre: "Horno", orden: 1, minutos_objetivo: 12, minutos_limite: 18 },
    { id: "est-pastas", nombre: "Pastas", orden: 2, minutos_objetivo: 10, minutos_limite: 15 },
    { id: "est-parrilla", nombre: "Parrilla", orden: 3, minutos_objetivo: 14, minutos_limite: 20 },
    { id: "est-fria", nombre: "Fría", orden: 4, minutos_objetivo: 6, minutos_limite: 10 },
    { id: "est-barra", nombre: "Barra", orden: 5, minutos_objetivo: 3, minutos_limite: 6 },
    { id: "est-postres", nombre: "Postres", orden: 6, minutos_objetivo: 6, minutos_limite: 10 },
  ];
}
