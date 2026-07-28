/**
 * Voz del cliente (capacidad C4): qué le pareció al comensal, y por qué.
 *
 * ALCANCE HONESTO
 *
 * La versión completa de esta capacidad escucha también los canales de afuera
 * —reseñas, WhatsApp, redes—. Eso es F3 y depende de infraestructura fuera del
 * local. Lo que SÍ se puede hacer hoy, sin prometer nada que no exista, es
 * capturar la opinión donde ya hay una conversación: al cobrar la cuenta, el
 * mesero pregunta y registra. Treinta segundos por mesa.
 *
 * LO QUE HACE QUE ESTO VALGA LA PENA
 *
 * Una encuesta suelta dice «7.8 de calificación» y no sirve para nada. Lo que
 * sirve es CRUZARLA con lo que el sistema ya sabe de esa mesa: cuánto esperó,
 * quién la atendió, a qué hora fue. De ahí salen frases accionables —«las mesas
 * que esperaron más de 25 minutos calificaron la mitad de bien»— que se pueden
 * comprobar y corregir. Ese cruce es lo que un cuadernito de comentarios no
 * puede dar.
 */
import type { ID } from "../comun/ids.js";
import { compararEventos, type EventoBase } from "../evento.js";

/**
 * Escala de tres, no de diez.
 *
 * El mesero la va a capturar de pie, con el datáfono en la otra mano. Tres
 * botones grandes se contestan; una escala de diez se contesta «8» siempre y el
 * dato deja de significar algo.
 */
export type Calificacion = "bien" | "regular" | "mal";

export const CALIFICACIONES: { valor: Calificacion; etiqueta: string; peso: number }[] = [
  { valor: "bien", etiqueta: "Bien", peso: 100 },
  { valor: "regular", etiqueta: "Regular", peso: 50 },
  { valor: "mal", etiqueta: "Mal", peso: 0 },
];

/** En qué estuvo el problema. Se marca solo cuando algo salió mal. */
export type MotivoOpinion = "comida" | "servicio" | "tiempo" | "precio" | "limpieza";

export const MOTIVOS_OPINION: { valor: MotivoOpinion; etiqueta: string }[] = [
  { valor: "comida", etiqueta: "La comida" },
  { valor: "servicio", etiqueta: "La atención" },
  { valor: "tiempo", etiqueta: "La espera" },
  { valor: "precio", etiqueta: "El precio" },
  { valor: "limpieza", etiqueta: "La limpieza" },
];

export type EventoOpinion = EventoBase & {
  tipo: "opinion_registrada";
  opinion_id: ID;
  /** La cuenta a la que se refiere: es lo que permite cruzarla con la operación. */
  orden_id: ID;
  calificacion: Calificacion;
  /** Qué falló. Vacío cuando la calificación es buena. */
  motivos: MotivoOpinion[];
  comentario?: string;
  /** Cliente identificado, si lo hay. */
  cliente_id?: ID;
};

export function streamOpiniones(sucursal_id: ID): ID {
  return `opiniones:${sucursal_id}`;
}

export interface Opinion {
  opinion_id: ID;
  orden_id: ID;
  calificacion: Calificacion;
  motivos: MotivoOpinion[];
  comentario?: string;
  cliente_id?: ID;
  /** Quién la capturó. */
  empleado_id: ID;
  ts: number;
}

export function proyectarOpiniones(eventos: readonly EventoOpinion[]): Opinion[] {
  const porId = new Map<ID, Opinion>();
  /*
   * Se ordena con el comparador canónico y se devuelve al revés, en vez de
   * ordenar por `ts` al final: dos capturas del mismo milisegundo -que pasa,
   * porque el mesero cierra dos mesas seguidas- no se desempatan por hora. El
   * comparador usa `orden_local`, que existe justo para eso (ADR-17).
   */
  for (const ev of [...eventos].sort(compararEventos)) {
    // Una sola opinión por captura; reaplicarla no duplica.
    if (porId.has(ev.opinion_id)) continue;
    porId.set(ev.opinion_id, {
      opinion_id: ev.opinion_id,
      orden_id: ev.orden_id,
      calificacion: ev.calificacion,
      motivos: ev.motivos,
      comentario: ev.comentario,
      cliente_id: ev.cliente_id,
      empleado_id: ev.empleado_id,
      ts: ev.ts,
    });
  }
  return [...porId.values()].reverse();
}

// --- Resumen -------------------------------------------------------------------------------

export interface ResumenOpiniones {
  total: number;
  bien: number;
  regular: number;
  mal: number;
  /** Promedio ponderado 0–100. `null` cuando todavía no hay ninguna. */
  indice: number | null;
  /** Motivos de queja, del más repetido al menos. */
  quejas: { motivo: MotivoOpinion; veces: number }[];
}

export function resumirOpiniones(opiniones: readonly Opinion[]): ResumenOpiniones {
  const cuenta = { bien: 0, regular: 0, mal: 0 };
  const quejas = new Map<MotivoOpinion, number>();

  for (const o of opiniones) {
    cuenta[o.calificacion] += 1;
    for (const m of o.motivos) quejas.set(m, (quejas.get(m) ?? 0) + 1);
  }

  const total = opiniones.length;
  const suma = opiniones.reduce(
    (n, o) => n + (CALIFICACIONES.find((c) => c.valor === o.calificacion)?.peso ?? 0),
    0,
  );

  return {
    total,
    ...cuenta,
    indice: total > 0 ? Math.round(suma / total) : null,
    quejas: [...quejas.entries()]
      .map(([motivo, veces]) => ({ motivo, veces }))
      .sort((a, b) => b.veces - a.veces),
  };
}

// --- El cruce que hace útil la capacidad -----------------------------------------------------

/** Una cuenta con su espera real, para cruzarla con lo que opinó el comensal. */
export interface EsperaDeCuenta {
  orden_id: ID;
  /** Minutos del envío a cocina hasta la entrega del último platillo. */
  minutos: number;
}

export interface EfectoEspera {
  /** Cuentas que esperaron hasta el umbral. */
  rapidas: ResumenOpiniones;
  /** Cuentas que esperaron más del umbral. */
  lentas: ResumenOpiniones;
  umbral_min: number;
  /**
   * Cuánto cae el índice de satisfacción al pasar el umbral, en puntos.
   * `null` cuando falta alguno de los dos grupos y la comparación no significa nada.
   */
  caida: number | null;
}

/**
 * ¿La espera está costando satisfacción?
 *
 * Parte las opiniones en dos grupos por el tiempo que de verdad esperó cada
 * mesa —dato que ya está en el log, no hay que preguntarlo— y compara. Si el
 * grupo lento califica peor, ahí hay un problema medible y con dueño.
 *
 * Cuando falta uno de los dos grupos NO se inventa una conclusión: se devuelve
 * `caida: null`. Comparar contra un grupo vacío daría una cifra dramática y sin
 * sentido, que es exactamente como se pierde la confianza en un tablero.
 */
export function efectoDeLaEspera(
  opiniones: readonly Opinion[],
  esperas: readonly EsperaDeCuenta[],
  umbralMin = 25,
): EfectoEspera {
  const porOrden = new Map(esperas.map((e) => [e.orden_id, e.minutos]));
  const rapidas: Opinion[] = [];
  const lentas: Opinion[] = [];

  for (const o of opiniones) {
    const minutos = porOrden.get(o.orden_id);
    // Sin dato de espera no se clasifica: adivinarlo sesgaría la comparación.
    if (minutos === undefined) continue;
    (minutos > umbralMin ? lentas : rapidas).push(o);
  }

  const rr = resumirOpiniones(rapidas);
  const rl = resumirOpiniones(lentas);

  return {
    rapidas: rr,
    lentas: rl,
    umbral_min: umbralMin,
    caida: rr.indice !== null && rl.indice !== null ? rr.indice - rl.indice : null,
  };
}

/** Satisfacción por mesero, para el acompañamiento del equipo. */
export function opinionesPorMesero(
  opiniones: readonly Opinion[],
  meseroDe: (ordenId: ID) => ID | undefined,
): { mesero_id: ID; resumen: ResumenOpiniones }[] {
  const porMesero = new Map<ID, Opinion[]>();

  for (const o of opiniones) {
    const mesero = meseroDe(o.orden_id);
    if (!mesero) continue;
    const lista = porMesero.get(mesero) ?? [];
    lista.push(o);
    porMesero.set(mesero, lista);
  }

  return [...porMesero.entries()]
    .map(([mesero_id, suyas]) => ({ mesero_id, resumen: resumirOpiniones(suyas) }))
    .sort((a, b) => (b.resumen.indice ?? 0) - (a.resumen.indice ?? 0));
}

/**
 * Cuánto esperó cada cuenta, del envío a cocina a la entrega del último platillo.
 *
 * Sale de los sellos que el KDS ya registra; no hay nada que capturar aparte.
 * Las cuentas donde falta algún sello —no se mandó a cocina, o se cobró sin
 * marcar la entrega— se omiten en vez de inventarles un tiempo.
 */
export function esperasDeCuentas(
  comandas: readonly {
    orden_id: ID;
    renglones: readonly { enviado_ts?: number; entregado_ts?: number }[];
  }[],
): EsperaDeCuenta[] {
  const esperas: EsperaDeCuenta[] = [];

  for (const c of comandas) {
    const envios = c.renglones.map((r) => r.enviado_ts).filter((t): t is number => t !== undefined);
    const entregas = c.renglones
      .map((r) => r.entregado_ts)
      .filter((t): t is number => t !== undefined);
    if (envios.length === 0 || entregas.length === 0) continue;

    // Del primer envío a la última entrega: es lo que vivió la mesa.
    const minutos = Math.round((Math.max(...entregas) - Math.min(...envios)) / 60_000);
    if (minutos >= 0) esperas.push({ orden_id: c.orden_id, minutos });
  }

  return esperas;
}
