/**
 * Gemelo digital: simulador de escenarios (capacidad C1).
 *
 * Responde la pregunta que un dueño se hace todo el tiempo y hoy contesta a
 * corazonada: **"¿y si le subo diez pesos a la pizza?"**. Toma lo que de verdad
 * se vendió en el periodo, le aplica el cambio y dice cuánto más —o menos— deja.
 *
 * LA MENTIRA QUE ESTE MÓDULO NO CUENTA
 *
 * Si subes el precio 10 %, ¿vendes lo mismo? Casi nunca. Y cuánto menos vendes
 * —la elasticidad— NO se puede saber desde el punto de venta: haría falta haber
 * probado ese precio. Un simulador que asume volumen constante siempre da
 * ganancia y siempre miente a favor; es exactamente la clase de número que
 * quemaría la credibilidad del cobro por resultado.
 *
 * Así que aquí se hacen dos cosas en vez de inventar una elasticidad:
 *
 *   1. El escenario se calcula con el cambio de volumen que TÚ supongas. Si no
 *      supones ninguno, se dice explícitamente que es a volumen constante.
 *   2. Se calcula el **punto de equilibrio**: cuánta venta puedes perder antes
 *      de que el cambio deje de convenir. Ese número es aritmética exacta, no
 *      un pronóstico, y es el que de verdad sirve para decidir.
 */
import { CERO, restar, sumar, deCentavos, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { VentaProducto } from "./reportes.js";

/** Los cambios que se quieren probar. Todo en porcentaje: +10 = subir 10 %. */
export interface Palancas {
  /** Solo este producto. Sin él, el cambio aplica a toda la carta. */
  producto_id?: ID;
  precio_pct?: number;
  costo_pct?: number;
  /** Cuánto supones que se moverá el volumen. Es un SUPUESTO tuyo, no un pronóstico. */
  volumen_pct?: number;
}

export interface RenglonEscenario {
  producto_id: ID;
  descripcion: string;
  /** true = a este renglón le pegó el cambio. */
  afectado: boolean;
  unidades_base: number;
  unidades_sim: number;
  precio_base: Centavos;
  precio_sim: Centavos;
  margen_base: Centavos;
  margen_sim: Centavos;
  delta: Centavos;
  /**
   * Cuánta venta puede caer antes de que el cambio deje de convenir, como
   * fracción (0.14 = puedes vender 14 % menos y seguir igual).
   *
   * `null` cuando no aplica: si no se tocó el precio, o si el precio nuevo ya no
   * cubre el costo —ahí no hay volumen que salve la decisión—.
   */
  caida_tolerable: number | null;
}

export interface Escenario {
  renglones: RenglonEscenario[];
  margen_base: Centavos;
  margen_sim: Centavos;
  delta: Centavos;
  /** Variación del margen como fracción. */
  delta_pct: number;
  /** true = no se supuso ningún cambio de volumen. */
  volumen_constante: boolean;
  /** Proyección del delta a 30 días, si se supo cuántos días cubre el periodo. */
  delta_mensual: Centavos | null;
}

/** Un porcentaje (+10) al factor por el que se multiplica (1.10). */
function factor(pct: number | undefined): number {
  return 1 + (pct ?? 0) / 100;
}

/**
 * Cuánta venta se puede perder antes de que el cambio deje de convenir.
 *
 * Se despeja de: unidades' × (precio' − costo) ≥ unidades × (precio − costo).
 * Es aritmética exacta sobre el margen unitario, no un pronóstico de demanda.
 */
export function caidaTolerable(
  precioBase: number,
  precioSim: number,
  costoUnitario: number,
): number | null {
  const margenBase = precioBase - costoUnitario;
  const margenSim = precioSim - costoUnitario;

  // Sin cambio de precio no hay nada que tolerar; y si el precio nuevo no cubre
  // el costo, ningún volumen arregla la decisión.
  if (precioSim === precioBase || margenSim <= 0) return null;
  // Bajar el precio no da holgura de volumen: exige vender MÁS, no menos.
  if (margenSim < margenBase) return null;

  const proporcion = margenBase / margenSim;
  return Math.max(0, 1 - proporcion);
}

/**
 * Corre el escenario sobre lo que de verdad se vendió.
 *
 * @param ventas Lo vendido en el periodo, por producto.
 * @param palancas Qué se quiere cambiar.
 * @param opciones `dias` = cuántos días cubre el periodo, para proyectar a mes.
 */
export function simular(
  ventas: readonly VentaProducto[],
  palancas: Palancas,
  opciones: { dias?: number } = {},
): Escenario {
  const fp = factor(palancas.precio_pct);
  const fc = factor(palancas.costo_pct);
  const fv = factor(palancas.volumen_pct);

  const renglones: RenglonEscenario[] = ventas.map((v) => {
    const afectado = !palancas.producto_id || palancas.producto_id === v.producto_id;

    /*
     * Precio y costo unitarios PROMEDIO del periodo: un mismo producto pudo
     * venderse con descuento en unas cuentas y sin él en otras.
     *
     * Se toma `base` y no `importe`: el simulador compara márgenes, y el IVA no
     * es ingreso del restaurante. Usar el importe con impuesto inflaría un 16 %
     * el margen de cada escenario y todas las decisiones que salen de aquí.
     */
    const precioUnit = v.unidades > 0 ? v.base / v.unidades : 0;
    const costoUnit = v.unidades > 0 ? v.costo / v.unidades : 0;

    const precioSim = afectado ? precioUnit * fp : precioUnit;
    const costoSim = afectado ? costoUnit * fc : costoUnit;
    const unidadesSim = afectado ? v.unidades * fv : v.unidades;

    const margenSim = deCentavos(Math.round(unidadesSim * (precioSim - costoSim)));

    return {
      producto_id: v.producto_id,
      descripcion: v.descripcion,
      afectado,
      unidades_base: v.unidades,
      unidades_sim: Math.round(unidadesSim * 100) / 100,
      precio_base: deCentavos(Math.round(precioUnit)),
      precio_sim: deCentavos(Math.round(precioSim)),
      margen_base: v.margen,
      margen_sim: margenSim,
      delta: restar(margenSim, v.margen),
      // El equilibrio se mide contra el costo SIMULADO: es el que se pagará.
      caida_tolerable: afectado ? caidaTolerable(precioUnit, precioSim, costoSim) : null,
    };
  });

  const margen_base = sumar(...renglones.map((r) => r.margen_base));
  const margen_sim = sumar(...renglones.map((r) => r.margen_sim));
  const delta = restar(margen_sim, margen_base);

  const dias = opciones.dias;
  const delta_mensual =
    dias && dias > 0 ? deCentavos(Math.round((delta / dias) * 30)) : null;

  return {
    renglones,
    margen_base,
    margen_sim,
    delta,
    delta_pct: margen_base !== 0 ? delta / Math.abs(margen_base) : 0,
    volumen_constante: (palancas.volumen_pct ?? 0) === 0,
    delta_mensual,
  };
}

/**
 * Cuánto rendiría bajar la merma un porcentaje.
 *
 * Es el escenario más directo de todos —lo que no se tira, se queda— y el que
 * sostiene el cobro por ahorro verificado: se mide contra la fuga que el
 * centinela ya detectó, no contra una promesa.
 */
export function ahorroPorMerma(
  perdidaActual: Centavos,
  reduccionPct: number,
  opciones: { dias?: number } = {},
): { ahorro: Centavos; ahorro_mensual: Centavos | null } {
  const ahorro = deCentavos(
    Math.round(perdidaActual * Math.min(100, Math.max(0, reduccionPct)) / 100),
  );
  const dias = opciones.dias;
  return {
    ahorro,
    ahorro_mensual: dias && dias > 0 ? deCentavos(Math.round((ahorro / dias) * 30)) : null,
  };
}

/** El escenario vacío, para cuando todavía no hay ventas que simular. */
export function escenarioVacio(): Escenario {
  return {
    renglones: [],
    margen_base: CERO,
    margen_sim: CERO,
    delta: CERO,
    delta_pct: 0,
    volumen_constante: true,
    delta_mensual: null,
  };
}
