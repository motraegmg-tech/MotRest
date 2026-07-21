import { describe, expect, it } from "vitest";
import {
  cabeEnArea,
  celdasDe,
  haySolape,
  mesasDeArea,
  planoPorDefecto,
  primerHuecoLibre,
  validarPlano,
  type Area,
  type Mesa,
  type PlanoLocal,
} from "../catalogo/areas.js";

const AREA: Area = { id: "a1", nombre: "Salón", orden: 1, columnas: 6, filas: 4 };

function mesa(parcial: Partial<Mesa> = {}): Mesa {
  return {
    id: "m1", nombre: "1", area_id: "a1",
    columna: 0, fila: 0, ancho: 2, alto: 2,
    forma: "cuadrada", activa: true,
    ...parcial,
  };
}

function plano(mesas: Mesa[], areas: Area[] = [AREA]): PlanoLocal {
  return { areas, mesas, version: 1, updated_at: 0 };
}

describe("celdas que ocupa una mesa", () => {
  it("una mesa 2×2 ocupa cuatro celdas", () => {
    expect(celdasDe(mesa()).sort()).toEqual(["0:0", "0:1", "1:0", "1:1"]);
  });

  it("una mesa 1×1 ocupa una sola celda", () => {
    expect(celdasDe(mesa({ ancho: 1, alto: 1, columna: 3, fila: 2 }))).toEqual(["3:2"]);
  });
});

describe("la mesa debe caber en su área", () => {
  it("acepta una mesa dentro de la retícula", () => {
    expect(cabeEnArea(mesa({ columna: 4, fila: 2 }), AREA)).toBe(true);
  });

  it("rechaza una mesa que se sale por la derecha", () => {
    expect(cabeEnArea(mesa({ columna: 5, fila: 0 }), AREA)).toBe(false);
  });

  it("rechaza una mesa que se sale por abajo", () => {
    expect(cabeEnArea(mesa({ columna: 0, fila: 3 }), AREA)).toBe(false);
  });

  it("rechaza posiciones negativas", () => {
    expect(cabeEnArea(mesa({ columna: -1 }), AREA)).toBe(false);
  });
});

describe("dos mesas no pueden encimarse", () => {
  const a = mesa({ id: "a", columna: 0, fila: 0 });

  it("detecta el solape aunque sea de una celda", () => {
    const b = mesa({ id: "b", columna: 1, fila: 1 });
    expect(haySolape(b, [a, b])).toBe(true);
  });

  it("acepta mesas adyacentes sin encimarse", () => {
    const b = mesa({ id: "b", columna: 2, fila: 0 });
    expect(haySolape(b, [a, b])).toBe(false);
  });

  it("una mesa no se solapa consigo misma", () => {
    expect(haySolape(a, [a])).toBe(false);
  });

  it("mesas de áreas distintas no chocan aunque coincidan las celdas", () => {
    const otra = mesa({ id: "b", area_id: "a2" });
    expect(haySolape(otra, [a, otra])).toBe(false);
  });
});

describe("buscar hueco libre", () => {
  it("encuentra el primer espacio disponible", () => {
    const p = plano([mesa({ id: "a", columna: 0, fila: 0 })]);
    expect(primerHuecoLibre(p, "a1", 2, 2)).toEqual({ columna: 2, fila: 0 });
  });

  it("devuelve null cuando el área está llena", () => {
    // Área 6×4 completamente cubierta por seis mesas 2×2.
    const llenas: Mesa[] = [];
    for (let fila = 0; fila < 4; fila += 2) {
      for (let columna = 0; columna < 6; columna += 2) {
        llenas.push(mesa({ id: `m${columna}-${fila}`, columna, fila }));
      }
    }
    expect(primerHuecoLibre(plano(llenas), "a1", 2, 2)).toBeNull();
  });

  it("un área vacía ofrece la esquina", () => {
    expect(primerHuecoLibre(plano([]), "a1", 2, 2)).toEqual({ columna: 0, fila: 0 });
  });
});

describe("validación del plano", () => {
  it("un plano correcto no reporta problemas de mesas", () => {
    const p = plano([mesa({ id: "a", nombre: "1" }), mesa({ id: "b", nombre: "2", columna: 3 })]);
    const problemas = validarPlano(p).filter((x) => x.tipo !== "area_sin_mesas");
    expect(problemas).toHaveLength(0);
  });

  it("señala mesas encimadas", () => {
    const p = plano([
      mesa({ id: "a", nombre: "1" }),
      mesa({ id: "b", nombre: "2", columna: 1, fila: 1 }),
    ]);
    expect(validarPlano(p).some((x) => x.tipo === "mesas_encimadas")).toBe(true);
  });

  it("señala mesas fuera de la retícula", () => {
    const p = plano([mesa({ id: "a", nombre: "1", columna: 5, fila: 3 })]);
    expect(validarPlano(p).some((x) => x.tipo === "mesa_fuera_de_area")).toBe(true);
  });

  it("señala identificadores repetidos", () => {
    const p = plano([
      mesa({ id: "a", nombre: "5" }),
      mesa({ id: "b", nombre: "5", columna: 3 }),
    ]);
    expect(validarPlano(p).some((x) => x.tipo === "nombre_duplicado")).toBe(true);
  });

  it("señala mesas sin área", () => {
    const p = plano([mesa({ id: "a", nombre: "1", area_id: "fantasma" })]);
    expect(validarPlano(p).some((x) => x.tipo === "mesa_sin_area")).toBe(true);
  });

  it("señala áreas vacías", () => {
    expect(validarPlano(plano([])).some((x) => x.tipo === "area_sin_mesas")).toBe(true);
  });
});

describe("plano de arranque", () => {
  const p = planoPorDefecto();

  it("trae dos áreas y doce mesas", () => {
    expect(p.areas).toHaveLength(2);
    expect(p.mesas).toHaveLength(12);
  });

  it("no tiene mesas encimadas, fuera de sitio ni repetidas", () => {
    expect(validarPlano(p)).toHaveLength(0);
  });

  it("reparte las mesas entre salón y terraza", () => {
    expect(mesasDeArea(p, "area-salon")).toHaveLength(9);
    expect(mesasDeArea(p, "area-terraza")).toHaveLength(3);
  });

  it("conserva los identificadores mesa-1 … mesa-12", () => {
    const ids = p.mesas.map((m) => m.id).sort();
    expect(ids).toContain("mesa-1");
    expect(ids).toContain("mesa-12");
    expect(new Set(ids).size).toBe(12);
  });
});
