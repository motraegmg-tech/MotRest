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
  egresosEn,
  proyectarEgresos,
  uuidv7,
  type CategoriaEgreso,
  type Centavos,
  type EventoEgreso,
  type ID,
  type Rango,
  type RegistroEgreso,
  type ResultadoPeriodo,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

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

  registrar(datos: DatosEgreso): { ok: true; id: ID } | { ok: false; error: string } {
    const concepto = datos.concepto.trim();
    if (concepto.length < 3) return { ok: false, error: "Escribe el concepto del gasto" };
    if (datos.monto <= 0) return { ok: false, error: "El monto tiene que ser mayor que cero" };
    if (!CATEGORIAS_EGRESO.some((c) => c.id === datos.categoria)) {
      return { ok: false, error: "Elige una categoría" };
    }

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
      }),
    );
    return { ok: true, id: egreso_id };
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
