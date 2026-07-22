/**
 * Movimientos de inventario.
 *
 * TRD §5.1: **el stock es la suma de movimientos (deltas), nunca un campo que
 * se sobrescribe.** Dos descuentos simultáneos desde dispositivos distintos no
 * chocan: ambos son hechos y ambos cuentan.
 *
 * El stock negativo **se señala, no bloquea**: si el sistema impidiera vender
 * porque el conteo va atrasado, el restaurante dejaría de facturar por un error
 * de captura. Se avisa y se corrige con un conteo.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { Unidad } from "./insumos.js";

export type MotivoMovimiento =
  | "consumo_receta"
  | "recepcion"
  | "merma"
  | "ajuste_conteo"
  | "traspaso"
  | "produccion"
  | "devolucion";

export interface DefinicionMotivo {
  valor: MotivoMovimiento;
  etiqueta: string;
  /**
   * Hacia dónde mueve el almacén. "ambos" significa que el signo lo decide
   * quien captura: un ajuste puede corregir de más o de menos.
   */
  direccion: "entra" | "sale" | "ambos";
  /** false = lo genera el sistema; nadie lo captura a mano. */
  manual: boolean;
}

export const MOTIVOS: DefinicionMotivo[] = [
  { valor: "consumo_receta", etiqueta: "Consumo por receta", direccion: "sale", manual: false },
  { valor: "recepcion", etiqueta: "Recepción de compra", direccion: "entra", manual: true },
  { valor: "merma", etiqueta: "Merma", direccion: "sale", manual: true },
  { valor: "ajuste_conteo", etiqueta: "Ajuste por conteo", direccion: "ambos", manual: true },
  { valor: "traspaso", etiqueta: "Traspaso entre almacenes", direccion: "sale", manual: true },
  { valor: "produccion", etiqueta: "Producción interna", direccion: "entra", manual: true },
  { valor: "devolucion", etiqueta: "Devolución a proveedor", direccion: "sale", manual: true },
];

/** Los motivos que una persona puede capturar desde el módulo de inventario. */
export const MOTIVOS_MANUALES: DefinicionMotivo[] = MOTIVOS.filter((m) => m.manual);

export function etiquetaMotivo(motivo: MotivoMovimiento): string {
  return MOTIVOS.find((m) => m.valor === motivo)?.etiqueta ?? motivo;
}

/**
 * Convierte una cantidad capturada en el delta con el signo que le toca.
 *
 * La dirección la manda el motivo, no quien teclea: registrar una merma de 500 g
 * siempre resta, aunque se haya escrito en positivo. Solo el ajuste respeta el
 * signo tecleado, porque puede corregir en las dos direcciones.
 */
export function deltaDelMotivo(motivo: MotivoMovimiento, cantidad: number): number {
  const direccion = MOTIVOS.find((m) => m.valor === motivo)?.direccion ?? "ambos";
  if (direccion === "sale") return -Math.abs(cantidad);
  if (direccion === "entra") return Math.abs(cantidad);
  return cantidad;
}

export type EventoInventario =
  | (EventoBase & {
      tipo: "movimiento_inventario";
      insumo_id: ID;
      /** Negativo sale del almacén, positivo entra. En la unidad base del insumo. */
      delta: number;
      unidad: Unidad;
      motivo: MotivoMovimiento;
      /** Evento que lo originó (el envío a cocina, la recepción de compra…). */
      referencia?: string;
      nota?: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      tipo: "conteo_registrado";
      /** Lo que se contó físicamente, por insumo. */
      lineas: { insumo_id: ID; contado: number; esperado: number }[];
      nota?: string;
      autorizador_id?: ID;
    });

export type TipoEventoInventario = EventoInventario["tipo"];

/** Stream de un insumo dentro del almacén. */
export function streamInsumo(insumoId: ID): ID {
  return `insumo:${insumoId}`;
}

/** Stream de los conteos de una sucursal. */
export function streamConteos(sucursalId: ID): ID {
  return `conteo:${sucursalId}`;
}
