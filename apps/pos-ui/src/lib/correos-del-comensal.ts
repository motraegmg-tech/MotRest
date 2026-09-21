/**
 * Qué correo se le puede mandar a un comensal, y con qué datos.
 *
 * Vive aparte de las pantallas porque lo usan tres —la ficha, Reservas y la
 * configuración— y porque es la parte que tiene reglas: si cada pantalla
 * decidiera por su cuenta cuándo se ofrece un recordatorio, acabarían diciendo
 * cosas distintas del mismo comensal.
 *
 * LA PUERTA SIGUE SIENDO UNA SOLA. Aquí no se decide si un correo «puede»
 * salir: eso lo dice `puedeMandarCorreo` del dominio, que es lo mismo que el Hub
 * vuelve a comprobar. Lo que se añade es lo que solo sabe la pantalla —si el
 * comensal tiene una reserva por delante, si ya se le recordó— y, sobre todo,
 * el MOTIVO escrito para quien está en la caja. Un correo que no se ofrece sin
 * decir por qué es una llamada a soporte.
 */
import {
  EJEMPLOS_DE_CORREO,
  catalogoDeCorreos,
  correoPropio,
  definicionCorreo,
  esTipoDeLaCasa,
  esTipoPropio,
  plantillaDe,
  puedeMandarCorreo,
  type BorradorDeCorreo,
  type ConfiguracionCorreo,
  type CorreoPropio,
  type DatosCorreo,
  type DefinicionCorreo,
  type ID,
  type Reserva,
  type TipoCorreo,
  type TipoCorreoDeLaCasa,
} from "@motrest/dominio";

/** Los dos correos que hablan de una reserva concreta. */
const DE_RESERVA = new Set<TipoCorreo>(["reserva_confirmada", "reserva_recordatorio"]);

export function esDeReserva(tipo: TipoCorreo): boolean {
  return DE_RESERVA.has(tipo);
}

export function esPublicidad(tipo: TipoCorreo): boolean {
  return definicionCorreo(tipo)?.clase === "marketing";
}

/**
 * «viernes, 19 de septiembre, 09:00 p.m.».
 *
 * Con las MISMAS opciones con que el Hub escribe la confirmación automática: el
 * comensal que recibe la confirmación y luego el recordatorio lee su fecha
 * escrita igual en los dos.
 *
 * Y todo lo que habla de una reserva en la terminal —la ficha, Reservas— tiene
 * que pasar por aquí: el recordatorio ya pedido se reconoce comparando este
 * texto, y dos formatos distintos para la misma reserva harían que se le
 * ofreciera otra vez.
 */
export function cuandoDeReserva(ts: number): string {
  return new Date(ts).toLocaleString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «viernes 26 de septiembre», para decir cuándo toca algo. */
function dia(ts: number): string {
  return new Date(ts).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Los diez últimos dígitos: «+52 33 1122 3344» y «3311223344» son el mismo. */
function telefonoComparable(telefono: string | undefined): string {
  return (telefono ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * La reserva más cercana que este comensal tiene por delante.
 *
 * Se busca por la ficha y, si la reserva no está atada a ninguna, por su correo
 * o su teléfono. Hace falta: las reservas que se apartan por teléfono desde la
 * pantalla de Reservas no se enlazan a la ficha, así que buscar solo por
 * `cliente_id` diría «no tiene reserva» de alguien que viene el viernes.
 *
 * Solo cuenta lo APARTADO y lo que todavía no llega. Una solicitud del portal
 * no está confirmada —mandarle «su reserva quedó confirmada» sería mentirle— y
 * una reserva de hace una hora ya no es próxima.
 */
export function reservaProximaDe(
  comensal: { cliente_id: ID; correo?: string; telefono?: string },
  reservas: readonly Reserva[],
  ahora: number,
): Reserva | undefined {
  const correo = comensal.correo?.trim().toLowerCase() ?? "";
  const telefono = telefonoComparable(comensal.telefono);

  const suyas = reservas.filter((r) => {
    if (r.estado !== "apartada" || r.para_ts <= ahora) return false;
    if (r.cliente_id) return r.cliente_id === comensal.cliente_id;
    if (correo && r.correo?.trim().toLowerCase() === correo) return true;
    return telefono.length >= 8 && telefonoComparable(r.telefono) === telefono;
  });

  return [...suyas].sort((a, b) => a.para_ts - b.para_ts)[0];
}

/**
 * ¿Hoy es la víspera de esa reserva?
 *
 * El recordatorio dice «Lo esperamos mañana». Mandarlo tres días antes, o la
 * misma tarde, es mandar un correo que miente en el asunto — y el comensal que
 * lee «mañana» un martes para una reserva del viernes se presenta el miércoles.
 */
export function esVispera(paraTs: number, ahora: number): boolean {
  const manana = new Date(ahora);
  manana.setDate(manana.getDate() + 1);
  const reserva = new Date(paraTs);
  return (
    reserva.getFullYear() === manana.getFullYear() &&
    reserva.getMonth() === manana.getMonth() &&
    reserva.getDate() === manana.getDate()
  );
}

/** Por qué todavía no toca recordarle, o `undefined` si ya toca. */
export function motivoParaNoRecordar(paraTs: number, ahora: number): string | undefined {
  if (esVispera(paraTs, ahora)) return undefined;
  const hoy = new Date(ahora).toDateString() === new Date(paraTs).toDateString();
  if (hoy) return "Su reserva es hoy: el recordatorio dice «mañana» y sale la víspera";
  return `El recordatorio sale la víspera: su reserva es el ${dia(paraTs)}`;
}

export interface OpcionCorreo {
  def: DefinicionCorreo;
  puede: boolean;
  /** Por qué no, dicho para quien está en la caja. Solo si `puede` es false. */
  razon?: string;
}

export interface SituacionDelComensal {
  correo: string | undefined;
  aceptaPromociones: boolean;
  /** Su reserva más cercana, si tiene. */
  reserva?: Reserva;
  /** Ya hay un recordatorio pedido para esa reserva, en camino o entregado. */
  recordatorioPedido?: boolean;
  ahora: number;
}

/**
 * Los seis correos, cada uno ofrecido o con su motivo, y detrás los que
 * escribió el restaurante.
 *
 * Nunca se esconde ninguno de los seis: el restaurantero los ve siempre, y los
 * que no se pueden mandar dicen por qué. El orden de los motivos va de lo que
 * afecta a todo el restaurante —el remitente, un correo apagado— a lo que es de
 * este comensal, porque lo primero es lo que hay que arreglar antes.
 *
 * LOS PROPIOS, IGUAL QUE LOS SEIS (decisión de Gonzalo, 1.5.6): a quien no
 * aceptó promociones se le enseñan en gris con su motivo, en vez de
 * esconderse. Un correo que desaparece de una ficha y aparece en otra hace
 * pensar al mesero que algo falla; en gris, sabe por qué no puede mandarlo.
 * Solo se esconden los APAGADOS: los apagó el restaurante, y enseñarlos en cada
 * ficha sería ruido. Que solo le lleguen a quien dijo que sí no depende de esta
 * lista: lo decide `puedeMandarCorreo`, aquí y otra vez en el Hub.
 */
export function opcionesDeCorreo(
  config: ConfiguracionCorreo,
  situacion: SituacionDelComensal,
): OpcionCorreo[] {
  const visibles = catalogoDeCorreos(config).filter(
    (def) =>
      !esTipoPropio(def.tipo) || correoPropio(def.tipo, config)?.activo === true,
  );
  return visibles.map((def): OpcionCorreo => {
    const veredicto = puedeMandarCorreo(
      def.tipo,
      situacion.correo,
      config,
      situacion.aceptaPromociones,
    );
    if (!veredicto.puede) return { def, puede: false, razon: veredicto.razon };

    if (esDeReserva(def.tipo)) {
      if (!situacion.reserva) return { def, puede: false, razon: "No tiene una reserva próxima" };

      if (def.tipo === "reserva_recordatorio") {
        if (situacion.recordatorioPedido) {
          return { def, puede: false, razon: "Ya se le mandó el recordatorio de esta reserva" };
        }
        const motivo = motivoParaNoRecordar(situacion.reserva.para_ts, situacion.ahora);
        if (motivo) return { def, puede: false, razon: motivo };
      }
    }

    return { def, puede: true };
  });
}

/**
 * Los datos con que se rellena un correo concreto.
 *
 * Cada correo lleva SOLO lo suyo: la fecha de la reserva no viaja en una
 * encuesta, ni el mensaje de una promoción en una confirmación. Lo que va de
 * más acaba escrito en el registro para siempre.
 */
export function datosDelCorreo(
  tipo: TipoCorreo,
  fuente: { nombre?: string; reserva?: Pick<Reserva, "para_ts" | "personas">; mensaje?: string },
): DatosCorreo {
  const datos: DatosCorreo = {};
  const nombre = fuente.nombre?.trim();
  if (nombre) datos.nombre = nombre;

  if (esDeReserva(tipo) && fuente.reserva) {
    datos.cuando = cuandoDeReserva(fuente.reserva.para_ts);
    datos.personas = fuente.reserva.personas;
  }

  const mensaje = fuente.mensaje?.trim();
  if (esPublicidad(tipo) && mensaje) datos.mensaje = mensaje;

  return datos;
}

// --- Ejemplos para la vista previa de la configuración -------------------------

/** A quién «le llega» el ejemplo. Un dominio reservado: nunca es de nadie. */
export const PARA_DE_EJEMPLO = "ana.ruiz@ejemplo.com";

/**
 * Lo que se sugiere escribir en cada promoción.
 *
 * Va como SUGERENCIA —el texto gris del cuadro— y nunca como valor ya escrito:
 * un «el postre va por nuestra cuenta» que se manda sin leer es una promesa que
 * el restaurante no decidió hacer.
 */
export const MENSAJE_DE_EJEMPLO: Partial<Record<TipoCorreo, string>> = {
  cupon: "Esta semana, 2×1 en pizzas medianas de martes a jueves. Enséñenos este correo al pedir.",
  te_extranamos:
    "Hace tiempo que no lo vemos por aquí. Vuelva esta semana y el postre corre por nuestra cuenta.",
};

/** El viernes que viene, a las 21:00. */
function proximoViernes(ahora: number): number {
  const fecha = new Date(ahora);
  const faltan = (5 - fecha.getDay() + 7) % 7 || 7;
  fecha.setDate(fecha.getDate() + faltan);
  fecha.setHours(21, 0, 0, 0);
  return fecha.getTime();
}

/**
 * Un comensal de mentiras con datos verosímiles: Ana Ruiz, que reservó el
 * viernes a las 21:00 para cuatro.
 *
 * Con datos de verdad y no con `{{nombre}}` a la vista, porque lo que el
 * restaurantero quiere saber es cómo lo lee su cliente, no cómo está hecha la
 * plantilla.
 */
export function datosDeEjemplo(tipo: TipoCorreo, ahora = Date.now()): DatosCorreo {
  return datosDelCorreo(tipo, {
    nombre: "Ana Ruiz",
    reserva: { para_ts: proximoViernes(ahora), personas: 4 },
    mensaje: mensajeDeEjemplo(tipo),
  });
}

/**
 * La sugerencia para un correo que pide mensaje, también para los que escribió
 * el restaurante: una «Promoción del día» sin sugerencia deja el cuadro en
 * blanco y nadie sabe qué tan largo tiene que ser.
 */
export function mensajeDeEjemplo(tipo: TipoCorreo): string {
  return MENSAJE_DE_EJEMPLO[tipo] ?? "Hoy, lasaña de la casa al 2×1 hasta las 6 de la tarde.";
}

// --- El editor de correos (1.5.6) -------------------------------------------------

/**
 * Lo que se ve en el editor al abrir un correo: lo que escribió el restaurante
 * donde lo hay y el ejemplo donde no. Se abre con TODO escrito —no con campos
 * vacíos que «significan el ejemplo»— porque lo que el restaurantero quiere es
 * leer el correo y cambiar una frase, no adivinar qué dice lo que no ve.
 */
export function borradorDe(
  tipo: TipoCorreo,
  config: ConfiguracionCorreo,
): BorradorDeCorreo | undefined {
  if (esTipoPropio(tipo)) {
    const p = correoPropio(tipo, config);
    if (!p) return undefined;
    return {
      nombre: p.nombre,
      asunto: p.asunto,
      titulo: p.titulo,
      texto: p.texto,
      boton: p.boton ?? "",
      enlace: p.enlace ?? "",
    };
  }
  const plantilla = plantillaDe(tipo, config);
  if (!plantilla) return undefined;
  return {
    asunto: plantilla.asunto,
    titulo: plantilla.titulo,
    texto: plantilla.texto,
    boton: plantilla.boton,
  };
}

/** El ejemplo de fábrica de uno de los seis, para «Volver al ejemplo». */
export function borradorDelEjemplo(tipo: TipoCorreoDeLaCasa): BorradorDeCorreo {
  const ejemplo = EJEMPLOS_DE_CORREO[tipo];
  return {
    asunto: definicionCorreo(tipo)!.asuntoPorDefecto,
    titulo: ejemplo.titulo,
    texto: ejemplo.texto,
    boton: ejemplo.boton,
  };
}

/** Con qué tipo se ve en la vista previa un correo nuevo que todavía no se guarda. */
export const TIPO_EN_BORRADOR = "propio:borrador" as const;

/**
 * La configuración como quedaría si se guardara lo que se está escribiendo.
 *
 * La vista previa del editor sale de aquí y de `armarCorreo`, la MISMA función
 * con la que el Hub arma lo que manda: lo que se ve mientras se escribe es lo
 * que va a llegar, con su diseño, su saludo y —en la publicidad— su baja. Un
 * dibujo aparte se habría desviado del correo de verdad a la primera.
 *
 * El correo propio en borrador va PRIMERO en la lista para que el tope de
 * `propiosDe` nunca lo deje fuera de su propia vista previa.
 */
export function configConBorrador(
  config: ConfiguracionCorreo,
  tipo: TipoCorreo,
  borrador: BorradorDeCorreo,
): ConfiguracionCorreo {
  if (esTipoPropio(tipo)) {
    const enBorrador: CorreoPropio = {
      tipo,
      nombre: borrador.nombre ?? "",
      asunto: borrador.asunto,
      titulo: borrador.titulo,
      texto: borrador.texto,
      ...(borrador.boton ? { boton: borrador.boton } : {}),
      ...(borrador.enlace ? { enlace: borrador.enlace } : {}),
      activo: true,
    };
    const otros = (config.propios ?? []).filter((p) => p.tipo !== tipo);
    return { ...config, propios: [enBorrador, ...otros] };
  }
  if (!esTipoDeLaCasa(tipo)) return config;
  return {
    ...config,
    asuntos: { ...(config.asuntos ?? {}), [tipo]: borrador.asunto },
    plantillas: {
      ...(config.plantillas ?? {}),
      [tipo]: { titulo: borrador.titulo, texto: borrador.texto, boton: borrador.boton },
    },
  };
}
