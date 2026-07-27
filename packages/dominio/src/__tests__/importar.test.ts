/**
 * Importación de la carta.
 *
 * Se prueba contra lo que la gente PEGA de verdad: un copiado de Excel con
 * tabuladores, una lista con signos de pesos y miles con coma, y una carta
 * escrita por secciones. Si el importador solo tragara un CSV perfecto, el
 * restaurante seguiría capturando a mano.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { interpretarCarta, leerImporte } from "../catalogo/importar.js";

describe("leer importes escritos por personas", () => {
  it("acepta pesos, miles con coma y espacios", () => {
    expect(leerImporte("249")).toBe(pesos(249));
    expect(leerImporte("$249.00")).toBe(pesos(249));
    expect(leerImporte(" $1,249.50 ")).toBe(pesos(1249.5));
    expect(leerImporte("89.9")).toBe(pesos(89.9));
  });

  /*
   * Un precio ilegible es distinto de un precio de cero: cero es una decisión
   * (una cortesía), ilegible es un error que hay que señalar.
   */
  it("distingue lo ilegible del cero", () => {
    expect(leerImporte("0")).toBe(pesos(0));
    expect(leerImporte("")).toBeNull();
    expect(leerImporte("s/n")).toBeNull();
    expect(leerImporte("gratis")).toBeNull();
  });
});

describe("copiado de Excel", () => {
  const excel = [
    "Categoría\tProducto\tPrecio\tCosto",
    "Pizzas\tMargarita\t249\t62",
    "Pizzas\tPepperoni\t269\t71",
    "Bebidas\tLimonada\t45\t8",
  ].join("\n");

  it("salta el encabezado y da de alta el resto", () => {
    const r = interpretarCarta(excel);
    expect(r.altas).toBe(3);
    expect(r.errores).toBe(0);
    expect(r.lineas.map((l) => l.nombre)).toEqual(["Margarita", "Pepperoni", "Limonada"]);
  });

  it("junta las categorías nuevas, sin repetirlas", () => {
    expect(interpretarCarta(excel).categorias).toEqual(["Pizzas", "Bebidas"]);
  });

  it("no propone crear una categoría que ya existe", () => {
    const r = interpretarCarta(excel, { categoriasExistentes: ["pizzas"] });
    expect(r.categorias).toEqual(["Bebidas"]);
  });

  it("convierte los importes a centavos exactos", () => {
    const r = interpretarCarta(excel);
    expect(r.lineas[0]!.precio).toBe(pesos(249));
    expect(r.lineas[0]!.costo).toBe(pesos(62));
  });
});

describe("una carta escrita por secciones", () => {
  /* Así es como está escrita cualquier carta de restaurante. */
  const carta = [
    "PIZZAS",
    "Margarita | 249 | 62",
    "Pepperoni | 269 | 71",
    "POSTRES",
    "Tiramisú | 95 | 32",
  ].join("\n");

  it("arrastra la sección a los platillos que siguen", () => {
    const r = interpretarCarta(carta);
    expect(r.altas).toBe(3);
    expect(r.lineas.map((l) => l.categoria)).toEqual(["PIZZAS", "PIZZAS", "POSTRES"]);
  });

  it("registra las secciones como categorías a crear", () => {
    expect(interpretarCarta(carta).categorias).toEqual(["PIZZAS", "POSTRES"]);
  });
});

describe("separadores", () => {
  it("acepta comas", () => {
    const r = interpretarCarta("Pizzas,Margarita,249,62");
    expect(r.altas).toBe(1);
    expect(r.lineas[0]!.nombre).toBe("Margarita");
  });

  it("acepta punto y coma", () => {
    const r = interpretarCarta("Pizzas;Margarita;249;62");
    expect(r.lineas[0]!.precio).toBe(pesos(249));
  });
});

// --- Lo que se señala ----------------------------------------------------------------------

describe("errores que impiden dar de alta", () => {
  it("un precio ilegible", () => {
    const r = interpretarCarta("Pizzas|Margarita|precio a consultar");
    expect(r.errores).toBe(1);
    expect(r.lineas[0]!.detalle).toMatch(/no se entiende el precio/i);
  });

  it("un producto sin categoría ni sección previa", () => {
    const r = interpretarCarta("Margarita|249");
    expect(r.errores).toBe(1);
    expect(r.lineas[0]!.detalle).toMatch(/sin categoría/i);
  });

  it("un producto repetido dentro de la misma lista", () => {
    const r = interpretarCarta(["Pizzas|Margarita|249", "Pizzas|Margarita|259"].join("\n"));
    expect(r.altas).toBe(1);
    expect(r.errores).toBe(1);
    expect(r.lineas[1]!.detalle).toMatch(/repetido/i);
  });

  it("un precio negativo", () => {
    const r = interpretarCarta("Pizzas|Margarita|-50");
    expect(r.errores).toBe(1);
  });
});

describe("avisos que no impiden, pero hay que ver", () => {
  /*
   * Sin costo, el margen de ese platillo sale al 100 % y la ingeniería de menú
   * lo clasificaría como estrella. Un producto puede importarse así, pero el
   * usuario tiene que saberlo.
   */
  it("un platillo sin costo", () => {
    const r = interpretarCarta("Pizzas|Margarita|249");
    expect(r.avisos).toBe(1);
    expect(r.altas).toBe(1);
    expect(r.lineas[0]!.detalle).toMatch(/food cost/i);
  });

  it("vender por debajo del costo", () => {
    const r = interpretarCarta("Pizzas|Margarita|100|150");
    expect(r.avisos).toBe(1);
    expect(r.lineas[0]!.detalle).toMatch(/pérdida/i);
  });

  it("avisa cuando NINGUNA línea trae costo", () => {
    const r = interpretarCarta(["Pizzas|Margarita|249", "Pizzas|Pepperoni|269"].join("\n"));
    expect(r.sin_costos).toBe(true);
  });

  it("no lo avisa si al menos una trae costo", () => {
    const r = interpretarCarta(["Pizzas|Margarita|249|62", "Pizzas|Pepperoni|269"].join("\n"));
    expect(r.sin_costos).toBe(false);
  });
});

describe("bordes", () => {
  it("un texto vacío no importa nada ni revienta", () => {
    const r = interpretarCarta("");
    expect(r.lineas).toEqual([]);
    expect(r.altas).toBe(0);
    expect(r.sin_costos).toBe(false);
  });

  it("las líneas en blanco se ignoran y no corren la numeración", () => {
    const r = interpretarCarta(["Pizzas|Margarita|249|62", "", "Pizzas|Pepperoni|269|71"].join("\n"));
    expect(r.altas).toBe(2);
    // El segundo producto está en el renglón 3 del texto pegado.
    expect(r.lineas[1]!.renglon).toBe(3);
  });

  it("conserva el texto original para poder señalar el renglón", () => {
    const r = interpretarCarta("Pizzas|Margarita|xx");
    expect(r.lineas[0]!.original).toBe("Pizzas|Margarita|xx");
  });
});
