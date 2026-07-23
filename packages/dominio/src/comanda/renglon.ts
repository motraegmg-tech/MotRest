/**
 * Renglón de comanda, con SNAPSHOT de precio, costo e impuesto.
 *
 * El snapshot congela las cifras del momento en que se capturó: el ticket, la
 * reimpresión y la factura no dependen de que el catálogo haya cambiado después.
 *
 * ESTADO POR RENGLÓN (no por cuenta): el servicio real manda por tiempos —
 * entradas primero, postre al final— y el KDS necesita cronómetro por platillo
 * para el semáforo. Un booleano de "cuenta enviada" no permite ninguna de las dos.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { TasasSnapshot } from "../comun/impuestos.js";
import type { SeleccionModificador } from "../catalogo/modificadores.js";
import type { PorcionElegida } from "../catalogo/porciones.js";

export type EstadoRenglon =
  | "capturado"
  | "enviado"
  | "en_marcha"
  | "listo"
  | "entregado"
  | "cancelado";

/** Estados que siguen contando para la cuenta (todos menos cancelado). */
export const ESTADOS_ACTIVOS: readonly EstadoRenglon[] = [
  "capturado",
  "enviado",
  "en_marcha",
  "listo",
  "entregado",
];

export interface RenglonComanda {
  id: ID;
  producto_id: ID;
  /** Snapshot del nombre: el ticket no depende del catálogo vivo. */
  descripcion: string;
  /** Detalle legible de la configuración ("½ Margherita · ½ Pepperoni"). */
  detalle?: string;
  cantidad: number;

  /** Snapshot del precio unitario de carta. */
  precio_unitario: Centavos;
  /** Snapshot del costo unitario. */
  costo_unitario: Centavos;
  /** Snapshot de las tasas de impuesto aplicables. */
  impuesto: TasasSnapshot;

  /** Snapshot de la configuración de porciones, si el producto es configurable. */
  porciones?: PorcionElegida[];
  /** Snapshot de los modificadores elegidos (término, extras, sin cebolla…). */
  modificadores?: SeleccionModificador[];
  /** Indicaciones para cocina: "sin tomate", "bien cocido", alergias. */
  notas?: string;
  /**
   * Cuándo cambió la nota DESPUÉS de haberse mandado a cocina.
   *
   * Existe porque cambiarla en silencio no sirve: el cocinero ya leyó el
   * ticket y no vuelve a mirarlo. Con esta marca el KDS puede señalar el
   * renglón como modificado hasta que alguien en cocina lo dé por visto.
   *
   * `undefined` en el caso normal —la nota se puso al capturar—, que es lo que
   * permite distinguir "así se pidió" de "esto cambió sobre la marcha".
   */
  notas_cambiadas_ts?: number;

  estado: EstadoRenglon;
  /** Estación de cocina a la que se ruteó. */
  estacion_id?: ID;
  /** Tiempo del servicio: 1 entrada, 2 fuerte, 3 postre. */
  curso?: number;

  /**
   * Sellos de tiempo del ciclo de producción, tomados del reloj del dispositivo
   * que emitió cada evento. Son los que alimentan los cronómetros del KDS.
   */
  enviado_ts?: number;
  en_marcha_ts?: number;
  listo_ts?: number;
  entregado_ts?: number;
}

/** Minutos transcurridos desde que el platillo salió a cocina. */
export function minutosEnCocina(r: RenglonComanda, ahora: number): number {
  if (!r.enviado_ts) return 0;
  const hasta = r.listo_ts ?? ahora;
  return Math.max(0, Math.floor((hasta - r.enviado_ts) / 60_000));
}

/** Importe de línea (precio × cantidad), antes de impuestos. */
export function importeRenglon(r: RenglonComanda): Centavos {
  return (r.precio_unitario * r.cantidad) as Centavos;
}

/** Costo de línea (costo × cantidad). */
export function costoRenglon(r: RenglonComanda): Centavos {
  return (r.costo_unitario * r.cantidad) as Centavos;
}

export function estaActivo(r: RenglonComanda): boolean {
  return r.estado !== "cancelado";
}

/** ¿Ya salió hacia la cocina? Cancelarlo a partir de aquí exige autorización. */
export function yaEnviado(r: RenglonComanda): boolean {
  return r.estado === "enviado" || r.estado === "en_marcha" || r.estado === "listo" || r.estado === "entregado";
}
