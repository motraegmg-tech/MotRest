/**
 * Reservas y lista de espera (M7 · F3).
 *
 * El viernes de Rodizio no se pierde por falta de comida: se pierde en la
 * puerta. Llega gente sin reserva, se le dice "unos veinte minutos" porque hay
 * que decir algo, y a los cuarenta se va. Al mismo tiempo hay una mesa apartada
 * para alguien que no llegó y nadie se atreve a darla.
 *
 * ESTO NO ES UNA AGENDA. Una agenda guarda citas. Aquí las dos preguntas que
 * importan se RESPONDEN CON DATOS que ya están en el event log:
 *
 *   1. ¿Puedo apartar esta mesa a esta hora?  → se comprueba contra las demás
 *      reservas y contra la mesa realmente ocupada, en vez de confiar en que
 *      quien anota se acuerde.
 *   2. ¿Cuánto tiene que esperar quien llega sin reserva? → sale de cuánto dura
 *      de verdad una sentada en ESTE local, medida del log. Es la diferencia
 *      entre una promesa y una estimación.
 *
 * Una reserva NO bloquea la mesa por sí sola: el restaurante decide. Lo que el
 * software no puede hacer es callarse que hay un choque.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { EstadoComanda } from "../comanda/reducers.js";

/** Cuánto se aparta una mesa por defecto, si nadie dice otra cosa. */
export const DURACION_RESERVA_MIN = 90;

/** El flujo real de una reserva, y sus dos finales malos. */
export type EstadoReserva =
  | "apartada"
  /** Llegó y se sentó. */
  | "sentada"
  /** Avisó que no viene. */
  | "cancelada"
  /** No avisó y no llegó: es el dato caro, y por eso se distingue de cancelar. */
  | "no_llego";

export type EventoReserva =
  | (EventoBase & {
      tipo: "reserva_creada";
      reserva_id: ID;
      /** A nombre de quién. Un teléfono sin nombre no sirve en la puerta. */
      nombre: string;
      telefono?: string;
      cliente_id?: ID;
      personas: number;
      /** Cuándo llegan, en epoch ms del reloj del dispositivo (ADR-17). */
      para_ts: number;
      duracion_min?: number;
      /** Mesa apartada. Sin ella es una reserva "para cuando lleguen". */
      mesa_id?: ID;
      notas?: string;
    })
  | (EventoBase & {
      tipo: "reserva_sentada";
      reserva_id: ID;
      mesa_id: ID;
      /** La orden que abrió, para poder medir después si el turno se cumplió. */
      orden_id?: ID;
    })
  | (EventoBase & {
      tipo: "reserva_cancelada";
      reserva_id: ID;
      motivo: string;
    })
  | (EventoBase & {
      tipo: "reserva_no_llego";
      reserva_id: ID;
    });

export interface Reserva {
  id: ID;
  nombre: string;
  telefono?: string;
  cliente_id?: ID;
  personas: number;
  para_ts: number;
  duracion_min: number;
  mesa_id?: ID;
  notas?: string;
  estado: EstadoReserva;
  creada_ts: number;
  /** Cuándo se sentó de verdad. Contra `para_ts` da la puntualidad real. */
  sentada_ts?: number;
  motivo_cancelacion?: string;
}

/** El stream de reservas de una sucursal. */
export function streamReservas(sucursal_id: ID): ID {
  return `reservas:${sucursal_id}`;
}

export function proyectarReservas(eventos: readonly EventoReserva[]): Reserva[] {
  const porId = new Map<ID, Reserva>();

  for (const ev of eventos) {
    if (ev.tipo === "reserva_creada") {
      // Reaplicar la creación (una resincronización) no puede pisar el estado
      // que la reserva ya tenga: sería resucitar una cancelada.
      if (porId.has(ev.reserva_id)) continue;
      porId.set(ev.reserva_id, {
        id: ev.reserva_id,
        nombre: ev.nombre,
        telefono: ev.telefono,
        cliente_id: ev.cliente_id,
        personas: ev.personas,
        para_ts: ev.para_ts,
        duracion_min: ev.duracion_min ?? DURACION_RESERVA_MIN,
        mesa_id: ev.mesa_id,
        notas: ev.notas,
        estado: "apartada",
        creada_ts: ev.ts,
      });
      continue;
    }

    const reserva = porId.get(ev.reserva_id);
    if (!reserva) continue;

    switch (ev.tipo) {
      case "reserva_sentada":
        porId.set(ev.reserva_id, {
          ...reserva,
          estado: "sentada",
          mesa_id: ev.mesa_id,
          sentada_ts: ev.ts,
        });
        break;
      case "reserva_cancelada":
        // Una reserva que ya se sentó no se cancela: la gente ya comió.
        if (reserva.estado === "sentada") break;
        porId.set(ev.reserva_id, {
          ...reserva,
          estado: "cancelada",
          motivo_cancelacion: ev.motivo,
        });
        break;
      case "reserva_no_llego":
        if (reserva.estado === "sentada") break;
        porId.set(ev.reserva_id, { ...reserva, estado: "no_llego" });
        break;
    }
  }

  return [...porId.values()].sort((a, b) => a.para_ts - b.para_ts);
}

/** La franja que ocupa una reserva. */
export function franjaDe(reserva: Reserva): { desde: number; hasta: number } {
  return {
    desde: reserva.para_ts,
    hasta: reserva.para_ts + reserva.duracion_min * 60_000,
  };
}

/** Las que siguen en pie: ni canceladas, ni plantadas, ni ya sentadas. */
export function reservasVigentes(reservas: readonly Reserva[]): Reserva[] {
  return reservas.filter((r) => r.estado === "apartada");
}

export interface Choque {
  /** La reserva que ya estaba apartada en esa mesa y esa franja. */
  reserva: Reserva;
  /** Minutos en que las dos franjas se enciman. */
  minutos_encimados: number;
}

/**
 * ¿Esta mesa ya está apartada en esa franja?
 *
 * Se avisa ANTES de anotar. Descubrirlo cuando llegan los dos grupos significa
 * mandar a alguien a esperar de pie con una reserva en la mano, que es la peor
 * forma de perder a un cliente que ya había decidido venir.
 */
export function choquesDeMesa(
  reservas: readonly Reserva[],
  mesaId: ID,
  desde: number,
  duracionMin = DURACION_RESERVA_MIN,
  excluirReservaId?: ID,
): Choque[] {
  const hasta = desde + duracionMin * 60_000;

  return reservasVigentes(reservas)
    .filter((r) => r.mesa_id === mesaId && r.id !== excluirReservaId)
    .map((r) => {
      const f = franjaDe(r);
      const inicio = Math.max(desde, f.desde);
      const fin = Math.min(hasta, f.hasta);
      return { reserva: r, minutos_encimados: Math.round((fin - inicio) / 60_000) };
    })
    .filter((c) => c.minutos_encimados > 0);
}

/**
 * Las reservas que hay que atender ahora: las que ya deberían haber llegado.
 *
 * `tolerancia_min` es la cortesía que da la casa antes de considerar que no
 * llegaron. No se marcan solas como plantadas: liberar una mesa es una decisión
 * de quien está en la puerta, no del reloj.
 */
export function reservasEnPuerta(
  reservas: readonly Reserva[],
  ahora: number,
  toleranciaMin = 15,
): { esperando: Reserva[]; retrasadas: Reserva[] } {
  const vigentes = reservasVigentes(reservas);
  const limite = ahora - toleranciaMin * 60_000;

  return {
    esperando: vigentes.filter((r) => r.para_ts >= limite),
    retrasadas: vigentes.filter((r) => r.para_ts < limite),
  };
}

// --- Cuánto dura de verdad una mesa ------------------------------------------------

export interface RotacionObservada {
  /** Minutos que dura una sentada, de la mediana del histórico. */
  minutos_mediana: number;
  /** Cuántas sentadas se midieron. Sin esto, el número no se puede juzgar. */
  muestras: number;
  /** false = hay tan pocos datos que se está usando el valor por defecto. */
  confiable: boolean;
}

/** Debajo de esto, el promedio de este local todavía no significa nada. */
const MUESTRAS_MINIMAS = 12;

/**
 * Cuánto dura una sentada EN ESTE LOCAL, medido del event log.
 *
 * Es el corazón de la lista de espera. Un "unos veinte minutos" inventado se
 * incumple y quema al cliente; una pizzería con hornos lentos y sobremesa larga
 * no rota igual que una fonda, y ningún valor de fábrica acierta en las dos.
 *
 * Se usa la MEDIANA y no el promedio: una mesa que se quedó cuatro horas
 * celebrando un cumpleaños arrastra el promedio y haría prometer esperas
 * absurdas. La mediana ni se entera.
 */
export function rotacionObservada(
  comandas: readonly EstadoComanda[],
  porDefectoMin = DURACION_RESERVA_MIN,
): RotacionObservada {
  const duraciones = comandas
    .filter((c) => c.cerrada && c.cerrada_ts !== undefined)
    .map((c) => (c.cerrada_ts! - c.abierta_ts) / 60_000)
    // Una sentada de menos de cinco minutos no es una sentada: es una cuenta
    // abierta por error y cerrada enseguida, o una venta de mostrador.
    .filter((min) => min >= 5 && min <= 6 * 60)
    .sort((a, b) => a - b);

  if (duraciones.length < MUESTRAS_MINIMAS) {
    return { minutos_mediana: porDefectoMin, muestras: duraciones.length, confiable: false };
  }

  const medio = Math.floor(duraciones.length / 2);
  const mediana =
    duraciones.length % 2 === 0
      ? (duraciones[medio - 1]! + duraciones[medio]!) / 2
      : duraciones[medio]!;

  return {
    minutos_mediana: Math.round(mediana),
    muestras: duraciones.length,
    confiable: true,
  };
}

export interface EsperaEstimada {
  /** Minutos que hay que decirle a quien llega. */
  minutos: number;
  /** Mesas que le sirven a ese grupo y están ocupadas ahora. */
  mesas_ocupadas: number;
  mesas_libres: number;
  /** false = no hay histórico suficiente; el número es el de fábrica. */
  confiable: boolean;
  /** Cuántos grupos van delante en la lista. */
  delante: number;
}

/**
 * Cuánto tiene que esperar quien llega sin reserva.
 *
 * Si hay mesa libre, cero. Si no, se estima con la rotación real: de las mesas
 * ocupadas, la que lleva más tiempo es la que está por liberarse, y a eso se le
 * suma el turno de quienes ya están formados delante.
 *
 * Devuelve `confiable: false` cuando el local todavía no tiene histórico. Es
 * mejor decir "aproximadamente" que dar una cifra falsa con cara de exacta.
 */
export function esperaEstimada(
  opciones: {
    /** Cuándo se abrió cada mesa que está ocupada ahora. */
    ocupadasDesde: readonly number[];
    mesasLibres: number;
    /** Grupos ya formados delante de este. */
    delante: number;
    rotacion: RotacionObservada;
    ahora: number;
  },
): EsperaEstimada {
  const { ocupadasDesde, mesasLibres, delante, rotacion, ahora } = opciones;

  const base = {
    mesas_ocupadas: ocupadasDesde.length,
    mesas_libres: mesasLibres,
    confiable: rotacion.confiable,
    delante,
  };

  // Hay mesa y no hay cola: pasan de inmediato.
  if (mesasLibres > delante) return { ...base, minutos: 0 };

  if (ocupadasDesde.length === 0) {
    // Sin mesas ocupadas ni libres suficientes no hay nada que medir.
    return { ...base, minutos: rotacion.minutos_mediana };
  }

  /*
   * De las mesas ocupadas, la que lleva más rato es la primera en soltarse.
   * Lo que le falta es la rotación menos lo que ya lleva sentada — nunca menos
   * de cinco minutos, porque hay que levantar, cobrar y limpiar.
   */
  const faltantes = ocupadasDesde
    .map((desde) => Math.max(5, rotacion.minutos_mediana - (ahora - desde) / 60_000))
    .sort((a, b) => a - b);

  // Quien está formado en el lugar N espera a que se liberen N+1 mesas.
  const turno = Math.min(delante, faltantes.length - 1);
  return { ...base, minutos: Math.round(faltantes[turno] ?? rotacion.minutos_mediana) };
}
