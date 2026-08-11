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

interface Ajustes {
  horaCorte: number;
  retencionMeses?: MesesRetencion;
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
  }

  private guardar(): void {
    void this.almacen?.estado
      .guardar<Ajustes>(CLAVE_LOCAL, {
        horaCorte: this.horaCorte,
        retencionMeses: this.retencionMeses,
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
