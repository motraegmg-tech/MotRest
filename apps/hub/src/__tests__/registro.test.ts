/**
 * La rotación del registro del Hub.
 *
 * El 23-sep-2026 la caja de Gonzalo acumuló un millón de archivos de registro
 * en 49 minutos: pasado el tope del archivo del día, CADA renglón abría uno
 * nuevo. Lo que se prueba aquí es que eso ya no puede pasar: con el archivo
 * lleno, los renglones siguientes van todos a la misma parte hasta llenarla.
 */
import { describe, expect, it } from "vitest";
import { archivoDelRegistro, esConsolaRota, rutaDeParte, type EstadoRegistro } from "../registro.js";

const MAX = 100;
const DIR = "reg";

/** Un disco de mentira: tamaño por archivo, y cada escritura suma al elegido. */
function disco(inicial: Record<string, number> = {}) {
  const tamanos = new Map(Object.entries(inicial));
  const estado: EstadoRegistro = { dia: "", parte: 0 };
  return {
    tamanos,
    escribir(dia: string, bytes: number): string {
      const ruta = archivoDelRegistro(DIR, dia, estado, MAX, (r) => tamanos.get(r) ?? null);
      tamanos.set(ruta, (tamanos.get(ruta) ?? 0) + bytes);
      return ruta;
    },
  };
}

describe("rotación del registro", () => {
  it("con el archivo del día lleno, mil renglones van a UNA parte, no a mil archivos", () => {
    const d = disco({ [rutaDeParte(DIR, "2026-09-23", 0)]: 150 });
    const usados = new Set<string>();
    for (let i = 0; i < 1000; i++) usados.add(d.escribir("2026-09-23", 0));
    expect(usados.size).toBe(1);
    expect([...usados][0]).toBe(rutaDeParte(DIR, "2026-09-23", 1));
  });

  it("cada parte se llena antes de pasar a la siguiente", () => {
    const d = disco();
    const rutas = Array.from({ length: 25 }, () => d.escribir("2026-09-23", 10));
    // 100 bytes por parte, 10 por renglón: 10 renglones por parte, tres partes.
    expect(new Set(rutas).size).toBe(3);
    expect(rutas[0]).toBe(rutaDeParte(DIR, "2026-09-23", 0));
    expect(rutas[10]).toBe(rutaDeParte(DIR, "2026-09-23", 1));
    expect(rutas[24]).toBe(rutaDeParte(DIR, "2026-09-23", 2));
  });

  it("al arrancar salta las partes ya llenas", () => {
    const d = disco({
      [rutaDeParte(DIR, "2026-09-23", 0)]: 200,
      [rutaDeParte(DIR, "2026-09-23", 1)]: 200,
      [rutaDeParte(DIR, "2026-09-23", 2)]: 5,
    });
    expect(d.escribir("2026-09-23", 1)).toBe(rutaDeParte(DIR, "2026-09-23", 2));
  });

  it("un día nuevo vuelve a la parte cero", () => {
    const d = disco({ [rutaDeParte(DIR, "2026-09-23", 0)]: 200 });
    d.escribir("2026-09-23", 1);
    expect(d.escribir("2026-09-24", 1)).toBe(rutaDeParte(DIR, "2026-09-24", 0));
  });

  it("los nombres: la parte cero sin número, las demás con él", () => {
    expect(rutaDeParte(DIR, "2026-09-23", 0)).toMatch(/hub-2026-09-23\.log$/);
    expect(rutaDeParte(DIR, "2026-09-23", 3)).toMatch(/hub-2026-09-23\.3\.log$/);
  });
});

describe("consola rota", () => {
  it("reconoce el EPIPE y los de un flujo cerrado, y nada más", () => {
    expect(esConsolaRota(Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).toBe(true);
    expect(esConsolaRota(Object.assign(new Error("x"), { code: "ERR_STREAM_DESTROYED" }))).toBe(true);
    expect(esConsolaRota(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(false);
    expect(esConsolaRota(new Error("cualquier otro"))).toBe(false);
    expect(esConsolaRota(null)).toBe(false);
  });
});
