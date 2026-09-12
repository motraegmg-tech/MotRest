/**
 * Implementación en memoria del contrato de persistencia.
 * Sirve para pruebas y para el modo efímero (sin almacenamiento disponible).
 */
import { compararEventos, type EventoBase, type ID } from "@motrest/dominio";
import type {
  Ack,
  Almacen,
  EventoRechazado,
  RepositorioEstado,
  RepositorioEventos,
} from "./repositorio.js";

export class RepositorioEventosMemoria implements RepositorioEventos {
  private porId = new Map<string, EventoBase>();
  /** Los que el Hub rechazó: fuera del outbox pero dentro del log. */
  private rechazadosPorId = new Map<string, { motivo: string; ts: number }>();

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
      // Lo rechazado sale del outbox: reintentarlo es un bucle, no tolerancia
      // a fallos. Ver la nota de `rechazar` en el contrato.
      .filter((ev) => ev.seq === undefined && !this.rechazadosPorId.has(ev.id))
      .sort(compararEventos);
    return limite === undefined ? sinConfirmar : sinConfirmar.slice(0, limite);
  }

  async confirmar(acks: readonly Ack[]): Promise<void> {
    for (const ack of acks) {
      const ev = this.porId.get(ack.id);
      if (ev) this.porId.set(ack.id, { ...ev, seq: ack.seq });
      // Un rechazo deja de valer si el Hub acaba aceptando el evento: puede
      // pasar tras corregir los permisos del usuario y reenviarlo a mano.
      this.rechazadosPorId.delete(ack.id);
    }
  }

  async rechazar(ids: readonly ID[], motivo: string): Promise<void> {
    const ts = Date.now();
    for (const id of ids) {
      if (this.porId.has(id)) this.rechazadosPorId.set(id, { motivo, ts });
    }
  }

  async rechazados(): Promise<EventoRechazado[]> {
    const salida: EventoRechazado[] = [];
    for (const [id, { motivo, ts }] of this.rechazadosPorId) {
      const evento = this.porId.get(id);
      if (evento) salida.push({ evento, motivo, ts });
    }
    return salida.sort((a, b) => b.ts - a.ts);
  }

  async reabrirOutbox(): Promise<void> {
    for (const [id, ev] of this.porId) {
      if (ev.seq === undefined) continue;
      const { seq: _viejo, ...sinSeq } = ev;
      this.porId.set(id, sinSeq);
    }
    /*
     * Los rechazados NO se resucitan.
     *
     * `reabrirOutbox` existe para cuando el Hub perdió su historia y hay que
     * reenviárselo todo. Un evento rechazado por permisos lo va a rechazar
     * igual el Hub nuevo —el defecto está en el evento, no en el Hub—, así que
     * devolverlo al outbox solo reabriría el bucle.
     */
  }

  async purgarStreams(streamIds: readonly ID[]): Promise<number> {
    const objetivo = new Set(streamIds);
    if (objetivo.size === 0) return 0;

    // Las que tengan algo sin confirmar se saltan ENTERAS: media cuenta
    // borrada deja renglones que ya no se pueden ubicar en ninguna mesa.
    const conPendientes = new Set<string>();
    for (const ev of this.porId.values()) {
      if (objetivo.has(ev.stream_id) && ev.seq === undefined) conPendientes.add(ev.stream_id);
    }

    let retirados = 0;
    for (const [id, ev] of [...this.porId]) {
      if (!objetivo.has(ev.stream_id) || conPendientes.has(ev.stream_id)) continue;
      this.porId.delete(id);
      this.rechazadosPorId.delete(id);
      retirados += 1;
    }
    return retirados;
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
