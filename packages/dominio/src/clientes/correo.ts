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
 *
 * LOS CORREOS SE ESCRIBEN A MANO DESDE LA 1.5.6
 *
 * Hasta la 1.5.5 el restaurantero solo podía cambiar el asunto: el cuerpo de
 * cada correo estaba escrito aquí, en código. Gonzalo pidió dos cosas: que cada
 * uno de los seis se pueda EDITAR —«que los restauranteros puedan escribir ellos
 * mismos cómo quieren que sea ese tipo de correo»— y que el restaurante pueda
 * CREAR los suyos, que nacen ya redactados como ejemplo.
 *
 * Lo que escribe el restaurante son PALABRAS, nunca HTML. El diseño de la casa
 * —el encabezado, el saludo con el nombre, los botones, la baja— lo sigue poniendo
 * `armarCorreo`, y todo lo que viene del restaurante se escapa igual que lo que
 * viene del comensal. Dejarle escribir HTML sería dejarle romper el correo en
 * Outlook, esconder la baja o meter un enlace a cualquier sitio con el nombre del
 * restaurante encima.
 *
 * Y LOS NUEVOS SON SIEMPRE PUBLICIDAD (decisión de Gonzalo). Un correo que decide
 * el negocio y no provoca el comensal es, por definición, marketing: solo llega a
 * quien aceptó promociones y siempre lleva su baja. No hay interruptor para
 * declararlo «aviso», porque ese interruptor sería exactamente la puerta para
 * mandar publicidad disfrazada de la que habla el párrafo de arriba.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

/** Los seis que trae MotRest de fábrica, con su texto de ejemplo. */
export type TipoCorreoDeLaCasa =
  /** "Su reserva quedó confirmada." */
  | "reserva_confirmada"
  /** "Lo esperamos mañana." */
  | "reserva_recordatorio"
  /** "¿Cómo estuvo todo?", con el enlace a su encuesta. */
  | "encuesta"
  /** "Gracias por su visita", con la invitación a volver. */
  | "gracias"
  /** Cupones y promociones. */
  | "cupon"
  /** "Hace mucho que no viene." */
  | "te_extranamos";

/**
 * Un correo que escribió el restaurante: `propio:<id>`.
 *
 * VA EN EL MISMO CAMPO QUE LOS SEIS, a propósito. La petición al Hub
 * (`correo_solicitado.clase_correo`), su respuesta y la lista de «Últimos
 * correos» de la ficha ya hablan de un `TipoCorreo`; con el prefijo, un correo
 * nuevo viaja por el mismo camino sin tocar el protocolo, y un Hub viejo que no
 * lo conoce lo contesta como «tipo desconocido» en vez de mandar algo raro.
 *
 * El id no es el nombre: el restaurante puede renombrar «Noche italiana» a «Noche
 * de pasta» y lo ya mandado sigue apuntando al mismo correo.
 */
export type TipoCorreoPropio = `propio:${string}`;

export type TipoCorreo = TipoCorreoDeLaCasa | TipoCorreoPropio;

const PATRON_PROPIO = /^propio:[A-Za-z0-9_-]{1,64}$/;

/** ¿Es un correo que escribió el restaurante? */
export function esTipoPropio(tipo: unknown): tipo is TipoCorreoPropio {
  return typeof tipo === "string" && PATRON_PROPIO.test(tipo);
}

/** ¿Es uno de los seis de fábrica? */
export function esTipoDeLaCasa(tipo: unknown): tipo is TipoCorreoDeLaCasa {
  return CATALOGO_CORREOS.some((d) => d.tipo === tipo);
}

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
    descripcion: "Un agradecimiento por su visita, con la invitación a volver.",
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

/**
 * La definición de un correo: uno de los seis, o uno que escribió el restaurante.
 *
 * LA CONFIGURACIÓN ES OPCIONAL, Y SIN ELLA UN CORREO PROPIO SIGUE SIENDO
 * PUBLICIDAD. Hay quien pregunta solo por la clase —¿lleva baja?, ¿pide
 * permiso?— sin tener la configuración a mano. Para un `propio:` la respuesta no
 * depende de ella: todos son marketing. Por eso se devuelve una definición
 * genérica en vez de `undefined`; un `undefined` se leería como «no es
 * marketing» en cualquier `def?.clase === "marketing"` que no lo previera, y eso
 * es mandar publicidad sin permiso.
 *
 * Con la configuración se devuelve el correo de verdad, con su nombre. Que
 * EXISTA —que no se haya borrado— lo comprueba `puedeMandarCorreo`, no esto.
 */
export function definicionCorreo(
  tipo: TipoCorreo,
  config?: ConfiguracionCorreo,
): DefinicionCorreo | undefined {
  const deLaCasa = CATALOGO_CORREOS.find((d) => d.tipo === tipo);
  if (deLaCasa) return deLaCasa;
  if (!esTipoPropio(tipo)) return undefined;

  const propio = config ? correoPropio(tipo, config) : undefined;
  if (propio) return definicionDePropio(propio);
  return {
    tipo,
    etiqueta: config ? "Correo que ya se borró" : "Correo del restaurante",
    descripcion: DESCRIPCION_PROPIO,
    clase: "marketing",
    cuando: CUANDO_PROPIO,
    asuntoPorDefecto: "{{local}}",
  };
}

const DESCRIPCION_PROPIO = "Escrito por el restaurante. Solo llega a quien aceptó promociones.";
const CUANDO_PROPIO = "Cuando el restaurante lo decida";

function definicionDePropio(propio: CorreoPropio): DefinicionCorreo {
  return {
    tipo: propio.tipo,
    etiqueta: propio.nombre.trim() || "Correo sin nombre",
    descripcion: DESCRIPCION_PROPIO,
    clase: "marketing",
    cuando: CUANDO_PROPIO,
    asuntoPorDefecto: propio.asunto,
  };
}

/**
 * Todos los correos de este restaurante: los seis de fábrica y, detrás, los
 * suyos, en el orden en que los creó.
 */
export function catalogoDeCorreos(config?: ConfiguracionCorreo): DefinicionCorreo[] {
  return [...CATALOGO_CORREOS, ...(config ? propiosDe(config).map(definicionDePropio) : [])];
}

// --- Lo que el restaurante escribe --------------------------------------------------------

/**
 * Lo que el restaurante cambió de uno de los seis. Cada campo ausente —o
 * vacío— es «el del ejemplo».
 *
 * El ASUNTO no está aquí: vive en `ConfiguracionCorreo.asuntos`, donde ya vivía
 * desde antes de la 1.5.6. Moverlo habría hecho que un Hub todavía en la 1.5.5
 * dejara de ver los asuntos que el restaurante ya había cambiado.
 */
export interface PlantillaCorreo {
  /** El encabezado grande. De fábrica, el nombre del local. */
  titulo?: string;
  /** El cuerpo, en palabras: párrafos separados por una línea en blanco. */
  texto?: string;
  /** Lo que dice el botón principal, en los correos que tienen uno. */
  boton?: string;
}

/**
 * Un correo que creó el restaurante (1.5.6).
 *
 * No tiene `clase`: todos son publicidad, y un campo que dijera otra cosa sería
 * un campo que alguien acabaría cambiando. Tampoco vive en `activos`: se
 * enciende y se apaga aquí mismo, para que borrarlo no deje un interruptor
 * huérfano apuntando a nada.
 */
export interface CorreoPropio {
  tipo: TipoCorreoPropio;
  /** Cómo lo llama el restaurante. Lo ve quien lo manda, no el comensal. */
  nombre: string;
  asunto: string;
  titulo: string;
  texto: string;
  /** El texto del botón. Sin enlace no hay botón. */
  boton?: string;
  /** A dónde lleva el botón. Solo `https://`. */
  enlace?: string;
  activo: boolean;
  /** De qué ejemplo salió. Solo para contarlo; no cambia nada. */
  arranque?: string;
  creado_ts?: number;
}

/** Una plantilla ya resuelta: lo del restaurante donde lo hay, y el ejemplo donde no. */
export interface PlantillaCompleta {
  asunto: string;
  titulo: string;
  texto: string;
  boton: string;
  enlace?: string;
}

/**
 * Los seis correos tal como salían antes de la 1.5.6, escritos como plantilla.
 *
 * SON EL «EJEMPLO» AL QUE SE VUELVE. Reproducen lo que el Hub mandaba cuando el
 * cuerpo estaba escrito en código —el mismo texto, las mismas negritas en el
 * nombre del local y en la fecha—, así que un restaurante que nunca toca «Editar»
 * sigue mandando exactamente lo de siempre.
 *
 * El cupón y «hace mucho que no viene» son solo `{{mensaje}}`: su texto se
 * escribe al mandarlo, como hasta ahora. Si el restaurante los edita y quita el
 * marcador, salen siempre con lo que dejó escrito y ya no piden mensaje.
 */
export const EJEMPLOS_DE_CORREO: Readonly<Record<TipoCorreoDeLaCasa, Omit<PlantillaCompleta, "asunto">>> = {
  reserva_confirmada: {
    titulo: "{{local}}",
    texto:
      "Su reserva en {{local}} quedó confirmada.\n\n{{cuando}}\n\nPara {{personas}}.\n\n" +
      "Si necesita cambiarla o cancelarla, llámenos o responda este correo.",
    boton: "Ver más",
  },
  reserva_recordatorio: {
    titulo: "{{local}}",
    texto:
      "Le recordamos su reserva en {{local}}.\n\n{{cuando}}\n\n" +
      "Si ya no puede venir, avísenos para dar la mesa a alguien más.",
    boton: "Ver más",
  },
  encuesta: {
    titulo: "{{local}}",
    texto:
      "Gracias por visitarnos en {{local}}. ¿Nos cuenta cómo estuvo todo? " +
      "Son dos minutos, y nos ayuda más de lo que parece.",
    boton: "Dejar mi opinión",
  },
  gracias: {
    titulo: "{{local}}",
    texto: "Gracias por venir a {{local}}. Lo esperamos pronto.",
    boton: "Ver más",
  },
  cupon: { titulo: "{{local}}", texto: "{{mensaje}}", boton: "Ver más" },
  te_extranamos: { titulo: "{{local}}", texto: "{{mensaje}}", boton: "Ver más" },
};

/**
 * ¿Este correo tiene un botón cuyo texto tenga sentido cambiar?
 *
 * La encuesta siempre lleva el suyo («Dejar mi opinión»), y los propios lo
 * llevan si el restaurante les pone enlace. Los demás solo tendrían botón con un
 * enlace que hoy nadie les pasa: ofrecer cambiar el texto de un botón que no sale
 * es un campo que no hace nada, y eso confunde más que ayuda.
 */
export function botonEditable(tipo: TipoCorreo): boolean {
  return tipo === "encuesta" || esTipoPropio(tipo);
}

/** Los datos que se pueden poner en un correo con un toque. */
export type ClaveMarcador = "nombre" | "local" | "cuando" | "personas" | "mensaje";

export interface Marcador {
  clave: ClaveMarcador;
  /** Lo que dice el botón que lo inserta. */
  etiqueta: string;
  /** Solo en el cuerpo: un mensaje de varios renglones no cabe en un asunto. */
  soloEnTexto: boolean;
}

const MARCADORES: Readonly<Record<ClaveMarcador, Marcador>> = {
  nombre: { clave: "nombre", etiqueta: "Nombre del comensal", soloEnTexto: false },
  local: { clave: "local", etiqueta: "Nombre del local", soloEnTexto: false },
  cuando: { clave: "cuando", etiqueta: "Día y hora de la reserva", soloEnTexto: false },
  personas: { clave: "personas", etiqueta: "Cuántas personas", soloEnTexto: false },
  mensaje: { clave: "mensaje", etiqueta: "Lo que escribas al mandarlo", soloEnTexto: true },
};

/**
 * Los marcadores que tienen sentido en ESTE correo.
 *
 * Solo los que se pueden llenar. «Día y hora de la reserva» en un «gracias por
 * su visita» saldría vacío, porque ese correo no habla de ninguna reserva, y un
 * botón que ofrece algo que va a salir en blanco es una trampa.
 */
export function marcadoresDe(tipo: TipoCorreo): Marcador[] {
  const claves: ClaveMarcador[] = ["nombre", "local"];
  if (tipo === "reserva_confirmada" || tipo === "reserva_recordatorio") {
    claves.push("cuando", "personas");
  }
  if (tipo === "cupon" || tipo === "te_extranamos" || esTipoPropio(tipo)) claves.push("mensaje");
  return claves.map((c) => MARCADORES[c]);
}

/** Cómo se escribe un marcador dentro del texto: `{{nombre}}`. */
export function marcadorEscrito(clave: ClaveMarcador): string {
  return `{{${clave}}}`;
}

/**
 * TOPES DE TAMAÑO Y DE CANTIDAD.
 *
 * La configuración de correo viaja entera a cada tableta del salón y al Hub cada
 * vez que alguien cambia algo, y se guarda en cada una. Sin tope, un texto pegado
 * de un documento de diez páginas o doscientos correos de prueba viajarían en
 * cada sincronización. Los números sobran para un correo de verdad: dos mil
 * letras son una página, y un asunto de más de ciento cincuenta ya se corta en
 * cualquier bandeja de entrada.
 */
export const TOPES_CORREO = {
  nombre: 60,
  asunto: 150,
  titulo: 80,
  texto: 2000,
  boton: 40,
  enlace: 500,
  /** Lo que se escribe al mandarlo, desde la ficha. */
  mensaje: 2000,
  /** Cuántos correos propios puede tener un restaurante. */
  propios: 20,
} as const;

/**
 * Los correos propios de la configuración, saneados.
 *
 * Todo lo que lee un correo propio pasa por aquí —el Hub al mandarlo, la caja al
 * enseñarlo—, así que un catálogo que llegue mal formado o inflado (una tableta
 * vieja, un respaldo editado a mano) no puede tumbar la pantalla ni colar cien
 * correos: lo que no tiene forma de correo se ignora, un tipo repetido cuenta
 * una vez, y del tope en adelante no se lee.
 */
export function propiosDe(config: ConfiguracionCorreo): CorreoPropio[] {
  const lista: unknown[] = Array.isArray(config.propios) ? config.propios : [];
  const vistos = new Set<string>();
  const sanos: CorreoPropio[] = [];

  for (const p of lista) {
    if (!p || typeof p !== "object") continue;
    const c = p as Partial<CorreoPropio>;
    if (!esTipoPropio(c.tipo) || vistos.has(c.tipo)) continue;
    if (typeof c.nombre !== "string" || typeof c.asunto !== "string" || typeof c.texto !== "string") {
      continue;
    }
    vistos.add(c.tipo);
    sanos.push({
      ...(c as CorreoPropio),
      titulo: typeof c.titulo === "string" ? c.titulo : "",
      activo: c.activo === true,
    });
    if (sanos.length >= TOPES_CORREO.propios) break;
  }
  return sanos;
}

/** Un correo propio por su tipo, o nada si no existe (o ya se borró). */
export function correoPropio(tipo: TipoCorreo, config: ConfiguracionCorreo): CorreoPropio | undefined {
  if (!esTipoPropio(tipo)) return undefined;
  return propiosDe(config).find((p) => p.tipo === tipo);
}

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * La plantilla con que sale un correo: lo que escribió el restaurante donde lo
 * hay, y el ejemplo donde no.
 *
 * Campo por campo y no todo o nada: quien solo cambió el título sigue recibiendo
 * el texto del ejemplo. `undefined` solo para un correo propio que ya no existe.
 */
export function plantillaDe(
  tipo: TipoCorreo,
  config: ConfiguracionCorreo,
): PlantillaCompleta | undefined {
  if (esTipoPropio(tipo)) {
    const propio = correoPropio(tipo, config);
    if (!propio) return undefined;
    return {
      asunto: textoDe(propio.asunto) || "{{local}}",
      titulo: textoDe(propio.titulo) || "{{local}}",
      texto: propio.texto,
      boton: textoDe(propio.boton) || "Ver más",
      ...(textoDe(propio.enlace) ? { enlace: textoDe(propio.enlace) } : {}),
    };
  }
  if (!esTipoDeLaCasa(tipo)) return undefined;

  const ejemplo = EJEMPLOS_DE_CORREO[tipo];
  const suya = config.plantillas?.[tipo];
  return {
    asunto: textoDe(config.asuntos?.[tipo]) || definicionCorreo(tipo)!.asuntoPorDefecto,
    titulo: textoDe(suya?.titulo) || ejemplo.titulo,
    texto: textoDe(suya?.texto) || ejemplo.texto,
    boton: textoDe(suya?.boton) || ejemplo.boton,
  };
}

/** ¿El restaurante cambió algo de este correo de fábrica? */
export function estaEditado(tipo: TipoCorreo, config: ConfiguracionCorreo): boolean {
  if (!esTipoDeLaCasa(tipo)) return false;
  const suya = config.plantillas?.[tipo];
  return !!(
    textoDe(config.asuntos?.[tipo]) ||
    textoDe(suya?.titulo) ||
    textoDe(suya?.texto) ||
    textoDe(suya?.boton)
  );
}

/**
 * ¿Hay que escribir un mensaje al mandarlo?
 *
 * Lo decide la plantilla y no la clase. Antes toda la publicidad pedía mensaje,
 * porque su cuerpo ERA el mensaje. Ahora un cupón que el restaurante dejó
 * escrito sale con su texto, y pedirle que escriba otro sería pedirle algo que
 * no va a salir en ningún lado.
 */
export function pideMensaje(tipo: TipoCorreo, config: ConfiguracionCorreo): boolean {
  return plantillaDe(tipo, config)?.texto.includes(marcadorEscrito("mensaje")) ?? false;
}

/**
 * ¿Es un enlace que puede ir en el botón de un correo propio?
 *
 * SOLO `https://`. El botón lleva el nombre del restaurante encima y le llega a
 * su clientela: un `http://` se ve «no seguro» en cualquier navegador, y un
 * `javascript:` o un `data:` no tienen nada que hacer en un correo. Tampoco se
 * aceptan usuario y contraseña dentro del enlace (`https://banco.mx@otro.sitio`),
 * que es el truco de siempre para que un enlace parezca de quien no es.
 */
export function esEnlaceSeguro(texto: string | undefined): boolean {
  const limpio = texto?.trim() ?? "";
  if (!limpio || limpio.length > TOPES_CORREO.enlace || /\s/.test(limpio)) return false;
  try {
    const url = new URL(limpio);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Los enlaces que ya existían antes de los correos propios —el de la encuesta,
 * el que venga en los datos— aceptan también `http://`, porque así se
 * capturaban y romperlos no protege a nadie. Lo que ya no pasa es un esquema que
 * no sea web: un `javascript:` que llegara desde una tableta manipulada.
 */
function enlaceAbrible(texto: string | undefined): string | undefined {
  const limpio = texto?.trim() ?? "";
  if (!limpio || /\s/.test(limpio)) return undefined;
  try {
    const url = new URL(limpio);
    const web = (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
    return web ? limpio : undefined;
  } catch {
    return undefined;
  }
}

// --- Validar lo que se escribe -----------------------------------------------------------

export type CampoDeCorreo = "nombre" | "asunto" | "titulo" | "texto" | "boton" | "enlace";

/** Lo que se está escribiendo en el editor, antes de guardarlo. */
export interface BorradorDeCorreo {
  /** Solo en los propios. */
  nombre?: string;
  asunto: string;
  titulo: string;
  texto: string;
  boton?: string;
  /** Solo en los propios. */
  enlace?: string;
}

export interface ProblemaDeCorreo {
  campo: CampoDeCorreo;
  mensaje: string;
  /**
   * Solo falta escribirlo. La pantalla lo calla hasta que se intenta guardar:
   * decir «falta el asunto» mientras alguien apenas empieza es regañar antes de
   * tiempo.
   */
  vacio?: boolean;
}

/**
 * Lo que queda entre corchetes en los ejemplos: «[el día y la hora]».
 *
 * Los arranques de los correos nuevos traen huecos así a propósito, para lo que
 * solo sabe el restaurante. Un correo que sale con «el [día] a las [hora]» es
 * peor que no mandarlo, así que no se guarda hasta que se llenan.
 */
const HUECO = /\[[^\]\n]{1,80}\]/;
const MARCA = /\{\{([^{}]*)\}\}/g;

const ETIQUETA_CAMPO: Record<CampoDeCorreo, string> = {
  nombre: "el nombre",
  asunto: "el asunto",
  titulo: "el título",
  texto: "el texto",
  boton: "el botón",
  enlace: "el enlace",
};

/**
 * Lo que impide guardar un correo, dicho campo por campo.
 *
 * Es la misma regla en la caja y en las pruebas, y se comprueba al guardar: un
 * marcador que no se puede llenar, un hueco del ejemplo sin llenar o un enlace
 * que no es `https://` no llegan a la configuración, así que tampoco al Hub.
 */
export function problemasDelBorrador(
  tipo: TipoCorreo,
  borrador: BorradorDeCorreo,
): ProblemaDeCorreo[] {
  const problemas: ProblemaDeCorreo[] = [];
  const propio = esTipoPropio(tipo);
  const permitidos = new Set(marcadoresDe(tipo).map((m) => m.clave));

  const revisar = (
    campo: CampoDeCorreo,
    valor: string | undefined,
    opciones: { obligatorio: boolean; tope: number; conMensaje: boolean },
  ): void => {
    const texto = valor?.trim() ?? "";
    if (!texto) {
      if (opciones.obligatorio) {
        problemas.push({ campo, mensaje: `Falta ${ETIQUETA_CAMPO[campo]}`, vacio: true });
      }
      return;
    }
    if (texto.length > opciones.tope) {
      problemas.push({
        campo,
        mensaje: `${mayuscula(ETIQUETA_CAMPO[campo])} es demasiado largo: ${texto.length} letras de ${opciones.tope}`,
      });
    }
    for (const [marca, dentro] of texto.matchAll(MARCA)) {
      const clave = dentro as ClaveMarcador;
      if (!Object.hasOwn(MARCADORES, clave)) {
        problemas.push({
          campo,
          mensaje: `«${marca}» no es un dato que MotRest sepa llenar: usa los botones de los datos`,
        });
      } else if (!permitidos.has(clave)) {
        problemas.push({
          campo,
          mensaje: `«${MARCADORES[clave].etiqueta}» no aplica en este correo: saldría vacío`,
        });
      } else if (MARCADORES[clave].soloEnTexto && !opciones.conMensaje) {
        problemas.push({
          campo,
          mensaje: `«${MARCADORES[clave].etiqueta}» solo puede ir en el texto`,
        });
      }
    }
    const hueco = texto.match(HUECO);
    if (hueco) {
      problemas.push({
        campo,
        mensaje: `Completa lo que va entre corchetes en ${ETIQUETA_CAMPO[campo]}: «${hueco[0]}»`,
      });
    }
  };

  if (propio) revisar("nombre", borrador.nombre, { obligatorio: true, tope: TOPES_CORREO.nombre, conMensaje: false });
  revisar("asunto", borrador.asunto, { obligatorio: true, tope: TOPES_CORREO.asunto, conMensaje: false });
  revisar("titulo", borrador.titulo, { obligatorio: false, tope: TOPES_CORREO.titulo, conMensaje: false });
  revisar("texto", borrador.texto, { obligatorio: true, tope: TOPES_CORREO.texto, conMensaje: true });
  if (botonEditable(tipo)) {
    revisar("boton", borrador.boton, { obligatorio: false, tope: TOPES_CORREO.boton, conMensaje: false });
  }

  if (propio) {
    const enlace = borrador.enlace?.trim() ?? "";
    if (enlace && !esEnlaceSeguro(enlace)) {
      problemas.push({
        campo: "enlace",
        mensaje:
          enlace.length > TOPES_CORREO.enlace
            ? `El enlace es demasiado largo: ${enlace.length} letras de ${TOPES_CORREO.enlace}`
            : "El enlace tiene que ser una dirección completa y segura, que empiece con https://",
      });
    }
    if (!enlace && borrador.boton?.trim()) {
      problemas.push({
        campo: "enlace",
        mensaje: "El botón necesita a dónde llevar: pon su enlace (https://…) o deja el botón vacío",
      });
    }
  }

  return problemas;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Lo escrito, sin lo que no debe viajar: espacios de sobra en las orillas,
 * saltos de línea de Windows y caracteres de control que se cuelan al pegar
 * desde otro programa.
 */
export function limpiarBorrador(borrador: BorradorDeCorreo): BorradorDeCorreo {
  const linea = (v: string | undefined) => enUnaLinea(v ?? "");
  const limpio: BorradorDeCorreo = {
    asunto: linea(borrador.asunto),
    titulo: linea(borrador.titulo),
    texto: sinControles(borrador.texto ?? "").trim(),
  };
  if (borrador.nombre !== undefined) limpio.nombre = linea(borrador.nombre);
  if (borrador.boton !== undefined) limpio.boton = linea(borrador.boton);
  if (borrador.enlace !== undefined) limpio.enlace = linea(borrador.enlace);
  return limpio;
}

// --- Los arranques de un correo nuevo ------------------------------------------------------

export interface ArranqueDeCorreo {
  id: string;
  nombre: string;
  /** Para qué sirve, en una línea, para elegirlo. */
  descripcion: string;
  borrador: BorradorDeCorreo;
}

/**
 * LOS CORREOS NUEVOS NACEN YA ESCRITOS, como pidió Gonzalo: «que ya vengan
 * predispuestos de cómo pueden venir, ejemplificando a los otros ejemplos».
 *
 * Una hoja en blanco es la forma más segura de que nadie cree nada. Cada arranque
 * trae un correo completo en el tono de los seis de fábrica —de usted, corto,
 * con una sola cosa que pedir—, y deja entre corchetes lo que solo sabe el
 * restaurante. Esos huecos impiden guardarlo hasta llenarlos: un «el [día] a las
 * [hora]» que llega a la clientela es peor que no mandar nada.
 *
 * «Promoción del día» usa `{{mensaje}}`: el marco es fijo y la promoción se
 * escribe cada vez que se manda, igual que el cupón de siempre.
 */
export const ARRANQUES_DE_CORREO: readonly ArranqueDeCorreo[] = [
  {
    id: "evento",
    nombre: "Evento especial",
    descripcion: "Una noche distinta: música en vivo, una cata, un partido en pantalla.",
    borrador: {
      nombre: "Evento especial",
      asunto: "Una noche especial en {{local}}",
      titulo: "Lo invitamos a una noche especial",
      texto:
        "El [día] a partir de las [hora] preparamos algo distinto en {{local}}: [qué habrá esa noche].\n\n" +
        "El cupo es limitado. Llámenos o responda este correo para apartar su lugar.\n\n" +
        "Nos dará mucho gusto verlo.",
      boton: "",
      enlace: "",
    },
  },
  {
    id: "temporada",
    nombre: "Menú de temporada",
    descripcion: "Platillos nuevos que estarán solo unas semanas.",
    borrador: {
      nombre: "Menú de temporada",
      asunto: "Llegó el menú de temporada a {{local}}",
      titulo: "Nuevo menú de temporada",
      texto:
        "Estrenamos platillos de temporada: [cuáles son, en una línea].\n\n" +
        "Estarán solo unas semanas, mientras dure la temporada. Venga a probarlos antes de que se vayan.",
      boton: "Ver el menú",
      enlace: "",
    },
  },
  {
    id: "aniversario",
    nombre: "Aniversario del local",
    descripcion: "Celebrar los años del restaurante con quienes lo han acompañado.",
    borrador: {
      nombre: "Aniversario del local",
      asunto: "{{local}} está de aniversario",
      titulo: "¡Estamos de aniversario!",
      texto:
        "Este [mes] cumplimos [número] años, y queremos celebrarlo con quienes nos han acompañado.\n\n" +
        "Durante la semana de aniversario, [lo que ofrecen: un postre, una copa, un descuento].\n\n" +
        "Gracias por ser parte de nuestra historia.",
      boton: "",
      enlace: "",
    },
  },
  {
    id: "promocion-del-dia",
    nombre: "Promoción del día",
    descripcion: "Un marco fijo; la promoción la escribes cada vez que la mandas.",
    borrador: {
      nombre: "Promoción del día",
      asunto: "Hoy en {{local}}: una promoción para usted",
      titulo: "Solo por hoy",
      texto: "{{mensaje}}\n\nMuestre este correo al pedir. Válido solo hoy.",
      boton: "",
      enlace: "",
    },
  },
  {
    id: "en-blanco",
    nombre: "En blanco",
    descripcion: "Para escribirlo desde cero.",
    borrador: { nombre: "", asunto: "", titulo: "", texto: "", boton: "", enlace: "" },
  },
];

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
  /**
   * A dónde contesta el comensal si le da a "Responder". SOLO en modo MOTRAE.
   *
   * Salió del formulario en la 1.5.5, a petición de Gonzalo, y en los modos que
   * de verdad se usan no hace falta: en Gmail y en dominio propio el remitente
   * ES el correo del restaurante, así que la respuesta le llega sola.
   *
   * Se conserva para el modo MOTRAE, donde sí es imprescindible: ahí el correo
   * sale de un buzón compartido que nadie lee, y sin esto se perdería cualquier
   * respuesta —incluida la de un comensal que pide la baja de la publicidad—.
   * Hoy ninguna pantalla permite elegir ese modo; si algún día se habilita,
   * `problemasDeRemitente` se niega a mandar sin este campo.
   */
  responder_a?: string;
  /**
   * El enlace al que manda la encuesta de la visita.
   *
   * La página de reseñas de Google del restaurante, o un formulario suyo. Existe
   * porque la encuesta estaba pensada para el portal público del comensal, y ese
   * portal nunca llegó a internet: el correo salía preguntando «¿nos ayuda con
   * una pregunta rápida?» sin ningún botón para contestar. Sin este enlace la
   * encuesta no se manda.
   */
  enlace_encuesta?: string;
  /** Para el botón de llamar. Sin él, el correo no ofrece llamar. */
  telefono?: string;
  /** Nombre del local, para los asuntos y el cuerpo. */
  local: string;
  /** Qué correos están encendidos. Lo apagado NO se manda. */
  activos: Partial<Record<TipoCorreo, boolean>>;
  /** Asuntos que el restaurante quiso cambiar, de los seis de fábrica. */
  asuntos?: Partial<Record<TipoCorreo, string>>;
  /**
   * Lo que el restaurante reescribió de los seis de fábrica: título, texto y
   * botón (1.5.6). Lo que no está aquí sale del ejemplo, así que «Volver al
   * ejemplo» es simplemente borrar la entrada.
   *
   * Viaja dentro de esta configuración a propósito: es lo que ya llega al Hub y a
   * todas las tabletas como catálogo `correo_config`, con su versión. Un correo
   * que se edita en la caja sale así del Hub en el siguiente envío, sin nada más
   * que sincronizar.
   */
  plantillas?: Partial<Record<TipoCorreoDeLaCasa, PlantillaCorreo>>;
  /**
   * Los correos que creó el restaurante (1.5.6), en el orden en que los creó.
   * Todos son publicidad. Hasta `TOPES_CORREO.propios`.
   */
  propios?: CorreoPropio[];
  /**
   * VERSIÓN Y FECHA, para que la configuración viaje como catálogo.
   *
   * Faltaban, y por eso la configuración no llegaba a ninguna parte: se guardaba
   * en el disco de la terminal donde se capturaba y ahí se quedaba. El Hub —que
   * es quien manda los correos— seguía con la que tuviera al arrancar, y las demás
   * tabletas decían «el restaurante todavía no configuró su remitente». El Hub
   * rechaza cualquier catálogo sin versión numérica, así que sin estos dos campos
   * ni siquiera se podía intentar.
   *
   * Opcionales porque las configuraciones guardadas antes no los traen: se leen
   * como versión 0 y cualquier cambio posterior las supera.
   */
  version?: number;
  updated_at?: number;
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
 * captura en «Clientes → Correos al comensal»; la contraseña de aplicación la
 * instala el soporte de MOTRAE en el Hub, y
 * son dos campos. Es el alta más corta posible sin comprar nada ni tocar un DNS.
 */
export function configuracionVacia(local = ""): ConfiguracionCorreo {
  return { modo: "gmail", remitente: "", local, activos: {} };
}

/**
 * Los eventos del correo.
 *
 * `correo_enviado` y `correo_rechazado` existían y NADIE los emitía: eran tipos
 * declarados para un envío que no había manera de pedir. De los seis correos del
 * catálogo solo uno salía de verdad —la confirmación de reserva, disparada sola
 * por el Hub— y los otros cinco eran interruptores conectados a nada.
 *
 * Ahora el camino es de ida y vuelta, y todo por el registro:
 *
 *   1. La terminal anota `correo_solicitado` — quién lo pidió, a quién, cuál.
 *   2. El Hub lo ve al ingerirlo, lo manda, y anota el resultado.
 *   3. `correo_enviado` o `correo_rechazado` vuelve a todas las terminales,
 *      atado por `solicitud_id`, y la ficha del comensal enseña qué pasó.
 *
 * Por el registro y no por una petición HTTP a propósito. Queda constancia de
 * quién mandó qué publicidad a quién y cuándo —que es lo primero que se pregunta
 * ante una queja por datos personales—, y si la red cae un momento la petición
 * espera en la bandeja de salida en vez de perderse.
 */
export type EventoCorreo =
  | (EventoBase & {
      tipo: "correo_solicitado";
      solicitud_id: ID;
      clase_correo: TipoCorreo;
      correo: string;
      /** De qué ficha salió, para enseñar el resultado en ella. */
      cliente_id?: ID;
      datos: DatosCorreo;
      /**
       * Si el comensal había aceptado publicidad AL PEDIRLO.
       *
       * Se congela en la petición y no se consulta después: si el comensal se
       * da de baja entre que se pide y que sale, lo que vale es lo que había
       * cuando alguien decidió mandarlo — y el Hub vuelve a comprobarlo contra
       * `puedeMandarCorreo` de todas formas.
       */
      acepta_marketing: boolean;
    })
  | (EventoBase & {
      tipo: "correo_enviado";
      correo: string;
      clase_correo: TipoCorreo;
      /** A qué petición responde. Ausente en los que el Hub manda por su cuenta. */
      solicitud_id?: ID;
      /** Id que devuelve el proveedor, para poder rastrear una queja. */
      externo_id?: string;
    })
  | (EventoBase & {
      tipo: "correo_rechazado";
      correo: string;
      clase_correo: TipoCorreo;
      solicitud_id?: ID;
      motivo: string;
    });

export type TipoEventoCorreo = EventoCorreo["tipo"];

/**
 * Los tipos de correo, enumerados, para quien tenga que filtrarlos.
 *
 * El `satisfies` y la comprobación de abajo hacen que olvidar uno no compile.
 * Es la tercera vez en esta base que una lista de tipos escrita a mano se queda
 * corta y deja eventos sin pintar; esta no puede.
 */
export const TIPOS_EVENTO_CORREO = [
  "correo_solicitado",
  "correo_enviado",
  "correo_rechazado",
] as const satisfies readonly TipoEventoCorreo[];

type FaltaAlgunTipoCorreo = Exclude<TipoEventoCorreo, (typeof TIPOS_EVENTO_CORREO)[number]>;
const _todosLosTiposCorreoEstan: FaltaAlgunTipoCorreo extends never ? true : never = true;
void _todosLosTiposCorreoEstan;

/** Cómo quedó una petición de correo, visto desde la ficha del comensal. */
export type EstadoSolicitudCorreo =
  | { estado: "pendiente"; pedido_ts: number }
  | { estado: "enviado"; pedido_ts: number; resuelto_ts: number }
  | { estado: "rechazado"; pedido_ts: number; resuelto_ts: number; motivo: string };

/**
 * El estado de cada petición, sacado del registro.
 *
 * «Pendiente» dura lo que tarda el Hub en contestar: con enlace, segundos. Si se
 * queda así mucho rato, es que el Hub no la ha visto — y decirlo es la
 * diferencia entre «ya se mandó» y «creo que se mandó».
 */
export function estadosDeCorreo(
  eventos: readonly EventoCorreo[],
): Map<ID, EstadoSolicitudCorreo & { clase_correo: TipoCorreo; cliente_id?: ID }> {
  const estados = new Map<
    ID,
    EstadoSolicitudCorreo & { clase_correo: TipoCorreo; cliente_id?: ID }
  >();

  for (const ev of eventos) {
    if (ev.tipo === "correo_solicitado") {
      estados.set(ev.solicitud_id, {
        estado: "pendiente",
        pedido_ts: ev.ts,
        clase_correo: ev.clase_correo,
        cliente_id: ev.cliente_id,
      });
    }
  }
  for (const ev of eventos) {
    if (ev.tipo === "correo_solicitado" || !ev.solicitud_id) continue;
    const previo = estados.get(ev.solicitud_id);
    if (!previo) continue;
    estados.set(
      ev.solicitud_id,
      ev.tipo === "correo_enviado"
        ? { ...previo, estado: "enviado", resuelto_ts: ev.ts }
        : { ...previo, estado: "rechazado", resuelto_ts: ev.ts, motivo: ev.motivo },
    );
  }
  return estados;
}

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

  /*
   * LOS CORREOS DEL RESTAURANTE, por su propio camino: su interruptor vive en
   * ellos, no en `activos`, y todos exigen el permiso de promociones.
   *
   * Que exista va PRIMERO. Una tableta que todavía no se entera de que alguien
   * lo borró puede pedirlo; el Hub lo contesta con un motivo que se entiende en
   * la ficha, en vez de un «tipo desconocido» que nadie sabe leer.
   */
  if (esTipoPropio(tipo)) {
    const propio = correoPropio(tipo, config);
    if (!propio) {
      return {
        puede: false,
        razon: "Ese correo ya no existe: el restaurante lo borró de «Correos al comensal»",
      };
    }
    if (!propio.activo) {
      return { puede: false, razon: `"${propio.nombre}" está apagado en este restaurante` };
    }
    if (!aceptaMarketing) {
      return { puede: false, razon: "Esta persona no aceptó recibir promociones" };
    }
    return { puede: true };
  }

  if (!config.activos[tipo]) {
    const def = definicionCorreo(tipo);
    return { puede: false, razon: `"${def?.etiqueta ?? tipo}" está apagado en este restaurante` };
  }

  // Lo que no se sabe si es aviso se trata como publicidad: equivocarse hacia
  // ese lado cuesta un correo que no sale, y hacia el otro, uno que no debía.
  const def = definicionCorreo(tipo, config);
  if (def?.clase !== "transaccional" && !aceptaMarketing) {
    return { puede: false, razon: "Esta persona no aceptó recibir promociones" };
  }

  /*
   * Una encuesta sin enlace es un correo que pregunta y no deja contestar. Se
   * frena aquí, en la única puerta por la que pasa todo envío, y no en la
   * pantalla: así tampoco se cuela por el Hub ni por una tableta vieja.
   */
  if (tipo === "encuesta" && !config.enlace_encuesta?.trim()) {
    return {
      puede: false,
      razon: "Falta el enlace de la encuesta (Clientes → Correos): sin él no hay dónde contestar",
    };
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

type Valores = Record<ClaveMarcador, string>;

/**
 * Lo que vale cada marcador en ESTE correo, ya limpio.
 *
 * Todo en una línea salvo el mensaje, que es el único que puede traer párrafos.
 * `{{personas}}` se escribe con su palabra —«4 personas», «1 persona»— porque
 * antes salía «Para 1 personas.» y así el ejemplo se lee bien en los dos casos.
 */
function valoresDe(config: ConfiguracionCorreo, datos: DatosCorreo): Valores {
  const personas = typeof datos.personas === "number" && datos.personas > 0 ? datos.personas : 0;
  return {
    local: enUnaLinea(config.local ?? "") || "el restaurante",
    nombre: enUnaLinea(datos.nombre ?? ""),
    cuando: enUnaLinea(datos.cuando ?? ""),
    personas: personas ? `${personas} ${personas === 1 ? "persona" : "personas"}` : "",
    mensaje: sinControles(datos.mensaje ?? "").trim().slice(0, TOPES_CORREO.mensaje),
  };
}

/**
 * Las marcas con que se señala, dentro del texto ya relleno, lo que va en
 * negritas. Son caracteres de control: no los puede escribir nadie, porque
 * `sinControles` y `enUnaLinea` los quitan de todo lo que entra, así que no se
 * pueden fingir para abrir una etiqueta.
 */
const NEGRITA = "\u0001";
const FIN_NEGRITA = "\u0002";
/** Dónde estaba un `{{nombre}}` que no se pudo llenar. Ver `rellenarRenglon`. */
const SIN_NOMBRE = "\u0003";
// eslint-disable-next-line no-control-regex
const MARCAS_DE_NEGRITA = /[\u0001\u0002]/g;

/** El nombre del local y la fecha van en negritas, como siempre salieron. */
const EN_NEGRITAS = new Set<ClaveMarcador>(["local", "cuando"]);

/**
 * Los datos que, si no vienen, se llevan su renglón.
 *
 * Es lo que hacía el código de antes con `if (datos.cuando)`: una reserva sin
 * fecha no escribía un renglón vacío. Con el texto en manos del restaurante, el
 * equivalente es quitar el renglón donde iba el dato. Con el nombre NO se hace:
 * «Hola {{nombre}}, qué gusto» se queda en «Hola, qué gusto» en vez de
 * desaparecer.
 */
const SE_LLEVAN_SU_RENGLON: readonly ClaveMarcador[] = ["cuando", "personas", "mensaje"];

/** Quita los caracteres de control salvo el salto de línea y el tabulador. */
function sinControles(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

/**
 * Pone los datos en un renglón.
 *
 * Lo que no es un marcador conocido se deja tal cual: la validación ya impide
 * guardarlo, y si llegara por otro camino es mejor que se vea raro a que se
 * sustituya por algo que nadie escribió. `Object.hasOwn` y no `in`, porque
 * `{{constructor}}` está «en» cualquier objeto.
 */
function rellenarRenglon(renglon: string, valores: Valores, negritas: boolean): string {
  let r = renglon;
  /*
   * SIN NOMBRE, SE QUITA CON SU PUNTUACIÓN. Un comensal sin nombre en la ficha
   * no debe recibir «Hola , qué gusto» ni «¡Nos vemos, !». Se cambia el marcador
   * por una señal (otro carácter de control, que nadie puede escribir) y se
   * limpia solo alrededor de ella, para no tocar la puntuación del resto del
   * renglón:
   *   «Hola {{nombre}}, qué gusto» → «Hola, qué gusto»
   *   «Gracias, {{nombre}}!»       → «Gracias!»
   *   «{{nombre}}, lo esperamos»   → «lo esperamos»
   */
  if (!valores.nombre && r.includes("{{nombre}}")) {
    r = r
      .replaceAll("{{nombre}}", SIN_NOMBRE)
      // eslint-disable-next-line no-control-regex
      .replace(/[ \t]*[,;:]?[ \t]*\u0003(?=[ \t]*(?:[!?.]|$))/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/^[ \t]*\u0003[ \t]*[,;:]?[ \t]*/, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[ \t]*\u0003/g, "");
  }
  return r.replace(MARCA, (marca, dentro: string) => {
    if (!Object.hasOwn(valores, dentro)) return marca;
    const valor = valores[dentro as ClaveMarcador];
    return negritas && valor && EN_NEGRITAS.has(dentro as ClaveMarcador)
      ? `${NEGRITA}${valor}${FIN_NEGRITA}`
      : valor;
  });
}

/** Una línea suelta —asunto, título, botón—: sin mensaje y sin saltos. */
function rellenarLinea(plantilla: string, valores: Valores, tope: number): string {
  return enUnaLinea(rellenarRenglon(sinControles(plantilla).slice(0, tope), { ...valores, mensaje: "" }, false));
}

/**
 * El cuerpo, en párrafos: una línea en blanco separa párrafos y un salto
 * sencillo es un salto dentro del párrafo. Cada párrafo sale con sus marcas de
 * negritas, que `parrafoHtml` convierte y `parrafoTexto` quita.
 */
function parrafosDe(plantilla: string, valores: Valores): string[] {
  const renglones = sinControles(plantilla.slice(0, TOPES_CORREO.texto))
    .split("\n")
    .filter((renglon) =>
      SE_LLEVAN_SU_RENGLON.every((clave) => valores[clave] || !renglon.includes(marcadorEscrito(clave))),
    );

  return renglones
    .map((r) => rellenarRenglon(r, valores, true))
    .join("\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.replace(MARCAS_DE_NEGRITA, "").trim() !== "");
}

/** Primero se escapa TODO y solo después se ponen las etiquetas propias. */
function parrafoHtml(parrafo: string): string {
  return escapar(parrafo)
    .replaceAll(NEGRITA, "<b>")
    .replaceAll(FIN_NEGRITA, "</b>")
    .replaceAll("\n", "<br>");
}

function parrafoTexto(parrafo: string): string {
  return parrafo.replace(MARCAS_DE_NEGRITA, "");
}

/**
 * A dónde lleva el botón principal, si lo hay.
 *
 * Un correo propio solo con su enlace `https://`, y se vuelve a comprobar aquí
 * aunque la caja ya lo valide al guardar: una configuración que llegue por otro
 * camino no puede poner un `javascript:` en un botón con el nombre del
 * restaurante encima.
 */
function enlaceDelBoton(
  tipo: TipoCorreo,
  config: ConfiguracionCorreo,
  datos: DatosCorreo,
  plantilla: PlantillaCompleta,
): string | undefined {
  if (esTipoPropio(tipo)) {
    return esEnlaceSeguro(plantilla.enlace) ? plantilla.enlace!.trim() : undefined;
  }
  return enlaceAbrible(tipo === "encuesta" ? (config.enlace_encuesta ?? datos.enlace) : datos.enlace);
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
  const def = definicionCorreo(tipo, config);
  /*
   * DE LA PLANTILLA, SIEMPRE. Desde la 1.5.6 no hay un cuerpo escrito aquí por
   * tipo: los seis de fábrica salen de su ejemplo (o de lo que el restaurante
   * reescribió) y los propios, de lo suyo. Un correo propio que ya no existe
   * no debería llegar hasta aquí —`puedeMandarCorreo` lo frena antes—, pero si
   * llega sale vacío y con su baja, nunca con el texto de otro.
   */
  const plantilla: PlantillaCompleta = plantillaDe(tipo, config) ?? {
    asunto: "{{local}}",
    titulo: "{{local}}",
    texto: "",
    boton: "Ver más",
  };
  /*
   * Lo que no se sabe si es aviso lleva la baja. El único error aceptable aquí
   * es poner una baja de más; el contrario es publicidad sin forma de pararla.
   */
  const publicidad = def?.clase !== "transaccional";

  const valores = valoresDe(config, datos);
  const asunto = rellenarLinea(plantilla.asunto, valores, TOPES_CORREO.asunto);
  const titulo = rellenarLinea(plantilla.titulo, valores, TOPES_CORREO.titulo) || valores.local;
  const saludo = valores.nombre ? `${valores.nombre},` : "Hola,";
  const parrafos = parrafosDe(plantilla.texto, valores);

  /*
   * EL BOTÓN PRINCIPAL, y lo que dice.
   *
   * La encuesta lleva el enlace del restaurante —sus reseñas de Google o un
   * formulario—; un correo propio, el suyo; los demás, el que venga en los
   * datos. Antes el botón decía «Abrir» en todos los casos, que no le dice al
   * comensal qué va a pasar si lo pulsa, y un botón que no se entiende no se
   * pulsa. Desde la 1.5.6 lo que dice lo puede escribir el restaurante, y se
   * escapa como todo lo demás.
   */
  const enlace = enlaceDelBoton(tipo, config, datos, plantilla);
  const rotuloBoton = rellenarLinea(plantilla.boton, valores, TOPES_CORREO.boton) || "Ver más";

  const botones: string[] = [];
  if (enlace) {
    botones.push(
      `<a href="${escapar(enlace)}" style="display:inline-block;padding:12px 22px;` +
        `background:#F2853A;color:#14181A;text-decoration:none;border-radius:8px;` +
        `font-weight:600">${escapar(rotuloBoton)}</a>`,
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
  /*
   * Y VA SIEMPRE, con o sin página de baja. Antes solo salía `if (datos.baja)`,
   * así que una campaña mandada sin ese enlace —que es TODAS, porque la página
   * pública de baja nunca existió— se iba sin ninguna forma de darse de baja.
   *
   * Sin página, la baja es por respuesta: el remitente es el correo del propio
   * restaurante, así que el «BAJA» le llega a él, y se desmarca en la ficha del
   * comensal. Es un paso a mano, pero es un mecanismo real, que es lo que exige
   * la ley de datos personales. Un correo de publicidad sin baja no sale.
   *
   * Y NO ES PARTE DE LA PLANTILLA (1.5.6). El restaurante escribe el cuerpo; el
   * pie lo pone siempre esta función, después de todo lo suyo. No hay texto que
   * se pueda escribir para quitarlo ni para taparlo. El enlace de baja, si lo
   * hay, tiene que ser web: uno raro se cambia por el «responda BAJA».
   */
  const bajaWeb = enlaceAbrible(datos.baja);
  const pie = !publicidad
    ? ""
    : bajaWeb
      ? `<p style="margin:24px 0 0;font-size:12px;color:#6F7B81">` +
        `Recibe esto porque aceptó nuestras promociones. ` +
        `<a href="${escapar(bajaWeb)}" style="color:#6F7B81">Darse de baja</a>.</p>`
      : `<p style="margin:24px 0 0;font-size:12px;color:#6F7B81">` +
        `Recibe esto porque aceptó nuestras promociones. ` +
        `Para no recibir más, responda <b>BAJA</b> a este correo.</p>`;

  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `max-width:520px;margin:0 auto;padding:24px;color:#1C2321">` +
    `<h1 style="font-size:20px;margin:0 0 16px">${escapar(titulo)}</h1>` +
    `<p style="font-size:16px;margin:0 0 12px">${escapar(saludo)}</p>` +
    parrafos
      .map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${parrafoHtml(p)}</p>`)
      .join("") +
    (botones.length > 0 ? `<p style="margin:20px 0 0">${botones.join(" ")}</p>` : "") +
    pie +
    `</div>`;

  const bajaTexto = !publicidad
    ? ""
    : bajaWeb
      ? `Darse de baja: ${bajaWeb}`
      : "Para no recibir más, responda BAJA a este correo.";

  /*
   * La versión de texto sigue el mismo orden que el diseño, con una línea en
   * blanco entre bloques: es lo que se lee en un cliente sin HTML, y los párrafos
   * pegados uno al otro se leen como uno solo.
   */
  const texto = [
    titulo,
    saludo,
    ...parrafos.map(parrafoTexto),
    enlace ? `${rotuloBoton}: ${enlace}` : "",
    config.telefono ? `Teléfono: ${config.telefono}` : "",
    bajaTexto,
  ]
    .filter((l) => l !== "")
    .join("\n\n");

  return {
    para,
    de: config.remitente,
    /*
     * Solo en modo MOTRAE, que es el único donde hace falta: ahí el remitente es
     * un buzón compartido. En Gmail y en dominio propio el remitente ES el
     * restaurante, y añadir otro «Responder a» solo abre la puerta a que las
     * respuestas —y las bajas— lleguen a una dirección vieja que nadie mira.
     */
    ...(config.modo === "motrae" && config.responder_a
      ? { responder_a: config.responder_a }
      : {}),
    asunto,
    html,
    texto,
  };
}

// --- El aviso de una autofactura rechazada (1.5.6) -------------------------------------

/**
 * El correo que le avisa al comensal que el SAT no aceptó los datos con los que
 * pidió su factura en el portal, con el motivo y el enlace para corregirlos.
 *
 * NO es uno de los correos del catálogo: el restaurante no lo escribe ni lo
 * apaga —es la respuesta a algo que el comensal pidió— y por eso es
 * TRANSACCIONAL: sin pie de baja y sin pedir permiso de promociones. Lleva el
 * mismo diseño que los demás, y todo lo que viene de fuera (el motivo del SAT,
 * el folio) se escapa igual. El enlace solo se pone si es web.
 */
export function armarAvisoDeFacturaRechazada(
  para: string,
  config: ConfiguracionCorreo,
  datos: { folio: string; motivo: string; enlace: string },
): CorreoArmado {
  const local = valoresDe(config, {}).local;
  const folio = enUnaLinea(datos.folio).slice(0, 20);
  const motivo = enUnaLinea(datos.motivo).slice(0, 500) || "Los datos no coinciden con los del SAT.";
  const enlace = enlaceAbrible(datos.enlace);

  const asunto = enUnaLinea(`Tu factura de ${local} no salió: revisa tus datos`).slice(0, TOPES_CORREO.asunto);
  const titulo = "Tu factura no salió";
  const parrafos = [
    `El SAT no aceptó los datos con los que pediste la factura del ticket ${folio}. Esto es lo que dijo:`,
    motivo,
    "Revisa que tu nombre o razón social, tu código postal y tu régimen coincidan exactamente con tu " +
      "Constancia de Situación Fiscal, y vuelve a pedirla. Tienes 72 horas desde tu consumo.",
  ];

  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `max-width:520px;margin:0 auto;padding:24px;color:#1C2321">` +
    `<h1 style="font-size:20px;margin:0 0 16px">${escapar(titulo)}</h1>` +
    `<p style="font-size:16px;margin:0 0 12px">Hola,</p>` +
    parrafos
      .map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 10px">${escapar(p)}</p>`)
      .join("") +
    (enlace
      ? `<p style="margin:20px 0 0"><a href="${escapar(enlace)}" style="display:inline-block;` +
        `padding:12px 22px;background:#F2853A;color:#14181A;text-decoration:none;` +
        `border-radius:8px;font-weight:600">Corregir mis datos</a></p>`
      : "") +
    `</div>`;

  const texto = [titulo, "Hola,", ...parrafos, enlace ? `Corregir mis datos: ${enlace}` : ""]
    .filter((l) => l !== "")
    .join("\n\n");

  return {
    para,
    de: config.remitente,
    ...(config.modo === "motrae" && config.responder_a ? { responder_a: config.responder_a } : {}),
    asunto,
    html,
    texto,
  };
}
