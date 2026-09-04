/**
 * Los correos que el restaurante le manda al comensal (M7 · F3).
 *
 * POR QUÉ CORREO Y NO WHATSAPP
 *
 * WhatsApp cobra por conversación y exige verificación de empresa ante Meta,
 * aprobación de plantillas y un webhook público. Para "su reserva quedó
 * confirmada" eso es una montaña de trámite y de costo por un mensaje que el
 * correo entrega igual de bien. Y hay una consecuencia técnica que importa
 * todavía más: **el correo no necesita la nube**. El Hub llama al proveedor
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
 * Desde qué dirección sale el correo del restaurante.
 *
 * LA REGLA DE FONDO, QUE NO CAMBIA: nadie puede mandar correo "como" una
 * dirección sin demostrarle al mundo que le pertenece. Lo que sí cambia es CÓMO
 * se demuestra, y ahí hay dos caminos, no uno:
 *
 *   - Con un DOMINIO propio se demuestra publicando SPF y DKIM en su DNS. Es lo
 *     que exige Resend, y por eso un `@gmail.com` no se puede verificar ahí:
 *     el dominio `gmail.com` no es del restaurante.
 *
 *   - Con una CUENTA de Gmail se demuestra entrando a ella. Google mismo entrega
 *     el correo, firmado por él, desde su propio servidor. No hace falta dominio
 *     ni tocar DNS: hace falta la contraseña de aplicación de esa cuenta.
 *
 * El segundo camino es el que pidió Gonzalo y es el más barato que existe: el
 * restaurante ya tiene su Gmail, no compra nada y manda desde la dirección que
 * sus clientes ya conocen.
 */
export type ModoRemitente =
  /**
   * La cuenta de Gmail que el restaurante ya usa: `rodizio.gdl@gmail.com`.
   *
   * CERO COSTO Y CERO TRÁMITE. Se entrega por el SMTP de Google, autenticado con
   * una **contraseña de aplicación** (Gmail exige verificación en dos pasos para
   * generarla). Google firma el correo con su propio DKIM, así que entrega
   * perfecto — y el comensal ve la dirección de siempre del restaurante, que es
   * la que reconoce.
   *
   * Su único techo es el de Google: unos 500 destinatarios al día en una cuenta
   * gratuita. Para las confirmaciones y encuestas de un restaurante sobra; el
   * día que una campaña lo rebase, se pasa a `motrae` o a `propio`.
   */
  | "gmail"
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
   * Sirve cuando el volumen rebasa lo que aguanta un Gmail. La reputación se
   * comparte entre todos los locales de MOTRAE: si uno abusa, los demás lo
   * pagan. Por eso las reglas de consentimiento y baja no son negociables aquí.
   */
  | "motrae";

/** Servidor de salida de Google. TLS directo, sin STARTTLS: menos que negociar. */
export const SMTP_GMAIL = { host: "smtp.gmail.com", puerto: 465 } as const;

/** ¿Esta dirección es una cuenta de Google? */
export function esCuentaGmail(direccion: string): boolean {
  const dentro = direccion.match(/<([^>]+)>/)?.[1] ?? direccion;
  const dominio = dentro.trim().toLowerCase().split("@")[1] ?? "";
  return dominio === "gmail.com" || dominio === "googlemail.com";
}

/**
 * Arma el remitente para una cuenta de Gmail: `Rodizio <rodizio@gmail.com>`.
 *
 * El nombre delante importa más de lo que parece. Sin él, al comensal le llega
 * un correo de "rodizio.gdl" y no de "Rodizio"; con él, el remitente se lee como
 * el restaurante aunque la dirección de atrás sea un Gmail.
 */
export function remitenteGmail(local: string, cuenta: string): string {
  const nombre = local.trim();
  const direccion = cuenta.trim();
  return nombre ? `${nombre} <${direccion}>` : direccion;
}

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

  /*
   * En modo Gmail el remitente TIENE que ser la misma cuenta con la que se
   * entra al SMTP. Google reescribe o rechaza cualquier otro "De:", así que
   * poner `reservas@rodizio.mx` con la clave de `rodizio@gmail.com` no da un
   * error visible: da correos que llegan con la dirección cambiada.
   */
  if (config.modo === "gmail") {
    if (!esCuentaGmail(dentro)) {
      problemas.push(
        "En modo Gmail el remitente tiene que ser la cuenta @gmail.com del restaurante",
      );
    }
    if (config.cuenta_gmail && config.cuenta_gmail.trim().toLowerCase() !== dentro.toLowerCase()) {
      problemas.push(
        "La cuenta de Gmail y el remitente no coinciden: Google mandaría el correo " +
          "desde la cuenta, no desde el remitente",
      );
    }
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
  /** De dónde sale. Ausente = propio, que es lo que había antes. */
  modo?: ModoRemitente;
  /** "Rodizio <rodizio@gmail.com>". En modo Gmail, la cuenta de siempre. */
  remitente: string;
  /**
   * La cuenta con la que se entra al SMTP de Google. Solo en modo Gmail.
   *
   * Va aparte del remitente aunque casi siempre sean lo mismo, porque son cosas
   * distintas: una es quién firma la entrega y la otra es lo que lee el
   * comensal. Tenerlas separadas permite avisar cuando NO coinciden, que es el
   * error que manda correos con la dirección cambiada sin que nadie se entere.
   */
  cuenta_gmail?: string;
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
 * Configuración de arranque: **Gmail**, que es lo que no cuesta absolutamente
 * nada y lo que el restaurante ya tiene.
 *
 * No se rellena el remitente porque nadie puede adivinar cuál es su cuenta: se
 * captura en «Mensajes para el cliente» junto con su contraseña de aplicación, y
 * son dos campos. Es el alta más corta posible sin comprar nada ni tocar un DNS.
 */
export function configuracionVacia(local = ""): ConfiguracionCorreo {
  return { modo: "gmail", remitente: "", local, activos: {} };
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
    .replaceAll("{{local}}", enUnaLinea(config.local || "el restaurante"))
    .replaceAll("{{nombre}}", enUnaLinea(datos.nombre ?? ""))
    .replaceAll("{{cuando}}", enUnaLinea(datos.cuando ?? ""))
    .replaceAll("{{personas}}", String(datos.personas ?? ""));
}

/**
 * Aplana lo que se interpola, porque el asunto acaba siendo una cabecera.
 *
 * `{{nombre}}` sale de una reserva del portal público, donde cualquiera con el
 * QR escribe lo que quiera. En un asunto, un salto de línea abre una cabecera
 * nueva: `Juan\r\nBcc: quien-sea@ejemplo.com` manda una copia del correo del
 * restaurante a quien lo escribió.
 *
 * `smtp.ts` vuelve a aplanarlo antes de armar el MIME, y esa repetición es a
 * propósito: esta capa protege también a quien use este módulo por otro camino
 * —hoy, el API de Resend—, y la de allá protege aunque un día alguien arme un
 * asunto sin pasar por aquí. Ninguna de las dos se puede quitar por ser la
 * segunda.
 */
function enUnaLinea(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\x00-\x1F\x7F]+/g, " ").trim();
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
