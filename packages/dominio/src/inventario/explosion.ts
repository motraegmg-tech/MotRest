/**
 * Explosión de lo vendido a insumos consumidos.
 *
 * Es el puente entre la venta y el almacén: al enviar un platillo a cocina, se
 * calcula qué insumos se van y se registran como movimientos. Solo cuenta lo
 * que declara su vínculo con el almacén — un restaurante que no captura
 * insumos simplemente no descuenta nada, y el POS funciona igual.
 */
import type { ID } from "../comun/ids.js";
import type { PorcionElegida } from "../catalogo/porciones.js";
import type { CatalogoIndex } from "../catalogo/productos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { convertir, type Unidad } from "./insumos.js";

export interface ConsumoInsumo {
  insumo_id: ID;
  /** Cantidad consumida, positiva, en la unidad declarada. */
  cantidad: number;
  unidad: Unidad;
}

/** Suma consumos del mismo insumo y unidad. */
function acumular(consumos: ConsumoInsumo[]): ConsumoInsumo[] {
  const porClave = new Map<string, ConsumoInsumo>();
  for (const c of consumos) {
    if (c.cantidad <= 0) continue;
    const clave = `${c.insumo_id}:${c.unidad}`;
    const previo = porClave.get(clave);
    if (previo) previo.cantidad += c.cantidad;
    else porClave.set(clave, { ...c });
  }
  return [...porClave.values()];
}

/** Insumos que consume una receta, escalados por un factor. */
function deReceta(
  recetaId: ID,
  factor: number,
  cat: CatalogoIndex,
): ConsumoInsumo[] {
  const receta = cat.recetas.get(recetaId);
  if (!receta) return [];

  return receta.ingredientes
    .filter((i) => i.insumo_id && i.cantidad && i.unidad)
    .map((i) => ({
      insumo_id: i.insumo_id!,
      cantidad: i.cantidad! * factor,
      unidad: i.unidad!,
    }));
}

/**
 * Insumos que consume UNA unidad de un producto.
 *
 * Considera las tres formas de armar un platillo:
 *  - producto simple con receta;
 *  - producto configurable, sumando la receta de cada porción por su fracción;
 *  - modificadores que agregan o quitan insumos (llegan con la etapa avanzada).
 *
 * Vive aparte del renglón porque hay preguntas que se hacen ANTES de vender:
 * cuántas unidades alcanzan con el almacén de hoy no depende de que alguien ya
 * haya capturado el platillo en una comanda.
 */
export function insumosDeProducto(
  productoId: ID,
  cat: CatalogoIndex,
  porciones?: readonly PorcionElegida[],
): ConsumoInsumo[] {
  if (porciones?.length) {
    const consumos: ConsumoInsumo[] = [];
    for (const porcion of porciones) {
      const variedad = cat.productos.get(porcion.producto_id);
      if (!variedad?.receta_id) continue;
      consumos.push(...deReceta(variedad.receta_id, porcion.fraccion, cat));
    }
    return acumular(consumos);
  }

  const producto = cat.productos.get(productoId);
  if (!producto?.receta_id) return [];
  return acumular(deReceta(producto.receta_id, 1, cat));
}

/** Insumos que consume un renglón ya capturado, por su cantidad. */
export function insumosDeRenglon(
  renglon: RenglonComanda,
  cat: CatalogoIndex,
): ConsumoInsumo[] {
  const porUnidad = insumosDeProducto(renglon.producto_id, cat, renglon.porciones);
  // Se vuelve a acumular para descartar cantidades no positivas: un renglón con
  // cantidad cero o negativa no consume nada del almacén.
  return acumular(
    porUnidad.map((c) => ({ ...c, cantidad: c.cantidad * renglon.cantidad })),
  );
}

/** Insumos que consume un conjunto de renglones (lo que se manda a cocina). */
export function insumosDeRenglones(
  renglones: readonly RenglonComanda[],
  cat: CatalogoIndex,
): ConsumoInsumo[] {
  return acumular(renglones.flatMap((r) => insumosDeRenglon(r, cat)));
}

export function aUnidadBase(
  consumo: ConsumoInsumo,
  unidadBase: Unidad,
): number | null {
  return convertir(consumo.cantidad, consumo.unidad, unidadBase);
}

export interface Rendimiento {
  piezas: number;
  insumo_limitante_id: ID;
}

/**
 * Calcula cuántas unidades de un producto pueden prepararse con el inventario actual.
 * Determina cuál es el insumo limitante (el que se acaba primero).
 */
export function calcularRendimiento(
  productoId: ID,
  cat: CatalogoIndex,
  existencias: ReadonlyMap<ID, { cantidad: number }>,
  insumos: ReadonlyMap<ID, import("./insumos.js").Insumo>,
  porciones?: readonly PorcionElegida[],
): Rendimiento | null {
  const consumos = insumosDeProducto(productoId, cat, porciones);
  if (consumos.length === 0) return null;

  let minPiezas = Infinity;
  let limitanteId = "";

  for (const consumo of consumos) {
    const insumo = insumos.get(consumo.insumo_id);
    if (!insumo) continue;

    const consumoBase = aUnidadBase(consumo, insumo.unidad_base);
    if (consumoBase === null || consumoBase <= 0) continue;

    const existencia = existencias.get(consumo.insumo_id)?.cantidad ?? 0;
    
    if (existencia <= 0) {
       return { piezas: 0, insumo_limitante_id: consumo.insumo_id };
    }

    // Tolerancia para el riesgo de punto flotante en JS (ej. 0.3 / 0.1 = 2.9999999999999996)
    const tolerancia = 1e-9;
    const piezas = Math.floor((existencia / consumoBase) + tolerancia);
    
    if (piezas < minPiezas) {
      minPiezas = piezas;
      limitanteId = consumo.insumo_id;
    }
  }

  if (minPiezas === Infinity) return null;

  return { piezas: minPiezas, insumo_limitante_id: limitanteId };
}
