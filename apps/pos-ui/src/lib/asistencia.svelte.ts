/**
 * Store del checador (M6).
 *
 * Cada checada es un hecho append-only, igual que la operación de venta: no se
 * edita, se corrige con otra checada que deja rastro de quién la autorizó.
 */
import {
  FabricaEventos,
  checadasDe,
  compararEventos,
  resumenAsistencia,
  siguienteChecada,
  streamAsistencia,
  turnosDe,
  type Checada,
  type EventoAsistencia,
  type ID,
  type ResumenAsistencia,
  type TipoChecada,
  type Turno,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface ResultadoChecada {
  ok: boolean;
  error?: string;
  tipo?: TipoChecada;
}

class StoreAsistencia {
  private eventos = $state.raw<EventoAsistencia[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoAsistencia>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  hidratar(eventos: readonly EventoAsistencia[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  /** Incorpora checadas de otra terminal, sin duplicar las ya conocidas. */
  integrar(eventos: readonly EventoAsistencia[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  private emitir(evento: EventoAsistencia): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar la checada", causa);
    });
  }

  // --- Consultas -------------------------------------------------------------------

  checadas(trabajadorId?: ID): Checada[] {
    return checadasDe(this.eventos, trabajadorId);
  }

  turnos(trabajadorId: ID, ahora = Date.now()): Turno[] {
    return turnosDe(this.checadas(trabajadorId), ahora);
  }

  resumen(trabajadorId: ID, ahora = Date.now()): ResumenAsistencia {
    return resumenAsistencia(this.eventos, trabajadorId, ahora);
  }

  /** Qué le toca checar a alguien ahora mismo. */
  siguiente(trabajadorId: ID): TipoChecada {
    return siguienteChecada(this.checadas(trabajadorId));
  }

  /** Las últimas checadas de todo el local, para el tablero de asistencia. */
  get recientes(): Checada[] {
    return checadasDe(this.eventos).reverse();
  }

  get hayRegistro(): boolean {
    return this.eventos.length > 0;
  }

  // --- Registro ----------------------------------------------------------------------

  /**
   * Registra la checada que toca.
   *
   * `capturadaPor` es quien tiene la sesión abierta en el dispositivo — en la
   * tablet de la entrada no es el trabajador. Por eso el dueño de la jornada
   * viaja como dato y no se toma del sobre del evento.
   */
  registrar(
    trabajadorId: ID,
    capturadaPor: ID,
    tipo?: TipoChecada,
    momento = Date.now(),
  ): ResultadoChecada {
    const checada = tipo ?? this.siguiente(trabajadorId);

    this.fabrica.actualizarContexto({ empleado_id: capturadaPor });
    this.emitir(
      this.fabrica.crear("checada_registrada", streamAsistencia(trabajadorId), {
        trabajador_id: trabajadorId,
        checada,
        momento,
      }),
    );
    return { ok: true, tipo: checada };
  }

  /**
   * Corrige una checada olvidada. No borra nada: agrega el hecho faltante con
   * su autorizador y su motivo, de modo que la nómina siempre pueda explicarse.
   */
  corregir(
    trabajadorId: ID,
    tipo: TipoChecada,
    momento: number,
    autorizadorId: ID,
    motivo: string,
  ): ResultadoChecada {
    if (!Number.isFinite(momento) || momento <= 0) {
      return { ok: false, error: "Escribe la hora de la checada" };
    }
    if (motivo.trim().length < 3) {
      return { ok: false, error: "Escribe por qué se corrige" };
    }

    this.fabrica.actualizarContexto({ empleado_id: autorizadorId });
    this.emitir(
      this.fabrica.crear("checada_registrada", streamAsistencia(trabajadorId), {
        trabajador_id: trabajadorId,
        checada: tipo,
        momento,
        autorizador_id: autorizadorId,
        motivo: motivo.trim(),
      }),
    );
    return { ok: true, tipo };
  }
}

export const asistencia = new StoreAsistencia();
