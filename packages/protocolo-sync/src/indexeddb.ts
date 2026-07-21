/**
 * Persistencia local sobre IndexedDB (navegador, Tauri y Capacitor).
 *
 * Esquema versionado: subir `VERSION_ESQUEMA` y añadir el paso correspondiente
 * en `migrar()`. Es el mismo criterio que aplicará el Hub con SQLite (TRD §11).
 */
import { compararEventos, type EventoBase, type ID } from "@motrest/dominio";
import type { Ack, Almacen, RepositorioEstado, RepositorioEventos } from "./repositorio.js";

const NOMBRE_BD = "motrest";
export const VERSION_ESQUEMA = 1;

const TIENDA_EVENTOS = "eventos";
const TIENDA_ESTADO = "estado";

/** Marca de confirmación indexable (IndexedDB no indexa `undefined`). */
const PENDIENTE = 0;
const CONFIRMADO = 1;

interface EventoGuardado {
  id: string;
  stream_id: ID;
  ts: number;
  confirmado: 0 | 1;
  evento: EventoBase;
}

function promesa<T>(peticion: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

function alTerminar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error);
  });
}

function migrar(bd: IDBDatabase, desde: number): void {
  if (desde < 1) {
    const eventos = bd.createObjectStore(TIENDA_EVENTOS, { keyPath: "id" });
    eventos.createIndex("stream_id", "stream_id");
    eventos.createIndex("confirmado", "confirmado");
    eventos.createIndex("ts", "ts");
    bd.createObjectStore(TIENDA_ESTADO, { keyPath: "clave" });
  }
  // Migraciones futuras: if (desde < 2) { … }
}

export function abrirBaseDatos(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(NOMBRE_BD, VERSION_ESQUEMA);
    peticion.onupgradeneeded = (evento) => {
      migrar(peticion.result, evento.oldVersion);
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
    peticion.onblocked = () =>
      rechazar(new Error("Otra pestaña tiene abierta una versión anterior de la base"));
  });
}

export class RepositorioEventosIDB implements RepositorioEventos {
  constructor(private readonly bd: IDBDatabase) {}

  async anexar(eventos: readonly EventoBase[]): Promise<void> {
    if (eventos.length === 0) return;
    const tx = this.bd.transaction(TIENDA_EVENTOS, "readwrite");
    const tienda = tx.objectStore(TIENDA_EVENTOS);
    for (const evento of eventos) {
      const fila: EventoGuardado = {
        id: evento.id,
        stream_id: evento.stream_id,
        ts: evento.ts,
        confirmado: evento.seq === undefined ? PENDIENTE : CONFIRMADO,
        evento,
      };
      // `put` mantiene la idempotencia por id (deduplicación, TRD §5).
      tienda.put(fila);
    }
    await alTerminar(tx);
  }

  private async filas(indice?: { nombre: string; valor: IDBValidKey }): Promise<EventoGuardado[]> {
    const tx = this.bd.transaction(TIENDA_EVENTOS, "readonly");
    const tienda = tx.objectStore(TIENDA_EVENTOS);
    const origen = indice ? tienda.index(indice.nombre) : tienda;
    const resultado = await promesa<EventoGuardado[]>(
      (indice ? origen.getAll(indice.valor) : origen.getAll()) as IDBRequest<EventoGuardado[]>,
    );
    return resultado;
  }

  async leerTodos(): Promise<EventoBase[]> {
    const filas = await this.filas();
    return filas.map((f) => f.evento).sort(compararEventos);
  }

  async leerStream(streamId: ID): Promise<EventoBase[]> {
    const filas = await this.filas({ nombre: "stream_id", valor: streamId });
    return filas.map((f) => f.evento).sort(compararEventos);
  }

  async pendientes(limite?: number): Promise<EventoBase[]> {
    const filas = await this.filas({ nombre: "confirmado", valor: PENDIENTE });
    const ordenados = filas.map((f) => f.evento).sort(compararEventos);
    return limite === undefined ? ordenados : ordenados.slice(0, limite);
  }

  async confirmar(acks: readonly Ack[]): Promise<void> {
    if (acks.length === 0) return;
    const tx = this.bd.transaction(TIENDA_EVENTOS, "readwrite");
    const tienda = tx.objectStore(TIENDA_EVENTOS);
    for (const ack of acks) {
      const fila = await promesa<EventoGuardado | undefined>(
        tienda.get(ack.id) as IDBRequest<EventoGuardado | undefined>,
      );
      if (!fila) continue;
      tienda.put({
        ...fila,
        confirmado: CONFIRMADO,
        evento: { ...fila.evento, seq: ack.seq },
      });
    }
    await alTerminar(tx);
  }

  async contar(): Promise<number> {
    const tx = this.bd.transaction(TIENDA_EVENTOS, "readonly");
    return promesa(tx.objectStore(TIENDA_EVENTOS).count());
  }

  async limpiar(): Promise<void> {
    const tx = this.bd.transaction(TIENDA_EVENTOS, "readwrite");
    tx.objectStore(TIENDA_EVENTOS).clear();
    await alTerminar(tx);
  }
}

export class RepositorioEstadoIDB implements RepositorioEstado {
  constructor(private readonly bd: IDBDatabase) {}

  async guardar<T>(clave: string, valor: T): Promise<void> {
    const tx = this.bd.transaction(TIENDA_ESTADO, "readwrite");
    tx.objectStore(TIENDA_ESTADO).put({ clave, valor });
    await alTerminar(tx);
  }

  async cargar<T>(clave: string): Promise<T | null> {
    const tx = this.bd.transaction(TIENDA_ESTADO, "readonly");
    const fila = await promesa<{ clave: string; valor: T } | undefined>(
      tx.objectStore(TIENDA_ESTADO).get(clave) as IDBRequest<{ clave: string; valor: T } | undefined>,
    );
    return fila ? fila.valor : null;
  }

  async eliminar(clave: string): Promise<void> {
    const tx = this.bd.transaction(TIENDA_ESTADO, "readwrite");
    tx.objectStore(TIENDA_ESTADO).delete(clave);
    await alTerminar(tx);
  }

  async limpiar(): Promise<void> {
    const tx = this.bd.transaction(TIENDA_ESTADO, "readwrite");
    tx.objectStore(TIENDA_ESTADO).clear();
    await alTerminar(tx);
  }
}

/** Abre el almacén local. `factory` permite inyectar una implementación en pruebas. */
export async function almacenIndexedDB(factory?: IDBFactory): Promise<Almacen> {
  const idb = factory ?? globalThis.indexedDB;
  if (!idb) throw new Error("IndexedDB no está disponible en este entorno");
  const bd = await abrirBaseDatos(idb);
  return {
    eventos: new RepositorioEventosIDB(bd),
    estado: new RepositorioEstadoIDB(bd),
    cerrar: () => bd.close(),
  };
}
