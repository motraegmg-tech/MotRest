/**
 * Compras (M4): proveedores y órdenes de compra.
 *
 * Cierra el circuito del inventario. Hasta ahora el almacén sabía lo que SALÍA
 * —consumo por receta, mermas— pero lo que entraba se cargaba a mano. Aquí se
 * pide a un proveedor y, al recibir, la entrada al almacén se genera sola.
 *
 * Una orden de compra NO mueve el almacén: pedir no es tener. El almacén se
 * mueve al RECIBIR, y solo por lo que de verdad llegó —que casi nunca es
 * exactamente lo que se pidió—.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

export interface LineaCompra {
  insumo_id: ID;
  /** En la unidad base del insumo. */
  cantidad: number;
  /** Costo por unidad base pactado con el proveedor. */
  costo_unitario: Centavos;
}

/** Lo que de verdad llegó de una línea, que puede diferir de lo pedido. */
export interface LineaRecibida extends LineaCompra {
  /** Por qué llegó distinto: "faltaron 2 kg", "vino más caro". */
  nota?: string;
}

export type EventoCompra =
  | (EventoBase & {
      tipo: "proveedor_registrado";
      proveedor_id: ID;
      nombre: string;
      rfc?: string;
      contacto?: string;
      telefono?: string;
    })
  | (EventoBase & {
      tipo: "proveedor_actualizado";
      proveedor_id: ID;
      cambios: { nombre?: string; rfc?: string; contacto?: string; telefono?: string };
    })
  | (EventoBase & {
      /**
       * Se da de baja, no se borra: sus órdenes pasadas siguen apuntando a él y
       * un proveedor sin nombre volvería ilegible el historial de compras.
       */
      tipo: "proveedor_desactivado";
      proveedor_id: ID;
      motivo?: string;
    })
  | (EventoBase & {
      tipo: "orden_compra_creada";
      orden_id: ID;
      proveedor_id: ID;
      lineas: LineaCompra[];
      nota?: string;
    })
  | (EventoBase & {
      /**
       * Llegó mercancía de una orden. Puede ser parcial y puede repetirse: un
       * proveedor entrega en dos viajes con toda normalidad.
       */
      tipo: "orden_compra_recibida";
      orden_id: ID;
      recibidas: LineaRecibida[];
      /** Folio de la factura o remisión del proveedor. */
      folio_proveedor?: string;
      nota?: string;
    })
  | (EventoBase & {
      tipo: "orden_compra_cancelada";
      orden_id: ID;
      motivo: string;
    })
  | EventoEquivalencia;

export type TipoEventoCompra = EventoCompra["tipo"];

/** Stream al que van las compras de una sucursal. */
export function streamCompras(sucursal_id: ID): ID {
  return `compras:${sucursal_id}`;
}

/**
 * Lo que el restaurante le enseña al sistema sobre las facturas de un proveedor.
 *
 * Va en el mismo flujo que las compras porque es parte de la relación con ese
 * proveedor, y porque así viaja a todas las terminales: lo que se enseña en la
 * caja sirve en la tablet de la oficina.
 */
export type EventoEquivalencia = EventoBase & {
  tipo: "equivalencia_aprendida";
  emisor_rfc: string;
  /** Clave o descripción del concepto tal como viene en la factura. */
  clave_proveedor: string;
  insumo_id: ID;
  /**
   * Cuántas unidades base del almacén trae una unidad del proveedor.
   *
   * Es el número que evita el error más caro: el proveedor factura una BOLSA de
   * 5 kg y el almacén lleva gramos. Sin el factor entrarían 5 gramos.
   */
  factor: number;
};
