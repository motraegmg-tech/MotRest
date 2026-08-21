/**
 * La postura de la pantalla, y el menú que se pliega cuando está de pie.
 *
 * Lo que importa probar es que REACCIONA: una tableta gira a media comanda, y
 * un menú que se quedara en la postura de arranque taparía media pantalla de
 * venta o dejaría el POS sin navegación. Y que al volver a horizontal el menú
 * no quede marcado como abierto, o reaparecería desplegado al girar otra vez.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Un `matchMedia` de mentira al que se le puede cambiar la respuesta. */
function montarMatchMedia(inicial: boolean) {
  const oyentes = new Set<(e: { matches: boolean }) => void>();
  const lista = {
    matches: inicial,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { oyentes.add(f); },
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => { oyentes.delete(f); },
  };
  vi.stubGlobal("window", {
    matchMedia: () => lista,
  });
  return {
    /** Simula el giro del aparato. */
    girar(aVertical: boolean) {
      lista.matches = aVertical;
      for (const f of oyentes) f({ matches: aVertical });
    },
    get oyentes() { return oyentes.size; },
  };
}

/** El módulo guarda estado, así que cada prueba necesita el suyo. */
async function cargarOrientacion() {
  vi.resetModules();
  return (await import("../nav/orientacion.svelte")).orientacion;
}

describe("detectar la postura", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("arranca en horizontal cuando la pantalla está acostada", async () => {
    montarMatchMedia(false);
    const o = await cargarOrientacion();
    o.escuchar();
    expect(o.vertical).toBe(false);
  });

  it("arranca en vertical cuando la pantalla está de pie", async () => {
    montarMatchMedia(true);
    const o = await cargarOrientacion();
    o.escuchar();
    expect(o.vertical).toBe(true);
  });

  /*
   * LA PRUEBA QUE JUSTIFICA EL MÓDULO.
   * Sin esto bastaría una media query de CSS.
   */
  it("cambia sola cuando giran la tableta durante el servicio", async () => {
    const medio = montarMatchMedia(false);
    const o = await cargarOrientacion();
    o.escuchar();

    expect(o.vertical).toBe(false);
    medio.girar(true);
    expect(o.vertical).toBe(true);
    medio.girar(false);
    expect(o.vertical).toBe(false);
  });

  it("deja de escuchar cuando se desmonta", async () => {
    const medio = montarMatchMedia(false);
    const o = await cargarOrientacion();
    const baja = o.escuchar();

    expect(medio.oyentes).toBe(1);
    baja();
    expect(medio.oyentes).toBe(0);
  });

  it("sin navegador no revienta: se asume horizontal", async () => {
    vi.stubGlobal("window", undefined);
    const o = await cargarOrientacion();
    const baja = o.escuchar();
    expect(o.vertical).toBe(false);
    expect(() => baja()).not.toThrow();
  });
});

describe("el menú plegable", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("nace cerrado", async () => {
    montarMatchMedia(true);
    const o = await cargarOrientacion();
    expect(o.menuAbierto).toBe(false);
  });

  it("abre, alterna y cierra", async () => {
    montarMatchMedia(true);
    const o = await cargarOrientacion();

    o.abrirMenu();
    expect(o.menuAbierto).toBe(true);
    o.alternarMenu();
    expect(o.menuAbierto).toBe(false);
    o.alternarMenu();
    expect(o.menuAbierto).toBe(true);
    o.cerrarMenu();
    expect(o.menuAbierto).toBe(false);
  });

  /*
   * Al volver a horizontal el menú deja de flotar y vuelve a estar fijo. Si
   * siguiera marcado como abierto, al girar otra vez a vertical aparecería
   * desplegado sin que nadie lo pidiera, encima de la comanda.
   */
  it("volver a horizontal lo deja cerrado", async () => {
    const medio = montarMatchMedia(true);
    const o = await cargarOrientacion();
    o.escuchar();

    o.abrirMenu();
    expect(o.menuAbierto).toBe(true);

    medio.girar(false);
    expect(o.menuAbierto).toBe(false);

    // Y al volver a ponerla de pie, sigue cerrado.
    medio.girar(true);
    expect(o.menuAbierto).toBe(false);
  });
});
