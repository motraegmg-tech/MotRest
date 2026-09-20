/**
 * Subir la vista al principio cuando un botón de abajo abre algo arriba.
 *
 * EL PROBLEMA QUE ESTO RESUELVE
 *
 * Casi todas las pantallas de administración tienen la misma forma: el
 * formulario de alta y edición dibujado arriba, y la lista debajo, con un
 * «Editar» en cada renglón. En un local de verdad esa lista tiene cien
 * insumos, veinte usuarios o treinta órdenes, así que el renglón queda a dos o
 * tres pantallas de scroll del formulario. Quien pulsaba «Editar» no veía pasar
 * nada: el formulario se llenaba fuera de cuadro y la pantalla se quedaba donde
 * estaba, así que parecía que el botón no servía. Lo mismo con los avisos que
 * se escriben arriba («Orden generada», «No se pudo…»): salían donde nadie
 * estaba mirando.
 *
 * La 1.5.4 lo resolvió en Cocina → Menú con una función propia. Esta es la
 * misma idea para toda la aplicación, en un solo sitio: copiada en veinte
 * pantallas, la siguiente que se escribiera nacería sin ella.
 *
 * QUÉ SE SUBE
 *
 * En MotRest la página no hace scroll: la ventana mide lo que mide la pantalla
 * (`.app` en `App.svelte`) y lo que se desplaza es la `.seccion` de cada módulo,
 * o el cuerpo de un diálogo. Por eso no basta con `window.scrollTo`: se busca
 * el contenedor que de verdad se está desplazando, subiendo desde el elemento
 * que se le pase.
 */

/**
 * ¿Este elemento es el que se está desplazando?
 *
 * Hacen falta las dos cosas. Un `overflow-y: auto` que no desborda no tiene
 * nada que subir —y quedarse con él detendría la búsqueda antes de llegar al
 * que sí se movió—; y un contenido que desborda sin `overflow` no se desplaza,
 * se recorta.
 */
function seDesplaza(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
}

/**
 * El contenedor desplazable más cercano, empezando por el propio elemento.
 *
 * Incluye al propio elemento porque lo más cómodo es pasar la raíz de la
 * pantalla, y en MotRest esa raíz —la `.seccion`— ES el contenedor que se
 * desplaza.
 */
export function contenedorDesplazable(desde: Element | null | undefined): Element | null {
  for (let el = desde ?? null; el; el = el.parentElement) {
    if (seDesplaza(el)) return el;
  }
  return null;
}

/**
 * Sube la vista al principio del contenedor donde vive `desde`.
 *
 * El contenedor se busca AHORA y se sube en el cuadro SIGUIENTE, y las dos
 * cosas tienen su motivo:
 *
 *  - Ahora, porque el botón que se pulsó puede desaparecer con el mismo clic
 *    —«Editar» cambia la lista por el editor—, y un elemento que ya no está en
 *    la página no tiene ancestros que recorrer.
 *  - En el siguiente cuadro, porque lo que se abre se monta en este ciclo, y
 *    hasta que el navegador no recalcula el alto el desplazamiento se haría
 *    contra la altura vieja.
 *
 * Sin contenedor se sube la ventana: es lo que pasa fuera del armazón de la
 * aplicación, y ahí sí es la página la que se desplaza.
 */
export function subirAlPrincipio(desde?: Element | null): void {
  const contenedor = contenedorDesplazable(desde);
  requestAnimationFrame(() => {
    const behavior = comportamiento();
    if (contenedor) contenedor.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  });
}

/** Quien pidió menos movimiento en su sistema recibe el salto sin animar. */
function comportamiento(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * El caso contrario: lo que se abre queda DEBAJO, fuera de cuadro.
 *
 * El detalle de la prenómina al pulsar un nombre, la confirmación de
 * «Eliminar» al final de la lista de usuarios, el formulario de un gasto bajo
 * el resultado del día. Mismo síntoma que el de arriba —se pulsa y no pasa
 * nada visible—, con la dirección cambiada. Gonzalo pidió que sea regla: nada
 * que se abra fuera de cuadro se queda fuera de cuadro.
 *
 * Es una ACCIÓN de Svelte y no una función que se llama desde el clic porque
 * aquí lo que hay que mostrar no existe todavía cuando se pulsa: nace con el
 * `{#if}`. Puesta sobre ese bloque —`<div use:revelar>`—, se ejecuta justo
 * cuando se monta, que es exactamente el momento en que hay algo que enseñar.
 *
 * `block: "nearest"` mueve lo mínimo: si ya se ve entero no se mueve nada, y si
 * no cabe se alinea por arriba. `scrollIntoView` recorre solo los contenedores
 * que se desplazan, así que funciona dentro de la `.seccion` y de un diálogo
 * sin buscar a mano cuál es.
 *
 * Acepta una CLAVE opcional —`use:revelar={editandoSueldo}`—: si el bloque ya
 * estaba abierto y se pulsa a otra persona, no se vuelve a montar, pero su
 * contenido cambió y hay que volver a enseñarlo. Svelte llama a `update` cuando
 * la clave cambia.
 */
export function revelar(nodo: Element, _clave?: unknown): { update: () => void } {
  const mostrar = () =>
    requestAnimationFrame(() => {
      // Pudo cerrarse en el mismo cuadro (doble toque): no hay nada que enseñar.
      if (!nodo.isConnected) return;
      nodo.scrollIntoView({ block: "nearest", behavior: comportamiento() });
    });
  mostrar();
  return { update: mostrar };
}
