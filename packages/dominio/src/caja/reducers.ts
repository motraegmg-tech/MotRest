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
import type { RegistroEgreso } from "../finanzas/egresos.js";
import { esPagoEnEfectivo } from "../finanzas/tesoreria.js";
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
  /**
   * Gastos del turno pagados EN EFECTIVO, en positivo. Salen del cajón.
   *
   * Es el agujero que este campo tapa: hasta ahora un gasto registrado en
   * Finanzas no tocaba el corte, así que pagar el gas con el dinero del cajón
   * aparecía como un faltante al cerrar. El cajero contaba bien y el sistema le
   * decía que le faltaban 800 pesos.
   */
  gastosEfectivo: Centavos;
  /** Esos gastos, uno por uno, para poder explicar el renglón de arriba. */
  gastos: { concepto: string; monto: Centavos; ts: number }[];
  /** Lo que debería haber en el cajón. */
  efectivoEsperado: Centavos;
  /** Cuentas cerradas en el turno. */
  cuentasCerradas: number;
  /**
   * Lo devuelto por ventas canceladas en el turno, y cuántas fueron.
   *
   * Se muestra aparte en el arqueo: quien cuenta el cajón necesita ver por qué
   * el esperado bajó, y una devolución es justo la clase de movimiento que hay
   * que poder explicar delante de un dueño.
   */
  devoluciones: Centavos;
  ventasCanceladas: number;
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
 * Calcula el corte a partir de la sesión, los pagos del turno y sus gastos.
 *
 * Los pagos llegan como eventos de comanda, porque es ahí donde se registran.
 * Los gastos llegan ya filtrados al turno: quien llama sabe qué ventana de
 * tiempo abarca la sesión, y aquí no se vuelve a decidir.
 *
 * ## Por qué el gasto se resta aquí y no como retiro de caja
 *
 * Se podría pedir al cajero que registrara un «retiro» además del gasto, y así
 * estaba: era la única forma de que el cajón cuadrara. Pero son dos capturas
 * del mismo hecho, y la segunda se olvidaba siempre — o peor, se hacían las dos
 * y el dinero se descontaba por partida doble.
 *
 * Ahora hay un solo acto: se registra el gasto y el cajón lo refleja. Los
 * `movimiento_efectivo` siguen existiendo para lo que de verdad no es un gasto
 * —traer cambio del banco, guardar en la caja fuerte a media noche—, y por eso
 * los gastos que MotRest genera solos no emiten además un retiro.
 */
export function calcularCorte(
  caja: EstadoCaja,
  eventosComanda: readonly EventoComanda[],
  egresosDelTurno: readonly RegistroEgreso[] = [],
): CorteCaja {
  const cobrado: VentasPorForma = {};
  const cuentas = new Map<ID, CuentaDelTurno>();
  let totalCobrado = CERO;
  let efectivoVentas = CERO;
  let propinas = CERO;
  let cuentasCerradas = 0;
  let devoluciones = CERO;
  let ventasCanceladas = 0;

  /*
   * LA FORMA DE PAGO CORREGIDA, ANTES DE SUMAR NADA.
   *
   * Un cobro con la forma mal apuntada descuadra el cajón en los dos sentidos a
   * la vez: sobra efectivo que nunca entró y falta el cargo de la tarjeta. La
   * corrección se busca en una primera pasada porque el evento que la registra
   * llega DESPUÉS del cobro —se descubre el error al cuadrar— y sumar primero
   * para restar luego dejaría el desglose por forma con importes negativos.
   *
   * Solo se aplican las correcciones que caen en esta misma ventana de eventos.
   * Un cobro de anteayer que se corrige hoy no puede mover el corte de anteayer:
   * aquel papel ya se firmó y su sello dejaría de cuadrar. Esa corrección sí se
   * refleja donde importa —en el saldo del restaurante, que no está sellado—.
   */
  const correcciones = new Map<ID, FormaPago>();
  for (const ev of eventosComanda) {
    if (ev.tipo === "pago_corregido") correcciones.set(ev.pago_id, ev.forma);
  }

  for (const ev of eventosComanda) {
    if (ev.tipo === "pago_registrado") {
      const forma = correcciones.get(ev.id) ?? ev.forma;
      const cuenta = cuentas.get(ev.orden_id) ?? { pagos: [], propina: CERO };
      cuenta.pagos.push({ forma, monto: ev.monto });
      cuentas.set(ev.orden_id, cuenta);

      acumular(cobrado, forma, ev.monto);
      totalCobrado = sumar(totalCobrado, ev.monto);
      if (forma === "efectivo") efectivoVentas = sumar(efectivoVentas, ev.monto);
    } else if (ev.tipo === "propina_registrada") {
      const cuenta = cuentas.get(ev.orden_id) ?? { pagos: [], propina: CERO };
      cuenta.propina = sumar(cuenta.propina, ev.monto);
      cuentas.set(ev.orden_id, cuenta);
      propinas = sumar(propinas, ev.monto);
    } else if (ev.tipo === "cuenta_cerrada") {
      cuentasCerradas += 1;
    } else if (ev.tipo === "venta_cancelada") {
      /*
       * EL DINERO SALE DEL CAJÓN EL DÍA QUE SE DEVUELVE, no el día que se cobró.
       *
       * Por eso se resta aquí, en el turno donde ocurre la cancelación, en vez
       * de descontar la venta de su turno original: quien cuenta los billetes
       * esta noche va a encontrar 433 pesos menos, y el esperado tiene que
       * decirlo. Si el cobro fue en este mismo turno, el pago ya se sumó arriba
       * y la resta lo deja en cero, que es lo correcto.
       *
       * La propina va DENTRO de las devoluciones —se cobró junto con la cuenta
       * y se devolvió junto con ella—, así que no se descuenta aparte.
       */
      ventasCanceladas += 1;
      for (const devolucion of ev.devoluciones) {
        acumular(cobrado, devolucion.forma, (-devolucion.monto) as Centavos);
        totalCobrado = restar(totalCobrado, devolucion.monto);
        devoluciones = sumar(devoluciones, devolucion.monto);
        if (devolucion.forma === "efectivo") {
          efectivoVentas = restar(efectivoVentas, devolucion.monto);
        }
      }

      /*
       * La cuenta desaparece del turno: ni suma cuenta cerrada ni entra al
       * prorrateo de propinas. Solo si su cierre fue en ESTE turno —si el cobro
       * es de antes, aquí no hay nada que descontar y la resta de arriba ya
       * dejó el efectivo como debe.
       */
      const cuenta = cuentas.get(ev.orden_id);
      if (cuenta) {
        cuentas.delete(ev.orden_id);
        propinas = restar(propinas, cuenta.propina);
        cuentasCerradas = Math.max(0, cuentasCerradas - 1);
      }
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

  /*
   * Solo los gastos pagados EN EFECTIVO tocan el cajón. Uno pagado por
   * transferencia salió del banco: descontarlo aquí dejaría al cajero buscando
   * unos billetes que nunca estuvieron.
   */
  const enEfectivo = egresosDelTurno.filter((e) => !e.anulado && esPagoEnEfectivo(e.forma_pago));
  const gastos = enEfectivo.map((e) => ({
    concepto: e.concepto,
    monto: e.monto,
    ts: e.pagado_ts ?? e.ts,
  }));
  const gastosEfectivo = sumar(...gastos.map((g) => g.monto));

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
    gastosEfectivo,
    gastos,
    efectivoEsperado: restar(
      sumar(caja.fondo_inicial, efectivoVentas, movimientos),
      gastosEfectivo,
    ),
    cuentasCerradas,
    devoluciones,
    ventasCanceladas,
  };
}

/** Diferencia entre lo contado y lo esperado. Negativa = falta dinero. */
export function diferenciaArqueo(corte: CorteCaja, declarado: Centavos): Centavos {
  return restar(declarado, corte.efectivoEsperado);
}
