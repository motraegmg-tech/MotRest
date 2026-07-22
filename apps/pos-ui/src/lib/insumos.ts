/**
 * Insumos del almacén de la demostración.
 *
 * Capa OPCIONAL (ADR-16): existe para los restaurantes que quieren control de
 * existencias y mermas. Las recetas de `catalogo.ts` se vinculan a estos
 * insumos; los ingredientes que no declaran vínculo solo desglosan costo.
 */
import { pesos } from "@motrest/dominio";
import type { Insumo } from "@motrest/dominio";

export const insumos: Insumo[] = [
  // --- Base de pizzas ---
  { id: "ins-masa", nombre: "Masa madre", unidad_base: "g", costo_unitario: pesos(0.062),
    stock_minimo: 8000, categoria: "Panadería" },
  { id: "ins-pomodoro", nombre: "Salsa pomodoro", unidad_base: "ml", costo_unitario: pesos(0.045),
    stock_minimo: 4000, categoria: "Salsas" },

  // --- Quesos ---
  { id: "ins-mozz-fdl", nombre: "Mozzarella fior di latte", unidad_base: "g",
    costo_unitario: pesos(0.178), stock_minimo: 3000, categoria: "Lácteos" },
  { id: "ins-mozz", nombre: "Mozzarella", unidad_base: "g", costo_unitario: pesos(0.142),
    stock_minimo: 5000, categoria: "Lácteos" },
  { id: "ins-gorgonzola", nombre: "Gorgonzola", unidad_base: "g", costo_unitario: pesos(0.3),
    stock_minimo: 800, categoria: "Lácteos" },
  { id: "ins-parmesano", nombre: "Parmesano", unidad_base: "g", costo_unitario: pesos(0.36),
    stock_minimo: 700, categoria: "Lácteos" },
  { id: "ins-provolone", nombre: "Provolone", unidad_base: "g", costo_unitario: pesos(0.267),
    stock_minimo: 600, categoria: "Lácteos" },

  // --- Cárnicos ---
  { id: "ins-pepperoni", nombre: "Pepperoni artesanal", unidad_base: "g",
    costo_unitario: pesos(0.395), stock_minimo: 1500, categoria: "Cárnicos" },
  { id: "ins-jamon", nombre: "Jamón", unidad_base: "g", costo_unitario: pesos(0.2),
    stock_minimo: 1200, categoria: "Cárnicos" },

  // --- Frescos ---
  { id: "ins-albahaca", nombre: "Albahaca fresca", unidad_base: "g", costo_unitario: pesos(0.26),
    stock_minimo: 200, categoria: "Frescos" },
  { id: "ins-pina", nombre: "Piña", unidad_base: "g", costo_unitario: pesos(0.06),
    stock_minimo: 1000, categoria: "Frescos" },
  { id: "ins-aceite", nombre: "Aceite de oliva", unidad_base: "ml", costo_unitario: pesos(0.13),
    stock_minimo: 1000, categoria: "Abarrotes" },
];

/** Existencias iniciales de la demostración, en la unidad base de cada insumo. */
export const EXISTENCIAS_INICIALES: [string, number][] = [
  ["ins-masa", 25_000],
  ["ins-pomodoro", 12_000],
  ["ins-mozz-fdl", 6_000],
  ["ins-mozz", 9_000],
  ["ins-gorgonzola", 1_500],
  ["ins-parmesano", 1_200],
  ["ins-provolone", 900],
  ["ins-pepperoni", 3_000],
  ["ins-jamon", 2_000],
  // A propósito por debajo del mínimo, para que la lista de reposición tenga algo.
  ["ins-albahaca", 120],
  ["ins-pina", 1_800],
  ["ins-aceite", 2_500],
];
