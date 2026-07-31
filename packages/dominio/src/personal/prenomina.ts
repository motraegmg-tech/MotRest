/**
 * Prenómina (M6): de las checadas y las propinas, a cuánto se le paga a cada quien.
 *
 * El checador ya registra quién entró y salió, y el POS ya registra las propinas.
 * Lo que faltaba es convertir eso en la cuenta del periodo. NO es un cálculo de
 * nómina fiscal —no hay IMSS, ISR ni finiquitos aquí, eso es F2—: es la
 * PRE-nómina, el número con el que el dueño paga la raya el sábado.
 *
 * DÓNDE VIVE EL SUELDO, Y POR QUÉ NO EN EL USUARIO
 *
 * La tarifa va en su propio flujo de eventos y no en `Usuario`. El objeto de
 * usuario viaja a TODAS las terminales para evaluar permisos: si el sueldo
 * viviera ahí, la tablet de cualquier mesero tendría lo que gana el resto del
 * equipo. Aparte, un cambio de sueldo es un hecho que hay que poder auditar
 * —cuándo cambió, quién lo cambió— y eso es exactamente un evento.
 */
import { CERO, repartirProporcional, sumar, deCentavos, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

/**
 * Cómo se reparten las propinas. Es una decisión del restaurante, no del
 * software, y las dos formas son igual de comunes en México.
 */
export type ModoPropina =
  | "directo" /** Cada quien se queda lo de sus mesas. */
  | "fondo_por_horas"; /** Todo al fondo y se reparte a prorrata de horas trabajadas. */

export const MODOS_PROPINA: { valor: ModoPropina; etiqueta: string; descripcion: string }[] = [
  {
    valor: "directo",
    etiqueta: "Directa al mesero",
    descripcion: "Cada quien se queda la propina de las cuentas que atendió.",
  },
  {
    valor: "fondo_por_horas",
    etiqueta: "Fondo común por horas",
    descripcion:
      "Todas las propinas van a un fondo y se reparten entre quienes trabajaron, a proporción de sus horas. Incluye a cocina y barra, que no tienen mesas propias.",
  },
];

export type EventoPrenomina = EventoBase & {
  /**
   * Se le fija la tarifa por hora a alguien. Es un evento y no un campo porque
   * un cambio de sueldo debe quedar en la bitácora: cuándo, y quién lo autorizó.
   */
  tipo: "tarifa_asignada";
  trabajador_id: ID;
  /** Pago por hora trabajada. */
  tarifa_hora: Centavos;
  nota?: string;
};

/** Stream de las condiciones laborales de una sucursal. */
export function streamPrenomina(sucursal_id: ID): ID {
  return `prenomina:${sucursal_id}`;
}

/** La tarifa vigente de cada trabajador: la última asignada gana. */
export function tarifasVigentes(eventos: readonly EventoPrenomina[]): Map<ID, Centavos> {
  const tarifas = new Map<ID, Centavos>();
  for (const ev of eventos) {
    if (ev.tipo === "tarifa_asignada") tarifas.set(ev.trabajador_id, ev.tarifa_hora);
  }
  return tarifas;
}

// --- El cálculo -------------------------------------------------------------------------

/** Lo que se sabe de cada trabajador antes de calcular. */
export interface JornadaTrabajador {
  trabajador_id: ID;
  nombre: string;
  /** Minutos efectivamente trabajados en el periodo (ya sin descansos). */
  minutos: number;
  /** true = quedó un turno sin checar salida. */
  turnoAbierto: boolean;
  /** Propinas de las cuentas que atendió. Solo cuenta en modo "directo". */
  propinasPropias: Centavos;
}

export interface RenglonPrenomina extends JornadaTrabajador {
  tarifa_hora: Centavos;
  /** Horas con dos decimales, para que el renglón se pueda revisar a mano. */
  horas: number;
  sueldo: Centavos;
  propinas: Centavos;
  total: Centavos;
  /** true = no tiene tarifa asignada; su sueldo sale en cero y hay que capturarla. */
  sinTarifa: boolean;
}

export interface Prenomina {
  renglones: RenglonPrenomina[];
  total_sueldos: Centavos;
  total_propinas: Centavos;
  total: Centavos;
  modo_propina: ModoPropina;
  /** Trabajadores con un turno sin cerrar: sus horas están infladas. */
  turnos_abiertos: number;
  /** Trabajadores sin tarifa capturada. */
  sin_tarifa: number;
}

/** Minutos a horas, redondeando al centésimo. */
function aHoras(minutos: number): number {
  return Math.round((minutos / 60) * 100) / 100;
}

/**
 * Calcula la prenómina del periodo.
 *
 * Las horas vienen ya resueltas por el checador (`resumenAsistencia`); aquí solo
 * se les pone precio y se les suman las propinas. Un turno abierto NO se
 * descarta ni se corrige solo: se paga lo que marca y se SEÑALA, porque el
 * software no puede saber a qué hora se fue esa persona — solo quien estuvo ahí.
 */
export function calcularPrenomina(
  jornadas: readonly JornadaTrabajador[],
  tarifas: ReadonlyMap<ID, Centavos>,
  opciones: { modoPropina?: ModoPropina; fondoPropinas?: Centavos } = {},
): Prenomina {
  const modo = opciones.modoPropina ?? "directo";

  // En fondo común, la propina se reparte por horas trabajadas: quien más
  // estuvo, más recibe. Cocina y barra entran aunque no tengan mesas propias.
  const propinasPorModo: Centavos[] =
    modo === "fondo_por_horas"
      ? repartirProporcional(
          opciones.fondoPropinas ?? sumar(...jornadas.map((j) => j.propinasPropias)),
          jornadas.map((j) => j.minutos),
        )
      : jornadas.map((j) => j.propinasPropias);

  const renglones: RenglonPrenomina[] = jornadas.map((j, i) => {
    const tarifa = tarifas.get(j.trabajador_id);
    const horas = aHoras(j.minutos);
    const sueldo = tarifa ? deCentavos(Math.round((j.minutos / 60) * tarifa)) : CERO;
    const propinas = propinasPorModo[i] ?? CERO;

    return {
      ...j,
      tarifa_hora: tarifa ?? CERO,
      horas,
      sueldo,
      propinas,
      total: sumar(sueldo, propinas),
      sinTarifa: tarifa === undefined,
    };
  });

  renglones.sort((a, b) => b.total - a.total);

  const total_sueldos = sumar(...renglones.map((r) => r.sueldo));
  const total_propinas = sumar(...renglones.map((r) => r.propinas));

  return {
    renglones,
    total_sueldos,
    total_propinas,
    total: sumar(total_sueldos, total_propinas),
    modo_propina: modo,
    turnos_abiertos: renglones.filter((r) => r.turnoAbierto).length,
    sin_tarifa: renglones.filter((r) => r.sinTarifa && r.minutos > 0).length,
  };
}
