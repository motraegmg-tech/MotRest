/**
 * Configuración de los correos al comensal (M9).
 *
 * Vive como CATÁLOGO, no como eventos: es configuración del local, igual que el
 * plano o las impresoras, y viaja a todas las terminales por el mismo camino.
 *
 * LA LLAVE DE RESEND NO SE GUARDA AQUÍ. Esto viaja a cada tablet del salón; una
 * credencial que puede mandar correo en nombre del restaurante no tiene por qué
 * estar en el teléfono de un mesero. Se queda en el Hub, que es quien manda.
 */
import {
  CATALOGO_CORREOS,
  configuracionVacia,
  correoPlausible,
  type ConfiguracionCorreo,
  type TipoCorreo,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_CORREO = "correo_config";

export interface ResultadoCorreo {
  ok: boolean;
  error?: string;
}

class StoreCorreo {
  private datos = $state<ConfiguracionCorreo>(configuracionVacia());
  private almacen: Almacen | null = null;

  get config(): ConfiguracionCorreo {
    return this.datos;
  }

  /** Qué correos hay para configurar, con su explicación. */
  get catalogo() {
    return CATALOGO_CORREOS;
  }

  /**
   * ¿Está listo para mandar algo?
   *
   * Sin remitente no sale nada, y conviene decirlo arriba de la pantalla en vez
   * de dejar que el restaurantero encienda seis correos y ninguno llegue.
   */
  get listo(): boolean {
    return this.datos.remitente.trim().length > 0;
  }

  get encendidos(): TipoCorreo[] {
    return CATALOGO_CORREOS.filter((d) => this.datos.activos[d.tipo]).map((d) => d.tipo);
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardada = await almacen.estado.cargar<ConfiguracionCorreo>(CLAVE_CORREO);
    if (guardada) this.datos = guardada;
  }

  /** Lo que llega del Hub o de otra terminal. */
  fusionar(entrante: ConfiguracionCorreo): void {
    this.datos = entrante;
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_CORREO, this.datos).catch((causa) => {
      console.error("No se pudo guardar la configuración de correo", causa);
    });
  }

  actualizar(cambios: Partial<ConfiguracionCorreo>): ResultadoCorreo {
    const remitente = (cambios.remitente ?? this.datos.remitente).trim();

    /*
     * El remitente admite dos formas: "correo@dominio" o "Nombre <correo@dominio>".
     * La segunda es la que conviene —el comensal ve "Rodizio" y no una
     * dirección— así que se acepta y se valida solo la parte del correo.
     */
    if (remitente) {
      const dentro = remitente.match(/<([^>]+)>/)?.[1] ?? remitente;
      if (!correoPlausible(dentro)) {
        return { ok: false, error: "El remitente no parece una dirección de correo" };
      }
    }

    const responder = (cambios.responder_a ?? this.datos.responder_a)?.trim();
    if (responder && !correoPlausible(responder)) {
      return { ok: false, error: "La dirección de respuesta no parece válida" };
    }

    this.datos = { ...this.datos, ...cambios, remitente, responder_a: responder || undefined };
    this.guardar();
    return { ok: true };
  }

  /** Enciende o apaga un tipo de correo. */
  alternar(tipo: TipoCorreo): void {
    this.datos = {
      ...this.datos,
      activos: { ...this.datos.activos, [tipo]: !this.datos.activos[tipo] },
    };
    this.guardar();
  }

  cambiarAsunto(tipo: TipoCorreo, asunto: string): void {
    const limpio = asunto.trim();
    const asuntos = { ...(this.datos.asuntos ?? {}) };
    // Vaciarlo devuelve el asunto de fábrica, en vez de mandar uno en blanco.
    if (limpio) asuntos[tipo] = limpio;
    else delete asuntos[tipo];

    this.datos = { ...this.datos, asuntos };
    this.guardar();
  }
}

export const correo = new StoreCorreo();
