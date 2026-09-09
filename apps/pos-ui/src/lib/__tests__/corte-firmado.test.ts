/**
 * El corte de caja va FIRMADO, o no sale.
 *
 * ## El defecto que estas pruebas cierran
 *
 * Rodizio operó meses con **dos aperturas de caja y cero cierres** en la base
 * del Hub. La primera hipótesis —que nadie se acuerda de cerrar a las dos de la
 * mañana— era falsa: el cajero sí cerraba y la pantalla decía que había
 * cerrado. Lo que pasaba es que el evento salía a nombre de `sistema`, que no
 * está en el padrón, y el Hub lo rechazaba por permisos.
 *
 * `abrir()` sí fijaba el actor justo antes de emitir; `cerrar()` no lo hacía y
 * confiaba en que lo hubiera dejado puesto la apertura. Dentro de la misma
 * sesión del navegador funcionaba. Pero entre abrir a las once de la mañana y
 * cerrar a las dos de la madrugada el POS se recarga, el store se rehidrata
 * desde los eventos y el contexto de la fábrica vuelve a `sistema`.
 *
 * De ahí que fueran justamente las aperturas las que sí llegaban al Hub.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { pesos, proyectarSesiones, type EventoCaja } from "@motrest/dominio";
import { caja } from "../caja.svelte";

const CAJERO = "usr-marisol";

/** Los eventos que el store tiene guardados, leídos como los vería el Hub. */
function emitidos(): EventoCaja[] {
  // `sesiones` proyecta, así que para ver los eventos crudos se rehidrata a
  // partir de lo que el store expone y se comparan sus autores.
  return (caja as unknown as { eventos: EventoCaja[] }).eventos;
}

describe("ningún evento de caja sale a nombre de «sistema»", () => {
  beforeEach(() => {
    caja.hidratar([]);
  });

  it("la apertura queda firmada por el cajero", () => {
    expect(caja.abrir(CAJERO, pesos(1_500)).ok).toBe(true);
    expect(emitidos().every((e) => e.empleado_id === CAJERO)).toBe(true);
  });

  it("EL CIERRE TAMBIÉN, aunque el POS se haya recargado entre medias", async () => {
    expect(caja.abrir(CAJERO, pesos(1_500)).ok).toBe(true);
    const abiertos = [...emitidos()];

    /*
     * Se simula la recarga: el store se rehidrata desde los eventos guardados y
     * el contexto de la fábrica vuelve a su valor inicial. Es exactamente lo que
     * ocurre cada noche entre la apertura y el cierre.
     */
    caja.hidratar(abiertos);

    const r = await caja.cerrar(pesos(1_500), "Marisol", CAJERO);
    expect(r.ok).toBe(true);

    const cierre = emitidos().find((e) => e.tipo === "caja_cerrada");
    expect(cierre).toBeDefined();
    // Antes de este arreglo, aquí decía "sistema" y el Hub lo tiraba.
    expect(cierre!.empleado_id).toBe(CAJERO);
  });

  it("sin sesión iniciada NO se cierra: se avisa en vez de emitir un evento condenado", async () => {
    caja.abrir(CAJERO, pesos(1_500));
    caja.hidratar([...emitidos()]);

    const r = await caja.cerrar(pesos(1_500), "Cajero", undefined);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("Inicia sesión");
    // Y no se emitió nada: un corte que el Hub va a rechazar es peor que uno
    // que no se dejó hacer, porque la pantalla diría que sí se hizo.
    expect(emitidos().some((e) => e.tipo === "caja_cerrada")).toBe(false);
  });

  it("el movimiento de efectivo tampoco: el Hub también lo revalida", () => {
    caja.abrir(CAJERO, pesos(1_500));
    caja.hidratar([...emitidos()]);

    const sinFirma = caja.movimiento("retiro", pesos(300), "Cambio", undefined);
    expect(sinFirma.ok).toBe(false);

    const firmado = caja.movimiento("retiro", pesos(300), "Cambio", CAJERO);
    expect(firmado.ok).toBe(true);
    expect(
      emitidos().find((e) => e.tipo === "movimiento_efectivo")!.empleado_id,
    ).toBe(CAJERO);
  });

  it("el turno queda cerrado de verdad en la proyección", async () => {
    caja.abrir(CAJERO, pesos(1_000));
    caja.hidratar([...emitidos()]);
    await caja.cerrar(pesos(1_000), "Marisol", CAJERO);

    const sesiones = proyectarSesiones(emitidos());
    expect(sesiones[0]?.cerrada).toBe(true);
    expect(caja.activa).toBeUndefined();
  });
});
