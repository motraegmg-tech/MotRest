/**
 * El importe con letra de la representación impresa.
 *
 * Un error aquí no rompe el timbrado —el XML lleva el número—, pero sí produce
 * una factura impresa donde la cifra y la letra no coinciden, que es lo primero
 * que un contador señala. Por eso se prueban los saltos donde el español cambia
 * de forma: apócope, CIEN vs CIENTO, los "y", el millón.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { enLetras, importeConLetra } from "../fiscal/importe-letra.js";

describe("enteros en palabras", () => {
  it.each([
    [0, "CERO"],
    [1, "UN"],
    [2, "DOS"],
    [15, "QUINCE"],
    [16, "DIECISEIS"],
    [20, "VEINTE"],
    [21, "VEINTIUN"],
    [30, "TREINTA"],
    [31, "TREINTA Y UN"],
    [45, "CUARENTA Y CINCO"],
    [100, "CIEN"],
    [101, "CIENTO UN"],
    [116, "CIENTO DIECISEIS"],
    [200, "DOSCIENTOS"],
    [500, "QUINIENTOS"],
    [999, "NOVECIENTOS NOVENTA Y NUEVE"],
    [1000, "MIL"],
    [1160, "MIL CIENTO SESENTA"],
    [2000, "DOS MIL"],
    [21000, "VEINTIUN MIL"],
    [100000, "CIEN MIL"],
    [1000000, "UN MILLON"],
    [2500000, "DOS MILLONES QUINIENTOS MIL"],
  ])("%i → %s", (n, esperado) => {
    expect(enLetras(n)).toBe(esperado);
  });

  /*
   * "CIEN" solo cuando es exactamente cien; en cuanto hay algo más, "CIENTO".
   * Es el error clásico ("cien uno" en vez de "ciento uno").
   */
  it("distingue CIEN de CIENTO", () => {
    expect(enLetras(100)).toBe("CIEN");
    expect(enLetras(105)).toBe("CIENTO CINCO");
    expect(enLetras(150)).toBe("CIENTO CINCUENTA");
  });
});

describe("importe con letra, formato del SAT", () => {
  it("arma el total tal como va en la factura", () => {
    expect(importeConLetra(pesos(1160))).toBe("MIL CIENTO SESENTA PESOS 00/100 M.N.");
    expect(importeConLetra(pesos(393.24))).toBe(
      "TRESCIENTOS NOVENTA Y TRES PESOS 24/100 M.N.",
    );
  });

  it("usa PESO en singular solo para exactamente un peso", () => {
    expect(importeConLetra(pesos(1))).toBe("UN PESO 00/100 M.N.");
    expect(importeConLetra(pesos(2))).toBe("DOS PESOS 00/100 M.N.");
    // 1.50 ya no es "un peso": son varios centavos, PESOS en plural.
    expect(importeConLetra(pesos(1.5))).toBe("UN PESO 50/100 M.N.");
  });

  it("cero pesos se escribe, no se deja en blanco", () => {
    expect(importeConLetra(pesos(0))).toBe("CERO PESOS 00/100 M.N.");
  });

  /*
   * Los centavos van SIEMPRE con dos dígitos: "05/100", no "5/100". Un contador
   * lee eso como error de captura.
   */
  it("rellena los centavos a dos dígitos", () => {
    expect(importeConLetra(pesos(10.05))).toBe("DIEZ PESOS 05/100 M.N.");
    expect(importeConLetra(pesos(10.5))).toBe("DIEZ PESOS 50/100 M.N.");
  });
});
