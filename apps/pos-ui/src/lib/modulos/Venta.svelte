<script lang="ts">
  /**
   * M1 · Venta y servicio — el POS.
   *
   * Distribución responsive según el TRD §12:
   *   escritorio (≥1280 px) → tres columnas, como el mockup P1
   *   tablet (768–1279 px)  → el salón se colapsa en cajón lateral
   *   teléfono (<768 px)    → flujo por pasos
   */
  import AgregadoRapido from "../AgregadoRapido.svelte";
  import ConfiguradorPlatillo from "../ConfiguradorPlatillo.svelte";
  import PanelCuenta from "../PanelCuenta.svelte";
  import PanelSalon from "../PanelSalon.svelte";
  import { pos } from "../pos.svelte";

  /** Paso activo en el perfil de teléfono. */
  let paso = $state<"salon" | "carta" | "cuenta">("carta");
  let cajonSalon = $state(false);
</script>

<div class="venta">
  <!-- Salón: columna fija en escritorio, cajón en tablet, paso en teléfono -->
  <div class="salon" class:cajon-abierto={cajonSalon} data-paso={paso}>
    <PanelSalon />
  </div>

  {#if cajonSalon}
    <div class="velo-cajon" role="presentation" onclick={() => (cajonSalon = false)}></div>
  {/if}

  <div class="centro" data-paso={paso}>
    <div class="barra-tablet">
      <button class="abrir-salon" onclick={() => (cajonSalon = true)}>
        ☰ Salón · mesa {pos.numeroMesaActiva}
      </button>
    </div>
    <ConfiguradorPlatillo />
    <AgregadoRapido />
  </div>

  <div class="cuenta" data-paso={paso}>
    <PanelCuenta />
  </div>

  <!-- Navegación por pasos, solo en teléfono -->
  <nav class="pasos">
    <button class:on={paso === "salon"} onclick={() => (paso = "salon")}>Salón</button>
    <button class:on={paso === "carta"} onclick={() => (paso = "carta")}>Carta</button>
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
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr) minmax(20rem, 27rem);
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
  .barra-tablet {
    display: none;
    padding: 0.75rem 1.75rem 0;
  }
  .abrir-salon {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.5rem 0.9rem;
    font-size: 0.88rem;
    font-weight: 600;
    background: #fff;
    color: var(--pizarra);
  }
  .pasos {
    display: none;
  }
  .velo-cajon {
    display: none;
  }

  /* --- Tablet: el salón pasa a cajón lateral (TRD §12) --- */
  @media (max-width: 1279px) and (min-width: 768px) {
    .venta {
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
    }
    .salon {
      position: fixed;
      z-index: 25;
      top: 0;
      bottom: 0;
      left: 0;
      width: 17rem;
      transform: translateX(-100%);
      transition: transform 0.18s ease;
      box-shadow: var(--sombra-lg);
    }
    .salon.cajon-abierto {
      transform: translateX(0);
    }
    .velo-cajon {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 24;
      background: rgba(20, 24, 26, 0.4);
    }
    .barra-tablet {
      display: block;
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
    .centro[data-paso="carta"],
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
