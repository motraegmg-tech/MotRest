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
} as const;
