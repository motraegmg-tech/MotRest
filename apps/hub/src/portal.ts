/**
 * La puerta del comensal (M7 · F3).
 *
 * Es la única parte del Hub a la que llega un dispositivo que NO es del
 * restaurante: el teléfono de quien acaba de comer. Por eso todo aquí está
 * escrito al revés que el resto del sistema — no se pregunta "¿qué quiere
 * hacer?", se pregunta "¿qué es lo mínimo que puede hacer?".
 *
 * LAS TRES REGLAS
 *
 * 1. **Se entra con un enlace firmado, no con credenciales.** El comensal no
 *    tiene cuenta ni la va a tener: pedirle que se registre para calificar es
 *    garantizar que no califique. El QR de su ticket lleva `orden_id~firma`, y
 *    la firma solo la puede producir quien tiene la clave del local.
 *
 * 2. **El enlace abre UNA cuenta.** No la mesa de al lado, no el corte del día,
 *    no la lista de clientes. Lo que se devuelve es lo que el comensal ya tiene
 *    impreso en su ticket, ni un dato más.
 *
 * 3. **Lo que el comensal escribe es una PETICIÓN, no un hecho.** Su opinión se
 *    guarda —es suya— pero una reserva suya llega como solicitada y la casa
 *    decide. Si apartara mesa sola, cualquiera con el enlace podría bloquear el
 *    salón un viernes desde su teléfono.
 */
import {
  abrirCuenta,
  enlaceVigente,
  importeRenglon,
  proyectarComanda,
  renglonesActivos,
  streamReservas,
  totalesComanda,
  uuidv7,
  type EventoComanda,
  type EventoOpinion,
  type EventoReserva,
} from "@motrest/dominio";
import type { EventoBase } from "@motrest/dominio";

/** Lo que el comensal puede ver de su cuenta: lo que ya trae en el ticket. */
export interface CuentaParaElComensal {
  orden_id: string;
  cerrada_ts?: number;
  /** Qué consumió, con su importe. Sin costos, sin márgenes, sin mesero. */
  renglones: { descripcion: string; cantidad: number; importe: number }[];
  total: number;
  propina: number;
  /** true = ya calificó; el portal no vuelve a preguntar. */
  ya_opino: boolean;
}

export interface DependenciasPortal {
  /** Lee todos los eventos de un stream del registro del Hub. */
  leerStream(streamId: string): Promise<EventoBase[]>;
  /** Mete eventos nuevos al registro y los difunde a las terminales. */
  ingerir(eventos: readonly EventoBase[]): void;
  /** El secreto con que se firman los enlaces, derivado de la clave del local. */
  secreto(): string;
  sucursalId: string;
  ahora?: () => number;
}

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; codigo: number; error: string };

/**
 * Abre la cuenta que el código firma, si el código es bueno y no caducó.
 *
 * Devuelve el mismo error para un código inválido y para uno caducado: decirle
 * a quien prueba códigos que "ese existía pero venció" le confirma que va por
 * buen camino.
 */
async function cuentaDelCodigo(
  codigo: string,
  deps: DependenciasPortal,
): Promise<Resultado<{ ordenId: string; eventos: EventoComanda[] }>> {
  const ordenId = await abrirCuenta(codigo, deps.secreto());
  if (!ordenId) {
    return { ok: false, codigo: 404, error: "Ese código no corresponde a ninguna cuenta" };
  }

  const eventos = (await deps.leerStream(ordenId)) as EventoComanda[];
  if (eventos.length === 0) {
    return { ok: false, codigo: 404, error: "Ese código no corresponde a ninguna cuenta" };
  }

  const comanda = proyectarComanda(eventos);
  const ahora = (deps.ahora ?? Date.now)();

  // Solo se abre una cuenta YA COBRADA: mientras la mesa está en servicio, lo
  // que se ve todavía puede cambiar y no hay nada que calificar.
  if (!comanda.cerrada || comanda.cerrada_ts === undefined) {
    return { ok: false, codigo: 404, error: "Ese código no corresponde a ninguna cuenta" };
  }
  if (!enlaceVigente(comanda.cerrada_ts, ahora)) {
    return { ok: false, codigo: 404, error: "Ese código no corresponde a ninguna cuenta" };
  }

  return { ok: true, datos: { ordenId, eventos } };
}

/** El resumen de su cuenta, para que se reconozca antes de calificar. */
export async function verCuenta(
  codigo: string,
  deps: DependenciasPortal,
  opiniones: readonly EventoOpinion[],
): Promise<Resultado<CuentaParaElComensal>> {
  const abierta = await cuentaDelCodigo(codigo, deps);
  if (!abierta.ok) return abierta;

  const comanda = proyectarComanda(abierta.datos.eventos);
  const totales = totalesComanda(comanda);

  return {
    ok: true,
    datos: {
      orden_id: comanda.orden_id,
      cerrada_ts: comanda.cerrada_ts,
      renglones: renglonesActivos(comanda).map((r) => ({
        descripcion: r.descripcion,
        cantidad: r.cantidad,
        importe: importeRenglon(r),
      })),
      total: totales.total,
      propina: totales.propina,
      ya_opino: opiniones.some((o) => o.orden_id === comanda.orden_id),
    },
  };
}

export interface OpinionDelComensal {
  calificacion: "bien" | "regular" | "mal";
  motivos?: string[];
  comentario?: string;
}

/**
 * Registra la opinión de quien comió.
 *
 * El `empleado_id` del evento queda como `comensal`, no como el mesero que
 * cobró. Es el punto entero del cambio: antes la encuesta la tecleaba el mesero
 * y por eso casi nunca salía "mal". Ahora se puede distinguir en la bitácora
 * qué opinión vino de la mesa y cuál de la casa.
 */
export async function registrarOpinion(
  codigo: string,
  opinion: OpinionDelComensal,
  deps: DependenciasPortal,
  opinionesPrevias: readonly EventoOpinion[],
): Promise<Resultado<{ registrada: true }>> {
  const abierta = await cuentaDelCodigo(codigo, deps);
  if (!abierta.ok) return abierta;

  const { ordenId } = abierta.datos;

  // Una cuenta se califica una vez. Sin esto, quien tenga el enlace puede
  // mandar cien opiniones y torcer el promedio del mesero que le tocó.
  if (opinionesPrevias.some((o) => o.orden_id === ordenId)) {
    return { ok: false, codigo: 409, error: "Esta cuenta ya tiene una opinión" };
  }

  if (!["bien", "regular", "mal"].includes(opinion.calificacion)) {
    return { ok: false, codigo: 400, error: "Calificación no válida" };
  }

  const ahora = (deps.ahora ?? Date.now)();
  deps.ingerir([
    {
      id: uuidv7(),
      tipo: "opinion_registrada",
      stream_id: `opiniones:${deps.sucursalId}`,
      sucursal_id: deps.sucursalId,
      device_id: "portal",
      empleado_id: "comensal",
      ts: ahora,
      orden_local: 0,
      v: 1,
      opinion_id: uuidv7(),
      orden_id: ordenId,
      calificacion: opinion.calificacion,
      motivos: opinion.calificacion === "bien" ? [] : (opinion.motivos ?? []),
      comentario: opinion.comentario?.trim()?.slice(0, 500) || undefined,
    } as unknown as EventoBase,
  ]);

  return { ok: true, datos: { registrada: true } };
}

export interface ReservaDelComensal {
  nombre: string;
  telefono?: string;
  personas: number;
  para_ts: number;
}

/**
 * Toma una solicitud de reserva.
 *
 * NO aparta mesa: nace SOLICITADA y la casa confirma. Es la diferencia entre un
 * portal útil y un portal con el que cualquiera bloquea el salón entero de un
 * viernes desde su teléfono, sin haber pisado nunca el restaurante.
 *
 * Este es el único punto del portal donde no hace falta el enlace de una
 * cuenta: alguien que nunca ha venido también quiere reservar.
 */
export function solicitarReserva(
  peticion: ReservaDelComensal,
  deps: DependenciasPortal,
): Resultado<{ solicitada: true }> {
  const nombre = peticion.nombre?.trim() ?? "";
  const ahora = (deps.ahora ?? Date.now)();

  if (nombre.length < 2 || nombre.length > 80) {
    return { ok: false, codigo: 400, error: "Escribe a nombre de quién va la reserva" };
  }
  if (!Number.isInteger(peticion.personas) || peticion.personas < 1 || peticion.personas > 40) {
    return { ok: false, codigo: 400, error: "¿Cuántas personas vienen?" };
  }
  if (!Number.isFinite(peticion.para_ts) || peticion.para_ts < ahora) {
    return { ok: false, codigo: 400, error: "La fecha ya pasó" };
  }
  // Más de tres meses adelante no es una reserva, es ruido en la agenda.
  if (peticion.para_ts > ahora + 90 * 24 * 60 * 60 * 1000) {
    return { ok: false, codigo: 400, error: "Solo se puede reservar con tres meses de plazo" };
  }

  deps.ingerir([
    {
      id: uuidv7(),
      tipo: "reserva_creada",
      stream_id: streamReservas(deps.sucursalId),
      sucursal_id: deps.sucursalId,
      device_id: "portal",
      empleado_id: "comensal",
      ts: ahora,
      orden_local: 0,
      v: 1,
      reserva_id: uuidv7(),
      nombre,
      telefono: peticion.telefono?.trim()?.slice(0, 20) || undefined,
      personas: peticion.personas,
      para_ts: peticion.para_ts,
      origen: "comensal",
    } as unknown as EventoBase,
  ]);

  return { ok: true, datos: { solicitada: true } };
}

export type { EventoReserva };
