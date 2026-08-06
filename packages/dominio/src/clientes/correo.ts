/**
 * Los correos que el restaurante le manda al comensal (M7 · F3).
 *
 * POR QUÉ CORREO Y NO WHATSAPP
 *
 * WhatsApp cobra por conversación y exige verificación de empresa ante Meta,
 * aprobación de plantillas y un webhook público. Para "su reserva quedó
 * confirmada" eso es una montaña de trámite y de costo por un mensaje que el
 * correo entrega igual de bien. Y hay una consecuencia técnica que importa
 * todavía más: **el correo no necesita relay**. El Hub llama al proveedor
 * directamente desde el restaurante. Un servicio menos que pagar, que vigilar y
 * que exponer a internet.
 *
 * DÓNDE EL CORREO NO SIRVE, Y HAY QUE DECIRLO
 *
 * "Su mesa está lista" por correo no funciona: nadie revisa el correo de pie en
 * la puerta. Ese aviso —y solo ese— sigue necesitando WhatsApp o SMS. Todo lo
 * demás va por correo.
 *
 * LAS DOS CLASES DE CORREO, QUE NO SE MEZCLAN
 *
 *   TRANSACCIONAL — responde a algo que el comensal hizo: reservó, comió,
 *                   pidió su cuenta. No necesita permiso porque él lo provocó,
 *                   y NO lleva baja, porque dar de baja "su confirmación de
 *                   reserva" no tiene sentido.
 *
 *   MARKETING     — lo decide el negocio: cupones, promociones, "hace mucho que
 *                   no vienes". EXIGE consentimiento previo y SIEMPRE lleva
 *                   enlace de baja. No es cortesía: es la Ley Federal de
 *                   Protección de Datos Personales, y es lo que separa un
 *                   dominio con buena reputación de uno que acaba en spam.
 *
 * Mandar marketing disfrazado de transaccional es la forma más rápida de que el
 * dominio del restaurante deje de entregar NADA, ni siquiera las confirmaciones.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

export type TipoCorreo =
  /** "Su reserva quedó confirmada." */
  | "reserva_confirmada"
  /** "Lo esperamos mañana." */
  | "reserva_recordatorio"
  /** "¿Cómo estuvo todo?", con el enlace a su encuesta. */
  | "encuesta"
  /** "Gracias por su visita", con su consumo. */
  | "gracias"
  /** Cupones y promociones. */
  | "cupon"
  /** "Hace mucho que no viene." */
  | "te_extranamos";

export type ClaseCorreo = "transaccional" | "marketing";

export interface DefinicionCorreo {
  tipo: TipoCorreo;
  etiqueta: string;
  /** Qué hace, en una línea, para quien lo está activando. */
  descripcion: string;
  clase: ClaseCorreo;
  /** Cuándo sale, dicho para el restaurantero y no para el programador. */
  cuando: string;
  asuntoPorDefecto: string;
}

/** Lo que el restaurantero ve al configurar sus mensajes. */
export const CATALOGO_CORREOS: DefinicionCorreo[] = [
  {
    tipo: "reserva_confirmada",
    etiqueta: "Confirmación de reserva",
    descripcion: "Le confirma día, hora y personas, con un botón para llamar al restaurante.",
    clase: "transaccional",
    cuando: "Cuando la casa confirma una reserva",
    asuntoPorDefecto: "Su reserva en {{local}} quedó confirmada",
  },
  {
    tipo: "reserva_recordatorio",
    etiqueta: "Recordatorio de reserva",
    descripcion: "Le recuerda su reserva el día anterior. Baja mucho las mesas que se plantan.",
    clase: "transaccional",
    cuando: "El día antes de su reserva",
    asuntoPorDefecto: "Lo esperamos mañana en {{local}}",
  },
  {
    tipo: "encuesta",
    etiqueta: "Encuesta de su visita",
    descripcion: "Le pide su opinión con el enlace a su cuenta. La contesta él, no el mesero.",
    clase: "transaccional",
    cuando: "Después de cobrarle, si dejó su correo",
    asuntoPorDefecto: "¿Cómo estuvo todo en {{local}}?",
  },
  {
    tipo: "gracias",
    etiqueta: "Gracias por su visita",
    descripcion: "Un agradecimiento con el detalle de su consumo.",
    clase: "transaccional",
    cuando: "Después de cobrarle",
    asuntoPorDefecto: "Gracias por su visita a {{local}}",
  },
  {
    tipo: "cupon",
    etiqueta: "Cupones y promociones",
    descripcion: "Ofertas para quienes aceptaron recibirlas.",
    clase: "marketing",
    cuando: "Cuando el restaurante lance una campaña",
    asuntoPorDefecto: "Una promoción para usted en {{local}}",
  },
  {
    tipo: "te_extranamos",
    etiqueta: "Hace mucho que no viene",
    descripcion: "A quienes venían seguido y dejaron de venir. Es el correo que más recupera.",
    clase: "marketing",
    cuando: "Cuando alguien lleva sin venir mucho más de lo suyo",
    asuntoPorDefecto: "Lo extrañamos en {{local}}",
  },
];

export function definicionCorreo(tipo: TipoCorreo): DefinicionCorreo | undefined {
  return CATALOGO_CORREOS.find((d) => d.tipo === tipo);
}

/**
 * Desde qué dominio sale el correo del restaurante.
 *
 * NADIE PUEDE MANDAR CORREO "COMO" UNA DIRECCIÓN CUYO DOMINIO NO CONTROLA. Un
 * restaurante con `rodizio@gmail.com` no puede mandar desde ahí: Google exige
 * que quien firma el correo sea el dueño del dominio, y un correo que dice venir
 * de Gmail sin serlo acaba en spam o rechazado. No es una regla de Resend, es
 * cómo funciona el correo desde hace veinte años.
 *
 * De ahí las dos formas, y las dos son legítimas:
 */
export type ModoRemitente =
  /**
   * El dominio del restaurante: `reservas@rodizio.mx`.
   *
   * Es lo mejor para su marca y su reputación —lo que haga con su correo solo
   * le afecta a él— pero exige que tenga dominio y que alguien toque su DNS.
   */
  | "propio"
  /**
   * Un subdominio de MOTRAE: `rodizio@avisos.motrest.mx`.
   *
   * Cero fricción: no hay que comprar dominio ni tocar DNS, y el restaurante
   * puede estar mandando correos el mismo día. El comensal ve "Rodizio" como
   * remitente, así que la diferencia casi no se nota.
   *
   * A cambio, la reputación se comparte entre todos los locales de MOTRAE: si
   * uno abusa, los demás lo pagan. Por eso las reglas de consentimiento y baja
   * no son negociables en este modo.
   */
  | "motrae";

/**
 * Lo que exige cada modo para que el correo sirva de algo.
 *
 * En el modo MOTRAE, `responder_a` es OBLIGATORIO: el correo sale de un dominio
 * de MOTRAE, así que si el comensal contesta —y contesta— su mensaje llegaría a
 * un buzón que nadie lee. Con `responder_a` apuntando al correo de siempre del
 * restaurante, la respuesta le llega a quien tiene que llegarle, aunque ese
 * correo sea un Gmail.
 */
export function problemasDeRemitente(config: ConfiguracionCorreo): string[] {
  const problemas: string[] = [];

  if (!config.remitente.trim()) {
    problemas.push("Falta el remitente: sin él no se manda ningún correo");
    return problemas;
  }

  const dentro = config.remitente.match(/<([^>]+)>/)?.[1] ?? config.remitente;
  if (!correoPlausible(dentro)) {
    problemas.push("El remitente no parece una dirección de correo");
  }

  if (config.modo === "motrae" && !config.responder_a?.trim()) {
    problemas.push(
      "Con el dominio de MOTRAE hace falta un correo de respuesta: si no, " +
        "lo que conteste el comensal no le llega a nadie",
    );
  }

  if (config.responder_a && !correoPlausible(config.responder_a)) {
    problemas.push("El correo de respuesta no parece válido");
  }

  return problemas;
}

/** Lo que cada restaurante configura una vez. */
export interface ConfiguracionCorreo {
  /** De qué dominio sale. Ausente = propio, que es lo que había antes. */
  modo?: ModoRemitente;
  /** "Rodizio <reservas@rodizio.mx>". El dominio tiene que estar verificado. */
  remitente: string;
  /** A dónde contesta el comensal si le da a "Responder". */
  responder_a?: string;
  /** Para el botón de llamar. Sin él, el correo no ofrece llamar. */
  telefono?: string;
  /** Nombre del local, para los asuntos y el cuerpo. */
  local: string;
  /** Qué correos están encendidos. Lo apagado NO se manda. */
  activos: Partial<Record<TipoCorreo, boolean>>;
  /** Asuntos que el restaurante quiso cambiar. */
  asuntos?: Partial<Record<TipoCorreo, string>>;
}

/**
 * El dominio desde el que MOTRAE manda por sus restaurantes.
 *
 * UNO SOLO PARA TODOS. Cuesta unos $200 al año en total, no por local, y evita
 * que cada restaurante tenga que comprar dominio y tocar su DNS para poder
 * mandar una confirmación de reserva.
 */
export const DOMINIO_MOTRAE = "avisos.motrest.mx";

/**
 * Arma el remitente compartido de un restaurante.
 *
 * El comensal ve el nombre del restaurante, que es lo que le importa. La
 * dirección de atrás es de MOTRAE porque es la única forma de que el correo
 * pase los filtros sin que el local compre nada.
 */
export function remitenteCompartido(local: string): string {
  const usuario = local
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

  return `${local.trim()} <${usuario || "avisos"}@${DOMINIO_MOTRAE}>`;
}

/**
 * Configuración de arranque: el modo compartido, que es el que no cuesta nada.
 *
 * Se empieza por ahí a propósito. Un restaurante puede estar mandando
 * confirmaciones el mismo día que instala, y el que quiera su propia marca en el
 * remitente se cambia a dominio propio cuando quiera.
 */
export function configuracionVacia(local = ""): ConfiguracionCorreo {
  return {
    modo: "motrae",
    remitente: local ? remitenteCompartido(local) : "",
    local,
    activos: {},
  };
}

export type EventoCorreo =
  | (EventoBase & {
      tipo: "correo_enviado";
      correo: string;
      clase_correo: TipoCorreo;
      /** Id que devuelve el proveedor, para poder rastrear una queja. */
      externo_id?: string;
    })
  | (EventoBase & {
      tipo: "correo_rechazado";
      correo: string;
      clase_correo: TipoCorreo;
      motivo: string;
    });

export function streamCorreo(sucursal_id: ID): ID {
  return `correo:${sucursal_id}`;
}

/**
 * ¿Es una dirección con la que se puede intentar algo?
 *
 * Comprobación deliberadamente básica: validar correos "de verdad" con una
 * expresión regular es un problema sin solución, y rechazar direcciones válidas
 * porque son raras es peor que intentar y fallar. Solo se descarta lo que
 * seguro no es un correo.
 */
export function correoPlausible(correo: string | undefined): boolean {
  if (!correo) return false;
  const limpio = correo.trim();
  if (limpio.length < 5 || limpio.length > 254) return false;
  if (/\s/.test(limpio)) return false;

  const partes = limpio.split("@");
  if (partes.length !== 2) return false;
  const [usuario, dominio] = partes as [string, string];
  return usuario.length > 0 && dominio.includes(".") && !dominio.startsWith(".") && !dominio.endsWith(".");
}

export type VeredictoCorreo =
  | { puede: true }
  | { puede: false; razon: string };

/**
 * ¿Se le puede mandar ESTE correo a ESTA persona?
 *
 * Es la única puerta por la que debe pasar todo envío. Lo transaccional pasa
 * porque el comensal lo provocó; lo de marketing exige que haya dicho que sí y
 * que no se haya dado de baja.
 */
export function puedeMandarCorreo(
  tipo: TipoCorreo,
  correo: string | undefined,
  config: ConfiguracionCorreo,
  aceptaMarketing: boolean,
): VeredictoCorreo {
  if (!config.remitente) {
    return { puede: false, razon: "El restaurante todavía no configuró su remitente" };
  }
  if (!correoPlausible(correo)) {
    return { puede: false, razon: "No tenemos su correo" };
  }
  if (!config.activos[tipo]) {
    const def = definicionCorreo(tipo);
    return { puede: false, razon: `"${def?.etiqueta ?? tipo}" está apagado en este restaurante` };
  }

  const def = definicionCorreo(tipo);
  if (def?.clase === "marketing" && !aceptaMarketing) {
    return { puede: false, razon: "Esta persona no aceptó recibir promociones" };
  }

  return { puede: true };
}

export interface CorreoArmado {
  para: string;
  de: string;
  responder_a?: string;
  asunto: string;
  html: string;
  texto: string;
}

/** Datos que rellenan las variables de un correo. */
export interface DatosCorreo {
  nombre?: string;
  /** Fecha y hora de la reserva, ya escritas para leerse. */
  cuando?: string;
  personas?: number;
  /** Enlace a su cuenta en el portal, para la encuesta. */
  enlace?: string;
  /** Cuerpo libre de una campaña. */
  mensaje?: string;
  /** Enlace de baja. Obligatorio en marketing. */
  baja?: string;
}

function rellenar(texto: string, config: ConfiguracionCorreo, datos: DatosCorreo): string {
  return texto
    .replaceAll("{{local}}", config.local || "el restaurante")
    .replaceAll("{{nombre}}", datos.nombre ?? "")
    .replaceAll("{{cuando}}", datos.cuando ?? "")
    .replaceAll("{{personas}}", String(datos.personas ?? ""));
}

/** Escapa lo que viene del usuario antes de meterlo en el HTML del correo. */
function escapar(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Arma el correo listo para mandar.
 *
 * El HTML va con estilos EN LÍNEA y sin hojas aparte: los clientes de correo
 * —Outlook sobre todo— tiran el `<style>` y el correo llegaría desarmado. Es
 * feo de escribir y es lo único que se ve bien en todas partes.
 *
 * Siempre se genera también la versión de TEXTO. Un correo solo-HTML puntúa
 * peor en los filtros de spam, y hay quien lee sin imágenes.
 */
export function armarCorreo(
  tipo: TipoCorreo,
  para: string,
  config: ConfiguracionCorreo,
  datos: DatosCorreo,
): CorreoArmado {
  const def = definicionCorreo(tipo);
  const asunto = rellenar(
    config.asuntos?.[tipo] ?? def?.asuntoPorDefecto ?? "{{local}}",
    config,
    datos,
  );

  const local = config.local || "el restaurante";
  const saludo = datos.nombre ? `${datos.nombre},` : "Hola,";

  const cuerpo: string[] = [];
  const cuerpoTexto: string[] = [];

  switch (tipo) {
    case "reserva_confirmada":
      cuerpo.push(`Su reserva en <b>${escapar(local)}</b> quedó confirmada.`);
      if (datos.cuando) cuerpo.push(`<b>${escapar(datos.cuando)}</b>`);
      if (datos.personas) cuerpo.push(`Para ${datos.personas} personas.`);
      cuerpo.push("Si necesita cambiarla o cancelarla, llámenos o responda este correo.");
      cuerpoTexto.push(
        `Su reserva en ${local} quedó confirmada.`,
        datos.cuando ?? "",
        datos.personas ? `Para ${datos.personas} personas.` : "",
        "Si necesita cambiarla o cancelarla, llámenos o responda este correo.",
      );
      break;

    case "reserva_recordatorio":
      cuerpo.push(`Le recordamos su reserva en <b>${escapar(local)}</b>.`);
      if (datos.cuando) cuerpo.push(`<b>${escapar(datos.cuando)}</b>`);
      cuerpo.push("Si ya no puede venir, avísenos para dar la mesa a alguien más.");
      cuerpoTexto.push(`Le recordamos su reserva en ${local}.`, datos.cuando ?? "");
      break;

    case "encuesta":
      cuerpo.push("Gracias por su visita. ¿Nos ayuda con una pregunta rápida?");
      cuerpoTexto.push("Gracias por su visita. ¿Nos ayuda con una pregunta rápida?");
      break;

    case "gracias":
      cuerpo.push(`Gracias por venir a <b>${escapar(local)}</b>. Lo esperamos pronto.`);
      cuerpoTexto.push(`Gracias por venir a ${local}. Lo esperamos pronto.`);
      break;

    case "cupon":
    case "te_extranamos":
      cuerpo.push(escapar(datos.mensaje ?? ""));
      cuerpoTexto.push(datos.mensaje ?? "");
      break;
  }

  const botones: string[] = [];
  if (datos.enlace) {
    botones.push(
      `<a href="${escapar(datos.enlace)}" style="display:inline-block;padding:12px 22px;` +
        `background:#F2853A;color:#ffffff;text-decoration:none;border-radius:8px;` +
        `font-weight:600">Abrir</a>`,
    );
  }
  if (config.telefono) {
    const tel = config.telefono.replace(/\s/g, "");
    botones.push(
      `<a href="tel:${escapar(tel)}" style="display:inline-block;padding:12px 22px;` +
        `border:1.5px solid #E3E7E5;color:#1C2321;text-decoration:none;border-radius:8px;` +
        `font-weight:600">Llamar al restaurante</a>`,
    );
  }

  /*
   * La baja va en TODO lo de marketing, sin excepción y visible. Esconderla en
   * letra chica es lo que convierte una queja en un reporte de spam, y un
   * reporte de spam mancha el dominio para todos los correos del restaurante,
   * incluidas las confirmaciones de reserva.
   */
  const pie =
    def?.clase === "marketing" && datos.baja
      ? `<p style="margin:24px 0 0;font-size:12px;color:#6F7B81">` +
        `Recibe esto porque aceptó nuestras promociones. ` +
        `<a href="${escapar(datos.baja)}" style="color:#6F7B81">Darse de baja</a>.</p>`
      : "";

  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `max-width:520px;margin:0 auto;padding:24px;color:#1C2321">` +
    `<h1 style="font-size:20px;margin:0 0 16px">${escapar(local)}</h1>` +
    `<p style="font-size:16px;margin:0 0 12px">${escapar(saludo)}</p>` +
    cuerpo
      .filter(Boolean)
      .map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${p}</p>`)
      .join("") +
    (botones.length > 0 ? `<p style="margin:20px 0 0">${botones.join(" ")}</p>` : "") +
    pie +
    `</div>`;

  const texto = [
    local,
    "",
    saludo,
    ...cuerpoTexto.filter(Boolean),
    datos.enlace ? `\n${datos.enlace}` : "",
    config.telefono ? `\nTeléfono: ${config.telefono}` : "",
    def?.clase === "marketing" && datos.baja ? `\nDarse de baja: ${datos.baja}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    para,
    de: config.remitente,
    responder_a: config.responder_a,
    asunto,
    html,
    texto,
  };
}
