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
  type EstadoEnlace,
} from "@motrest/protocolo-sync";
import type { Almacen } from "@motrest/protocolo-sync";
import type { EventoBase } from "@motrest/dominio";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_HUB = "hub_url";

class StoreSync {
  estado = $state<EstadoEnlace>("isla");
  detalle = $state<string>("");
  url = $state<string>("");
  /** Cuántos eventos llegaron de otras terminales en esta sesión. */
  recibidos = $state(0);

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
   * Prepara el enlace. Se llama al arrancar, después de rehidratar: si hay una
   * dirección guardada intenta conectar, y si no, se queda en isla sin ruido.
   */
  async iniciar(
    almacen: Almacen,
    alLlegar: (eventos: EventoBase[]) => void,
  ): Promise<void> {
    this.almacen = almacen;
    this.alLlegar = alLlegar;
    this.url = (await almacen.estado.cargar<string>(CLAVE_HUB)) ?? "";
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
      alCambiarEstado: (estado, detalle) => {
        this.estado = estado;
        this.detalle = detalle ?? "";
      },
    });

    void this.cliente.conectar();
  }

  /** Empuja lo pendiente ahora mismo. Se llama tras emitir un evento. */
  empujar(): void {
    void this.cliente?.empujar();
  }

  desconectar(): void {
    this.cliente?.desconectar();
    this.cliente = null;
    this.estado = "isla";
  }
}

export const sync = new StoreSync();
