/**
 * Proyecciones de compras: proveedores, órdenes y su recepción.
 *
 * Como todo el dominio, funciones puras sobre el log. Lo que aquí se decide y
 * que no es obvio: una orden se da por RECIBIDA cuando llegó al menos lo
 * pedido de cada línea, no cuando cuadra exacto. Un proveedor que manda 10.2 kg
 * de un pedido de 10 no deja la orden abierta para siempre.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { Insumo } from "../inventario/insumos.js";
import type { EventoCompra, LineaCompra, LineaRecibida } from "./eventos.js";

// --- Proveedores -------------------------------------------------------------------------

export interface Proveedor {
  proveedor_id: ID;
  nombre: string;
  rfc?: string;
  contacto?: string;
  telefono?: string;
  activo: boolean;
}

export function proyectarProveedores(eventos: readonly EventoCompra[]): Proveedor[] {
  const porId = new Map<ID, Proveedor>();

  for (const ev of eventos) {
    if (ev.tipo === "proveedor_registrado") {
      // Idempotente: reaplicar el alta no duplica ni pisa lo ya editado.
      if (porId.has(ev.proveedor_id)) continue;
      porId.set(ev.proveedor_id, {
        proveedor_id: ev.proveedor_id,
        nombre: ev.nombre,
        rfc: ev.rfc,
        contacto: ev.contacto,
        telefono: ev.telefono,
        activo: true,
      });
    } else if (ev.tipo === "proveedor_actualizado") {
      const previo = porId.get(ev.proveedor_id);
      if (previo) porId.set(ev.proveedor_id, { ...previo, ...ev.cambios });
    } else if (ev.tipo === "proveedor_desactivado") {
      const previo = porId.get(ev.proveedor_id);
      if (previo) porId.set(ev.proveedor_id, { ...previo, activo: false });
    }
  }

  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// --- Órdenes de compra -------------------------------------------------------------------

export type EstadoOrden = "abierta" | "parcial" | "recibida" | "cancelada";

export interface OrdenCompra {
  orden_id: ID;
  proveedor_id: ID;
  lineas: LineaCompra[];
  /** Cuánto se ha recibido de cada insumo, acumulado entre entregas. */
  recibido: Record<ID, number>;
  /** Lo que realmente se pagó, acumulado por lo recibido. */
  costo_recibido: Centavos;
  estado: EstadoOrden;
  folios_proveedor: string[];
  motivo_cancelacion?: string;
  empleado_id: ID;
  creada_ts: number;
}

/** Total estimado de una orden, a los costos pactados. */
export function totalOrden(lineas: readonly LineaCompra[]): Centavos {
  return sumar(...lineas.map((l) => Math.round(l.cantidad * l.costo_unitario) as Centavos));
}

/**
 * ¿Ya llegó todo?
 *
 * Se compara contra lo pedido con tolerancia hacia arriba: recibir de más
 * cierra la línea. Exigir exactitud dejaría órdenes abiertas eternamente por
 * doscientos gramos de diferencia.
 */
function estaCompleta(orden: OrdenCompra): boolean {
  return orden.lineas.every((l) => (orden.recibido[l.insumo_id] ?? 0) >= l.cantidad);
}

function algoRecibido(orden: OrdenCompra): boolean {
  return Object.values(orden.recibido).some((c) => c > 0);
}

export function proyectarOrdenes(eventos: readonly EventoCompra[]): OrdenCompra[] {
  const porId = new Map<ID, OrdenCompra>();

  for (const ev of eventos) {
    if (ev.tipo === "orden_compra_creada") {
      if (porId.has(ev.orden_id)) continue;
      porId.set(ev.orden_id, {
        orden_id: ev.orden_id,
        proveedor_id: ev.proveedor_id,
        lineas: ev.lineas,
        recibido: {},
        costo_recibido: CERO,
        estado: "abierta",
        folios_proveedor: [],
        empleado_id: ev.empleado_id,
        creada_ts: ev.ts,
      });
    } else if (ev.tipo === "orden_compra_recibida") {
      const orden = porId.get(ev.orden_id);
      if (!orden || orden.estado === "cancelada") continue;

      const recibido = { ...orden.recibido };
      let costo = orden.costo_recibido;
      for (const linea of ev.recibidas) {
        recibido[linea.insumo_id] = (recibido[linea.insumo_id] ?? 0) + linea.cantidad;
        costo = sumar(costo, Math.round(linea.cantidad * linea.costo_unitario) as Centavos);
      }

      const actualizada: OrdenCompra = {
        ...orden,
        recibido,
        costo_recibido: costo,
        folios_proveedor: ev.folio_proveedor
          ? [...orden.folios_proveedor, ev.folio_proveedor]
          : orden.folios_proveedor,
        estado: "abierta",
      };
      actualizada.estado = estaCompleta(actualizada)
        ? "recibida"
        : algoRecibido(actualizada)
          ? "parcial"
          : "abierta";
      porId.set(ev.orden_id, actualizada);
    } else if (ev.tipo === "orden_compra_cancelada") {
      const orden = porId.get(ev.orden_id);
      // Una orden ya recibida no se cancela: la mercancía está en el almacén.
      if (!orden || orden.estado === "recibida") continue;
      porId.set(ev.orden_id, { ...orden, estado: "cancelada", motivo_cancelacion: ev.motivo });
    }
  }

  return [...porId.values()].sort((a, b) => b.creada_ts - a.creada_ts);
}

/** Lo que falta por llegar de una orden, línea por línea. */
export function pendienteDe(orden: OrdenCompra): { insumo_id: ID; cantidad: number }[] {
  if (orden.estado === "cancelada" || orden.estado === "recibida") return [];
  return orden.lineas
    .map((l) => ({ insumo_id: l.insumo_id, cantidad: l.cantidad - (orden.recibido[l.insumo_id] ?? 0) }))
    .filter((p) => p.cantidad > 0);
}

/** Órdenes que siguen esperando mercancía. */
export function ordenesAbiertas(ordenes: readonly OrdenCompra[]): OrdenCompra[] {
  return ordenes.filter((o) => o.estado === "abierta" || o.estado === "parcial");
}

// --- De "por reponer" a una orden ---------------------------------------------------------

export interface SugerenciaCompra extends LineaCompra {
  nombre: string;
  /** Lo que hay hoy en el almacén. */
  existencia: number;
  stock_minimo: number;
}

/**
 * Convierte la lista de "por reponer" en líneas de compra.
 *
 * Pide lo que falta para llegar al mínimo, no el mínimo entero: si hay 3 kg y
 * el mínimo son 10, se piden 7. Comprar 10 encima de los 3 que ya están es
 * cómo se llena una cámara de producto que caduca.
 *
 * Se descuenta lo que ya viene en camino en órdenes abiertas: sin eso, cada
 * revisión generaría otra orden del mismo faltante hasta acumular cuatro.
 */
export function sugerirCompra(
  faltantes: readonly { insumo: Insumo; cantidad: number; faltante: number }[],
  ordenesEnCamino: readonly OrdenCompra[] = [],
): SugerenciaCompra[] {
  const enCamino = new Map<ID, number>();
  for (const orden of ordenesAbiertas(ordenesEnCamino)) {
    for (const p of pendienteDe(orden)) {
      enCamino.set(p.insumo_id, (enCamino.get(p.insumo_id) ?? 0) + p.cantidad);
    }
  }

  return faltantes
    .map(({ insumo, cantidad, faltante }) => ({
      insumo_id: insumo.id,
      nombre: insumo.nombre,
      existencia: cantidad,
      stock_minimo: insumo.stock_minimo,
      cantidad: faltante - (enCamino.get(insumo.id) ?? 0),
      costo_unitario: insumo.costo_unitario,
    }))
    .filter((s) => s.cantidad > 0);
}

// --- Recepción → almacén ------------------------------------------------------------------

export interface MovimientoDeRecepcion {
  insumo_id: ID;
  delta: number;
  referencia: string;
  nota?: string;
}

/**
 * Los movimientos de almacén que produce una recepción.
 *
 * El dominio dice QUÉ mover; quien tenga la fábrica de eventos los emite. La
 * referencia lleva la orden, para que un conteo que no cuadre se pueda rastrear
 * hasta la entrega que lo causó.
 */
export function movimientosDeRecepcion(
  ordenId: ID,
  recibidas: readonly LineaRecibida[],
): MovimientoDeRecepcion[] {
  return recibidas
    .filter((l) => l.cantidad > 0)
    .map((l) => ({
      insumo_id: l.insumo_id,
      delta: l.cantidad,
      referencia: ordenId,
      nota: l.nota,
    }));
}

export function etiquetaEstadoOrden(estado: EstadoOrden): string {
  switch (estado) {
    case "abierta":
      return "Pedida";
    case "parcial":
      return "Recibida a medias";
    case "recibida":
      return "Recibida";
    case "cancelada":
      return "Cancelada";
  }
}
