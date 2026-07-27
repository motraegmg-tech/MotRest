/**
 * Clientes (M7): la ficha del comensal, con sus datos fiscales y de domicilio.
 *
 * En F1 es deliberadamente básica —la lealtad, las reservas y el CRM 360° son
 * F3—. Pero resuelve dos fricciones reales de todos los días: un cliente que
 * factura seguido no vuelve a dictar su RFC, código postal y régimen cada vez, y
 * un pedido a domicilio tiene a dónde llegar.
 *
 * El cliente se da de BAJA, no se borra: sus facturas y sus pedidos pasados
 * apuntan a él, y un cliente sin nombre volvería ilegible ese historial.
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { DatosReceptor } from "../fiscal/comprobante.js";

/** Domicilio de entrega. Todo opcional salvo la calle: un pedido necesita a dónde llegar. */
export interface Domicilio {
  calle: string;
  numero?: string;
  colonia?: string;
  codigo_postal?: string;
  ciudad?: string;
  /** "Portón verde, entre Juárez y Morelos". Lo que de verdad encuentra la casa. */
  referencias?: string;
}

/** Lo editable de un cliente. Los datos fiscales son los mismos que pide el CFDI. */
export interface DatosCliente {
  nombre: string;
  telefono?: string;
  correo?: string;
  /** Para prellenar la factura sin volver a teclear la constancia. */
  fiscal?: DatosReceptor;
  domicilio?: Domicilio;
  /** Alergias, preferencias, "siempre pide sin cebolla". La semilla del CRM. */
  notas?: string;
}

export type EventoCliente =
  | (EventoBase & {
      tipo: "cliente_registrado";
      cliente_id: ID;
      datos: DatosCliente;
    })
  | (EventoBase & {
      tipo: "cliente_actualizado";
      cliente_id: ID;
      cambios: Partial<DatosCliente>;
    })
  | (EventoBase & {
      tipo: "cliente_desactivado";
      cliente_id: ID;
      motivo?: string;
    });

export type TipoEventoCliente = EventoCliente["tipo"];

/** Stream al que van los clientes de una sucursal. */
export function streamClientes(sucursal_id: ID): ID {
  return `clientes:${sucursal_id}`;
}
