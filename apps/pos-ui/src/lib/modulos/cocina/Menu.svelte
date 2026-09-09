<script lang="ts">
  /**
   * El menú del restaurante: todo lo que el local sirve.
   *
   * Lo que se ve depende del perfil en sesión, y no por condicionales de
   * pantalla: la lista viene de `menu.porCategoria`, que el dominio construye ya
   * filtrada. Un mesero no recibe el campo de costo — no está en el objeto.
   */
  import { mxn, pct } from "../../formato";
  import { menu } from "../../menu.svelte";
  import { rutas } from "../../nav/rutas.svelte";
  import EditorProducto from "./EditorProducto.svelte";
  import EditorPromociones from "./EditorPromociones.svelte";
  import EditorReceta from "./EditorReceta.svelte";

  type Panel =
    | { modo: "ninguno" }
    | { modo: "producto"; id?: string }
    | { modo: "promociones" }
    | { modo: "receta"; id: string; nombre: string };

  let panel = $state<Panel>({ modo: "ninguno" });
  let filtro = $state("");
  let categoriaNueva = $state("");
  let aviso = $state("");

  const permisos = $derived(menu.permisos);
  const resumen = $derived(menu.resumen);

  /**
   * Buscar «champinon» tiene que encontrar «Champiñón».
   *
   * Quien captura la carta no teclea los acentos, y un `includes` a secas dejaba
   * el platillo fuera de los resultados aunque estuviera en el menú.
   */
  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  const grupos = $derived.by(() => {
    // Cada palabra por separado y en cualquier orden: «hawaiana pizza» encuentra
    // «Pizza Hawaiana», y de paso los espacios de más dejan de estorbar.
    const palabras = normalizar(filtro).split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return menu.porCategoria;

    return menu.porCategoria
      .map((g) => {
        const categoria = normalizar(g.categoria.nombre);
        return {
          ...g,
          productos: g.productos.filter((p) => {
            // La categoría cuenta como parte del texto buscable: escribir
            // «bebida» tiene que traer la sección completa.
            const heno = `${normalizar(p.nombre)} ${categoria}`;
            return palabras.every((palabra) => heno.includes(palabra));
          }),
        };
      })
      .filter((g) => g.productos.length > 0);
  });

  function crearCategoria() {
    const r = menu.crearCategoria(categoriaNueva);
    aviso = r.ok ? "" : (r.problemas[0]?.mensaje ?? "No se pudo crear");
    if (r.ok) categoriaNueva = "";
  }

  function borrarCategoria(id: string, nombre: string) {
    const r = menu.borrarCategoria(id);
    aviso = r.ok ? "" : `${nombre}: ${r.problemas[0]?.mensaje ?? "no se pudo eliminar"}`;
  }

  // --- Editar una categoría ------------------------------------------------------
  //
  // Pedido de Gonzalo. Hasta ahora una categoría se podía crear y borrar, pero
  // no corregir: para arreglarle una falta de ortografía había que crear otra,
  // mover los platillos uno por uno y borrar la vieja. Y el ORDEN —el de las
  // pestañas del POS— quedaba fijado por el orden en que se crearon, para
  // siempre.

  /** La categoría que se está renombrando, o null. */
  let editandoCat = $state<string | null>(null);
  let nombreCat = $state("");

  function abrirEdicionCat(id: string, nombre: string) {
    editandoCat = id;
    nombreCat = nombre;
    aviso = "";
  }

  function guardarCat() {
    if (!editandoCat) return;
    const r = menu.renombrarCategoria(editandoCat, nombreCat);
    if (r.ok) {
      editandoCat = null;
      aviso = "";
    } else {
      aviso = r.problemas[0]?.mensaje ?? "No se pudo renombrar";
    }
  }

  function moverCat(id: string, direccion: "sube" | "baja") {
    menu.moverCategoria(id, direccion);
  }

  /**
   * ¿Es la primera o la última? Decide qué flecha se apaga.
   *
   * Se mira contra `menu.categorias` —la carta completa— y NO contra `grupos`,
   * que puede venir filtrado por la búsqueda. Con un filtro puesto, la primera
   * categoría visible casi nunca es la primera de la carta, y apagarle la
   * flecha de subir sería mentir.
   */
  const ordenCat = $derived(menu.categorias.map((c) => c.id));
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Menú</h1>
      <p class="sub">
        Todo lo que sirve el restaurante. {resumen.productos} productos ·
        {resumen.disponibles} disponibles · {resumen.conReceta} con receta
        {#if resumen.foodCostPromedio !== undefined}
          · food cost promedio <b>{pct(resumen.foodCostPromedio)}</b>
        {/if}
      </p>
    </div>
    <div class="botones">
      <!--
        Las estaciones no están fijas: se dan de alta, se renombran y se borran.
        El editor vive en Administración → Catálogo porque ahí están también los
        insumos, pero quien las busca las busca desde aquí — así que aquí va el
        camino, en vez de dejar que parezca que Horno y Pastas vienen de fábrica.
      -->
      {#if permisos.editarProductos}
        <button
          class="secundario"
          onclick={() => rutas.ir("administracion", "catalogo", { ver: "estaciones" })}
        >
          Estaciones ({menu.estaciones.length})
        </button>
      {/if}
      <button class="secundario" onclick={() => (panel = { modo: "promociones" })}>
        Promociones{menu.promociones.length > 0 ? ` (${menu.promociones.length})` : ""}
      </button>
      {#if permisos.editarProductos}
        <button class="principal" onclick={() => (panel = { modo: "producto" })}>
          + Nuevo producto
        </button>
      {/if}
    </div>
  </div>

  {#if !permisos.verCostos}
    <p class="nota">
      Tu perfil ve la carta y las recetas, pero no los costos ni los márgenes.
    </p>
  {/if}

  <!--
    La clave fuerza a rehacer el editor al cambiar de producto. Sin ella, saltar
    de la receta de un platillo a la de otro reutilizaría el componente y dejaría
    en pantalla los datos del anterior.
  -->
  {#key panel.modo === "producto" || panel.modo === "receta"
    ? `${panel.modo}:${panel.id ?? "nuevo"}`
    : panel.modo}
    {#if panel.modo === "producto"}
      <EditorProducto productoId={panel.id} onCerrar={() => (panel = { modo: "ninguno" })} />
    {:else if panel.modo === "promociones"}
      <EditorPromociones onCerrar={() => (panel = { modo: "ninguno" })} />
    {:else if panel.modo === "receta"}
      <EditorReceta
        productoId={panel.id}
        nombreProducto={panel.nombre}
        onCerrar={() => (panel = { modo: "ninguno" })}
      />
    {/if}
  {/key}

  <div class="barra">
    <input class="buscar" bind:value={filtro} placeholder="Buscar en el menú…" />
    {#if permisos.editarProductos}
      <div class="cat-nueva">
        <input bind:value={categoriaNueva} placeholder="Nueva categoría" />
        <button onclick={crearCategoria} disabled={categoriaNueva.trim().length < 2}>
          Agregar
        </button>
      </div>
    {/if}
  </div>

  {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}

  {#each grupos as grupo (grupo.categoria.id)}
    <section class="grupo">
      <div class="titulo-grupo">
        {#if editandoCat === grupo.categoria.id}
          <!--
            Se edita EN SITIO y no en un diálogo: renombrar una categoría es
            cambiar una palabra, y sacar una ventana modal para eso hace que
            corregir tres categorías seguidas sea un viaje de nueve clics.
          -->
          <input
            class="editar-cat"
            bind:value={nombreCat}
            onkeydown={(e) => {
              if (e.key === "Enter") guardarCat();
              if (e.key === "Escape") editandoCat = null;
            }}
          />
          <button class="cat-accion principal-cat" onclick={guardarCat}>Guardar</button>
          <button class="cat-accion" onclick={() => (editandoCat = null)}>Cancelar</button>
        {:else}
          <h2>{grupo.categoria.nombre}</h2>
          <span class="cuantos">{grupo.productos.length}</span>

          {#if permisos.editarProductos}
            {@const i = ordenCat.indexOf(grupo.categoria.id)}
            <div class="cat-acciones">
              <button
                class="cat-accion"
                onclick={() => abrirEdicionCat(grupo.categoria.id, grupo.categoria.nombre)}
              >
                Renombrar
              </button>
              <button
                class="cat-accion flecha"
                disabled={i <= 0}
                onclick={() => moverCat(grupo.categoria.id, "sube")}
                aria-label="Subir {grupo.categoria.nombre}"
                title="Subir en la carta"
              >↑</button>
              <button
                class="cat-accion flecha"
                disabled={i < 0 || i >= ordenCat.length - 1}
                onclick={() => moverCat(grupo.categoria.id, "baja")}
                aria-label="Bajar {grupo.categoria.nombre}"
                title="Bajar en la carta"
              >↓</button>
              <!--
                Eliminar solo aparece cuando la categoría está VACÍA. Un botón
                que se ve y siempre falla es peor que uno que no está: invita a
                pulsarlo y luego explica por qué no.
              -->
              {#if menu.cuantosEnCategoria(grupo.categoria.id) === 0}
                <button
                  class="cat-accion borrar-cat"
                  onclick={() => borrarCategoria(grupo.categoria.id, grupo.categoria.nombre)}
                >
                  Eliminar
                </button>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <div class="productos">
        {#each grupo.productos as p (p.id)}
          <article class="producto" class:agotado={!p.disponible}>
            <!--
              El precio grande es EL DE LA CARTA: lo que paga el comensal, con
              impuesto dentro. Antes salía la base gravable, así que la pantalla
              y el menú de la pared decían cifras distintas para el mismo
              platillo. El desglose se conserva debajo, en pequeño, porque es lo
              que hace falta para revisar el margen.
            -->
            <div class="linea">
              <b class="nombre">{p.nombre}</b>
              <span class="precio">{mxn(p.impuesto.total)}</span>
            </div>

            <div class="etiquetas">
              <span class="iva">{mxn(p.impuesto.base)} + IVA {mxn(p.impuesto.iva)}</span>
              {#if p.costo !== undefined && p.food_cost !== undefined}
                <span class="costo">costo {mxn(p.costo)}</span>
                <span class="fc" class:alto={p.food_cost > 0.45}>fc {pct(p.food_cost)}</span>
              {/if}
              {#if p.configurable}<span class="marca">configurable</span>{/if}
              {#if !p.disponible}<span class="marca agotado-marca">agotado</span>{/if}
            </div>

            {#if p.receta}
              <p class="receta">
                <b>Lleva:</b>
                {p.receta.ingredientes
                  .map((i) => (i.cantidad && i.unidad ? `${i.nombre} (${i.cantidad} ${i.unidad})` : i.nombre))
                  .join(" · ")}
              </p>
              {#if p.receta.vinculados > 0}
                <p class="descuenta">
                  {p.receta.vinculados} ingrediente{p.receta.vinculados === 1 ? "" : "s"}
                  descuenta{p.receta.vinculados === 1 ? "" : "n"} del almacén
                </p>
              {/if}
            {:else if p.tiene_receta}
              <p class="receta tenue">Tiene receta; tu perfil no puede consultarla.</p>
            {/if}

            <div class="acciones">
              {#if permisos.editarProductos}
                <button onclick={() => (panel = { modo: "producto", id: p.id })}>Editar</button>
                <button onclick={() => menu.alternarDisponibilidad(p.id)}>
                  {p.disponible ? "Agotar" : "Reactivar"}
                </button>
              {/if}
              {#if permisos.editarRecetas}
                <button onclick={() => (panel = { modo: "receta", id: p.id, nombre: p.nombre })}>
                  {p.tiene_receta ? "Editar receta" : "+ Receta"}
                </button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </section>
  {:else}
    <p class="vacio">
      {filtro.trim() ? `Nada coincide con "${filtro}".` : "El menú está vacío."}
    </p>
  {/each}
</div>

<style>
  .cat-acciones {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .cat-accion {
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .cat-accion:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .cat-accion:disabled {
    opacity: 0.35;
  }
  .cat-accion.flecha {
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
    line-height: 1;
  }
  .cat-accion.principal-cat {
    border-color: var(--acento);
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .editar-cat {
    flex: 1;
    max-width: 18rem;
    padding: 0.35rem 0.6rem;
    border: 1.5px solid var(--acento);
    border-radius: 8px;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
  }
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 72rem;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.85rem;
    color: var(--gris);
  }
  .barra {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .buscar {
    flex: 1;
    min-width: 14rem;
  }
  .cat-nueva {
    display: flex;
    gap: 0.4rem;
  }
  .cat-nueva button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    white-space: nowrap;
  }
  .cat-nueva button:disabled {
    opacity: 0.4;
  }
  input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .grupo {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .titulo-grupo {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
  }
  .cuantos {
    background: var(--fondo);
    border-radius: var(--r-pill);
    padding: 0.05rem 0.55rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .borrar-cat {
    font-size: 0.76rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .borrar-cat:hover {
    color: var(--peligro);
  }
  .productos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: 0.75rem;
  }
  .producto {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .producto.agotado {
    opacity: 0.6;
  }
  .linea {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }
  .nombre {
    flex: 1;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.25;
  }
  .precio {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .etiquetas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .etiquetas span {
    font-size: 0.72rem;
    font-weight: 600;
    border-radius: var(--r-pill);
    padding: 0.1rem 0.55rem;
    background: var(--fondo);
    color: var(--gris);
  }
  .etiquetas .iva {
    color: var(--acento-texto);
  }
  .etiquetas .fc.alto {
    background: #fdeae8;
    color: var(--peligro);
  }
  .etiquetas .marca {
    border: 1px solid var(--borde);
    background: transparent;
  }
  .etiquetas .agotado-marca {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .receta {
    font-size: 0.82rem;
    color: var(--pizarra);
    line-height: 1.45;
  }
  .receta.tenue {
    color: var(--gris);
    font-style: italic;
  }
  .descuenta {
    font-size: 0.76rem;
    color: var(--acento-texto);
    font-weight: 600;
  }
  .acciones {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }
  .acciones button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .acciones button:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .vacio {
    font-size: 0.9rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .botones {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .secundario {
    background: #fff;
    border: 1.5px solid var(--borde);
    color: var(--pizarra);
    border-radius: var(--r-md);
    padding: 0.65rem 1.1rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    cursor: pointer;
  }
  .secundario:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
</style>
