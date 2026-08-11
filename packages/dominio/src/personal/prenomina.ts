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
import { CERO, repartirProporcional, restar, sumar, deCentavos, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import { DIAS_DEL_ROL, type DiaSemana } from "./asignaciones.js";

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

/**
 * Cómo paga el local el sueldo base. Las dos formas conviven en México y un
 * mismo restaurante puede usar una para cocina y otra para el salón, así que se
 * elige por local y no se impone.
 */
export type ModoSueldo =
  | "por_hora" /** Horas del checador × tarifa. */
  | "por_dia"; /** Sueldo pactado para cada día de la semana; la falta se descuenta. */

export const MODOS_SUELDO: { valor: ModoSueldo; etiqueta: string; descripcion: string }[] = [
  {
    valor: "por_hora",
    etiqueta: "Por hora trabajada",
    descripcion:
      "Se paga lo que marca el checador multiplicado por la tarifa. Sirve para turnos irregulares y para quien cubre horas sueltas.",
  },
  {
    valor: "por_dia",
    etiqueta: "Sueldo diario fijo",
    descripcion:
      "Cada quien tiene un sueldo pactado para cada día de la semana. Si falta a un día programado, ese día se descuenta de su raya.",
  },
];

/**
 * Lo que gana alguien cada día de la semana.
 *
 * Un día ausente del mapa es DESCANSO, no un cero: la diferencia importa,
 * porque no venir en tu día libre no es una falta y no puede descontarse.
 */
export type SueldoSemanal = Partial<Record<DiaSemana, Centavos>>;

export type EventoPrenomina =
  | (EventoBase & {
      /**
       * Se le fija la tarifa por hora a alguien. Es un evento y no un campo porque
       * un cambio de sueldo debe quedar en la bitácora: cuándo, y quién lo autorizó.
       */
      tipo: "tarifa_asignada";
      trabajador_id: ID;
      /** Pago por hora trabajada. */
      tarifa_hora: Centavos;
      nota?: string;
    })
  | (EventoBase & {
      /**
       * Se le fija a alguien lo que gana cada día de la semana.
       *
       * Se guarda la SEMANA ENTERA en un solo evento y no un día por evento: el
       * dueño no ajusta el martes en aislado, revisa el rol completo de esa
       * persona y lo deja como quiere. Un evento por día haría que reconstruir su
       * semana dependiera de no haber perdido ninguno.
       */
      tipo: "sueldo_diario_asignado";
      trabajador_id: ID;
      sueldo_por_dia: SueldoSemanal;
      nota?: string;
    });

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

/** El sueldo semanal vigente de cada quien: el último asignado gana. */
export function sueldosVigentes(eventos: readonly EventoPrenomina[]): Map<ID, SueldoSemanal> {
  const sueldos = new Map<ID, SueldoSemanal>();
  for (const ev of eventos) {
    if (ev.tipo === "sueldo_diario_asignado") {
      sueldos.set(ev.trabajador_id, { ...ev.sueldo_por_dia });
    }
  }
  return sueldos;
}

/** Lo que costaría la semana completa de alguien, sin faltas. */
export function sueldoSemanal(sueldo: SueldoSemanal): Centavos {
  return sumar(...Object.values(sueldo).filter((v): v is Centavos => v !== undefined));
}

/** Los días que esa persona tiene programados (los demás son su descanso). */
export function diasProgramados(sueldo: SueldoSemanal): DiaSemana[] {
  return DIAS_DEL_ROL.map((d) => d.valor).filter((dia) => (sueldo[dia] ?? 0) > 0);
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
  /**
   * Días de la semana en los que llegó a checar dentro del periodo.
   *
   * Es lo que separa una falta de un día trabajado en el modo por día. Ausente
   * = el llamador no lo calculó, y entonces no se descuenta nada: preferimos
   * pagar de más a inventar una falta que nadie puede comprobar.
   */
  dias_asistidos?: DiaSemana[];
}

export interface RenglonPrenomina extends JornadaTrabajador {
  tarifa_hora: Centavos;
  /** Horas con dos decimales, para que el renglón se pueda revisar a mano. */
  horas: number;
  sueldo: Centavos;
  propinas: Centavos;
  total: Centavos;
  /** true = no tiene condiciones capturadas; su sueldo sale en cero. */
  sinTarifa: boolean;

  // --- Solo con sueldo diario. En modo por hora salen en cero o vacíos. ---
  /** Lo pactado para cada día de la semana. */
  sueldo_por_dia: SueldoSemanal;
  /** Lo que le tocaría si asistiera a todos sus días programados. */
  sueldo_programado: Centavos;
  /** Días que tenía programados dentro del periodo que ya transcurrió. */
  dias_programados: DiaSemana[];
  /** Días programados a los que NO llegó. */
  faltas: DiaSemana[];
  /** Lo que se le descuenta por esas faltas. */
  descuento_faltas: Centavos;
}

export interface Prenomina {
  renglones: RenglonPrenomina[];
  total_sueldos: Centavos;
  total_propinas: Centavos;
  total: Centavos;
  modo_propina: ModoPropina;
  modo_sueldo: ModoSueldo;
  /** Trabajadores con un turno sin cerrar: sus horas están infladas. */
  turnos_abiertos: number;
  /** Trabajadores sin tarifa ni sueldo capturados. */
  sin_tarifa: number;
  /** Cuántas faltas hubo en el periodo, sumando a todo el equipo. */
  faltas: number;
  /** Lo descontado por esas faltas. Se enseña aparte: es una cifra sensible. */
  total_descuentos: Centavos;
}

/** Vacío de los campos del sueldo diario, para el modo por hora. */
const SIN_SUELDO_DIARIO = {
  sueldo_por_dia: {} as SueldoSemanal,
  sueldo_programado: CERO,
  dias_programados: [] as DiaSemana[],
  faltas: [] as DiaSemana[],
  descuento_faltas: CERO,
};

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
  opciones: {
    modoPropina?: ModoPropina;
    fondoPropinas?: Centavos;
    /** Cómo paga el local el sueldo base. Por omisión, por hora: lo de siempre. */
    modoSueldo?: ModoSueldo;
    /** Sueldo pactado por día de la semana. Solo se usa en modo por día. */
    sueldos?: ReadonlyMap<ID, SueldoSemanal>;
    /**
     * Días de la semana que YA transcurrieron dentro del periodo.
     *
     * Es lo que evita el error más caro de este cálculo: en la semana en curso,
     * un martes no puede contar como falta el viernes que todavía no llega. Si
     * no se pasa, se consideran los siete —correcto para una semana cerrada—.
     */
    diasTranscurridos?: readonly DiaSemana[];
  } = {},
): Prenomina {
  const modo = opciones.modoPropina ?? "directo";
  const modoSueldo = opciones.modoSueldo ?? "por_hora";
  const sueldos = opciones.sueldos;
  const transcurridos = opciones.diasTranscurridos
    ? new Set<DiaSemana>(opciones.diasTranscurridos)
    : null;

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
    const propinas = propinasPorModo[i] ?? CERO;
    const base =
      modoSueldo === "por_dia"
        ? sueldoDelPeriodo(j, sueldos?.get(j.trabajador_id), transcurridos)
        : {
            ...SIN_SUELDO_DIARIO,
            sueldo: tarifa ? deCentavos(Math.round((j.minutos / 60) * tarifa)) : CERO,
            sinTarifa: tarifa === undefined,
          };

    return {
      ...j,
      ...base,
      tarifa_hora: tarifa ?? CERO,
      horas,
      propinas,
      total: sumar(base.sueldo, propinas),
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
    modo_sueldo: modoSueldo,
    turnos_abiertos: renglones.filter((r) => r.turnoAbierto).length,
    sin_tarifa: renglones.filter((r) => r.sinTarifa && r.minutos > 0).length,
    faltas: renglones.reduce((n, r) => n + r.faltas.length, 0),
    total_descuentos: sumar(...renglones.map((r) => r.descuento_faltas)),
  };
}

/**
 * Sueldo diario del periodo: lo programado menos lo que no se presentó.
 *
 * DOS REGLAS QUE PROTEGEN AL EMPLEADO, y las dos son deliberadas:
 *
 *  1. **Un día sin sueldo pactado es descanso, no una falta.** No venir en tu
 *     día libre no puede descontar nada.
 *  2. **Un día que todavía no ha llegado tampoco es falta.** Sin esto, abrir la
 *     prenómina un martes enseñaría a todo el equipo debiendo media semana, y
 *     esa cifra es la que alguien acabaría pagando por descuido.
 *
 * Si el llamador no dice qué días asistió cada quien, no se descuenta nada: una
 * falta que el software no puede probar no se cobra.
 */
function sueldoDelPeriodo(
  jornada: JornadaTrabajador,
  sueldo: SueldoSemanal | undefined,
  transcurridos: ReadonlySet<DiaSemana> | null,
): Pick<
  RenglonPrenomina,
  | "sueldo"
  | "sinTarifa"
  | "sueldo_por_dia"
  | "sueldo_programado"
  | "dias_programados"
  | "faltas"
  | "descuento_faltas"
> {
  if (!sueldo || sueldoSemanal(sueldo) <= 0) {
    return { ...SIN_SUELDO_DIARIO, sueldo: CERO, sinTarifa: true };
  }

  const programados = diasProgramados(sueldo).filter(
    (dia) => transcurridos === null || transcurridos.has(dia),
  );
  const sueldo_programado = sumar(...programados.map((dia) => sueldo[dia] ?? CERO));

  const asistidos = jornada.dias_asistidos;
  const faltas = asistidos ? programados.filter((dia) => !asistidos.includes(dia)) : [];
  const descuento_faltas = sumar(...faltas.map((dia) => sueldo[dia] ?? CERO));

  return {
    sueldo: restar(sueldo_programado, descuento_faltas),
    sinTarifa: false,
    sueldo_por_dia: sueldo,
    sueldo_programado,
    dias_programados: programados,
    faltas,
    descuento_faltas,
  };
}
