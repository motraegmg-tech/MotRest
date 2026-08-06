/**
 * Arranque de la aplicación: abre el almacén local, rehidrata los stores desde
 * el event log y, si no hay nada guardado, siembra la demostración.
 *
 * A partir de aquí recargar el navegador ya no pierde la operación.
 */
import {
  compararEventos,
  type EventoBase,
  type EventoAsistencia,
  type EventoCaja,
  type EventoCliente,
  type EventoComanda,
  type EventoCompra,
  type EventoEgreso,
  type EventoFiscal,
  type EventoIdentidad,
  type EventoInventario,
  type EventoOpinion,
  type EventoReserva,
  type EventoPrenomina,
} from "@motrest/dominio";
import { almacenEnMemoria, almacenIndexedDB, type Almacen } from "@motrest/protocolo-sync";
import { asistencia } from "../asistencia.svelte";
import { caja } from "../caja.svelte";
import { clientes } from "../clientes.svelte";
import { egresos } from "../egresos.svelte";
import { compras } from "../compras.svelte";
import { opiniones } from "../opiniones.svelte";
import { reservas } from "../reservas.svelte";
import { correo } from "../correo.svelte";
import { actualizaciones } from "../actualizaciones.svelte";
import { grupo } from "../grupo.svelte";
import { licencia } from "../licencia.svelte";
import { canales } from "../canales.svelte";
import { prenomina } from "../prenomina.svelte";
import { cartaVacia, catalogo, impuestos } from "../catalogo";
import { menuDemostracion } from "../demo/carta";
import { fiscal } from "../fiscal.svelte";
import { impresion } from "../impresion.svelte";
import { existenciasDemo } from "../insumos";
import { inventario } from "../inventario.svelte";
import { local } from "../local.svelte";
import { menu } from "../menu.svelte";
import { plano } from "../plano.svelte";
import { MODO_DEMO } from "../presentacion";
import { pos, fabricaPos } from "../pos.svelte";
import { sembrarSalon } from "../semilla";
import { sesion } from "../sesion/sesion.svelte";
import { sync } from "../sync.svelte";

/** Eventos de comanda reconocidos, para separar el log por familia. */
const TIPOS_COMANDA = new Set([
  "orden_creada",
  "item_agregado",
  "item_modificado",
  "item_cancelado",
  "item_transferido",
  "item_recibido",
  "orden_identificada",
  "items_enviados",
  "item_en_marcha",
  "item_listo",
  "item_entregado",
  "descuento_aplicado",
  "cortesia_otorgada",
  "propina_registrada",
  "pago_registrado",
  "cuenta_cerrada",
  "cuenta_reabierta",
  "ticket_reimpreso",
]);

/** Eventos del ciclo fiscal (CFDI), emisión y cancelación. */
const TIPOS_FISCALES = new Set([
  "cfdi_generado",
  "cfdi_timbrado",
  "cfdi_rechazado",
  "cfdi_cancelacion_solicitada",
  "cfdi_cancelado",
  "cfdi_cancelacion_rechazada",
]);

/** Eventos de almacén. */
const TIPOS_INVENTARIO = new Set(["movimiento_inventario", "conteo_registrado"]);

/** Eventos del checador. */
const TIPOS_ASISTENCIA = new Set(["checada_registrada"]);

/** Condiciones laborales: la tarifa por hora de cada quien. */
const TIPOS_PRENOMINA = new Set(["tarifa_asignada"]);

/** Voz del cliente. */
const TIPOS_OPINION = new Set(["opinion_registrada"]);
/** Reservas (M7). La lista de espera NO viaja: vive solo en su terminal. */
const TIPOS_RESERVA = new Set([
  "reserva_creada",
  "reserva_sentada",
  "reserva_cancelada",
  "reserva_no_llego",
]);
const TIPOS_EGRESO = new Set(["egreso_registrado", "egreso_anulado"]);

/** Eventos de compras (proveedores y ordenes). */
const TIPOS_COMPRA = new Set([
  "proveedor_registrado",
  "proveedor_actualizado",
  "proveedor_desactivado",
  "orden_compra_creada",
  "orden_compra_recibida",
  "orden_compra_cancelada",
  "equivalencia_aprendida",
]);

/** Eventos de caja (sesión de turno y corte). */
const TIPOS_CAJA = new Set([
  "caja_abierta",
  "movimiento_efectivo",
  "arqueo_registrado",
  "caja_cerrada",
]);

/** Eventos de clientes (ficha del comensal). */
const TIPOS_CLIENTE = new Set([
  "cliente_registrado",
  "cliente_actualizado",
  "cliente_desactivado",
]);

class Arranque {
  cargando = $state(true);
  error = $state("");
  /** true = los datos viven solo en memoria (sin IndexedDB disponible). */
  efimero = $state(false);
  /**
   * true = terminal recién emparejada y todavía sin datos: espera a que el Hub
   * le mande la operación del local en vez de sembrar una demostración propia.
   */
  esperandoHub = $state(false);

  private almacen: Almacen | null = null;

  get repositorio(): Almacen | null {
    return this.almacen;
  }

  async iniciar(): Promise<void> {
    try {
      this.almacen = await almacenIndexedDB();
    } catch (causa) {
      // Navegador en modo privado, permisos denegados… se opera en memoria.
      console.warn("Sin persistencia local; se opera en memoria", causa);
      this.almacen = almacenEnMemoria();
      this.efimero = true;
    }

    try {
      const almacen = this.almacen;

      // Plano y menú son CATÁLOGO: se cargan antes que la operación, porque las
      // comandas se agrupan por las mesas del plano y sus renglones se leen
      // contra los productos del menú.
      await plano.hidratar(almacen);
      /*
       * La carta de la demostración es SOLO para la demostración.
       *
       * Un local nuevo no puede abrir con las pizzas y los precios inventados de
       * otro: habría que borrarlos uno por uno, y el que se escape queda
       * vendible. En producción se arranca con la carta vacía y se carga la real
       * desde Administración → Catálogo, pegándola de una lista.
       */
      /*
       * Un `if` de sentencia y no un ternario: el empaquetador elimina la rama
       * apagada de un `if`, pero conserva la función que cuelga de un ternario
       * —y con ella toda la carta inventada—. Verificado sobre el bundle.
       */
      if (MODO_DEMO) {
        await menu.hidratar(almacen, menuDemostracion());
      } else {
        await menu.hidratar(almacen, cartaVacia());
      }
      await impresion.hidratar(almacen);
      await local.hidratar(almacen);

      // Con qué Hub trabaja esta terminal. Se resuelve ANTES de decidir si
      // sembrar, porque de eso depende la decisión.
      await sync.resolverDestino(almacen);

      const guardados = await almacen.eventos.leerTodos();

      if (guardados.length === 0) {
        // Una terminal que se une a un local existente NO inventa su propio
        // salón: recibe el que ya está operando. Sembrar aquí crearía órdenes
        // distintas para las mismas mesas en cada dispositivo, y el salón
        // aparecería duplicado en cuanto ambos sincronizaran.
        if (sync.configurado) {
          this.esperandoHub = true;
        } else {
          await this.sembrar();
        }
      } else {
        const ordenados = [...guardados].sort(compararEventos);
        const comanda = ordenados.filter((e) =>
          TIPOS_COMANDA.has((e as EventoComanda).tipo),
        ) as EventoComanda[];
        const identidad = ordenados.filter(
          (e) => !TIPOS_COMANDA.has((e as EventoComanda).tipo),
        ) as EventoIdentidad[];

        pos.hidratar(comanda);
        await sesion.hidratar(
          identidad.filter(
            (e) =>
              !TIPOS_FISCALES.has(e.tipo) &&
              !TIPOS_INVENTARIO.has(e.tipo) &&
              !TIPOS_ASISTENCIA.has(e.tipo) &&
              !TIPOS_EGRESO.has(e.tipo) &&
              !TIPOS_COMPRA.has(e.tipo) &&
              !TIPOS_CAJA.has(e.tipo) &&
              !TIPOS_CLIENTE.has(e.tipo) &&
              !TIPOS_PRENOMINA.has(e.tipo) &&
              !TIPOS_OPINION.has(e.tipo) &&
              !TIPOS_RESERVA.has(e.tipo),
          ) as EventoIdentidad[],
          almacen,
        );
        await fiscal.hidratar(
          ordenados.filter((e) => TIPOS_FISCALES.has((e as EventoFiscal).tipo)) as EventoFiscal[],
          almacen,
        );
        inventario.hidratar(
          ordenados.filter((e) =>
            TIPOS_INVENTARIO.has((e as EventoInventario).tipo),
          ) as EventoInventario[],
        );
        asistencia.hidratar(
          ordenados.filter((e) =>
            TIPOS_ASISTENCIA.has((e as EventoAsistencia).tipo),
          ) as EventoAsistencia[],
        );
        egresos.hidratar(
          ordenados.filter((e) =>
            TIPOS_EGRESO.has((e as EventoEgreso).tipo),
          ) as EventoEgreso[],
        );
        compras.hidratar(
          ordenados.filter((e) =>
            TIPOS_COMPRA.has((e as EventoCompra).tipo),
          ) as EventoCompra[],
        );
        caja.hidratar(
          ordenados.filter((e) =>
            TIPOS_CAJA.has((e as EventoCaja).tipo),
          ) as EventoCaja[],
        );
        clientes.hidratar(
          ordenados.filter((e) =>
            TIPOS_CLIENTE.has((e as EventoCliente).tipo),
          ) as EventoCliente[],
        );
        prenomina.hidratar(
          ordenados.filter((e) =>
            TIPOS_PRENOMINA.has((e as EventoPrenomina).tipo),
          ) as EventoPrenomina[],
        );
        opiniones.hidratar(
          ordenados.filter((e) =>
            TIPOS_OPINION.has((e as EventoOpinion).tipo),
          ) as EventoOpinion[],
        );
        reservas.hidratar(
          ordenados.filter((e) =>
            TIPOS_RESERVA.has((e as EventoReserva).tipo),
          ) as EventoReserva[],
        );
      }

      // A partir de aquí, cada evento emitido se persiste.
      pos.conectarAlmacen(almacen);
      sesion.conectarAlmacen(almacen);
      plano.conectarAlmacen(almacen);
      fiscal.conectarAlmacen(almacen);
      inventario.conectarAlmacen(almacen);
      menu.conectarAlmacen(almacen);
      asistencia.conectarAlmacen(almacen);
      egresos.conectarAlmacen(almacen);
      compras.conectarAlmacen(almacen);
      caja.conectarAlmacen(almacen);
      clientes.conectarAlmacen(almacen);
      prenomina.conectarAlmacen(almacen);
      opiniones.conectarAlmacen(almacen);
      reservas.conectarAlmacen(almacen);
      await correo.hidratar(almacen);
      await canales.hidratar(almacen);
      /*
       * La licencia y las actualizaciones las decide el Hub. Aquí solo se
       * recupera lo último que dijo, para que una terminal que enciende sin red
       * no se comporte como si no supiera nada — ni bloqueando de más ni
       * dejando pasar de más.
       */
      await licencia.hidratar(almacen);
      await actualizaciones.hidratar(almacen);
      await grupo.hidratar(almacen);

      // El almacén nace en la etapa 8: un dispositivo con operación anterior no
      // tiene ni un movimiento y abriría el inventario en ceros. Se carga aquí,
      // después de conectar, para que quede persistido como cualquier recepción.
      // Una terminal que espera al Hub no carga nada: el almacén del local ya
      // existe y le llegará por sincronización.
      if (!this.esperandoHub) this.cargarAlmacenInicial();

      // El enlace con el Hub va al final: si no hay Hub, o está apagado, el POS
      // ya quedó listo para operar en isla (TRD R3).
      sync.iniciar(
        (eventos) => this.aplicarDeOtros(eventos),
        () => void this.sembrarLocalVacio(),
      );
    } catch (causa) {
      this.error = causa instanceof Error ? causa.message : "Error al cargar los datos";
      console.error("Fallo al rehidratar", causa);
    } finally {
      this.cargando = false;
    }
  }

  private async sembrar(): Promise<void> {
    const almacen = this.almacen;
    if (!almacen) return;

    /*
     * El salón sembrado con comandas de ejemplo es SOLO para la demostración.
     * Una instalación real arranca con las mesas vacías: el restaurante dibuja
     * su propio plano y toma sus propios pedidos. Meterle mesa-12 con una pasta
     * al pesto a Rodizio sería confuso el primer día.
     */
    if (MODO_DEMO) {
      const logs = sembrarSalon({
        catalogo,
        impuestoPorDefecto: impuestos[0]!,
        fabrica: fabricaPos,
      });
      const eventos = Object.values(logs).flat();
      await almacen.eventos.anexar(eventos);
      pos.hidratar(eventos.sort(compararEventos));
    } else {
      pos.hidratar([]);
    }

    await sesion.hidratar([], almacen);
    await fiscal.hidratar([], almacen);
    inventario.hidratar([]);
    egresos.hidratar([]);
    compras.hidratar([]);
    caja.hidratar([]);
    clientes.hidratar([]);
    prenomina.hidratar([]);
    opiniones.hidratar([]);
    reservas.hidratar([]);
  }

  /**
   * Aplica lo que llegó de otras terminales.
   *
   * Los eventos ya se guardaron en el log local; aquí solo se reparten a los
   * stores para que la pantalla se entere. Cada uno reproyecta desde su log, así
   * que reaplicar algo que ya se tenía no rompe nada: las proyecciones son
   * funciones puras del log (ADR-02).
   */
  private aplicarDeOtros(eventos: readonly EventoBase[]): void {
    if (eventos.length === 0) return;
    // Ya llegó la operación del local: la terminal deja de estar en blanco.
    this.esperandoHub = false;
    const ordenados = [...eventos].sort(compararEventos);

    const comanda = ordenados.filter((e) =>
      TIPOS_COMANDA.has((e as EventoComanda).tipo),
    ) as EventoComanda[];
    if (comanda.length > 0) pos.integrar(comanda);

    const inv = ordenados.filter((e) =>
      TIPOS_INVENTARIO.has((e as EventoInventario).tipo),
    ) as EventoInventario[];
    if (inv.length > 0) inventario.integrar(inv);

    const checadas = ordenados.filter((e) =>
      TIPOS_ASISTENCIA.has((e as EventoAsistencia).tipo),
    ) as EventoAsistencia[];
    if (checadas.length > 0) asistencia.integrar(checadas);

    const salidas = ordenados.filter((e) =>
      TIPOS_EGRESO.has((e as EventoEgreso).tipo),
    ) as EventoEgreso[];
    if (salidas.length > 0) egresos.integrar(salidas);

    const compra = ordenados.filter((e) =>
      TIPOS_COMPRA.has((e as EventoCompra).tipo),
    ) as EventoCompra[];
    if (compra.length > 0) compras.integrar(compra);

    const cajaEv = ordenados.filter((e) =>
      TIPOS_CAJA.has((e as EventoCaja).tipo),
    ) as EventoCaja[];
    if (cajaEv.length > 0) caja.integrar(cajaEv);

    const clientesEv = ordenados.filter((e) =>
      TIPOS_CLIENTE.has((e as EventoCliente).tipo),
    ) as EventoCliente[];
    if (clientesEv.length > 0) clientes.integrar(clientesEv);

    const nomina = ordenados.filter((e) =>
      TIPOS_PRENOMINA.has((e as EventoPrenomina).tipo),
    ) as EventoPrenomina[];
    if (nomina.length > 0) prenomina.integrar(nomina);

    const opina = ordenados.filter((e) =>
      TIPOS_OPINION.has((e as EventoOpinion).tipo),
    ) as EventoOpinion[];
    if (opina.length > 0) opiniones.integrar(opina);

    const reserva = ordenados.filter((e) =>
      TIPOS_RESERVA.has((e as EventoReserva).tipo),
    ) as EventoReserva[];
    if (reserva.length > 0) reservas.integrar(reserva);
  }

  /**
   * El Hub existe pero el local está en blanco: esta terminal lo abre.
   *
   * Una terminal emparejada no siembra, porque lo normal es que se una a un
   * local que ya opera. Pero si el Hub no tiene ni un evento nadie va a
   * mandarle nada nunca, y quedarse esperando sería un cuelgue silencioso. La
   * primera terminal que llega a un local vacío es la que lo pone en marcha.
   */
  private async sembrarLocalVacio(): Promise<void> {
    if (!this.esperandoHub || !this.almacen) return;
    this.esperandoHub = false;

    await this.sembrar();
    this.cargarAlmacenInicial();
    // Lo sembrado sale hacia el Hub como cualquier otra operación.
    sync.empujar();
  }

  /**
   * Siembra las existencias de arranque, una sola vez, como una recepción de
   * compra: así el almacén se explica desde su primer movimiento y no aparece
   * como un saldo caído del cielo.
   */
  private cargarAlmacenInicial(): void {
    // Las existencias de arranque apuntan a los insumos de la DEMOSTRACIÓN. En
    // un local real esos insumos no existen, así que cargarlas no movería nada
    // y solo dejaría movimientos huérfanos en la bitácora.
    if (!MODO_DEMO || inventario.activo) return;
    for (const [insumoId, cantidad] of existenciasDemo()) {
      inventario.registrar(insumoId, cantidad, "recepcion", "Carga inicial del almacén");
    }
  }

  /** Borra todo lo guardado y recarga con la demostración de origen. */
  async reiniciarDemostracion(): Promise<void> {
    if (!this.almacen) return;
    await this.almacen.eventos.limpiar();
    await this.almacen.estado.limpiar();
    location.reload();
  }
}

export const arranque = new Arranque();
