/**
 * Store de compras (M4).
 *
 * Cierra el circuito del almacén: hasta ahora el inventario sabía lo que salía
 * y lo que entraba se cargaba a mano. Aquí se pide y, al recibir, la entrada al
 * almacén se genera sola —con la orden como referencia, para que un conteo que
 * no cuadre se pueda rastrear hasta la entrega que lo causó—.
 */
import {
  FabricaEventos,
  compararEventos,
  movimientosDeRecepcion,
  ordenesAbiertas,
  proyectarOrdenes,
  proyectarProveedores,
  streamCompras,
  sugerirCompra,
  uuidv7,
  type EventoCompra,
  type ID,
  type Insumo,
  type LineaCompra,
  type LineaRecibida,
  type OrdenCompra,
  type Proveedor,
  type SugerenciaCompra,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { inventario } from "./inventario.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

class StoreCompras {
  private eventos = $state.raw<EventoCompra[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoCompra>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  proveedores = $derived(proyectarProveedores(this.eventos));
  ordenes = $derived(proyectarOrdenes(this.eventos));
  abiertas = $derived(ordenesAbiertas(this.ordenes));

  hidratar(eventos: readonly EventoCompra[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoCompra[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  /** Quién opera. Se guarda para poder atribuirle también los movimientos de almacén. */
  private empleadoActual: ID | undefined;

  actuarComo(empleadoId: ID): void {
    this.empleadoActual = empleadoId;
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoCompra): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de compras", causa);
    });
  }

  // --- Proveedores ---------------------------------------------------------------------

  registrarProveedor(datos: {
    nombre: string;
    rfc?: string;
    contacto?: string;
    telefono?: string;
  }): { ok: true; id: ID } | { ok: false; error: string } {
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del proveedor" };
    if (this.proveedores.some((p) => p.activo && p.nombre.toLowerCase() === nombre.toLowerCase())) {
      return { ok: false, error: "Ya hay un proveedor con ese nombre" };
    }

    const proveedor_id = uuidv7();
    this.emitir(
      this.fabrica.crear("proveedor_registrado", streamCompras(SUCURSAL_ID), {
        proveedor_id,
        nombre,
        rfc: datos.rfc?.trim() || undefined,
        contacto: datos.contacto?.trim() || undefined,
        telefono: datos.telefono?.trim() || undefined,
      }),
    );
    return { ok: true, id: proveedor_id };
  }

  desactivarProveedor(proveedorId: ID, motivo?: string): void {
    this.emitir(
      this.fabrica.crear("proveedor_desactivado", streamCompras(SUCURSAL_ID), {
        proveedor_id: proveedorId,
        motivo,
      }),
    );
  }

  // --- Órdenes -------------------------------------------------------------------------

  /** Qué conviene pedir hoy, descontando lo que ya viene en camino. */
  get sugerencias(): SugerenciaCompra[] {
    return sugerirCompra(inventario.porReponer, this.ordenes);
  }

  crearOrden(
    proveedorId: ID,
    lineas: LineaCompra[],
    nota?: string,
  ): { ok: true; id: ID } | { ok: false; error: string } {
    if (!this.proveedores.some((p) => p.proveedor_id === proveedorId)) {
      return { ok: false, error: "Elige un proveedor" };
    }
    const utiles = lineas.filter((l) => l.cantidad > 0);
    if (utiles.length === 0) return { ok: false, error: "La orden no tiene nada que pedir" };

    const orden_id = uuidv7();
    this.emitir(
      this.fabrica.crear("orden_compra_creada", streamCompras(SUCURSAL_ID), {
        orden_id,
        proveedor_id: proveedorId,
        lineas: utiles,
        nota,
      }),
    );
    return { ok: true, id: orden_id };
  }

  /**
   * Registra lo que llegó y mueve el almacén.
   *
   * El orden importa: primero la recepción —el hecho comercial— y después los
   * movimientos de inventario que se derivan de ella. Si se hiciera al revés y
   * fallara la recepción, el almacén tendría una entrada sin orden que la
   * respalde.
   */
  recibir(
    ordenId: ID,
    recibidas: LineaRecibida[],
    opciones: { folioProveedor?: string; nota?: string } = {},
  ): { ok: boolean; error?: string } {
    const orden = this.ordenes.find((o) => o.orden_id === ordenId);
    if (!orden) return { ok: false, error: "No se encontró la orden" };
    if (orden.estado === "cancelada") return { ok: false, error: "Esa orden está cancelada" };
    if (orden.estado === "recibida") return { ok: false, error: "Esa orden ya se recibió completa" };

    const utiles = recibidas.filter((l) => l.cantidad > 0);
    if (utiles.length === 0) return { ok: false, error: "No se capturó nada recibido" };

    this.emitir(
      this.fabrica.crear("orden_compra_recibida", streamCompras(SUCURSAL_ID), {
        orden_id: ordenId,
        recibidas: utiles,
        folio_proveedor: opciones.folioProveedor?.trim() || undefined,
        nota: opciones.nota?.trim() || undefined,
      }),
    );

    for (const m of movimientosDeRecepcion(ordenId, utiles)) {
      inventario.registrar(
        m.insumo_id,
        m.delta,
        "recepcion",
        m.nota ?? "",
        this.empleadoActual,
        m.referencia,
      );
    }
    return { ok: true };
  }

  cancelarOrden(ordenId: ID, motivo: string): { ok: boolean; error?: string } {
    const orden = this.ordenes.find((o) => o.orden_id === ordenId);
    if (!orden) return { ok: false, error: "No se encontró la orden" };
    if (orden.estado === "recibida") {
      return { ok: false, error: "Ya se recibió: la mercancía está en el almacén" };
    }
    if (motivo.trim().length < 3) return { ok: false, error: "Escribe por qué se cancela" };

    this.emitir(
      this.fabrica.crear("orden_compra_cancelada", streamCompras(SUCURSAL_ID), {
        orden_id: ordenId,
        motivo: motivo.trim(),
      }),
    );
    return { ok: true };
  }

  nombreProveedor(id: ID): string {
    return this.proveedores.find((p) => p.proveedor_id === id)?.nombre ?? "—";
  }

  ordenDe(id: ID): OrdenCompra | undefined {
    return this.ordenes.find((o) => o.orden_id === id);
  }

  proveedoresActivos(): Proveedor[] {
    return this.proveedores.filter((p) => p.activo);
  }
}

export const compras = new StoreCompras();
