<script lang="ts">
  /**
   * Elegir un insumo del almacén, PRIMERO POR CATEGORÍA.
   *
   * Pedido de Gonzalo. Hasta ahora, cada vez que había que señalar un insumo
   * —al declarar lo que consume un platillo, al registrar una merma, al armar
   * una orden de compra— salía un `<select>` con la despensa entera en una sola
   * lista plana. Con doce insumos de demostración se ve bien; con los ciento y
   * pico de un restaurante que lleva un año operando, encontrar «Mozzarella» es
   * recorrer una persiana hasta la eme, y equivocarse de renglón ahí significa
   * descontar del insumo que no era.
   *
   * La despensa YA está ordenada por categorías —se administran en
   * Administración → Insumos y estaciones— así que el selector las usa: primero
   * la categoría, luego lo que hay dentro, con el camino de vuelta arriba del
   * todo. Es el mismo gesto que hace el mesero en la carta del POS.
   *
   * La búsqueda existe ADEMÁS de las categorías, no en vez de ellas: quien ya
   * sabe cómo se llama el insumo teclea tres letras y lo tiene, sin pasar por
   * ninguna lista. Ignora acentos a propósito: nadie captura «champiñón» con su
   * tilde cuando está buscando.
   */
  import { formatearCantidad } from "@motrest/dominio";
  import type { Insumo } from "@motrest/dominio";
  import { inventario } from "./inventario.svelte";
  import { menu } from "./menu.svelte";

  interface Props {
    /** Id del insumo elegido, o "" si todavía no hay ninguno. */
    valor: string;
    onElegir: (insumoId: string) => void;
    /** ¿Se puede dejar sin insumo? En una receta sí; en una merma no. */
    permitirVacio?: boolean;
    /** Qué se lee cuando no hay nada elegido. */
    marcador?: string;
    /** Cómo se llama la opción de dejarlo vacío. */
    etiquetaVacio?: string;
    deshabilitado?: boolean;
    /** Para lectores de pantalla, porque el botón enseña el valor y no el rótulo. */
    rotulo?: string;
  }

  let {
    valor,
    onElegir,
    permitirVacio = false,
    marcador = "Elige un insumo…",
    etiquetaVacio = "Sin vincular",
    deshabilitado = false,
    rotulo = "Insumo del almacén",
  }: Props = $props();

  /** «Sin categoría» NO es una categoría: es el cajón de lo que falta ordenar. */
  const SIN_CATEGORIA = "\u0000sin-categoria";

  let abierto = $state(false);
  let categoria = $state<string | null>(null);
  let busqueda = $state("");

  /**
   * El panel se posiciona en coordenadas de VENTANA, no del contenedor.
   *
   * Un `position: absolute` habría sido más simple, pero se recorta en cuanto
   * un ancestro tiene `overflow` distinto de `visible` — y este selector vive
   * dentro de la tabla con scroll horizontal de la receta, del panel de la
   * cuenta y de las tarjetas de inventario. Un desplegable cortado a la mitad
   * es peor que no tenerlo: se ve que hay más opciones y no hay forma de
   * llegar a ellas.
   */
  let sitio = $state({ izquierda: 0, arriba: 0, abajo: 0, ancho: 0, haciaArriba: false });

  let caja = $state<HTMLDivElement | null>(null);
  let gatillo = $state<HTMLButtonElement | null>(null);
  let campoBusqueda = $state<HTMLInputElement | null>(null);

  const elegido = $derived(valor ? inventario.insumo(valor) : undefined);
  const categorias = $derived(menu.categoriasInsumo);
  const sinCategoria = $derived(menu.insumosSinCategoria);

  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  /**
   * Con texto en la búsqueda el panel deja de ser de dos pasos y enseña
   * resultados de TODA la despensa. Buscar dentro de una sola categoría sería
   * peor que inútil: quien teclea es porque no sabe en cuál está.
   */
  const buscando = $derived(busqueda.trim().length > 0);

  const resultados = $derived.by<Insumo[]>(() => {
    if (!buscando) return [];
    const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
    return inventario.insumos.filter((i) => {
      const heno = `${normalizar(i.nombre)} ${normalizar(i.categoria ?? "")}`;
      return palabras.every((p) => heno.includes(p));
    });
  });

  const dentro = $derived.by<Insumo[]>(() => {
    if (categoria === null) return [];
    if (categoria === SIN_CATEGORIA) return sinCategoria;
    return menu.insumosDe(categoria);
  });

  function abrir() {
    if (deshabilitado) return;
    /*
     * Se abre EN LA CATEGORÍA DEL INSUMO QUE YA ESTÁ PUESTO. Corregir un
     * renglón es casi siempre cambiarlo por otro de su misma familia —un queso
     * por otro queso— y volver a empezar desde la lista de categorías obligaría
     * a rehacer el camino entero cada vez.
     */
    const suya = elegido?.categoria?.trim();
    categoria = elegido ? (suya ? suya : SIN_CATEGORIA) : null;
    busqueda = "";

    situar();
    abierto = true;
    requestAnimationFrame(() => campoBusqueda?.focus());
  }

  /** Alto que el panel puede llegar a pedir: la búsqueda más la lista completa. */
  const ALTO_PANEL = 320;

  function situar() {
    const r = gatillo?.getBoundingClientRect();
    if (!r) return;
    const cabeAbajo = r.bottom + ALTO_PANEL <= window.innerHeight;
    /*
     * Se pega a la izquierda del gatillo salvo que ahí se saliera de la
     * pantalla. En la última columna de la fila de insumos —la que queda al
     * borde derecho— sin este tope la mitad de la lista quedaba fuera.
     */
    const anchoProbable = Math.max(r.width, 352);
    const izquierda = Math.max(8, Math.min(r.left, window.innerWidth - anchoProbable - 8));
    sitio = {
      izquierda,
      arriba: r.bottom + 4,
      abajo: window.innerHeight - r.top + 4,
      ancho: r.width,
      haciaArriba: !cabeAbajo && r.top > ALTO_PANEL,
    };
  }

  /**
   * Al desplazar o redimensionar se cierra en vez de recalcular.
   *
   * Recalcular obligaría a seguir al gatillo en cada cuadro de scroll, y el
   * único momento en que alguien desplaza la pantalla con esto abierto es
   * cuando ya decidió que no era ahí: cerrarlo es lo que espera.
   */
  function alMoverLaPantalla() {
    if (abierto) cerrar();
  }

  function cerrar(devolverFoco = false) {
    abierto = false;
    busqueda = "";
    if (devolverFoco) gatillo?.focus();
  }

  function elegir(insumoId: string) {
    onElegir(insumoId);
    cerrar(true);
  }

  /** Clic fuera: se cierra. Un panel que se queda abierto tapa la fila de abajo. */
  function alPulsarFuera(ev: MouseEvent) {
    if (!abierto || !caja) return;
    if (!caja.contains(ev.target as Node)) cerrar();
  }

  function alTeclear(ev: KeyboardEvent) {
    if (!abierto) return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      cerrar(true);
    }
  }
</script>

<svelte:window
  onpointerdown={alPulsarFuera}
  onkeydown={alTeclear}
  onresize={alMoverLaPantalla}
  onscrollcapture={alMoverLaPantalla}
/>

<div class="selector" bind:this={caja}>
  <button
    type="button"
    class="gatillo"
    class:vacio={!elegido}
    class:abierto
    bind:this={gatillo}
    disabled={deshabilitado}
    aria-haspopup="dialog"
    aria-expanded={abierto}
    aria-label={rotulo}
    onclick={() => (abierto ? cerrar(true) : abrir())}
  >
    <span class="texto">
      {#if elegido}
        <b>{elegido.nombre}</b>
        <small>{elegido.categoria?.trim() || "sin categoría"}</small>
      {:else}
        {marcador}
      {/if}
    </span>
    <span class="flecha" aria-hidden="true">▾</span>
  </button>

  {#if abierto}
    <div
      class="panel"
      role="dialog"
      aria-label={rotulo}
      style:left="{sitio.izquierda}px"
      style:min-width="{sitio.ancho}px"
      style:top={sitio.haciaArriba ? "auto" : `${sitio.arriba}px`}
      style:bottom={sitio.haciaArriba ? `${sitio.abajo}px` : "auto"}
    >
      <input
        class="buscar"
        type="text"
        bind:this={campoBusqueda}
        bind:value={busqueda}
        placeholder="Buscar insumo…"
        aria-label="Buscar insumo"
      />

      {#if buscando}
        <div class="lista">
          {#each resultados as i (i.id)}
            <button
              type="button"
              class="opcion"
              class:puesta={i.id === valor}
              onclick={() => elegir(i.id)}
            >
              <span class="nombre">{i.nombre}</span>
              <span class="cola">
                <span class="cat-chica">{i.categoria?.trim() || "sin categoría"}</span>
                <span class="existencia">
                  {formatearCantidad(inventario.cantidad(i.id), i.unidad_base)}
                </span>
              </span>
            </button>
          {:else}
            <p class="vacio-lista">Ningún insumo coincide con «{busqueda}».</p>
          {/each}
        </div>
      {:else if categoria === null}
        <!-- PASO 1 · las categorías del restaurante. -->
        <div class="lista">
          {#if permitirVacio}
            <button
              type="button"
              class="opcion suelta"
              class:puesta={!valor}
              onclick={() => elegir("")}
            >
              <span class="nombre">{etiquetaVacio}</span>
            </button>
          {/if}
          {#each categorias as cat (cat)}
            {@const cuantos = menu.insumosDe(cat).length}
            <button type="button" class="opcion carpeta" onclick={() => (categoria = cat)}>
              <span class="nombre">{cat}</span>
              <span class="cola">
                <span class="cuantos">{cuantos}</span>
                <span class="flecha" aria-hidden="true">›</span>
              </span>
            </button>
          {/each}
          <!--
            Los que nadie categorizó se enseñan al final y con su propio nombre.
            Esconderlos dejaría insumos imposibles de elegir desde aquí, que es
            justo lo que hace que nadie termine de ordenar la despensa.
          -->
          {#if sinCategoria.length > 0}
            <button
              type="button"
              class="opcion carpeta"
              onclick={() => (categoria = SIN_CATEGORIA)}
            >
              <span class="nombre tenue">Sin categoría</span>
              <span class="cola">
                <span class="cuantos">{sinCategoria.length}</span>
                <span class="flecha" aria-hidden="true">›</span>
              </span>
            </button>
          {/if}
          {#if categorias.length === 0 && sinCategoria.length === 0}
            <p class="vacio-lista">
              Todavía no hay insumos dados de alta. Se capturan en
              <b>Administración → Insumos y estaciones</b>.
            </p>
          {/if}
        </div>
      {:else}
        <!-- PASO 2 · lo que hay dentro, con el camino de vuelta HASTA ARRIBA. -->
        <button type="button" class="regresar" onclick={() => (categoria = null)}>
          ‹ Regresar a las categorías
        </button>
        <p class="cabecera-cat">
          {categoria === SIN_CATEGORIA ? "Sin categoría" : categoria}
        </p>
        <div class="lista">
          {#each dentro as i (i.id)}
            <button
              type="button"
              class="opcion"
              class:puesta={i.id === valor}
              onclick={() => elegir(i.id)}
            >
              <span class="nombre">{i.nombre}</span>
              <span class="cola">
                <span class="existencia">
                  {formatearCantidad(inventario.cantidad(i.id), i.unidad_base)}
                </span>
              </span>
            </button>
          {:else}
            <p class="vacio-lista">Esta categoría no tiene insumos.</p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .selector {
    position: relative;
    width: 100%;
    min-width: 0;
  }

  /* El botón se lee como un campo, porque ocupa el sitio de uno. */
  .gatillo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    width: 100%;
    min-height: var(--toque);
    padding: 0.4rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    font-family: var(--font-cuerpo);
    font-size: var(--t-sm);
    text-align: left;
  }
  .gatillo:hover:not(:disabled),
  .gatillo.abierto {
    border-color: var(--acento);
  }
  .gatillo:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .gatillo.vacio .texto {
    color: var(--gris);
  }
  .texto {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }
  .texto b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .texto small {
    font-size: var(--t-xs);
    color: var(--gris);
  }
  .gatillo .flecha {
    color: var(--gris);
    flex: none;
  }

  .panel {
    /* Fijo, no absoluto: ver la nota del script sobre los ancestros con overflow. */
    position: fixed;
    z-index: var(--z-flotante);
    /*
     * El ancho mínimo lo pone el gatillo, pero puede crecer: en la fila de
     * insumos de un platillo el campo mide poco más de diez caracteres, y una
     * lista de ese ancho corta «Mozzarella fior di latte» justo donde se
     * distingue de la otra.
     */
    width: max-content;
    max-width: min(22rem, 90vw);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.45rem;
    background: var(--blanco);
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-lg);
  }

  .buscar {
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-family: var(--font-cuerpo);
    font-size: var(--t-sm);
  }
  .buscar:focus {
    border-color: var(--acento);
  }

  .regresar {
    /*
     * ARRIBA DEL TODO y no al pie, tal como se pidió: es a donde va la mano
     * cuando la categoría elegida no era la buena, y al pie de una lista de
     * treinta insumos habría que recorrerla entera para volver.
     */
    display: block;
    width: 100%;
    padding: 0.45rem 0.55rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    background: var(--claro);
    color: var(--acento-texto);
    font-size: var(--t-xs);
    font-weight: 700;
    text-align: left;
  }
  .regresar:hover {
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .cabecera-cat {
    padding: 0 0.3rem;
    font-size: var(--t-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }

  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 15rem;
    overflow-y: auto;
  }
  .opcion {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    width: 100%;
    min-height: 2.35rem;
    padding: 0.35rem 0.55rem;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    text-align: left;
  }
  .opcion:hover {
    background: var(--fondo);
  }
  .opcion.puesta {
    background: var(--claro);
    font-weight: 600;
  }
  .opcion .nombre {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opcion .nombre.tenue {
    color: var(--gris);
    font-style: italic;
  }
  .cola {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex: none;
  }
  .cat-chica {
    font-size: var(--t-xs);
    color: var(--gris);
  }
  .existencia {
    font-size: var(--t-xs);
    color: var(--gris);
    font-variant-numeric: tabular-nums;
  }
  .cuantos {
    min-width: 1.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: var(--r-pill);
    background: var(--fondo);
    font-size: var(--t-xs);
    font-weight: 700;
    color: var(--gris);
    text-align: center;
  }
  .opcion.carpeta .flecha {
    color: var(--gris);
  }
  .opcion.suelta {
    color: var(--gris);
    font-style: italic;
  }
  .vacio-lista {
    padding: 0.6rem 0.55rem;
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.5;
  }
</style>
