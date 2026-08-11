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
  diasConTurno,
  estaDentro,
  resumenAsistencia,
  siguienteChecada,
  streamAsistencia,
  turnosDe,
  type Checada,
  type DiaSemana,
  type EventoAsistencia,
  type ID,
  type ResumenAsistencia,
  type TipoChecada,
  type Turno,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { local } from "./local.svelte";
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

  /**
   * Resumen acotado a un periodo, para la prenómina.
   *
   * Se filtra por `momento` —el sello efectivo— y no por el `ts` del evento:
   * una checada corregida se capturó después, pero pertenece al día que se
   * trabajó. Pagar por la fecha de captura movería horas de una raya a otra.
   */
  resumenEn(
    trabajadorId: ID,
    rango: { desde: number; hasta: number },
    ahora = Date.now(),
  ): ResumenAsistencia {
    const dentro = this.eventos.filter(
      (e) => e.momento >= rango.desde && e.momento < rango.hasta,
    );
    return resumenAsistencia(dentro, trabajadorId, Math.min(ahora, rango.hasta));
  }

  /**
   * En qué días de la semana llegó a trabajar dentro del periodo.
   *
   * Lo pide la prenómina cuando el local paga por día: es lo que distingue una
   * falta de un día que no estaba programado. Mismo filtro por `momento` que
   * `resumenEn`, por la misma razón.
   */
  diasTrabajados(
    trabajadorId: ID,
    rango: { desde: number; hasta: number },
    ahora = Date.now(),
  ): DiaSemana[] {
    const dentro = this.eventos.filter(
      (e) => e.momento >= rango.desde && e.momento < rango.hasta,
    );
    return diasConTurno(dentro, trabajadorId, Math.min(ahora, rango.hasta)) as DiaSemana[];
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
   * La ENTRADA que se registra sola cuando alguien abre su sesión.
   *
   * ## Por qué existe
   *
   * El checador está pensado para una tablet en la puerta, pero en un local
   * pequeño no hay tal tablet: la gente llega, abre su usuario en la caja y se
   * pone a trabajar. Nadie va a marcar su hora en una pantalla aparte, así que
   * la prenómina del sábado salía en ceros y había que reconstruirla de memoria.
   * Iniciar sesión ES llegar a trabajar, y ahora queda registrado como tal.
   *
   * ## Las tres condiciones, y por qué cada una
   *
   *   1. **Solo la primera vez en la jornada.** Se cuenta contra la jornada del
   *      local, no contra el día natural: quien entra a las 22:00 de un viernes
   *      y sigue a la una de la mañana no fichó dos días.
   *   2. **Nunca si ya está dentro**, aunque venga de un turno de ayer sin
   *      cerrar: una segunda entrada abriría un turno nuevo y el anterior se
   *      quedaría abierto para siempre, inflando sus horas.
   *   3. **Nunca si ya checó hoy**, ni siquiera si ya se fue. Volver a entrar a
   *      la caja después de checar salida —a consultar algo, a cobrar una mesa
   *      pendiente— no es un turno nuevo, y darlo por tal le pagaría de más.
   *
   * Se captura a nombre del propio trabajador, no del dispositivo: es él quien
   * acaba de demostrar quién es tecleando su credencial.
   */
  entradaPorAcceso(trabajadorId: ID, ahora = Date.now()): ResultadoChecada | null {
    const suyas = this.checadas(trabajadorId);
    if (estaDentro(suyas)) return null;

    const jornada = local.jornada(ahora);
    const yaChecoHoy = suyas.some(
      (c) => c.momento >= jornada.desde && c.momento < jornada.hasta,
    );
    if (yaChecoHoy) return null;

    return this.registrar(trabajadorId, trabajadorId, "entrada", ahora);
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
