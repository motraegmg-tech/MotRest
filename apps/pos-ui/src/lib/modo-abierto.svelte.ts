/**
 * El aviso de que este local acepta terminales sin autorizar.
 *
 * `MOTREST_HUB_ABIERTO=1` desactiva la aprobación de terminales: cualquier
 * equipo con la clave del local escribe en el registro de ventas sin que nadie
 * lo apruebe. Es una salida legítima para el primer arranque y las pruebas.
 *
 * ## Por qué esto vive aquí y no solo en la consola del Hub
 *
 * El Hub imprimía un cartel imposible de ignorar… en una consola que en la
 * aplicación instalada **no existe**: corre como proceso hijo y su salida se
 * descartaba. El aviso era técnicamente correcto y prácticamente invisible.
 *
 * Un aviso que solo existe en un stdout que nadie lee no es un aviso.
 */
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_MODO_ABIERTO = "modo_abierto";

class StoreModoAbierto {
  private datos = $state<{ activo: boolean }>({ activo: false });
  private almacen: Almacen | null = null;

  get activo(): boolean {
    return this.datos.activo;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<{ activo: boolean }>(CLAVE_MODO_ABIERTO);
    if (guardado) this.datos = guardado;
  }

  /** Lo que publica el Hub. Lo manda siempre, encendido o apagado. */
  fusionar(entrante: { activo: boolean }): void {
    this.datos = entrante;
    void this.almacen?.estado.guardar(CLAVE_MODO_ABIERTO, entrante).catch(() => {
      // Que no se pueda guardar no impide enseñarlo en esta sesión.
    });
  }
}

export const modoAbierto = new StoreModoAbierto();
