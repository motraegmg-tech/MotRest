/**
 * Enlace con el Hub del local.
 *
 * Envuelve al `ClienteSync` para exponer su estado a la interfaz. La regla que
 * manda: **nada de esto puede bloquear una venta.** Si no hay Hub configurado, o
 * está apagado, el POS opera en isla exactamente igual que antes de la etapa 10
 * (TRD R3).
 *
 * La dirección del Hub se guarda en el dispositivo, no en el código: cada local
 * tiene la suya y se captura desde Administración.
 */
import {
  ClienteSync,
  etiquetaEnlace,
  type Almacen,
  type Catalogo,
  type EstadoEnlace,
} from "@motrest/protocolo-sync";
import type { EventoBase, MenuLocal, PlanoLocal } from "@motrest/dominio";
import { CLAVE_MENU, menu } from "./menu.svelte";
import { CLAVE_PLANO, plano } from "./plano.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_HUB = "hub_url";

/** Una terminal registrada en el Hub. */
export interface DispositivoHub {
  device_id: string;
  nombre: string | null;
  aprobado: boolean;
  visto_ts: number;
  ultimo_seq: number;
  /** true = es este mismo dispositivo. */
  es_este?: boolean;
}

class StoreSync {
  estado = $state<EstadoEnlace>("isla");
  detalle = $state<string>("");
  url = $state<string>("");
  /** Cuántos eventos llegaron de otras terminales en esta sesión. */
  recibidos = $state(0);
  /** true = esta terminal se emparejó en este arranque, desde la URL. */
  emparejadoAhora = $state(false);
  /** Catálogos adoptados del local (menú, plano) en esta sesión. */
  catalogosRecibidos = $state(0);

  private cliente: ClienteSync | null = null;
  private almacen: Almacen | null = null;
  private alLlegar: ((eventos: EventoBase[]) => void) | null = null;

  get configurado(): boolean {
    return this.url.trim().length > 0;
  }

  get etiqueta(): string {
    return this.configurado ? etiquetaEnlace(this.estado) : "Sin Hub";
  }

  /**
   * Dirección del Hub que trae la URL de la página, si la trae.
   *
   * Es el emparejamiento de una terminal nueva: se abre con
   * `…/?hub=ws://192.168.1.10:8787/sync` y queda enlazada. Es exactamente lo
   * que codificará el QR de emparejamiento de la etapa 12; hoy se teclea o se
   * manda por mensaje.
   */
  static hubEnLaUrl(): string {
    if (typeof location === "undefined") return "";
    const parametro = new URLSearchParams(location.search).get("hub")?.trim();
    if (!parametro) return "";
    // Solo WebSocket: cualquier otra cosa en ese parámetro es un error o un
    // intento de que la terminal hable con algo que no es un Hub.
    return /^wss?:\/\//.test(parametro) ? parametro : "";
  }

  /**
   * Resuelve con qué Hub trabajar, SIN conectarse todavía.
   *
   * Se llama antes de decidir si sembrar la demostración: una terminal que se
   * une a un local existente no debe inventar su propio salón, tiene que
   * recibir el que ya está operando.
   */
  async resolverDestino(almacen: Almacen): Promise<void> {
    this.almacen = almacen;

    const deLaUrl = StoreSync.hubEnLaUrl();
    if (deLaUrl) {
      this.url = deLaUrl;
      this.emparejadoAhora = true;
      await almacen.estado.guardar(CLAVE_HUB, deLaUrl);
      return;
    }

    this.url = (await almacen.estado.cargar<string>(CLAVE_HUB)) ?? "";
  }

  /**
   * Abre el enlace. Se llama al final del arranque: si hay dirección conecta, y
   * si no, se queda en isla sin ruido.
   */
  iniciar(alLlegar: (eventos: EventoBase[]) => void): void {
    this.alLlegar = alLlegar;
    if (this.configurado) this.conectar();
  }

  /** Guarda la dirección del Hub y reconecta. */
  async configurar(url: string): Promise<void> {
    this.url = url.trim();
    await this.almacen?.estado.guardar(CLAVE_HUB, this.url);
    this.cliente?.desconectar();
    this.cliente = null;
    if (this.configurado) this.conectar();
    else this.estado = "isla";
  }

  private conectar(): void {
    const almacen = this.almacen;
    if (!almacen) return;

    this.cliente = new ClienteSync({
      url: this.url,
      device_id: obtenerDeviceId(),
      sucursal_id: SUCURSAL_ID,
      almacen,
      alRecibir: (eventos) => {
        this.recibidos += eventos.length;
        this.alLlegar?.(eventos);
      },
      catalogosLocales: () => this.catalogosLocales(),
      alRecibirCatalogos: (catalogos) => this.aplicarCatalogos(catalogos),
      alCambiarEstado: (estado, detalle) => {
        this.estado = estado;
        this.detalle = detalle ?? "";
      },
    });

    // Un cambio en la carta o en el plano se publica al instante: un mesero no
    // puede seguir vendiendo un platillo que se acaba de agotar en otra caja.
    menu.alPublicar((datos) => this.publicar(CLAVE_MENU, datos));
    plano.alPublicar((datos) => this.publicar(CLAVE_PLANO, datos));

    void this.cliente.conectar();
  }

  private publicar(clave: string, datos: { version: number; updated_at: number }): void {
    this.cliente?.publicarCatalogo({
      clave,
      version: datos.version,
      updated_at: datos.updated_at,
      datos,
    });
  }

  private catalogosLocales(): Catalogo[] {
    const catalogos: Catalogo[] = [];
    const actual = menu.menu;
    if (actual) {
      catalogos.push({
        clave: CLAVE_MENU,
        version: actual.version,
        updated_at: actual.updated_at,
        datos: actual,
      });
    }
    catalogos.push({
      clave: CLAVE_PLANO,
      version: plano.plano.version,
      updated_at: plano.plano.updated_at,
      datos: plano.plano,
    });
    return catalogos;
  }

  /** Adopta los catálogos del local. Cada store decide si el suyo es más viejo. */
  private aplicarCatalogos(catalogos: readonly Catalogo[]): void {
    for (const catalogo of catalogos) {
      if (catalogo.clave === CLAVE_MENU) {
        if (menu.fusionar(catalogo.datos as MenuLocal)) this.catalogosRecibidos += 1;
      } else if (catalogo.clave === CLAVE_PLANO) {
        if (plano.fusionar(catalogo.datos as PlanoLocal)) this.catalogosRecibidos += 1;
      }
    }
  }

  /** Empuja lo pendiente ahora mismo. Se llama tras emitir un evento. */
  empujar(): void {
    void this.cliente?.empujar();
  }

  /** La dirección HTTP del Hub, derivada del canal WebSocket. */
  get base(): string {
    if (!this.configurado) return "";
    return this.url.replace(/^ws/, "http").replace(/\/sync$/, "");
  }

  /** Terminales que conoce el Hub, para aprobarlas o revisarlas. */
  async dispositivos(): Promise<DispositivoHub[]> {
    if (!this.configurado) return [];
    try {
      const respuesta = await fetch(`${this.base}/dispositivos`);
      if (!respuesta.ok) return [];
      const lista = (await respuesta.json()) as DispositivoHub[];
      const propio = obtenerDeviceId();
      return lista.map((d) => ({ ...d, es_este: d.device_id === propio }));
    } catch {
      // El Hub apagado no es un error que reportar: ya lo dice el indicador.
      return [];
    }
  }

  /**
   * Autoriza una terminal a escribir en el log de ventas del local.
   *
   * Va firmada con el identificador de ESTA terminal: el Hub solo acepta la
   * autorización si quien la pide ya está autorizado.
   */
  async aprobar(deviceId: string): Promise<boolean> {
    if (!this.configurado) return false;
    const parametros = new URLSearchParams({
      device_id: deviceId,
      por: obtenerDeviceId(),
    });
    try {
      const respuesta = await fetch(`${this.base}/aprobar?${parametros}`, { method: "POST" });
      return respuesta.ok;
    } catch {
      return false;
    }
  }

  get deviceId(): string {
    return obtenerDeviceId();
  }

  desconectar(): void {
    this.cliente?.desconectar();
    this.cliente = null;
    this.estado = "isla";
  }
}

export const sync = new StoreSync();
