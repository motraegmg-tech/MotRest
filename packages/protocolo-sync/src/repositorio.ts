/**
 * Contrato de persistencia del event log.
 *
 * ADR-15 — Este contrato **ya es el lado cliente del protocolo de sincronización**,
 * aunque hoy solo exista la implementación local. Por eso incluye `pendientes()`
 * y `confirmar()`: el log local **es** el outbox. Cuando llegue el Hub (etapa 10)
 * solo habrá que empezar a leer las pendientes y enviarlas — no habrá que
 * reescribir el almacenamiento.
 *
 * Dos implementaciones:
 *   - `RepositorioMemoria`   → pruebas y modo efímero
 *   - `RepositorioIndexedDB` → navegador, Tauri y Capacitor (etapa 4)
 *   - `RepositorioSqlite`    → Hub y dispositivos (etapa 10)
 */
import type { EventoBase, ID } from "@motrest/dominio";

/** Un evento que el Hub no aceptó, con el porqué que dio. */
export interface EventoRechazado {
  evento: EventoBase;
  /** El mensaje del Hub, tal cual. Es lo que permite arreglarlo sin depurar. */
  motivo: string;
  /** Cuándo se supo. */
  ts: number;
}

export interface Ack {
  id: string;
  /** Secuencia total que asignó el Hub. */
  seq: number;
}

export interface RepositorioEventos {
  /** Agrega eventos al log. Idempotente: reanexar el mismo id no duplica. */
  anexar(eventos: readonly EventoBase[]): Promise<void>;

  /** Todos los eventos, en orden determinista. */
  leerTodos(): Promise<EventoBase[]>;

  /** Eventos de un agregado concreto (una orden, una sesión de caja…). */
  leerStream(streamId: ID): Promise<EventoBase[]>;

  /** Eventos que el Hub todavía no ha confirmado. Es el outbox. */
  pendientes(limite?: number): Promise<EventoBase[]>;

  /** Marca eventos como confirmados por el Hub, con su secuencia total. */
  confirmar(acks: readonly Ack[]): Promise<void>;

  /**
   * Saca del outbox un evento que el Hub rechazó DEFINITIVAMENTE.
   *
   * ## Por qué hace falta un tercer estado
   *
   * El outbox tenía dos: pendiente y confirmado. Un evento que el Hub rechaza
   * por permisos no es ninguno de los dos, y tratarlo como pendiente es lo que
   * produjo el peor defecto silencioso que ha tenido este sistema:
   *
   * En Rodizio, un `caja_cerrada` emitido a nombre de `sistema` —que no está en
   * el padrón— se rechaza siempre. Como nunca se confirma, sigue en el outbox;
   * en cada reconexión se reenvía, lo vuelven a rechazar, la terminal cae a
   * isla, reconecta y vuelve a empezar. Cada pocos minutos, durante meses. Y
   * mientras tanto el corte de caja del local **no existe** en el Hub y nadie
   * se enteró.
   *
   * Un rechazo por permisos es DETERMINISTA: el mismo evento con el mismo
   * emisor va a fallar siempre. Reintentar no es tolerancia a fallos, es un
   * bucle. Aquí se aparta, se guarda el motivo y se puede enseñar.
   *
   * NO se marca como confirmado, y esa distinción importa: `reabrirOutbox()`
   * devuelve al outbox todo lo confirmado, así que confundirlos resucitaría el
   * bucle en cuanto el Hub cambiara de disco.
   *
   * El evento NO se borra: sigue en el log local y en la proyección de esta
   * terminal. Lo único que se pierde es el reintento inútil.
   */
  rechazar(ids: readonly ID[], motivo: string): Promise<void>;

  /** Lo que el Hub rechazó, para poder enseñarlo en vez de esconderlo. */
  rechazados(): Promise<EventoRechazado[]>;

  /**
   * Devuelve TODO el log al outbox, como si nada estuviera confirmado.
   *
   * Se usa cuando el Hub aparece con menos historia de la que ya nos había
   * confirmado: disco cambiado, reinstalación, respaldo restaurado o
   * simplemente otro Hub. Una confirmación es una promesa sobre un Hub
   * concreto; si ese Hub perdió la memoria, la promesa dejó de valer y esta
   * terminal es quien tiene los datos.
   *
   * Reenviar no duplica: el Hub deduplica por el id del evento.
   */
  reabrirOutbox(): Promise<void>;

  /** Cuántos eventos hay guardados. */
  contar(): Promise<number>;

  /** Borra todo el log. Solo para reiniciar la demostración. */
  limpiar(): Promise<void>;
}

/**
 * Almacén clave-valor para lo que NO es un evento: credenciales (que jamás van
 * al log, porque el log es la bitácora), contadores de intentos y la sesión
 * abierta.
 */
export interface RepositorioEstado {
  guardar<T>(clave: string, valor: T): Promise<void>;
  cargar<T>(clave: string): Promise<T | null>;
  eliminar(clave: string): Promise<void>;
  limpiar(): Promise<void>;
}

export interface Almacen {
  eventos: RepositorioEventos;
  estado: RepositorioEstado;
  /** Cierra la conexión subyacente, si la hay. */
  cerrar(): void;
}

/** Claves conocidas del almacén de estado. */
export const CLAVES = {
  credenciales: "credenciales",
  intentos: "intentos",
  sesion: "sesion_activa",
  versionSemilla: "version_semilla",
  /** Hash del código de rescate del propietario. Nunca el código en claro. */
  rescate: "rescate",
  /** Provisión firmada que ya entregó el PIN inicial al responsable local. */
  provisionesResponsable: "provisiones_responsable",
} as const;
