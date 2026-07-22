/**
 * Existencias: proyección del inventario a partir de los movimientos.
 *
 * El stock de un insumo es la SUMA de sus deltas. Nada se sobrescribe, así que
 * el histórico siempre explica el número: se puede auditar de dónde salió cada
 * unidad, que es justo lo que necesita el Centinela de mermas (C5).
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoInventario, MotivoMovimiento } from "./eventos.js";
import type { Insumo } from "./insumos.js";

export interface Existencia {
  insumo_id: ID;
  /** Cantidad disponible, en la unidad base del insumo. */
  cantidad: number;
  /** Movimientos registrados, para explicar el número. */
  movimientos: number;
  /** Última vez que se movió. */
  ultimo_ts?: number;
}

/** Consumo acumulado por motivo, para medir la merma. */
export type ConsumoPorMotivo = Partial<Record<MotivoMovimiento, number>>;

export function proyectarExistencias(
  eventos: readonly EventoInventario[],
): Map<ID, Existencia> {
  const existencias = new Map<ID, Existencia>();

  const tocar = (insumoId: ID, ts: number): Existencia => {
    const previa = existencias.get(insumoId) ?? {
      insumo_id: insumoId,
      cantidad: 0,
      movimientos: 0,
    };
    const actual = { ...previa, movimientos: previa.movimientos + 1, ultimo_ts: ts };
    existencias.set(insumoId, actual);
    return actual;
  };

  for (const ev of eventos) {
    if (ev.tipo === "movimiento_inventario") {
      const actual = tocar(ev.insumo_id, ev.ts);
      actual.cantidad += ev.delta;
    } else {
      // Un conteo fija la existencia: el delta es la diferencia contra lo esperado.
      for (const linea of ev.lineas) {
        const actual = tocar(linea.insumo_id, ev.ts);
        actual.cantidad = linea.contado;
      }
    }
  }

  return existencias;
}

export function existenciaDe(
  existencias: ReadonlyMap<ID, Existencia>,
  insumoId: ID,
): number {
  return existencias.get(insumoId)?.cantidad ?? 0;
}

/** Insumos por debajo de su mínimo: la lista de lo que hay que reponer. */
export function porReponer(
  insumos: readonly Insumo[],
  existencias: ReadonlyMap<ID, Existencia>,
): { insumo: Insumo; cantidad: number; faltante: number }[] {
  return insumos
    .map((insumo) => {
      const cantidad = existenciaDe(existencias, insumo.id);
      return { insumo, cantidad, faltante: insumo.stock_minimo - cantidad };
    })
    .filter((x) => x.faltante > 0)
    .sort((a, b) => b.faltante - a.faltante);
}

/**
 * Insumos con existencia negativa. NO bloquean la venta: se señalan para que
 * alguien haga un conteo (TRD §5.1).
 */
export function enNegativo(
  existencias: ReadonlyMap<ID, Existencia>,
): Existencia[] {
  return [...existencias.values()].filter((e) => e.cantidad < 0);
}

/**
 * Cuánto vale a costo una cantidad de un insumo.
 *
 * El costo unitario es exacto en centavos, pero la cantidad puede ser
 * fraccionaria (350 g de masa), así que el producto se cierra al centavo:
 * medio centavo no existe.
 */
export function valorDe(insumo: Insumo, cantidad: number): Centavos {
  return Math.round(cantidad * insumo.costo_unitario) as Centavos;
}

/** Valor del inventario a costo. Lo negativo no vale dinero: se toma como cero. */
export function valorInventario(
  insumos: readonly Insumo[],
  existencias: ReadonlyMap<ID, Existencia>,
): Centavos {
  return sumar(
    ...insumos.map((i) => valorDe(i, Math.max(0, existenciaDe(existencias, i.id)))),
  );
}

/** Cuánto se ha ido por cada motivo, en un periodo. */
export function consumoPorMotivo(
  eventos: readonly EventoInventario[],
  insumoId?: ID,
): ConsumoPorMotivo {
  const acumulado: ConsumoPorMotivo = {};
  for (const ev of eventos) {
    if (ev.tipo !== "movimiento_inventario") continue;
    if (insumoId && ev.insumo_id !== insumoId) continue;
    acumulado[ev.motivo] = (acumulado[ev.motivo] ?? 0) + Math.abs(ev.delta);
  }
  return acumulado;
}

/** Costo de la merma registrada, que es la base del cobro por ahorro verificado. */
export function costoMerma(
  eventos: readonly EventoInventario[],
  insumos: readonly Insumo[],
): Centavos {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  let total = CERO;
  for (const ev of eventos) {
    if (ev.tipo !== "movimiento_inventario" || ev.motivo !== "merma") continue;
    const insumo = porId.get(ev.insumo_id);
    if (!insumo) continue;
    total = sumar(total, valorDe(insumo, Math.abs(ev.delta)));
  }
  return total;
}
