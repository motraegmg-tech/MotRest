<script lang="ts">
  /**
   * Lo que le llegaría al comensal, tal cual.
   *
   * NO ES UNA MAQUETA. Sale de `armarCorreo`, la misma función con la que el Hub
   * arma el correo que manda: el mismo asunto, el mismo remitente, el mismo
   * HTML. Una maqueta aparte se habría desviado del correo de verdad a la
   * primera corrección, y enseñar una cosa y mandar otra es peor que no enseñar
   * nada.
   *
   * Se ve como en un cliente de correo —De, Para, Asunto arriba— porque así es
   * como lo va a leer el comensal, y porque el asunto es lo primero que decide
   * si el correo se abre.
   */
  import {
    armarCorreo,
    type ConfiguracionCorreo,
    type DatosCorreo,
    type TipoCorreo,
  } from "@motrest/dominio";

  interface Props {
    tipo: TipoCorreo;
    para: string;
    config: ConfiguracionCorreo;
    datos: DatosCorreo;
  }

  let { tipo, para, config, datos }: Props = $props();

  const armado = $derived(armarCorreo(tipo, para, config, datos));

  let vista = $state<"diseno" | "texto">("diseno");

  /*
   * EL DOCUMENTO DEL MARCO lleva lo mínimo: la codificación y el margen del
   * cuerpo, este en un atributo `style`.
   *
   * Nada de hoja de estilos incrustada, por dos razones. (Y el nombre de esa
   * etiqueta no se escribe aquí entre ángulos: el preprocesador de Svelte la
   * busca con una expresión regular en todo el archivo y se confunde con la de
   * verdad.) Un `srcdoc` hereda la política
   * de seguridad de la página que lo contiene, y la del Hub (`style-src 'self'`)
   * la bloquearía. Y cualquier estilo añadido aquí cambiaría cómo se ve el
   * correo respecto a lo que de verdad llega, que es justo lo que no debe pasar.
   */
  const documento = $derived(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"></head>` +
      `<body style="margin:0;background:#ffffff">${armado.html}</body></html>`,
  );
</script>

<div class="vista">
  <dl class="cabecera">
    <div>
      <dt>De</dt>
      <dd class:falta={!armado.de}>{armado.de || "Todavía sin remitente"}</dd>
    </div>
    <div>
      <dt>Para</dt>
      <dd>{armado.para}</dd>
    </div>
    <div>
      <dt>Asunto</dt>
      <dd class="asunto">{armado.asunto}</dd>
    </div>
  </dl>

  <div class="pestanas" role="tablist" aria-label="Cómo verlo">
    <button
      role="tab"
      aria-selected={vista === "diseno"}
      class:on={vista === "diseno"}
      onclick={() => (vista = "diseno")}
    >
      Como se ve
    </button>
    <button
      role="tab"
      aria-selected={vista === "texto"}
      class:on={vista === "texto"}
      onclick={() => (vista = "texto")}
    >
      Solo texto
    </button>
  </div>

  {#if vista === "diseno"}
    <!--
      SANDBOX VACÍO, Y ASÍ SE QUEDA: nada de `allow-scripts` ni de
      `allow-same-origin`.

      Lo que va dentro lleva texto que escribió el restaurante —el mensaje de una
      promoción, el nombre del local— y texto que escribió un comensal —su nombre,
      desde el portal público de reservas—. `armarCorreo` lo escapa, pero la
      vista previa no puede depender de que nadie se equivoque nunca ahí: un
      iframe sin sandbox ejecutaría cualquier cosa que se colara con los permisos
      del POS, que son los de la caja entera. Con el sandbox vacío el marco no
      corre scripts, no abre ventanas, no navega la página de fuera y ni
      siquiera comparte origen con ella.

      No se ajusta solo a la altura del contenido porque para medirlo habría que
      leer su documento, y eso exige `allow-same-origin`. Lleva una altura fija
      razonable y su propio desplazamiento.
    -->
    <iframe title="Cómo le llega el correo al comensal" srcdoc={documento} sandbox=""></iframe>
  {:else}
    <pre class="texto">{armado.texto}</pre>
    <p class="nota">
      Cada correo sale también en esta versión sin diseño. La leen quienes tienen
      el correo en modo texto, y los filtros de spam desconfían del correo que no
      la trae.
    </p>
  {/if}
</div>

<style>
  .vista {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .cabecera {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.65rem 0.8rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
  }
  .cabecera div {
    display: flex;
    gap: 0.6rem;
    min-width: 0;
  }
  dt {
    flex: none;
    width: 3.6rem;
    font-weight: 600;
    color: var(--gris);
  }
  dd {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--pizarra);
  }
  dd.asunto {
    font-weight: 600;
  }
  dd.falta {
    color: var(--peligro);
    font-weight: 600;
  }
  .pestanas {
    align-self: flex-start;
  }
  iframe {
    width: 100%;
    height: min(24rem, 50vh);
    border: 1px solid var(--borde-tarjeta);
    border-radius: var(--r-sm);
    background: var(--blanco);
  }
  .texto {
    margin: 0;
    max-height: min(24rem, 50vh);
    overflow: auto;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--borde-tarjeta);
    border-radius: var(--r-sm);
    background: var(--blanco);
    font-family: ui-monospace, Consolas, monospace;
    font-size: var(--t-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .nota {
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.5;
  }
</style>
