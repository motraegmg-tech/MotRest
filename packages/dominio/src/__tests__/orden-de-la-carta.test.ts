/**
 * ORDENAR LA CARTA (1.5.6).
 *
 * En el resto de la caja, «Ordenar» cambia solo la vista. En la carta no: por
 * decisión de Gonzalo, el orden elegido es el que ven los meseros en la caja.
 * Por eso se reescribe el `orden` guardado y sube la versión, que es lo que
 * hace viajar la carta al Hub y a las demás terminales (`catalogoMasNuevo`
 * compara versiones). Si la versión no subiera, el cambio se quedaría en la
 * terminal donde se hizo y las demás seguirían con el orden viejo.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { IVA_16 } from "../comun/impuestos.js";
import { reordenarCategorias, reordenarProductos, type MenuLocal } from "../catalogo/menu.js";
import { indexar, productosDeCategoria } from "../catalogo/productos.js";

function producto(id: string, nombre: string, categoria_id: string, orden: number) {
  return {
    id,
    nombre,
    categoria_id,
    costo: pesos(10),
    precio: pesos(100),
    impuesto_id: IVA_16.id,
    disponible: true,
    orden,
  };
}

function carta(): MenuLocal {
  return {
    version: 7,
    updated_at: 1_700_000_000_000,
    categorias: [
      { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
      { id: "cat-bebidas", nombre: "Bebidas", orden: 2 },
      { id: "cat-pastas", nombre: "Pastas", orden: 3 },
    ],
    productos: [
      producto("p-marg", "Margherita", "cat-pizzas", 1),
      producto("p-hawa", "Hawaiana", "cat-pizzas", 2),
      producto("p-cuatro", "Cuatro quesos", "cat-pizzas", 3),
      producto("p-agua", "Agua", "cat-bebidas", 1),
      producto("p-cola", "Cola", "cat-bebidas", 2),
    ],
    recetas: [],
    impuestos: [IVA_16],
    grupos: [],
    insumos: [],
    estaciones: [],
  };
}

/** Las categorías como las pinta la caja: por su `orden`. */
const pestanas = (m: MenuLocal) =>
  [...m.categorias].sort((a, b) => a.orden - b.orden).map((c) => c.nombre);

/** Los platillos de una pestaña, con la MISMA función que usa la caja. */
const pestana = (m: MenuLocal, categoriaId: string) =>
  productosDeCategoria(indexar(m), categoriaId).map((p) => p.nombre);

describe("ordenar las categorías de la carta", () => {
  it("reescribe el orden guardado y sube la versión, para que viaje a las demás terminales", () => {
    const antes = carta();
    const despues = reordenarCategorias(antes, ["cat-bebidas", "cat-pastas", "cat-pizzas"]);

    expect(pestanas(despues)).toEqual(["Bebidas", "Pastas", "Pizzas"]);
    expect(despues.categorias.map((c) => c.orden).sort()).toEqual([1, 2, 3]);
    expect(despues.version).toBe(antes.version + 1);
    expect(despues.updated_at).toBeGreaterThan(antes.updated_at);
  });

  it("no toca la carta original: es una instantánea nueva", () => {
    const antes = carta();
    reordenarCategorias(antes, ["cat-pastas", "cat-bebidas", "cat-pizzas"]);
    expect(pestanas(antes)).toEqual(["Pizzas", "Bebidas", "Pastas"]);
    expect(antes.version).toBe(7);
  });

  it("si el orden pedido ya es el de la carta, no sube la versión: no hay nada que mandar", () => {
    const antes = carta();
    const despues = reordenarCategorias(antes, ["cat-pizzas", "cat-bebidas", "cat-pastas"]);
    expect(despues).toBe(antes);
  });

  it("una categoría que llegó mientras se confirmaba no se pierde: queda al final", () => {
    const antes = carta();
    // La propuesta se armó cuando solo había dos; «Pastas» no venía en ella.
    const despues = reordenarCategorias(antes, ["cat-bebidas", "cat-pizzas"]);
    expect(pestanas(despues)).toEqual(["Bebidas", "Pizzas", "Pastas"]);
  });

  it("ids repetidos o que ya no existen se ignoran", () => {
    const despues = reordenarCategorias(carta(), [
      "cat-borrada",
      "cat-pastas",
      "cat-pastas",
      "cat-pizzas",
      "cat-bebidas",
    ]);
    expect(pestanas(despues)).toEqual(["Pastas", "Pizzas", "Bebidas"]);
    expect(despues.categorias).toHaveLength(3);
  });

  it("repara de paso los huecos y los repetidos de una carta importada", () => {
    const conHuecos = {
      ...carta(),
      categorias: [
        { id: "cat-pizzas", nombre: "Pizzas", orden: 4 },
        { id: "cat-bebidas", nombre: "Bebidas", orden: 4 },
        { id: "cat-pastas", nombre: "Pastas", orden: 9 },
      ],
    };
    const despues = reordenarCategorias(conHuecos, ["cat-pastas", "cat-bebidas", "cat-pizzas"]);
    expect(despues.categorias.map((c) => [c.nombre, c.orden])).toEqual([
      ["Pastas", 1],
      ["Bebidas", 2],
      ["Pizzas", 3],
    ]);
  });
});

describe("ordenar los platillos de una categoría", () => {
  it("cambia el orden en que la caja enseña esa pestaña y sube la versión", () => {
    const antes = carta();
    const despues = reordenarProductos(antes, "cat-pizzas", ["p-cuatro", "p-hawa", "p-marg"]);

    expect(pestana(despues, "cat-pizzas")).toEqual(["Cuatro quesos", "Hawaiana", "Margherita"]);
    expect(despues.version).toBe(antes.version + 1);
  });

  it("los platillos de las demás categorías no se tocan", () => {
    const antes = carta();
    const despues = reordenarProductos(antes, "cat-pizzas", ["p-cuatro", "p-hawa", "p-marg"]);

    const bebidasAntes = antes.productos.filter((p) => p.categoria_id === "cat-bebidas");
    const bebidasDespues = despues.productos.filter((p) => p.categoria_id === "cat-bebidas");
    // La MISMA referencia: ni siquiera se copiaron.
    bebidasDespues.forEach((p, i) => expect(p).toBe(bebidasAntes[i]));
  });

  it("no mueve un platillo de categoría aunque su id venga en la lista", () => {
    const despues = reordenarProductos(carta(), "cat-pizzas", ["p-agua", "p-hawa"]);
    expect(pestana(despues, "cat-pizzas")).toEqual(["Hawaiana", "Margherita", "Cuatro quesos"]);
    expect(pestana(despues, "cat-bebidas")).toEqual(["Agua", "Cola"]);
    expect(despues.productos.find((p) => p.id === "p-agua")?.orden).toBe(1);
  });

  it("si ya estaban así, la carta vuelve tal cual", () => {
    const antes = carta();
    expect(reordenarProductos(antes, "cat-pizzas", ["p-marg", "p-hawa", "p-cuatro"])).toBe(antes);
  });

  it("el siguiente platillo que se dé de alta sigue quedando al final", () => {
    const despues = reordenarProductos(carta(), "cat-pizzas", ["p-cuatro", "p-hawa", "p-marg"]);
    const ordenes = despues.productos
      .filter((p) => p.categoria_id === "cat-pizzas")
      .map((p) => p.orden);
    // Numerados de corrido: el alta siguiente toma max + 1 y cae detrás.
    expect([...ordenes].sort()).toEqual([1, 2, 3]);
  });
});
