/**
 * Envío de correo desde el Hub del restaurante, por dos caminos.
 *
 * NO PASA POR LA NUBE, y eso es lo importante. Mandar un correo es una llamada
 * de SALIDA: el Hub la hace él mismo desde el local. No hace falta un servicio
 * intermedio,
 * ni un webhook público, ni exponer nada — a diferencia de WhatsApp, que
 * necesita que Meta pueda alcanzarnos para entregar lo que entra.
 *
 * LOS DOS CAMINOS, Y CUÁNDO CADA UNO:
 *
 *   GMAIL (el de fábrica) — se entrega por el SMTP de Google con la cuenta que
 *   el restaurante ya tiene y una contraseña de aplicación. No cuesta nada, no
 *   hay que comprar dominio ni tocar DNS, y el comensal ve la dirección de
 *   siempre. Tope: unos 500 destinatarios al día.
 *
 *   RESEND — para dominio propio o el compartido de MOTRAE. Se usa cuando el
 *   volumen rebasa lo que aguanta un Gmail o cuando el restaurante quiere su
 *   marca en el remitente.
 *
 * Lo que decide es `config.modo`, y el resto del sistema no se entera: quien
 * pide "manda la confirmación de reserva" llama igual en los dos casos.
 *
 * SI NO HAY INTERNET, EL RESTAURANTE SIGUE VENDIENDO. Los correos se encolan y
 * salen al reconectar. Con caducidad: un recordatorio de una reserva que ya
 * pasó no es un correo tardío, es una molestia.
 */
import {
  armarCorreo,
  puedeMandarCorreo,
  SMTP_GMAIL,
  type ConfiguracionCorreo,
  type DatosCorreo,
  type TipoCorreo,
} from "@motrest/dominio";
import { entregarPorSmtp, ErrorSmtp, soloDireccion } from "./smtp.js";

const API = "https://api.resend.com/emails";

/** Cuántos correos se guardan mientras no hay internet. */
const MAX_EN_COLA = 500;
/** Después de esto, mandarlo es peor que no mandarlo. */
const CADUCA_MS = 6 * 60 * 60 * 1000;

export interface PeticionCorreo {
  tipo: TipoCorreo;
  para: string;
  datos: DatosCorreo;
  /** Si esta persona aceptó promociones. Solo importa para marketing. */
  aceptaMarketing?: boolean;
}

export interface ResultadoCorreo {
  enviado: boolean;
  externo_id?: string;
  razon?: string;
}

interface EnCola {
  peticion: PeticionCorreo;
  creado_ts: number;
}

export class Correo {
  private cola: EnCola[] = [];
  private enviando = false;

  constructor(
    private config: () => ConfiguracionCorreo,
    /** Llave de Resend, o contraseña de aplicación de Gmail según el modo. */
    private apiKey: () => string,
    private registrar: (nivel: "info" | "aviso" | "error", texto: string) => void,
    private ahora: () => number = Date.now,
    private llamar: typeof fetch = fetch,
    /** Se inyecta para poder probar la cola sin abrir una conexión de verdad. */
    private entregar: typeof entregarPorSmtp = entregarPorSmtp,
  ) {}

  configurar(): void {
    // Se relee la configuración en cada envío, así que no hay nada que guardar
    // aquí: cambiar el remitente surte efecto en el siguiente correo.
  }

  /**
   * Manda un correo, si las reglas lo permiten.
   *
   * Las reglas las decide el dominio, no este archivo: qué es marketing, qué
   * exige consentimiento y qué está apagado en este restaurante.
   */
  async mandar(peticion: PeticionCorreo): Promise<ResultadoCorreo> {
    const config = this.config();
    const veredicto = puedeMandarCorreo(
      peticion.tipo,
      peticion.para,
      config,
      peticion.aceptaMarketing ?? false,
    );

    if (!veredicto.puede) {
      this.registrar("info", `Correo no enviado: ${veredicto.razon}`);
      return { enviado: false, razon: veredicto.razon };
    }

    if (!this.apiKey()) {
      return {
        enviado: false,
        razon:
          config.modo === "gmail"
            ? "Falta la contraseña de aplicación de la cuenta de Gmail"
            : "Falta la llave de Resend del restaurante",
      };
    }

    const armado = armarCorreo(peticion.tipo, peticion.para, config, peticion.datos);

    if (config.modo === "gmail") return this.porGmail(config, armado, peticion);

    try {
      const respuesta = await this.llamar(API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: armado.de,
          to: [armado.para],
          subject: armado.asunto,
          html: armado.html,
          text: armado.texto,
          ...(armado.responder_a ? { reply_to: armado.responder_a } : {}),
        }),
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text();
        /*
         * Un 4xx es culpa de la configuración —dominio sin verificar, llave
         * mala— y reintentarlo no lo va a arreglar. Un 5xx o una caída de red sí
         * se reintenta. Encolar lo que nunca va a salir llena la cola de basura.
         */
        if (respuesta.status >= 400 && respuesta.status < 500) {
          this.registrar("aviso", `Resend rechazó el correo (${respuesta.status}): ${detalle}`);
          return { enviado: false, razon: `Resend lo rechazó: ${detalle.slice(0, 200)}` };
        }
        this.encolar(peticion);
        return { enviado: false, razon: "Resend no respondió: queda en cola" };
      }

      const cuerpo = (await respuesta.json()) as { id?: string };
      return { enviado: true, externo_id: cuerpo.id };
    } catch (causa) {
      // Sin internet. Se encola y sigue la vida.
      this.encolar(peticion);
      this.registrar("info", `Sin salida a internet: correo en cola (${String(causa)})`);
      return { enviado: false, razon: "Sin internet: queda en cola" };
    }
  }

  /**
   * Entrega por el SMTP de Google, con la cuenta del propio restaurante.
   *
   * El `usuario` sale de `cuenta_gmail` si está, y si no del remitente. Google
   * entrega SIEMPRE desde la cuenta con la que uno entra —reescribe el "De:" si
   * no coinciden—, así que usar el remitente como respaldo es lo que hace que
   * funcione aunque el restaurante solo haya llenado un campo.
   */
  private async porGmail(
    config: ConfiguracionCorreo,
    armado: ReturnType<typeof armarCorreo>,
    peticion: PeticionCorreo,
  ): Promise<ResultadoCorreo> {
    try {
      // Dentro del `try`: `soloDireccion` falla en seco ante una dirección con
      // saltos de línea, y ese fallo tiene que salir por el camino de siempre
      // —"Gmail lo rechazó", sin reintento— y no como excepción sin recoger.
      const usuario = soloDireccion(config.cuenta_gmail?.trim() || armado.de);

      const id = await this.entregar(
        {
          host: SMTP_GMAIL.host,
          puerto: SMTP_GMAIL.puerto,
          usuario,
          contrasena: this.apiKey().replace(/\s/g, ""),
        },
        armado,
      );
      return { enviado: true, externo_id: id };
    } catch (causa) {
      /*
       * La misma división de siempre, que es la que mantiene la cola limpia: lo
       * que se arregla solo se reintenta, lo que necesita que alguien toque la
       * configuración no. Un 535 es contraseña de aplicación mala o revocada, y
       * reintentarlo mil veces solo consigue que Google bloquee la cuenta.
       */
      if (causa instanceof ErrorSmtp && !causa.reintentable) {
        this.registrar("aviso", `Gmail rechazó el correo: ${causa.message}`);
        return {
          enviado: false,
          razon:
            causa.codigo === 535
              ? "Gmail no aceptó la contraseña de aplicación. Revísala en «Mensajes para el cliente»."
              : `Gmail lo rechazó: ${causa.message}`,
        };
      }
      this.encolar(peticion);
      this.registrar("info", `Correo en cola: ${String(causa)}`);
      return { enviado: false, razon: "No se pudo entregar ahora: queda en cola" };
    }
  }

  private encolar(peticion: PeticionCorreo): void {
    // Se descarta el más viejo: lo recién ocurrido es lo que todavía sirve.
    if (this.cola.length >= MAX_EN_COLA) this.cola.shift();
    this.cola.push({ peticion, creado_ts: this.ahora() });
  }

  /**
   * Intenta sacar lo pendiente. Se llama cada tanto, no en cada envío.
   *
   * Uno a uno y en serie: mandar quinientos correos de golpe al recuperar
   * internet es exactamente lo que un proveedor interpreta como abuso.
   */
  async vaciarCola(): Promise<{ enviados: number; caducados: number }> {
    if (this.enviando || this.cola.length === 0) return { enviados: 0, caducados: 0 };
    this.enviando = true;

    const ahora = this.ahora();
    const pendientes = this.cola;
    this.cola = [];

    let enviados = 0;
    let caducados = 0;

    try {
      for (const { peticion, creado_ts } of pendientes) {
        if (ahora - creado_ts > CADUCA_MS) {
          caducados += 1;
          continue;
        }
        const r = await this.mandar(peticion);
        if (r.enviado) enviados += 1;
      }
    } finally {
      this.enviando = false;
    }

    if (enviados > 0 || caducados > 0) {
      this.registrar(
        "info",
        `Correos pendientes: ${enviados} enviados, ${caducados} descartados por viejos`,
      );
    }
    return { enviados, caducados };
  }

  get pendientes(): number {
    return this.cola.length;
  }
}
