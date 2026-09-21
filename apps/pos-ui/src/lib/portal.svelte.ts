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
import {
  codigoDeAutofactura,
  codigoDeCuenta,
  consumoDeSocio,
  direccionLegible,
  folioDeTicket,
  totalesComanda,
  urlDeAutofactura,
  type EstadoComanda,
} from "@motrest/dominio";
import { derivarSecretoAutofactura, derivarSecretoPortal } from "@motrest/protocolo-sync";
import { autofactura } from "./autofactura.svelte";
import { local } from "./local.svelte";
import { sync } from "./sync.svelte";

/** Lo que va en el papel para facturar: el QR y, debajo, cómo teclearlo. */
export interface QrDeFactura {
  leyenda: string;
  url: string;
  pie: string[];
  esFactura: true;
}

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

  /**
   * El enlace completo de una cuenta, listo para el QR o para el ticket.
   *
   * Devuelve `null` cuando el restaurante tiene apagado el QR de reseña. La
   * decisión se toma AQUÍ, en el único sitio que produce el enlace, y no en
   * quien imprime: mientras solo haya un productor no pueden existir dos
   * criterios que se contradigan, y el día que otro papel quiera el enlace lo
   * hereda ya resuelto.
   */
  async enlaceDeCuenta(ordenId: string): Promise<string | null> {
    if (!local.qrResena) return null;

    const secreto = await this.obtenerSecreto();
    if (!secreto) return null;
    return `${this.base}/portal/#/c/${await codigoDeCuenta(ordenId, secreto)}`;
  }

  // --- La factura por internet (1.5.6) ---------------------------------------------

  private secretoFactura: string | null = null;

  private async obtenerSecretoFactura(): Promise<string | null> {
    if (this.secretoFactura) return this.secretoFactura;
    const clave = sync.claveLocal;
    if (!clave) return null;
    try {
      this.secretoFactura = await derivarSecretoAutofactura(clave);
      return this.secretoFactura;
    } catch (causa) {
      console.error("No se pudo derivar el secreto de la autofactura", causa);
      return null;
    }
  }

  /**
   * El QR de factura de un ticket, o `null` si no se imprime.
   *
   * No se imprime si el portal está apagado (no hay clave en Central, o no hay
   * FacturAPI), ni en una cuenta que el portal no aceptaría: en $0, o pagada en
   * parte por la bolsa de un socio —no fue una venta al público—. Un QR que
   * lleva a «no se encontró tu ticket» es peor que no tener QR.
   *
   * El código sale de la clave del local, como el de la encuesta: el ticket
   * sale bien aunque el Hub esté apagado, y el portal lo acepta en cuanto el Hub
   * publique la cuenta cobrada.
   */
  async qrDeFactura(comanda: EstadoComanda): Promise<QrDeFactura | null> {
    const portal = autofactura.portal;
    if (!portal) return null;
    if (totalesComanda(comanda).total <= 0 || consumoDeSocio(comanda) > 0) return null;

    const secreto = await this.obtenerSecretoFactura();
    if (!secreto) return null;
    const folio = folioDeTicket(comanda.orden_id);
    const codigo = await codigoDeAutofactura(comanda.orden_id, secreto);
    return {
      leyenda: "Factura tu consumo aquí",
      url: urlDeAutofactura(portal.portal_url, portal.clave, folio, codigo),
      pie: [`Clave: ${portal.clave}   Folio: ${folio}`, direccionLegible(portal.portal_url)],
      esFactura: true,
    };
  }

  /** Se olvidan los secretos derivados: al reemparejar, la clave del local cambió. */
  olvidar(): void {
    this.secreto = null;
    this.secretoFactura = null;
  }
}

export const portal = new StorePortal();
