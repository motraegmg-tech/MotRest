<script lang="ts" module>
  import { TONOS } from "@motrest/ui/iconos";

  /**
   * El hexadecimal de respaldo por tono.
   *
   * Se arma una vez al cargar el módulo, no por instancia: en el tablero de
   * cocina hay decenas de iconos en pantalla a la vez.
   */
  const TONO_RESPALDO: Record<string, string> = Object.fromEntries(
    Object.entries(TONOS).map(([clave, tono]) => [clave, tono.hex]),
  );
</script>

<script lang="ts">
  /**
   * Un icono del set de MotRest.
   *
   * ## Por qué es decorativo por defecto
   *
   * Casi siempre el icono va JUNTO a su palabra —«Cobrar», «Enviar a cocina»—,
   * y ahí anunciarlo al lector de pantalla haría que dijera la misma cosa dos
   * veces. Por eso nace con `aria-hidden` y solo se vuelve una imagen con
   * nombre cuando alguien pasa `rotulo`, que es el caso del icono que va solo.
   *
   * ## Por qué el color se pide, no se asume
   *
   * Sin `color`, el dibujo entero es `currentColor`: hereda el color del texto
   * que lo rodea. Es lo que se quiere en una tabla, en un botón secundario o en
   * cualquier sitio donde el icono acompaña y no manda.
   *
   * Con `color`, el relleno toma el tono propio del icono. Es para el carril,
   * el tablero de cocina y la cuadrícula de la carta: sitios donde el ojo busca
   * por color antes de leer.
   *
   * La línea sigue siendo `currentColor` en los dos modos. Eso es lo que hace
   * que el mismo dibujo sirva sobre el carril negro y sobre un panel claro sin
   * tocarlo: el relleno pone la identidad, el trazo se adapta al fondo.
   *
   * ## Por qué el tono sale de una variable CSS
   *
   * `var(--i-brasa, #c25a12)` — la variable manda y el hexadecimal es el
   * respaldo. Así un local puede reteñir un icono desde su hoja de estilo sin
   * recompilar, y si la variable no existe el dibujo igual sale bien.
   */
  import { ICONOS, type NombreIcono } from "@motrest/ui/iconos";

  interface Props {
    nombre: NombreIcono;
    /** Lado en píxeles. 18 en el carril, 20 en botones, 40 en estados vacíos. */
    tam?: number;
    /** true = el relleno toma el tono del icono; si no, todo hereda el color del texto. */
    color?: boolean;
    /**
     * Qué anunciar al lector de pantalla.
     *
     * Solo cuando el icono va SIN su palabra al lado. Si hay texto visible que
     * dice lo mismo, no lo pases: se leería dos veces.
     */
    rotulo?: string;
  }

  const { nombre, tam = 20, color = false, rotulo }: Props = $props();

  const icono = $derived(ICONOS[nombre]);

  function tinta(tono: string | undefined): string {
    if (!color || !tono) return "currentColor";
    return `var(--i-${tono}, ${TONO_RESPALDO[tono] ?? "currentColor"})`;
  }
</script>

<svg
  width={tam}
  height={tam}
  viewBox="0 0 24 24"
  role={rotulo ? "img" : undefined}
  aria-hidden={rotulo ? undefined : true}
  aria-label={rotulo}
>
  {#if rotulo}<title>{rotulo}</title>{/if}

  <!--
    El relleno va PRIMERO y sin trazo: es la mancha de color que la línea de
    abajo delinea. Al revés, el trazo quedaría enterrado bajo el relleno.

    `{@html}` pinta geometría de nuestro propio módulo —rutas y círculos que
    escribimos nosotros—, no texto que venga de un usuario ni del Hub.
  -->
  {#if icono.fondo}
    <g fill={tinta(icono.tono)} stroke="none">
      {@html icono.fondo}
    </g>
  {/if}

  {#if icono.fondo2}
    <g fill={tinta(icono.tono2)} stroke="none">
      {@html icono.fondo2}
    </g>
  {/if}

  <g
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {@html icono.linea}
  </g>
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
