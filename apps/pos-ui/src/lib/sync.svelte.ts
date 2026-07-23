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
  claveValida,
  etiquetaEnlace,
  type Almacen,
  type Catalogo,
  type EstadoEnlace,
  type TerminalRegistrada,
} from "@motrest/protocolo-sync";
import type { EventoBase, MenuLocal, PlanoLocal } from "@motrest/dominio";
import { CLAVE_MENU, menu } from "./menu.svelte";
import { CLAVE_PLANO, plano } from "./plano.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_HUB = "hub_url";
/**
 * Dónde vive la clave del local en este dispositivo.
 *
 * Va en el almacén de estado, junto a las credenciales, y NUNCA en el event
 * log: el log es la bitácora del negocio y se replica; un secreto ahí se
 * repartiría a todo el que sincronice.
 */
export const CLAVE_SECRETO = "clave_local";

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
  /** Terminales del local, según el Hub. Llegan por el canal cifrado. */
  terminales = $state<TerminalRegistrada[]>([]);
  /** Enlaces para emparejar otra terminal. LLEVAN la clave del local. */
  enlaces = $state<{ etiqueta: string; url: string }[]>([]);

  /** Clave del local. Nunca se muestra completa en pantalla. */
  private clave = $state("");

  private cliente: ClienteSync | null = null;
  private almacen: Almacen | null = null;
  private alLlegar: ((eventos: EventoBase[]) => void) | null = null;
  private alLocalVacio: (() => void) | null = null;

  /** Hay enlace posible cuando se sabe a dónde ir Y con qué clave hablar. */
  get configurado(): boolean {
    return this.url.trim().length > 0 && claveValida(this.clave);
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
  static hubEnLaUrl(): { url: string; clave: string } | null {
    if (typeof location === "undefined") return null;
    const parametros = new URLSearchParams(location.search);
    const url = parametros.get("hub")?.trim() ?? "";
    const clave = parametros.get("k")?.trim() ?? "";

    // Solo WebSocket: cualquier otra cosa en ese parámetro es un error o un
    // intento de que la terminal hable con algo que no es un Hub.
    if (!/^wss?:\/\//.test(url)) return null;
    // Sin clave del local no hay canal: el enlace está incompleto.
    if (!claveValida(clave)) return null;

    return { url, clave };
  }

  /**
   * Resuelve con qué Hub trabajar, SIN conectarse todavía.
   *
   * Se llama antes de decidir si sembrar la demostración: una terminal que se
   * une a un local existente no debe inventar su propio salón, tiene que
   * recibir el que ya está operando.
   */
  /**
   * Emparejamiento que inyecta el Hub al servir a su propio equipo.
   *
   * Es lo que hace que la caja funcione sin configurar nada: la aplicación
   * instalada abre y ya está enlazada con su Hub. Sin esto, la terminal del
   * equipo donde corre el Hub guardaba la operación en su navegador y el
   * registro del local quedaba vacío.
   */
  private static hubInyectado(): { url: string; clave: string } | null {
    const dato = (globalThis as { __MOTREST_HUB__?: { url?: string; clave?: string } })
      .__MOTREST_HUB__;
    if (!dato?.url || !claveValida(dato.clave ?? "")) return null;
    return { url: dato.url, clave: dato.clave! };
  }

  async resolverDestino(almacen: Almacen): Promise<void> {
    this.almacen = almacen;

    // El Hub propio manda sobre lo guardado: si esta terminal se movió a otro
    // local, lo que valga es el Hub desde el que se está abriendo ahora.
    const propio = StoreSync.hubInyectado();
    if (propio) {
      this.url = propio.url;
      this.clave = propio.clave;
      await almacen.estado.guardar(CLAVE_HUB, propio.url);
      await almacen.estado.guardar(CLAVE_SECRETO, propio.clave);
      return;
    }

    const deLaUrl = StoreSync.hubEnLaUrl();
    if (deLaUrl) {
      this.url = deLaUrl.url;
      this.clave = deLaUrl.clave;
      this.emparejadoAhora = true;
      await almacen.estado.guardar(CLAVE_HUB, deLaUrl.url);
      await almacen.estado.guardar(CLAVE_SECRETO, deLaUrl.clave);

      /*
       * La clave sale de la barra de direcciones en cuanto se guarda.
       *
       * Es una credencial: dejarla ahí la mete en el historial del navegador y
       * queda a la vista de quien pase junto a la terminal. Ya está a salvo en
       * el almacenamiento del dispositivo.
       */
      if (typeof history !== "undefined") {
        history.replaceState(null, "", location.pathname);
      }
      return;
    }

    this.url = (await almacen.estado.cargar<string>(CLAVE_HUB)) ?? "";
    this.clave = (await almacen.estado.cargar<string>(CLAVE_SECRETO)) ?? "";
  }

  /**
   * Abre el enlace. Se llama al final del arranque: si hay dirección conecta, y
   * si no, se queda en isla sin ruido.
   */
  iniciar(
    alLlegar: (eventos: EventoBase[]) => void,
    alLocalVacio?: () => void,
  ): void {
    this.alLlegar = alLlegar;
    this.alLocalVacio = alLocalVacio ?? null;
    if (this.configurado) this.conectar();
  }

  /**
   * Empareja la terminal con un enlace completo del Hub.
   *
   * Se acepta el enlace entero —dirección y clave juntas— porque es lo que
   * genera el Hub y lo que codificará el QR: pedir los dos campos por separado
   * invita a teclear mal 43 caracteres de clave.
   */
  async emparejar(enlace: string): Promise<{ ok: boolean; error?: string }> {
    const limpio = enlace.trim();
    if (limpio.length === 0) {
      await this.olvidar();
      return { ok: true };
    }

    let url = "";
    let clave = "";
    try {
      const partes = new URL(limpio);
      url = partes.searchParams.get("hub") ?? "";
      clave = partes.searchParams.get("k") ?? "";
    } catch {
      return { ok: false, error: "Ese no es un enlace de emparejamiento válido" };
    }

    if (!/^wss?:\/\//.test(url)) {
      return { ok: false, error: "El enlace no trae la dirección del Hub" };
    }
    if (!claveValida(clave)) {
      return { ok: false, error: "El enlace no trae la clave del local, o está incompleta" };
    }

    this.url = url;
    this.clave = clave;
    await this.almacen?.estado.guardar(CLAVE_HUB, url);
    await this.almacen?.estado.guardar(CLAVE_SECRETO, clave);

    this.cliente?.desconectar();
    this.cliente = null;
    this.conectar();
    return { ok: true };
  }

  /** Desliga la terminal del local y borra su clave. */
  async olvidar(): Promise<void> {
    this.cliente?.desconectar();
    this.cliente = null;
    this.url = "";
    this.clave = "";
    this.terminales = [];
    await this.almacen?.estado.eliminar(CLAVE_HUB);
    await this.almacen?.estado.eliminar(CLAVE_SECRETO);
    this.estado = "isla";
  }

  private conectar(): void {
    const almacen = this.almacen;
    if (!almacen) return;

    this.cliente = new ClienteSync({
      url: this.url,
      clave: this.clave,
      device_id: obtenerDeviceId(),
      sucursal_id: SUCURSAL_ID,
      almacen,
      alRecibir: (eventos) => {
        this.recibidos += eventos.length;
        this.alLlegar?.(eventos);
      },
      catalogosLocales: () => this.catalogosLocales(),
      alRecibirCatalogos: (catalogos) => this.aplicarCatalogos(catalogos),
      alRecibirTerminales: (terminales) => (this.terminales = terminales),
      alEncontrarLocalVacio: () => this.alLocalVacio?.(),
      alRecibirEnlaces: (enlaces) => (this.enlaces = enlaces),
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

  /**
   * Pide al Hub la lista de terminales.
   *
   * Va por el canal CIFRADO, no por HTTP: los identificadores de las terminales
   * son lo que alguien necesitaría para hacerse pasar por una de ellas, y por
   * una ruta en claro estarían a la vista de cualquiera en la red del local.
   */
  pedirTerminales(): void {
    this.cliente?.pedirTerminales();
  }

  /** Autoriza una terminal. El Hub comprueba que ESTA ya lo esté. */
  autorizar(deviceId: string): void {
    this.cliente?.autorizarTerminal(deviceId);
  }

  /** Retira la autorización de una terminal y la saca del local. */
  revocar(deviceId: string): void {
    this.cliente?.revocarTerminal(deviceId);
  }

  /** Pide el enlace de emparejamiento para mostrarlo como QR. */
  pedirEnlace(): void {
    this.cliente?.pedirEnlace();
  }

  get deviceId(): string {
    return obtenerDeviceId();
  }

  /** ¿Es esta misma terminal? Para señalarla en la lista. */
  esEstaTerminal(deviceId: string): boolean {
    return deviceId === obtenerDeviceId();
  }

  desconectar(): void {
    this.cliente?.desconectar();
    this.cliente = null;
    this.estado = "isla";
  }
}

export const sync = new StoreSync();
