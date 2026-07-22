/**
 * Protocolo de sincronización entre dispositivos y Hub (TRD §5.1).
 *
 * Reglas que lo gobiernan y de las que depende todo lo demás:
 *
 * 1. **El Hub asigna la secuencia total.** Los dispositivos sellan sus eventos
 *    con su propio reloj (ADR-17), que puede ir adelantado o atrasado. Quién va
 *    antes que quién lo decide un solo árbitro, y es el Hub.
 *
 * 2. **La deduplicación es por UUID.** Reenviar un evento ya recibido no lo
 *    duplica: el Hub responde con el `seq` que YA le había asignado. Esto es lo
 *    que hace que reconectar tras un corte sea seguro — un dispositivo que no
 *    alcanzó a recibir sus confirmaciones puede reenviar sin miedo.
 *
 * 3. **El modo isla es el estado normal, no la excepción.** Un dispositivo sin
 *    Hub sigue vendiendo contra su log local. La sincronización es una mejora
 *    del sistema, nunca un requisito para operar (TRD R3).
 *
 * 4. **El servidor revalida.** Lo que el cliente evalúa de la matriz de permisos
 *    es para la experiencia; el Hub vuelve a comprobarlo porque un cliente
 *    manipulado puede mandar lo que quiera (TRD §10).
 */
import type { EventoBase, ID } from "@motrest/dominio";

/** Versión del protocolo. Un cambio incompatible la sube. */
export const VERSION_PROTOCOLO = 1;

// --- Dispositivo → Hub -----------------------------------------------------------------

export interface MensajeHola {
  tipo: "hola";
  v: number;
  device_id: ID;
  sucursal_id: ID;
  /** Última secuencia que este dispositivo ya tiene. 0 = quiere todo. */
  desde_seq: number;
  /** Credencial de emparejamiento del dispositivo. */
  token?: string;
}

export interface MensajePush {
  tipo: "push";
  eventos: EventoBase[];
}

export interface MensajePull {
  tipo: "pull";
  desde_seq: number;
  limite?: number;
}

/** Latido para detectar un enlace muerto que TCP todavía cree vivo. */
export interface MensajePing {
  tipo: "ping";
  ts: number;
}

export type MensajeCliente = MensajeHola | MensajePush | MensajePull | MensajePing;

// --- Hub → Dispositivo -----------------------------------------------------------------

export interface MensajeBienvenida {
  tipo: "bienvenida";
  v: number;
  hub_id: ID;
  /** Última secuencia asignada por el Hub. */
  seq_actual: number;
  /** Hora del Hub, para que el dispositivo sepa cuánto difiere su reloj. */
  ts: number;
}

export interface MensajeAcks {
  tipo: "acks";
  acks: { id: string; seq: number }[];
}

/**
 * Eventos que el dispositivo no tenía: los de otras terminales y, tras un
 * resync, también los propios que se hubieran perdido.
 */
export interface MensajeEventos {
  tipo: "eventos";
  eventos: EventoBase[];
  /** true = quedan más por entregar; el cliente debe volver a pedir. */
  hay_mas: boolean;
}

export type CodigoError =
  | "version_incompatible"
  | "no_emparejado"
  | "sucursal_distinta"
  | "evento_invalido"
  | "permiso_denegado";

export interface MensajeError {
  tipo: "error";
  codigo: CodigoError;
  mensaje: string;
  /** Si el error es de un evento concreto. */
  evento_id?: string;
}

export interface MensajePong {
  tipo: "pong";
  ts: number;
}

export type MensajeHub =
  | MensajeBienvenida
  | MensajeAcks
  | MensajeEventos
  | MensajeError
  | MensajePong;

// --- Serialización -----------------------------------------------------------------------

export function serializar(mensaje: MensajeCliente | MensajeHub): string {
  return JSON.stringify(mensaje);
}

/**
 * Interpreta un mensaje recibido.
 *
 * Devuelve `null` en vez de lanzar: por el canal puede llegar cualquier cosa
 * —un cliente viejo, un escáner de puertos, basura— y una excepción tumbaría la
 * conexión de un dispositivo que sí está trabajando.
 */
export function interpretar<T extends MensajeCliente | MensajeHub>(
  crudo: string,
): T | null {
  try {
    const dato: unknown = JSON.parse(crudo);
    if (typeof dato !== "object" || dato === null) return null;
    if (typeof (dato as { tipo?: unknown }).tipo !== "string") return null;
    return dato as T;
  } catch {
    return null;
  }
}

/**
 * Comprueba que un evento traiga lo mínimo para ser aceptado.
 *
 * El Hub NO confía en el cliente: un evento sin `id` no se puede deduplicar, y
 * uno sin `stream_id` no se puede proyectar. Aceptarlos corrompería el log de
 * forma silenciosa e irreversible — es un log append-only.
 */
export function eventoValido(evento: unknown): evento is EventoBase {
  if (typeof evento !== "object" || evento === null) return false;
  const e = evento as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.tipo === "string" &&
    typeof e.ts === "number" &&
    Number.isFinite(e.ts) &&
    typeof e.stream_id === "string" &&
    typeof e.device_id === "string" &&
    typeof e.sucursal_id === "string" &&
    typeof e.orden_local === "number"
  );
}

/** Estado del enlace, para pintarlo en la interfaz. */
export type EstadoEnlace = "isla" | "conectando" | "sincronizado" | "sincronizando";

export function etiquetaEnlace(estado: EstadoEnlace): string {
  switch (estado) {
    case "isla":
      return "Modo isla";
    case "conectando":
      return "Conectando…";
    case "sincronizando":
      return "Sincronizando…";
    case "sincronizado":
      return "Sincronizado";
  }
}
