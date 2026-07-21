/**
 * Store reactivo del POS (Svelte 5 runes).
 *
 * Toda interacción se expresa como EVENTOS de @motrest/dominio y se guarda en un
 * log append-only por mesa. El estado visible es una PROYECCIÓN derivada.
 *
 * Cambios de la etapa 1:
 *  - Cada sentada genera un `orden_id` NUEVO (antes se reusaba "cmd-"+mesa).
 *  - La mesa ya no guarda comensales.
 *  - Los renglones tienen estado propio (capturado → enviado → … → entregado).
 *  - Todo el dinero va en centavos exactos.
 */
import {
  FabricaEventos,
  agruparPorMesa,
  costearPorciones,
  margen,
  pesos,
  porFraccion,
  productoDe,
  proyectarComanda,
  renglonesActivos,
  renglonesPendientes,
  tieneEnviados,
  yaEnviado,
  totalesComanda,
  uuidv7,
  type Centavos,
  type EventoComanda,
  type ID,
  type PorcionElegida,
  type Producto,
  type RenglonComanda,
  type TotalesComanda,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { catalogo, impuestos, tamanosPizza } from "./catalogo";
import { plano } from "./plano.svelte";
import { EMPLEADO_ACTUAL, SUCURSAL_ID, obtenerDeviceId } from "./presentacion";
import { construirRenglon, mitades, type OpcionesSemilla } from "./semilla";
import { autorizacion } from "./sesion/autorizacion.svelte";
import { sesion } from "./sesion/sesion.svelte";

export type EstadoMesa = "libre" | "ocupada" | "cuenta";

export interface IngredienteVM {
  nombre: string;
  costo: Centavos;
}

export interface MitadVM {
  ranuraId: ID;
  posicion: string;
  productoId: ID;
  nombre: string;
  ingredientes: IngredienteVM[];
  costo: Centavos;
  margen: number;
}

const fabrica = new FabricaEventos<EventoComanda>({
  device_id: obtenerDeviceId(),
  empleado_id: EMPLEADO_ACTUAL,
  sucursal_id: SUCURSAL_ID,
});

/** La fábrica se comparte con el arranque para poder sembrar la demostración. */
export const fabricaPos = fabrica;

const opcionesSemilla: OpcionesSemilla = {
  catalogo,
  impuestoPorDefecto: impuestos[0]!,
  fabrica,
};

class TiendaPOS {
  /**
   * Log de eventos por mesa (append-only: se reasigna al emitir).
   * Nace vacío: lo llena `hidratar()` durante el arranque, ya sea desde lo
   * guardado en el dispositivo o desde la semilla de demostración.
   */
  private logs = $state.raw<Record<ID, readonly EventoComanda[]>>({});

  /** Almacén local. Mientras sea null, los eventos solo viven en memoria. */
  private almacen: Almacen | null = null;

  mesaActiva = $state<ID>("mesa-12");

  // Configurador de pizza.
  tamano = $state<string>("Familiar");
  mitadIzq = $state<ID>("var-margherita");
  mitadDer = $state<ID>("var-pepperoni");

  mensaje = $state<string>("");
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  // --- Persistencia -----------------------------------------------------------

  /** Rehidrata el salón desde un log plano de eventos ya ordenado. */
  hidratar(eventos: readonly EventoComanda[]): void {
    this.logs = agruparPorMesa(eventos);

    // Deja activa la primera mesa con cuenta abierta; si no hay, la primera del plano.
    const conCuenta = plano.todasLasMesas.find((m) => this.estadoMesa(m.id) !== "libre");
    this.mesaActiva = conCuenta?.id ?? plano.todasLasMesas[0]?.id ?? "";

    // El salón se abre en el área donde está la mesa activa.
    const area = plano.areaDeMesa(this.mesaActiva);
    if (area) plano.areaActiva = area.id;
  }

  /** A partir de aquí cada evento emitido se guarda en el dispositivo. */
  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  // --- Emisión ------------------------------------------------------------------

  private emitir(mesaId: ID, evento: EventoComanda): void {
    const previos = this.logs[mesaId] ?? [];
    this.logs = { ...this.logs, [mesaId]: [...previos, evento] };

    // Persistencia en segundo plano: la interfaz no espera al disco.
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento", causa);
      this.flash("Aviso: el último cambio no se pudo guardar en el dispositivo");
    });
  }

  /** Los eventos se firman con el empleado que tenga la sesión abierta. */
  private sincronizarActor(): void {
    fabrica.actualizarContexto({
      empleado_id: sesion.usuarioActual?.id ?? EMPLEADO_ACTUAL,
    });
  }

  /** Todos los eventos operativos del local, para la bitácora de auditoría. */
  get todosLosEventos(): EventoComanda[] {
    return Object.values(this.logs).flat();
  }

  private flash(texto: string): void {
    this.mensaje = texto;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.mensaje = "";
    }, 2600);
  }

  // --- Proyección de la mesa activa ---------------------------------------------

  get comanda() {
    const log = this.logs[this.mesaActiva] ?? [];
    return log.length > 0 ? proyectarComanda(log) : null;
  }

  get renglones(): RenglonComanda[] {
    const c = this.comanda;
    return c ? renglonesActivos(c) : [];
  }

  get totales(): TotalesComanda | null {
    const c = this.comanda;
    return c ? totalesComanda(c) : null;
  }

  get hayCuenta(): boolean {
    const c = this.comanda;
    return !!c && !c.cerrada && this.renglones.length > 0;
  }

  get enviadaACocina(): boolean {
    const c = this.comanda;
    return c ? tieneEnviados(c) : false;
  }

  get pendientes(): RenglonComanda[] {
    const c = this.comanda;
    return c ? renglonesPendientes(c) : [];
  }

  /** Identificador visible de la mesa activa: puede ser "12" o "Barra 3". */
  get nombreMesaActiva(): string {
    return plano.nombreMesa(this.mesaActiva);
  }

  // --- Estado del salón ---------------------------------------------------------

  estadoMesa(mesaId: ID): EstadoMesa {
    const log = this.logs[mesaId];
    if (!log || log.length === 0) return "libre";
    const c = proyectarComanda(log);
    if (c.cerrada || renglonesActivos(c).length === 0) return "libre";
    return tieneEnviados(c) ? "cuenta" : "ocupada";
  }

  // --- Configurador de pizza ----------------------------------------------------

  get productoPizza(): Producto {
    const t = tamanosPizza.find((x) => x.clave === this.tamano) ?? tamanosPizza[2];
    return productoDe(catalogo, t.producto_id);
  }

  get porcionesActuales(): PorcionElegida[] {
    return mitades(this.mitadIzq, this.mitadDer);
  }

  get costoPizza(): Centavos {
    return costearPorciones(this.porcionesActuales, catalogo);
  }

  get precioPizza(): Centavos {
    return this.productoPizza.precio;
  }

  get margenPizza(): number {
    return margen(this.precioPizza, this.costoPizza);
  }

  private vmMitad(ranuraId: ID, posicion: string, productoId: ID): MitadVM {
    const variedad = productoDe(catalogo, productoId);
    const receta = variedad.receta_id ? catalogo.recetas.get(variedad.receta_id) : undefined;
    const precioMitad = porFraccion(this.precioPizza, 0.5);
    const costo = porFraccion(variedad.costo, 0.5);
    return {
      ranuraId,
      posicion,
      productoId,
      nombre: variedad.nombre,
      ingredientes: (receta?.ingredientes ?? []).map((i) => ({
        nombre: i.nombre,
        costo: porFraccion(i.costo, 0.5),
      })),
      costo,
      margen: margen(precioMitad, costo),
    };
  }

  get mitades(): MitadVM[] {
    return [
      this.vmMitad("izq", "Mitad izquierda", this.mitadIzq),
      this.vmMitad("der", "Mitad derecha", this.mitadDer),
    ];
  }

  get etiquetaIzq(): string {
    return productoDe(catalogo, this.mitadIzq).nombre;
  }

  get etiquetaDer(): string {
    return productoDe(catalogo, this.mitadDer).nombre;
  }

  // --- Comandos ------------------------------------------------------------------

  /** `orden_id` de la sentada en curso, o null si la mesa está libre. */
  private ordenActiva(mesaId: ID): ID | null {
    const log = this.logs[mesaId];
    if (!log || log.length === 0) return null;
    const c = proyectarComanda(log);
    return c.cerrada ? null : c.orden_id;
  }

  seleccionarMesa(mesaId: ID): void {
    this.mesaActiva = mesaId;
    if (this.estadoMesa(mesaId) === "libre") this.abrirMesa(mesaId);
  }

  /** Abre una sentada NUEVA: cada una estrena su propio orden_id. */
  abrirMesa(mesaId: ID): ID {
    const orden_id = uuidv7();
    this.emitir(
      mesaId,
      fabrica.crear("orden_creada", orden_id, {
        orden_id,
        mesa_id: mesaId,
        abierta_ts: Date.now(),
      }),
    );
    return orden_id;
  }

  private asegurarOrden(): ID {
    return this.ordenActiva(this.mesaActiva) ?? this.abrirMesa(this.mesaActiva);
  }

  async agregarSimple(productoId: ID): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.item.agregar");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.asegurarOrden();
    const renglon = construirRenglon(opcionesSemilla, productoId, 1);
    this.emitir(this.mesaActiva, fabrica.crear("item_agregado", orden_id, { orden_id, renglon }));
    this.flash(`${renglon.descripcion} agregado a la mesa ${this.nombreMesaActiva}`);
  }

  async agregarPizza(): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.item.agregar");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.asegurarOrden();
    const detalle = `½ ${this.etiquetaIzq} · ½ ${this.etiquetaDer}`;
    const renglon = construirRenglon(
      opcionesSemilla,
      this.productoPizza.id,
      1,
      this.porcionesActuales,
      detalle,
    );
    this.emitir(this.mesaActiva, fabrica.crear("item_agregado", orden_id, { orden_id, renglon }));
    this.flash(`${renglon.descripcion} agregada a la mesa ${this.nombreMesaActiva}`);
  }

  /**
   * Cancelar un renglón. Si ya salió a cocina exige autorización de un rol
   * superior; la firma queda registrada en el propio evento y en la bitácora.
   */
  async cancelar(renglonId: ID): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id) return;

    const renglon = this.renglones.find((r) => r.id === renglonId);
    if (!renglon) return;

    const enviado = yaEnviado(renglon);
    const accion = enviado ? "pos.item.cancelar_enviado" : "pos.item.cancelar_previo_envio";
    const permiso = await autorizacion.solicitar(accion, undefined, renglon.descripcion);
    if (!permiso.ok) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("item_cancelado", orden_id, {
        orden_id,
        renglon_id: renglonId,
        autorizador_id: permiso.autorizador_id ?? sesion.usuarioActual?.id,
      }),
    );
    if (enviado) this.flash(`"${renglon.descripcion}" cancelado con autorización`);
  }

  /** Manda a cocina solo lo que sigue pendiente (envío por tiempos). */
  async enviarACocina(): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.item.enviar_cocina");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.ordenActiva(this.mesaActiva);
    const porEnviar = this.pendientes;
    if (!orden_id || porEnviar.length === 0) return;
    this.emitir(
      this.mesaActiva,
      fabrica.crear("items_enviados", orden_id, {
        orden_id,
        renglon_ids: porEnviar.map((r) => r.id),
      }),
    );
    this.flash(
      `${porEnviar.length} ${porEnviar.length === 1 ? "platillo enviado" : "platillos enviados"} a cocina`,
    );
  }

  async cobrar(): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.cobro.registrar");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.ordenActiva(this.mesaActiva);
    const t = this.totales;
    if (!orden_id || !t || !this.hayCuenta) return;
    const mesa = this.nombreMesaActiva;
    this.emitir(
      this.mesaActiva,
      fabrica.crear("pago_registrado", orden_id, {
        orden_id,
        monto: t.total,
        forma: "efectivo",
        propina: pesos(0),
      }),
    );
    this.emitir(this.mesaActiva, fabrica.crear("cuenta_cerrada", orden_id, { orden_id }));
    this.flash(`Mesa ${mesa} cobrada · liberada`);
  }
}

export const pos = new TiendaPOS();

