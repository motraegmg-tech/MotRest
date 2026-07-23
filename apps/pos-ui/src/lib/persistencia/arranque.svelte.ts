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
  type EventoComanda,
  type EventoFiscal,
  type EventoIdentidad,
  type EventoInventario,
} from "@motrest/dominio";
import { almacenEnMemoria, almacenIndexedDB, type Almacen } from "@motrest/protocolo-sync";
import { asistencia } from "../asistencia.svelte";
import { catalogo, impuestos, menuSemilla } from "../catalogo";
import { fiscal } from "../fiscal.svelte";
import { impresion } from "../impresion.svelte";
import { EXISTENCIAS_INICIALES } from "../insumos";
import { inventario } from "../inventario.svelte";
import { menu } from "../menu.svelte";
import { plano } from "../plano.svelte";
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
  "items_enviados",
  "item_en_marcha",
  "item_listo",
  "item_entregado",
  "descuento_aplicado",
  "cortesia_otorgada",
  "propina_registrada",
  "pago_registrado",
  "cuenta_cerrada",
]);

/** Eventos del ciclo fiscal (CFDI). */
const TIPOS_FISCALES = new Set([
  "cfdi_generado",
  "cfdi_timbrado",
  "cfdi_rechazado",
  "cfdi_cancelado",
]);

/** Eventos de almacén. */
const TIPOS_INVENTARIO = new Set(["movimiento_inventario", "conteo_registrado"]);

/** Eventos del checador. */
const TIPOS_ASISTENCIA = new Set(["checada_registrada"]);

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
      await menu.hidratar(almacen, menuSemilla);
      await impresion.hidratar(almacen);

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
              !TIPOS_ASISTENCIA.has(e.tipo),
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
      }

      // A partir de aquí, cada evento emitido se persiste.
      pos.conectarAlmacen(almacen);
      sesion.conectarAlmacen(almacen);
      plano.conectarAlmacen(almacen);
      fiscal.conectarAlmacen(almacen);
      inventario.conectarAlmacen(almacen);
      menu.conectarAlmacen(almacen);
      asistencia.conectarAlmacen(almacen);

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

    const logs = sembrarSalon({
      catalogo,
      impuestoPorDefecto: impuestos[0]!,
      fabrica: fabricaPos,
    });

    const eventos = Object.values(logs).flat();
    await almacen.eventos.anexar(eventos);
    pos.hidratar(eventos.sort(compararEventos));
    await sesion.hidratar([], almacen);
    await fiscal.hidratar([], almacen);
    inventario.hidratar([]);
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
    if (inventario.activo) return;
    for (const [insumoId, cantidad] of EXISTENCIAS_INICIALES) {
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
