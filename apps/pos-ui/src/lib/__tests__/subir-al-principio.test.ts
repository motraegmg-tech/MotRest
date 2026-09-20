/**
 * Subir la vista cuando un botón de abajo abre algo arriba.
 *
 * Lo que se comprueba es QUÉ se sube. En MotRest la ventana no se desplaza: se
 * desplaza la `.seccion` de cada módulo o el cuerpo de un diálogo, así que un
 * `window.scrollTo` a secas no movería nada y el «Editar» seguiría pareciendo
 * roto. Y el cuándo: el contenedor se busca en el clic —el botón puede
 * desaparecer con él— y se sube en el cuadro siguiente, cuando lo que se abrió
 * ya tiene su alto.
 *
 * Las pruebas corren sin navegador, así que los elementos son de mentira: solo
 * lo que la utilidad mira de ellos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contenedorDesplazable, revelar, subirAlPrincipio } from "../subir";

interface Falso {
  parentElement: Falso | null;
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
  scrollTo: ReturnType<typeof vi.fn>;
}

/** Un elemento con su `overflow-y`, cuánto contenido tiene y cuánto se ve. */
function elemento(
  overflowY: string,
  contenido: number,
  visible: number,
  padre: Falso | null = null,
): Falso {
  return { parentElement: padre, overflowY, scrollHeight: contenido, clientHeight: visible, scrollTo: vi.fn() };
}

const comoElemento = (f: Falso | null) => f as unknown as Element | null;

let cuadros: FrameRequestCallback[] = [];
let menosMovimiento = false;
let ventana: { scrollTo: ReturnType<typeof vi.fn> };

/** Deja correr el cuadro siguiente, como haría el navegador. */
function pasarUnCuadro() {
  const pendientes = cuadros;
  cuadros = [];
  for (const f of pendientes) f(0);
}

beforeEach(() => {
  cuadros = [];
  menosMovimiento = false;
  ventana = { scrollTo: vi.fn() };
  vi.stubGlobal("getComputedStyle", (el: Falso) => ({ overflowY: el.overflowY }));
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    cuadros.push(f);
    return cuadros.length;
  });
  vi.stubGlobal("window", {
    scrollTo: (...args: unknown[]) => ventana.scrollTo(...args),
    matchMedia: () => ({ matches: menosMovimiento }),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("qué se sube", () => {
  it("la sección del módulo, no la ventana", () => {
    const seccion = elemento("auto", 3000, 800);
    const tarjeta = elemento("visible", 400, 400, seccion);
    const editar = elemento("visible", 30, 30, tarjeta);

    subirAlPrincipio(comoElemento(editar));
    pasarUnCuadro();

    expect(seccion.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(ventana.scrollTo).not.toHaveBeenCalled();
  });

  /*
   * Una lista con `overflow-y: auto` que no llega a desbordar no tiene nada que
   * subir. Si la búsqueda se quedara en ella, la sección de afuera —la que sí
   * se movió— seguiría abajo.
   */
  it("se salta un contenedor con scroll que no desborda", () => {
    const seccion = elemento("auto", 3000, 800);
    const lista = elemento("auto", 200, 300, seccion);
    const editar = elemento("visible", 30, 30, lista);

    subirAlPrincipio(comoElemento(editar));
    pasarUnCuadro();

    expect(lista.scrollTo).not.toHaveBeenCalled();
    expect(seccion.scrollTo).toHaveBeenCalledOnce();
  });

  it("dentro de un diálogo sube el diálogo, no la pantalla de detrás", () => {
    const seccion = elemento("auto", 3000, 800);
    const dialogo = elemento("scroll", 1200, 700, seccion);
    const opcion = elemento("visible", 60, 60, dialogo);

    subirAlPrincipio(comoElemento(opcion));
    pasarUnCuadro();

    expect(dialogo.scrollTo).toHaveBeenCalledOnce();
    expect(seccion.scrollTo).not.toHaveBeenCalled();
  });

  it("acepta la raíz de la pantalla, que es ella misma la que se desplaza", () => {
    const seccion = elemento("auto", 3000, 800);
    expect(contenedorDesplazable(comoElemento(seccion))).toBe(seccion);
  });

  it("sin nada que se desplace, sube la ventana", () => {
    const corta = elemento("auto", 500, 800);
    subirAlPrincipio(comoElemento(corta));
    pasarUnCuadro();
    expect(ventana.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    subirAlPrincipio(null);
    pasarUnCuadro();
    expect(ventana.scrollTo).toHaveBeenCalledTimes(2);
  });
});

describe("cuándo se sube", () => {
  it("en el cuadro siguiente, no en el mismo clic", () => {
    const seccion = elemento("auto", 3000, 800);

    subirAlPrincipio(comoElemento(seccion));
    expect(seccion.scrollTo).not.toHaveBeenCalled();

    pasarUnCuadro();
    expect(seccion.scrollTo).toHaveBeenCalledOnce();
  });

  /*
   * «Editar» cambia la lista por el formulario: para cuando llega el cuadro
   * siguiente, el botón pulsado ya no está en la página y no tiene ancestros.
   * Por eso el contenedor se busca en el clic.
   */
  it("aunque el botón pulsado ya no exista cuando toca subir", () => {
    const seccion = elemento("auto", 3000, 800);
    const editar = elemento("visible", 30, 30, seccion);

    subirAlPrincipio(comoElemento(editar));
    editar.parentElement = null;
    pasarUnCuadro();

    expect(seccion.scrollTo).toHaveBeenCalledOnce();
  });

  it("sin animación para quien pidió menos movimiento", () => {
    menosMovimiento = true;
    const seccion = elemento("auto", 3000, 800);

    subirAlPrincipio(comoElemento(seccion));
    pasarUnCuadro();

    expect(seccion.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});

/*
 * El caso contrario (regla de Gonzalo, 19-sep): lo que se abre queda DEBAJO,
 * fuera de cuadro. `revelar` va sobre el bloque que nace con el {#if}.
 */
describe("revelar lo que se abrió debajo", () => {
  function bloque(conectado = true) {
    return { isConnected: conectado, scrollIntoView: vi.fn() };
  }

  it("lo trae a la vista moviendo lo mínimo, en el cuadro siguiente", () => {
    const nodo = bloque();
    revelar(nodo as unknown as Element);
    // Todavía no: lo que se abrió aún no tiene su alto.
    expect(nodo.scrollIntoView).not.toHaveBeenCalled();
    pasarUnCuadro();
    expect(nodo.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("sin animación para quien pidió menos movimiento", () => {
    menosMovimiento = true;
    const nodo = bloque();
    revelar(nodo as unknown as Element);
    pasarUnCuadro();
    expect(nodo.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("no hace nada si se cerró en el mismo cuadro", () => {
    const nodo = bloque(false);
    revelar(nodo as unknown as Element);
    pasarUnCuadro();
    expect(nodo.scrollIntoView).not.toHaveBeenCalled();
  });
});
