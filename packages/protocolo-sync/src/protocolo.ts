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

/**
 * Un catálogo del local: el menú, el plano de piso, las impresoras.
 *
 * Los catálogos NO son event sourcing (TRD §5.2): son instantáneas versionadas
 * que se replican con CRUD/LWW. A nadie le importa el historial de cómo se
 * llegó al precio actual de un platillo; sí le importa cada peso cobrado, y eso
 * es lo que vive en el event log.
 */
export interface Catalogo {
  clave: string;
  version: number;
  updated_at: number;
  datos: unknown;
}

export interface MensajeCatalogo {
  tipo: "catalogo";
  catalogos: Catalogo[];
}

/**
 * Administración de las terminales del local.
 *
 * Va por el canal CIFRADO y no por HTTP a propósito: listar las terminales o
 * autorizar una nueva son operaciones sensibles, y por una ruta HTTP en claro
 * cualquiera en la red del local podría leer los identificadores y usarlos para
 * colarse. Aquí, quien no tiene la clave del local no puede ni formular la
 * petición.
 */
export interface MensajeAdmin {
  tipo: "admin";
  accion: "listar_terminales" | "autorizar" | "revocar" | "enlace_emparejamiento";
  device_id?: ID;
}

/**
 * Facturación: el CSD y la cola de timbrado.
 *
 * Va por el canal cifrado por la misma razón que la administración de
 * terminales, y con más motivo: **aquí viaja la contraseña de la llave privada
 * del CSD**, que es la firma fiscal del restaurante. Por HTTP en claro,
 * cualquiera en la red del local podría quedársela.
 *
 * Los archivos van en base64 porque el canal transporta JSON. Es el mismo
 * material que el SAT entrega: el `.cer` y el `.key` tal cual, sin convertir.
 */
export interface MensajeFiscal {
  tipo: "fiscal";
  accion: "estado" | "instalar_csd" | "desinstalar_csd" | "listar_cola" | "reintentar";
  /**
   * Quién lo pide.
   *
   * Que la terminal esté autorizada no basta aquí: administrar el CSD es
   * entregar la firma fiscal del negocio, y eso depende de la persona, no del
   * aparato. El Hub vuelve a evaluar el permiso contra su propia tabla de
   * usuarios, igual que hace con los eventos — un cliente manipulado puede
   * decir que es quien quiera.
   */
  empleado_id: ID;
  /** `instalar_csd`: el .cer del SAT en base64. */
  cer?: string;
  /** `instalar_csd`: el .key del SAT en base64. */
  key?: string;
  /** `instalar_csd`: la contraseña de la llave privada. */
  contrasena?: string;
  /** `instalar_csd`: a nombre de qué RFC se va a facturar. */
  rfc_emisor?: string;
  /** `reintentar`: qué orden reencolar. */
  orden_id?: ID;
}

/** Lo que se puede contar del CSD sin exponerlo. Nunca la llave ni la contraseña. */
export interface EstadoFiscal {
  csd_cargado: boolean;
  rfc: string | null;
  no_certificado: string | null;
  valido_hasta: string | null;
  dias_restantes: number | null;
  pac: string | null;
  cola: { pendientes: number; timbradas: number; rechazadas: number };
}

export interface FacturaEnCola {
  orden_id: ID;
  serie: string;
  folio: string;
  total: number;
  estado: "pendiente" | "timbrado" | "rechazado";
  /**
   * `recuperar` = el PAC ya la timbró y se está yendo por el documento.
   *
   * Se distingue en pantalla porque no es lo mismo "falta timbrarla" que "ya
   * está timbrada y falta traerla": lo segundo no requiere que nadie haga nada.
   */
  modo: "timbrar" | "recuperar";
  intentos: number;
  creado_ts: number;
  uuid: string | null;
  problema: string | null;
}

export interface MensajeFiscalRespuesta {
  tipo: "fiscal";
  estado: EstadoFiscal;
  cola?: FacturaEnCola[];
  /** Qué salió mal al instalar el CSD, en palabras que orienten. */
  problema?: string;
}

/**
 * Lo que hace falta para emparejar otra terminal, listo para pintar en un QR.
 *
 * Lo compone el Hub y no la terminal, porque solo él sabe sus direcciones en la
 * red. Viaja por el canal cifrado: **lleva la clave del local**.
 */
export interface MensajeEnlace {
  tipo: "enlace";
  /** Un enlace por cada dirección del Hub en la red. */
  enlaces: { etiqueta: string; url: string }[];
}

export interface TerminalRegistrada {
  device_id: ID;
  nombre: string | null;
  aprobado: boolean;
  visto_ts: number;
  ultimo_seq: number;
}

export interface MensajeTerminales {
  tipo: "terminales";
  terminales: TerminalRegistrada[];
}

export type MensajeCliente =
  | MensajeHola
  | MensajePush
  | MensajePull
  | MensajePing
  | MensajeCatalogo
  | MensajeAdmin
  | MensajeFiscal;

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
  | MensajePong
  | MensajeCatalogo
  | MensajeTerminales
  | MensajeEnlace
  | MensajeFiscalRespuesta;

/**
 * ¿La versión entrante de un catálogo gana a la que ya se tiene?
 *
 * Manda la VERSIÓN, no el reloj: los dispositivos sellan con su propia hora
 * (ADR-17) y una terminal con el reloj adelantado podría pisar para siempre los
 * cambios de las demás. El `updated_at` solo desempata dos ediciones que
 * partieron de la misma versión, y ahí sí gana la más reciente — es lo que
 * significa "last write wins".
 */
export function catalogoMasNuevo(
  entrante: { version: number; updated_at: number },
  actual: { version: number; updated_at: number } | null,
): boolean {
  if (!actual) return true;
  if (entrante.version !== actual.version) return entrante.version > actual.version;
  return entrante.updated_at > actual.updated_at;
}

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
