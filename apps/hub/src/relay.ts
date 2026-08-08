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
  /**
   * La credencial de ESTE restaurante, la que MOTRAE entregó al darlo de alta.
   *
   * No es una clave compartida: de ella sale la identidad del local ante el
   * relay. Por eso el `sucursal_id` ya no viaja en el saludo — el relay no se
   * cree lo que el Hub diga que es, lo deduce de lo que el Hub demuestra tener.
   */
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

/**
 * ¿Se puede usar esta dirección para hablar con el relay?
 *
 * **Solo `wss://`.** Por este cable viajan la credencial del restaurante y el
 * token de la API de Meta, y en `ws://` viajan en claro: cualquiera en el mismo
 * wifi, o cualquier salto del camino, se los lleva y a partir de ahí manda
 * WhatsApp en nombre del restaurante. Un `ws://` en la configuración casi
 * siempre es una prueba que se quedó puesta, y el precio de que se quede es
 * demasiado alto para descubrirlo tarde.
 *
 * Se deja pasar el bucle local porque el ensayo del relay corre ahí mismo y no
 * hay red que escuchar.
 */
export function direccionUsable(url: string): { ok: true } | { ok: false; motivo: string } {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return { ok: false, motivo: `La dirección del relay no es válida: ${url}` };
  }

  if (destino.protocol === "wss:") return { ok: true };

  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(destino.hostname);
  if (destino.protocol === "ws:" && local) return { ok: true };

  return {
    ok: false,
    motivo:
      `El relay se configuró como "${url}". Tiene que ser wss:// — por ahí van la ` +
      "credencial del local y el token de WhatsApp, y sin cifrar los ve cualquiera.",
  };
}

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
    // Se comprueba en cada intento y no una sola vez, porque `conectar()` puede
    // llamarse otra vez tras cambiar la configuración del local.
    const usable = direccionUsable(this.opciones.url);
    if (!usable.ok) {
      // No se reintenta: reintentar cada dos segundos una dirección que nunca
      // va a servir solo llena el registro y esconde el aviso que importa.
      this.opciones.registrar("error", usable.motivo);
      this.cerradoAProposito = true;
      return;
    }

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
      // El `sucursal_id` NO va: el relay lo deriva de la credencial. Mandarlo
      // sería volver a ofrecerle al Hub la oportunidad de decir que es otro.
      socket.send(JSON.stringify({ tipo: "hola", credencial: this.opciones.clave }));
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

      if (mensaje.tipo === "credenciales_rechazadas") {
        // Solo pasa si otro local ya reclamó ese número. Es un problema de
        // configuración en Meta y hay que verlo, no encolarlo.
        this.opciones.registrar(
          "error",
          `El relay rechazó el número de WhatsApp del local: ${mensaje.razon ?? ""}`,
        );
        return;
      }

      if (mensaje.tipo === "envio_fallido") {
        this.opciones.registrar("aviso", `El relay no pudo mandar un aviso: ${mensaje.razon ?? ""}`);
      }
    });

    socket.on("close", (codigo, razon) => {
      // El relay cierra con 1008 y el motivo cuando el rechazo es definitivo
      // —credencial que no reconoce, sucursal ya conectada—. Sin esto, el
      // síntoma en el local sería "WhatsApp no funciona" y nada más.
      const detalle = razon?.toString() ?? "";
      if (codigo === 1008 && detalle) {
        this.opciones.registrar("error", `El relay rechazó el enlace: ${detalle}`);
      }
      this.caer("Se perdió el enlace con el relay");
    });
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

  /**
   * Manda a MOTRAE el parte de vida del local: qué versión tiene y cómo está.
   *
   * Sin esto, MOTRAE publica a ciegas —no sabe qué versión corre cada
   * restaurante— y se entera de que un local lleva dos días caído porque llama
   * por teléfono. Va por el mismo enlace que ya existe, sin abrir nada nuevo.
   *
   * **El `sucursal_id` no viaja**, igual que en el saludo: el relay lo deduce de
   * la credencial con la que este Hub se autenticó. Un local no puede reportar
   * en nombre de otro ni por error ni a propósito.
   *
   * Si el enlace está caído, el pulso se pierde y no se encola. Es correcto: el
   * siguiente sustituye al anterior por completo, y lo que se guarda es el
   * último. Un pulso de hace cuatro horas no le sirve a nadie.
   */
  reportarPulso(pulso: Record<string, unknown>): void {
    if (!this.conectado()) return;
    const { sucursal_id: _propio, ...cuerpo } = pulso;
    this.socket?.send(JSON.stringify({ tipo: "pulso", pulso: cuerpo }));
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
