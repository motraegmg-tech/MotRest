<script lang="ts">
  /**
   * Carta del restaurante: categorías, buscador y rejilla de productos.
   *
   * Es la columna central del POS. Al tocar un producto, si necesita
   * configuración se abre el configurador; si no, entra directo a la cuenta.
   */
  import { buscarProductos, productosDeCategoria, type Producto } from "@motrest/dominio";
  import { catalogo, categorias } from "./catalogo";
  import { configurador } from "./configurador.svelte";
  import { mxn } from "./formato";
  import { pos } from "./pos.svelte";

  let categoriaActiva = $state(categorias[0]!.id);
  let busqueda = $state("");

  const buscando = $derived(busqueda.trim().length > 0);

  const productos = $derived(
    buscando
      ? buscarProductos(catalogo, busqueda)
      : productosDeCategoria(catalogo, categoriaActiva),
  );

  async function tocar(producto: Producto) {
    if (configurador.necesitaConfigurar(producto.id)) {
      configurador.abrir(producto.id);
    } else {
      await pos.agregarSimple(producto.id);
    }
  }

  /** Etiqueta corta de lo que el producto pedirá configurar. */
  function pista(producto: Producto): string | null {
    if (producto.esquema_porciones) return "mitad y mitad";
    const obligatorios = (producto.grupos_modificadores ?? [])
      .map((id) => catalogo.grupos.get(id))
      .filter((g) => g && g.min > 0);
    if (obligatorios.length > 0) {
      return obligatorios.map((g) => g!.nombre.toLowerCase()).join(" · ");
    }
    return null;
  }
</script>

<section class="carta">
  <div class="top">
    <h2>Carta</h2>
    <input
      class="buscar"
      type="search"
      bind:value={busqueda}
      placeholder="Buscar platillo…"
      aria-label="Buscar en la carta"
    />
  </div>

  {#if !buscando}
    <div class="categorias">
      {#each categorias as categoria (categoria.id)}
        <button
          class="categoria"
          class:on={categoria.id === categoriaActiva}
          onclick={() => (categoriaActiva = categoria.id)}
        >
          {categoria.nombre}
        </button>
      {/each}
    </div>
  {/if}

  <div class="rejilla">
    {#each productos as producto (producto.id)}
      {@const requiere = pista(producto)}
      <button class="producto" onclick={() => tocar(producto)}>
        <span class="nombre">{producto.nombre}</span>
        {#if requiere}<span class="pista">{requiere}</span>{/if}
        <span class="precio">{mxn(producto.precio)}</span>
      </button>
    {:else}
      <p class="vacio">
        {buscando ? `Nada coincide con "${busqueda}"` : "Esta categoría no tiene productos"}
      </p>
    {/each}
  </div>
</section>

<style>
  .carta {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 1.25rem 1.5rem 0.5rem;
    overflow-y: auto;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.85rem;
  }
  h2 {
    font-size: 1.4rem;
    font-weight: 600;
    flex: none;
  }
  .buscar {
    flex: 1;
    max-width: 22rem;
    padding: 0.55rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    font-size: 0.92rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  .buscar:focus {
    outline: none;
    border-color: var(--acento);
  }
  .categorias {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.85rem;
  }
  .categoria {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .categoria.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .rejilla {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 0.6rem;
    align-content: start;
  }
  .producto {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 0.85rem;
    text-align: left;
    min-height: 4.5rem;
    transition:
      border-color 0.1s ease,
      transform 0.08s ease;
  }
  .producto:hover {
    border-color: var(--acento);
    transform: translateY(-1px);
  }
  .producto:active {
    transform: translateY(0);
  }
  .nombre {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--pizarra);
    line-height: 1.25;
  }
  .pista {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--acento);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.08rem 0.4rem;
  }
  .precio {
    margin-top: auto;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 700;
    color: var(--acento);
  }
  .vacio {
    grid-column: 1 / -1;
    padding: 1.5rem 0;
    color: var(--gris);
    font-style: italic;
  }
</style>
