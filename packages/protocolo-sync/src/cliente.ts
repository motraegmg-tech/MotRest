/**
 * Cliente de sincronización: el lado dispositivo del enlace con el Hub.
 *
 * Principio rector (TRD R3): **el modo isla es el estado normal.** Este cliente
 * nunca bloquea una venta ni espera una respuesta para dejar operar. Escribe en
 * el log local —que ya es el outbox— y empuja cuando puede. Si el Hub no está,
 * el restaurante sigue vendiendo y nadie se entera.
 *
 * No conoce Svelte ni el DOM: se comunica por callbacks para poder probarlo con
 * un WebSocket falso, sin levantar un servidor.
 */
import type { EventoBase } from "@motrest/dominio";
import type { Almacen } from "./repositorio.js";
import {
  VERSION_PROTOCOLO,
  interpretar,
  serializar,
  type Catalogo,
  type EstadoEnlace,
  type MensajeHub,
  type MensajeCliente,
} from "./protocolo.js";

/** Mínimo que necesita el cliente de un WebSocket: sirve el nativo y uno falso. */
export interface SocketLike {
  send(datos: string): void;
  close(): void;
  onopen: ((...args: never[]) => void) | null;
  onclose: ((...args: never[]) => void) | null;
  onerror: ((...args: never[]) => void) | null;
  onmessage: ((evento: { data: unknown }) => void) | null;
}

export interface OpcionesCliente {
  url: string;
  device_id: string;
  sucursal_id: string;
  token?: string;
  almacen: Almacen;
  /** Fábrica de sockets. Inyectable para poder probar sin red. */
  crearSocket?: (url: string) => SocketLike;
  /** Se llama con los eventos que llegan de otros dispositivos. */
  alRecibir?: (eventos: EventoBase[]) => void;
  /** Se llama con los catálogos que llegan del Hub (menú, plano, impresoras). */
  alRecibirCatalogos?: (catalogos: Catalogo[]) => void;
  /** Devuelve los catálogos locales, para publicarlos al conectar. */
  catalogosLocales?: () => Catalogo[];
  alCambiarEstado?: (estado: EstadoEnlace, detalle?: string) => void;
  /** Espera base entre reintentos, en ms. */
  reintentoBase?: number;
  reintentoMaximo?: number;
}

const CLAVE_ULTIMO_SEQ = "sync_ultimo_seq";

export class ClienteSync {
  private socket: SocketLike | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private intentos = 0;
  private cerradoAPropósito = false;
  private ultimoSeq = 0;
  private empujando = false;

  estado: EstadoEnlace = "isla";

  constructor(private opciones: OpcionesCliente) {}

  private avisar(estado: EstadoEnlace, detalle?: string): void {
    this.estado = estado;
    this.opciones.alCambiarEstado?.(estado, detalle);
  }

  private enviar(mensaje: MensajeCliente): void {
    try {
      this.socket?.send(serializar(mensaje));
    } catch (causa) {
      // Un envío fallido no es un error del negocio: el evento sigue en el
      // outbox local y se reenviará al reconectar.
      console.warn("No se pudo enviar al Hub; queda pendiente", causa);
    }
  }

  async conectar(): Promise<void> {
    this.cerradoAPropósito = false;
    this.ultimoSeq =
      (await this.opciones.almacen.estado.cargar<number>(CLAVE_ULTIMO_SEQ)) ?? 0;
    this.abrir();
  }

  private abrir(): void {
    const crear =
      this.opciones.crearSocket ??
      ((url: string) => new WebSocket(url) as unknown as SocketLike);

    this.avisar("conectando");

    let socket: SocketLike;
    try {
      socket = crear(this.opciones.url);
    } catch (causa) {
      this.caer(`No se pudo abrir el enlace: ${String(causa)}`);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.intentos = 0;
      this.avisar("sincronizando");
      this.enviar({
        tipo: "hola",
        v: VERSION_PROTOCOLO,
        device_id: this.opciones.device_id,
        sucursal_id: this.opciones.sucursal_id,
        desde_seq: this.ultimoSeq,
        ...(this.opciones.token ? { token: this.opciones.token } : {}),
      });
    };

    socket.onmessage = (evento) => {
      if (typeof evento.data !== "string") return;
      const mensaje = interpretar<MensajeHub>(evento.data);
      if (mensaje) void this.recibir(mensaje);
    };

    socket.onclose = () => this.caer("Se perdió el enlace con el Hub");
    socket.onerror = () => this.caer("Error en el enlace con el Hub");
  }

  private async recibir(mensaje: MensajeHub): Promise<void> {
    switch (mensaje.tipo) {
      case "bienvenida": {
        // Se empuja lo pendiente ANTES de pedir lo ajeno: lo que este
        // dispositivo vendió sin red es lo más urgente por publicar.
        await this.empujar();

        // Los catálogos locales se publican también. El Hub se queda con el más
        // nuevo de cada uno, así que mandar el propio no pisa nada: si el del
        // local va más adelantado, lo descarta y devuelve el bueno.
        const catalogos = this.opciones.catalogosLocales?.() ?? [];
        if (catalogos.length > 0) this.enviar({ tipo: "catalogo", catalogos });

        this.enviar({ tipo: "pull", desde_seq: this.ultimoSeq });
        break;
      }

      case "catalogo":
        this.opciones.alRecibirCatalogos?.(mensaje.catalogos);
        break;

      case "acks":
        await this.opciones.almacen.eventos.confirmar(mensaje.acks);
        // Sigue empujando mientras queden pendientes: un corte largo puede
        // haber dejado más eventos de los que caben en un lote.
        await this.empujar();
        break;

      case "eventos": {
        if (mensaje.eventos.length > 0) {
          await this.opciones.almacen.eventos.anexar(mensaje.eventos);
          this.opciones.alRecibir?.(mensaje.eventos);

          const mayor = Math.max(
            this.ultimoSeq,
            ...mensaje.eventos.map((e) => e.seq ?? 0),
          );
          this.ultimoSeq = mayor;
          await this.opciones.almacen.estado.guardar(CLAVE_ULTIMO_SEQ, mayor);
        }

        if (mensaje.hay_mas) {
          this.enviar({ tipo: "pull", desde_seq: this.ultimoSeq });
        } else {
          this.avisar("sincronizado");
        }
        break;
      }

      case "error":
        // Un rechazo del Hub no puede detener la operación: se avisa y se
        // sigue vendiendo en isla.
        this.avisar("isla", mensaje.mensaje);
        if (mensaje.codigo === "no_emparejado" || mensaje.codigo === "version_incompatible") {
          this.cerradoAPropósito = true;
          this.socket?.close();
        }
        break;

      case "pong":
        break;
    }
  }

  /** Publica un catálogo que acaba de cambiar en este dispositivo. */
  publicarCatalogo(catalogo: Catalogo): void {
    if (!this.socket) return;
    this.enviar({ tipo: "catalogo", catalogos: [catalogo] });
  }

  /** Envía lo que el Hub todavía no ha confirmado. */
  async empujar(limite = 200): Promise<void> {
    if (this.empujando || !this.socket) return;
    this.empujando = true;
    try {
      const pendientes = await this.opciones.almacen.eventos.pendientes(limite);
      if (pendientes.length > 0) {
        this.enviar({ tipo: "push", eventos: [...pendientes] });
      }
    } finally {
      this.empujando = false;
    }
  }

  /**
   * Vuelve a isla y reprograma el reintento con espera creciente.
   *
   * Sin el crecimiento, un Hub apagado recibiría un intento por segundo de cada
   * terminal del local durante todo el turno.
   */
  private caer(detalle: string): void {
    this.socket = null;
    if (this.cerradoAPropósito) {
      this.avisar("isla", detalle);
      return;
    }

    this.avisar("isla", detalle);

    const base = this.opciones.reintentoBase ?? 1_000;
    const techo = this.opciones.reintentoMaximo ?? 30_000;
    const espera = Math.min(base * 2 ** this.intentos, techo);
    this.intentos += 1;

    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.abrir(), espera);
  }

  desconectar(): void {
    this.cerradoAPropósito = true;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.socket?.close();
    this.socket = null;
    this.avisar("isla");
  }
}
