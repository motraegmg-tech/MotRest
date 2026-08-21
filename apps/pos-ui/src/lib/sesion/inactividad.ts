/**
 * Cierre de sesión por inactividad.
 *
 * Una terminal de restaurante se queda sola cada dos por tres: el cajero sale a
 * llevar un plato, el gerente deja la pantalla abierta y se va a la bodega. Con
 * la sesión viva, quien pase por ahí opera con los permisos de quien se fue —y
 * la bitácora se lo apunta a él—. Por eso la terminal se cierra sola.
 *
 * También es lo que devuelve la marca a la pantalla: sin nadie delante, el POS
 * enseña el acceso con el logotipo de MotRest en vez de la comanda de la mesa 8.
 *
 * ## Cómo cuenta el tiempo
 *
 * No hay un `setTimeout` que se rearme con cada movimiento del cursor: una
 * pantalla táctil con gente delante dispara cientos de señales por minuto, y
 * rearmar el temporizador en cada una es trabajo tirado. Se guarda un SELLO de
 * la última señal de vida y un solo reloj lo compara cada segundo, así que el
 * costo no depende de cuánta actividad haya.
 *
 * Eso arregla de paso el caso de la tablet dormida: si el sistema operativo
 * congela los temporizadores, al despertar la comparación de sellos ve que
 * pasaron veinte minutos y cierra — un `setTimeout` habría creído que no pasó
 * nada.
 */
import { sesion } from "./sesion.svelte";

/**
 * Cuánto se aguanta sin que nadie toque la interfaz.
 *
 * Decisión de Gonzalo: 45 segundos. Es corto a propósito, porque la caja mira a
 * la calle. Las pantallas que viven solas —la de cocina— se eximen desde fuera;
 * ver `iniciar`.
 */
export const INACTIVIDAD_MS = 45_000;

/** Cada cuánto se compara el sello contra el reloj. */
const LATIDO_MS = 1_000;

/**
 * Señales que cuentan como «alguien está usando esto».
 *
 * `pointermove` cubre ratón, dedo y lápiz de una vez. Van en captura y como
 * pasivas: así se enteran aunque un componente detenga la propagación, y no
 * frenan el desplazamiento de una lista de platillos.
 */
const SENALES = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "focusin",
] as const;

class VigilanciaInactividad {
  /** Cuándo se vio la última señal de vida. */
  private ultimaSenal = Date.now();
  private reloj: ReturnType<typeof setInterval> | undefined;
  private soltar: (() => void)[] = [];

  /**
   * Pantallas que NO deben cerrarse solas.
   *
   * Lo decide quien monta la aplicación, no este módulo, para que siga sin
   * saber nada del router ni de los módulos.
   */
  private enPausa: () => boolean = () => false;

  /** Milisegundos que faltan para el cierre. Cero = ya toca. */
  restante(ahora: number = Date.now()): number {
    return Math.max(0, INACTIVIDAD_MS - (ahora - this.ultimaSenal));
  }

  /** Alguien tocó la interfaz: el plazo vuelve a empezar. */
  registrarActividad(ahora: number = Date.now()): void {
    this.ultimaSenal = ahora;
  }

  /**
   * ¿Toca cerrar? Devuelve true si cerró la sesión en esta pasada.
   *
   * Lo llama el latido, y las pruebas con su propio reloj: así se comprueba el
   * comportamiento sin depender de temporizadores falsos.
   */
  revisar(ahora: number = Date.now()): boolean {
    /*
     * Sin sesión no hay nada que cerrar — y el sello NO debe envejecer mientras
     * la pantalla de acceso está puesta. Si envejeciera, quien entrara se
     * encontraría el plazo ya medio gastado y su sesión duraría veinte segundos.
     * Lo mismo vale para las pantallas eximidas.
     */
    if (!sesion.autenticado || this.enPausa()) {
      this.registrarActividad(ahora);
      return false;
    }

    if (this.restante(ahora) > 0) return false;

    sesion.cerrarSesion("inactividad");
    this.registrarActividad(ahora);
    return true;
  }

  /**
   * Arranca la vigilancia y devuelve la función que la detiene.
   *
   * @param enPausa Se consulta en cada latido. Mientras devuelva `true`, la
   *   sesión no se cierra: es la puerta por la que se exime la pantalla de
   *   cocina, que nadie toca durante el servicio y no puede quedarse en blanco.
   */
  iniciar(enPausa: () => boolean = () => false): () => void {
    this.detener();
    this.enPausa = enPausa;
    this.registrarActividad();

    if (typeof window !== "undefined") {
      const marcar = () => this.registrarActividad();
      for (const senal of SENALES) {
        window.addEventListener(senal, marcar, { capture: true, passive: true });
        this.soltar.push(() => window.removeEventListener(senal, marcar, { capture: true }));
      }

      /*
       * Volver a la aplicación cuenta como actividad, pero el rato que estuvo
       * escondida NO se perdona: se revisa ANTES de marcar, así que si el plazo
       * venció mientras la tablet estaba en otra app, cierra igual.
       */
      const alVolver = () => {
        if (document.visibilityState !== "visible") return;
        this.revisar();
        this.registrarActividad();
      };
      document.addEventListener("visibilitychange", alVolver);
      this.soltar.push(() => document.removeEventListener("visibilitychange", alVolver));
    }

    this.reloj = setInterval(() => this.revisar(), LATIDO_MS);

    return () => this.detener();
  }

  private detener(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = undefined;
    for (const soltar of this.soltar) soltar();
    this.soltar = [];
    this.enPausa = () => false;
  }
}

export const inactividad = new VigilanciaInactividad();
