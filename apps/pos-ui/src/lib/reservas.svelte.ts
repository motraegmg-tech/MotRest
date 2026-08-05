/**
 * Store de reservas y lista de espera (M7 · F3).
 *
 * La estimación de espera NO se guarda: se calcula contra el salón de este
 * momento y contra la rotación real del local. Guardarla la volvería una
 * promesa vieja, y una espera vieja es peor que ninguna.
 */
import {
  FabricaEventos,
  choquesDeMesa,
  compararEventos,
  esperaEstimada,
  proyectarReservas,
  reservasEnPuerta,
  reservasSolicitadas,
  reservasVigentes,
  rotacionObservada,
  streamReservas,
  uuidv7,
  type EventoReserva,
  type ID,
  type Reserva,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { plano } from "./plano.svelte";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface EnEspera {
  id: ID;
  nombre: string;
  telefono?: string;
  personas: number;
  /** Cuándo se anotó. Contra el reloj da cuánto lleva de pie. */
  desde_ts: number;
}

class StoreReservas {
  private eventos = $state.raw<EventoReserva[]>([]);
  private almacen: Almacen | null = null;

  /*
   * La lista de espera vive SOLO en esta terminal y no en el event log.
   *
   * Es deliberado: quien espera de pie está en la puerta durante veinte
   * minutos, no es historia del negocio, y meterlo al log lo haría viajar a
   * todas las terminales y quedarse ahí para siempre. Si la caja se reinicia se
   * pierde la lista, y eso es aceptable — quien está formado sigue estando
   * enfrente y se vuelve a anotar en diez segundos.
   */
  espera = $state<EnEspera[]>([]);

  private fabrica = new FabricaEventos<EventoReserva>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  reservas = $derived(proyectarReservas(this.eventos));
  vigentes = $derived(reservasVigentes(this.reservas));

  /**
   * Lo que pidieron desde el portal y la casa todavía no contesta.
   *
   * Es una BANDEJA, no una agenda: cada una espera una decisión. Dejarlas
   * mezcladas con las confirmadas haría que nadie las contestara, y un comensal
   * que pidió mesa y no recibe respuesta se va a otro lado.
   */
  solicitadas = $derived(reservasSolicitadas(this.reservas));

  /** Cuánto dura una sentada en ESTE local, medido del log. */
  rotacion = $derived(rotacionObservada(pos.todasLasComandas));

  hidratar(eventos: readonly EventoReserva[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoReserva[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoReserva): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar la reserva", causa);
    });
  }

  // --- Reservas ------------------------------------------------------------------

  /** Quién más quiere esa mesa a esa hora. Se consulta ANTES de anotar. */
  choques(mesaId: ID, paraTs: number, duracionMin?: number, excluir?: ID) {
    return choquesDeMesa(this.reservas, mesaId, paraTs, duracionMin, excluir);
  }

  enPuerta(ahora = Date.now(), toleranciaMin = 15) {
    return reservasEnPuerta(this.reservas, ahora, toleranciaMin);
  }

  apartar(datos: {
    nombre: string;
    telefono?: string;
    personas: number;
    para_ts: number;
    mesa_id?: ID;
    duracion_min?: number;
    notas?: string;
  }): { ok: boolean; error?: string } {
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) {
      return { ok: false, error: "Escribe a nombre de quién va la reserva" };
    }
    if (!Number.isInteger(datos.personas) || datos.personas < 1) {
      return { ok: false, error: "¿Cuántas personas vienen?" };
    }

    this.emitir(
      this.fabrica.crear("reserva_creada", streamReservas(SUCURSAL_ID), {
        reserva_id: uuidv7(),
        nombre,
        telefono: datos.telefono?.trim() || undefined,
        personas: datos.personas,
        para_ts: datos.para_ts,
        mesa_id: datos.mesa_id,
        duracion_min: datos.duracion_min,
        notas: datos.notas?.trim() || undefined,
      }),
    );
    return { ok: true };
  }

  /**
   * Sienta la reserva: abre la mesa y deja la cuenta a nombre de quien reservó.
   *
   * Las dos cosas van juntas a propósito. Sentar en la agenda y abrir la mesa
   * por separado es como se llega al viernes con reservas "pendientes" que ya
   * están comiendo.
   */
  async sentar(reservaId: ID, mesaId: ID): Promise<{ ok: boolean; error?: string }> {
    const reserva = this.reservas.find((r) => r.id === reservaId);
    if (!reserva) return { ok: false, error: "Esa reserva ya no existe" };
    if (reserva.estado !== "apartada") {
      return { ok: false, error: "Esa reserva ya no está en pie" };
    }

    pos.seleccionarMesa(mesaId);
    const ordenId = pos.abrirMesa(mesaId);
    await pos.identificar(reserva.nombre, reserva.telefono, reserva.cliente_id);

    this.emitir(
      this.fabrica.crear("reserva_sentada", streamReservas(SUCURSAL_ID), {
        reserva_id: reservaId,
        mesa_id: mesaId,
        orden_id: ordenId,
      }),
    );
    return { ok: true };
  }

  /**
   * La casa acepta una solicitud del portal: a partir de aquí sí aparta mesa.
   *
   * Si se le asigna mesa, se comprueba el choque ANTES de confirmar. Aceptar
   * dos reservas sobre la misma mesa es exactamente el error que el portal
   * podría multiplicar, porque las solicitudes llegan solas y en cualquier
   * momento.
   */
  confirmar(reservaId: ID, mesaId?: ID): { ok: boolean; error?: string } {
    const reserva = this.reservas.find((r) => r.id === reservaId);
    if (!reserva) return { ok: false, error: "Esa solicitud ya no existe" };
    if (reserva.estado !== "solicitada") {
      return { ok: false, error: "Esa reserva ya se contestó" };
    }

    if (mesaId) {
      const choques = this.choques(mesaId, reserva.para_ts, reserva.duracion_min);
      if (choques.length > 0) {
        return {
          ok: false,
          error: `Esa mesa ya está apartada para ${choques[0]!.reserva.nombre}`,
        };
      }
    }

    this.emitir(
      this.fabrica.crear("reserva_confirmada", streamReservas(SUCURSAL_ID), {
        reserva_id: reservaId,
        mesa_id: mesaId,
      }),
    );
    return { ok: true };
  }

  cancelar(reservaId: ID, motivo: string): { ok: boolean; error?: string } {
    const limpio = motivo.trim();
    if (limpio.length < 3) return { ok: false, error: "Escribe por qué se cancela" };

    this.emitir(
      this.fabrica.crear("reserva_cancelada", streamReservas(SUCURSAL_ID), {
        reserva_id: reservaId,
        motivo: limpio,
      }),
    );
    return { ok: true };
  }

  /** No avisó y no llegó. Se distingue de cancelar: es el dato caro. */
  noLlego(reservaId: ID): void {
    this.emitir(
      this.fabrica.crear("reserva_no_llego", streamReservas(SUCURSAL_ID), {
        reserva_id: reservaId,
      }),
    );
  }

  /** Cuántas veces plantó este teléfono. Lo que se mira antes de volver a apartar. */
  plantonesDe(telefono: string | undefined): number {
    if (!telefono) return 0;
    return this.reservas.filter((r) => r.telefono === telefono && r.estado === "no_llego").length;
  }

  // --- Lista de espera -----------------------------------------------------------

  anotarEnEspera(datos: { nombre: string; telefono?: string; personas: number }): {
    ok: boolean;
    error?: string;
  } {
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe un nombre para llamarlos" };

    this.espera = [
      ...this.espera,
      {
        id: uuidv7(),
        nombre,
        telefono: datos.telefono?.trim() || undefined,
        personas: datos.personas,
        desde_ts: Date.now(),
      },
    ];
    return { ok: true };
  }

  quitarDeEspera(id: ID): void {
    this.espera = this.espera.filter((e) => e.id !== id);
  }

  /** Sienta a quien esperaba y lo saca de la lista. */
  async sentarDeEspera(id: ID, mesaId: ID): Promise<void> {
    const quien = this.espera.find((e) => e.id === id);
    if (!quien) return;

    pos.seleccionarMesa(mesaId);
    pos.abrirMesa(mesaId);
    await pos.identificar(quien.nombre, quien.telefono);
    this.quitarDeEspera(id);
  }

  /**
   * Cuánto hay que decirle a quien llega, o a quien ya está formado.
   *
   * Se mira el salón AHORA: qué mesas están ocupadas y desde cuándo. La mesa
   * apartada por una reserva próxima no cuenta como libre — darla es lo que
   * provoca el choque en la puerta media hora después.
   */
  esperaPara(posicionEnLaFila = 0, ahora = Date.now()): ReturnType<typeof esperaEstimada> {
    const ocupadasDesde: number[] = [];
    let libres = 0;

    const apartadasPronto = new Set(
      this.vigentes
        .filter((r) => r.mesa_id && r.para_ts - ahora < 60 * 60_000 && r.para_ts > ahora)
        .map((r) => r.mesa_id!),
    );

    for (const mesa of plano.todasLasMesas) {
      const cuenta = pos.comandaDeMesa(mesa.id);
      if (cuenta && !cuenta.cerrada) {
        ocupadasDesde.push(cuenta.abierta_ts);
      } else if (!apartadasPronto.has(mesa.id)) {
        libres += 1;
      }
    }

    return esperaEstimada({
      ocupadasDesde,
      mesasLibres: libres,
      delante: posicionEnLaFila,
      rotacion: this.rotacion,
      ahora,
    });
  }
}

export const reservas = new StoreReservas();
