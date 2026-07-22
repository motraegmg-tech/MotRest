<script lang="ts">
  /**
   * M1 · Venta y servicio — el POS.
   *
   * El salón queda SIEMPRE a la vista en la izquierda: es el mapa del turno y el
   * mesero lo consulta a cada rato. La columna central muestra la mesa
   * seleccionada y, solo cuando se va a ordenar, la carta.
   */
  import CatalogoProductos from "../CatalogoProductos.svelte";
  import ConfiguradorProducto from "../ConfiguradorProducto.svelte";
  import PanelCuenta from "../PanelCuenta.svelte";
  import PanelMesa from "../PanelMesa.svelte";
  import PanelSalon from "../PanelSalon.svelte";
  import { pos } from "../pos.svelte";

  /** Vista de la columna central. */
  let modo = $state<"mesa" | "pedido">("mesa");

  /** Paso activo en el perfil de teléfono. */
  let paso = $state<"salon" | "centro" | "cuenta">("centro");

  // Al cambiar de mesa se vuelve al panel de la mesa: el pedido es de una mesa
  // concreta, no un modo global.
  let ultimaMesa = $state(pos.mesaActiva);
  $effect(() => {
    if (pos.mesaActiva !== ultimaMesa) {
      ultimaMesa = pos.mesaActiva;
      modo = "mesa";
    }
  });
</script>

<div class="venta">
  <div class="salon" data-paso={paso}>
    <PanelSalon />
  </div>

  <div class="centro" data-paso={paso}>
    {#if modo === "pedido"}
      <div class="barra-pedido">
        <button class="volver" onclick={() => (modo = "mesa")}>← Mesa {pos.nombreMesaActiva}</button>
        <span class="titulo-pedido">Pedido</span>
      </div>
      <CatalogoProductos />
    {:else}
      <PanelMesa onPedido={() => (modo = "pedido")} />
    {/if}
  </div>

  <div class="cuenta" data-paso={paso}>
    <PanelCuenta />
  </div>

  <ConfiguradorProducto />

  <!-- Navegación por pasos, solo en teléfono -->
  <nav class="pasos">
    <button class:on={paso === "salon"} onclick={() => (paso = "salon")}>Salón</button>
    <button class:on={paso === "centro"} onclick={() => (paso = "centro")}>
      {modo === "pedido" ? "Pedido" : "Mesa"}
    </button>
    <button class:on={paso === "cuenta"} onclick={() => (paso = "cuenta")}>
      Cuenta
      {#if pos.renglones.length > 0}<span class="badge">{pos.renglones.length}</span>{/if}
    </button>
  </nav>
</div>

<style>
  .venta {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr) minmax(19rem, 26rem);
    min-height: 0;
    position: relative;
  }
  .salon,
  .cuenta {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .centro {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .barra-pedido {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.85rem 1.5rem 0;
    flex: none;
  }
  .volver {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.4rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .volver:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .titulo-pedido {
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--acento);
  }
  .pasos {
    display: none;
  }

  /* --- Tablet: el salón se estrecha pero NO se esconde --- */
  @media (max-width: 1279px) and (min-width: 768px) {
    .venta {
      grid-template-columns: minmax(11rem, 14rem) minmax(0, 1fr) minmax(16rem, 21rem);
    }
  }

  /* --- Teléfono: flujo por pasos --- */
  @media (max-width: 767px) {
    .venta {
      display: flex;
      flex-direction: column;
      padding-bottom: 3.5rem;
    }
    .salon,
    .centro,
    .cuenta {
      display: none;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .salon[data-paso="salon"],
    .centro[data-paso="centro"],
    .cuenta[data-paso="cuenta"] {
      display: flex;
    }
    .pasos {
      display: flex;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 26;
      background: #fff;
      border-top: 1px solid var(--borde);
    }
    .pasos button {
      flex: 1;
      padding: 0.9rem 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--gris);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
    }
    .pasos button.on {
      color: var(--acento);
      box-shadow: inset 0 2px 0 var(--acento);
    }
    .badge {
      background: var(--acento);
      color: #fff;
      border-radius: var(--r-pill);
      font-size: 0.7rem;
      padding: 0.05rem 0.35rem;
    }
  }
</style>
