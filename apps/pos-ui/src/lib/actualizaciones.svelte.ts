/**
 * El aviso de versión nueva dentro del POS.
 *
 * LO QUE PIDIÓ GONZALO Y ES LO CORRECTO: al restaurante le aparece "hay una
 * actualización disponible" y él elige — ahora, más tarde, o a una hora
 * concreta. Y si lo pospone, **el aviso se queda puesto** en la barra lateral
 * hasta que se instale. Un aviso que desaparece al posponerlo es un aviso que
 * nadie vuelve a ver, y una versión que nunca se instala.
 *
 * QUIÉN INSTALA. El Hub, no la terminal. Aquí solo se recoge la decisión y se le
 * manda. Una tablet del salón no descarga ni ejecuta nada.
 */
import {
  aplazar,
  debeAvisar,
  estadoInicial,
  hayPendiente,
  resumenDeEleccion,
  type EleccionActualizacion,
  type EstadoActualizacion,
  type VersionDisponible,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_ACTUALIZACION = "actualizacion_estado";

class StoreActualizaciones {
  private datos = $state<EstadoActualizacion>(estadoInicial());
  private almacen: Almacen | null = null;
  /** Se recalcula cada minuto para que un aplazamiento venza solo. */
  private ahora = $state(Date.now());
  private reloj: ReturnType<typeof setInterval> | null = null;

  /** El diálogo se enseña o no. */
  get avisar(): boolean {
    return debeAvisar(this.datos, this.ahora);
  }

  /** El punto en la barra lateral: sigue puesto aunque esté aplazada. */
  get pendiente(): boolean {
    return hayPendiente(this.datos);
  }

  get version(): VersionDisponible | null {
    return this.datos.disponible;
  }

  get resumen(): string {
    return resumenDeEleccion(this.datos);
  }

  /** Lo obligatorio no ofrece "más tarde". */
  get obligatoria(): boolean {
    return this.datos.disponible?.obligatoria ?? false;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<EstadoActualizacion>(CLAVE_ACTUALIZACION);
    if (guardado) this.datos = guardado;

    /*
     * Un minuto de resolución basta y sobra: la diferencia entre avisar a las
     * 23:00:00 y a las 23:00:59 no le importa a nadie, y un reloj más fino solo
     * gasta batería de las tablets.
     */
    this.reloj ??= setInterval(() => (this.ahora = Date.now()), 60_000);
  }

  /** Lo que llega del Hub cuando encontró algo. */
  fusionar(entrante: EstadoActualizacion): void {
    this.datos = entrante;
    this.ahora = Date.now();
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_ACTUALIZACION, this.datos).catch((causa) => {
      console.error("No se pudo guardar el estado de la actualización", causa);
    });
  }

  /**
   * Lo que contestó el restaurante, **de camino al Hub**.
   *
   * Antes esto se guardaba aquí y se acababa el viaje: el estado vivía en el
   * almacén de esta terminal, y quien instala es el Hub. El restaurante pulsaba
   * «Actualizar ahora» y no pasaba nada, para siempre. Ahora la decisión se
   * manda, y lo que vuelve del Hub es lo que manda.
   *
   * Se aplica primero en local para que el diálogo responda al instante, y se
   * revierte si el Hub no la acepta. Una elección que se ve tomada pero que el
   * Hub no tiene es la misma avería de antes, solo que más difícil de ver.
   */
  async decidir(eleccion: EleccionActualizacion): Promise<{ ok: true } | { ok: false; error: string }> {
    const previo = this.datos;
    this.datos = aplazar(this.datos, eleccion, Date.now());
    this.ahora = Date.now();

    try {
      const respuesta = await fetch("/actualizacion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eleccion),
        signal: AbortSignal.timeout(5000),
      });

      if (!respuesta.ok) {
        this.datos = previo;
        /*
         * El Hub solo acepta esto desde la propia caja, igual que la licencia:
         * reiniciar el sistema del restaurante no es algo que deba poder pedir
         * cualquiera desde la wifi del local. A quien lo intenta desde una
         * tablet hay que decírselo, no dejarlo pensando que ya está hecho.
         */
        const error =
          respuesta.status === 403
            ? "La actualización se confirma desde la caja, no desde esta terminal."
            : `El Hub no aceptó la decisión (${respuesta.status}).`;
        return { ok: false, error };
      }

      this.datos = (await respuesta.json()) as EstadoActualizacion;
      this.ahora = Date.now();
      this.guardar();
      return { ok: true };
    } catch {
      this.datos = previo;
      return { ok: false, error: "No se pudo avisar al Hub. Inténtelo de nuevo." };
    }
  }

  /**
   * Vuelve a abrir el diálogo desde el aviso de la barra lateral.
   *
   * Es lo que convierte el aviso aplazado en algo accionable: quien lo pospuso
   * hasta las tres de la mañana y a media tarde decide instalarlo ya, tiene que
   * poder — sin esperar a que le vuelva a preguntar solo.
   */
  reabrir(): void {
    if (!this.datos.disponible) return;
    this.datos = { ...this.datos, aplazada_hasta: undefined };
    this.ahora = Date.now();
    this.guardar();
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
  }
}

export const actualizaciones = new StoreActualizaciones();
