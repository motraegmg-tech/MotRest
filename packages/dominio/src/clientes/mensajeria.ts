/**
 * Mensajería con el comensal (M7 · F3): WhatsApp hoy, lo que venga después.
 *
 * POR QUÉ ESTO VIVE EN EL DOMINIO Y NO EN EL TRANSPORTE
 *
 * Las reglas que gobiernan un mensaje no son de transporte: son de negocio, y
 * romperlas tiene una consecuencia concreta y cara — Meta limita o tumba el
 * número del restaurante, y con él se cae la encuesta, el aviso de "su mesa
 * está lista" y las promociones, todo junto y sin previo aviso.
 *
 * Un número quemado no se arregla con código. Por eso las tres reglas viven
 * aquí, probadas, y quien envía solo obedece:
 *
 *   1. VENTANA DE SERVICIO DE 24 HORAS. Cuando el comensal escribe, se abre una
 *      ventana de 24 h en la que se le puede contestar libremente. Fuera de esa
 *      ventana SOLO se puede mandar una plantilla aprobada por Meta. Mandar
 *      texto libre fuera de la ventana es el error que más rápido escala a
 *      sanción.
 *
 *   2. CONSENTIMIENTO EXPLÍCITO PARA MARKETING. Una promoción no es servicio.
 *      Necesita que el comensal haya dicho que sí, y ese sí se guarda como
 *      evento — porque hay que poder demostrarlo, tanto ante Meta como ante la
 *      ley de datos personales.
 *
 *   3. LA BAJA SE HONRA SIEMPRE Y DE INMEDIATO. Sin excepciones, sin "un último
 *      mensaje". Es lo que separa a un negocio de un spammer, y Meta lo mide.
 *
 * El canal es intercambiable a propósito: `Canal` no dice "WhatsApp" en ningún
 * lado del dominio. El día que haya SMS o Telegram, cambia el transporte y no
 * las reglas.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

export type Canal = "whatsapp" | "sms";

/**
 * Para qué se le escribe.
 *
 * No es una etiqueta: decide si hace falta consentimiento y si se puede mandar
 * fuera de la ventana de 24 h.
 */
export type Proposito =
  /** Responde algo que el comensal preguntó. Gratis dentro de la ventana. */
  | "servicio"
  /** "Su mesa está lista", "su reserva quedó". Lo espera: es una utilidad. */
  | "aviso_operativo"
  /** Promociones. EXIGE consentimiento explícito. */
  | "marketing";

/** Cuánto dura la ventana en que se puede contestar libremente. */
export const VENTANA_SERVICIO_MS = 24 * 60 * 60 * 1000;

/** Tope de promociones por comensal en 30 días. Más que esto, se quema. */
export const MAX_MARKETING_MENSUAL = 4;

export type EventoMensajeria =
  | (EventoBase & {
      /** El comensal escribió: abre la ventana de servicio. */
      tipo: "mensaje_recibido";
      contacto: string;
      canal: Canal;
      texto: string;
      cliente_id?: ID;
      /** La cuenta desde la que llegó, si vino por el QR del ticket. */
      orden_id?: ID;
    })
  | (EventoBase & {
      tipo: "mensaje_enviado";
      contacto: string;
      canal: Canal;
      proposito: Proposito;
      /** Plantilla usada, si fue fuera de la ventana. */
      plantilla?: string;
    })
  | (EventoBase & {
      /** Dijo que sí a las promociones. Hay que poder demostrarlo. */
      tipo: "consentimiento_otorgado";
      contacto: string;
      canal: Canal;
      /** Dónde lo dio: "portal", "ticket", "en el mostrador". */
      origen: string;
      cliente_id?: ID;
    })
  | (EventoBase & {
      tipo: "consentimiento_retirado";
      contacto: string;
      canal: Canal;
      /** "BAJA", "STOP", o que alguien lo quitó a mano. */
      motivo: string;
    });

export interface EstadoContacto {
  contacto: string;
  canal: Canal;
  /** Cuándo escribió por última vez. Marca la ventana de servicio. */
  ultimo_entrante_ts?: number;
  /** true = dijo que sí a promociones y no se ha dado de baja. */
  acepta_marketing: boolean;
  consentimiento_ts?: number;
  /** Envíos de marketing, del más reciente al más viejo. */
  marketing_ts: number[];
  cliente_id?: ID;
}

export function streamMensajeria(sucursal_id: ID): ID {
  return `mensajeria:${sucursal_id}`;
}

/** Normaliza un teléfono a solo dígitos: así se compara sin sorpresas. */
export function normalizarContacto(contacto: string): string {
  return contacto.replace(/\D/g, "");
}

export function proyectarContactos(
  eventos: readonly EventoMensajeria[],
): Map<string, EstadoContacto> {
  const contactos = new Map<string, EstadoContacto>();

  for (const ev of eventos) {
    const clave = normalizarContacto(ev.contacto);
    if (!clave) continue;

    const previo: EstadoContacto = contactos.get(clave) ?? {
      contacto: clave,
      canal: ev.canal,
      acepta_marketing: false,
      marketing_ts: [],
    };

    switch (ev.tipo) {
      case "mensaje_recibido":
        contactos.set(clave, {
          ...previo,
          ultimo_entrante_ts: ev.ts,
          cliente_id: ev.cliente_id ?? previo.cliente_id,
        });
        break;

      case "mensaje_enviado":
        contactos.set(clave, {
          ...previo,
          marketing_ts:
            ev.proposito === "marketing" ? [ev.ts, ...previo.marketing_ts] : previo.marketing_ts,
        });
        break;

      case "consentimiento_otorgado":
        contactos.set(clave, {
          ...previo,
          acepta_marketing: true,
          consentimiento_ts: ev.ts,
          cliente_id: ev.cliente_id ?? previo.cliente_id,
        });
        break;

      case "consentimiento_retirado":
        // La baja se honra SIEMPRE. No hay estado del que no se pueda salir.
        contactos.set(clave, { ...previo, acepta_marketing: false });
        break;
    }
  }

  return contactos;
}

export function contactoDe(
  contactos: Map<string, EstadoContacto>,
  contacto: string,
): EstadoContacto | undefined {
  return contactos.get(normalizarContacto(contacto));
}

/** ¿Sigue abierta la ventana en que se puede contestar con texto libre? */
export function ventanaAbierta(estado: EstadoContacto | undefined, ahora: number): boolean {
  if (!estado?.ultimo_entrante_ts) return false;
  return ahora - estado.ultimo_entrante_ts < VENTANA_SERVICIO_MS;
}

export type VeredictoEnvio =
  | { puede: true; /** true = hay que usar plantilla aprobada, no texto libre. */ exigePlantilla: boolean }
  | { puede: false; razon: string };

/**
 * ¿Se le puede escribir a este contacto, ahora, para esto?
 *
 * Es la única puerta por la que debe pasar todo envío. Devuelve además si hace
 * falta plantilla, para que el transporte no tenga que adivinarlo.
 */
export function puedeEnviar(
  estado: EstadoContacto | undefined,
  proposito: Proposito,
  ahora: number,
): VeredictoEnvio {
  const abierta = ventanaAbierta(estado, ahora);

  if (proposito === "servicio") {
    // Contestar algo que nadie preguntó no es servicio.
    return abierta
      ? { puede: true, exigePlantilla: false }
      : { puede: false, razon: "La ventana de 24 h se cerró: usa un aviso con plantilla" };
  }

  if (proposito === "aviso_operativo") {
    // Es una utilidad que el comensal espera —su mesa, su reserva—, así que se
    // puede fuera de la ventana, pero con plantilla aprobada.
    return { puede: true, exigePlantilla: !abierta };
  }

  // Marketing: lo más regulado, y lo que quema el número.
  if (!estado?.acepta_marketing) {
    return { puede: false, razon: "Este contacto no aceptó recibir promociones" };
  }

  const hace30dias = ahora - 30 * 24 * 60 * 60 * 1000;
  const recientes = estado.marketing_ts.filter((ts) => ts >= hace30dias).length;
  if (recientes >= MAX_MARKETING_MENSUAL) {
    return {
      puede: false,
      razon: `Ya se le mandaron ${recientes} promociones este mes: más satura y provoca bajas`,
    };
  }

  return { puede: true, exigePlantilla: !abierta };
}

/**
 * ¿El comensal está pidiendo la baja?
 *
 * Se reconoce en español y en inglés, con o sin acentos, porque quien quiere
 * salir escribe lo primero que se le ocurre — y no entenderlo es exactamente
 * lo que convierte una queja en un reporte a Meta.
 */
const PALABRAS_DE_BAJA = ["baja", "stop", "cancelar", "no molestar", "unsubscribe", "salir"];

export function pideBaja(texto: string): boolean {
  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return PALABRAS_DE_BAJA.some((palabra) => limpio === palabra || limpio.startsWith(`${palabra} `));
}

/** A quiénes se les puede mandar una promoción hoy, sin quemar el número. */
export function destinatariosDeCampana(
  contactos: Map<string, EstadoContacto>,
  ahora: number,
): EstadoContacto[] {
  return [...contactos.values()].filter(
    (c) => puedeEnviar(c, "marketing", ahora).puede,
  );
}
