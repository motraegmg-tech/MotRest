<script lang="ts" generics="T">
  /**
   * El botón de «Ordenar» de una lista (1.5.6, pedido de Gonzalo).
   *
   * Dice en su propio rótulo cómo está ordenada la lista —«Ordenar: A a la Z»—,
   * porque una lista reordenada sin decirlo parece una lista a la que le
   * faltan cosas. Al pulsarlo despliega las opciones; al elegir una, se cierra.
   *
   * Recuerda la elección por lista y por terminal si se le da `recordar`: quien
   * busca siempre por nombre no tiene que pedirlo cada vez.
   */
  import { recordarOrden, type OpcionOrden } from "./listas.svelte";

  let {
    opciones,
    valor = $bindable(),
    recordar,
    onCambiar,
    rotulo = "Ordenar",
  }: {
    opciones: readonly OpcionOrden<T>[];
    valor: string;
    /** Nombre de la lista para recordar el orden en esta terminal. */
    recordar?: string;
    onCambiar?: (id: string) => void;
    /**
     * Lo que dice el botón antes de los dos puntos. Hace falta cuando una misma
     * pantalla tiene dos listas que se ordenan por separado —las categorías de
     * la carta y los platillos de cada una—: dos botones que dicen «Ordenar» a
     * secas no dicen cuál ordena qué.
     */
    rotulo?: string;
  } = $props();

  let abierto = $state(false);
  const actual = $derived(opciones.find((o) => o.id === valor) ?? opciones[0]);

  /*
   * DÓNDE SE DIBUJAN LAS OPCIONES.
   *
   * Se despliegan junto al botón, pero en posición FIJA respecto a la ventana y
   * no colgadas del botón. Casi todas las listas de la caja viven en una
   * tarjeta con `overflow-x: auto` —para que una tabla ancha se desplace dentro
   * sin romper la página— u `overflow: hidden` —para recortar las esquinas—, y
   * cualquiera de los dos RECORTA lo que se sale de la tarjeta: en una lista de
   * dos proveedores, el menú colgado del botón quedaba cortado a la mitad y con
   * su propia barra de desplazamiento dentro de la tarjeta.
   *
   * Si abajo no cabe —el botón está al pie de la pantalla—, se abre hacia
   * arriba. Y si la página se desplaza con el menú abierto, se cierra: fijo a
   * la ventana se quedaría flotando lejos del botón que lo abrió.
   */
  let boton = $state<HTMLButtonElement | null>(null);
  let lista = $state<HTMLUListElement | null>(null);
  let lugar = $state("");

  /** Alto aproximado de cada opción y del marco, para saber si cabe abajo. */
  const ALTO_OPCION = 38;
  const MARGEN = 12;

  function alternar() {
    if (abierto) {
      abierto = false;
      return;
    }
    const r = boton?.getBoundingClientRect();
    if (r) {
      const alto = opciones.length * ALTO_OPCION + MARGEN;
      const derecha = Math.max(8, window.innerWidth - r.right);
      lugar =
        r.bottom + alto + 8 > window.innerHeight && r.top > alto
          ? `bottom: ${window.innerHeight - r.top + 5}px; right: ${derecha}px;`
          : `top: ${r.bottom + 5}px; right: ${derecha}px;`;
    }
    abierto = true;
  }

  $effect(() => {
    if (!abierto) return;
    const cerrar = (e: Event) => {
      // Desplazar la propia lista de opciones, si no cupo entera, no la cierra.
      if (e.target instanceof Node && lista?.contains(e.target)) return;
      abierto = false;
    };
    // En captura: el desplazamiento de la `.seccion` no burbujea hasta la ventana.
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  });

  function elegir(id: string) {
    valor = id;
    abierto = false;
    if (recordar) recordarOrden(recordar, id);
    onCambiar?.(id);
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key === "Escape") abierto = false;
  }
</script>

<svelte:window onkeydown={alTeclear} />

<div class="ordenar">
  <button
    class="disparador"
    aria-haspopup="listbox"
    aria-expanded={abierto}
    bind:this={boton}
    onclick={alternar}
  >
    <span class="icono" aria-hidden="true">⇅</span>
    {rotulo}: <b>{actual?.etiqueta ?? "—"}</b>
  </button>

  {#if abierto}
    <!-- Tocar fuera cierra: en una tableta no hay «Escape». -->
    <div class="velo" role="presentation" onclick={() => (abierto = false)}></div>
    <ul
      class="menu"
      role="listbox"
      aria-label="Cómo ordenar la lista"
      style={lugar}
      bind:this={lista}
    >
      {#each opciones as o (o.id)}
        <li>
          <button
            role="option"
            aria-selected={o.id === actual?.id}
            class:on={o.id === actual?.id}
            onclick={() => elegir(o.id)}
          >
            {o.etiqueta}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ordenar {
    position: relative;
    display: inline-block;
  }
  .disparador {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.35rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm, 8px);
    background: #fff;
    color: var(--gris);
    cursor: pointer;
  }
  .disparador b {
    color: var(--pizarra);
    font-weight: 600;
  }
  .icono {
    color: var(--acento-texto);
    font-size: 0.9rem;
  }
  .velo {
    position: fixed;
    inset: 0;
    z-index: 20;
  }
  /* Fija a la ventana: `top`/`bottom` y `right` los pone `alternar()` a partir
     de dónde está el botón. Ver el porqué arriba, en el guion. */
  .menu {
    position: fixed;
    z-index: 21;
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    min-width: 13rem;
    max-height: calc(100vh - 1rem);
    overflow-y: auto;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md, 10px);
    box-shadow: var(--sombra-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
  }
  .menu button {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.84rem;
    padding: 0.5rem 0.7rem;
    border: none;
    border-radius: var(--r-sm, 8px);
    background: none;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--claro);
  }
  .menu button.on {
    font-weight: 700;
    color: var(--acento-texto);
  }
</style>
