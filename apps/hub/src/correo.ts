/**
 * Envío de correo por Resend, desde el Hub del restaurante.
 *
 * SIN RELAY, y eso es lo importante. Mandar un correo es una llamada HTTP de
 * salida: el Hub la hace él mismo desde el local. No hace falta un servicio en
 * la nube, ni un webhook público, ni exponer nada — a diferencia de WhatsApp,
 * que necesita que Meta pueda alcanzarnos para entregar lo que entra.
 *
 * Un componente menos que pagar, que vigilar y que puede caerse.
 *
 * SI NO HAY INTERNET, EL RESTAURANTE SIGUE VENDIENDO. Los correos se encolan y
 * salen al reconectar. Con caducidad: un recordatorio de una reserva que ya
 * pasó no es un correo tardío, es una molestia.
 */
import {
  armarCorreo,
  puedeMandarCorreo,
  type ConfiguracionCorreo,
  type DatosCorreo,
  type TipoCorreo,
} from "@motrest/dominio";

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
    private apiKey: () => string,
    private registrar: (nivel: "info" | "aviso" | "error", texto: string) => void,
    private ahora: () => number = Date.now,
    private llamar: typeof fetch = fetch,
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
      return { enviado: false, razon: "Falta la llave de Resend del restaurante" };
    }

    const armado = armarCorreo(peticion.tipo, peticion.para, config, peticion.datos);

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
