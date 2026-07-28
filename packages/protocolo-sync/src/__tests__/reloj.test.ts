/**
 * Desfase de reloj entre una terminal y el Hub.
 *
 * Importa porque los eventos se sellan con el reloj del propio dispositivo
 * (ADR-17): una tablet con la hora mal puesta no da un error, da números
 * equivocados que parecen buenos —ventas en otra jornada, fuera del corte de
 * caja, y un patrón falso para el pronóstico—.
 */
import { describe, expect, it } from "vitest";
import { DESFASE_TOLERADO_MS, desfaseDeReloj } from "../protocolo.js";

/** Un viaje de red instantáneo, para aislar el efecto del reloj. */
function sinViaje(tsHub: number, tsPropio: number): number {
  return desfaseDeReloj(tsHub, tsPropio, tsPropio);
}

describe("medición", () => {
  it("relojes iguales dan cero", () => {
    expect(sinViaje(1_000_000, 1_000_000)).toBe(0);
  });

  it("una terminal adelantada da positivo", () => {
    // La tablet cree que son las 10:05 y en el Hub son las 10:00.
    expect(sinViaje(1_000_000, 1_300_000)).toBe(300_000);
  });

  it("una terminal atrasada da negativo", () => {
    expect(sinViaje(1_300_000, 1_000_000)).toBe(-300_000);
  });

  /*
   * Sin descontar el viaje, una red lenta se vería como un reloj adelantado y
   * el aviso saltaría en locales con wifi mala, que es donde menos falta hace
   * un aviso falso.
   */
  it("una red lenta no se confunde con un reloj mal puesto", () => {
    const tsHub = 1_000_000;
    // El ida y vuelta tardó 4 s; los relojes están en hora.
    const desfase = desfaseDeReloj(tsHub, 998_000, 1_002_000);
    expect(desfase).toBe(0);
  });

  it("con red lenta sigue detectando un reloj de verdad desfasado", () => {
    // 4 s de viaje, pero la tablet va 10 minutos adelantada.
    const desfase = desfaseDeReloj(1_000_000, 1_598_000, 1_602_000);
    expect(desfase).toBe(600_000);
    expect(Math.abs(desfase)).toBeGreaterThan(DESFASE_TOLERADO_MS);
  });
});

describe("umbral", () => {
  it("tolera el desfase normal de un equipo cualquiera", () => {
    // Medio minuto: ningún reloj de consumo está mejor que esto.
    expect(Math.abs(sinViaje(1_000_000, 1_030_000))).toBeLessThan(DESFASE_TOLERADO_MS);
  });

  it("no tolera lo que ya mueve una venta de jornada", () => {
    // Tres horas: una venta de la noche caería en otro día.
    expect(Math.abs(sinViaje(1_000_000, 1_000_000 + 3 * 3600_000)))
      .toBeGreaterThan(DESFASE_TOLERADO_MS);
  });
});
