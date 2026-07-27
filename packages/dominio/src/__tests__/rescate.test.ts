/**
 * Código de rescate: la llave de repuesto del propietario.
 *
 * Lo que importa probar es que sea una LLAVE y no una puerta: entropía real, sin
 * caracteres que se confundan en el papel, y tolerante a cómo la gente los
 * transcribe —porque el día que se usa, se usa desde una hoja escrita a mano—.
 */
import { describe, expect, it } from "vitest";
import {
  generarCodigoRescate,
  normalizarCodigo,
  pareceCodigoRescate,
} from "../identidad/rescate.js";

describe("generación", () => {
  it("tiene la forma legible de cuatro grupos de cinco", () => {
    expect(generarCodigoRescate()).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}-[2-9A-Z]{5}-[2-9A-Z]{5}$/);
  });

  /*
   * Sin caracteres ambiguos: un cero confundido con una O el día que hay que
   * usarlo convierte el rescate en otro candado.
   */
  it("no usa caracteres que se confundan en un papel", () => {
    const muestra = Array.from({ length: 200 }, generarCodigoRescate).join("");
    expect(muestra).not.toMatch(/[ILOU01]/);
  });

  it("no se repite: es aleatorio de verdad", () => {
    const codigos = new Set(Array.from({ length: 500 }, generarCodigoRescate));
    expect(codigos.size).toBe(500);
  });

  it("reparte los caracteres por todo el alfabeto", () => {
    const muestra = Array.from({ length: 300 }, generarCodigoRescate).join("").replace(/-/g, "");
    // Con 6 000 caracteres sobre 30 posibles, ver menos de 25 distintos
    // delataría un generador sesgado.
    expect(new Set(muestra).size).toBeGreaterThan(25);
  });
});

describe("cómo lo teclea la gente", () => {
  it("da igual con guiones, sin ellos, en minúsculas o con espacios", () => {
    const codigo = "A7K2M-9PQRS-3TVWX-YZ4BC";
    const esperado = normalizarCodigo(codigo);

    expect(normalizarCodigo("a7k2m9pqrs3tvwxyz4bc")).toBe(esperado);
    expect(normalizarCodigo("A7K2M 9PQRS 3TVWX YZ4BC")).toBe(esperado);
    expect(normalizarCodigo("  a7k2m-9pqrs-3tvwx-yz4bc  ")).toBe(esperado);
  });

  /*
   * Corrige lo que de verdad pasa al copiar de una hoja: cada carácter que el
   * alfabeto excluyó se traduce al que se le parece y sí existe.
   */
  it("perdona las confusiones clásicas del papel", () => {
    expect(normalizarCodigo("O")).toBe(normalizarCodigo("Q"));
    expect(normalizarCodigo("0")).toBe(normalizarCodigo("Q"));
    expect(normalizarCodigo("1")).toBe(normalizarCodigo("7"));
    expect(normalizarCodigo("I")).toBe(normalizarCodigo("J"));
    expect(normalizarCodigo("L")).toBe(normalizarCodigo("J"));
    expect(normalizarCodigo("U")).toBe(normalizarCodigo("V"));
  });

  it("un código recién generado se reconoce a sí mismo", () => {
    for (let i = 0; i < 50; i++) {
      expect(pareceCodigoRescate(generarCodigoRescate())).toBe(true);
    }
  });

  it("rechaza lo que no tiene la longitud correcta", () => {
    expect(pareceCodigoRescate("")).toBe(false);
    expect(pareceCodigoRescate("A7K2M")).toBe(false);
    expect(pareceCodigoRescate("A7K2M-9PQRS-3TVWX-YZ4BC-EXTRA")).toBe(false);
  });
});
