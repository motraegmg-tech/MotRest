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
import type {
  EventoCaja,
  MotivoMovimientoCaja,
  ResumenCorte,
  VentasPorForma,
} from "./eventos.js";

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
  cerrada_ts?: number;
  declarado?: Centavos;
  diferencia?: Centavos;
  /** Cifras congeladas y su sello, una vez cerrada. */
  resumen?: ResumenCorte;
  sello?: string;
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
      // Un turno cerrado no se reabre: el primer cierre manda. Reaplicarlo (una
      // resincronización, por ejemplo) no puede pisar las cifras ya selladas.
      if (estado.cerrada) return estado;
      return {
        ...estado,
        cerrada: true,
        cerrada_ts: ev.ts,
        diferencia: ev.diferencia,
        declarado: ev.resumen.declarado,
        resumen: ev.resumen,
        sello: ev.sello,
      };

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

/**
 * Todas las sesiones de caja, cada una reconstruida por separado.
 *
 * Los eventos se agrupan por `sesion_id` antes de proyectar: un solo log lleva
 * un turno tras otro, y reducirlos juntos mezclaría el fondo de uno con las
 * ventas de otro. Se ordenan por apertura, de la más reciente a la más antigua,
 * que es como se leen los arqueos.
 */
export function proyectarSesiones(eventos: readonly EventoCaja[]): EstadoCaja[] {
  const porSesion = new Map<ID, EventoCaja[]>();
  for (const ev of eventos) {
    const grupo = porSesion.get(ev.sesion_id) ?? [];
    grupo.push(ev);
    porSesion.set(ev.sesion_id, grupo);
  }

  const sesiones: EstadoCaja[] = [];
  for (const grupo of porSesion.values()) {
    const estado = proyectarCaja(grupo);
    if (estado) sesiones.push(estado);
  }
  return sesiones.sort((a, b) => b.abierta_ts - a.abierta_ts);
}

/** La sesión abierta ahora, si la hay. A lo sumo una a la vez. */
export function sesionAbierta(eventos: readonly EventoCaja[]): EstadoCaja | undefined {
  return proyectarSesiones(eventos).find((s) => !s.cerrada);
}

// --- Corte del turno ------------------------------------------------------------

export interface CorteCaja {
  /** Lo COBRADO por forma de pago, propina incluida: es lo que entró. */
  ventas: VentasPorForma;
  /**
   * La venta del turno, SIN propina.
   *
   * El cliente paga cuenta + propina de una sola vez, así que el cobro las trae
   * juntas. Pero la propina es del mesero, no del restaurante: contarla como
   * venta infla el ingreso, y el contador declararía de más.
   */
  totalVendido: Centavos;
  /** Efectivo recibido, propina incluida: es lo que de verdad está en el cajón. */
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
  let cobrado = CERO;
  let efectivoVentas = CERO;
  let propinas = CERO;
  let cuentasCerradas = 0;

  for (const ev of eventosComanda) {
    if (ev.tipo === "pago_registrado") {
      const forma: FormaPago = ev.forma;
      ventas[forma] = sumar(ventas[forma] ?? CERO, ev.monto);
      cobrado = sumar(cobrado, ev.monto);
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
    // La propina viaja DENTRO del cobro; se descuenta para no declararla como
    // ingreso. El cajón, en cambio, sí la tiene: por eso `efectivoVentas` queda
    // bruto y el esperado se calcula sobre él.
    totalVendido: restar(cobrado, propinas),
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
