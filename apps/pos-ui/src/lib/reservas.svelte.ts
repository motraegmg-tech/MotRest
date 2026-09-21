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
import { mismoTelefono } from "./clientes.svelte";
import { plano } from "./plano.svelte";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface EnEspera {
  id: ID;
  nombre: string;
  telefono?: string;
  /**
   * La ficha del comensal, si se la reconoció o se dio de alta al anotarlo.
   *
   * Viaja hasta la cuenta: cuando se le sienta, la mesa abre ya a nombre de su
   * ficha y lo que consuma esa noche se suma a su historial. Sin esto, quien
   * esperó de pie era un desconocido aunque tuviera ficha desde hace un año.
   */
  cliente_id?: ID;
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

  /**
   * Lo que impide apartar, en palabras. `undefined` = se puede guardar.
   *
   * Está separado de `apartar` —que lo vuelve a usar, así que no hay dos
   * verdades— porque la pantalla tiene que preguntarlo ANTES de tocar la ficha
   * del comensal. Desde la 1.5.6, apartar puede DAR DE ALTA a un cliente, y una
   * ficha creada para una reserva que no se guardó porque «Personas» venía en
   * cero es basura que alguien tendría que borrar a mano.
   */
  problemaAlApartar(datos: { nombre: string; personas: number }): string | undefined {
    if (datos.nombre.trim().length < 2) return "Escribe a nombre de quién va la reserva";
    if (!Number.isInteger(datos.personas) || datos.personas < 1) return "¿Cuántas personas vienen?";
    return undefined;
  }

  apartar(datos: {
    nombre: string;
    telefono?: string;
    correo?: string;
    cliente_id?: ID;
    personas: number;
    para_ts: number;
    mesa_id?: ID;
    duracion_min?: number;
    notas?: string;
  }): { ok: boolean; error?: string } {
    const problema = this.problemaAlApartar(datos);
    if (problema) return { ok: false, error: problema };
    const nombre = datos.nombre.trim();

    this.emitir(
      this.fabrica.crear("reserva_creada", streamReservas(SUCURSAL_ID), {
        reserva_id: uuidv7(),
        nombre,
        telefono: datos.telefono?.trim() || undefined,
        correo: datos.correo?.trim() || undefined,
        /*
         * LA FICHA VIAJA EN EL EVENTO, desde la 1.5.6.
         *
         * Antes una reserva apartada por teléfono no se ataba a nadie: el
         * campo existía en el dominio y solo lo llenaba el portal. Por eso el
         * cliente que reservaba cada quince días seguía siendo un desconocido
         * en la ficha del comensal, y su historial se partía entre reservas
         * «Ramírez», «Familia Ramírez» y un teléfono con lada.
         */
        cliente_id: datos.cliente_id,
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
   * Las reservas de una ficha, de la más próxima a la más vieja.
   *
   * Se cuentan las LIGADAS y, además, las que traen su teléfono sin estar
   * ligadas a nadie: las de antes de la 1.5.6 nacieron sin ficha, y esconder el
   * historial de un cliente porque se apuntó el mes pasado no lo haría más
   * cierto. Una reserva ligada a OTRA ficha no se cuenta nunca, aunque el
   * teléfono coincida: alguien ya decidió de quién es.
   */
  deCliente(clienteId: ID, telefono?: string): Reserva[] {
    return this.reservas
      .filter(
        (r) =>
          r.cliente_id === clienteId ||
          (!r.cliente_id && mismoTelefono(r.telefono, telefono)),
      )
      .sort((a, b) => b.para_ts - a.para_ts);
  }

  /**
   * Sienta la reserva: abre la mesa y deja la cuenta a nombre de quien reservó.
   *
   * Las dos cosas van juntas a propósito. Sentar en la agenda y abrir la mesa
   * por separado es como se llega al viernes con reservas "pendientes" que ya
   * están comiendo.
   *
   * `mesas` viene de un acomodo del dominio: una sola mesa, o varias que se
   * juntan. La primera lleva la cuenta y las demás quedan colgadas de ella —
   * UNA cuenta para todo el grupo. Abrir una por mesa dejaba al grupo de diez
   * con tres tickets y a la cocina mandando la comanda por partes.
   */
  async sentar(reservaId: ID, mesas: readonly ID[]): Promise<{ ok: boolean; error?: string }> {
    const reserva = this.reservas.find((r) => r.id === reservaId);
    if (!reserva) return { ok: false, error: "Esa reserva ya no existe" };
    if (reserva.estado !== "apartada") {
      return { ok: false, error: "Esa reserva ya no está en pie" };
    }

    const [principal, ...resto] = mesas;
    if (!principal) return { ok: false, error: "Elige en qué mesa se sientan" };

    pos.seleccionarMesa(principal);
    const ordenId = pos.abrirMesa(principal, resto);
    await pos.identificar(reserva.nombre, reserva.telefono, reserva.cliente_id);

    /*
     * En el log de reservas se apunta la principal y nada más. La unión ya
     * quedó escrita en el `orden_creada`, que es donde vive: duplicarla aquí
     * daría dos verdades que se pueden contradecir si el mesero mueve al grupo.
     */
    this.emitir(
      this.fabrica.crear("reserva_sentada", streamReservas(SUCURSAL_ID), {
        reserva_id: reservaId,
        mesa_id: principal,
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

  /**
   * Cuántas veces plantó este teléfono. Lo que se mira antes de volver a apartar.
   *
   * Se comparan los teléfonos NORMALIZADOS y no las cadenas tal cual. Antes se
   * comparaba carácter por carácter, así que quien plantó dos veces dejando
   * «33 1122 3344» volvía a aparecer limpio con solo dictarlo como
   * «3311223344»: el dato caro se perdía por un espacio.
   */
  plantonesDe(telefono: string | undefined): number {
    return this.reservas.filter(
      (r) => r.estado === "no_llego" && mismoTelefono(r.telefono, telefono),
    ).length;
  }

  // --- Lista de espera -----------------------------------------------------------

  /**
   * Lo que impide anotar en la lista, en palabras. `undefined` = se puede.
   *
   * Igual que en `problemaAlApartar`: la pantalla lo pregunta antes de crear
   * nada en la ficha del comensal.
   */
  problemaAlAnotar(datos: { nombre: string }): string | undefined {
    return datos.nombre.trim().length < 2 ? "Escribe un nombre para llamarlos" : undefined;
  }

  anotarEnEspera(datos: {
    nombre: string;
    telefono?: string;
    cliente_id?: ID;
    personas: number;
  }): {
    ok: boolean;
    error?: string;
  } {
    const problema = this.problemaAlAnotar(datos);
    if (problema) return { ok: false, error: problema };
    const nombre = datos.nombre.trim();

    this.espera = [
      ...this.espera,
      {
        id: uuidv7(),
        nombre,
        telefono: datos.telefono?.trim() || undefined,
        cliente_id: datos.cliente_id,
        personas: datos.personas,
        desde_ts: Date.now(),
      },
    ];
    return { ok: true };
  }

  quitarDeEspera(id: ID): void {
    this.espera = this.espera.filter((e) => e.id !== id);
  }

  /**
   * Sienta a quien esperaba y lo saca de la lista.
   *
   * Igual que en las reservas: `mesas` es un acomodo, la primera lleva la
   * cuenta y las demás se le unen. Quien esperó de pie con seis personas se
   * sienta en dos mesas juntas, pero paga una sola vez.
   */
  async sentarDeEspera(id: ID, mesas: readonly ID[]): Promise<void> {
    const quien = this.espera.find((e) => e.id === id);
    if (!quien) return;

    const [principal, ...resto] = mesas;
    if (!principal) return;

    pos.seleccionarMesa(principal);
    pos.abrirMesa(principal, resto);
    /*
     * Su ficha viaja a la cuenta, igual que en `sentar`. Quien esperó de pie
     * tiene el mismo derecho a que su consumo se sume a su historial que quien
     * reservó por teléfono: la lista de espera no se guarda, pero la cuenta sí.
     */
    await pos.identificar(quien.nombre, quien.telefono, quien.cliente_id);
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
