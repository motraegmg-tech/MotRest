<script lang="ts">
  /**
   * La ventana del «Ver más»: una lista completa, a lo ancho de la pantalla.
   *
   * Los reportes muestran los primeros renglones y esconden el resto, que es lo
   * correcto en una tarjeta —nadie quiere doscientos productos en la pantalla de
   * Inteligencia—. Lo que faltaba era a dónde ir a verlos: desplegarlos dentro
   * de la propia tarjeta empuja todo lo demás hacia abajo y obliga a recorrer la
   * pantalla entera para volver a lo que se estaba mirando.
   *
   * Aquí la lista se abre encima, ocupando el ancho que necesita, con su propio
   * scroll. Al cerrarla, la pantalla de atrás sigue exactamente donde estaba.
   */
  import type { Snippet } from "svelte";

  interface Props {
    titulo: string;
    /** Una línea de contexto: el periodo, cuántos son, de dónde salen. */
    subtitulo?: string;
    onCerrar: () => void;
    children: Snippet;
  }
  let { titulo, subtitulo, onCerrar, children }: Props = $props();
</script>

<!--
  Escape cierra. En la caja se opera con el dedo, pero quien mira reportes suele
  estar en la computadora de la oficina con un teclado delante.
-->
<svelte:window onkeydown={(e) => e.key === "Escape" && onCerrar()} />

<div class="velo-amplio" role="presentation" onclick={onCerrar}></div>
<div class="ventana-amplia" role="dialog" aria-modal="true" aria-label={titulo}>
  <header>
    <div class="titulos">
      <b>{titulo}</b>
      {#if subtitulo}<span>{subtitulo}</span>{/if}
    </div>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">✕</button>
  </header>
  <div class="cuerpo">
    {@render children()}
  </div>
</div>

<style>
  .velo-amplio {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.5);
    z-index: 60;
  }
  .ventana-amplia {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* Ancha de verdad: una tabla de reporte no cabe en un diálogo de formulario. */
    width: min(80rem, calc(100vw - 3rem));
    max-height: calc(100vh - 3rem);
    background: #fff;
    border-radius: var(--r-lg);
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--borde);
    flex-shrink: 0;
  }
  .titulos {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .titulos b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .titulos span {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .cerrar {
    font-size: 1.2rem;
    color: var(--gris);
    line-height: 1;
    padding: 0.25rem 0.4rem;
  }
  .cerrar:hover {
    color: var(--pizarra);
  }
  /*
   * El scroll vive AQUÍ, no en la ventana: la cabecera con el título tiene que
   * quedarse a la vista mientras se recorre una lista de cien renglones.
   */
  .cuerpo {
    overflow: auto;
    padding: 1.1rem 1.25rem 1.4rem;
  }
</style>
