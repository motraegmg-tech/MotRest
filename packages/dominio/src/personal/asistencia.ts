/**
 * M6 · Checador de asistencia.
 *
 * Cada checada es un HECHO inmutable: no se edita, se corrige con otra checada
 * de ajuste que deja rastro de quién la autorizó. Es la misma regla que en caja
 * — en un sistema donde la asistencia se puede reescribir en silencio, la
 * prenómina no vale nada.
 *
 * Los sellos vienen del reloj de cada dispositivo (ADR-17). Cuando llegue el Hub
 * él asignará el orden total, pero la hora que se le muestra al empleado es la
 * de la máquina donde checó, que es la que él ve en la pared.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

export type TipoChecada = "entrada" | "salida" | "inicio_descanso" | "fin_descanso";

export const TIPOS_CHECADA: { valor: TipoChecada; etiqueta: string; abre: boolean }[] = [
  { valor: "entrada", etiqueta: "Entrada", abre: true },
  { valor: "salida", etiqueta: "Salida", abre: false },
  { valor: "inicio_descanso", etiqueta: "Inicio de descanso", abre: false },
  { valor: "fin_descanso", etiqueta: "Fin de descanso", abre: true },
];

export function etiquetaChecada(tipo: TipoChecada): string {
  return TIPOS_CHECADA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;
}

/**
 * Una checada.
 *
 * `trabajador_id` NO se llama `empleado_id` a propósito: el sobre del evento ya
 * usa ese nombre para "quién emitió", y no son lo mismo. En un checador
 * compartido —una tablet en la entrada— quien emite es el dispositivo con la
 * sesión abierta, y en una corrección es el gerente. Si ambos campos se
 * llamaran igual, el sobre pisaría al dato y toda la jornada se le cargaría a
 * la persona equivocada.
 */
export type EventoAsistencia = EventoBase & {
  tipo: "checada_registrada";
  /** De quién es la jornada. */
  trabajador_id: ID;
  checada: TipoChecada;
  /** Sello efectivo. En una corrección puede diferir del `ts` del evento. */
  momento: number;
  /** Presente solo si es una corrección: quién la autorizó y por qué. */
  autorizador_id?: ID;
  motivo?: string;
};

/** Stream de asistencia de un empleado. */
export function streamAsistencia(empleadoId: ID): ID {
  return `asistencia:${empleadoId}`;
}

export interface Checada {
  id: ID;
  trabajador_id: ID;
  tipo: TipoChecada;
  momento: number;
  corregida: boolean;
  /** Quién capturó la checada: el propio trabajador, o un superior al corregir. */
  capturada_por: ID;
  autorizador_id?: ID;
  motivo?: string;
}

/**
 * Todas las checadas de un empleado, en orden cronológico por su momento
 * efectivo — no por cuándo se capturaron, que puede diferir en una corrección.
 */
export function checadasDe(
  eventos: readonly EventoAsistencia[],
  trabajadorId?: ID,
): Checada[] {
  return eventos
    .filter((e) => !trabajadorId || e.trabajador_id === trabajadorId)
    .map((e) => ({
      id: e.id,
      trabajador_id: e.trabajador_id,
      tipo: e.checada,
      momento: e.momento,
      corregida: e.autorizador_id !== undefined,
      capturada_por: e.empleado_id,
      autorizador_id: e.autorizador_id,
      motivo: e.motivo,
    }))
    .sort((a, b) => a.momento - b.momento);
}

/** Qué le toca checar a alguien ahora, según su última marca. */
export function siguienteChecada(checadas: readonly Checada[]): TipoChecada {
  const ultima = checadas.at(-1);
  if (!ultima) return "entrada";
  switch (ultima.tipo) {
    case "entrada":
    case "fin_descanso":
      return "salida";
    case "inicio_descanso":
      return "fin_descanso";
    case "salida":
      return "entrada";
  }
}

/** ¿Está dentro del local ahora mismo? */
export function estaDentro(checadas: readonly Checada[]): boolean {
  const ultima = checadas.at(-1);
  if (!ultima) return false;
  return ultima.tipo === "entrada" || ultima.tipo === "fin_descanso";
}

export interface Turno {
  entrada: number;
  salida?: number;
  /** Minutos trabajados, ya descontados los descansos. */
  minutos: number;
  /** Minutos de descanso dentro del turno. */
  descanso: number;
  /** true = sigue abierto (entró y no ha salido). */
  abierto: boolean;
}

/**
 * Arma los turnos a partir de las checadas.
 *
 * Un turno sin salida queda ABIERTO y se mide hasta `ahora`: es el caso normal
 * de quien está trabajando en este momento, y también el de quien olvidó checar
 * su salida. No se cierra solo ni se inventa una hora — el turno abierto es
 * justamente la señal de que alguien tiene que revisarlo.
 */
export function turnosDe(checadas: readonly Checada[], ahora: number): Turno[] {
  const turnos: Turno[] = [];
  let actual: Turno | null = null;
  let descansoDesde: number | null = null;

  for (const checada of checadas) {
    switch (checada.tipo) {
      case "entrada":
        // Una entrada sin salida previa cierra el turno anterior como abierto.
        if (actual) turnos.push(actual);
        actual = {
          entrada: checada.momento,
          minutos: 0,
          descanso: 0,
          abierto: true,
        };
        descansoDesde = null;
        break;

      case "inicio_descanso":
        if (actual) descansoDesde = checada.momento;
        break;

      case "fin_descanso":
        if (actual && descansoDesde !== null) {
          actual.descanso += Math.max(0, checada.momento - descansoDesde);
          descansoDesde = null;
        }
        break;

      case "salida":
        if (actual) {
          // Un descanso sin cerrar se corta con la salida, en vez de perderse.
          if (descansoDesde !== null) {
            actual.descanso += Math.max(0, checada.momento - descansoDesde);
            descansoDesde = null;
          }
          actual.salida = checada.momento;
          actual.abierto = false;
          turnos.push(actual);
          actual = null;
        }
        break;
    }
  }

  if (actual) turnos.push(actual);

  return turnos.map((t) => {
    const fin = t.salida ?? ahora;
    const bruto = Math.max(0, fin - t.entrada);
    const descanso = Math.min(t.descanso, bruto);
    return {
      ...t,
      descanso: Math.round(descanso / 60_000),
      minutos: Math.round((bruto - descanso) / 60_000),
    };
  });
}

export interface ResumenAsistencia {
  trabajador_id: ID;
  turnos: number;
  /** Minutos efectivamente trabajados. */
  minutos: number;
  minutosDescanso: number;
  dentro: boolean;
  /** true = hay algún turno sin salida registrada. */
  turnoAbierto: boolean;
  ultima?: Checada;
}

export function resumenAsistencia(
  eventos: readonly EventoAsistencia[],
  trabajadorId: ID,
  ahora: number,
): ResumenAsistencia {
  const checadas = checadasDe(eventos, trabajadorId);
  const turnos = turnosDe(checadas, ahora);
  return {
    trabajador_id: trabajadorId,
    turnos: turnos.length,
    minutos: turnos.reduce((n, t) => n + t.minutos, 0),
    minutosDescanso: turnos.reduce((n, t) => n + t.descanso, 0),
    dentro: estaDentro(checadas),
    turnoAbierto: turnos.some((t) => t.abierto),
    ultima: checadas.at(-1),
  };
}

/** Formatea minutos como "7 h 35 min", que es como se lee una jornada. */
export function formatearJornada(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}
