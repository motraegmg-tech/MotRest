/**
 * Store reactivo del POS (Svelte 5 runes).
 *
 * Toda interacción se expresa como EVENTOS de @motrest/dominio y se guarda en un
 * log append-only por mesa. El estado visible es una PROYECCIÓN derivada.
 */
import {
  CERO,
  FabricaEventos,
  agruparPorMesa,
  compararEventos,
  construirRenglon,
  desglosarConTasas,
  etiquetaFormaPago,
  importeRenglon,
  pesos,
  mesasConCuentaDuplicada,
  proyectarSentadas,
  ultimaSentada,
  promocionesPendientes,
  renglonesActivos,
  renglonesPendientes,
  repartir,
  restar,
  sumar,
  tieneEnviados,
  totalesComanda,
  uuidv7,
  yaEnviado,
  type Accion,
  type Centavos,
  type ConfiguracionRenglon,
  type DescuentoPromocion,
  type EstadoComanda,
  type EventoComanda,
  type FormaPago,
  type ID,
  type RenglonComanda,
  type TotalesComanda,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { catalogo, impuestos } from "./catalogo";
import { menu } from "./menu.svelte";
import { configurador } from "./configurador.svelte";
import { inventario } from "./inventario.svelte";
import { plano } from "./plano.svelte";
import { impresion } from "./impresion.svelte";
import { EMPLEADO_ACTUAL, SUCURSAL_ID, datosLocal, obtenerDeviceId } from "./presentacion";
import { sembrarSalon, type OpcionesSemilla } from "./semilla";
import { autorizacion } from "./sesion/autorizacion.svelte";
import { sesion } from "./sesion/sesion.svelte";
import { sync } from "./sync.svelte";

export type EstadoMesa = "libre" | "ocupada" | "cuenta";

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
  /** Log de eventos por mesa (append-only: se reasigna al emitir). */
  private logs = $state.raw<Record<ID, readonly EventoComanda[]>>({});
  private almacen: Almacen | null = null;

  /**
   * Arranca vacía a propósito: `hidratar()` elige la mesa real del local. Traer
   * "mesa-12" de fábrica metía una mesa de la demostración al instalador del
   * restaurante, que no tiene esa mesa.
   */
  mesaActiva = $state<ID>("");
  mensaje = $state<string>("");
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  // --- Persistencia -----------------------------------------------------------

  hidratar(eventos: readonly EventoComanda[]): void {
    this.logs = agruparPorMesa(eventos);

    const conCuenta = plano.todasLasMesas.find((m) => this.estadoMesa(m.id) !== "libre");
    this.mesaActiva = conCuenta?.id ?? plano.todasLasMesas[0]?.id ?? "";

    const area = plano.areaDeMesa(this.mesaActiva);
    if (area) plano.areaActiva = area.id;
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  /**
   * Incorpora eventos llegados de otra terminal.
   *
   * Se deduplica por id: el Hub puede reenviar algo que este dispositivo ya
   * tenía —tras un resync, por ejemplo— y meterlo dos veces al log duplicaría
   * renglones en la pantalla aunque la cuenta del Hub estuviera bien.
   */
  integrar(eventos: readonly EventoComanda[]): void {
    const porMesa = agruparPorMesa(eventos);
    const siguiente = { ...this.logs };

    for (const [mesaId, entrantes] of Object.entries(porMesa)) {
      const previos = siguiente[mesaId] ?? [];
      const conocidos = new Set(previos.map((e) => e.id));
      const nuevos = entrantes.filter((e) => !conocidos.has(e.id));
      if (nuevos.length === 0) continue;
      siguiente[mesaId] = [...previos, ...nuevos].sort(compararEventos);
    }

    this.logs = siguiente;
  }

  // --- Emisión ------------------------------------------------------------------

  private emitir(mesaId: ID, evento: EventoComanda): void {
    const previos = this.logs[mesaId] ?? [];
    this.logs = { ...this.logs, [mesaId]: [...previos, evento] };

    void this.almacen?.eventos
      .anexar([evento])
      .then(() => {
        // Se empuja DESPUÉS de guardar en local, nunca antes: si el envío falla
        // el evento ya está a salvo en el outbox y saldrá al reconectar.
        sync.empujar();
      })
      .catch((causa) => {
        console.error("No se pudo guardar el evento", causa);
        this.flash("Aviso: el último cambio no se pudo guardar en el dispositivo");
      });
  }

  private sincronizarActor(): void {
    fabrica.actualizarContexto({
      empleado_id: sesion.usuarioActual?.id ?? EMPLEADO_ACTUAL,
    });
  }

  get todosLosEventos(): EventoComanda[] {
    return Object.values(this.logs).flat();
  }

  private flash(texto: string): void {
    this.mensaje = texto;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => (this.mensaje = ""), 2600);
  }

  // --- Proyección de la mesa activa ---------------------------------------------

  get comanda() {
    return ultimaSentada(this.logs[this.mesaActiva] ?? []);
  }

  get renglones(): RenglonComanda[] {
    const c = this.comanda;
    return c ? renglonesActivos(c) : [];
  }

  /**
   * Promociones que HOY le corresponden a esta cuenta y todavía no se aplicaron.
   *
   * Qué promoción aplica se CALCULA contra el reloj —una promoción es una regla,
   * no un dato—, pero el descuento resultante se REGISTRA como evento: el
   * ticket, el corte y el CFDI salen del log, y un comprobante fiscal no puede
   * decir "descuento variable según la hora".
   *
   * Los renglones que ya quedaron cubiertos por una promoción anterior se
   * excluyen. Así, si llegan platillos nuevos a la misma cuenta, se ofrece lo
   * que falta y nunca se regala dos veces lo mismo.
   */
  get promociones() {
    const c = this.comanda;
    if (!c || c.cerrada) return null;

    return promocionesPendientes(
      renglonesActivos(c),
      menu.promociones,
      c.descuentos,
      (productoId) => catalogo.productos.get(productoId)?.categoria_id,
      Date.now(),
    );
  }

  /**
   * Registra el descuento de una promoción.
   *
   * No se aplica sola: alguien de la casa la confirma. Una promoción que se
   * cobra sin que nadie la vea es la forma más rápida de regalar producto por
   * una promoción mal configurada y enterarse en el corte.
   */
  aplicarPromocion(descuento: DescuentoPromocion): void {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id || descuento.importe <= 0) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "cuenta",
        modo: "monto",
        valor: descuento.importe,
        motivo: `Promoción: ${descuento.nombre}`,
        promocion_id: descuento.promocion_id,
        renglones_cubiertos: descuento.renglones,
        autorizador_id: sesion.usuarioActual?.id,
      }),
    );
    this.flash(`${descuento.nombre} aplicada`);
  }

  get totales(): TotalesComanda | null {
    const c = this.comanda;
    return c ? totalesComanda(c) : null;
  }

  /** La mesa está en servicio: hay cuenta abierta, aunque no hayan pedido nada. */
  get comandaAbierta(): boolean {
    const c = this.comanda;
    return !!c && !c.cerrada;
  }

  /**
   * La cuenta cobrada de esta mesa, si la hay y todavía no se sentó a nadie más.
   *
   * Es la candidata a reabrir: un cobro mal hecho se descubre en los segundos
   * siguientes, no una hora después.
   *
   * Una sentada ANULADA no cuenta: se liberó sin consumo, así que no hay ticket
   * que reimprimir ni cobro que deshacer. Sin este filtro, liberar una mesa
   * dejaba en pantalla dos botones que no llevaban a ninguna parte.
   */
  get ultimaCobrada() {
    const c = this.comanda;
    return c?.cerrada && !c.anulada ? c : null;
  }

  /** Hay algo consumido: es lo que permite cobrar o facturar. */
  get hayCuenta(): boolean {
    return this.comandaAbierta && this.renglones.length > 0;
  }

  get enviadaACocina(): boolean {
    const c = this.comanda;
    return c ? tieneEnviados(c) : false;
  }

  get pendientes(): RenglonComanda[] {
    const c = this.comanda;
    return c ? renglonesPendientes(c) : [];
  }

  get nombreMesaActiva(): string {
    return plano.nombreMesa(this.mesaActiva);
  }

  // --- Estado del salón ---------------------------------------------------------

  /**
   * Estado de una mesa.
   *
   * Una mesa con la cuenta abierta está OCUPADA aunque todavía no hayan pedido
   * nada: los comensales ya están sentados y esa mesa no se puede dar a nadie
   * más. Antes se reportaba libre mientras no hubiera renglones, y ponerla en
   * servicio parecía no hacer nada.
   */
  /** La cuenta en curso de una mesa cualquiera, no solo la activa. */
  comandaDeMesa(mesaId: ID): EstadoComanda | null {
    return ultimaSentada(this.logs[mesaId] ?? []);
  }

  estadoMesa(mesaId: ID): EstadoMesa {
    const c = ultimaSentada(this.logs[mesaId] ?? []);
    if (!c || c.cerrada) return "libre";
    return tieneEnviados(c) ? "cuenta" : "ocupada";
  }

  /**
   * Todas las comandas de la jornada: UNA POR SENTADA, no una por mesa.
   *
   * La mesa 4 se sirve cinco veces un viernes. Proyectar su log de corrido
   * devolvía solo la última sentada, así que el contador y los reportes veían
   * una fracción de la noche mientras el corte de caja —que suma pagos— veía
   * todo. Los dos números no coincidían y no había forma de saber cuál creer.
   */
  /*
   * SE REPROYECTA SOLO LA MESA QUE CAMBIÓ.
   *
   * Esto lo llaman los reportes, el contador, el CRM y el centinela, varias
   * veces por render. Sin caché, agregar un refresco a la mesa 3 obligaba a
   * reproyectar el log ENTERO del local — las treinta mesas y toda la jornada —
   * y ese costo crece con el registro (ADR-21): el día que el log llega a
   * cientos de miles de eventos, la caja se congela al teclear.
   *
   * La caché es exacta porque el log de cada mesa es INMUTABLE: al emitir se
   * reasigna el arreglo entero, así que comparar la referencia basta para saber
   * si cambió. No hay forma de que quede una proyección vieja.
   */
  private cacheSentadas = new Map<ID, { log: readonly EventoComanda[]; sentadas: EstadoComanda[] }>();

  private sentadasDe(mesaId: ID, log: readonly EventoComanda[]): EstadoComanda[] {
    const previo = this.cacheSentadas.get(mesaId);
    if (previo && previo.log === log) return previo.sentadas;

    const sentadas = proyectarSentadas(log);
    this.cacheSentadas.set(mesaId, { log, sentadas });
    return sentadas;
  }

  todasLasComandas = $derived.by(() => {
    const todas: EstadoComanda[] = [];
    for (const [mesaId, log] of Object.entries(this.logs)) {
      todas.push(...this.sentadasDe(mesaId, log));
    }
    // Las mesas que ya no están en el log tampoco tienen por qué ocupar caché.
    if (this.cacheSentadas.size > Object.keys(this.logs).length * 2) {
      for (const mesaId of this.cacheSentadas.keys()) {
        if (!(mesaId in this.logs)) this.cacheSentadas.delete(mesaId);
      }
    }
    return todas;
  });

  /** Todas las comandas abiertas del local: es lo que ve la cocina. */
  get comandasAbiertas(): EstadoComanda[] {
    return this.todasLasComandas.filter((c) => !c.cerrada);
  }

  /**
   * Mesas que quedaron con dos cuentas abiertas.
   *
   * Pasa cuando dos terminales ponen en servicio la misma mesa antes de
   * sincronizar: cada una la veía libre. En un mismo dispositivo ya no puede
   * ocurrir. No se juntan solas —quién junta dos cuentas es decisión de la
   * casa— pero el mesero tiene que verlo antes de cobrar, no después.
   */
  get mesasDuplicadas(): ID[] {
    return mesasConCuentaDuplicada(this.todasLasComandas);
  }

  /**
   * Mesa a la que pertenece una orden, para emitir sobre su log.
   *
   * Se busca entre TODAS las sentadas, no solo la última: un postre puede
   * seguir en cocina cuando la mesa ya se cobró y se sentó a alguien más, y el
   * KDS tiene que poder marcarlo entregado.
   */
  private mesaDeOrden(ordenId: ID): ID | null {
    for (const [mesaId, log] of Object.entries(this.logs)) {
      if (log.some((e) => e.orden_id === ordenId)) return mesaId;
    }
    return null;
  }

  // --- Comandos de cocina ---------------------------------------------------------

  private async emitirDeCocina(
    ordenId: ID,
    crear: (mesaId: ID) => EventoComanda,
    accion: Accion = "cocina.item.marcar_listo",
  ): Promise<void> {
    const permiso = await autorizacion.solicitar(accion);
    if (!permiso.ok) return;

    const mesaId = this.mesaDeOrden(ordenId);
    if (!mesaId) return;

    this.sincronizarActor();
    this.emitir(mesaId, crear(mesaId));
  }

  /** La cocina tomó el platillo: arranca su preparación. */
  async marcarEnMarcha(ordenId: ID, renglonId: ID, estacionId?: ID): Promise<void> {
    await this.emitirDeCocina(ordenId, () =>
      fabrica.crear("item_en_marcha", ordenId, {
        orden_id: ordenId,
        renglon_id: renglonId,
        estacion_id: estacionId,
      }),
    );
  }

  async marcarListo(ordenId: ID, renglonId: ID): Promise<void> {
    await this.emitirDeCocina(ordenId, () =>
      fabrica.crear("item_listo", ordenId, { orden_id: ordenId, renglon_id: renglonId }),
    );
  }

  /**
   * El platillo llegó a la mesa.
   *
   * Lo firma `pos.item.entregar` y no el permiso de cocina: quien lo sirve es el
   * mesero, y hasta ahora esto solo se podía marcar desde el tablero —o sea, lo
   * pulsaba quien deja el plato bajo la lámpara, no quien lo lleva—. Cocina
   * conserva el botón: en un pase con mostrador es ella la que entrega.
   */
  async marcarEntregado(ordenId: ID, renglonId: ID): Promise<void> {
    await this.emitirDeCocina(
      ordenId,
      () => fabrica.crear("item_entregado", ordenId, { orden_id: ordenId, renglon_id: renglonId }),
      "pos.item.entregar",
    );
  }

  /** Total en curso de una mesa, para pintarlo en el plano. */
  totalDeMesa(mesaId: ID): Centavos {
    const c = ultimaSentada(this.logs[mesaId] ?? []);
    return !c || c.cerrada ? CERO : totalesComanda(c).total;
  }

  // --- Comandos ------------------------------------------------------------------

  /*
   * DOS PREGUNTAS DISTINTAS, DOS FUNCIONES.
   *
   * "¿Cuál es la orden?" y "¿se le puede agregar algo?" venían respondidas por
   * la misma función, que devolvía null en cuanto la cuenta se cerraba. Reabrir
   * una cuenta y reimprimir un ticket se hacen DESPUÉS de cobrar por
   * definición, así que las dos preguntaban lo que no era y salían siempre por
   * la puerta del "no se pudo", sin decir por qué. Separarlas es el arreglo.
   */

  /** La orden EN CURSO: null si ya se cobró. Nada se le puede agregar. */
  private ordenActiva(mesaId: ID): ID | null {
    const c = ultimaSentada(this.logs[mesaId] ?? []);
    return !c || c.cerrada ? null : c.orden_id;
  }

  /** La última orden de la mesa, esté cobrada o no. */
  private ordenDeLaMesa(mesaId: ID): ID | null {
    return ultimaSentada(this.logs[mesaId] ?? [])?.orden_id ?? null;
  }

  /**
   * Selecciona una mesa SIN abrirla. Poner una mesa en servicio es una decisión
   * del mesero, no un efecto secundario de tocarla: puede estar consultándola.
   */
  seleccionarMesa(mesaId: ID): void {
    this.mesaActiva = mesaId;
    const area = plano.areaDeMesa(mesaId);
    if (area) plano.areaActiva = area.id;
  }

  /** Pone la mesa activa en servicio: llegaron comensales. */
  async ponerEnServicio(): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.orden.abrir");
    if (!permiso.ok) return;
    if (this.estadoMesa(this.mesaActiva) !== "libre") return;

    this.sincronizarActor();
    this.abrirMesa(this.mesaActiva);
    this.flash(`Mesa ${this.nombreMesaActiva} en servicio`);
  }

  /**
   * ¿Se puede devolver esta mesa a «libre»?
   *
   * Solo si está en servicio y NADIE pidió nada: sin renglones vivos y sin
   * pagos. Con consumo, lo que corresponde es cancelar los renglones —que deja
   * rastro de qué se canceló y quién lo autorizó— o cobrar.
   */
  get puedeLiberarMesa(): boolean {
    const c = this.comanda;
    return !!c && !c.cerrada && this.renglones.length === 0 && c.pagos.length === 0;
  }

  /**
   * Devuelve la mesa a «libre» sin cobrarla.
   *
   * Pasa todos los días: se pone una mesa en servicio y los comensales se
   * cambian de lugar o se van antes de pedir. Hasta ahora la única forma de
   * soltarla era cobrar una cuenta de cero pesos, que ensuciaba el corte con
   * ventas fantasma; por eso esto emite `orden_anulada` y no `cuenta_cerrada`:
   * la sentada se cierra pero NO cuenta como venta en ningún reporte.
   */
  async liberarMesa(): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id) return;

    if (!this.puedeLiberarMesa) {
      this.flash("Esta mesa ya tiene consumo: cancela los renglones o cóbrala");
      return;
    }

    const permiso = await autorizacion.solicitar(
      "pos.orden.abrir",
      undefined,
      `liberar la mesa ${this.nombreMesaActiva}`,
    );
    if (!permiso.ok) return;

    const mesa = this.nombreMesaActiva;
    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("orden_anulada", orden_id, {
        orden_id,
        motivo: "Se liberó sin consumo",
      }),
    );
    this.flash(`Mesa ${mesa} libre`);
  }

  abrirMesa(mesaId: ID): ID {
    /*
     * Si la mesa YA está en servicio, se devuelve su cuenta. Abrir otra dejaba
     * la primera huérfana: lo que ya habían pedido desaparecía de la pantalla y
     * nadie lo cobraba. Pasa en cuanto dos meseros tocan la misma mesa.
     */
    const enCurso = this.ordenActiva(mesaId);
    if (enCurso) return enCurso;

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

  /** Agrega a la cuenta lo que se configuró (o un producto simple). */
  async agregar(config: ConfiguracionRenglon): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.item.agregar");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.asegurarOrden();
    const renglon = construirRenglon(config, catalogo, impuestos[0]!);
    this.emitir(this.mesaActiva, fabrica.crear("item_agregado", orden_id, { orden_id, renglon }));

    const cuantos = config.cantidad > 1 ? `${config.cantidad}× ` : "";
    this.flash(`${cuantos}${renglon.descripcion} · mesa ${this.nombreMesaActiva}`);
  }

  /** Atajo para productos que no requieren configuración. */
  async agregarSimple(productoId: ID): Promise<void> {
    await this.agregar({ producto_id: productoId, cantidad: 1 });
  }

  /** Agrega lo que está en el configurador y lo cierra. */
  async agregarConfigurado(): Promise<void> {
    const config = configurador.config;
    if (!config || !configurador.listo) return;
    await this.agregar(config);
    configurador.cerrar();
  }

  async cambiarCantidad(renglonId: ID, delta: number): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    const renglon = this.renglones.find((r) => r.id === renglonId);
    if (!orden_id || !renglon) return;

    const cantidad = renglon.cantidad + delta;
    if (cantidad <= 0) {
      await this.cancelar(renglonId);
      return;
    }
    if (cantidad > 99) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("item_modificado", orden_id, { orden_id, renglon_id: renglonId, cantidad }),
    );
  }

  /**
   * Cambia las indicaciones de un platillo ya capturado.
   *
   * Existe porque el comensal casi nunca lo dice todo de una vez: pide la
   * hamburguesa y, cuando el mesero ya la marcó, añade que la quiere sin
   * tomate. Sin esto habría que cancelar el renglón y volver a capturarlo,
   * que además falsea el reporte de cancelaciones.
   *
   * Si el platillo ya se fue a cocina, el dominio marca el cambio para que el
   * tablero lo señale: quien leyó el ticket hace tres minutos no lo va a releer.
   */
  /**
   * Pone nombre al pedido.
   *
   * Nace para los PARA LLEVAR: sin un nombre, cocina prepara y nadie sabe de
   * quién es la bolsa que está en el mostrador. En mesa también sirve, para una
   * cuenta a nombre de un cliente frecuente.
   *
   * El nombre viaja como dato y no solo como `cliente_id` porque la mayoría de
   * los pedidos para llevar son de alguien que no está registrado, y obligar a
   * darlo de alta para poder venderle sería absurdo.
   */
  async identificar(nombre: string, telefono?: string, clienteId?: ID): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    const limpio = nombre.trim();
    if (!orden_id || limpio === "") return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("orden_identificada", orden_id, {
        orden_id,
        nombre: limpio,
        telefono: telefono?.trim() || undefined,
        cliente_id: clienteId,
      }),
    );
  }

  async cambiarNotas(renglonId: ID, notas: string): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    const renglon = this.renglones.find((r) => r.id === renglonId);
    if (!orden_id || !renglon) return;

    const limpias = notas.trim();
    if (limpias === (renglon.notas ?? "")) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("item_modificado", orden_id, {
        orden_id,
        renglon_id: renglonId,
        notas: limpias,
      }),
    );
  }

  /** Cocina se da por enterada de un cambio de indicaciones. */
  async marcarCambioVisto(ordenId: ID, renglonId: ID): Promise<void> {
    const mesa = this.mesaDeOrden(ordenId);
    if (!mesa) return;

    this.sincronizarActor();
    this.emitir(
      mesa,
      fabrica.crear("cambio_visto", ordenId, { orden_id: ordenId, renglon_id: renglonId }),
    );
  }

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

  async enviarACocina(): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.item.enviar_cocina");
    if (!permiso.ok) return;
    this.sincronizarActor();

    const orden_id = this.ordenActiva(this.mesaActiva);
    const porEnviar = this.pendientes;
    if (!orden_id || porEnviar.length === 0) return;

    const envio = fabrica.crear("items_enviados", orden_id, {
      orden_id,
      renglon_ids: porEnviar.map((r) => r.id),
    });
    this.emitir(this.mesaActiva, envio);

    // Al salir a cocina, lo que se va del almacén se descuenta. Solo aplica a
    // los insumos que declararon su vínculo desde la receta; un restaurante que
    // no lleva inventario simplemente no mueve nada.
    const movidos = inventario.consumirPorReceta(
      porEnviar,
      envio.id,
      sesion.usuarioActual?.id,
    );

    // La comanda impresa sale por estación, para que cada una reciba solo lo
    // suyo. Se hace al final y sin esperar: si la impresora está apagada, el
    // platillo ya salió a cocina en el KDS de todos modos.
    const impresas = this.imprimirComanda(orden_id, porEnviar);

    const cuantos = `${porEnviar.length} ${porEnviar.length === 1 ? "platillo enviado" : "platillos enviados"} a cocina`;
    const detalles = [
      movidos > 0 ? `${movidos} insumos descontados` : "",
      impresas > 0 ? `${impresas} comanda${impresas === 1 ? "" : "s"} impresa${impresas === 1 ? "" : "s"}` : "",
    ].filter(Boolean);

    this.flash(detalles.length > 0 ? `${cuantos} · ${detalles.join(" · ")}` : cuantos);
  }

  /** Agrupa lo enviado por estación y lo manda a la impresora de cada una. */
  private imprimirComanda(ordenId: ID, renglones: readonly RenglonComanda[]): number {
    const porEstacion = new Map<ID, { cantidad: number; descripcion: string; detalle?: string; notas?: string }[]>();

    for (const renglon of renglones) {
      /*
       * Lo que no tiene estación se rutea al área "caja".
       *
       * Es un ruteo explícito, no un comodín: la impresora de caja imprime esto
       * porque declara el área "caja", igual que la de barra imprime lo suyo. Si
       * el local no quiere ese papel, le quita el área a la impresora y deja de
       * salir — que es justo lo que antes no se podía hacer, porque `impresoraPara`
       * caía a la caja por su cuenta cuando ninguna otra reclamaba el área.
       */
      const estacion = renglon.estacion_id ?? "caja";
      const lista = porEstacion.get(estacion) ?? [];
      lista.push({
        cantidad: renglon.cantidad,
        descripcion: renglon.descripcion,
        detalle: renglon.detalle,
        notas: renglon.notas,
      });
      porEstacion.set(estacion, lista);
    }

    return impresion.comanda(
      {
        orden_id: ordenId,
        mesa: this.nombreMesaActiva,
        // A nombre de quién va: en un pedido para llevar es lo único que sirve
        // para entregar la bolsa correcta.
        a_nombre_de: this.comanda?.a_nombre_de,
        mesero: sesion.usuarioActual?.nombre ?? "—",
        ts: Date.now(),
        renglones: [],
      },
      porEstacion,
    );
  }

  // --- Descuentos, cortesías y propina ------------------------------------------------

  async aplicarDescuento(porcentaje: number, motivo: string): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id) return;

    const permiso = await autorizacion.solicitar(
      "pos.descuento.aplicar",
      { porcentaje },
      `${Math.round(porcentaje * 100)} % · mesa ${this.nombreMesaActiva}`,
    );
    if (!permiso.ok) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "cuenta",
        modo: "porcentaje",
        valor: porcentaje,
        motivo,
        autorizador_id: permiso.autorizador_id ?? sesion.usuarioActual?.id,
      }),
    );
    this.flash(`Descuento de ${Math.round(porcentaje * 100)} % aplicado`);
  }

  /** ¿Está ya en cortesía este renglón —o la cuenta entera, si no se pasa uno—? */
  tieneCortesia(renglonId?: ID): boolean {
    return (this.comanda?.cortesias ?? []).some((c) => c.renglon_id === renglonId);
  }

  /**
   * El botón de cortesía es un INTERRUPTOR: si ya está puesta, la quita.
   *
   * Se pulsaba por error y no había vuelta atrás salvo cancelar la cuenta
   * entera. Que el mismo botón haga y deshaga es además lo que la gente espera
   * de un botón que se queda encendido.
   */
  async alternarCortesia(renglonId: ID | undefined, motivo: string): Promise<void> {
    if (this.tieneCortesia(renglonId)) {
      await this.retirarCortesia(renglonId);
      return;
    }
    await this.otorgarCortesia(renglonId, motivo);
  }

  async otorgarCortesia(renglonId: ID | undefined, motivo: string): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id) return;

    const contexto = renglonId
      ? this.renglones.find((r) => r.id === renglonId)?.descripcion
      : `cuenta completa · mesa ${this.nombreMesaActiva}`;
    const permiso = await autorizacion.solicitar("pos.cortesia.otorgar", undefined, contexto);
    if (!permiso.ok) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("cortesia_otorgada", orden_id, {
        orden_id,
        renglon_id: renglonId,
        motivo,
        autorizador_id: permiso.autorizador_id ?? sesion.usuarioActual?.id,
      }),
    );
    this.flash("Cortesía registrada");
  }

  /**
   * Quita una cortesía ya puesta.
   *
   * **No pide autorización, y es deliberado.** Retirar una cortesía SUBE la
   * cuenta: no hay forma de sacar dinero del negocio con esto, así que exigir la
   * firma de un gerente solo serviría para dejar regalada la cuenta de quien
   * pulsó el botón por equivocación mientras alguien va a buscarlo. Queda
   * registrado quién lo hizo, que es lo que importa aquí.
   */
  async retirarCortesia(renglonId?: ID): Promise<void> {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id || !this.tieneCortesia(renglonId)) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("cortesia_retirada", orden_id, {
        orden_id,
        renglon_id: renglonId,
        autorizador_id: sesion.usuarioActual?.id,
      }),
    );
    this.flash("Cortesía retirada");
  }

  /**
   * Vuelve a abrir una cuenta ya cobrada.
   *
   * Pasa en cualquier servicio: se cobró de más, el cliente quiere agregar algo
   * después de pedir la cuenta, o se cobró en la mesa equivocada. Sin esto la
   * única salida es cobrar otra vez y descuadrar el corte.
   *
   * NO borra los pagos: fueron hechos y siguen a la vista, para devolverlos si
   * corresponde. Reabrir sin dejar rastro sería la forma más limpia de sacar
   * dinero de una caja, así que exige autorización y queda en la bitácora.
   */
  async reabrirCuenta(motivo: string): Promise<boolean> {
    const orden_id = this.ordenDeLaMesa(this.mesaActiva);
    // `ultimaCobrada` y no `cerrada` a secas: una sentada liberada sin consumo
    // también está cerrada, y reabrirla dejaría una mesa ocupada sin cuenta.
    if (!orden_id || !this.ultimaCobrada) return false;

    const limpio = motivo.trim();
    if (limpio.length < 3) {
      this.flash("Escribe por qué se reabre la cuenta");
      return false;
    }

    const permiso = await autorizacion.solicitar(
      "pos.cuenta.reabrir",
      undefined,
      `mesa ${this.nombreMesaActiva}`,
    );
    if (!permiso.ok) return false;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("cuenta_reabierta", orden_id, {
        orden_id,
        motivo: limpio,
        autorizador_id: permiso.autorizador_id ?? sesion.usuarioActual?.id,
      }),
    );
    this.flash("Cuenta reabierta · los pagos anteriores siguen registrados");
    return true;
  }

  /**
   * Registra un AJUSTE de propina. El evento es un incremento, no un total: el
   * reducer suma lo que llegue, así que corregir a la baja exige un negativo.
   *
   * Por eso solo se rechaza el ajuste que dejaría la propina en negativo, y no
   * cualquier negativo. Cuando se filtraba `monto <= 0`, «Quitar» y bajar de
   * 20 % a 10 % emitían un ajuste negativo que se descartaba en silencio: la
   * pantalla seguía mostrando la propina vieja y esa cifra se cobraba.
   */
  registrarPropina(ajuste: Centavos): void {
    const orden_id = this.ordenActiva(this.mesaActiva);
    if (!orden_id || ajuste === 0) return;

    const actual = this.totales?.propina ?? CERO;
    if (actual + ajuste < 0) return;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("propina_registrada", orden_id, { orden_id, monto: ajuste }),
    );
  }

  /**
   * Deja la propina de la cuenta EXACTAMENTE en este monto.
   *
   * Es lo que necesita quien cobra: en la mesa se dice «déjale 100», no «súmale
   * 40 a los 60 que ya tenía». Se traduce a un ajuste porque el evento es un
   * incremento, y así corregir una cifra mal tecleada no acumula.
   */
  fijarPropina(monto: Centavos): void {
    const t = this.totales;
    if (!t || monto < 0) return;
    this.registrarPropina(restar(monto, t.propina));
  }

  /** Propina como porcentaje del total de la cuenta. */
  propinaPorcentaje(fraccion: number): void {
    const t = this.totales;
    if (!t) return;
    this.fijarPropina(Math.round(t.total * fraccion) as Centavos);
  }

  // --- Dividir y traspasar ---------------------------------------------------------------

  /**
   * Divide el importe en N partes exactas. No parte la cuenta: registra N pagos
   * parciales, que es lo que ocurre de verdad cuando se reparte la cuenta.
   */
  async dividirEnPartes(partes: number, forma: FormaPago = "efectivo"): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.cuenta.dividir");
    if (!permiso.ok) return;

    const orden_id = this.ordenActiva(this.mesaActiva);
    const t = this.totales;
    if (!orden_id || !t || partes < 2) return;

    this.sincronizarActor();
    const trozos = repartir(sumar(t.total, t.propina), partes);
    for (const monto of trozos) {
      this.emitir(
        this.mesaActiva,
        fabrica.crear("pago_registrado", orden_id, { orden_id, monto, forma }),
      );
    }
    this.emitir(this.mesaActiva, fabrica.crear("cuenta_cerrada", orden_id, { orden_id }));
    this.flash(`Cuenta dividida en ${partes} · mesa ${this.nombreMesaActiva} liberada`);
  }

  /** Traspasa un renglón a otra mesa, abriéndola si hace falta. */
  async traspasarRenglon(renglonId: ID, aMesaId: ID): Promise<void> {
    const permiso = await autorizacion.solicitar("pos.cuenta.transferir");
    if (!permiso.ok) return;

    const origen = this.ordenActiva(this.mesaActiva);
    const renglon = this.renglones.find((r) => r.id === renglonId);
    if (!origen || !renglon || aMesaId === this.mesaActiva) return;

    this.sincronizarActor();
    const destino = this.ordenActiva(aMesaId) ?? this.abrirMesa(aMesaId);

    this.emitir(
      this.mesaActiva,
      fabrica.crear("item_transferido", origen, {
        orden_id: origen,
        renglon_id: renglonId,
        a_orden_id: destino,
      }),
    );
    this.emitir(
      aMesaId,
      fabrica.crear("item_recibido", destino, {
        orden_id: destino,
        renglon,
        de_orden_id: origen,
      }),
    );
    this.flash(`"${renglon.descripcion}" traspasado a la mesa ${plano.nombreMesa(aMesaId)}`);
  }

  // --- Cobro -------------------------------------------------------------------------------

  /** Registra un pago. Si es efectivo, `recibido` permite calcular el cambio. */
  async cobrar(forma: FormaPago, monto: Centavos, recibido?: Centavos): Promise<void> {
    await this.registrarPagos([{ forma, monto, recibido }]);
  }

  /**
   * Cobro repartido entre efectivo y tarjeta, que es de lo más común: la mesa
   * junta lo que trae suelto y el resto lo pasa con plástico.
   *
   * **No se inventa una forma de pago «mixto».** Se registran DOS pagos reales,
   * uno de cada forma, y esa es toda la decisión de diseño: el corte de caja
   * necesita saber cuánto entró al cajón —que es lo que se cuenta a mano al
   * cerrar— y las finanzas necesitan saber cuánto se depositará por terminal.
   * Una etiqueta «mixto» perdería las dos cifras justo donde hacen falta.
   */
  async cobrarMixto(
    enEfectivo: Centavos,
    formaTarjeta: FormaPago,
    total: Centavos,
    recibido?: Centavos,
  ): Promise<void> {
    // El efectivo nunca puede pasarse del total: lo que sobra es cambio, no un
    // cobro de más, y cargarlo como pago dejaría la cuenta con saldo negativo.
    const efectivo = Math.min(Math.max(enEfectivo, 0), total) as Centavos;
    const conTarjeta = restar(total, efectivo);

    await this.registrarPagos([
      { forma: "efectivo", monto: efectivo, recibido },
      { forma: formaTarjeta, monto: conTarjeta },
    ]);
  }

  /**
   * Carga parte —o toda— la cuenta a la bolsa mensual de un socio.
   *
   * **Es un COBRO, no una cortesía**, y de ahí cuelga todo lo demás: la venta se
   * registra a precio de carta y sigue contando completa en finanzas y en
   * inteligencia. Lo único distinto es de dónde salió el dinero: del trato con
   * el socio y no del cajón. Registrarlo como cortesía habría borrado del
   * reporte unas ventas que sí ocurrieron —y en un local donde los socios comen
   * seguido, eso falsea el consumo de insumos y el ticket promedio.
   *
   * Quién es el socio viaja en el propio pago: sin eso el consumo no se le
   * puede descontar a nadie a fin de mes.
   */
  async cobrarASocio(socioId: ID, monto: Centavos, nombreSocio: string): Promise<boolean> {
    const t = this.totales;
    if (!t || monto <= 0) return false;

    // Nunca más que el saldo: lo que sobra no es un cobro de más, es que se
    // tecleó mal, y dejaría la cuenta con saldo negativo.
    const cargo = Math.min(monto, t.saldo) as Centavos;
    if (cargo <= 0) return false;

    const ok = await this.registrarPagos(
      [{ forma: "socio", monto: cargo, socio_id: socioId }],
      { accion: "pos.socio.consumir", contexto: `${nombreSocio} · mesa ${this.nombreMesaActiva}` },
    );
    return ok;
  }

  /**
   * Asienta uno o varios pagos de la misma cuenta y, si ya no queda saldo, la
   * cierra e imprime el ticket.
   *
   * Va todo junto a propósito: el cierre y la impresión tienen que ocurrir una
   * sola vez aunque el cobro se haya repartido en dos formas de pago.
   */
  private async registrarPagos(
    pagos: readonly {
      forma: FormaPago;
      monto: Centavos;
      recibido?: Centavos;
      socio_id?: ID;
    }[],
    opciones?: { accion?: Accion; contexto?: string },
  ): Promise<boolean> {
    const permiso = await autorizacion.solicitar(
      opciones?.accion ?? "pos.cobro.registrar",
      undefined,
      opciones?.contexto,
    );
    if (!permiso.ok) return false;

    const orden_id = this.ordenActiva(this.mesaActiva);
    const validos = pagos.filter((p) => p.monto > 0);
    if (!orden_id || !this.hayCuenta || validos.length === 0) return false;

    this.sincronizarActor();
    for (const pago of validos) {
      this.emitir(
        this.mesaActiva,
        fabrica.crear("pago_registrado", orden_id, {
          orden_id,
          monto: pago.monto,
          forma: pago.forma,
          recibido: pago.recibido,
          socio_id: pago.socio_id,
          autorizador_id: permiso.autorizador_id,
        }),
      );
    }

    // Si ya no queda saldo, la cuenta se cierra y la mesa se libera.
    const t = this.totales;
    if (t && t.saldo <= 0) {
      const mesa = this.nombreMesaActiva;
      const comanda = this.comanda;
      // El ticket se arma ANTES de cerrar, mientras la comanda sigue completa.
      if (comanda) this.imprimirTicket(comanda, t);

      this.emitir(this.mesaActiva, fabrica.crear("cuenta_cerrada", orden_id, { orden_id }));
      this.flash(
        t.cambio > 0
          ? `Mesa ${mesa} cobrada · cambio ${(t.cambio / 100).toFixed(2)}`
          : `Mesa ${mesa} cobrada · liberada`,
      );
    } else {
      this.flash("Pago parcial registrado");
    }
    return true;
  }

  /**
   * Manda el ticket a la impresora de caja.
   *
   * Las cifras vienen YA CALCULADAS de los totales de la comanda: recalcularlas
   * al imprimir abriría la puerta a que el papel diga una cosa y la cuenta otra,
   * y el papel es el que se lleva el cliente.
   */
  /**
   * Imprime la cuenta para llevarla a la mesa, antes de cobrar.
   *
   * Aquí cada renglón sale **con su impuesto dentro**, y esa es toda la razón
   * de que exista esta función en vez de reusar el ticket. En la carta de
   * Rodizio el precio NO incluye IVA (perfil `IVA_16`, `incluido_en_precio:
   * false`), así que el ticket imprime la base por renglón y suma el IVA al
   * final. Ese papel es correcto como comprobante pero ilegible en una mesa:
   * quien lo recibe suma los renglones, no le da el total, y llama al mesero.
   *
   * No emite ningún evento: pedir la cuenta no mueve dinero ni cambia la
   * comanda. Lo que sí queda registrado es el cobro, después.
   */
  imprimirPrecuenta(): boolean {
    const comanda = this.comanda;
    const t = this.totales;
    if (!comanda || !t) return false;

    const renglones = renglonesActivos(comanda).map((r) => ({
      cantidad: r.cantidad,
      descripcion: r.descripcion,
      detalle: r.detalle,
      // `.total` es lo que paga el comensal por ese renglón: si el precio ya
      // traía el impuesto lo deja igual, y si no, se lo agrega.
      importe: desglosarConTasas(importeRenglon(r), r.impuesto).total,
    }));

    const suma = renglones.reduce((acc, r) => (acc + r.importe) as Centavos, 0 as Centavos);

    /*
     * Las rebajas se derivan de la diferencia, no se recalculan.
     *
     * Los totales aplican descuentos sobre la base y DESPUÉS el impuesto, así
     * que la rebaja que ve el comensal trae también su parte de IVA. Restando
     * `suma - total` se obtiene esa cifra exacta, y el papel cuadra siempre;
     * calcularla por separado dejaría descuadres de centavos en el documento
     * que el cliente tiene en la mano.
     */
    const rebaja = Math.max(0, suma - t.total);
    const rebajable = t.descuentos + t.cortesias;
    const descuentos = (
      rebajable > 0 ? Math.round((rebaja * t.descuentos) / rebajable) : 0
    ) as Centavos;
    const cortesias = (rebaja - descuentos) as Centavos;

    impresion.precuenta({
      folio: comanda.orden_id.slice(-8).toUpperCase(),
      ts: Date.now(),
      local: {
        nombre: datosLocal.nombre,
        direccion: datosLocal.direccion,
        telefono: datosLocal.telefono,
      },
      mesa: this.nombreMesaActiva,
      mesero: sesion.nombreDe(comanda.mesero_id),
      renglones,
      suma,
      descuentos,
      cortesias,
      total: t.total,
    });

    this.flash("Cuenta impresa");
    return true;
  }

  /**
   * Vuelve a imprimir el ticket de la cuenta.
   *
   * El cliente pide otra copia todos los días. Se registra porque una
   * reimpresión es un clásico vector de fraude —se cobra, se entrega el ticket,
   * se reimprime y se cobra otra vez con el mismo papel—: el papel sale marcado
   * «REIMPRESIÓN #n» y el hecho queda en la bitácora. Ninguna de las dos cosas
   * por separado basta.
   */
  async reimprimirTicket(): Promise<boolean> {
    const orden_id = this.ordenDeLaMesa(this.mesaActiva);
    const comanda = this.comanda;
    const t = this.totales;
    if (!orden_id || !comanda || !t) return false;

    const numero = (comanda.reimpresiones ?? 0) + 1;

    this.sincronizarActor();
    this.emitir(
      this.mesaActiva,
      fabrica.crear("ticket_reimpreso", orden_id, { orden_id, numero }),
    );
    this.imprimirTicket(comanda, t, numero);
    this.flash(`Ticket reimpreso (copia ${numero})`);
    return true;
  }

  private imprimirTicket(
    comanda: EstadoComanda,
    t: TotalesComanda,
    reimpresion?: number,
  ): void {
    impresion.ticket({
      reimpresion,
      folio: comanda.orden_id.slice(-8).toUpperCase(),
      ts: Date.now(),
      local: datosLocal,
      mesa: this.nombreMesaActiva,
      mesero: sesion.nombreDe(comanda.mesero_id),
      renglones: renglonesActivos(comanda).map((r) => ({
        cantidad: r.cantidad,
        descripcion: r.descripcion,
        detalle: r.detalle,
        importe: (r.precio_unitario * r.cantidad) as Centavos,
      })),
      subtotal: t.subtotal,
      descuentos: t.descuentos,
      cortesias: t.cortesias,
      iva: t.iva,
      ieps: t.ieps,
      total: t.total,
      propina: t.propina,
      pagos: comanda.pagos.map((p) => ({
        forma: etiquetaFormaPago(p.forma),
        monto: p.monto,
      })),
      cambio: t.cambio,
    });
  }

  /** Cobro rápido del total pendiente en efectivo. */
  async cobrarTodo(forma: FormaPago = "efectivo"): Promise<void> {
    const t = this.totales;
    if (!t) return;
    await this.cobrar(forma, t.saldo);
  }
}

export const pos = new TiendaPOS();
export { pesos };
