/**
 * Proyección de la sesión de caja y cálculo del corte del turno.
 *
 * El efectivo esperado se arma con el fondo inicial, más lo cobrado en efectivo,
 * más los movimientos manuales. La diferencia contra lo declarado es lo que el
 * gerente revisa al cerrar.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoComanda, FormaPago } from "../comanda/eventos.js";
import type { EventoCaja, MotivoMovimientoCaja, VentasPorForma } from "./eventos.js";

export interface Movimiento {
  motivo: MotivoMovimientoCaja;
  monto: Centavos;
  concepto: string;
  autorizador_id?: ID;
  ts: number;
}

export interface EstadoCaja {
  sesion_id: ID;
  cajero_id: ID;
  abierta_ts: number;
  fondo_inicial: Centavos;
  movimientos: Movimiento[];
  cerrada: boolean;
  declarado?: Centavos;
  diferencia?: Centavos;
}

export function aplicarEventoCaja(
  estado: EstadoCaja | null,
  ev: EventoCaja,
): EstadoCaja {
  if (ev.tipo === "caja_abierta") {
    return {
      sesion_id: ev.sesion_id,
      cajero_id: ev.cajero_id,
      abierta_ts: ev.ts,
      fondo_inicial: ev.fondo_inicial,
      movimientos: [],
      cerrada: false,
    };
  }

  if (!estado) {
    throw new Error(`Evento "${ev.tipo}" sin sesión de caja: falta caja_abierta`);
  }

  switch (ev.tipo) {
    case "movimiento_efectivo":
      return {
        ...estado,
        movimientos: [
          ...estado.movimientos,
          {
            motivo: ev.motivo,
            monto: ev.monto,
            concepto: ev.concepto,
            autorizador_id: ev.autorizador_id,
            ts: ev.ts,
          },
        ],
      };

    case "arqueo_registrado":
      return { ...estado, declarado: ev.declarado };

    case "caja_cerrada":
      return { ...estado, cerrada: true, diferencia: ev.diferencia };

    default: {
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

export function proyectarCaja(eventos: readonly EventoCaja[]): EstadoCaja | null {
  let estado: EstadoCaja | null = null;
  for (const ev of eventos) estado = aplicarEventoCaja(estado, ev);
  return estado;
}

// --- Corte del turno ------------------------------------------------------------

export interface CorteCaja {
  /** Ventas cobradas durante el turno, por forma de pago. */
  ventas: VentasPorForma;
  /** Total vendido, todas las formas. */
  totalVendido: Centavos;
  /** Solo lo cobrado en efectivo. */
  efectivoVentas: Centavos;
  fondoInicial: Centavos;
  /** Entradas y salidas manuales de efectivo (retiros en negativo). */
  movimientos: Centavos;
  /** Lo que debería haber en el cajón. */
  efectivoEsperado: Centavos;
  propinas: Centavos;
  /** Cuentas cerradas en el turno. */
  cuentasCerradas: number;
}

/**
 * Calcula el corte a partir de la sesión y de los pagos del turno.
 * Los pagos llegan como eventos de comanda, porque es ahí donde se registran.
 */
export function calcularCorte(
  caja: EstadoCaja,
  eventosComanda: readonly EventoComanda[],
): CorteCaja {
  const ventas: VentasPorForma = {};
  let totalVendido = CERO;
  let efectivoVentas = CERO;
  let propinas = CERO;
  let cuentasCerradas = 0;

  for (const ev of eventosComanda) {
    if (ev.tipo === "pago_registrado") {
      const forma: FormaPago = ev.forma;
      ventas[forma] = sumar(ventas[forma] ?? CERO, ev.monto);
      totalVendido = sumar(totalVendido, ev.monto);
      if (forma === "efectivo") efectivoVentas = sumar(efectivoVentas, ev.monto);
    } else if (ev.tipo === "propina_registrada") {
      propinas = sumar(propinas, ev.monto);
    } else if (ev.tipo === "cuenta_cerrada") {
      cuentasCerradas += 1;
    }
  }

  const movimientos = sumar(...caja.movimientos.map((m) => m.monto));

  return {
    ventas,
    totalVendido,
    efectivoVentas,
    fondoInicial: caja.fondo_inicial,
    movimientos,
    efectivoEsperado: sumar(caja.fondo_inicial, efectivoVentas, movimientos),
    propinas,
    cuentasCerradas,
  };
}

/** Diferencia entre lo contado y lo esperado. Negativa = falta dinero. */
export function diferenciaArqueo(corte: CorteCaja, declarado: Centavos): Centavos {
  return restar(declarado, corte.efectivoEsperado);
}
