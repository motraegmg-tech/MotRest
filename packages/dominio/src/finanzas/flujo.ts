/**
 * El flujo del dinero: todo lo que entró y salió, en una sola lista.
 *
 * ## Por qué hace falta reunirlo
 *
 * El dinero de un restaurante se mueve en cuatro sitios distintos del sistema:
 * los cobros viven en las comandas, los gastos en su propio registro, los
 * retiros en la sesión de caja y los depósitos al banco en tesorería. Cada uno
 * respondía bien a su pregunta y ninguno respondía la del dueño: **«¿cuánto
 * dinero tengo?»**.
 *
 * Este módulo no inventa cifras nuevas. Traduce los cuatro orígenes a un mismo
 * renglón —fecha, cuenta, concepto, importe con signo— y los pone en orden. El
 * saldo es la suma de esa lista, así que **cada peso del saldo se puede señalar
 * con el dedo hasta el hecho que lo puso ahí**.
 *
 * ## La regla que evita contar dos veces
 *
 * Un peso entra UNA vez, por su forma de pago. La venta cobrada con tarjeta
 * suma al banco y no al efectivo; el gasto pagado en efectivo resta del cajón y
 * no del banco. El fondo inicial del turno NO suma: no es dinero nuevo, es
 * dinero del restaurante que se pasa al cajón, y contarlo sería inventar tanto
 * dinero como turnos se hayan abierto.
 *
 * Por la misma razón la propina SÍ entra: está físicamente en el cajón hasta
 * que se reparte, y esconderla haría que el arqueo nunca cuadrara. Sale después
 * como su propio movimiento el día que se entrega.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { etiquetaFormaPago } from "../comanda/eventos.js";
import type { EstadoCaja } from "../caja/reducers.js";
import type { RegistroEgreso } from "./egresos.js";
import { categoriaDe } from "./egresos.js";
import {
  cuentaDeFormaPago,
  movimientosDeTesoreria,
  saldosDe,
  type EventoTesoreria,
  type MovimientoDinero,
  type SaldosTesoreria,
} from "./tesoreria.js";

/** Todo lo que hace falta para reconstruir el dinero del restaurante. */
export interface FuentesDeFlujo {
  /** Todas las comandas, cerradas y canceladas incluidas. */
  comandas: readonly EstadoComanda[];
  /** Los gastos proyectados, anulados incluidos: aquí se filtran. */
  egresos: readonly RegistroEgreso[];
  /** Las sesiones de caja, por sus movimientos manuales de efectivo. */
  sesiones: readonly EstadoCaja[];
  /** Depósitos, retiros del banco y ajustes justificados. */
  tesoreria: readonly EventoTesoreria[];
}

/**
 * Los cobros de las cuentas cerradas, cada uno a su cuenta.
 *
 * Se toma el pago tal como se registró —con su forma y su importe— y no el
 * total de la cuenta: una cuenta dividida entre efectivo y tarjeta reparte el
 * dinero entre las dos cuentas, y solo los pagos lo saben.
 */
function movimientosDeVentas(comandas: readonly EstadoComanda[]): MovimientoDinero[] {
  const renglones: MovimientoDinero[] = [];

  for (const c of comandas) {
    if (!c.cerrada) continue;

    const folio = c.orden_id.slice(-8).toUpperCase();
    const cuando = c.cerrada_ts ?? c.abierta_ts;

    c.pagos.forEach((pago, i) => {
      renglones.push({
        id: `${c.orden_id}:pago:${i}`,
        ts: cuando,
        cuenta: cuentaDeFormaPago(pago.forma),
        origen: "venta",
        concepto: `Cuenta ${folio} · ${etiquetaFormaPago(pago.forma)}`,
        monto: pago.monto,
        empleado_id: c.mesero_id,
        referencia: pago.referencia,
      });
    });

    /*
     * La devolución de una venta cancelada sale el día que se devuelve, no el
     * día que se cobró. Es el mismo criterio del corte de caja: quien cuenta
     * los billetes esta noche encontrará de menos lo que se regresó hoy.
     */
    (c.devoluciones ?? []).forEach((d, i) => {
      renglones.push({
        id: `${c.orden_id}:devolucion:${i}`,
        ts: c.cancelada_ts ?? cuando,
        cuenta: cuentaDeFormaPago(d.forma),
        origen: "devolucion",
        concepto: `Venta cancelada ${folio} · ${etiquetaFormaPago(d.forma)}`,
        monto: -d.monto as Centavos,
        empleado_id: c.mesero_id,
      });
    });
  }

  return renglones;
}

/**
 * Los gastos, el día que SALIÓ el dinero.
 *
 * Un gasto a crédito no mueve nada al registrarse: la deuda no baja el saldo,
 * lo baja el pago. Por eso se mira `pagado_ts` y no `ts`, y los que siguen sin
 * pagarse no aparecen en esta lista — aparecen en cuentas por pagar, que es
 * otra pregunta.
 */
function movimientosDeEgresos(egresos: readonly RegistroEgreso[]): MovimientoDinero[] {
  return egresos
    .filter((e) => !e.anulado && e.pagado)
    .map((e) => ({
      id: `egreso:${e.egreso_id}`,
      ts: e.pagado_ts ?? e.ts,
      cuenta: cuentaDeFormaPago(e.forma_pago),
      origen: "gasto" as const,
      concepto: `${categoriaDe(e.categoria).nombre} · ${e.concepto}`,
      monto: -e.monto as Centavos,
      empleado_id: e.empleado_id,
      referencia: e.folio_comprobante ?? e.referencia_pago,
    }));
}

/**
 * Los movimientos manuales del cajón que NO son gastos ni ventas.
 *
 * Traer cambio del banco, guardar la venta en la caja fuerte a media noche. El
 * fondo inicial queda fuera a propósito: ver la nota de arriba.
 */
function movimientosDeCaja(sesiones: readonly EstadoCaja[]): MovimientoDinero[] {
  const renglones: MovimientoDinero[] = [];

  for (const s of sesiones) {
    s.movimientos.forEach((m, i) => {
      renglones.push({
        id: `${s.sesion_id}:mov:${i}`,
        ts: m.ts,
        cuenta: "efectivo",
        origen: "movimiento_caja",
        concepto: m.concepto,
        monto: m.monto,
        empleado_id: m.autorizador_id ?? s.cajero_id,
      });
    });
  }

  return renglones;
}

/**
 * La lista completa, ordenada del movimiento más antiguo al más nuevo.
 *
 * Ese orden importa: es el que permite arrastrar un saldo renglón por renglón
 * y ver en qué momento exacto el dinero dejó de cuadrar.
 */
export function flujoDeDinero(fuentes: FuentesDeFlujo): MovimientoDinero[] {
  return [
    ...movimientosDeVentas(fuentes.comandas),
    ...movimientosDeEgresos(fuentes.egresos),
    ...movimientosDeCaja(fuentes.sesiones),
    ...movimientosDeTesoreria(fuentes.tesoreria),
  ].sort((a, b) => a.ts - b.ts);
}

/** Los dos saldos del restaurante, ahora mismo. */
export function saldosDelRestaurante(fuentes: FuentesDeFlujo): SaldosTesoreria {
  return saldosDe(flujoDeDinero(fuentes));
}

// --- El renglón con su saldo arrastrado ---------------------------------------------

/** Un movimiento y cómo dejó el saldo de su cuenta. */
export interface RenglonConSaldo extends MovimientoDinero {
  /** El saldo de ESA cuenta después de aplicar este renglón. */
  saldo: Centavos;
}

/**
 * Arrastra el saldo de cada cuenta a lo largo de la lista.
 *
 * Es la columna que convierte un listado de movimientos en un estado de cuenta:
 * sin ella hay que ir sumando con el dedo para saber si el faltante empezó el
 * martes o el jueves.
 */
export function conSaldoArrastrado(
  movimientos: readonly MovimientoDinero[],
  inicial: SaldosTesoreria,
): RenglonConSaldo[] {
  let efectivo = inicial.efectivo;
  let banco = inicial.banco;

  return [...movimientos]
    .sort((a, b) => a.ts - b.ts)
    .map((m) => {
      if (m.cuenta === "efectivo") {
        efectivo = sumar(efectivo, m.monto);
        return { ...m, saldo: efectivo };
      }
      banco = sumar(banco, m.monto);
      return { ...m, saldo: banco };
    });
}

// --- Resumen del período ---------------------------------------------------------------

export interface ResumenFlujo {
  desde: number;
  hasta: number;
  /** Con lo que se empezó el período. */
  inicial: SaldosTesoreria;
  /** Con lo que se terminó. */
  final: SaldosTesoreria;
  entradas: Centavos;
  salidas: Centavos;
  /** Entradas − salidas. Lo que creció (o menguó) el dinero del restaurante. */
  neto: Centavos;
  movimientos: RenglonConSaldo[];
}

/**
 * El movimiento del dinero en un período, con el saldo de entrada y el de salida.
 *
 * El saldo inicial se calcula con TODA la historia anterior, no con el período:
 * decir «el mes empezó en cero» cuando había cuarenta mil pesos en la caja
 * fuerte convertiría el informe en ficción.
 */
export function resumenDeFlujo(
  fuentes: FuentesDeFlujo,
  rango: { desde: number; hasta: number },
): ResumenFlujo {
  const todos = flujoDeDinero(fuentes);
  const inicial = saldosDe(todos.filter((m) => m.ts < rango.desde));
  const delPeriodo = todos.filter((m) => m.ts >= rango.desde && m.ts < rango.hasta);

  const entradas = sumar(...delPeriodo.filter((m) => m.monto > 0).map((m) => m.monto));
  const salidas = sumar(
    ...delPeriodo.filter((m) => m.monto < 0).map((m) => -m.monto as Centavos),
  );
  const movimientos = conSaldoArrastrado(delPeriodo, inicial);
  const cambio = saldosDe(delPeriodo);

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    inicial,
    final: {
      efectivo: sumar(inicial.efectivo, cambio.efectivo),
      banco: sumar(inicial.banco, cambio.banco),
      total: sumar(inicial.total, cambio.total),
    },
    entradas,
    salidas,
    neto: (entradas - salidas) as Centavos,
    movimientos,
  };
}

/** Resumen vacío, para cuando todavía no hay nada que contar. */
export function flujoVacio(rango: { desde: number; hasta: number }): ResumenFlujo {
  const vacio: SaldosTesoreria = { efectivo: CERO, banco: CERO, total: CERO };
  return {
    desde: rango.desde,
    hasta: rango.hasta,
    inicial: vacio,
    final: vacio,
    entradas: CERO,
    salidas: CERO,
    neto: CERO,
    movimientos: [],
  };
}
