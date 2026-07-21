<script lang="ts">
  import AgregadoRapido from "./lib/AgregadoRapido.svelte";
  import ConfiguradorPlatillo from "./lib/ConfiguradorPlatillo.svelte";
  import Header from "./lib/Header.svelte";
  import PanelCuenta from "./lib/PanelCuenta.svelte";
  import PanelSalon from "./lib/PanelSalon.svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import Acceso from "./lib/sesion/Acceso.svelte";
  import Bitacora from "./lib/sesion/Bitacora.svelte";
  import CambioCredencial from "./lib/sesion/CambioCredencial.svelte";
  import DialogoAutorizacion from "./lib/sesion/DialogoAutorizacion.svelte";
  import PanelUsuarios from "./lib/sesion/PanelUsuarios.svelte";
  import { autorizacion } from "./lib/sesion/autorizacion.svelte";
  import { sesion } from "./lib/sesion/sesion.svelte";

  let mostrarAcceso = $state(false);
  let mostrarUsuarios = $state(false);
  let mostrarBitacora = $state(false);

  const pendiente = $derived(autorizacion.pendiente);
</script>

<div class="app">
  <Sidebar />
  <div class="main">
    <Header
      onAbrirAcceso={() => (mostrarAcceso = true)}
      onAbrirUsuarios={() => (mostrarUsuarios = true)}
      onAbrirBitacora={() => (mostrarBitacora = true)}
    />
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

{#if mostrarAcceso || !sesion.autenticado}
  <Acceso onCerrar={() => (mostrarAcceso = false)} />
{:else if sesion.debeCambiarCredencial}
  <CambioCredencial />
{/if}

{#if mostrarUsuarios}
  <PanelUsuarios onCerrar={() => (mostrarUsuarios = false)} />
{/if}

{#if mostrarBitacora}
  <Bitacora onCerrar={() => (mostrarBitacora = false)} />
{/if}

{#if pendiente}
  <DialogoAutorizacion
    accion={pendiente.accion}
    razon={pendiente.razon}
    rolesAutorizantes={pendiente.roles}
    contexto={pendiente.contexto}
    onAutorizado={(id) => autorizacion.completar(id)}
    onCancelar={() => autorizacion.cancelar()}
  />
{/if}

{#if autorizacion.aviso}
  <div class="aviso" role="status">{autorizacion.aviso}</div>
{/if}

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
  .aviso {
    position: fixed;
    z-index: 45;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.8rem 1.4rem;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow: var(--sombra-lg);
    max-width: min(28rem, calc(100vw - 2rem));
    text-align: center;
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
