/**
 * Implementación en memoria del contrato de persistencia.
 * Sirve para pruebas y para el modo efímero (sin almacenamiento disponible).
 */
import { compararEventos, type EventoBase, type ID } from "@motrest/dominio";
import type { Ack, Almacen, RepositorioEstado, RepositorioEventos } from "./repositorio.js";

export class RepositorioEventosMemoria implements RepositorioEventos {
  private porId = new Map<string, EventoBase>();

  async anexar(eventos: readonly EventoBase[]): Promise<void> {
    for (const ev of eventos) {
      // Idempotente por id: reanexar el mismo evento no lo duplica.
      if (!this.porId.has(ev.id)) this.porId.set(ev.id, ev);
    }
  }

  async leerTodos(): Promise<EventoBase[]> {
    return [...this.porId.values()].sort(compararEventos);
  }

  async leerStream(streamId: ID): Promise<EventoBase[]> {
    return [...this.porId.values()]
      .filter((ev) => ev.stream_id === streamId)
      .sort(compararEventos);
  }

  async pendientes(limite?: number): Promise<EventoBase[]> {
    const sinConfirmar = [...this.porId.values()]
      .filter((ev) => ev.seq === undefined)
      .sort(compararEventos);
    return limite === undefined ? sinConfirmar : sinConfirmar.slice(0, limite);
  }

  async confirmar(acks: readonly Ack[]): Promise<void> {
    for (const ack of acks) {
      const ev = this.porId.get(ack.id);
      if (ev) this.porId.set(ack.id, { ...ev, seq: ack.seq });
    }
  }

  async contar(): Promise<number> {
    return this.porId.size;
  }

  async limpiar(): Promise<void> {
    this.porId.clear();
  }
}

export class RepositorioEstadoMemoria implements RepositorioEstado {
  private datos = new Map<string, unknown>();

  async guardar<T>(clave: string, valor: T): Promise<void> {
    // Copia profunda simple: evita que el llamador mute lo guardado.
    this.datos.set(clave, JSON.parse(JSON.stringify(valor)));
  }

  async cargar<T>(clave: string): Promise<T | null> {
    const valor = this.datos.get(clave);
    return valor === undefined ? null : (JSON.parse(JSON.stringify(valor)) as T);
  }

  async eliminar(clave: string): Promise<void> {
    this.datos.delete(clave);
  }

  async limpiar(): Promise<void> {
    this.datos.clear();
  }
}

export function almacenEnMemoria(): Almacen {
  return {
    eventos: new RepositorioEventosMemoria(),
    estado: new RepositorioEstadoMemoria(),
    cerrar() {},
  };
}
