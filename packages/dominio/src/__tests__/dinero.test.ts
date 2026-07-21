import { describe, expect, it } from "vitest";
import {
  aPesos,
  deCentavos,
  pesos,
  porCantidad,
  porFraccion,
  repartir,
  restar,
  sumar,
} from "../comun/dinero.js";

describe("dinero en centavos", () => {
  it("convierte pesos a centavos enteros", () => {
    expect(pesos(249)).toBe(24900);
    expect(pesos(249.5)).toBe(24950);
    expect(pesos(0.01)).toBe(1);
  });

  it("regresa a pesos para mostrar", () => {
    expect(aPesos(pesos(598.56))).toBe(598.56);
  });

  it("rechaza centavos no enteros", () => {
    expect(() => deCentavos(10.5)).toThrow();
  });

  it("suma sin el error de los decimales flotantes", () => {
    // El caso clásico: 0.1 + 0.2 !== 0.3 en coma flotante.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumar(pesos(0.1), pesos(0.2))).toBe(pesos(0.3));
  });

  it("suma cientos de importes sin acumular error", () => {
    const centavo = pesos(0.01);
    const montos = Array.from({ length: 1000 }, () => centavo);
    expect(sumar(...montos)).toBe(pesos(10));
  });

  it("multiplica por cantidad y por fracción", () => {
    expect(porCantidad(pesos(45), 2)).toBe(pesos(90));
    expect(porFraccion(pesos(42.2), 0.5)).toBe(pesos(21.1));
  });

  it("resta correctamente", () => {
    expect(restar(pesos(516), pesos(38))).toBe(pesos(478));
  });
});

describe("repartir sin perder ni inventar centavos", () => {
  it("reparte exacto cuando divide", () => {
    expect(repartir(pesos(90), 3)).toEqual([pesos(30), pesos(30), pesos(30)]);
  });

  it("distribuye el sobrante en las primeras partes", () => {
    // $100.00 entre 3 no da exacto: 33.34 + 33.33 + 33.33 = 100.00
    expect(repartir(pesos(100), 3)).toEqual([3334, 3333, 3333]);
  });

  it("la suma de las partes SIEMPRE es el total", () => {
    const casos: [number, number][] = [
      [598.56, 3],
      [100, 7],
      [0.05, 3],
      [1234.56, 11],
      [0.01, 4],
      [516, 2],
    ];
    for (const [monto, partes] of casos) {
      const total = pesos(monto);
      const trozos = repartir(total, partes);
      expect(trozos).toHaveLength(partes);
      expect(sumar(...trozos)).toBe(total);
    }
  });

  it("rechaza un número de partes inválido", () => {
    expect(() => repartir(pesos(100), 0)).toThrow();
    expect(() => repartir(pesos(100), -2)).toThrow();
    expect(() => repartir(pesos(100), 2.5)).toThrow();
  });
});
