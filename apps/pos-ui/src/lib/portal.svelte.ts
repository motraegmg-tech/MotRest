/**
 * El enlace que se le entrega al comensal para que entre a SU cuenta.
 *
 * Lo arma la terminal, no el Hub. Es a propósito: así el ticket sale con su QR
 * válido **aunque el Hub esté apagado**, que es justo cuando no puede detenerse
 * nada. Las dos derivan el mismo secreto de la clave del local, con HKDF y una
 * etiqueta propia del portal, así que el Hub sabe verificar lo que la terminal
 * firmó sin haber hablado con ella.
 *
 * El comensal recibe el resultado de firmar, nunca el secreto.
 */
import { codigoDeCuenta } from "@motrest/dominio";
import { derivarSecretoPortal } from "@motrest/protocolo-sync";
import { sync } from "./sync.svelte";

class StorePortal {
  /** Se deriva una vez: HKDF no es gratis y esto se pide en cada cobro. */
  private secreto: string | null = null;

  /**
   * Dónde vive el portal para el teléfono del comensal.
   *
   * Es la dirección del Hub en la red del local. Un teléfono conectado al wifi
   * del restaurante llega; uno con datos móviles, no — y eso es correcto: el
   * portal es del local, no de internet.
   */
  private get base(): string {
    return sync.urlDelPortal ?? window.location.origin;
  }

  private async obtenerSecreto(): Promise<string | null> {
    if (this.secreto) return this.secreto;

    const clave = sync.claveLocal;
    if (!clave) return null;

    try {
      this.secreto = await derivarSecretoPortal(clave);
      return this.secreto;
    } catch (causa) {
      console.error("No se pudo derivar el secreto del portal", causa);
      return null;
    }
  }

  /** El enlace completo de una cuenta, listo para el QR o para el ticket. */
  async enlaceDeCuenta(ordenId: string): Promise<string | null> {
    const secreto = await this.obtenerSecreto();
    if (!secreto) return null;
    return `${this.base}/portal/#/c/${await codigoDeCuenta(ordenId, secreto)}`;
  }

  /** Se olvida el secreto derivado: al reemparejar, la clave del local cambió. */
  olvidar(): void {
    this.secreto = null;
  }
}

export const portal = new StorePortal();
