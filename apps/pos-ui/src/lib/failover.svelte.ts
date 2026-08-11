/**
 * El relevo cuando la caja se cae, visto desde una terminal (F5).
 *
 * QUÉ HACE ESTE ARCHIVO Y QUÉ NO. Decide **qué se le enseña al personal** y si
 * el corte está disponible. NO toma el mando: proclamarse Hub es cosa del
 * protocolo de sincronización, y meterlo aquí pondría esa decisión en una
 * pantalla de Svelte que puede recargarse a mitad.
 *
 * La regla que gobierna el dominio (`failover.ts`) es que **dos Hubs a la vez
 * es peor que ninguno**. Aquí solo se refleja lo que decidió.
 */
import {
  avisoParaElPersonal,
  decidirFailover,
  puedeCerrarTurno,
  type DecisionFailover,
  type TerminalDelLocal,
} from "@motrest/dominio";
import { obtenerDeviceId } from "./presentacion";

class StoreFailover {
  /** El censo de terminales del local. Llega del Hub como catálogo. */
  private censo = $state.raw<TerminalDelLocal[]>([]);
  /** Última señal del titular. La actualiza el enlace de sincronización. */
  private titularVisto = $state<number | null>(null);
  /** true = esta terminal está haciendo de Hub. */
  private soyHub = $state(false);
  /** Se refresca solo para que el aviso aparezca sin que nadie toque nada. */
  private ahora = $state(Date.now());
  private reloj: ReturnType<typeof setInterval> | null = null;

  get decision(): DecisionFailover {
    const yo =
      this.censo.find((t) => t.device_id === obtenerDeviceId()) ??
      /*
       * Una terminal que todavía no está en el censo se trata como terminal
       * simple, nunca como suplente. Ante la duda, no mandar: es la misma regla
       * que impide que dos se proclamen a la vez.
       */
      ({ device_id: obtenerDeviceId(), papel: "terminal", prioridad: 99, visto_ts: this.ahora } as TerminalDelLocal);

    return decidirFailover(
      { yo, censo: this.censo, titular_visto_ts: this.titularVisto, soy_hub: this.soyHub },
      this.ahora,
    );
  }

  /**
   * Lo que se le enseña al personal. Vacío = todo normal.
   *
   * NO SE HABLA SIN DATOS. Mientras esta terminal no haya sabido del titular ni
   * una vez, no hay nada que afirmar: «no me consta» y «la caja se cayó» son
   * cosas distintas, y esta pantalla solo puede decir la segunda. Sin esta
   * guarda, una terminal recién abierta —o abierta sin Hub configurado— saluda
   * con «La caja no responde, avise al gerente» delante de los comensales.
   *
   * En cuanto llega el primer latido esto deja de aplicar para siempre en esta
   * sesión, y una caída posterior sí se anuncia: es la diferencia entre callar
   * por ignorancia y callar por conveniencia.
   */
  get aviso(): string {
    if (this.titularVisto === null) return "";
    return avisoParaElPersonal(this.decision);
  }

  /** true = hay que enseñarlo en rojo, no como aviso suave. */
  get grave(): boolean {
    return this.decision.situacion === "aguantar";
  }

  /** ¿Se puede cerrar el turno ahora? */
  get puedeCerrar(): { puede: boolean; razon?: string } {
    return puedeCerrarTurno(this.decision);
  }

  iniciar(): void {
    // Cada diez segundos basta: el primer umbral son treinta, y un reloj más
    // fino solo gasta batería de las tablets sin cambiar nada de lo que se ve.
    this.reloj ??= setInterval(() => (this.ahora = Date.now()), 10_000);
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
  }

  /** Lo que llega del Hub. */
  fusionarCenso(censo: TerminalDelLocal[]): void {
    this.censo = censo;
  }

  /** Lo llama el enlace cada vez que sabe del titular. */
  latidoDelTitular(ts = Date.now()): void {
    this.titularVisto = ts;
    this.ahora = Date.now();
  }

  marcarSoyHub(esHub: boolean): void {
    this.soyHub = esHub;
  }
}

export const failover = new StoreFailover();
