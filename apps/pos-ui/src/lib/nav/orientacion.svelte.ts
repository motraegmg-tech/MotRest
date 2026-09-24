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
 * ¿Es un TELÉFONO? (pedido de Gonzalo, 24-sep-2026)
 *
 * Aparte de la postura: una tableta de pie también es «vertical», pero en ella
 * la barra superior cabe entera. En un teléfono no cabía más que el módulo y el
 * local, y el usuario y «Cerrar sesión» quedaban fuera de la pantalla.
 *
 * El ancho es el mismo corte que ya usa Venta para su flujo por pasos (767 px).
 * La segunda condición es el teléfono ACOSTADO: pasa de ese ancho pero tiene
 * muy poco alto, y `pointer: coarse` evita que una ventana baja de escritorio
 * cuente como teléfono.
 */
const CONSULTA_TELEFONO = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";

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

  /** true = teléfono: la barra superior se reduce a iconos. */
  telefono = $state(hayVentana() ? window.matchMedia(CONSULTA_TELEFONO).matches : false);

  private lista: MediaQueryList | null = null;
  private listaTelefono: MediaQueryList | null = null;
  private alCambiarTelefono = (e: MediaQueryListEvent | MediaQueryList): void => {
    this.telefono = e.matches;
  };
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

    this.listaTelefono = window.matchMedia(CONSULTA_TELEFONO);
    this.telefono = this.listaTelefono.matches;
    this.listaTelefono.addEventListener("change", this.alCambiarTelefono);

    return () => {
      this.lista?.removeEventListener("change", this.alCambiar);
      this.lista = null;
      this.listaTelefono?.removeEventListener("change", this.alCambiarTelefono);
      this.listaTelefono = null;
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
