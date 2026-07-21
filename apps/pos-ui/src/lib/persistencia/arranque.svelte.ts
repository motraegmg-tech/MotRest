/**
 * Arranque de la aplicación: abre el almacén local, rehidrata los stores desde
 * el event log y, si no hay nada guardado, siembra la demostración.
 *
 * A partir de aquí recargar el navegador ya no pierde la operación.
 */
import {
  compararEventos,
  type EventoComanda,
  type EventoFiscal,
  type EventoIdentidad,
} from "@motrest/dominio";
import { almacenEnMemoria, almacenIndexedDB, type Almacen } from "@motrest/protocolo-sync";
import { catalogo, impuestos } from "../catalogo";
import { fiscal } from "../fiscal.svelte";
import { plano } from "../plano.svelte";
import { pos, fabricaPos } from "../pos.svelte";
import { sembrarSalon } from "../semilla";
import { sesion } from "../sesion/sesion.svelte";

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

class Arranque {
  cargando = $state(true);
  error = $state("");
  /** true = los datos viven solo en memoria (sin IndexedDB disponible). */
  efimero = $state(false);

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

      // El plano es catálogo: se carga antes que la operación, porque las
      // comandas se agrupan por las mesas que él define.
      await plano.hidratar(almacen);

      const guardados = await almacen.eventos.leerTodos();

      if (guardados.length === 0) {
        await this.sembrar();
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
          identidad.filter((e) => !TIPOS_FISCALES.has(e.tipo)) as EventoIdentidad[],
          almacen,
        );
        await fiscal.hidratar(
          ordenados.filter((e) => TIPOS_FISCALES.has((e as EventoFiscal).tipo)) as EventoFiscal[],
          almacen,
        );
      }

      // A partir de aquí, cada evento emitido se persiste.
      pos.conectarAlmacen(almacen);
      sesion.conectarAlmacen(almacen);
      plano.conectarAlmacen(almacen);
      fiscal.conectarAlmacen(almacen);
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
