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
  notas?: string;

  estado: EstadoRenglon;
  /** Estación de cocina a la que se ruteó. */
  estacion_id?: ID;
  /** Tiempo del servicio: 1 entrada, 2 fuerte, 3 postre. */
  curso?: number;
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
