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
  equivalenciasVigentes,
  ordenesAbiertas,
  proyectarOrdenes,
  proyectarProveedores,
  streamCompras,
  sugerirCompra,
  sumar,
  uuidv7,
  type Centavos,
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
import { egresos } from "./egresos.svelte";
import { inventario } from "./inventario.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

/** Lo que se captura al recibir una entrega, incluido cómo se pagó. */
export interface DatosRecepcion {
  folioProveedor?: string;
  nota?: string;
  /**
   * false = quedó a crédito. El gasto existe desde hoy y el dinero sale el día
   * que se liquide, desde Finanzas → Cuentas por pagar.
   */
  pagado?: boolean;
  /** Con qué se pagó, o con qué se pagará. */
  formaPago?: string;
  /** Fecha comprometida de pago, en las entregas a crédito. */
  venceTs?: number;
  /**
   * true = no generar el gasto.
   *
   * Para la entrega que ya se capturó a mano en Finanzas y no debe contarse dos
   * veces. Es la excepción y por eso hay que pedirla explícitamente.
   */
  sinGasto?: boolean;
}

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

  /**
   * Lo que ya se enseñó sobre las facturas de cada proveedor.
   *
   * Es lo que permite que la SEGUNDA factura del mismo proveedor entre sola:
   * la primera se enseña concepto por concepto, las siguientes se reconocen.
   */
  equivalencias = $derived(equivalenciasVigentes(this.eventos));

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
    opciones: DatosRecepcion = {},
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

    this.registrarGastoDeRecepcion(orden, utiles, opciones);
    return { ok: true };
  }

  /**
   * EL DINERO SALE AL RECIBIR, y no cuando alguien se acuerde de capturarlo.
   *
   * Hasta ahora recibir mercancía movía el almacén y nada más: entraban cien
   * kilos de queso y el sistema seguía creyendo que el restaurante tenía el
   * mismo dinero. Era el hueco que Gonzalo señaló.
   *
   * Se pregunta al recibir si se pagó o quedó a crédito —decisión suya— porque
   * es como opera un restaurante con sus proveedores: si el pago del viernes se
   * apuntara el lunes de la entrega, el saldo estaría mal toda la semana.
   *
   * Las líneas NO se le pasan al gasto aunque las tenga: el almacén ya se movió
   * arriba con la recepción, y volver a mandarlas haría entrar la mercancía dos
   * veces.
   */
  private registrarGastoDeRecepcion(
    orden: OrdenCompra,
    recibidas: readonly LineaRecibida[],
    opciones: DatosRecepcion,
  ): void {
    if (opciones.sinGasto) return;

    const importe = sumar(
      ...recibidas.map((l) => (l.cantidad * l.costo_unitario) as Centavos),
    );
    // Una recepción sin costo pactado no es un gasto de cero: es una compra sin
    // precio capturado, y un renglón de cero pesos en finanzas solo estorba.
    if (importe <= 0) return;

    const proveedor = this.nombreProveedor(orden.proveedor_id);
    const r = egresos.registrar(
      {
        categoria: "insumos",
        concepto: `Compra a ${proveedor}`,
        monto: importe,
        forma_pago: opciones.formaPago ?? "efectivo",
        proveedor,
        proveedor_id: orden.proveedor_id,
        orden_id: orden.orden_id,
        folio_comprobante: opciones.folioProveedor?.trim() || undefined,
        pagado: opciones.pagado !== false,
        vence_ts: opciones.venceTs,
      },
      this.empleadoActual,
    );

    if (!r.ok) {
      /*
       * La mercancía YA entró al almacén y la recepción ya está asentada: no se
       * puede deshacer nada aquí. Se avisa por consola y la compra queda sin su
       * gasto, que se puede capturar a mano desde Finanzas. Callarlo dejaría un
       * descuadre invisible entre el almacén y el dinero.
       */
      console.error("La recepción no generó su gasto en finanzas:", r.error);
    }
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

  /**
   * Enseña a qué insumo corresponde un concepto de la factura de un proveedor.
   *
   * Se aprende UNA vez y se recuerda para siempre. El `factor` es lo que evita
   * el error caro: el proveedor factura una bolsa de 5 kg y el almacén lleva
   * gramos; sin él entrarían 5 gramos al inventario en vez de 5 000.
   */
  aprenderEquivalencia(datos: {
    emisorRfc: string;
    claveProveedor: string;
    insumoId: ID;
    factor: number;
  }): { ok: boolean; error?: string } {
    if (!Number.isFinite(datos.factor) || datos.factor <= 0) {
      return { ok: false, error: "El factor debe ser mayor que cero" };
    }
    if (!datos.insumoId) return { ok: false, error: "Elige el insumo del almacén" };

    this.emitir(
      this.fabrica.crear("equivalencia_aprendida", streamCompras(SUCURSAL_ID), {
        emisor_rfc: datos.emisorRfc.trim().toUpperCase(),
        clave_proveedor: datos.claveProveedor.trim(),
        insumo_id: datos.insumoId,
        factor: datos.factor,
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
