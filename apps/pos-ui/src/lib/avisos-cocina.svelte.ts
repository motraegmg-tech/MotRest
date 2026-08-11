/**
 * «Tu platillo está listo»: el aviso que cocina le manda al mesero.
 *
 * ## Por qué hace falta
 *
 * El KDS ya sabía qué platillos estaban listos, pero solo lo sabía la cocina. El
 * mesero se enteraba al pasar por el pase o al abrir esa mesa concreta en la
 * tablet — o sea, justo cuando ya se acordaba solo. Lo que se enfría es lo que
 * nadie recuerda, y para eso la pantalla tiene que hablar primero.
 *
 * ## A quién se le avisa
 *
 * Solo a quien atiende esa mesa: al que la tiene en el rol del día, y si el rol
 * no dice nada, al que abrió la cuenta. Avisar a todo el salón de todo produce
 * el efecto contrario al buscado —a la tercera noche nadie mira los avisos—, y
 * el rol de mesas existe precisamente para poder afinar esto.
 *
 * ## Qué NO es
 *
 * No es estado del negocio y no se persiste. Lo que ocurrió —que el platillo
 * quedó listo— ya está en el event log; esto es solo el toque en el hombro. Si
 * la terminal se recarga, el aviso se pierde y no pasa nada: el platillo sigue
 * marcado «listo» en la cuenta, con su etiqueta parpadeando.
 */
import type { ID } from "@motrest/dominio";

export interface AvisoListo {
  /** El renglón, que es también la identidad del aviso: uno por platillo. */
  renglon_id: ID;
  orden_id: ID;
  mesa_id: ID;
  mesa: string;
  descripcion: string;
  cantidad: number;
  ts: number;
}

/**
 * Cuánto dura un aviso en pantalla.
 *
 * Cuarenta segundos: lo que tarda un mesero en terminar de tomar una comanda y
 * levantar la vista. Menos y se lo pierde; más y se le acumulan cuatro tarjetas
 * encima del salón.
 */
const VIDA_MS = 40_000;

/** Cuántos se enseñan a la vez. Por encima de tres, la pila tapa la pantalla. */
const MAXIMO = 3;

class StoreAvisosCocina {
  /** Lo que está en pantalla ahora mismo, del más reciente al más viejo. */
  avisos = $state.raw<AvisoListo[]>([]);

  /**
   * Renglones de los que ya se avisó.
   *
   * No es reactivo a propósito: solo sirve para no repetir el mismo aviso en
   * cada recálculo de la proyección, que ocurre varias veces por render.
   */
  private avisados = new Set<ID>();
  private temporizadores = new Map<ID, ReturnType<typeof setTimeout>>();

  /**
   * Da por conocido lo que ya estaba listo al abrir la pantalla.
   *
   * Sin esto, entrar al módulo de venta a media noche dispararía un aviso por
   * cada platillo que lleva rato en el pase — ruido puro, y del que enseña a
   * ignorar los avisos de verdad.
   */
  sembrar(renglonIds: readonly ID[]): void {
    for (const id of renglonIds) this.avisados.add(id);
  }

  /** Un platillo acaba de quedar listo. Repetirlo no vuelve a avisar. */
  anunciar(aviso: AvisoListo): void {
    if (this.avisados.has(aviso.renglon_id)) return;
    this.avisados.add(aviso.renglon_id);

    this.avisos = [aviso, ...this.avisos].slice(0, MAXIMO);
    this.temporizadores.set(
      aviso.renglon_id,
      setTimeout(() => this.descartar(aviso.renglon_id), VIDA_MS),
    );
  }

  descartar(renglonId: ID): void {
    const temporizador = this.temporizadores.get(renglonId);
    if (temporizador) clearTimeout(temporizador);
    this.temporizadores.delete(renglonId);
    this.avisos = this.avisos.filter((a) => a.renglon_id !== renglonId);
  }

  limpiar(): void {
    for (const temporizador of this.temporizadores.values()) clearTimeout(temporizador);
    this.temporizadores.clear();
    this.avisos = [];
  }

  /**
   * Olvida lo avisado de cuentas que ya se cerraron.
   *
   * El conjunto crecería toda la noche si no. Se llama con los renglones que
   * siguen vivos y se descarta lo demás.
   */
  podar(vigentes: ReadonlySet<ID>): void {
    if (this.avisados.size < 400) return;
    for (const id of this.avisados) {
      if (!vigentes.has(id)) this.avisados.delete(id);
    }
  }
}

export const avisosCocina = new StoreAvisosCocina();
