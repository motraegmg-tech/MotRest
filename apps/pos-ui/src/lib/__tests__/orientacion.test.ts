/**
 * La postura de la pantalla, y el menú que se pliega cuando está de pie.
 *
 * Lo que importa probar es que REACCIONA: una tableta gira a media comanda, y
 * un menú que se quedara en la postura de arranque taparía media pantalla de
 * venta o dejaría el POS sin navegación. Y que al volver a horizontal el menú
 * no quede marcado como abierto, o reaparecería desplegado al girar otra vez.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Oyente = (e: { matches: boolean }) => void;

/** Una consulta de mentira, con sus oyentes. */
function crearLista(inicial: boolean) {
  const oyentes = new Set<Oyente>();
  const lista = {
    matches: inicial,
    addEventListener: (_: string, f: Oyente) => { oyentes.add(f); },
    removeEventListener: (_: string, f: Oyente) => { oyentes.delete(f); },
  };
  return {
    lista,
    oyentes,
    cambiar(valor: boolean) {
      lista.matches = valor;
      for (const f of oyentes) f({ matches: valor });
    },
  };
}

/**
 * Un `matchMedia` de mentira al que se le puede cambiar la respuesta.
 *
 * Distingue las dos consultas del módulo: la de TELÉFONO (la que pregunta por
 * 767 px) y la de postura, que es cualquier otra.
 */
function montarMatchMedia(inicial: boolean, telefonoInicial = false) {
  const postura = crearLista(inicial);
  const telefono = crearLista(telefonoInicial);
  vi.stubGlobal("window", {
    matchMedia: (consulta: string) => (consulta.includes("767px") ? telefono.lista : postura.lista),
  });
  return {
    /** Simula el giro del aparato. */
    girar(aVertical: boolean) {
      postura.cambiar(aVertical);
    },
    /** Simula pasar a un ancho de teléfono, o salir de él. */
    ponerTelefono(esTelefono: boolean) {
      telefono.cambiar(esTelefono);
    },
    get oyentes() { return postura.oyentes.size + telefono.oyentes.size; },
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

    // Dos: la postura y el teléfono.
    expect(medio.oyentes).toBe(2);
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

/*
 * El teléfono es aparte de la postura: una tableta de pie es «vertical» y en
 * ella la barra superior cabe entera; solo en un teléfono se reduce a iconos.
 */
describe("detectar el teléfono", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("una tableta de pie es vertical pero no teléfono", async () => {
    montarMatchMedia(true, false);
    const o = await cargarOrientacion();
    o.escuchar();
    expect(o.vertical).toBe(true);
    expect(o.telefono).toBe(false);
  });

  it("arranca como teléfono y sigue al cambio de ancho", async () => {
    const medio = montarMatchMedia(true, true);
    const o = await cargarOrientacion();
    o.escuchar();
    expect(o.telefono).toBe(true);

    medio.ponerTelefono(false);
    expect(o.telefono).toBe(false);
    medio.ponerTelefono(true);
    expect(o.telefono).toBe(true);
  });

  it("sin navegador no es teléfono", async () => {
    vi.stubGlobal("window", undefined);
    const o = await cargarOrientacion();
    o.escuchar();
    expect(o.telefono).toBe(false);
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
