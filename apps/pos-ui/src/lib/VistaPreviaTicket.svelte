<script lang="ts">
  /**
   * El ticket como va a salir del rollo, en pantalla.
   *
   * ## Por qué no es un dibujo aparte del ticket
   *
   * Se pinta a partir de `aBloques()`, que parte el MISMO flujo de bytes que se
   * manda a la impresora. No es una maqueta parecida: el texto está decodificado
   * de los bytes reales —con sus acentos degradados a CP437 incluidos, que es
   * justo lo que conviene ver antes de gastar papel— y el logo y los códigos se
   * dibujan con sus medidas de verdad en puntos.
   *
   * Escribir aquí una segunda versión del ticket habría sido más rápido, y habría
   * empezado a mentir en la primera plantilla que alguien cambiara.
   *
   * ## Las medidas
   *
   * El papel mide sus columnas de texto —32 o 42— y todo lo demás se mide en
   * proporción a eso: un logo de 288 puntos en un papel de 576 ocupa media hoja,
   * y así se ve. Por eso las anchuras van en `ch` y no en píxeles.
   */
  import {
    PUNTOS_POR_ANCHO,
    type AnchoPapel,
    type BloqueTicket,
    type ImagenMonocroma,
  } from "@motrest/impresion";
  import QRCode from "qrcode";

  interface Props {
    bloques: BloqueTicket[];
    columnas: AnchoPapel;
  }
  let { bloques, columnas }: Props = $props();

  const puntos = $derived(PUNTOS_POR_ANCHO[columnas]);

  /** Puntos por módulo con los que la impresora dibuja el QR (`Ticket.qr`). */
  const PUNTOS_POR_MODULO = 6;
  /** Zona de silencio alrededor del QR, en módulos. Sin ella no lo lee una cámara. */
  const SILENCIO = 2;

  /** El QR como mapa de puntos, igual que lo compone la impresora. */
  function matrizQr(contenido: string): ImagenMonocroma | null {
    try {
      const creado = QRCode.create(contenido, { errorCorrectionLevel: "M" });
      return {
        ancho: creado.modules.size,
        alto: creado.modules.size,
        pixeles: Array.from(creado.modules.data, Boolean),
      };
    } catch {
      // Un enlace imposible no puede dejar la vista previa en blanco.
      return null;
    }
  }

  /**
   * Vuelca un mapa de puntos en un canvas, punto por punto.
   *
   * Un píxel del canvas = un punto del cabezal. El tamaño en pantalla lo pone el
   * CSS con `image-rendering: pixelated`, así que se ve exactamente la trama que
   * va a imprimirse y no una versión suavizada que promete más definición de la
   * que hay.
   */
  function pintado(nodo: HTMLCanvasElement, imagen: ImagenMonocroma) {
    function dibuja(m: ImagenMonocroma) {
      nodo.width = m.ancho;
      nodo.height = m.alto;
      const ctx = nodo.getContext("2d");
      if (!ctx) return;
      const datos = ctx.createImageData(m.ancho, m.alto);
      for (let i = 0; i < m.ancho * m.alto; i += 1) {
        const tono = m.pixeles[i] === true ? 20 : 255;
        datos.data[i * 4] = tono;
        datos.data[i * 4 + 1] = tono;
        datos.data[i * 4 + 2] = tono;
        datos.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(datos, 0, 0);
    }
    dibuja(imagen);
    return { update: dibuja };
  }

  /**
   * Ancho en pantalla de algo que mide `anchoPuntos` puntos en el papel.
   *
   * En PORCENTAJE del papel, y no en `ch` como pedía la intuición: medido en
   * Chromium —el motor de la aplicación instalada—, un `calc()` con `ch` dentro
   * del atributo `style` de un `<canvas>` resuelve la unidad con otra medida que
   * la del `<pre>` de al lado, aunque los dos tengan exactamente la misma fuente
   * calculada (147 px frente a 166 en la comprobación). El porcentaje se mide
   * contra el mismo bloque contenedor que usa el texto, así que logo y renglones
   * comparten regla.
   */
  function anchoEnPapel(anchoPuntos: number): string {
    const fraccion = Math.min(1, anchoPuntos / puntos);
    return `${(fraccion * 100).toFixed(2)}%`;
  }
</script>

<div class="papel" style="--cols: {columnas}">
  {#each bloques as bloque, i (i)}
    {#if bloque.tipo === "texto"}
      <pre>{bloque.lineas.join("\n")}</pre>
    {:else if bloque.tipo === "imagen"}
      {@const anchoPuntos = (bloque.imagen.ancho + bloque.margen * 2) * bloque.escala}
      <canvas
        use:pintado={bloque.imagen}
        style="width: {anchoEnPapel(anchoPuntos)}"
        aria-label="Logo del restaurante, como saldrá impreso"
      ></canvas>
    {:else}
      {@const matriz = matrizQr(bloque.contenido)}
      {#if matriz}
        <canvas
          use:pintado={matriz}
          style="width: {anchoEnPapel((matriz.ancho + SILENCIO * 2) * PUNTOS_POR_MODULO)}"
          aria-label="Código QR del ticket"
        ></canvas>
      {/if}
    {/if}
  {/each}
</div>

<style>
  /*
   * El papel: blanco, monoespaciado y del ancho exacto de sus columnas. El borde
   * dentado de abajo es el corte del rollo — cuesta tres líneas de CSS y es lo
   * que hace que esto se lea como un ticket y no como un cuadro de texto.
   */
  .papel {
    width: calc(var(--cols) * 1ch + 2.4rem);
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 1.1rem 1.2rem 1.4rem;
    background: #fff;
    color: #14181a;
    font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
    font-size: 0.75rem;
    line-height: 1.35;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    /* El dentado del corte. */
    mask-image: radial-gradient(circle 5px at 5px 100%, transparent 96%, #000 100%);
    mask-size: 10px 100%;
    mask-repeat: repeat-x;
  }
  pre {
    margin: 0;
    width: 100%;
    font: inherit;
    white-space: pre;
    /*
     * Un renglón más largo que el papel se desborda en vez de partirse: así se
     * ve que NO CABE, que es lo que hace falta saber al escribir un mensaje.
     */
    overflow-x: auto;
  }
  canvas {
    display: block;
    height: auto;
    /* Un punto del cabezal = un píxel, sin suavizar: la trama de verdad. */
    image-rendering: pixelated;
  }
</style>
