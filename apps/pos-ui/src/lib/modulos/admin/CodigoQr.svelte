<script lang="ts">
  /**
   * Código QR del enlace de emparejamiento.
   *
   * Es lo que quita la última fricción de dar de alta una terminal: en vez de
   * teclear una IP y 43 caracteres de clave sin equivocarse, se escanea con la
   * cámara y listo.
   *
   * El QR **lleva la clave del local** dentro. Se muestra a petición y no de
   * entrada, porque enseñarlo permanentemente en la pantalla de la caja lo
   * dejaría a la vista de cualquiera que pase.
   */
  import QRCode from "qrcode";

  interface Props {
    contenido: string;
    /** Lado del cuadro, en píxeles. */
    tamano?: number;
  }
  let { contenido, tamano = 220 }: Props = $props();

  let lienzo = $state<HTMLCanvasElement | null>(null);
  let error = $state("");

  $effect(() => {
    const destino = lienzo;
    if (!destino || !contenido) return;

    // Corrección de errores media: el QR sigue leyéndose con la pantalla
    // sucia o con reflejos, que es la condición normal de una caja.
    QRCode.toCanvas(destino, contenido, {
      width: tamano,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#14181a", light: "#ffffff" },
    }).catch((causa: unknown) => {
      console.error("No se pudo generar el QR", causa);
      error = "No se pudo generar el código";
    });
  });
</script>

{#if error}
  <p class="error">{error}</p>
{:else}
  <canvas bind:this={lienzo} width={tamano} height={tamano} aria-label="Código de emparejamiento"
  ></canvas>
{/if}

<style>
  canvas {
    display: block;
    border-radius: var(--r-md);
    background: #fff;
    padding: 0.5rem;
    box-shadow: var(--sombra-sm);
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
  }
</style>
