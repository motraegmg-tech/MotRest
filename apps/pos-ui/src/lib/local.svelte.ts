/**
 * Ajustes del local que no son catálogo ni operación.
 *
 * Hoy solo vive aquí la **hora de corte de la jornada**, pero es el lugar donde
 * irán los demás ajustes del restaurante conforme aparezcan.
 *
 * Se guarda como estado del dispositivo, igual que las impresoras: no es un
 * hecho de la operación —no cambia lo que se vendió— sino cómo se agrupa para
 * mirarlo.
 */
import { HORA_CORTE_POR_DEFECTO, jornadaDe, type Rango } from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_LOCAL = "ajustes_local";

/**
 * Cuánto historial de ventas conserva el local.
 *
 * El mínimo son TRES MESES y no es negociable: por debajo de eso ni el contador
 * puede cerrar un trimestre ni el restaurante puede comparar un mes con el
 * anterior, que es media razón de tener el sistema. Por arriba manda el dueño,
 * sabiendo lo que cuesta —esto vive en el disco de su caja, no en una nube—.
 */
export const MESES_RETENCION = [3, 6, 12, 24] as const;
export type MesesRetencion = (typeof MESES_RETENCION)[number];
export const RETENCION_POR_DEFECTO: MesesRetencion = 3;

/**
 * Lo que sale impreso en la cabecera del ticket.
 *
 * ESTABA ESCRITO A MANO EN EL CÓDIGO, con los datos de Rodizio. Cualquier otro
 * restaurante que instalara MotRest imprimía «Rodizio», su dirección y un RFC
 * genérico en cada ticket que entregaba a un comensal. Y Rodizio mismo no veía
 * su dirección real, sino una inventada para las pruebas.
 *
 * El nombre no lleva valor por defecto: se toma del que trae la licencia
 * firmada, que es quien sabe de verdad cómo se llama el restaurante.
 */
export interface FichaDelLocal {
  nombre: string;
  direccion: string;
  rfc: string;
  telefono: string;
}

/** Los textos del ticket que el restaurante puede escribir. */
export interface TextosDelTicket {
  encabezado: string;
  invitacion_opinion: string;
  agradecimiento: string;
  pie: string;
}

export interface QrAdicionalTicket {
  leyenda: string;
  url: string;
}

export const TEXTOS_TICKET_INICIALES: TextosDelTicket = {
  encabezado: "",
  invitacion_opinion: "¿Cómo estuvo todo? Cuéntanos",
  agradecimiento: "¡Gracias por su visita!",
  pie: "",
};

interface Ajustes {
  horaCorte: number;
  retencionMeses?: MesesRetencion;
  ficha?: Partial<FichaDelLocal>;
  textosTicket?: Partial<TextosDelTicket>;
  qrAdicional?: Partial<QrAdicionalTicket>;
}

class StoreLocal {
  /**
   * A qué hora cierra contablemente el día.
   *
   * Las 5 de la mañana por defecto: un viernes de servicio termina a la una o
   * las dos, y esas ventas son del viernes para quien las hizo.
   */
  horaCorte = $state(HORA_CORTE_POR_DEFECTO);

  /** Meses de historial de ventas que el local quiere conservar. */
  retencionMeses = $state<MesesRetencion>(RETENCION_POR_DEFECTO);

  /** Lo que va impreso en la cabecera del ticket. */
  ficha = $state<FichaDelLocal>({ nombre: "", direccion: "", rfc: "", telefono: "" });

  /** Las frases del ticket. Las de fábrica hasta que alguien las cambie. */
  textosTicket = $state<TextosDelTicket>({ ...TEXTOS_TICKET_INICIALES });

  /** Segundo QR opcional, normalmente la ficha del restaurante en Google Maps. */
  qrAdicional = $state<QrAdicionalTicket>({ leyenda: "Danos 5 estrellas en Google Maps", url: "" });

  private almacen: Almacen | null = null;

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardados = await almacen.estado.cargar<Ajustes>(CLAVE_LOCAL);
    if (guardados && Number.isInteger(guardados.horaCorte)) {
      this.horaCorte = guardados.horaCorte;
    }
    if (guardados?.retencionMeses && MESES_RETENCION.includes(guardados.retencionMeses)) {
      this.retencionMeses = guardados.retencionMeses;
    }
    if (guardados?.ficha) this.ficha = { ...this.ficha, ...guardados.ficha };
    if (guardados?.textosTicket) {
      this.textosTicket = { ...this.textosTicket, ...guardados.textosTicket };
    }
    if (guardados?.qrAdicional) {
      this.qrAdicional = { ...this.qrAdicional, ...guardados.qrAdicional };
    }
  }

  /**
   * La cabecera del ticket, con el nombre de la licencia como respaldo.
   *
   * Si nadie ha llenado la ficha, al menos el nombre sale bien: lo dice el
   * documento firmado que da de alta al restaurante. Es preferible un ticket
   * con solo el nombre correcto que uno con los datos de otro local.
   */
  fichaParaTicket(nombreDeLaLicencia: string): FichaDelLocal {
    return {
      nombre: this.ficha.nombre.trim() || nombreDeLaLicencia,
      direccion: this.ficha.direccion.trim(),
      rfc: this.ficha.rfc.trim(),
      telefono: this.ficha.telefono.trim(),
    };
  }

  /** Cambia la ficha del local. Se guarda tal cual, sin inventar nada. */
  fijarFicha(cambios: Partial<FichaDelLocal>): void {
    this.ficha = { ...this.ficha, ...cambios };
    this.guardar();
  }

  /** Cambia los textos del ticket. */
  fijarTextosTicket(cambios: Partial<TextosDelTicket>): void {
    this.textosTicket = { ...this.textosTicket, ...cambios };
    this.guardar();
  }

  fijarQrAdicional(cambios: Partial<QrAdicionalTicket>): void {
    this.qrAdicional = { ...this.qrAdicional, ...cambios };
    this.guardar();
  }

  /** Solo se imprime una URL web explícita; otros esquemas no llegan al papel. */
  get qrAdicionalParaTicket(): QrAdicionalTicket | null {
    try {
      const url = new URL(this.qrAdicional.url.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return { leyenda: this.qrAdicional.leyenda.trim(), url: url.toString() };
    } catch {
      return null;
    }
  }

  private guardar(): void {
    void this.almacen?.estado
      .guardar<Ajustes>(CLAVE_LOCAL, {
        horaCorte: this.horaCorte,
        retencionMeses: this.retencionMeses,
        ficha: { ...this.ficha },
        textosTicket: { ...this.textosTicket },
        qrAdicional: { ...this.qrAdicional },
      })
      .catch((causa) => {
        console.error("No se pudieron guardar los ajustes del local", causa);
      });
  }

  /** Cambia la hora de corte. Fuera de 0–23 no se guarda nada. */
  fijarHoraCorte(hora: number): boolean {
    if (!Number.isInteger(hora) || hora < 0 || hora > 23) return false;
    this.horaCorte = hora;
    this.guardar();
    return true;
  }

  /** Cambia cuánto historial se conserva. */
  fijarRetencion(meses: MesesRetencion): boolean {
    if (!MESES_RETENCION.includes(meses)) return false;
    this.retencionMeses = meses;
    this.guardar();
    return true;
  }

  /** La jornada en curso, con la hora de corte de este local. */
  get jornadaActual(): Rango {
    return jornadaDe(Date.now(), this.horaCorte);
  }

  /** La jornada que contiene un instante cualquiera. */
  jornada(ts: number): Rango {
    return jornadaDe(ts, this.horaCorte);
  }
}

export const local = new StoreLocal();
