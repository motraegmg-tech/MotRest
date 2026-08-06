<script lang="ts">
  /**
   * El portal del comensal.
   *
   * Lo abre alguien que acaba de comer, de pie, con una mano, en el wifi del
   * restaurante y con prisa. Todo lo demás se subordina a eso:
   *
   *   - **Sin registro.** Pedirle una cuenta para calificar es garantizar que
   *     no califique. Entra con el enlace firmado de su ticket y ya.
   *   - **Una pregunta.** Tres botones grandes. Si algo estuvo mal se le
   *     pregunta qué; si estuvo bien, se le agradece y se acabó.
   *   - **Nada que el restaurante no le haya dado ya.** Ve su consumo, que es
   *     lo que trae impreso, y nada de la operación del local.
   */
  import Encuesta from "./Encuesta.svelte";
  import Kiosco from "./Kiosco.svelte";
  import Reservar from "./Reservar.svelte";

  /*
   * La ruta va en el hash y no en el camino: así el Hub sirve UN archivo para
   * todo el portal, sin reescrituras del lado del servidor. Un `#/c/<codigo>`
   * tampoco viaja en los registros del servidor, que es lo correcto para algo
   * que abre una cuenta.
   */
  let hash = $state(window.location.hash);
  $effect(() => {
    const alCambiar = () => (hash = window.location.hash);
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  });

  const codigo = $derived(
    hash.startsWith("#/c/") ? decodeURIComponent(hash.slice("#/c/".length)) : null,
  );
  const reservando = $derived(hash.startsWith("#/reservar"));
  /*
   * El kiosco es la MISMA aplicación en otro modo, y por eso entra por su propia
   * ruta y no por otro build: la tablet de la entrada y el teléfono del comensal
   * comparten el 90 % del código, y mantener dos aplicaciones que hacen casi lo
   * mismo es la forma más segura de que una se quede atrás.
   */
  const enKiosco = $derived(hash.startsWith("#/kiosco"));
</script>

{#if enKiosco}
  <Kiosco />
{:else}
<main>
  <header>
    <h1>Rodizio</h1>
  </header>

  {#if codigo}
    <Encuesta {codigo} />
  {:else if reservando}
    <Reservar />
  {:else}
    <!--
      Alguien que llegó sin enlace: no puede calificar —no sabemos qué comió—
      pero sí reservar. Se le ofrece lo que sí puede hacer en vez de un error.
    -->
    <section class="tarjeta">
      <h2>Hola</h2>
      <p>
        Para calificar tu visita, escanea el código de tu ticket. Si quieres
        apartar mesa para otro día, aquí abajo.
      </p>
      <a class="boton" href="#/reservar">Apartar una mesa</a>
    </section>
  {/if}

  <footer>MotRest · MOTRAE</footer>
</main>
{/if}

<style>
  :global(:root) {
    --acento: #f2853a;
    --pizarra: #1c2321;
    --gris: #6f7b81;
    --borde: #e3e7e5;
    --fondo: #f7f8f7;
  }
  :global(body) {
    margin: 0;
    background: var(--fondo);
    color: var(--pizarra);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    /* Respeta la muesca del teléfono: se abre casi siempre en móvil. */
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  main {
    max-width: 30rem;
    margin: 0 auto;
    padding: 1.25rem 1rem 2rem;
  }
  header {
    text-align: center;
    padding: 1rem 0 1.25rem;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: 14px;
    padding: 1.25rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.5rem;
  }
  p {
    color: var(--gris);
    line-height: 1.55;
    font-size: 0.95rem;
    margin: 0;
  }
  .boton {
    display: block;
    margin-top: 1rem;
    padding: 0.9rem;
    border-radius: 12px;
    background: var(--acento);
    color: #fff;
    text-align: center;
    text-decoration: none;
    font-weight: 600;
  }
  footer {
    margin-top: 2rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--gris);
  }
</style>
