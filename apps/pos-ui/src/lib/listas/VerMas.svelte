<script lang="ts">
  /**
   * «Ver más», al pie de una lista larga (1.5.6, pedido de Gonzalo).
   *
   * Solo aparece si queda algo escondido, y dice cuánto: «Ver más (quedan 37)».
   * Sin la cifra, quien busca una cuenta de hace tres semanas no sabe si pulsar
   * una vez o veinte. Los renglones nuevos nacen justo donde estaba el botón,
   * así que ya quedan a la vista sin mover la página.
   */
  import type { Paginado } from "./listas.svelte";

  let { pag, lista }: { pag: Paginado; lista: readonly unknown[] } = $props();

  const restantes = $derived(pag.restantes(lista));
</script>

{#if restantes > 0}
  <div class="ver-mas">
    <button onclick={() => pag.verMas()}>
      Ver más <span>(quedan {restantes})</span>
    </button>
  </div>
{/if}

<style>
  .ver-mas {
    display: flex;
    justify-content: center;
    margin-top: 0.7rem;
  }
  button {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.45rem 1.1rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-pill, 999px);
    background: #fff;
    color: var(--acento-texto);
    cursor: pointer;
  }
  button:hover {
    background: var(--claro);
  }
  span {
    font-weight: 500;
    color: var(--gris);
  }
</style>
