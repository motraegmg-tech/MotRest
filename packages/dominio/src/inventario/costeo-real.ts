/**
 * Costeo ideal contra real (F2).
 *
 * El centinela de mermas responde «dónde se fuga el dinero» mirando lo que
 * alguien registró. Esto responde una pregunta distinta y más incómoda: **de lo
 * que se vendió, ¿cuánto insumo DEBIÓ salir del almacén, y cuánto salió de
 * verdad?** La diferencia es el consumo que nadie declaró.
 *
 * POR QUÉ ES DISTINTO DEL CENTINELA
 *
 * El centinela compara lo que se registró como merma o faltó en un conteo. Aquí
 * se compara contra la RECETA: si se vendieron 40 pizzas y cada una lleva 200 g
 * de masa, debieron salir 8 kg. Si salieron 9.5, hay kilo y medio que se fue
 * sin venderse y sin que nadie lo anotara. Ese número —la varianza— es el que
 * un restaurantero llama «se me está yendo el producto».
 *
 * LO QUE ESTA COMPARACIÓN NO PUEDE HACER
 *
 * Solo mide insumos que TIENEN receta. Un platillo capturado en modo simple
 * —costo final, sin ingredientes (ADR-16)— no dice qué consume, así que su
 * insumo no aparece aquí. Se informa cuántos productos quedaron fuera en vez de
 * dar por buena una varianza calculada a medias: creer que se controla lo que
 * no se mide es peor que saber que no se mide.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { renglonesActivos } from "../comanda/reducers.js";
import type { CatalogoIndex } from "../catalogo/productos.js";
import { aUnidadBase, insumosDeRenglones } from "./explosion.js";
import type { EventoInventario } from "./eventos.js";
import type { Insumo } from "./insumos.js";
import { valorDe } from "./reducers.js";

export interface VarianzaInsumo {
  insumo_id: ID;
  nombre: string;
  /** Lo que las recetas dicen que debió consumirse, en unidad base. */
  ideal: number;
  /** Lo que de verdad salió por consumo de receta. */
  real: number;
  /** real − ideal. Positivo = salió de más. */
  varianza: number;
  /** La varianza en dinero, al costo del insumo. */
  costo_varianza: Centavos;
  /** Varianza sobre lo ideal, como fracción. 0.15 = se fue un 15 % de más. */
  tasa: number;
}

export interface CosteoIdealReal {
  /** Un renglón por insumo con receta, del que más se desvía al que menos. */
  insumos: VarianzaInsumo[];
  costo_ideal: Centavos;
  costo_real: Centavos;
  /** Lo que costó la diferencia. Positivo = se gastó de más. */
  desviacion: Centavos;
  /**
   * Productos vendidos que NO tienen receta.
   *
   * Su consumo no se puede medir, y decirlo es parte del resultado: un food
   * cost «bajo control» calculado sobre la mitad de la carta no vale nada.
   */
  productos_sin_receta: number;
  /** true = ningún producto vendido tenía receta; no hay nada que comparar. */
  sin_datos: boolean;
}

/** Desde qué desviación conviene mirar un insumo. */
const UMBRAL_TASA = 0.05;

/**
 * Compara lo que las recetas dicen contra lo que el almacén registró.
 *
 * @param comandas Cuentas del periodo. Se usan sus renglones activos.
 * @param movimientos Movimientos del MISMO periodo.
 * @param catalogo Para explotar las recetas.
 * @param insumos Ficha de cada insumo, para su unidad base y su costo.
 */
export function costeoIdealReal(
  comandas: readonly EstadoComanda[],
  movimientos: readonly EventoInventario[],
  catalogo: CatalogoIndex,
  insumos: readonly Insumo[],
): CosteoIdealReal {
  const porId = new Map(insumos.map((i) => [i.id, i]));

  // 1. Lo IDEAL: explotar las recetas de todo lo vendido.
  const renglones = comandas.flatMap((c) => renglonesActivos(c));
  const consumos = insumosDeRenglones(renglones, catalogo);

  const ideal = new Map<ID, number>();
  for (const consumo of consumos) {
    const insumo = porId.get(consumo.insumo_id);
    if (!insumo) continue;
    // Se convierte a la unidad base; una conversión imposible se omite en vez
    // de inventarse, igual que al descontar el inventario.
    const enBase = aUnidadBase(consumo, insumo.unidad_base);
    if (enBase === null) continue;
    ideal.set(consumo.insumo_id, (ideal.get(consumo.insumo_id) ?? 0) + enBase);
  }

  // Cuántos productos vendidos no aportaron receta: es el límite del cálculo.
  const conReceta = new Set(consumos.map((c) => c.insumo_id));
  const productosVendidos = new Set(renglones.map((r) => r.producto_id));
  let sinReceta = 0;
  for (const productoId of productosVendidos) {
    const producto = catalogo.productos.get(productoId);
    if (!producto?.receta_id) sinReceta += 1;
  }

  /*
   * 2. Lo REAL: lo que de verdad salió por consumo de receta, NETO de lo que
   * volvió al almacén al cancelarse un platillo.
   *
   * El neteo no es un detalle: lo ideal se calcula sobre los renglones activos,
   * y un platillo cancelado ya no está ahí. Contar su consumo sin restar su
   * devolución habría dejado una varianza permanente —producto que «se fue» sin
   * venderse— por cada pizza que alguien mandó a cocina y luego canceló.
   */
  const real = new Map<ID, number>();
  for (const ev of movimientos) {
    if (ev.tipo !== "movimiento_inventario") continue;
    const signo =
      ev.motivo === "consumo_receta" ? 1 : ev.motivo === "reverso_receta" ? -1 : 0;
    if (signo === 0) continue;
    real.set(ev.insumo_id, (real.get(ev.insumo_id) ?? 0) + signo * Math.abs(ev.delta));
  }

  // 3. La comparación, solo sobre insumos que alguna receta declaró.
  const filas: VarianzaInsumo[] = [];
  let costoIdeal = CERO;
  let costoReal = CERO;

  for (const insumoId of conReceta) {
    const insumo = porId.get(insumoId);
    if (!insumo) continue;

    const i = ideal.get(insumoId) ?? 0;
    const r = real.get(insumoId) ?? 0;
    const varianza = r - i;

    costoIdeal = sumar(costoIdeal, valorDe(insumo, i));
    costoReal = sumar(costoReal, valorDe(insumo, r));

    filas.push({
      insumo_id: insumoId,
      nombre: insumo.nombre,
      ideal: Math.round(i * 100) / 100,
      real: Math.round(r * 100) / 100,
      varianza: Math.round(varianza * 100) / 100,
      costo_varianza: valorDe(insumo, varianza),
      tasa: i > 0 ? varianza / i : 0,
    });
  }

  // De la peor desviación en dinero a la mejor: es el orden en que se atiende.
  filas.sort((a, b) => b.costo_varianza - a.costo_varianza);

  return {
    insumos: filas,
    costo_ideal: costoIdeal,
    costo_real: costoReal,
    desviacion: (costoReal - costoIdeal) as Centavos,
    productos_sin_receta: sinReceta,
    sin_datos: filas.length === 0,
  };
}

/** ¿Este insumo se está desviando lo suficiente como para mirarlo? */
export function seDesvia(v: VarianzaInsumo): boolean {
  return Math.abs(v.tasa) >= UMBRAL_TASA;
}

/**
 * Qué explica una desviación, en una frase.
 *
 * Se dice en lenguaje de restaurante, no de sistema: quien lee esto está
 * decidiendo si hablar con la cocina o revisar la báscula.
 */
export function explicarVarianza(v: VarianzaInsumo): string {
  if (!seDesvia(v)) return "Dentro de lo normal.";
  if (v.varianza > 0) {
    return "Sale más de lo que las recetas piden: revisa el tamaño de las porciones, el desperdicio sin registrar y los derrames.";
  }
  return "Sale menos de lo que las recetas piden: puede que la receta esté mal capturada o que no se esté registrando todo el consumo.";
}
