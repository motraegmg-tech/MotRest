<script lang="ts">
  import { productoDe } from "@motrest/dominio";
  import { catalogo, categoriasRapidas, productosRapidos } from "./catalogo";
  import { mxn } from "./formato";
  import { pos } from "./pos.svelte";

  const grupos = categoriasRapidas.map((catId) => ({
    id: catId,
    nombre: catalogo.categorias.get(catId)?.nombre ?? catId,
    productos: productosRapidos
      .map((id) => productoDe(catalogo, id))
      .filter((p) => p.categoria_id === catId),
  }));
</script>

<section class="rapido">
  {#each grupos as grupo (grupo.id)}
    <div class="grupo">
      <h3>{grupo.nombre}</h3>
      <div class="grid">
        {#each grupo.productos as producto (producto.id)}
          <button class="tarjeta" onclick={() => pos.agregarSimple(producto.id)}>
            <span class="n">{producto.nombre}</span>
            <span class="p">{mxn(producto.precio)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/each}
</section>

<style>
  .rapido {
    flex: none;
    padding: 0 1.75rem 1.25rem;
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
  }
  .grupo {
    flex: 1;
    min-width: 12rem;
  }
  h3 {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.6rem;
  }
  .grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .tarjeta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 0.9rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
    text-align: left;
    transition:
      border-color 0.1s ease,
      transform 0.08s ease;
  }
  .tarjeta:hover {
    border-color: var(--acento);
    transform: translateY(-1px);
  }
  .tarjeta:active {
    transform: translateY(0);
  }
  .tarjeta .p {
    color: var(--acento);
    font-weight: 700;
    white-space: nowrap;
  }
</style>
