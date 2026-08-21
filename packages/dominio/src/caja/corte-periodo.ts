/**
 * El corte de varios turnos juntos: un día pasado, o los últimos tres.
 *
 * ## Por qué existe
 *
 * El corte de caja del turno solo se podía imprimir en el instante de cerrarlo.
 * Si el papel se atascaba, si nadie lo recogió, o si el dueño quiere el corte
 * del viernes pasado un lunes por la mañana, no había forma de volver a sacarlo:
 * las cifras estaban en el registro, pero no había pantalla que las pidiera.
 *
 * ## Qué NO hace, a propósito
 *
 * No vuelve a calcular dinero. Cada turno ya tiene su `CorteCaja` calculado por
 * `calcularCorte`, y esto solo los SUMA. Si el corte del turno y el del período
 * discreparan, sería imposible saber cuál miente — así que solo hay una
 * aritmética, y vive en un sitio.
 *
 * Tampoco vuelve a sellar. El sello de un turno cerrado es el que se firmó en su
 * momento; un corte de período es un informe, no un arqueo, y por eso arrastra
 * los sellos de los turnos que resume en vez de inventarse uno nuevo.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { FormaPago } from "../comanda/eventos.js";
import type { CategoriaEgreso, RegistroEgreso } from "../finanzas/egresos.js";
import { CATEGORIAS_EGRESO } from "../finanzas/egresos.js";
import type { CorteCaja, EstadoCaja } from "./reducers.js";
import type { VentasPorForma } from "./eventos.js";

/** Un turno ya calculado, tal como lo devuelve `calcularCorte`. */
export interface TurnoDelPeriodo {
  sesion: EstadoCaja;
  corte: CorteCaja;
}

/** Un movimiento de efectivo, con de qué turno salió. */
export interface MovimientoDelPeriodo {
  ts: number;
  motivo: string;
  concepto: string;
  /** Negativo = salió del cajón. */
  monto: Centavos;
}

/** Un turno resumido, para la lista del papel. */
export interface TurnoResumido {
  sesion_id: ID;
  folio: string;
  cajero_id: ID;
  abierta_ts: number;
  cerrada_ts?: number;
  cerrada: boolean;
  total_vendido: Centavos;
  efectivo_esperado: Centavos;
  declarado?: Centavos;
  diferencia?: Centavos;
  sello?: string;
}

export interface GastoPorCategoria {
  categoria: CategoriaEgreso;
  nombre: string;
  monto: Centavos;
}

export interface CortePeriodo {
  desde: number;
  hasta: number;

  /** Turnos que caen en el rango, del más antiguo al más nuevo. */
  turnos: TurnoResumido[];
  /**
   * Turnos incluidos que TODAVÍA no se han cerrado.
   *
   * Se cuentan aparte porque sus cifras aún se mueven: un corte de período que
   * incluya el turno en curso no es un documento definitivo, y el papel tiene
   * que decirlo en vez de aparentar que sí.
   */
  turnos_abiertos: number;

  /** Suma de los fondos con que se abrió cada turno. */
  fondo_inicial: Centavos;

  /** Lo que ENTRÓ por cada forma de pago, propina incluida. */
  cobrado_por_forma: VentasPorForma;
  total_cobrado: Centavos;

  /** La venta por forma, ya sin propina. */
  ventas_por_forma: VentasPorForma;
  total_vendido: Centavos;

  propinas: Centavos;

  /** Movimientos de efectivo ajenos a la venta, uno por uno. */
  movimientos: MovimientoDelPeriodo[];
  /** Su suma. Negativa si salió más de lo que entró. */
  total_movimientos: Centavos;

  /** Gastos registrados en Finanzas dentro del rango. */
  gastos: GastoPorCategoria[];
  total_gastos: Centavos;

  /** Cuentas cerradas: las transacciones del período. */
  cuentas_cerradas: number;

  efectivo_ventas: Centavos;
  efectivo_esperado: Centavos;
  /** Lo contado por los cajeros en los turnos YA cerrados. */
  declarado: Centavos;
  /** Declarado − esperado, solo de los turnos cerrados. */
  diferencia: Centavos;
}

/** El folio corto de un turno, el mismo que va en el corte del turno. */
export function folioDeSesion(sesionId: ID): string {
  return sesionId.slice(0, 8).toUpperCase();
}

/**
 * ¿Este turno cae dentro del rango?
 *
 * Se mide por la APERTURA, no por el cierre. Un turno que abre a las 20:00 del
 * viernes y cierra a las 02:00 del sábado es el corte del viernes: así lo
 * entiende quien lo pide, y así cuadra con el efectivo que se contó esa noche.
 */
export function turnoEnRango(sesion: EstadoCaja, desde: number, hasta: number): boolean {
  return sesion.abierta_ts >= desde && sesion.abierta_ts < hasta;
}

function acumularPorForma(destino: VentasPorForma, origen: VentasPorForma): void {
  for (const [forma, monto] of Object.entries(origen) as [FormaPago, Centavos][]) {
    if (monto === undefined) continue;
    destino[forma] = sumar(destino[forma] ?? CERO, monto);
  }
}

/**
 * Suma los turnos de un período y les añade los gastos registrados.
 *
 * `egresos` ya viene filtrado al rango y sin anulados (`egresosEn`): esta
 * función no decide qué gasto cuenta, solo lo agrupa por categoría.
 */
export function consolidarCortes(
  turnos: readonly TurnoDelPeriodo[],
  egresos: readonly RegistroEgreso[],
  rango: { desde: number; hasta: number },
): CortePeriodo {
  const ordenados = [...turnos].sort((a, b) => a.sesion.abierta_ts - b.sesion.abierta_ts);

  const cobrado_por_forma: VentasPorForma = {};
  const ventas_por_forma: VentasPorForma = {};
  const movimientos: MovimientoDelPeriodo[] = [];

  let fondo_inicial = CERO;
  let total_cobrado = CERO;
  let total_vendido = CERO;
  let propinas = CERO;
  let efectivo_ventas = CERO;
  let efectivo_esperado = CERO;
  let declarado = CERO;
  let diferencia = CERO;
  let cuentas_cerradas = 0;
  let turnos_abiertos = 0;

  const resumidos: TurnoResumido[] = [];

  for (const { sesion, corte } of ordenados) {
    fondo_inicial = sumar(fondo_inicial, sesion.fondo_inicial);
    acumularPorForma(cobrado_por_forma, corte.cobrado);
    acumularPorForma(ventas_por_forma, corte.ventas);
    total_cobrado = sumar(total_cobrado, corte.totalCobrado);
    total_vendido = sumar(total_vendido, corte.totalVendido);
    propinas = sumar(propinas, corte.propinas);
    efectivo_ventas = sumar(efectivo_ventas, corte.efectivoVentas);
    efectivo_esperado = sumar(efectivo_esperado, corte.efectivoEsperado);
    cuentas_cerradas += corte.cuentasCerradas;

    /*
     * Solo los turnos CERRADOS aportan al arqueo.
     *
     * Un turno abierto no tiene declarado: contarlo como cero convertiría todo
     * el efectivo del turno en curso en un faltante enorme, y el papel diría que
     * falta dinero que en realidad está en el cajón.
     */
    if (sesion.cerrada) {
      declarado = sumar(declarado, sesion.declarado ?? CERO);
      diferencia = sumar(diferencia, sesion.diferencia ?? CERO);
    } else {
      turnos_abiertos += 1;
    }

    for (const mov of sesion.movimientos) {
      movimientos.push({
        ts: mov.ts,
        motivo: mov.motivo,
        concepto: mov.concepto,
        monto: mov.monto,
      });
    }

    resumidos.push({
      sesion_id: sesion.sesion_id,
      folio: folioDeSesion(sesion.sesion_id),
      cajero_id: sesion.cajero_id,
      abierta_ts: sesion.abierta_ts,
      cerrada_ts: sesion.cerrada_ts,
      cerrada: sesion.cerrada,
      total_vendido: corte.totalVendido,
      efectivo_esperado: corte.efectivoEsperado,
      declarado: sesion.declarado,
      diferencia: sesion.diferencia,
      sello: sesion.sello,
    });
  }

  movimientos.sort((a, b) => a.ts - b.ts);
  const total_movimientos = sumar(...movimientos.map((m) => m.monto));

  const gastos: GastoPorCategoria[] = CATEGORIAS_EGRESO.map((def) => ({
    categoria: def.id,
    nombre: def.nombre,
    monto: sumar(...egresos.filter((e) => e.categoria === def.id).map((e) => e.monto)),
  })).filter((g) => g.monto > 0);

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    turnos: resumidos,
    turnos_abiertos,
    fondo_inicial,
    cobrado_por_forma,
    total_cobrado,
    ventas_por_forma,
    total_vendido,
    propinas,
    movimientos,
    total_movimientos,
    gastos,
    total_gastos: sumar(...gastos.map((g) => g.monto)),
    cuentas_cerradas,
    efectivo_ventas,
    efectivo_esperado,
    declarado,
    diferencia,
  };
}
