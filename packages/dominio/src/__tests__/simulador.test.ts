/**
 * Simulador de escenarios (C1).
 *
 * Lo que más importa probar es el PUNTO DE EQUILIBRIO: cuánta venta se puede
 * perder antes de que subir el precio deje de convenir. Es el número honesto
 * del módulo —aritmética exacta— frente a la tentación de inventar una
 * elasticidad y prometer una ganancia que nadie puede garantizar.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import type { VentaProducto } from "../inteligencia/reportes.js";
import { ahorroPorMerma, caidaTolerable, simular } from "../inteligencia/simulador.js";

/** Pizza: 100 unidades a $200, cuesta $80. Margen unitario $120. */
const PIZZA: VentaProducto = {
  producto_id: "prod-pizza",
  descripcion: "Pizza familiar",
  unidades: 100,
  importe: pesos(20_000),
  costo: pesos(8_000),
  margen: pesos(12_000),
  margenPct: 0.6,
};

/** Agua: 200 unidades a $30, cuesta $6. */
const AGUA: VentaProducto = {
  producto_id: "prod-agua",
  descripcion: "Agua",
  unidades: 200,
  importe: pesos(6_000),
  costo: pesos(1_200),
  margen: pesos(4_800),
  margenPct: 0.8,
};

const CARTA = [PIZZA, AGUA];

describe("cambio de precio", () => {
  it("a volumen constante, subir el precio sube el margen", () => {
    // +10% sobre $200 = $220. Margen unitario pasa de $120 a $140.
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 });
    const pizza = e.renglones.find((r) => r.producto_id === "prod-pizza")!;

    expect(pizza.precio_sim).toBe(pesos(220));
    expect(pizza.margen_sim).toBe(pesos(14_000));
    expect(e.delta).toBe(pesos(2_000));
  });

  it("avisa cuando el escenario corrió a volumen constante", () => {
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 });
    expect(e.volumen_constante).toBe(true);

    const conSupuesto = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10, volumen_pct: -5 });
    expect(conSupuesto.volumen_constante).toBe(false);
  });

  it("no toca los productos que no se eligieron", () => {
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 });
    const agua = e.renglones.find((r) => r.producto_id === "prod-agua")!;

    expect(agua.afectado).toBe(false);
    expect(agua.margen_sim).toBe(agua.margen_base);
    expect(agua.delta).toBe(pesos(0));
  });

  it("sin producto elegido, el cambio aplica a toda la carta", () => {
    const e = simular(CARTA, { precio_pct: 10 });
    expect(e.renglones.every((r) => r.afectado)).toBe(true);
    // Pizza +$2000, Agua: 200 × ($33 − $6) = $5400, contra $4800 → +$600.
    expect(e.delta).toBe(pesos(2_600));
  });
});

// --- El número honesto ---------------------------------------------------------------------

describe("punto de equilibrio", () => {
  /*
   * p=200, c=80 → margen 120. Con +10%: p=220 → margen 140.
   * Se puede caer hasta 120/140 = 0.857 del volumen: un 14.3 % menos.
   */
  it("dice cuánta venta se puede perder antes de que deje de convenir", () => {
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 });
    const pizza = e.renglones.find((r) => r.producto_id === "prod-pizza")!;

    expect(pizza.caida_tolerable).toBeCloseTo(0.1429, 3);
  });

  it("cuanto más sube el precio, más caída se tolera", () => {
    const diez = caidaTolerable(200, 220, 80);
    const veinte = caidaTolerable(200, 240, 80);
    expect(veinte!).toBeGreaterThan(diez!);
  });

  it("sin cambio de precio no hay nada que tolerar", () => {
    expect(caidaTolerable(200, 200, 80)).toBeNull();
  });

  /*
   * Bajar el precio EXIGE vender más, no tolera vender menos. Devolver un
   * número aquí insinuaría una holgura que no existe.
   */
  it("bajar el precio no da holgura de volumen", () => {
    expect(caidaTolerable(200, 180, 80)).toBeNull();
  });

  it("si el precio nuevo no cubre el costo, ningún volumen lo salva", () => {
    expect(caidaTolerable(200, 70, 80)).toBeNull();
  });
});

// --- Otras palancas ------------------------------------------------------------------------

describe("costo y volumen", () => {
  it("negociar el costo a la baja sube el margen sin tocar el precio", () => {
    // −25 % sobre $80 = $60. Margen unitario $120 → $140.
    const e = simular(CARTA, { producto_id: "prod-pizza", costo_pct: -25 });
    const pizza = e.renglones.find((r) => r.producto_id === "prod-pizza")!;

    expect(pizza.precio_sim).toBe(pizza.precio_base);
    expect(pizza.margen_sim).toBe(pesos(14_000));
  });

  it("un supuesto de caída de volumen se refleja tal cual", () => {
    // +10 % de precio pero −20 % de volumen: 80 u × $140 = $11 200 < $12 000.
    const e = simular(CARTA, {
      producto_id: "prod-pizza",
      precio_pct: 10,
      volumen_pct: -20,
    });
    const pizza = e.renglones.find((r) => r.producto_id === "prod-pizza")!;

    expect(pizza.unidades_sim).toBe(80);
    expect(pizza.margen_sim).toBe(pesos(11_200));
    expect(e.delta).toBe(pesos(-800)); // sale perdiendo
  });
});

describe("proyección a mes", () => {
  it("lleva el delta del periodo a 30 días", () => {
    // +$2000 en 7 días → 2000/7*30 = $8571.43
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 }, { dias: 7 });
    expect(e.delta_mensual).toBe(857_143);
  });

  it("sin saber cuántos días cubre el periodo, no se proyecta nada", () => {
    const e = simular(CARTA, { producto_id: "prod-pizza", precio_pct: 10 });
    expect(e.delta_mensual).toBeNull();
  });
});

describe("ahorro por merma", () => {
  it("mide contra la fuga que el centinela ya detectó", () => {
    const r = ahorroPorMerma(pesos(1_000), 20, { dias: 7 });
    expect(r.ahorro).toBe(pesos(200));
    expect(r.ahorro_mensual).toBe(pesos(857.14));
  });

  it("no acepta reducciones absurdas", () => {
    expect(ahorroPorMerma(pesos(1_000), 150).ahorro).toBe(pesos(1_000));
    expect(ahorroPorMerma(pesos(1_000), -50).ahorro).toBe(pesos(0));
  });
});

describe("sin ventas", () => {
  it("responde en ceros en vez de reventar", () => {
    const e = simular([], { precio_pct: 10 });
    expect(e.renglones).toEqual([]);
    expect(e.delta).toBe(pesos(0));
    expect(e.delta_pct).toBe(0);
  });
});
