/**
 * LAS CATEGORÍAS QUE TRAE LA CARTA PEGADA.
 *
 * El importador pregunta, categoría por categoría, si lo que se vende ahí **se
 * vende tal cual** para crear cada producto ya vinculado a su propio insumo. Esa
 * pregunta no se podía hacer: `categorias` trae solo las que hay que CREAR, así
 * que un local que ya tiene «Bebidas» en su carta —el que más lo necesita,
 * porque lleva meses operando— se quedaba sin poder marcarla.
 */
import { describe, expect, it } from "vitest";
import { interpretarCarta } from "../catalogo/importar.js";

const CARTA = [
  "Pizzas",
  "Margarita | 249 | 62",
  "Pepperoni | 269 | 71",
  "Bebidas",
  "Coca-Cola 600 ml | 45 | 18",
  "Agua 1 L | 35",
].join("\n");

describe("las categorías detectadas en la carta pegada", () => {
  it("trae también las que ya existen, no solo las nuevas", () => {
    const r = interpretarCarta(CARTA, { categoriasExistentes: ["Bebidas"] });

    expect(r.categorias).toEqual(["Pizzas"]);
    expect(r.categorias_detectadas.map((c) => c.nombre)).toEqual(["Pizzas", "Bebidas"]);
    expect(r.categorias_detectadas.map((c) => c.nueva)).toEqual([true, false]);
  });

  it("cuenta cuántas líneas caen en cada una", () => {
    const r = interpretarCarta(CARTA);
    expect(r.categorias_detectadas.map((c) => c.lineas)).toEqual([2, 2]);
  });

  /*
   * El costo de la línea es lo que cuesta COMPRAR la pieza, y para algo que se
   * vende tal cual es el costo de su insumo. Si falta, el insumo nace en $0: el
   * valor del almacén no cuenta lo que hay en el refrigerador. Se avisa en la
   * previa, y para avisarlo hay que saber cuántas son.
   */
  it("y cuántas de esas líneas vienen sin costo", () => {
    const r = interpretarCarta(CARTA);
    const bebidas = r.categorias_detectadas.find((c) => c.nombre === "Bebidas");

    expect(bebidas?.sin_costo).toBe(1); // el agua
    expect(r.categorias_detectadas.find((c) => c.nombre === "Pizzas")?.sin_costo).toBe(0);
  });

  it("una sección sin nada debajo no se ofrece: marcar el vacío no es una pregunta", () => {
    const r = interpretarCarta(["Postres", "Bebidas", "Limonada | 45 | 8"].join("\n"));

    // Postres sigue estando entre las que se van a crear —el importador de
    // siempre la da de alta— pero no entre las que se pueden marcar.
    expect(r.categorias).toContain("Postres");
    expect(r.categorias_detectadas.map((c) => c.nombre)).toEqual(["Bebidas"]);
  });

  it("una línea con error no cuenta para su categoría", () => {
    const r = interpretarCarta(
      ["Bebidas", "Limonada | 45 | 8", "Mezcal | precio a consultar"].join("\n"),
    );

    expect(r.errores).toBe(1);
    expect(r.categorias_detectadas[0]?.lineas).toBe(1);
  });
});
