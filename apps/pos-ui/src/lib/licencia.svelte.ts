/**
 * La licencia, vista desde la terminal.
 *
 * QUIÉN DECIDE. El **Hub**, no esta pantalla. Aquí solo se guarda el veredicto
 * que él mandó y se pinta lo que corresponde. Es a propósito: si la terminal
 * pudiera decidir por su cuenta si la licencia vale, bastaría con abrir las
 * herramientas del navegador para desbloquear el sistema. La firma se verifica
 * donde está el secreto, y eso está en el Hub.
 *
 * QUÉ PASA SI LA TERMINAL NO PUEDE HABLAR CON EL HUB. Nada. Se queda con el
 * último veredicto que recibió y sigue trabajando — que es exactamente lo que
 * pide el modo isla. Bloquear una tablet porque se cayó el wifi convertiría un
 * problema de red en un restaurante parado.
 */
import {
  debeBloquearse,
  situacionDe,
  type Licencia,
  type SituacionLicencia,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_LICENCIA = "licencia_estado";

/** Lo que el Hub le manda a cada terminal. */
export interface VeredictoLicencia {
  licencia: Licencia | null;
  /** Lo calculó el Hub comprobando la firma. La terminal no lo recalcula. */
  verificada: boolean;
}

class StoreLicencia {
  private datos = $state<VeredictoLicencia>({ licencia: null, verificada: false });
  private almacen: Almacen | null = null;

  /**
   * Un local recién instalado todavía no recibió su licencia y no debe quedarse
   * bloqueado por eso: sin veredicto del Hub se opera con normalidad, y en
   * cuanto llegue uno manda el que llegó.
   */
  private conocido = $state(false);

  /** Si hay un turno de caja abierto. Lo inyecta quien sí lo sabe. */
  private turnoAbierto = $state(false);

  /**
   * Se recalcula cada minuto para que el tope del corte venza SOLO.
   *
   * Un corte de servicio espera a que el local cierre su caja, pero esa espera
   * tiene fecha límite (`bloqueo_maximo_ts`). Sin este reloj, esa fecha solo se
   * miraría cuando algo más obligara a repintar: una terminal encendida y
   * quieta seguiría operando pasada la hora, y una que nadie toca en toda la
   * madrugada no se bloquearía hasta que alguien la moviera por la mañana.
   */
  private ahora = $state(Date.now());
  private reloj: ReturnType<typeof setInterval> | null = null;

  get situacion(): SituacionLicencia {
    return situacionDe(this.datos.licencia, this.datos.verificada);
  }

  get licencia(): Licencia | null {
    return this.datos.licencia;
  }

  /** ¿Hay que enseñar la pantalla de MOTRAE en este momento? */
  get bloqueado(): boolean {
    if (!this.conocido) return false;
    return debeBloquearse(this.situacion, this.turnoAbierto, this.datos.licencia, this.ahora);
  }

  /**
   * El bloqueo ya cayó pero se está esperando a que cierren la caja.
   *
   * Merece un aviso propio, y bien visible: es la última oportunidad que tiene
   * el restaurante de enterarse antes de quedarse sin sistema.
   */
  get bloqueoDiferido(): boolean {
    return this.conocido && !this.situacion.opera && !this.bloqueado;
  }

  /** ¿Se le enseña el aviso de "por vencer" o "en gracia"? */
  get aviso(): string {
    if (!this.conocido || !this.situacion.avisar || this.bloqueado) return "";
    return this.situacion.mensaje;
  }

  get estado() {
    return this.situacion.estado;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<VeredictoLicencia>(CLAVE_LICENCIA);
    if (guardado) {
      this.datos = guardado;
      this.conocido = true;
    }
    /*
     * Un minuto basta y sobra. La diferencia entre bloquear a las 23:00:00 y a
     * las 23:00:59 no se la juega nadie, y un reloj más fino solo gastaría
     * batería en las tabletas del salón. `??=` porque hidratar se puede llamar
     * más de una vez y dos relojes serían dos fugas.
     */
    this.reloj ??= setInterval(() => (this.ahora = Date.now()), 60_000);
  }

  /** Lo que llega del Hub. */
  fusionar(entrante: VeredictoLicencia): void {
    this.datos = entrante;
    this.conocido = true;
    void this.almacen?.estado.guardar(CLAVE_LICENCIA, entrante).catch((causa) => {
      console.error("No se pudo guardar el estado de la licencia", causa);
    });
  }

  /** Lo llama la caja al abrir y al cerrar turno. */
  marcarTurno(abierto: boolean): void {
    this.turnoAbierto = abierto;
  }
}

export const licencia = new StoreLicencia();
