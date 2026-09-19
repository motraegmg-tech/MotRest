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
  CATALOGO_CORREOS,
  definicionCorreo,
  puedeMandarCorreo,
  type ConfiguracionCorreo,
  type DatosCorreo,
  type DefinicionCorreo,
  type ID,
  type Reserva,
  type TipoCorreo,
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
 * Los seis correos, cada uno ofrecido o con su motivo.
 *
 * Nunca se esconde ninguno: el restaurantero ve los seis siempre, y los que no
 * se pueden mandar dicen por qué. El orden de los motivos va de lo que afecta a
 * todo el restaurante —el remitente, un correo apagado— a lo que es de este
 * comensal, porque lo primero es lo que hay que arreglar antes.
 */
export function opcionesDeCorreo(
  config: ConfiguracionCorreo,
  situacion: SituacionDelComensal,
): OpcionCorreo[] {
  return CATALOGO_CORREOS.map((def): OpcionCorreo => {
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
    mensaje: MENSAJE_DE_EJEMPLO[tipo],
  });
}
