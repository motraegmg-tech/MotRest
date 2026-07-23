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
import { cifrar, derivarClaves, descifrar, type ClavesCanal } from "./cifrado.js";
import {
  VERSION_PROTOCOLO,
  interpretar,
  serializar,
  type Catalogo,
  type EstadoEnlace,
  type MensajeHub,
  type MensajeCliente,
  type TerminalRegistrada,
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
  /**
   * Clave del local, entregada al emparejar. Sin ella la terminal no puede
   * hablar con el Hub: el canal va cifrado de extremo a extremo.
   */
  clave: string;
  almacen: Almacen;
  /** Fábrica de sockets. Inyectable para poder probar sin red. */
  crearSocket?: (url: string) => SocketLike;
  /** Se llama con los eventos que llegan de otros dispositivos. */
  alRecibir?: (eventos: EventoBase[]) => void;
  /** Se llama con los catálogos que llegan del Hub (menú, plano, impresoras). */
  alRecibirCatalogos?: (catalogos: Catalogo[]) => void;
  /** Se llama con la lista de terminales del local. */
  alRecibirTerminales?: (terminales: TerminalRegistrada[]) => void;
  /** El Hub no tiene ni un evento: este local todavía no ha abierto. */
  alEncontrarLocalVacio?: () => void;
  /** Enlaces de emparejamiento que compone el Hub. Llevan la clave del local. */
  alRecibirEnlaces?: (enlaces: { etiqueta: string; url: string }[]) => void;
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
  private claves: ClavesCanal | null = null;
  /** Cadena de envíos, para que salgan en el orden en que se pidieron. */
  private cola: Promise<void> = Promise.resolve();
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

  /**
   * Manda un mensaje cifrado.
   *
   * Los envíos se encadenan porque cifrar es asíncrono: sin la cola, dos
   * mensajes seguidos podrían salir en orden invertido, y el protocolo depende
   * del orden —el saludo va antes que todo lo demás—.
   *
   * No se espera el resultado: un envío que falla no es un error del negocio,
   * el evento sigue en el outbox local y saldrá al reconectar.
   */
  private enviar(mensaje: MensajeCliente): void {
    const claves = this.claves;
    const socket = this.socket;
    if (!claves || !socket) return;

    this.cola = this.cola.then(async () => {
      try {
        socket.send(await cifrar(claves.envio, mensaje));
      } catch (causa) {
        console.warn("No se pudo enviar al Hub; queda pendiente", causa);
      }
    });
  }

  async conectar(): Promise<void> {
    this.cerradoAPropósito = false;
    this.ultimoSeq =
      (await this.opciones.almacen.estado.cargar<number>(CLAVE_ULTIMO_SEQ)) ?? 0;

    try {
      this.claves = await derivarClaves(this.opciones.clave, "cliente");
    } catch {
      // Sin clave válida no hay enlace posible. Se avisa y se opera en isla:
      // el restaurante sigue vendiendo, que es lo que no puede fallar.
      this.avisar("isla", "La clave del local no es válida. Vuelve a emparejar la terminal.");
      return;
    }

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
      // El saludo va cifrado como todo lo demás: poder formularlo de modo que
      // el Hub lo entienda YA prueba que esta terminal tiene la clave del local.
      this.enviar({
        tipo: "hola",
        v: VERSION_PROTOCOLO,
        device_id: this.opciones.device_id,
        sucursal_id: this.opciones.sucursal_id,
        desde_seq: this.ultimoSeq,
      });
    };

    socket.onmessage = (evento) => {
      if (typeof evento.data !== "string") return;
      const claves = this.claves;
      if (!claves) return;

      void descifrar<MensajeHub>(claves.recepcion, evento.data).then((mensaje) => {
        if (mensaje) {
          void this.recibir(mensaje);
          return;
        }
        // No se pudo descifrar: o el Hub usa otra clave del local, o alguien
        // está hablando por el canal sin tenerla. En ambos casos hay que
        // decirlo, no callarlo: el operador tiene que volver a emparejar.
        this.avisar(
          "isla",
          "El Hub respondió con otra clave del local. Vuelve a emparejar esta terminal.",
        );
      });
    };

    socket.onclose = () => this.caer("Se perdió el enlace con el Hub");
    socket.onerror = () => this.caer("Error en el enlace con el Hub");
  }

  private async recibir(mensaje: MensajeHub): Promise<void> {
    switch (mensaje.tipo) {
      case "bienvenida": {
        /*
         * Un Hub sin un solo evento es un local que todavía no ha abierto.
         *
         * Importa porque una terminal emparejada NO siembra: espera a recibir
         * la operación en curso. Si el local está vacío esperaría para siempre,
         * así que se le avisa a quien arranca de que puede sembrarlo él.
         */
        if (mensaje.seq_actual === 0) this.opciones.alEncontrarLocalVacio?.();

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

      case "terminales":
        this.opciones.alRecibirTerminales?.(mensaje.terminales);
        break;

      case "enlace":
        this.opciones.alRecibirEnlaces?.(mensaje.enlaces);
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

  /** Pide la lista de terminales del local. Llega por `alRecibirTerminales`. */
  pedirTerminales(): void {
    if (!this.socket) return;
    this.enviar({ tipo: "admin", accion: "listar_terminales" });
  }

  /** Autoriza una terminal. El Hub responde con la lista ya actualizada. */
  autorizarTerminal(deviceId: string): void {
    if (!this.socket) return;
    this.enviar({ tipo: "admin", accion: "autorizar", device_id: deviceId });
  }

  /** Retira la autorización de una terminal y la desconecta del local. */
  revocarTerminal(deviceId: string): void {
    if (!this.socket) return;
    this.enviar({ tipo: "admin", accion: "revocar", device_id: deviceId });
  }

  /** Pide el enlace de emparejamiento, para pintarlo como QR. */
  pedirEnlace(): void {
    if (!this.socket) return;
    this.enviar({ tipo: "admin", accion: "enlace_emparejamiento" });
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
