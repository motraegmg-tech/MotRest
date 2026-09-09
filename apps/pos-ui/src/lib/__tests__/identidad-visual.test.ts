/**
 * La cara del platillo sin foto.
 *
 * Lo que se comprueba aquí es sobre todo la ESTABILIDAD: el valor de esto es
 * que «la Margarita» esté siempre del mismo color, en toda terminal y en todo
 * arranque. Un color bonito que cambie al recargar no sirve de nada.
 */
import { describe, expect, it } from "vitest";
import { TONOS } from "@motrest/ui/iconos";
import { inicialDeNombre, tonoDeNombre } from "../identidad-visual";

const HEXES = new Set(Object.values(TONOS).map((t) => t.hex));

describe("el color de un platillo", () => {
  it("es siempre el mismo para el mismo nombre", () => {
    const a = tonoDeNombre("Margarita Clásica");
    for (let i = 0; i < 50; i += 1) expect(tonoDeNombre("Margarita Clásica")).toBe(a);
  });

  it("sale de la paleta medida, no de un color cualquiera", () => {
    for (const nombre of ["Pizza Hawaiana", "Lasaña", "Agua de Jamaica", "Tiramisú", "x"]) {
      expect(HEXES).toContain(tonoDeNombre(nombre));
    }
  });

  it("reparte: cuarenta platillos no caen todos en el mismo tono", () => {
    const carta = Array.from({ length: 40 }, (_, i) => `Platillo ${i} de la casa`);
    const distintos = new Set(carta.map(tonoDeNombre));
    expect(distintos.size).toBeGreaterThan(5);
  });
});

describe("la inicial", () => {
  it("toma dos palabras cuando las hay, que distingue mucho mejor", () => {
    expect(inicialDeNombre("Margarita Clásica")).toBe("MC");
    expect(inicialDeNombre("Pepperoni")).toBe("P");
  });

  it("se salta las palabras de enlace", () => {
    // «Pizza de la Casa» debe dar PC, no PD: media carta empieza por «Pizza de».
    expect(inicialDeNombre("Pizza de la Casa")).toBe("PC");
    expect(inicialDeNombre("Agua de Jamaica")).toBe("AJ");
  });

  it("no se rompe con un nombre vacío o raro", () => {
    expect(inicialDeNombre("")).toBe("·");
    expect(inicialDeNombre("   ")).toBe("·");
    expect(inicialDeNombre("de la")).toBe("·");
  });

  it("va siempre en mayúscula", () => {
    expect(inicialDeNombre("pizza margarita")).toBe("PM");
  });
});
