/**
 * Varios locales bajo una misma dirección (F4).
 *
 * LA DECISIÓN QUE GOBIERNA TODO ESTO: CADA LOCAL SIGUE SIENDO AUTÓNOMO.
 *
 * Un grupo de tres restaurantes no es un restaurante grande. Cada local tiene su
 * Hub, su registro, su caja y su gente, y **sigue vendiendo aunque los demás se
 * caigan o aunque no haya internet entre ellos**. Eso no se negocia: es lo que
 * hace que MotRest sirva en México y es lo que un sistema centralizado pierde el
 * día que se cae el enlace.
 *
 * Lo multisucursal, entonces, NO es una base de datos compartida. Es una capa de
 * LECTURA que junta lo que cada local ya calculó por su cuenta:
 *
 *   Local 1 ──┐
 *   Local 2 ──┼──> consolidado (solo lectura, y puede ir incompleto)
 *   Local 3 ──┘
 *
 * QUE PUEDA IR INCOMPLETO ES LA PARTE IMPORTANTE. Si un local no reportó hoy
 * —se le fue la luz, se quedó sin internet— el consolidado tiene que DECIRLO, no
 * sumar lo que tiene y presentarlo como el total del grupo. Un número que parece
 * completo y no lo está es peor que un hueco visible: con el hueco se pregunta;
 * con el número falso se decide.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

/** Un local del grupo. */
export interface Sucursal {
  id: ID;
  nombre: string;
  /** "Zapopan", "Centro". Para leer un reporte sin memorizar ids. */
  plaza?: string;
  activa: boolean;
}

/**
 * Lo que un local reporta de una jornada.
 *
 * Son cifras YA CALCULADAS por su propio Hub, no eventos crudos. Mandar el log
 * entero de cada local a un servidor central sería exactamente el sistema
 * centralizado que se está evitando: caro, lento y con toda la operación del
 * grupo en un solo sitio que robar.
 */
export interface ReporteDeSucursal {
  sucursal_id: ID;
  /** Jornada a la que corresponde, como el inicio de su día operativo. */
  dia: number;
  /** Cuándo lo mandó. Con esto se sabe si está fresco o viejo. */
  reportado_ts: number;
  ventas: Centavos;
  cuentas: number;
  propinas: Centavos;
  costo: Centavos;
  descuentos: Centavos;
  /** Efectivo que debería haber en su cajón al cerrar. */
  efectivo_esperado: Centavos;
  /** Diferencia del arqueo. Negativa = faltó. */
  diferencia_arqueo?: Centavos;
}

export interface RenglonConsolidado extends ReporteDeSucursal {
  nombre: string;
  ticket_promedio: Centavos;
  /** Margen sobre la venta, como fracción. */
  margen: number;
}

export interface Consolidado {
  dia: number;
  renglones: RenglonConsolidado[];
  ventas: Centavos;
  cuentas: number;
  propinas: Centavos;
  costo: Centavos;
  ticket_promedio: Centavos;
  margen: number;
  /**
   * Locales activos que NO reportaron esta jornada.
   *
   * Es el dato más importante de esta pantalla: dice cuánto NO se está viendo.
   */
  sin_reportar: { sucursal_id: ID; nombre: string }[];
  /** true = están todos. Solo entonces el total es el total. */
  completo: boolean;
}

/** Después de esto, un reporte es de una jornada que ya cerró y no va a cambiar. */
const FRESCURA_MS = 36 * 60 * 60 * 1000;

/**
 * Junta lo que reportó cada local en una jornada.
 *
 * Los locales que faltan se listan aparte en vez de asumirse en cero: un local
 * que vendió $40 000 y no reportó no es un local que vendió cero.
 */
export function consolidar(
  sucursales: readonly Sucursal[],
  reportes: readonly ReporteDeSucursal[],
  dia: number,
): Consolidado {
  const activas = sucursales.filter((s) => s.activa);
  const porId = new Map(activas.map((s) => [s.id, s]));

  const delDia = reportes.filter((r) => r.dia === dia && porId.has(r.sucursal_id));

  /*
   * Si un local reportó dos veces la misma jornada —reintentó tras una caída—
   * manda el más reciente. Sumar los dos duplicaría la venta del grupo.
   */
  const ultimoPorSucursal = new Map<ID, ReporteDeSucursal>();
  for (const r of delDia) {
    const previo = ultimoPorSucursal.get(r.sucursal_id);
    if (!previo || r.reportado_ts > previo.reportado_ts) {
      ultimoPorSucursal.set(r.sucursal_id, r);
    }
  }

  const renglones: RenglonConsolidado[] = [...ultimoPorSucursal.values()]
    .map((r) => ({
      ...r,
      nombre: porId.get(r.sucursal_id)?.nombre ?? r.sucursal_id,
      ticket_promedio: (r.cuentas > 0 ? Math.round(r.ventas / r.cuentas) : 0) as Centavos,
      margen: r.ventas > 0 ? (r.ventas - r.costo) / r.ventas : 0,
    }))
    .sort((a, b) => b.ventas - a.ventas);

  const ventas = sumar(...renglones.map((r) => r.ventas));
  const costo = sumar(...renglones.map((r) => r.costo));
  const cuentas = renglones.reduce((n, r) => n + r.cuentas, 0);

  const sinReportar = activas
    .filter((s) => !ultimoPorSucursal.has(s.id))
    .map((s) => ({ sucursal_id: s.id, nombre: s.nombre }));

  return {
    dia,
    renglones,
    ventas,
    cuentas,
    propinas: sumar(...renglones.map((r) => r.propinas)),
    costo,
    ticket_promedio: (cuentas > 0 ? Math.round(ventas / cuentas) : 0) as Centavos,
    margen: ventas > 0 ? (ventas - costo) / ventas : 0,
    sin_reportar: sinReportar,
    completo: sinReportar.length === 0,
  };
}

export type EstadoSucursal =
  /** Reportó esta jornada. */
  | "al_dia"
  /** No ha reportado la jornada en curso, pero todavía es pronto. */
  | "esperando"
  /** Lleva más de un día sin reportar: algo pasa. */
  | "sin_señal";

export interface SaludDelGrupo {
  sucursal_id: ID;
  nombre: string;
  estado: EstadoSucursal;
  /** Último reporte recibido, si hubo alguno. */
  ultimo_ts?: number;
  /** Diferencia de arqueo del último día. Sirve para verlas juntas. */
  ultima_diferencia?: Centavos;
}

/**
 * Cómo está cada local ahora mismo.
 *
 * Es lo primero que mira un dueño con varios restaurantes por la mañana, y la
 * pregunta no es "cuánto vendimos": es **cuál de mis locales tiene un problema**.
 * Un local sin señal puede ser internet, puede ser que no abrieron, o puede ser
 * que la caja lleve dos días sin cerrarse. Las tres hay que ir a verlas.
 */
export function saludDelGrupo(
  sucursales: readonly Sucursal[],
  reportes: readonly ReporteDeSucursal[],
  ahora = Date.now(),
): SaludDelGrupo[] {
  return sucursales
    .filter((s) => s.activa)
    .map((s) => {
      const suyos = reportes
        .filter((r) => r.sucursal_id === s.id)
        .sort((a, b) => b.reportado_ts - a.reportado_ts);
      const ultimo = suyos[0];

      if (!ultimo) {
        return { sucursal_id: s.id, nombre: s.nombre, estado: "sin_señal" as const };
      }

      const antiguedad = ahora - ultimo.reportado_ts;
      return {
        sucursal_id: s.id,
        nombre: s.nombre,
        estado: antiguedad > FRESCURA_MS ? ("sin_señal" as const) : ("al_dia" as const),
        ultimo_ts: ultimo.reportado_ts,
        ultima_diferencia: ultimo.diferencia_arqueo,
      };
    })
    .sort((a, b) => {
      // Primero lo que hay que ir a ver.
      const orden: Record<EstadoSucursal, number> = { sin_señal: 0, esperando: 1, al_dia: 2 };
      return orden[a.estado] - orden[b.estado];
    });
}

export interface Comparativa {
  sucursal_id: ID;
  nombre: string;
  ventas: Centavos;
  /** Cuánto aporta al total del grupo, como fracción. */
  participacion: number;
  ticket_promedio: Centavos;
  margen: number;
}

/**
 * Cómo va cada local contra los demás.
 *
 * Se compara TICKET PROMEDIO y MARGEN, no solo venta: un local en una plaza
 * chica que vende la mitad pero con mejor margen lo está haciendo mejor que uno
 * grande que factura mucho y no deja nada. Ordenar por venta sola premia al
 * local con más tráfico y esconde al que de verdad opera bien.
 */
export function compararSucursales(consolidado: Consolidado): Comparativa[] {
  return consolidado.renglones.map((r) => ({
    sucursal_id: r.sucursal_id,
    nombre: r.nombre,
    ventas: r.ventas,
    participacion: consolidado.ventas > 0 ? r.ventas / consolidado.ventas : 0,
    ticket_promedio: r.ticket_promedio,
    margen: r.margen,
  }));
}

/** El stream donde vive el padrón de sucursales de un grupo. */
export function streamOrganizacion(grupo_id: ID): ID {
  return `organizacion:${grupo_id}`;
}

/** Reporte vacío: un local que abrió y no vendió nada todavía. */
export function reporteVacio(sucursal_id: ID, dia: number): ReporteDeSucursal {
  return {
    sucursal_id,
    dia,
    reportado_ts: Date.now(),
    ventas: CERO,
    cuentas: 0,
    propinas: CERO,
    costo: CERO,
    descuentos: CERO,
    efectivo_esperado: CERO,
  };
}
