/**
 * Comparar un restaurante con los que se le parecen.
 *
 * LO QUE MÁS SE PRUEBA AQUÍ NO ES EL CÁLCULO: ES QUE NO SE FILTREN LOS NÚMEROS
 * DE NADIE. Un restaurante que comparte sus cifras para compararse no está
 * aceptando que su competencia de enfrente las lea. Si con el comparativo se
 * puede deducir cuánto vende el vecino, MOTRAE dejó de ser proveedor y pasó a
 * ser una fuga.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import {
  INDICADORES,
  MINIMO_PARTICIPANTES,
  compararConElMercado,
  consentimientoInicial,
  dondeGanarMas,
  puedeRecibirComparativo,
  type AporteAnonimo,
  type PerfilComparable,
} from "../inteligencia/benchmarking.js";

const PERFIL: PerfilComparable = { tipo: "pizzeria", tamano: "mediano", estado: "Jalisco" };

function aporte(food_cost: number, extra: Partial<AporteAnonimo> = {}): AporteAnonimo {
  return {
    perfil: PERFIL,
    ticket_promedio: pesos(320),
    food_cost,
    costo_nomina: 0.28,
    merma: 0.04,
    rotacion: 12,
    propina: 0.1,
    ...extra,
  };
}

/** Una muestra sana de seis locales parecidos. */
const MUESTRA = [0.28, 0.3, 0.32, 0.34, 0.36, 0.4].map((f) => aporte(f));

// --- Privacidad -------------------------------------------------------------------------------

describe("que no se filtren los números de nadie", () => {
  /*
   * EL CANDADO. Con cuatro locales y sabiendo el propio, se despeja el resto con
   * una resta. Por debajo del mínimo NO se contesta, aunque el dueño insista.
   */
  it("con pocos participantes NO se contesta, y se explica por qué", () => {
    const r = compararConElMercado(aporte(0.34), MUESTRA.slice(0, MINIMO_PARTICIPANTES - 1));

    expect(r.hay).toBe(false);
    expect(r.hay === false && r.razon).toContain("revelaría los números de restaurantes concretos");
  });

  it("justo en el mínimo ya se contesta", () => {
    expect(compararConElMercado(aporte(0.34), MUESTRA.slice(0, MINIMO_PARTICIPANTES)).hay).toBe(true);
  });

  /*
   * EL MÁXIMO DE UN GRUPO ES EL DATO DE UN LOCAL CONCRETO. Solo se devuelven
   * medianas y los percentiles 25 y 75, que no lo son.
   */
  it("nunca devuelve el mejor ni el peor del grupo", () => {
    const r = compararConElMercado(aporte(0.34), MUESTRA);
    if (!r.hay) throw new Error("debería haber comparativo");

    const foodCost = r.posiciones.find((p) => p.indicador === "food_cost")!;
    const valores = MUESTRA.map((m) => m.food_cost);

    // Ni el mínimo (0.28) ni el máximo (0.40) salen por ninguna parte.
    for (const dato of [foodCost.mediana, foodCost.p25, foodCost.p75]) {
      expect(dato).toBeGreaterThan(Math.min(...valores));
      expect(dato).toBeLessThan(Math.max(...valores));
    }
  });

  it("no devuelve ningún identificador de local, solo agregados", () => {
    const r = compararConElMercado(aporte(0.34), MUESTRA);
    expect(JSON.stringify(r)).not.toMatch(/suc-|sucursal_id/);
  });

  /* Un local que no comparte no aparece en la muestra de nadie ni recibe nada. */
  it("de fábrica NO participa: compartir es una decisión explícita", () => {
    const c = consentimientoInicial("suc-rodizio");
    expect(c.participa).toBe(false);
    expect(puedeRecibirComparativo(c).puede).toBe(false);
  });

  it("quien no aporta no recibe, y se le dice sin regañar", () => {
    const v = puedeRecibirComparativo(consentimientoInicial("suc-x"));
    expect(v.razon).toContain("de forma anónima");
    expect(v.razon).toContain("cuando quiera");
  });
});

// --- Con quién se compara ----------------------------------------------------------------------

describe("con quién tiene sentido compararse", () => {
  /*
   * Una taquería y un restaurante de mantel largo no se comparan aunque estén en
   * la misma calle: decirle a la taquería que su ticket es bajo es ruido.
   */
  it("solo cuentan los locales del mismo tipo, tamaño y estado", () => {
    const otros = [
      ...MUESTRA.map((m) => ({ ...m, perfil: { ...PERFIL, tipo: "taqueria" as const } })),
      ...MUESTRA.map((m) => ({ ...m, perfil: { ...PERFIL, estado: "Nuevo León" } })),
    ];

    expect(compararConElMercado(aporte(0.34), otros).hay).toBe(false);
  });

  it("cuenta cuántos hay en la muestra", () => {
    const r = compararConElMercado(aporte(0.34), MUESTRA);
    expect(r.participantes).toBe(6);
  });
});

// --- Cómo se lee -------------------------------------------------------------------------------

describe("dónde queda el local que pregunta", () => {
  /*
   * EL CANDADO DE LECTURA. Un food cost BAJO es bueno. Si el cuartil no se
   * invirtiera para los costos, el dueño leería que está mal justo cuando está
   * mejor que todos.
   */
  it("un costo bajo sale como bueno, no como cuartil 4", () => {
    const r = compararConElMercado(aporte(0.28), MUESTRA);
    if (!r.hay) throw new Error("debería haber comparativo");

    const foodCost = r.posiciones.find((p) => p.indicador === "food_cost")!;
    expect(foodCost.cuartil).toBe(1);
    expect(foodCost.lectura).toContain("entre los mejores");
  });

  it("un costo alto sale como lo que hay que atacar", () => {
    const r = compararConElMercado(aporte(0.42), MUESTRA);
    if (!r.hay) throw new Error("debería haber comparativo");

    const foodCost = r.posiciones.find((p) => p.indicador === "food_cost")!;
    expect(foodCost.cuartil).toBe(4);
    expect(foodCost.lectura).toContain("donde más hay que ganar");
  });

  /* Y al revés para lo que sí conviene que sea alto. */
  it("un ticket promedio alto también sale como bueno", () => {
    const alto = MUESTRA.map((m, i) => ({ ...m, ticket_promedio: pesos(200 + i * 20) }));
    const r = compararConElMercado(aporte(0.34, { ticket_promedio: pesos(400) }), alto);
    if (!r.hay) throw new Error("debería haber comparativo");

    expect(r.posiciones.find((p) => p.indicador === "ticket_promedio")!.cuartil).toBe(1);
  });

  it("trae los seis indicadores", () => {
    const r = compararConElMercado(aporte(0.34), MUESTRA);
    if (!r.hay) throw new Error("debería haber comparativo");
    expect(r.posiciones).toHaveLength(INDICADORES.length);
  });

  /*
   * Una lista de seis cosas que arreglar no se arregla: se ignora entera. Tres
   * es lo que un restaurantero puede atacar de verdad este mes.
   */
  it("señala tres cosas, no seis", () => {
    const r = compararConElMercado(aporte(0.42), MUESTRA);
    const foco = dondeGanarMas(r);

    expect(foco).toHaveLength(3);
    expect(foco[0]!.cuartil).toBeGreaterThanOrEqual(foco[2]!.cuartil);
  });

  it("sin comparativo no hay nada que señalar", () => {
    expect(dondeGanarMas(compararConElMercado(aporte(0.34), []))).toEqual([]);
  });
});
