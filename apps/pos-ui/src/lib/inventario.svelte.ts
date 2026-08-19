/**
 * Store de inventario: existencias, mermas y conteos.
 *
 * El stock se deriva de los movimientos, nunca se sobrescribe. Cuando el POS
 * manda platillos a cocina, aquí se explotan sus recetas y se registran los
 * consumos — pero solo de los insumos que declararon su vínculo con el almacén.
 *
 * Y al revés: cuando un platillo ya mandado se cancela, lo que se llevó vuelve
 * al almacén como una entrada nueva, no borrando el descuento. El log solo
 * agrega, así que el histórico sigue explicando el número.
 */
import {
  FabricaEventos,
  aUnidadBase,
  compararEventos,
  consumoPorMotivo,
  costoMerma,
  deltaDelMotivo,
  enNegativo,
  existenciaDe,
  insumosDeRenglon,
  porReponer,
  proyectarExistencias,
  streamConteos,
  streamInsumo,
  valorInventario,
  type Centavos,
  type ConsumoPorMotivo,
  type EventoInventario,
  type Existencia,
  type ID,
  type Insumo,
  type MotivoMovimiento,
  type RenglonComanda,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { catalogo } from "./catalogo";
import { menu } from "./menu.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface Resultado {
  ok: boolean;
  error?: string;
}

class StoreInventario {
  /**
   * Catálogo de insumos. Vive en el catálogo del local (editable desde M9), no
   * aquí: este store es dueño de los MOVIMIENTOS, no de la ficha del insumo.
   */
  get insumos(): Insumo[] {
    return menu.insumos;
  }

  private eventos = $state.raw<EventoInventario[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoInventario>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  // --- Persistencia ------------------------------------------------------------

  hidratar(eventos: readonly EventoInventario[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  /** Incorpora movimientos de otra terminal, sin duplicar los ya conocidos. */
  integrar(eventos: readonly EventoInventario[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  private emitir(eventos: readonly EventoInventario[]): void {
    if (eventos.length === 0) return;
    this.eventos = [...this.eventos, ...eventos];
    void this.almacen?.eventos.anexar(eventos).catch((causa) => {
      console.error("No se pudo guardar el movimiento de inventario", causa);
    });
  }

  private actor(empleadoId?: ID): void {
    if (empleadoId) this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  // --- Consultas ------------------------------------------------------------------

  get existencias(): Map<ID, Existencia> {
    return proyectarExistencias(this.eventos);
  }

  get movimientos(): EventoInventario[] {
    return [...this.eventos].sort((a, b) => b.ts - a.ts);
  }

  /** ¿El restaurante está llevando inventario? */
  get activo(): boolean {
    return this.eventos.length > 0;
  }

  insumo(insumoId: ID): Insumo | undefined {
    return this.insumos.find((i) => i.id === insumoId);
  }

  cantidad(insumoId: ID): number {
    return existenciaDe(this.existencias, insumoId);
  }

  get porReponer() {
    return porReponer(this.insumos, this.existencias);
  }

  get enNegativo(): Existencia[] {
    return enNegativo(this.existencias);
  }

  get valor(): Centavos {
    return valorInventario(this.insumos, this.existencias);
  }

  get costoMerma(): Centavos {
    return costoMerma(this.eventos, this.insumos);
  }

  consumoDe(insumoId?: ID): ConsumoPorMotivo {
    return consumoPorMotivo(this.eventos, insumoId);
  }

  /**
   * Renglones que ya movieron el almacén, por motivo.
   *
   * Es la memoria que impide contar dos veces: un renglón solo se descuenta si
   * nunca se descontó, y solo se devuelve si se había descontado y todavía no
   * se ha devuelto. Sin esto, reenviar a cocina descontaría de nuevo y dos
   * toques al botón de cancelar regresarían el doble de producto.
   */
  private renglonesCon(motivo: MotivoMovimiento): Set<ID> {
    const marcados = new Set<ID>();
    for (const ev of this.eventos) {
      if (ev.tipo !== "movimiento_inventario") continue;
      if (ev.motivo === motivo && ev.renglon_id) marcados.add(ev.renglon_id);
    }
    return marcados;
  }

  // --- Movimientos --------------------------------------------------------------------

  /**
   * Movimientos que genera UN renglón, con el signo que pida el motivo.
   *
   * Se emite un evento por renglón y por insumo —no uno agregado por envío—
   * porque es la única forma de saber después qué se llevó cada platillo. Ese
   * detalle es justo lo que hace posible devolverlo al cancelarlo.
   */
  private movimientosDeRenglon(
    renglon: RenglonComanda,
    motivo: "consumo_receta" | "reverso_receta",
    referencia: string,
  ): EventoInventario[] {
    const entra = motivo === "reverso_receta";
    const eventos: EventoInventario[] = [];

    for (const consumo of insumosDeRenglon(renglon, catalogo)) {
      const insumo = this.insumo(consumo.insumo_id);
      if (!insumo) continue;

      const enBase = aUnidadBase(consumo, insumo.unidad_base);
      // Unidades incompatibles: se omite en vez de inventar una conversión.
      if (enBase === null) {
        console.warn(
          `No se pudo convertir ${consumo.unidad} a ${insumo.unidad_base} para ${insumo.nombre}`,
        );
        continue;
      }

      eventos.push(
        this.fabrica.crear("movimiento_inventario", streamInsumo(insumo.id), {
          insumo_id: insumo.id,
          delta: entra ? enBase : -enBase,
          unidad: insumo.unidad_base,
          motivo,
          renglon_id: renglon.id,
          referencia,
        }),
      );
    }

    return eventos;
  }

  /**
   * Descuenta los insumos de lo que se acaba de mandar a cocina.
   * Devuelve cuántos insumos se movieron (0 si el restaurante no lleva recetas).
   */
  consumirPorReceta(
    renglones: readonly RenglonComanda[],
    referencia: string,
    empleadoId?: ID,
  ): number {
    const yaDescontados = this.renglonesCon("consumo_receta");
    const pendientes = renglones.filter((r) => !yaDescontados.has(r.id));
    if (pendientes.length === 0) return 0;

    this.actor(empleadoId);
    const eventos = pendientes.flatMap((r) =>
      this.movimientosDeRenglon(r, "consumo_receta", referencia),
    );

    this.emitir(eventos);
    return eventos.length;
  }

  /**
   * Regresa al almacén lo que se llevó un platillo que se canceló.
   *
   * El almacén no se corrige borrando el descuento —el log solo agrega—, sino
   * anotando la entrada contraria. Así el histórico sigue explicando el número:
   * salieron 200 g de masa a las 21:14 y volvieron a las 21:20 porque la mesa 8
   * canceló la pizza.
   *
   * Solo devuelve lo que de verdad salió: un platillo que se cancela ANTES de
   * mandarse a cocina nunca descontó nada, así que no hay nada que regresar.
   */
  devolverPorCancelacion(
    renglones: readonly RenglonComanda[],
    referencia: string,
    empleadoId?: ID,
  ): number {
    const descontados = this.renglonesCon("consumo_receta");
    const devueltos = this.renglonesCon("reverso_receta");
    const porDevolver = renglones.filter(
      (r) => descontados.has(r.id) && !devueltos.has(r.id),
    );
    if (porDevolver.length === 0) return 0;

    this.actor(empleadoId);
    const eventos = porDevolver.flatMap((r) =>
      this.movimientosDeRenglon(r, "reverso_receta", referencia),
    );

    this.emitir(eventos);
    return eventos.length;
  }

  /**
   * Registra un movimiento manual: recepción, merma, ajuste…
   *
   * `referencia` ata el movimiento a lo que lo originó —una orden de compra,
   * por ejemplo—. Sin ella, un conteo que no cuadra no se puede rastrear hasta
   * la entrega que lo causó.
   */
  registrar(
    insumoId: ID,
    cantidad: number,
    motivo: MotivoMovimiento,
    nota: string,
    empleadoId?: ID,
    referencia?: string,
  ): Resultado {
    const insumo = this.insumo(insumoId);
    if (!insumo) return { ok: false, error: "Insumo no encontrado" };
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      return { ok: false, error: "Escribe una cantidad distinta de cero" };
    }

    // El signo lo decide el motivo, no quien teclea.
    const delta = deltaDelMotivo(motivo, cantidad);

    this.actor(empleadoId);
    this.emitir([
      this.fabrica.crear("movimiento_inventario", streamInsumo(insumoId), {
        insumo_id: insumoId,
        delta,
        unidad: insumo.unidad_base,
        motivo,
        nota: nota.trim() || undefined,
        referencia,
      }),
    ]);
    return { ok: true };
  }

  /** Cierra un conteo cíclico: lo contado pasa a ser la existencia. */
  registrarConteo(
    lineas: { insumo_id: ID; contado: number }[],
    nota: string,
    empleadoId?: ID,
  ): Resultado {
    if (lineas.length === 0) return { ok: false, error: "No hay nada que contar" };

    const existencias = this.existencias;
    this.actor(empleadoId);
    this.emitir([
      this.fabrica.crear("conteo_registrado", streamConteos(SUCURSAL_ID), {
        lineas: lineas.map((l) => ({
          insumo_id: l.insumo_id,
          contado: l.contado,
          esperado: existenciaDe(existencias, l.insumo_id),
        })),
        nota: nota.trim() || undefined,
      }),
    ]);
    return { ok: true };
  }
}

export const inventario = new StoreInventario();
