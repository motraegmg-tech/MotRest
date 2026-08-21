/**
 * En qué postura se está trabajando: tableta de pie o acostada.
 *
 * ## Por qué no basta con una media query de CSS
 *
 * El ancho del sidebar sí se puede resolver con CSS, y así estaba. Lo que no se
 * puede es cambiar el COMPORTAMIENTO: en vertical el menú tiene que dejar de
 * ocupar sitio permanentemente y pasar a abrirse por encima, y eso exige que el
 * componente sepa en qué postura está —para cerrarlo al navegar, para atender la
 * tecla Escape, para poner el botón de las tres rayas—.
 *
 * ## Por qué reacciona en vivo
 *
 * Una tableta en un restaurante gira a media comanda: el mesero la levanta para
 * enseñar la cuenta, la apoya para teclear. Si la postura se leyera una sola vez
 * al arrancar, quedaría el menú de vertical en una pantalla acostada —o peor, la
 * pantalla de vertical con el menú comiéndose media mesa—.
 *
 * ## Por qué la orientación y NO solo el ancho
 *
 * Se miran las dos cosas. `orientation: portrait` responde a la postura física,
 * que es lo que Gonzalo pidió; el ancho atrapa el caso de una ventana angosta en
 * un monitor apaisado, donde el menú fijo estorba igual aunque el aparato esté
 * horizontal. Cualquiera de las dos manda el POS al modo plegable.
 */

/** Por debajo de esto, un menú fijo se come la pantalla de trabajo. */
export const ANCHO_ANGOSTO = 900;

const CONSULTA = `(orientation: portrait), (max-width: ${ANCHO_ANGOSTO}px)`;

/**
 * ¿Hay navegador debajo?
 *
 * Las pruebas corren en Node sin `window`, y el store se instancia al importar
 * el módulo. Sin esta guarda, importar cualquier cosa que arrastre la barra de
 * navegación revienta la suite entera.
 */
function hayVentana(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

class Orientacion {
  /** true = de pie (o ventana angosta): el menú se pliega. */
  vertical = $state(hayVentana() ? window.matchMedia(CONSULTA).matches : false);

  /** El menú desplegado por encima del contenido. Solo aplica en vertical. */
  menuAbierto = $state(false);

  private lista: MediaQueryList | null = null;
  private alCambiar = (e: MediaQueryListEvent | MediaQueryList): void => {
    this.vertical = e.matches;
    /*
     * Al volver a horizontal el menú deja de flotar y vuelve a estar fijo. Si se
     * quedara marcado como «abierto», al girar otra vez a vertical aparecería
     * desplegado sin que nadie lo pidiera, tapando la comanda.
     */
    if (!e.matches) this.menuAbierto = false;
  };

  /** Empieza a escuchar. Devuelve la función para dejar de hacerlo. */
  escuchar(): () => void {
    if (!hayVentana()) return () => {};

    this.lista = window.matchMedia(CONSULTA);
    this.vertical = this.lista.matches;
    this.lista.addEventListener("change", this.alCambiar);

    return () => {
      this.lista?.removeEventListener("change", this.alCambiar);
      this.lista = null;
    };
  }

  abrirMenu(): void {
    this.menuAbierto = true;
  }

  cerrarMenu(): void {
    this.menuAbierto = false;
  }

  alternarMenu(): void {
    this.menuAbierto = !this.menuAbierto;
  }
}

export const orientacion = new Orientacion();
