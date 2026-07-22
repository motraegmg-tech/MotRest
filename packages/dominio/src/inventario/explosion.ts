/**
 * Explosión de lo vendido a insumos consumidos.
 *
 * Es el puente entre la venta y el almacén: al enviar un platillo a cocina, se
 * calcula qué insumos se van y se registran como movimientos. Solo cuenta lo
 * que declara su vínculo con el almacén — un restaurante que no captura
 * insumos simplemente no descuenta nada, y el POS funciona igual.
 */
import type { ID } from "../comun/ids.js";
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
 * Insumos que consume un renglón ya capturado.
 *
 * Considera las tres formas de armar un platillo:
 *  - producto simple con receta;
 *  - producto configurable, sumando la receta de cada porción por su fracción;
 *  - modificadores que agregan o quitan insumos (llegan con la etapa avanzada).
 */
export function insumosDeRenglon(
  renglon: RenglonComanda,
  cat: CatalogoIndex,
): ConsumoInsumo[] {
  const consumos: ConsumoInsumo[] = [];
  const cantidad = renglon.cantidad;

  if (renglon.porciones?.length) {
    for (const porcion of renglon.porciones) {
      const variedad = cat.productos.get(porcion.producto_id);
      if (!variedad?.receta_id) continue;
      consumos.push(...deReceta(variedad.receta_id, porcion.fraccion * cantidad, cat));
    }
  } else {
    const producto = cat.productos.get(renglon.producto_id);
    if (producto?.receta_id) {
      consumos.push(...deReceta(producto.receta_id, cantidad, cat));
    }
  }

  return acumular(consumos);
}

/** Insumos que consume un conjunto de renglones (lo que se manda a cocina). */
export function insumosDeRenglones(
  renglones: readonly RenglonComanda[],
  cat: CatalogoIndex,
): ConsumoInsumo[] {
  return acumular(renglones.flatMap((r) => insumosDeRenglon(r, cat)));
}

/**
 * Convierte un consumo a la unidad base del insumo.
 * Devuelve null si las unidades no son convertibles entre sí: mezclar gramos
 * con mililitros exige una densidad que el software no puede inventar.
 */
export function aUnidadBase(
  consumo: ConsumoInsumo,
  unidadBase: Unidad,
): number | null {
  return convertir(consumo.cantidad, consumo.unidad, unidadBase);
}
