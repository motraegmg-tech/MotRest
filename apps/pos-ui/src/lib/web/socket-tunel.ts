/**
 * El «WebSocket» de la web al Hub del local, por Supabase Realtime (1.6.0).
 *
 * Cumple `SocketLike`, así que `ClienteSync` no sabe que no está en la red del
 * restaurante: le da igual que al otro lado haya un cable o media ciudad. Todo
 * lo que pasa por aquí ya viene cifrado con la clave remota; Supabase ve
 * fragmentos de texto cifrado.
 *
 * CÓMO SE ABRE. Se entra al canal PRIVADO del restaurante (`tunel:<sucursal>`,
 * que solo admite a su Hub y a su sesión web), se dice `abrir` con un id de
 * sesión nuevo y se espera el `abierta` del Hub. Si no llega en unos segundos,
 * el Hub no está: apagado o sin internet. Eso se cuenta tal cual, porque es lo
 * primero que va a preguntar quien mira desde su casa.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  EVENTO_TUNEL,
  ExtremoTunel,
  LATIDO_MS,
  canalTunelDe,
  esControl,
  esSobreTunel,
  nuevaSesionTunel,
  type SobreTunel,
  type SocketLike,
} from "@motrest/protocolo-sync";

/** Cuánto se espera a que el Hub conteste al saludo. */
export const ESPERA_APERTURA_MS = 12_000;

export const MOTIVO_SIN_HUB =
  "Tu restaurante no está conectado ahora mismo: su computadora está apagada o sin internet.";

export class SocketTunel implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evento: { data: unknown }) => void) | null = null;

  private extremo: ExtremoTunel;
  private canal: RealtimeChannel | null = null;
  private latido: ReturnType<typeof setInterval> | null = null;
  private espera: ReturnType<typeof setTimeout> | null = null;
  private abierto = false;
  private terminado = false;

  constructor(
    private cliente: SupabaseClient,
    sucursalId: string,
    /** Por qué se cerró, en palabras de persona, para enseñarlo. */
    private alMotivo?: (motivo: string) => void,
  ) {
    this.extremo = new ExtremoTunel(nuevaSesionTunel(), "c", (s) => this.mandar(s));
    this.extremo.alMensaje = (texto) => this.onmessage?.({ data: texto });
    this.extremo.alCerrar = (motivo) => this.terminar(motivo);
    void this.abrir(sucursalId);
  }

  private async abrir(sucursalId: string): Promise<void> {
    try {
      // El canal es privado: Realtime tiene que llevar el pase del restaurante.
      await this.cliente.realtime.setAuth();
    } catch {
      /* supabase-js lo vuelve a intentar al suscribirse */
    }
    if (this.terminado) return;

    const canal = this.cliente.channel(canalTunelDe(sucursalId), {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    this.canal = canal;
    canal.on("broadcast", { event: EVENTO_TUNEL }, ({ payload }) => this.recibir(payload));
    canal.subscribe((estado) => {
      if (estado === "SUBSCRIBED") {
        this.extremo.control("abrir");
        this.espera = setTimeout(() => this.terminar(MOTIVO_SIN_HUB), ESPERA_APERTURA_MS);
      } else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED") {
        this.terminar(
          estado === "CHANNEL_ERROR"
            ? "La nube no dejó entrar al canal de tu restaurante. Vuelve a entrar con tu contraseña."
            : "Se perdió la conexión con la nube.",
        );
      }
    });
  }

  private recibir(payload: unknown): void {
    if (!esSobreTunel(payload) || payload.s !== this.extremo.sesion) return;
    if (esControl(payload) && payload.k === "abierta") {
      if (this.abierto) return;
      this.abierto = true;
      if (this.espera) clearTimeout(this.espera);
      this.latido = setInterval(() => this.extremo.latir(), LATIDO_MS);
      this.onopen?.();
      return;
    }
    this.extremo.recibir(payload);
  }

  private mandar(sobre: SobreTunel): void {
    void this.canal?.send({ type: "broadcast", event: EVENTO_TUNEL, payload: sobre });
  }

  send(datos: string): void {
    this.extremo.enviar(datos);
  }

  close(): void {
    if (this.extremo.abierto) this.extremo.cerrar("La terminal cerró la sesión");
    else this.terminar("La terminal cerró la sesión");
  }

  private terminar(motivo: string): void {
    if (this.terminado) return;
    this.terminado = true;
    if (this.espera) clearTimeout(this.espera);
    if (this.latido) clearInterval(this.latido);
    if (this.extremo.abierto) this.extremo.cerrar(motivo);
    const canal = this.canal;
    this.canal = null;
    if (canal) void this.cliente.removeChannel(canal);
    this.alMotivo?.(motivo);
    if (!this.abierto) this.onerror?.();
    this.onclose?.();
  }
}
