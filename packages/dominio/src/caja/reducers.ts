/**
 * Proyección de la sesión de caja y cálculo del corte del turno.
 *
 * El efectivo esperado se arma con el fondo inicial, más lo cobrado en efectivo,
 * más los movimientos manuales. La diferencia contra lo declarado es lo que el
 * gerente revisa al cerrar.
 */
import { CERO, repartirProporcional, restar, sumar, type Centavos } from "../comun/dinero.js";
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

/**
 * El corte del turno.
 *
 * TRES PREGUNTAS DISTINTAS, TRES NÚMEROS QUE NO SE PISAN. El cliente paga
 * cuenta y propina de un solo golpe, así que el cobro las trae revueltas — y
 * ahí nacía el enredo. Cada pregunta tiene ahora su renglón, y los renglones
 * cuadran entre sí a la vista de quien cierra la caja:
 *
 *   1. ¿Cuánto debe haber en el cajón?   → `efectivoEsperado`
 *   2. ¿Cuánto vendí?                    → `totalVendido` (= suma de `ventas`)
 *   3. ¿Cuánta propina hay que entregar? → `propinas` (= suma de `propinasPorForma`)
 *
 * Y siempre: `cobrado[forma] === ventas[forma] + propinasPorForma[forma]`.
 */
export interface CorteCaja {
  /** Lo que ENTRÓ por cada forma de pago, propina incluida. */
  cobrado: VentasPorForma;
  totalCobrado: Centavos;

  /**
   * La VENTA por forma, ya sin propina. Suma exactamente `totalVendido`.
   *
   * La propina es del mesero, no del restaurante: contarla como venta infla el
   * ingreso y el contador declararía de más.
   */
  ventas: VentasPorForma;
  totalVendido: Centavos;

  /**
   * La propina por forma de pago. Importa cómo llegó, no solo cuánta:
   * la que entró por TARJETA es dinero que el restaurante le debe al mesero en
   * efectivo, y sale del cajón sin ser un gasto del negocio.
   */
  propinasPorForma: VentasPorForma;
  propinas: Centavos;

  /** Efectivo recibido, propina incluida: es lo que de verdad está en el cajón. */
  efectivoVentas: Centavos;
  fondoInicial: Centavos;
  /** Entradas y salidas manuales de efectivo (retiros en negativo). */
  movimientos: Centavos;
  /** Lo que debería haber en el cajón. */
  efectivoEsperado: Centavos;
  /** Cuentas cerradas en el turno. */
  cuentasCerradas: number;
}

/** Lo cobrado y lo propinado de una cuenta, para poder separarlos después. */
interface CuentaDelTurno {
  pagos: { forma: FormaPago; monto: Centavos }[];
  propina: Centavos;
}

function acumular(mapa: VentasPorForma, forma: FormaPago, monto: Centavos): void {
  mapa[forma] = sumar(mapa[forma] ?? CERO, monto);
}

/**
 * Calcula el corte a partir de la sesión y de los pagos del turno.
 * Los pagos llegan como eventos de comanda, porque es ahí donde se registran.
 */
export function calcularCorte(
  caja: EstadoCaja,
  eventosComanda: readonly EventoComanda[],
): CorteCaja {
  const cobrado: VentasPorForma = {};
  const cuentas = new Map<ID, CuentaDelTurno>();
  let totalCobrado = CERO;
  let efectivoVentas = CERO;
  let propinas = CERO;
  let cuentasCerradas = 0;

  for (const ev of eventosComanda) {
    if (ev.tipo === "pago_registrado") {
      const cuenta = cuentas.get(ev.orden_id) ?? { pagos: [], propina: CERO };
      cuenta.pagos.push({ forma: ev.forma, monto: ev.monto });
      cuentas.set(ev.orden_id, cuenta);

      acumular(cobrado, ev.forma, ev.monto);
      totalCobrado = sumar(totalCobrado, ev.monto);
      if (ev.forma === "efectivo") efectivoVentas = sumar(efectivoVentas, ev.monto);
    } else if (ev.tipo === "propina_registrada") {
      const cuenta = cuentas.get(ev.orden_id) ?? { pagos: [], propina: CERO };
      cuenta.propina = sumar(cuenta.propina, ev.monto);
      cuentas.set(ev.orden_id, cuenta);
      propinas = sumar(propinas, ev.monto);
    } else if (ev.tipo === "cuenta_cerrada") {
      cuentasCerradas += 1;
    }
  }

  /*
   * A QUÉ FORMA LE TOCA CADA PROPINA.
   *
   * Se resuelve cuenta por cuenta: la propina de una mesa se reparte entre las
   * formas con que ESA mesa pagó, a prorrata de lo pagado con cada una. Repartir
   * la propina total del turno contra el gran total mezclaría mesas que no
   * tienen nada que ver, y con cuentas divididas el reparto por resto mayor es
   * lo único que no deja centavos sueltos.
   */
  const propinasPorForma: VentasPorForma = {};
  let propinaEnLosCobros = CERO;

  for (const cuenta of cuentas.values()) {
    if (cuenta.propina <= 0 || cuenta.pagos.length === 0) continue;

    // Nunca más de lo que se cobró: si la propina se registró pero la cuenta
    // todavía no se paga, no hay cobro del que descontarla.
    const totalPagos = sumar(...cuenta.pagos.map((p) => p.monto));
    const aRepartir = Math.min(cuenta.propina, totalPagos) as Centavos;
    if (aRepartir <= 0) continue;

    const partes = repartirProporcional(aRepartir, cuenta.pagos.map((p) => p.monto));
    cuenta.pagos.forEach((p, i) => acumular(propinasPorForma, p.forma, partes[i] ?? CERO));
    propinaEnLosCobros = sumar(propinaEnLosCobros, aRepartir);
  }

  // La venta por forma es lo que entró menos la propina que venía dentro.
  const ventas: VentasPorForma = {};
  for (const [forma, monto] of Object.entries(cobrado) as [FormaPago, Centavos][]) {
    ventas[forma] = restar(monto, propinasPorForma[forma] ?? CERO);
  }

  const movimientos = sumar(...caja.movimientos.map((m) => m.monto));

  return {
    cobrado,
    totalCobrado,
    ventas,
    totalVendido: restar(totalCobrado, propinaEnLosCobros),
    propinasPorForma,
    propinas,
    // El cajón tiene el efectivo COMPLETO, propina incluida: por eso el
    // esperado se calcula sobre el bruto y no sobre la venta.
    efectivoVentas,
    fondoInicial: caja.fondo_inicial,
    movimientos,
    efectivoEsperado: sumar(caja.fondo_inicial, efectivoVentas, movimientos),
    cuentasCerradas,
  };
}

/** Diferencia entre lo contado y lo esperado. Negativa = falta dinero. */
export function diferenciaArqueo(corte: CorteCaja, declarado: Centavos): Centavos {
  return restar(declarado, corte.efectivoEsperado);
}
