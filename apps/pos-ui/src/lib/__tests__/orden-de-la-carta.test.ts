/**
 * «ORDENAR» EN LA CARTA (1.5.6): la única lista donde ordenar no es una vista.
 *
 * Decisión de Gonzalo: en Cocina → Menú, ordenar las categorías o los platillos
 * de una categoría cambia el orden en que los ven los meseros en la caja, en
 * todas las terminales. Aquí se prueba el recorrido que hace la pantalla al
 * confirmar —la propuesta de `orden-de-la-carta.ts` y el store del menú— contra
 * la carta de demostración de verdad, y que el cambio sale por el mismo camino
 * que cualquier otro cambio de la carta: guardado, con versión nueva y
 * publicado al resto del local.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { productosDeCategoria, type MenuLocal } from "@motrest/dominio";
import { menu } from "../menu.svelte";
import {
  ORDEN_DE_LA_CARTA,
  ordenesDeCategorias,
  ordenesDeProductos,
  propuesta,
} from "../modulos/cocina/orden-de-la-carta";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

/** Lo que se publicó al resto del local desde que empezó la prueba. */
const publicados: MenuLocal[] = [];

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
  // Se escucha lo que el store manda a replicar. Vitest aísla cada archivo de
  // pruebas, así que cambiar aquí el cartero no afecta a ninguna otra.
  menu.alPublicar((m) => publicados.push(m));
});

const opcionCat = (id: string) => ordenesDeCategorias().find((o) => o.id === id)!;
const opcionProd = (id: string) => ordenesDeProductos().find((o) => o.id === id)!;

/** Una categoría de la carta con al menos tres platillos, para que ordenar se note. */
function categoriaConVarios() {
  const g = menu.porCategoria.find((x) => x.productos.length >= 3);
  if (!g) throw new Error("La carta de demostración no tiene una categoría con tres platillos");
  return g;
}

describe("las opciones que ofrece la carta", () => {
  it("la primera, y la de siempre, es «Orden de la carta»", () => {
    expect(ordenesDeCategorias()[0]?.id).toBe(ORDEN_DE_LA_CARTA);
    expect(ordenesDeProductos()[0]?.id).toBe(ORDEN_DE_LA_CARTA);
    expect(ordenesDeCategorias()[0]?.etiqueta).toBe("Orden de la carta");
  });

  it("los platillos se pueden ordenar por el precio de la carta, con el IVA dentro", () => {
    const g = categoriaConVarios();
    const p = propuesta(g.productos, opcionProd("precio-sube"));
    const precios = p.lista.map((x) => x.impuesto.total);
    expect(precios).toEqual([...precios].sort((a, b) => a - b));
  });

  it("«Orden de la carta» no propone ningún cambio", () => {
    expect(propuesta(menu.categorias, opcionCat(ORDEN_DE_LA_CARTA)).cambia).toBe(false);
  });
});

describe("confirmar reescribe la carta de todo el local", () => {
  it("las categorías quedan de la Z a la A, con versión nueva y publicadas", () => {
    const antes = menu.menu!.version;
    const enviados = publicados.length;

    const p = propuesta(menu.categorias, opcionCat("za"));
    expect(p.cambia).toBe(true);
    expect(menu.ordenarCategorias(p.ids).ok).toBe(true);

    // `menu.categorias` es lo que pinta la caja en sus pestañas.
    expect(menu.categorias.map((c) => c.id)).toEqual(p.ids);
    expect(menu.menu!.version).toBe(antes + 1);
    expect(publicados).toHaveLength(enviados + 1);
    expect(publicados.at(-1)?.version).toBe(antes + 1);
  });

  it("pedir el orden que ya tiene no gasta una versión ni manda nada", () => {
    const antes = menu.menu!.version;
    const enviados = publicados.length;

    const p = propuesta(menu.categorias, opcionCat("za"));
    expect(p.cambia).toBe(false);
    expect(menu.ordenarCategorias(p.ids).ok).toBe(true);

    expect(menu.menu!.version).toBe(antes);
    expect(publicados).toHaveLength(enviados);
  });

  it("los platillos de una categoría quedan por precio en la pestaña de la caja", () => {
    const g = categoriaConVarios();
    const antes = menu.menu!.version;

    const p = propuesta(g.productos, opcionProd("precio-baja"));
    expect(menu.ordenarProductos(g.categoria.id, p.ids).ok).toBe(true);

    // La misma función con que la caja arma la pestaña (solo los disponibles).
    const enLaCaja = productosDeCategoria(menu.index, g.categoria.id).map((x) => x.id);
    expect(enLaCaja).toEqual(p.ids.filter((id) => enLaCaja.includes(id)));
    expect(menu.menu!.version).toBe(antes + 1);
  });

  it("sin permiso para editar la carta, no se toca y se dice por qué", () => {
    const antes = menu.menu!.version;
    sesion.cerrarSesion();

    const r = menu.ordenarCategorias([...menu.categorias].reverse().map((c) => c.id));
    expect(r.ok).toBe(false);
    expect(r.problemas[0]?.mensaje).toMatch(/orden de la carta/);
    expect(menu.menu!.version).toBe(antes);
  });
});
