/**
 * Los avisos que el Hub le manda al comensal por WhatsApp.
 *
 * WhatsApp hace UNA cosa que el Hub no puede: **empezar una conversación**. El
 * Hub no puede tocarle el hombro a alguien que ya se fue del restaurante. Todo
 * lo demás —la encuesta, las reservas, la carta— lo resuelve el portal, que es
 * gratis y funciona sin internet.
 *
 * DE AQUÍ NO SALE NADA QUE NO PASE POR LAS REGLAS
 *
 * A quién se le puede escribir, cuándo y con qué lo decide el dominio
 * (`clientes/mensajeria.ts`), no este archivo ni la nube. Romper esas reglas
 * se paga con el número del restaurante limitado o bloqueado por Meta, y con él
 * se caen los avisos, la encuesta y las promociones a la vez.
 *
 * SI NO HAY NUBE, NO PASA NADA GRAVE
 *
 * Los avisos se encolan y salen al reconectar. El restaurante sigue vendiendo:
 * es la misma postura de todo el sistema — lo de afuera es una mejora, nunca un
 * requisito.
 */
import {
  normalizarContacto,
  proyectarContactos,
  puedeEnviar,
  type EventoMensajeria,
  type Proposito,
} from "@motrest/dominio";

/** Las plantillas aprobadas en Meta que MotRest usa. */
export const PLANTILLAS = {
  mesaLista: "mesa_lista",
  reservaConfirmada: "reserva_confirmada",
  encuesta: "encuesta_visita",
} as const;

export interface Aviso {
  contacto: string;
  proposito: Proposito;
  /** Texto libre, solo si la ventana de 24 h está abierta. */
  texto?: string;
  plantilla?: { nombre: string; idioma: string; variables?: string[] };
}

export interface EnlaceDeAvisos {
  /** true = hay conexión viva con la nube ahora mismo. */
  conectado(): boolean;
  enviar(aviso: Aviso): void;
}

/**
 * Cuántos avisos se guardan mientras no hay nube.
 *
 * Con tope, y a propósito: una cola sin límite convierte una caída de internet
 * de tres días en una avalancha de mensajes viejos el día que vuelve. "Su mesa
 * está lista" de anteayer es peor que ningún mensaje.
 */
const MAX_EN_COLA = 200;

/** Después de esto, un aviso ya no tiene sentido mandarlo. */
const CADUCA_MS = 30 * 60 * 1000;

interface EnCola {
  aviso: Aviso;
  creado_ts: number;
}

export class Avisos {
  private cola: EnCola[] = [];

  constructor(
    private enlace: EnlaceDeAvisos,
    private eventosMensajeria: () => readonly EventoMensajeria[],
    private registrar: (nivel: "info" | "aviso", texto: string) => void,
    private ahora: () => number = Date.now,
  ) {}

  /**
   * Manda un aviso, si las reglas lo permiten.
   *
   * Devuelve por qué NO se mandó cuando no se manda. Que el Hub sepa la razón
   * importa: "no aceptó promociones" es un dato de negocio, y "no hay nube" es
   * un problema de infraestructura. Confundirlos hace perseguir el fallo
   * equivocado.
   */
  mandar(aviso: Aviso): { enviado: boolean; razon?: string } {
    const contactos = proyectarContactos(this.eventosMensajeria());
    const estado = contactos.get(normalizarContacto(aviso.contacto));
    const ahora = this.ahora();

    const veredicto = puedeEnviar(estado, aviso.proposito, ahora);
    if (!veredicto.puede) {
      this.registrar("info", `Aviso no enviado: ${veredicto.razon}`);
      return { enviado: false, razon: veredicto.razon };
    }

    /*
     * Fuera de la ventana de 24 h, Meta solo acepta plantillas. Si el aviso no
     * trae una, NO se manda texto libre "a ver si pasa": es exactamente el
     * error que escala a sanción.
     */
    if (veredicto.exigePlantilla && !aviso.plantilla) {
      const razon = "Fuera de la ventana de 24 h hace falta una plantilla aprobada";
      this.registrar("aviso", `Aviso no enviado: ${razon}`);
      return { enviado: false, razon };
    }

    if (!this.enlace.conectado()) {
      this.encolar(aviso, ahora);
      return { enviado: false, razon: "Sin enlace con MOTRAE: queda en cola" };
    }

    this.enlace.enviar(aviso);
    return { enviado: true };
  }

  private encolar(aviso: Aviso, ahora: number): void {
    // Se descarta el más viejo, no el nuevo: lo recién ocurrido es lo que
    // todavía le sirve a alguien.
    if (this.cola.length >= MAX_EN_COLA) this.cola.shift();
    this.cola.push({ aviso, creado_ts: ahora });
  }

  /**
   * Vuelve la nube: sale lo que quedó pendiente y NO ha caducado.
   *
   * Media hora es el límite. Mandar "su mesa está lista" cuando la mesa se dio
   * hace dos horas no es un aviso tardío: es una molestia que provoca bajas.
   */
  alReconectar(): { enviados: number; caducados: number } {
    const ahora = this.ahora();
    const pendientes = this.cola;
    this.cola = [];

    let enviados = 0;
    let caducados = 0;

    for (const { aviso, creado_ts } of pendientes) {
      if (ahora - creado_ts > CADUCA_MS) {
        caducados += 1;
        continue;
      }
      this.enlace.enviar(aviso);
      enviados += 1;
    }

    if (enviados > 0 || caducados > 0) {
      this.registrar(
        "info",
        `Avisos pendientes: ${enviados} enviados, ${caducados} descartados por viejos`,
      );
    }
    return { enviados, caducados };
  }

  get pendientes(): number {
    return this.cola.length;
  }
}

/** "Ramírez, su mesa está lista en Rodizio." */
export function avisoMesaLista(contacto: string, nombre: string, local: string): Aviso {
  return {
    contacto,
    proposito: "aviso_operativo",
    texto: `${nombre}, su mesa está lista. Lo esperamos.`,
    plantilla: { nombre: PLANTILLAS.mesaLista, idioma: "es_MX", variables: [nombre, local] },
  };
}

/** "Ramírez, su reserva quedó para el viernes a las 21:00." */
export function avisoReservaConfirmada(
  contacto: string,
  nombre: string,
  cuando: number,
): Aviso {
  const fecha = new Date(cuando);
  const dia = fecha.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const hora = fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  return {
    contacto,
    proposito: "aviso_operativo",
    texto: `${nombre}, su reserva quedó para el ${dia} a las ${hora}.`,
    plantilla: {
      nombre: PLANTILLAS.reservaConfirmada,
      idioma: "es_MX",
      variables: [nombre, dia, hora],
    },
  };
}
