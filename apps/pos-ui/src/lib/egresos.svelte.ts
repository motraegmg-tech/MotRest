/**
 * Store de egresos (M5).
 *
 * Cada salida de dinero es un hecho append-only, como la venta: no se edita ni
 * se borra, se anula dejando rastro. Borrar un egreso es exactamente lo que
 * haría alguien tapando un faltante de caja.
 */
import {
  CATEGORIAS_EGRESO,
  FabricaEventos,
  calcularResultado,
  compararEventos,
  cuentasPorPagar,
  deudaPorProveedor,
  egresosEn,
  esPagoEnEfectivo,
  proyectarEgresos,
  seguirPresupuesto,
  totalPorPagar,
  uuidv7,
  vencidas,
  type CategoriaEgreso,
  type Centavos,
  type DeudaProveedor,
  type EventoEgreso,
  type ID,
  type LineaEgresoInsumo,
  type Presupuestos,
  type Rango,
  type RegistroEgreso,
  type ResultadoPeriodo,
  type SeguimientoPresupuesto,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { inventario } from "./inventario.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

/** Dónde se guardan los techos de gasto del local. */
export const CLAVE_PRESUPUESTOS = "presupuestos_gasto";

/** Stream al que van los egresos de una sucursal. */
export function streamEgresos(sucursal: ID): ID {
  return `finanzas:${sucursal}`;
}

export interface DatosEgreso {
  categoria: CategoriaEgreso;
  concepto: string;
  monto: Centavos;
  forma_pago: string;
  proveedor?: string;
  rfc_proveedor?: string;
  folio_comprobante?: string;
  /**
   * false = se recibió a crédito. El gasto existe hoy; el dinero sale al pagar.
   * Por omisión, pagado: es lo que hace la mayoría de las capturas.
   */
  pagado?: boolean;
  /** Cuándo se comprometió el pago, en los que van a crédito. */
  vence_ts?: number;
  proveedor_id?: ID;
  orden_id?: ID;
  /**
   * Mercancía que entra al almacén con esta compra.
   *
   * Al registrarse, el store emite además los movimientos de inventario. Es lo
   * que convierte «registrar el gasto del queso» y «dar entrada al queso» en un
   * solo acto — antes eran dos pantallas y la segunda se olvidaba.
   */
  lineas?: LineaEgresoInsumo[];
}

class StoreEgresos {
  private eventos = $state.raw<EventoEgreso[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoEgreso>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  /** Todos los egresos proyectados, incluidos los anulados. */
  registros = $derived(proyectarEgresos(this.eventos));

  hidratar(eventos: readonly EventoEgreso[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  /** Incorpora egresos capturados en otra terminal, sin duplicar. */
  integrar(eventos: readonly EventoEgreso[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  private emitir(evento: EventoEgreso): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el egreso", causa);
    });
  }

  /** Quién captura. Se fija antes de emitir para que la bitácora diga la verdad. */
  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  registrar(
    datos: DatosEgreso,
    empleadoId?: ID,
  ): { ok: true; id: ID } | { ok: false; error: string } {
    const concepto = datos.concepto.trim();
    if (concepto.length < 3) return { ok: false, error: "Escribe el concepto del gasto" };
    if (datos.monto <= 0) return { ok: false, error: "El monto tiene que ser mayor que cero" };
    if (!CATEGORIAS_EGRESO.some((c) => c.id === datos.categoria)) {
      return { ok: false, error: "Elige una categoría" };
    }

    const lineas = (datos.lineas ?? []).filter((l) => l.cantidad > 0);
    if (lineas.length > 0 && datos.categoria !== "insumos") {
      return {
        ok: false,
        error: "Solo una compra de insumos puede cargar mercancía al almacén",
      };
    }

    if (empleadoId) this.actuarComo(empleadoId);
    const egreso_id = uuidv7();
    this.emitir(
      this.fabrica.crear("egreso_registrado", streamEgresos(SUCURSAL_ID), {
        egreso_id,
        categoria: datos.categoria,
        concepto,
        monto: datos.monto,
        forma_pago: datos.forma_pago,
        proveedor: datos.proveedor?.trim() || undefined,
        rfc_proveedor: datos.rfc_proveedor?.trim() || undefined,
        folio_comprobante: datos.folio_comprobante?.trim() || undefined,
        pagado: datos.pagado !== false,
        vence_ts: datos.vence_ts,
        proveedor_id: datos.proveedor_id,
        orden_id: datos.orden_id,
        lineas: lineas.length > 0 ? lineas : undefined,
      }),
    );

    /*
     * EL ALMACÉN SE MUEVE DESPUÉS DEL GASTO, y no al revés.
     *
     * Si fallara el registro del gasto habría entrado mercancía sin nada que la
     * respalde, que es justo el descuadre que este flujo viene a evitar. Es la
     * misma regla que sigue la recepción de una orden de compra.
     *
     * Se emite una entrada por insumo con el id del gasto como referencia: así
     * un conteo que no cuadra se puede rastrear hasta la compra que lo causó.
     */
    for (const linea of lineas) {
      inventario.registrar(
        linea.insumo_id,
        linea.cantidad,
        "recepcion",
        `Compra · ${concepto}`,
        empleadoId,
        `egreso:${egreso_id}`,
      );
    }

    return { ok: true, id: egreso_id };
  }

  /**
   * Liquida un gasto que estaba a crédito: aquí es donde sale el dinero.
   *
   * El gasto no se vuelve a contar —ya existía desde que se recibió— y por eso
   * esto no toca el resultado del mes. Lo único que cambia es el saldo, y la
   * fecha en que cambia es hoy, no la de la compra.
   */
  pagar(
    egresoId: ID,
    formaPago: string,
    opciones: { referencia?: string; autorizadorId?: ID } = {},
  ): { ok: boolean; error?: string } {
    const registro = this.registros.find((r) => r.egreso_id === egresoId);
    if (!registro) return { ok: false, error: "No se encontró el gasto" };
    if (registro.anulado) return { ok: false, error: "Ese gasto está anulado" };
    if (registro.pagado) return { ok: false, error: "Ese gasto ya estaba pagado" };

    if (opciones.autorizadorId) this.actuarComo(opciones.autorizadorId);
    this.emitir(
      this.fabrica.crear("egreso_pagado", streamEgresos(SUCURSAL_ID), {
        egreso_id: egresoId,
        forma_pago: formaPago,
        referencia: opciones.referencia?.trim() || undefined,
        autorizador_id: opciones.autorizadorId,
      }),
    );
    return { ok: true };
  }

  anular(egresoId: ID, motivo: string, autorizadorId?: ID): { ok: boolean; error?: string } {
    const registro = this.registros.find((r) => r.egreso_id === egresoId);
    if (!registro) return { ok: false, error: "No se encontró el egreso" };
    if (registro.anulado) return { ok: false, error: "Ese egreso ya estaba anulado" };
    if (motivo.trim().length < 3) return { ok: false, error: "Escribe por qué se anula" };

    this.emitir(
      this.fabrica.crear("egreso_anulado", streamEgresos(SUCURSAL_ID), {
        egreso_id: egresoId,
        motivo: motivo.trim(),
        autorizador_id: autorizadorId,
      }),
    );
    return { ok: true };
  }

  /** Los egresos vigentes de un período. */
  del(rango: Rango): RegistroEgreso[] {
    return egresosEn(this.registros, rango);
  }

  /**
   * Los gastos EN EFECTIVO que salieron del cajón durante un turno.
   *
   * Es lo que el corte necesita para que el arqueo cuadre. Se mide por la fecha
   * de PAGO —no la de captura— porque es el día que los billetes salieron; un
   * gasto a crédito capturado el martes no vacía el cajón del martes.
   */
  enEfectivoEntre(desde: number, hasta: number): RegistroEgreso[] {
    return this.registros.filter((r) => {
      if (r.anulado || !r.pagado || !esPagoEnEfectivo(r.forma_pago)) return false;
      const cuando = r.pagado_ts ?? r.ts;
      return cuando >= desde && cuando <= hasta;
    });
  }

  // --- Cuentas por pagar ------------------------------------------------------------

  /** Lo que se debe, con lo que vence antes primero. */
  get porPagar(): RegistroEgreso[] {
    return cuentasPorPagar(this.registros);
  }

  get totalPorPagar(): Centavos {
    return totalPorPagar(this.registros);
  }

  /** Deuda cuya fecha comprometida ya pasó. Es la que se enseña en rojo. */
  vencidas(ahora: number = Date.now()): RegistroEgreso[] {
    return vencidas(this.registros, ahora);
  }

  get deudaPorProveedor(): DeudaProveedor[] {
    return deudaPorProveedor(this.registros);
  }

  // --- Presupuesto por categoría -------------------------------------------------------

  /**
   * Los techos de gasto del mes.
   *
   * Son CATÁLOGO, no operación: se guardan como instantánea igual que el menú y
   * el plano, no como registro de hechos. Un presupuesto no es algo que ocurrió,
   * es una decisión vigente que se cambia cuando el dueño quiere.
   */
  private techos = $state.raw<Presupuestos>({});

  async hidratarPresupuestos(almacen: Almacen): Promise<void> {
    const guardados = await almacen.estado.cargar<Presupuestos>(CLAVE_PRESUPUESTOS);
    if (guardados) this.techos = guardados;
  }

  get presupuestos(): Presupuestos {
    return this.techos;
  }

  guardarPresupuestos(techos: Presupuestos): void {
    // Un techo en cero es «no vigilar esta categoría», y se guarda como ausente
    // para que la pantalla no tenga que distinguir entre cero y sin fijar.
    const limpios: Presupuestos = {};
    for (const [categoria, monto] of Object.entries(techos)) {
      if (monto && monto > 0) limpios[categoria as CategoriaEgreso] = monto;
    }
    this.techos = limpios;
    void this.almacen?.estado.guardar(CLAVE_PRESUPUESTOS, limpios).catch((causa) => {
      console.error("No se pudo guardar el presupuesto", causa);
    });
  }

  /** Cómo va el gasto del período contra lo presupuestado. */
  seguimiento(rango: Rango): SeguimientoPresupuesto {
    return seguirPresupuesto(this.techos, this.del(rango), rango);
  }

  /**
   * El resultado del período.
   *
   * Las ventas llegan YA resumidas desde reportes: aquí no se recalculan, para
   * que el resultado y el corte de caja no puedan discrepar.
   */
  resultado(ventas: { subtotal: Centavos; costo: Centavos }, rango: Rango): ResultadoPeriodo {
    return calcularResultado(ventas, this.del(rango));
  }
}

export const egresos = new StoreEgresos();
