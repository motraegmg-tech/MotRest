/**
 * Sobre común de todo evento del event log.
 *
 * DECISIÓN DE GONZALO (ADR-17): el software NO tiene reloj propio. Cada evento se
 * sella con `Date.now()` del dispositivo que lo origina — el reloj de esa PC,
 * tablet o iPad. Se eliminó el reloj lógico híbrido (HLC).
 *
 * Para desempatar dos eventos del MISMO dispositivo emitidos en el mismo
 * milisegundo se usa `orden_local`, un contador incremental: es un desempate,
 * no un reloj. El orden total entre dispositivos lo asignará el Hub cuando
 * llegue (`seq`), que es exactamente lo que manda el TRD §5.1.
 */
import type { ID } from "./comun/ids.js";
import { uuidv7 } from "./comun/ids.js";

/** Versión del esquema de eventos. Se incrementa al hacer cambios incompatibles. */
export const VERSION_EVENTO = 1;

export interface SobreEvento {
  /** UUIDv7 del evento (ordenable por tiempo, sirve de clave de deduplicación). */
  id: string;
  /** Reloj del dispositivo que originó el evento (epoch ms). */
  ts: number;
  /** Desempate para eventos del mismo dispositivo en el mismo milisegundo. */
  orden_local: number;
  /** Dispositivo de origen. */
  device_id: ID;
  /** Empleado autenticado que originó el evento. Sustrato de la bitácora (TRD §10). */
  empleado_id: ID;
  /** Sucursal a la que pertenece. Multi-tenant desde F1 (TRD §6). */
  sucursal_id: ID;
  /** Agregado al que pertenece el evento (orden_id, sesion_caja_id, insumo_id…). */
  stream_id: ID;
  /** Versión del esquema del evento (migraciones, TRD §11). */
  v: number;
  /** Secuencia total. La asigna el Hub al confirmar; ausente en modo isla. */
  seq?: number;
}

/** Forma mínima de cualquier evento del sistema. */
export interface EventoBase extends SobreEvento {
  tipo: string;
}

/** Datos propios de un evento, sin el sobre ni el discriminante `tipo`. */
export type SoloDatos<T extends EventoBase> = Omit<T, keyof SobreEvento | "tipo">;

/** Quién emite: dispositivo, empleado y sucursal. */
export interface ContextoEmision {
  device_id: ID;
  empleado_id: ID;
  sucursal_id: ID;
}

/**
 * Fábrica de eventos: estampa el sobre sobre los datos propios de cada evento.
 * Genérica sobre la familia de eventos (comanda, caja, inventario…).
 */
export class FabricaEventos<E extends EventoBase> {
  private ultimoTs = 0;
  private contador = 0;

  constructor(private contexto: ContextoEmision) {}

  /** Cambio rápido de usuario: los eventos siguientes quedan a nombre del nuevo empleado. */
  actualizarContexto(parcial: Partial<ContextoEmision>): void {
    this.contexto = { ...this.contexto, ...parcial };
  }

  get empleadoActual(): ID {
    return this.contexto.empleado_id;
  }

  private sellar(stream_id: ID): SobreEvento {
    const ts = Date.now();
    // Mismo milisegundo (o reloj que no avanzó): incrementamos el desempate.
    this.contador = ts === this.ultimoTs ? this.contador + 1 : 0;
    this.ultimoTs = ts;

    return {
      id: uuidv7(),
      ts,
      orden_local: this.contador,
      device_id: this.contexto.device_id,
      empleado_id: this.contexto.empleado_id,
      sucursal_id: this.contexto.sucursal_id,
      stream_id,
      v: VERSION_EVENTO,
    };
  }

  /** Crea un evento del `tipo` indicado sobre el agregado `stream_id`. */
  crear<Tipo extends E["tipo"]>(
    tipo: Tipo,
    stream_id: ID,
    datos: SoloDatos<Extract<E, { tipo: Tipo }>>,
  ): Extract<E, { tipo: Tipo }> {
    return {
      tipo,
      ...datos,
      ...this.sellar(stream_id),
    } as Extract<E, { tipo: Tipo }>;
  }
}

/**
 * Orden determinista de eventos de un mismo dispositivo o stream:
 * por reloj del dispositivo y, a igualdad, por el desempate local.
 * (Entre dispositivos distintos, el orden lo fija el Hub vía `seq`.)
 */
export function compararEventos(a: SobreEvento, b: SobreEvento): number {
  if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
  return a.orden_local - b.orden_local;
}
