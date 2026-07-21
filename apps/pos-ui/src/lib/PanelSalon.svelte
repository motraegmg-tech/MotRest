<script lang="ts">
  import { mesas, pos } from "./pos.svelte";
</script>

<section class="mesas">
  <h2>Salón</h2>
  <div class="mgrid">
    {#each mesas as mesa (mesa.id)}
      {@const estado = pos.estadoMesa(mesa.id)}
      <button
        class="mesa {estado}"
        class:sel={mesa.id === pos.mesaActiva}
        onclick={() => pos.seleccionarMesa(mesa.id)}
      >
        {mesa.numero}
        <small>
          {#if estado === "libre"}libre
          {:else if estado === "cuenta"}en cocina
          {:else}en servicio{/if}
        </small>
      </button>
    {/each}
  </div>
  <div class="leg">
    <span><i style="background: var(--peligro)"></i>Ocupada · en servicio</span>
    <span><i style="background: var(--acento)"></i>Enviada a cocina</span>
    <span><i style="background: #dde3da"></i>Libre</span>
  </div>
</section>

<style>
  .mesas {
    background: #fff;
    border-right: 1px solid var(--borde);
    padding: 1.5rem;
    overflow-y: auto;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }
  .mgrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .mesa {
    border-radius: var(--r-md);
    padding: 0.85rem 0.5rem;
    text-align: center;
    font-weight: 600;
    font-size: 1.1rem;
    border: 2px solid var(--borde);
    color: var(--gris);
    background: #fff;
    transition:
      transform 0.08s ease,
      box-shadow 0.12s ease;
  }
  .mesa:hover {
    transform: translateY(-1px);
    box-shadow: var(--sombra-sm);
  }
  .mesa:active {
    transform: translateY(0);
  }
  .mesa small {
    display: block;
    font-size: 0.72rem;
    font-weight: 500;
    margin-top: 0.15rem;
  }
  .mesa.ocupada {
    background: #fdeae8;
    border-color: var(--peligro);
    color: var(--pizarra);
  }
  .mesa.cuenta {
    background: var(--claro);
    border-color: var(--acento);
    color: var(--pizarra);
  }
  .mesa.sel {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
    box-shadow: var(--sombra-md);
  }
  .leg {
    margin-top: 1.25rem;
    font-size: 0.85rem;
    color: var(--gris);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .leg span {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .leg i {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 4px;
  }
</style>
