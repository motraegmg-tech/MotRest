/**
 * El enlace del Hub con el relay: la única salida a internet del restaurante.
 *
 * SE CONECTA HACIA AFUERA, y esa es la decisión importante. El local no abre un
 * puerto, no necesita IP fija ni redirección en el módem, y nada de lo que hay
 * dentro queda alcanzable desde la calle. Es exactamente lo que hace una
 * terminal con el Hub, un escalón más arriba.
 *
 * SI ESTO NO CONECTA, EL RESTAURANTE SIGUE VENDIENDO. Lo único que se pierde
 * son los avisos de WhatsApp, y se recuperan al volver. La reconexión sube
 * despacio a propósito: un relay caído no puede recibir un intento por segundo
 * de cincuenta restaurantes a la vez.
 */
import { WebSocket } from "ws";
import type { Aviso } from "./avisos.js";

export interface MensajeDelComensal {
  sucursal_id: string;
  contacto: string;
  texto: string;
  externo_id: string;
  ts: number;
}

export interface OpcionesRelay {
  url: string;
  /** Clave con la que el Hub se identifica ante el relay. */
  clave: string;
  sucursal_id: string;
  /** Credenciales de WhatsApp de ESTE restaurante, si ya las tiene. */
  credenciales?: { phone_number_id: string; token: string; nombre: string };
  alLlegarMensaje: (mensaje: MensajeDelComensal) => void;
  alConectar?: () => void;
  registrar: (nivel: "info" | "aviso" | "error", texto: string) => void;
}

const REINTENTO_BASE_MS = 2_000;
const REINTENTO_MAX_MS = 5 * 60 * 1000;

export class EnlaceRelayWs {
  private socket: WebSocket | null = null;
  private intentos = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private cerradoAProposito = false;
  private saludado = false;

  constructor(private opciones: OpcionesRelay) {}

  conectado(): boolean {
    return this.saludado && this.socket?.readyState === WebSocket.OPEN;
  }

  conectar(): void {
    this.cerradoAProposito = false;
    this.abrir();
  }

  private abrir(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.opciones.url);
    } catch (causa) {
      this.caer(`No se pudo abrir el enlace con el relay: ${String(causa)}`);
      return;
    }
    this.socket = socket;

    socket.on("open", () => {
      this.intentos = 0;
      socket.send(
        JSON.stringify({
          tipo: "hola",
          clave: this.opciones.clave,
          sucursal_id: this.opciones.sucursal_id,
        }),
      );
    });

    socket.on("message", (crudo) => {
      let mensaje: Record<string, unknown>;
      try {
        mensaje = JSON.parse(String(crudo)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (mensaje.tipo === "bienvenida") {
        this.saludado = true;
        this.opciones.registrar("info", "Enlace con el relay establecido.");

        // Las credenciales se mandan en CADA conexión, no solo al darlas de
        // alta: si el relay se reinstala o se pierde su padrón, el restaurante
        // se recupera solo en vez de dejar de recibir mensajes en silencio.
        const cred = this.opciones.credenciales;
        if (cred) socket.send(JSON.stringify({ tipo: "credenciales", ...cred }));

        this.opciones.alConectar?.();
        return;
      }

      if (mensaje.tipo === "mensaje_entrante" && mensaje.mensaje) {
        this.opciones.alLlegarMensaje(mensaje.mensaje as MensajeDelComensal);
        return;
      }

      if (mensaje.tipo === "envio_fallido") {
        this.opciones.registrar("aviso", `El relay no pudo mandar un aviso: ${mensaje.razon ?? ""}`);
      }
    });

    socket.on("close", () => this.caer("Se perdió el enlace con el relay"));
    socket.on("error", (causa) => this.caer(`Error del enlace con el relay: ${causa.message}`));
  }

  /** Le pide al relay que mande un aviso. Las reglas ya se comprobaron antes. */
  enviar(aviso: Aviso): void {
    if (!this.conectado()) return;
    this.socket?.send(
      JSON.stringify({
        tipo: "enviar",
        id: `${Date.now()}`,
        peticion: {
          sucursal_id: this.opciones.sucursal_id,
          contacto: aviso.contacto,
          texto: aviso.texto,
          plantilla: aviso.plantilla,
        },
      }),
    );
  }

  /** Actualiza las credenciales de WhatsApp del local, sin reconectar. */
  publicarCredenciales(cred: { phone_number_id: string; token: string; nombre: string }): void {
    this.opciones.credenciales = cred;
    if (this.conectado()) {
      this.socket?.send(JSON.stringify({ tipo: "credenciales", ...cred }));
    }
  }

  private caer(razon: string): void {
    if (this.saludado) this.opciones.registrar("aviso", razon);
    this.saludado = false;
    this.socket = null;
    if (this.cerradoAProposito) return;

    /*
     * Espera creciente con tope. Sin ella, un relay caído recibiría un intento
     * por segundo de cada restaurante — que es cómo un servicio que se está
     * recuperando se vuelve a caer.
     */
    this.intentos += 1;
    const espera = Math.min(REINTENTO_BASE_MS * 2 ** (this.intentos - 1), REINTENTO_MAX_MS);
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.abrir(), espera);
  }

  desconectar(): void {
    this.cerradoAProposito = true;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.socket?.close();
    this.socket = null;
    this.saludado = false;
  }
}
