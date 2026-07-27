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

interface Ajustes {
  horaCorte: number;
}

class StoreLocal {
  /**
   * A qué hora cierra contablemente el día.
   *
   * Las 5 de la mañana por defecto: un viernes de servicio termina a la una o
   * las dos, y esas ventas son del viernes para quien las hizo.
   */
  horaCorte = $state(HORA_CORTE_POR_DEFECTO);

  private almacen: Almacen | null = null;

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardados = await almacen.estado.cargar<Ajustes>(CLAVE_LOCAL);
    if (guardados && Number.isInteger(guardados.horaCorte)) {
      this.horaCorte = guardados.horaCorte;
    }
  }

  /** Cambia la hora de corte. Fuera de 0–23 no se guarda nada. */
  fijarHoraCorte(hora: number): boolean {
    if (!Number.isInteger(hora) || hora < 0 || hora > 23) return false;
    this.horaCorte = hora;
    void this.almacen?.estado.guardar(CLAVE_LOCAL, { horaCorte: hora }).catch((causa) => {
      console.error("No se pudieron guardar los ajustes del local", causa);
    });
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
