<script lang="ts">
  import AgregadoRapido from "./lib/AgregadoRapido.svelte";
  import ConfiguradorPlatillo from "./lib/ConfiguradorPlatillo.svelte";
  import Header from "./lib/Header.svelte";
  import PanelCuenta from "./lib/PanelCuenta.svelte";
  import PanelSalon from "./lib/PanelSalon.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
</script>

<div class="app">
  <Sidebar />
  <div class="main">
    <Header />
    <div class="content">
      <PanelSalon />
      <div class="centro">
        <ConfiguradorPlatillo />
        <AgregadoRapido />
      </div>
      <PanelCuenta />
    </div>
  </div>
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .content {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(20rem, 27rem);
    min-height: 0;
  }
  .centro {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  @media (max-width: 1100px) {
    .content {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .centro {
      overflow: visible;
    }
  }
</style>
