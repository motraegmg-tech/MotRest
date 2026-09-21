/**
 * El portal de autofactura de este local, tal como lo anuncia el Hub (1.5.6).
 *
 * Lo decide la nube —Gonzalo le pone clave al local en Central— y el Hub lo
 * reparte a TODAS las terminales en el catálogo reservado `autofactura_estado`,
 * encendido solo si además hay FacturAPI. Cualquier caja que imprima un ticket
 * lo necesita, no solo la que abre Finanzas.
 *
 * Se guarda en el almacén para que una terminal que enciende sin red siga
 * imprimiendo el QR: el código del ticket no depende del Hub (sale de la clave
 * del local) y el portal lo acepta en cuanto el Hub publique el ticket.
 */
import type { Almacen, EstadoAutofactura } from "@motrest/protocolo-sync";
import { CLAVE_AUTOFACTURA_ESTADO } from "@motrest/protocolo-sync";

export { CLAVE_AUTOFACTURA_ESTADO };

class StoreAutofactura {
  private datos = $state<EstadoAutofactura>({ activo: false });
  private almacen: Almacen | null = null;

  /** La clave y la dirección, solo si el portal está encendido. */
  get portal(): { clave: string; portal_url: string } | null {
    const { activo, clave, portal_url } = this.datos;
    return activo && clave && portal_url ? { clave, portal_url } : null;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<EstadoAutofactura>(CLAVE_AUTOFACTURA_ESTADO);
    if (guardado) this.datos = leer(guardado);
  }

  /** Lo que publica el Hub. Lo manda siempre, encendido o apagado. */
  fusionar(entrante: unknown): void {
    this.datos = leer(entrante);
    void this.almacen?.estado.guardar(CLAVE_AUTOFACTURA_ESTADO, { ...this.datos }).catch(() => {
      // Que no se pueda guardar no impide imprimir el QR en esta sesión.
    });
  }
}

/** Lo que no tiene forma de un portal encendido, se toma por apagado. */
function leer(dato: unknown): EstadoAutofactura {
  if (!dato || typeof dato !== "object") return { activo: false };
  const d = dato as Record<string, unknown>;
  if (d.activo !== true || typeof d.clave !== "string" || typeof d.portal_url !== "string") return { activo: false };
  if (!/^https:\/\//.test(d.portal_url)) return { activo: false };
  return { activo: true, clave: d.clave, portal_url: d.portal_url };
}

export const autofactura = new StoreAutofactura();
