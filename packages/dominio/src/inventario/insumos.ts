/**
 * Insumos del almacén.
 *
 * Capa OPCIONAL (ADR-16): un restaurante puede operar con costo y precio por
 * platillo sin capturar un solo insumo. Quien quiera control de existencias y
 * mermas —la base del cobro por ahorro verificado— declara sus insumos y los
 * vincula desde las recetas.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

export type Unidad = "pz" | "g" | "kg" | "ml" | "l" | "porcion";

export const UNIDADES: { valor: Unidad; etiqueta: string }[] = [
  { valor: "pz", etiqueta: "piezas" },
  { valor: "g", etiqueta: "gramos" },
  { valor: "kg", etiqueta: "kilos" },
  { valor: "ml", etiqueta: "mililitros" },
  { valor: "l", etiqueta: "litros" },
  { valor: "porcion", etiqueta: "porciones" },
];

export interface Insumo {
  id: ID;
  nombre: string;
  /** Unidad en la que se lleva el stock. */
  unidad_base: Unidad;
  /** Costo por unidad base, para valorar el inventario. */
  costo_unitario: Centavos;
  /** Por debajo de aquí se sugiere reponer. */
  stock_minimo: number;
  categoria?: string;
}

/** Factores de conversión hacia la unidad base, dentro del mismo sistema. */
const A_BASE: Partial<Record<Unidad, { base: Unidad; factor: number }>> = {
  kg: { base: "g", factor: 1000 },
  l: { base: "ml", factor: 1000 },
};

/**
 * Convierte una cantidad a la unidad base del insumo.
 * Solo convierte dentro del mismo sistema (masa o volumen); mezclar gramos con
 * mililitros exige una densidad que el software no puede inventar.
 */
export function convertir(cantidad: number, desde: Unidad, hacia: Unidad): number | null {
  if (desde === hacia) return cantidad;

  const escaladoDesde = A_BASE[desde];
  const escaladoHacia = A_BASE[hacia];

  if (escaladoDesde && escaladoDesde.base === hacia) {
    return cantidad * escaladoDesde.factor;
  }
  if (escaladoHacia && escaladoHacia.base === desde) {
    return cantidad / escaladoHacia.factor;
  }
  return null;
}

export function etiquetaUnidad(unidad: Unidad): string {
  return UNIDADES.find((u) => u.valor === unidad)?.etiqueta ?? unidad;
}

/** Formatea una cantidad con su unidad: 1500 g → "1.5 kg". */
export function formatearCantidad(cantidad: number, unidad: Unidad): string {
  if (unidad === "g" && Math.abs(cantidad) >= 1000) {
    return `${(cantidad / 1000).toFixed(2)} kg`;
  }
  if (unidad === "ml" && Math.abs(cantidad) >= 1000) {
    return `${(cantidad / 1000).toFixed(2)} l`;
  }
  const decimales = Number.isInteger(cantidad) ? 0 : 2;
  return `${cantidad.toFixed(decimales)} ${unidad}`;
}
