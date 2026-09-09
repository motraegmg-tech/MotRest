/**
 * Tesorería: cuánto dinero tiene el restaurante, y dónde está.
 *
 * ## La pregunta que faltaba
 *
 * El corte de caja responde «¿el cajón cuadra al cerrar el turno?». Es una
 * pregunta de un turno y de un cajón. La que nadie podía responder era la otra:
 * **«¿cuánto dinero tiene el restaurante hoy?»** — contando lo del cajón, lo de
 * la caja fuerte y lo que ya se fue al banco, y descontando lo que se pagó.
 *
 * Sin esa cifra, registrar un gasto era escribir una nota: el dinero seguía
 * apareciendo entero en todas las pantallas.
 *
 * ## Dos saldos, no uno
 *
 * Decisión de Gonzalo: **efectivo y banco por separado**.
 *
 * No es un capricho contable, es lo único que se puede verificar. El efectivo se
 * cuenta con la mano y se compara contra el cajón; el banco se coteja contra el
 * estado de cuenta. Un solo número que los sumara no se podría arquear nunca:
 * nadie puede contar los billetes de una transferencia.
 *
 * Lo que entra por tarjeta, transferencia, vale o app va a `banco` aunque el
 * dinero tarde días en llegar. Es lo que el restaurante YA vendió y no tiene en
 * la mano; la fecha real de abono la pone el banco, no el POS.
 *
 * ## El saldo se DERIVA, no se guarda
 *
 * Los saldos se recalculan desde los hechos que ya existen —los cobros, los
 * gastos, los movimientos de caja— más los dos que faltaban y que este módulo
 * agrega: el **traspaso** (depositar en el banco, o traer cambio de allá) y el
 * **ajuste justificado**.
 *
 * Guardar el saldo como número editable sería la forma más rápida de que
 * dejara de significar nada: el día que alguien lo corrigiera «para que
 * cuadre», el histórico dejaría de explicar de dónde salió la cifra. Por eso el
 * ajuste no escribe el saldo: escribe **un renglón más**, con su importe, su
 * autor y su justificación, y el saldo vuelve a salir de la suma.
 *
 * ## El saldo inicial
 *
 * Un restaurante que estrena MotRest ya tenía dinero. Ese arranque entra por la
 * misma puerta que todo lo demás: un ajuste justificado («saldo con el que
 * empezamos»). No hay una casilla mágica de saldo inicial, porque sería la
 * única cifra del sistema sin nada detrás que la explique.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { FormaPago } from "../comanda/eventos.js";
import { FORMAS_PAGO } from "../comanda/eventos.js";
import type { Rango } from "../inteligencia/reportes.js";

/** Dónde está el dinero. Son dos porque se verifican de formas distintas. */
export type CuentaTesoreria = "efectivo" | "banco";

export const CUENTAS_TESORERIA: { id: CuentaTesoreria; nombre: string; explica: string }[] = [
  {
    id: "efectivo",
    nombre: "Efectivo",
    explica: "Lo que hay en el cajón y en la caja fuerte. Se cuenta con la mano.",
  },
  {
    id: "banco",
    nombre: "Banco",
    explica: "Tarjeta, transferencia, vales y apps. Se coteja contra el estado de cuenta.",
  },
];

export function nombreCuenta(cuenta: CuentaTesoreria): string {
  return CUENTAS_TESORERIA.find((c) => c.id === cuenta)?.nombre ?? cuenta;
}

/**
 * ¿Este cobro entra al cajón o al banco?
 *
 * La respuesta la da el catálogo de formas de pago, que ya marca cuáles son
 * efectivo. Repetir la lista aquí sería garantizar que algún día divergieran.
 */
export function cuentaDeFormaPago(forma: FormaPago | string): CuentaTesoreria {
  return FORMAS_PAGO.find((f) => f.valor === forma)?.efectivo ? "efectivo" : "banco";
}

/** ¿Este pago sale del cajón? Se usa para el corte y para los gastos. */
export function esPagoEnEfectivo(forma: FormaPago | string): boolean {
  return cuentaDeFormaPago(forma) === "efectivo";
}

// --- Eventos ---------------------------------------------------------------------------

/** Por qué se movió el dinero sin que hubiera venta ni gasto. */
export type ClaseAjuste =
  /** El dinero con el que el restaurante empezó a usar MotRest. */
  | "saldo_inicial"
  /** Un faltante o sobrante que se acepta y se deja explicado. */
  | "diferencia_aceptada"
  /** Una entrada que no es venta: préstamo del dueño, devolución, renta cobrada. */
  | "otro_ingreso"
  /** Una salida que no se capturó como gasto en su momento. */
  | "otro_egreso"
  /** Una captura anterior estaba mal y se corrige. */
  | "correccion";

export const CLASES_AJUSTE: { id: ClaseAjuste; nombre: string; explica: string }[] = [
  {
    id: "saldo_inicial",
    nombre: "Saldo con el que empezamos",
    explica: "El dinero que ya había el día que arrancó MotRest. Se captura una sola vez.",
  },
  {
    id: "diferencia_aceptada",
    nombre: "Diferencia aceptada",
    explica: "Faltó o sobró dinero, se investigó y se deja asentado.",
  },
  {
    id: "otro_ingreso",
    nombre: "Otro ingreso",
    explica: "Dinero que entró y no fue una venta: aportación del dueño, un reembolso.",
  },
  {
    id: "otro_egreso",
    nombre: "Otra salida",
    explica: "Dinero que salió y no se capturó como gasto en su momento.",
  },
  {
    id: "correccion",
    nombre: "Corrección de captura",
    explica: "Se registró mal un importe y se endereza dejando el rastro de los dos.",
  },
];

export type EventoTesoreria =
  | (EventoBase & {
      /**
       * Dinero que cambia de sitio sin dejar de ser del restaurante.
       *
       * Depositar la venta del fin de semana en el banco, o ir por cambio.
       * NO altera el total: baja una cuenta y sube la otra exactamente igual.
       */
      tipo: "traspaso_registrado";
      traspaso_id: ID;
      desde: CuentaTesoreria;
      hacia: CuentaTesoreria;
      monto: Centavos;
      /** Folio de la ficha de depósito, para poder cotejarlo después. */
      referencia?: string;
      nota?: string;
    })
  | (EventoBase & {
      /**
       * El renglón que corrige el saldo, SIEMPRE con su porqué.
       *
       * La justificación no es opcional ni por cortesía: es la única diferencia
       * entre corregir una cifra y taparla. Un ajuste sin explicación es
       * exactamente lo que escribiría alguien cubriendo un faltante.
       */
      tipo: "saldo_ajustado";
      ajuste_id: ID;
      cuenta: CuentaTesoreria;
      clase: ClaseAjuste;
      /** Con signo: negativo baja el saldo. */
      delta: Centavos;
      justificacion: string;
      autorizador_id?: ID;
    });

export type TipoEventoTesoreria = EventoTesoreria["tipo"];

export const TIPOS_EVENTO_TESORERIA: TipoEventoTesoreria[] = [
  "traspaso_registrado",
  "saldo_ajustado",
];

// --- El renglón del histórico -------------------------------------------------------

/** De dónde salió un renglón del movimiento del dinero. */
export type OrigenMovimiento =
  | "venta"
  | "devolucion"
  | "gasto"
  | "movimiento_caja"
  | "traspaso"
  | "ajuste";

/**
 * Un renglón del histórico: un movimiento de dinero, venga de donde venga.
 *
 * Es la lista que el dueño lee de arriba abajo para entender por qué el saldo
 * es el que es. Por eso todos los orígenes se traducen a la MISMA forma: una
 * venta en efectivo y un ajuste justificado se leen igual de fácil.
 */
export interface MovimientoDinero {
  id: ID;
  ts: number;
  cuenta: CuentaTesoreria;
  origen: OrigenMovimiento;
  concepto: string;
  /** Con signo: negativo salió. */
  monto: Centavos;
  /** Quién lo hizo, cuando se sabe. */
  empleado_id?: ID;
  /** Por qué, en los que lo exigen. */
  justificacion?: string;
  referencia?: string;
}

export interface SaldosTesoreria {
  efectivo: Centavos;
  banco: Centavos;
  /** La suma. Se muestra, pero no se arquea: no hay forma de contarla. */
  total: Centavos;
}

export function saldosVacios(): SaldosTesoreria {
  return { efectivo: CERO, banco: CERO, total: CERO };
}

/** Suma los renglones y devuelve los dos saldos. */
export function saldosDe(movimientos: readonly MovimientoDinero[]): SaldosTesoreria {
  const efectivo = sumar(
    ...movimientos.filter((m) => m.cuenta === "efectivo").map((m) => m.monto),
  );
  const banco = sumar(...movimientos.filter((m) => m.cuenta === "banco").map((m) => m.monto));
  return { efectivo, banco, total: sumar(efectivo, banco) };
}

/** Los renglones de un período, del más antiguo al más nuevo. */
export function movimientosEn(
  movimientos: readonly MovimientoDinero[],
  rango: Rango,
): MovimientoDinero[] {
  return movimientos
    .filter((m) => m.ts >= rango.desde && m.ts < rango.hasta)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * El saldo al CERRAR un instante: todo lo ocurrido hasta ese momento.
 *
 * Es lo que permite decir «el lunes por la mañana debía haber tanto»: se suma
 * la historia completa hasta ahí, no solo el día que se está mirando.
 */
export function saldosAl(
  movimientos: readonly MovimientoDinero[],
  hasta: number,
): SaldosTesoreria {
  return saldosDe(movimientos.filter((m) => m.ts < hasta));
}

// --- Traducción de los eventos propios a renglones ---------------------------------

/**
 * Convierte los eventos de tesorería en renglones del histórico.
 *
 * El traspaso da DOS renglones —uno por cuenta— porque eso es literalmente lo
 * que pasa: sale de un sitio y entra en otro. Verlo como un solo renglón haría
 * imposible cuadrar ninguna de las dos cuentas por separado.
 */
export function movimientosDeTesoreria(
  eventos: readonly EventoTesoreria[],
): MovimientoDinero[] {
  const renglones: MovimientoDinero[] = [];

  for (const ev of eventos) {
    if (ev.tipo === "traspaso_registrado") {
      const rumbo =
        ev.hacia === "banco" ? "Depósito al banco" : "Retiro del banco";
      const detalle = ev.nota?.trim() ? `${rumbo} · ${ev.nota.trim()}` : rumbo;

      renglones.push({
        id: `${ev.id}:salida`,
        ts: ev.ts,
        cuenta: ev.desde,
        origen: "traspaso",
        concepto: detalle,
        monto: -ev.monto as Centavos,
        empleado_id: ev.empleado_id,
        referencia: ev.referencia,
      });
      renglones.push({
        id: `${ev.id}:entrada`,
        ts: ev.ts,
        cuenta: ev.hacia,
        origen: "traspaso",
        concepto: detalle,
        monto: ev.monto,
        empleado_id: ev.empleado_id,
        referencia: ev.referencia,
      });
      continue;
    }

    const clase = CLASES_AJUSTE.find((c) => c.id === ev.clase);
    renglones.push({
      id: ev.id,
      ts: ev.ts,
      cuenta: ev.cuenta,
      origen: "ajuste",
      concepto: clase?.nombre ?? "Ajuste",
      monto: ev.delta,
      empleado_id: ev.autorizador_id ?? ev.empleado_id,
      justificacion: ev.justificacion,
    });
  }

  return renglones;
}

// --- El arqueo del efectivo -----------------------------------------------------------

/**
 * Lo que hay contra lo que debería haber, en cualquier momento.
 *
 * Es el arqueo del turno llevado al restaurante entero y a cualquier día: se
 * cuenta el dinero, se teclea, y el sistema dice cuánto falta o sobra. La
 * diferencia NO se corrige sola: si se acepta, se acepta con un ajuste
 * justificado, que es un renglón más del histórico.
 */
export interface Arqueo {
  cuenta: CuentaTesoreria;
  esperado: Centavos;
  contado: Centavos;
  /** Contado − esperado. Negativo = falta dinero. */
  diferencia: Centavos;
  cuadra: boolean;
}

export function arquear(
  esperado: Centavos,
  contado: Centavos,
  cuenta: CuentaTesoreria = "efectivo",
): Arqueo {
  const diferencia = (contado - esperado) as Centavos;
  return { cuenta, esperado, contado, diferencia, cuadra: diferencia === 0 };
}

// --- Conteo por denominaciones --------------------------------------------------------

/**
 * Los billetes y monedas que circulan en México.
 *
 * Contar por denominación en vez de teclear un total no es un adorno: quien
 * cuenta el cajón cuenta montones de billetes, y obligarle a hacer la suma
 * mental antes de escribirla es donde se cuelan los errores de arqueo. De paso
 * queda registrado si el turno se quedó sin cambio.
 */
export const DENOMINACIONES: { valor: Centavos; etiqueta: string; moneda: boolean }[] = [
  { valor: 100_000 as Centavos, etiqueta: "$1,000", moneda: false },
  { valor: 50_000 as Centavos, etiqueta: "$500", moneda: false },
  { valor: 20_000 as Centavos, etiqueta: "$200", moneda: false },
  { valor: 10_000 as Centavos, etiqueta: "$100", moneda: false },
  { valor: 5_000 as Centavos, etiqueta: "$50", moneda: false },
  { valor: 2_000 as Centavos, etiqueta: "$20", moneda: false },
  { valor: 2_000 as Centavos, etiqueta: "$20 (moneda)", moneda: true },
  { valor: 1_000 as Centavos, etiqueta: "$10", moneda: true },
  { valor: 500 as Centavos, etiqueta: "$5", moneda: true },
  { valor: 200 as Centavos, etiqueta: "$2", moneda: true },
  { valor: 100 as Centavos, etiqueta: "$1", moneda: true },
  { valor: 50 as Centavos, etiqueta: "50¢", moneda: true },
];

/** Cuántas piezas de cada denominación. La llave es la etiqueta, que sí es única. */
export type ConteoDenominaciones = Record<string, number>;

/** Suma un conteo de billetes y monedas. */
export function totalDelConteo(conteo: ConteoDenominaciones): Centavos {
  let total = 0;
  for (const d of DENOMINACIONES) {
    const piezas = conteo[d.etiqueta] ?? 0;
    if (!Number.isFinite(piezas) || piezas <= 0) continue;
    total += Math.floor(piezas) * d.valor;
  }
  return total as Centavos;
}

/**
 * ¿Queda cambio para el siguiente turno?
 *
 * Un cajón con doce mil pesos en billetes de mil y nada suelto no puede cobrar
 * la primera mesa del día. Se avisa por debajo de este umbral en monedas y
 * billetes chicos.
 */
export const CAMBIO_MINIMO = 50_000 as Centavos;

export function cambioDisponible(conteo: ConteoDenominaciones): Centavos {
  let total = 0;
  for (const d of DENOMINACIONES) {
    if (d.valor > 10_000) continue;
    total += Math.floor(conteo[d.etiqueta] ?? 0) * d.valor;
  }
  return total as Centavos;
}
