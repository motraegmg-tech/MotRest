<script lang="ts">
  /**
   * MotRest Central — el panel de Gonzalo.
   *
   * NO se instala en ningún restaurante: corre en la máquina de MOTRAE y mira
   * los locales desde fuera. Comparte con MotRest el paquete de dominio y los
   * tokens de marca, y nada más.
   *
   * Cuatro pantallas y ni una más, en el orden en que se usan:
   *   Hoy          — qué está mal y a quién hay que cobrarle
   *   Restaurantes — la cartera y la ficha de cada uno
   *   Versiones    — preparar y firmar una actualización
   *   Llaves       — los secretos y el acceso de soporte
   */
  import "@motrest/ui/tokens.css";
  import "@motrest/ui/base.css";
  import { onMount } from "svelte";
  import Hoy from "./paneles/Hoy.svelte";
  import Restaurantes from "./paneles/Restaurantes.svelte";
  import Actualizaciones from "./paneles/Actualizaciones.svelte";
  import Llaves from "./paneles/Llaves.svelte";
  import { central } from "./lib/central.svelte";

  type Pantalla = "hoy" | "restaurantes" | "versiones" | "llaves";

  let pantalla = $state<Pantalla>("hoy");
  let seleccionado = $state("");

  const PANTALLAS: { clave: Pantalla; titulo: string }[] = [
    { clave: "hoy", titulo: "Hoy" },
    { clave: "restaurantes", titulo: "Restaurantes" },
    { clave: "versiones", titulo: "Versiones" },
    { clave: "llaves", titulo: "Llaves" },
  ];

  /*
   * DPAPI se consulta solo cuando existe la ventana Tauri, nunca al importar el
   * módulo. El sondeo del relay arranca DESPUÉS: la dirección y la clave viven
   * en el almacén protegido, así que antes de abrirlo no hay a quién preguntar.
   */
  onMount(() => {
    void central.inicializarSecretos().then(() => central.arrancarSondeoDePulsos());
    return () => central.detenerSondeoDePulsos();
  });

  /** Lo urgente, para el punto del menú. */
  const urgentes = $derived(
    central.pendientes.filter((p) => p.urgencia === "caido" || p.urgencia === "bloqueado").length,
  );

  function abrirLocal(id: string) {
    seleccionado = id;
    pantalla = "restaurantes";
  }
</script>

<div class="app">
  <aside class="menu">
    <div class="logo">
      MotRest<span>Central</span>
    </div>

    <nav>
      {#each PANTALLAS as p (p.clave)}
        <button class:on={pantalla === p.clave} onclick={() => (pantalla = p.clave)}>
          {p.titulo}
          {#if p.clave === "hoy" && urgentes > 0}
            <b class="urgente">{urgentes}</b>
          {/if}
          {#if p.clave === "llaves" && !central.configurado}
            <b class="falta">!</b>
          {/if}
        </button>
      {/each}
    </nav>

    <div class="pie">
      {central.resumen.locales} locales · MOTRAE
    </div>
  </aside>

  <main>
    {#if pantalla === "hoy"}
      <Hoy onAbrir={abrirLocal} />
    {:else if pantalla === "restaurantes"}
      <Restaurantes bind:seleccionado />
    {:else if pantalla === "versiones"}
      <Actualizaciones />
    {:else}
      <Llaves />
    {/if}
  </main>
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--fondo);
  }
  .menu {
    flex: none;
    width: 13rem;
    display: flex;
    flex-direction: column;
    padding: 1.25rem 0.75rem;
    background: var(--negro);
    color: #b9c2bc;
  }
  .logo {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #fff;
    padding: 0 0.5rem 1.2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 0.9rem;
  }
  .logo span {
    display: block;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--acento);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  nav button:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  nav button.on {
    background: var(--acento);
    color: var(--blanco);
    font-weight: 600;
  }
  /*
   * El contador de lo caído va en el menú, no solo dentro de la pantalla: la
   * gracia de un panel es enterarse sin tener que ir a mirar.
   */
  .urgente,
  .falta {
    margin-left: auto;
    min-width: 1.15rem;
    height: 1.15rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-pill);
    background: var(--peligro);
    color: #fff;
    font-size: 0.68rem;
    font-weight: 700;
  }
  .falta {
    background: var(--acento-2);
    color: var(--negro);
  }
  .pie {
    font-size: 0.7rem;
    color: #55636a;
    padding: 0.8rem 0.5rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  @media (max-width: 700px) {
    .app {
      flex-direction: column;
    }
    .menu {
      width: auto;
      padding: 0.8rem;
    }
    nav {
      flex-direction: row;
      overflow-x: auto;
    }
    .pie {
      display: none;
    }
  }
</style>
