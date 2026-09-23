<script lang="ts">
  /**
   * El menú del restaurante: todo lo que el local sirve.
   *
   * Lo que se ve depende del perfil en sesión, y no por condicionales de
   * pantalla: la lista viene de `menu.porCategoria`, que el dominio construye ya
   * filtrada. Un mesero no recibe el campo de costo — no está en el objeto.
   */
  import { mxn, pct } from "../../formato";
  import { inventario } from "../../inventario.svelte";
  import Ordenar from "../../listas/Ordenar.svelte";
  import { menu } from "../../menu.svelte";
  import { rutas } from "../../nav/rutas.svelte";
  import { AYUDA_CARGA_RAPIDA, convertirEnReventa, insumoEspejoDe } from "../../reventa.svelte";
  import { revelar, subirAlPrincipio } from "../../subir";
  import EditorProducto from "./EditorProducto.svelte";
  import EditorPromociones from "./EditorPromociones.svelte";
  import EditorReceta from "./EditorReceta.svelte";
  import {
    ORDEN_DE_LA_CARTA,
    ordenesDeCategorias,
    ordenesDeProductos,
    propuesta,
  } from "./orden-de-la-carta";

  type Panel =
    | { modo: "ninguno" }
    | { modo: "producto"; id?: string }
    | { modo: "promociones" }
    | { modo: "receta"; id: string; nombre: string };

  let panel = $state<Panel>({ modo: "ninguno" });
  let filtro = $state("");
  let categoriaNueva = $state("");
  let aviso = $state("");

  /**
   * EL EDITOR ESTÁ ARRIBA; EL BOTÓN QUE LO ABRE, ABAJO.
   *
   * Pedido de Gonzalo. El formulario de alta y edición se dibuja justo debajo
   * del encabezado, pero «Editar» vive en la tarjeta del platillo, y en una
   * carta de verdad esa tarjeta está a dos o tres pantallas de scroll. Quien
   * pulsaba Editar no veía pasar nada: el formulario se abría fuera de cuadro y
   * la pantalla se quedaba donde estaba, así que parecía que el botón no
   * servía. Subir la vista es lo que convierte el clic en algo que ocurrió.
   *
   * La subida la hace `subirAlPrincipio` (ver `subir.ts`), la misma para toda
   * la aplicación: nació aquí y se sacó en cuanto hizo falta en otras pantallas.
   * La comparten TODOS los botones de la tarjeta de un platillo que abren algo
   * arriba —editar, receta, y «se vende tal cual»—: el recuadro de la
   * conversión no es un panel, pero se dibuja en el mismo sitio y quien lo pulsa
   * tiene el mismo problema.
   */
  let contenedor = $state<HTMLDivElement | null>(null);

  function abrir(destino: Panel) {
    panel = destino;
    if (destino.modo === "ninguno") return;
    subirAlPrincipio(contenedor);
  }

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

  /*
   * El aviso se escribe ENCIMA de la carta, pero los botones de una categoría
   * —Eliminar, y Guardar al renombrarla— pueden estar tres categorías más
   * abajo. Si algo falla hay que subir a decirlo: si no, el clic parece no
   * haber hecho nada y la categoría sigue ahí sin explicación.
   */
  function borrarCategoria(id: string, nombre: string) {
    const r = menu.borrarCategoria(id);
    aviso = r.ok ? "" : `${nombre}: ${r.problemas[0]?.mensaje ?? "no se pudo eliminar"}`;
    if (!r.ok) subirAlPrincipio(contenedor);
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
      subirAlPrincipio(contenedor);
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

  // --- Ordenar la carta (1.5.6) ------------------------------------------------------
  //
  // Pedido de Gonzalo: un botón de «Ordenar» en cada lista. En el resto de la
  // caja solo cambia la vista de quien mira; aquí, por decisión suya, cambia la
  // CARTA: el orden en que los meseros encuentran las categorías y los platillos
  // en la caja, en todas las terminales. Un cambio así no puede ocurrir por un
  // toque de más en un menú desplegable, así que:
  //
  //  - la opción de siempre es «Orden de la carta», la que ya está guardada;
  //  - elegir otra NO ordena nada todavía: abre una confirmación que dice en
  //    claro que cambia la carta de todo el restaurante, y cómo quedaría;
  //  - al confirmar, se reescribe el orden guardado por el mismo camino que las
  //    flechas (`menu.ordenarCategorias` / `menu.ordenarProductos`): sube la
  //    versión de la carta y viaja al Hub y a las demás terminales.
  //
  // Después de confirmar, el botón vuelve a decir «Orden de la carta», que es
  // la verdad: lo que se ve ES la carta, ya reordenada.

  const opcionesCats = ordenesDeCategorias();
  const opcionesProds = ordenesDeProductos();

  /** Un cambio de orden esperando el «Sí». */
  interface Reorden {
    /** null = las categorías; un id = los platillos de esa categoría. */
    categoriaId: string | null;
    nombreCategoria: string;
    opcionId: string;
    etiqueta: string;
    ids: string[];
    /** Cómo quedaría, para enseñarlo antes de confirmar. */
    nombres: string[];
    /** false = la carta ya está así: no hay nada que confirmar. */
    cambia: boolean;
  }

  let reorden = $state<Reorden | null>(null);

  /** Lo que dice el botón de las categorías: lo pendiente, o la carta. */
  const valorCats = $derived(
    reorden && reorden.categoriaId === null ? reorden.opcionId : ORDEN_DE_LA_CARTA,
  );

  function valorProds(categoriaId: string): string {
    return reorden && reorden.categoriaId === categoriaId ? reorden.opcionId : ORDEN_DE_LA_CARTA;
  }

  function pedirOrdenCategorias(id: string) {
    aviso = "";
    const opcion = opcionesCats.find((o) => o.id === id);
    if (!opcion || id === ORDEN_DE_LA_CARTA) {
      reorden = null;
      return;
    }
    const p = propuesta(menu.categorias, opcion);
    reorden = {
      categoriaId: null,
      nombreCategoria: "",
      opcionId: id,
      etiqueta: opcion.etiqueta,
      ids: p.ids,
      nombres: p.lista.map((c) => c.nombre),
      cambia: p.cambia,
    };
  }

  function pedirOrdenProductos(categoriaId: string, nombreCategoria: string, id: string) {
    aviso = "";
    const opcion = opcionesProds.find((o) => o.id === id);
    if (!opcion || id === ORDEN_DE_LA_CARTA) {
      reorden = null;
      return;
    }
    // La categoría COMPLETA, no la de `grupos`: con la búsqueda puesta, esa
    // trae solo los platillos que coinciden, y el resto se quedaría fuera.
    const productos = menu.porCategoria.find((g) => g.categoria.id === categoriaId)?.productos ?? [];
    const p = propuesta(productos, opcion);
    reorden = {
      categoriaId,
      nombreCategoria,
      opcionId: id,
      etiqueta: opcion.etiqueta,
      ids: p.ids,
      nombres: p.lista.map((x) => x.nombre),
      cambia: p.cambia,
    };
  }

  function confirmarReorden() {
    if (!reorden) return;
    const r =
      reorden.categoriaId === null
        ? menu.ordenarCategorias(reorden.ids)
        : menu.ordenarProductos(reorden.categoriaId, reorden.ids);
    reorden = null;
    if (!r.ok) {
      // El aviso se escribe arriba; la confirmación de una categoría puede
      // estar tres pantallas más abajo.
      aviso = r.problemas[0]?.mensaje ?? "No se pudo cambiar el orden de la carta";
      subirAlPrincipio(contenedor);
    }
  }

  /** Cuántos nombres se enseñan en «Quedará así»: los primeros bastan para reconocerlo. */
  const MUESTRA = 8;

  // --- Productos que son su propio insumo -------------------------------------------
  //
  // Las dos entradas que Gonzalo pidió para lo ya capturado. La casilla del alta
  // (`EditorProducto`) solo sirve de aquí en adelante: Rodizio tiene la carta
  // cargada desde hace meses, así que sin esto no le resuelve ni una bebida.
  // El porqué completo está en `reventa.svelte.ts`.

  /** El producto sobre el que se está preguntando «¿se vende tal cual?», o null. */
  let convirtiendo = $state<{ id: string; nombre: string } | null>(null);
  let existenciaAlConvertir = $state("");

  function confirmarConversion() {
    if (!convirtiendo) return;
    const r = convertirEnReventa(convirtiendo.id, {
      existencia: Number(existenciaAlConvertir) || 0,
    });
    if (!r.ok) {
      aviso = r.problemas[0]?.mensaje ?? "No se pudo enlazar con el almacén";
      return;
    }
    aviso = "";
    convirtiendo = null;
    existenciaAlConvertir = "";
  }

  /**
   * Marca la categoría entera como de reventa.
   *
   * No convierte lo que ya está dentro: lo que hace es que el SIGUIENTE producto
   * de esa categoría nazca ya vinculado a su propio insumo. Convertir treinta
   * platillos en silencio, creando treinta insumos que nadie pidió, sería la
   * clase de sorpresa que nadie quiere encontrarse en su almacén — para eso
   * está el botón de cada producto, que se pulsa uno por uno y avisa.
   */
  function alternarReventa(categoriaId: string, actual: boolean) {
    menu.marcarCategoriaDeReventa(categoriaId, !actual);
  }
</script>

<div class="seccion" bind:this={contenedor}>
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
        <!--
          El camino a la carga rápida de alimentos y bebidas. Vive en el
          catálogo, junto al importador de la carta, porque es la misma tarea
          —dar de alta en bloque—; pero quien va a cargar el refrigerador entra
          por el Menú, así que el camino se pone aquí en vez de esperar a que lo
          encuentre.
        -->
        <button
          class="secundario"
          title={AYUDA_CARGA_RAPIDA}
          onclick={() => rutas.ir("administracion", "catalogo", { ver: "reventa" })}
        >
          Carga rápida de alimentos y bebidas
        </button>
      {/if}
      <button class="secundario" onclick={() => abrir({ modo: "promociones" })}>
        Promociones{menu.promociones.length > 0 ? ` (${menu.promociones.length})` : ""}
      </button>
      {#if permisos.editarProductos}
        <button class="principal" onclick={() => abrir({ modo: "producto" })}>
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
      <!--
        Ordenar las CATEGORÍAS. Solo para quien puede mover las flechas: aquí
        ordenar reescribe la carta, no es una vista, y un botón que se ofrece
        y luego no puede hacer nada es peor que no tenerlo.
      -->
      {#if menu.categorias.length > 1}
        <Ordenar
          rotulo="Ordenar categorías"
          opciones={opcionesCats}
          bind:valor={() => valorCats, () => {}}
          onCambiar={pedirOrdenCategorias}
        />
      {/if}
    {/if}
  </div>

  {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}

  <!--
    LA CONFIRMACIÓN DE ORDENAR LA CARTA. Un bloque en la página y no una
    ventana: dice lo que va a pasar justo debajo de donde se pidió, y
    `use:revelar` la trae a la vista si se abre fuera de cuadro (regla de
    Gonzalo). La de las categorías va aquí; la de los platillos, bajo el
    título de su categoría.
  -->
  {#snippet confirmacion(r: Reorden)}
    <section class="reordenar" use:revelar aria-label="Confirmar el orden de la carta">
      {#if r.cambia}
        <div>
          <b>Esto cambia la carta de todo el restaurante</b>
          <p class="pista">
            {#if r.categoriaId === null}
              Las categorías quedarán en el orden <b>«{r.etiqueta}»</b>, y así las
              verán los meseros en la caja, en todas las terminales, en cuanto
              confirmes. No cambia solo esta pantalla.
            {:else}
              Los platillos de <b>{r.nombreCategoria}</b> quedarán en el orden
              <b>«{r.etiqueta}»</b>, y así los verán los meseros al abrir esa
              categoría en la caja, en todas las terminales, en cuanto confirmes.
              No cambia solo esta pantalla.
            {/if}
          </p>
          <p class="quedara">
            <span>Quedará así:</span>
            {r.nombres.slice(0, MUESTRA).join(" · ")}{#if r.nombres.length > MUESTRA}
              · y {r.nombres.length - MUESTRA} más{/if}
          </p>
          {#if r.categoriaId === null}
            <p class="pista">Para mover una sola después, siguen las flechas ↑ ↓.</p>
          {/if}
        </div>
        <div class="botones-convertir">
          <button class="cat-accion" onclick={() => (reorden = null)}>Cancelar</button>
          <button class="cat-accion principal-cat" onclick={confirmarReorden}>
            Sí, cambiar la carta
          </button>
        </div>
      {:else}
        <div>
          <b>La carta ya está en ese orden</b>
          <p class="pista">
            {r.categoriaId === null ? "Las categorías" : `Los platillos de ${r.nombreCategoria}`}
            ya van «{r.etiqueta}»: no hay nada que cambiar.
          </p>
        </div>
        <div class="botones-convertir">
          <button class="cat-accion" onclick={() => (reorden = null)}>Entendido</button>
        </div>
      {/if}
    </section>
  {/snippet}

  {#if reorden && reorden.categoriaId === null}
    {@render confirmacion(reorden)}
  {/if}

  <!--
    CONVERTIR UN PRODUCTO YA CAPTURADO en uno que se vende tal cual.

    Se pregunta antes de hacerlo, y se pregunta UNA cosa: cuántas hay. Crear el
    insumo sin más, en silencio, sería añadirle al almacén un renglón que nadie
    pidió y que arrancaría en cero — y un cero en el almacén se lee como «se
    acabó», no como «todavía no lo cuento».
  -->
  {#if convirtiendo}
    <section class="convertir">
      <div>
        <b>{convirtiendo.nombre} se vende tal como se compra</b>
        <p class="pista">
          Se le dará de alta su propio insumo, en piezas y con el costo que tiene
          capturado, y se descontará <b>1 pieza</b> del almacén cada vez que se
          venda. Si ya tenías ese insumo, se reutiliza.
        </p>
      </div>
      <label class="cuantas">
        <span>¿Cuántas tienes ahorita?</span>
        <input
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          bind:value={existenciaAlConvertir}
          placeholder="0"
          onkeydown={(e) => e.key === "Enter" && confirmarConversion()}
        />
      </label>
      <div class="botones-convertir">
        <button class="cat-accion" onclick={() => (convirtiendo = null)}>Cancelar</button>
        <button class="cat-accion principal-cat" onclick={confirmarConversion}>
          Enlazar con el almacén
        </button>
      </div>
    </section>
  {/if}

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
          {#if grupo.categoria.reventa}
            <span class="marca-reventa" title="Lo que se vende aquí se compra ya hecho">
              se vende tal cual
            </span>
          {/if}

          {#if permisos.editarProductos}
            {@const i = ordenCat.indexOf(grupo.categoria.id)}
            <div class="cat-acciones">
              <!--
                CATEGORÍA DE REVENTA: refrescos, cervezas, botellas. Se dice una
                vez aquí en vez de treinta veces en el formulario de alta. No
                toca lo que ya está dentro: cambia cómo NACE el siguiente.
              -->
              <button
                class="cat-accion"
                class:reventa-on={grupo.categoria.reventa}
                aria-pressed={grupo.categoria.reventa === true}
                title="Todo lo que se dé de alta aquí se enlaza solo con su propio insumo"
                onclick={() =>
                  alternarReventa(grupo.categoria.id, grupo.categoria.reventa === true)}
              >
                {grupo.categoria.reventa ? "Reventa ✓" : "Reventa"}
              </button>
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
              <!-- Ordenar los PLATILLOS de esta categoría: su orden en la pestaña de la caja. -->
              {#if menu.cuantosEnCategoria(grupo.categoria.id) > 1}
                <Ordenar
                  rotulo="Ordenar platillos"
                  opciones={opcionesProds}
                  bind:valor={() => valorProds(grupo.categoria.id), () => {}}
                  onCambiar={(id) =>
                    pedirOrdenProductos(grupo.categoria.id, grupo.categoria.nombre, id)}
                />
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      {#if reorden && reorden.categoriaId === grupo.categoria.id}
        {@render confirmacion(reorden)}
      {/if}

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

            {#if permisos.editarRecetas}
              {@const espejo = insumoEspejoDe(p.id)}
              {#if espejo}
                <p class="descuenta espejo">
                  Se vende tal cual · quedan
                  {inventario.cantidad(espejo.id)}
                  {espejo.unidad_base} en el almacén
                </p>
              {/if}
            {/if}

            <div class="acciones">
              {#if permisos.editarProductos}
                <button onclick={() => abrir({ modo: "producto", id: p.id })}>Editar</button>
                <button onclick={() => menu.alternarDisponibilidad(p.id)}>
                  {p.disponible ? "Agotar" : "Reactivar"}
                </button>
              {/if}
              {#if permisos.editarRecetas}
                <!--
                  «SE VENDE TAL CUAL» solo aparece en lo que todavía no tiene
                  receta: un platillo con ingredientes no es una bebida
                  embotellada, y ofrecerlo ahí invitaría a pulsar un botón que
                  solo puede fallar.
                -->
                {#if !p.tiene_receta}
                  <button
                    class="tal-cual"
                    title="Crea su propio insumo y descuenta 1 pieza por venta"
                    onclick={() => {
                      convirtiendo = { id: p.id, nombre: p.nombre };
                      existenciaAlConvertir = "";
                      aviso = "";
                      subirAlPrincipio(contenedor);
                    }}
                  >
                    Se vende tal cual
                  </button>
                {/if}
                <button onclick={() => abrir({ modo: "receta", id: p.id, nombre: p.nombre })}>
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
  /* Con «Ordenar platillos» la fila ya no cabe siempre junto al nombre de la
     categoría: que baje de renglón antes que desbordarse. */
  .cat-acciones {
    display: flex;
    flex-wrap: wrap;
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
  /* Encendido: la categoría ya está marcada de reventa. */
  .cat-accion.reventa-on {
    border-color: var(--acento);
    background: var(--claro);
    color: var(--acento-texto);
  }
  .marca-reventa {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--acento-texto);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.5rem;
  }
  /* El botón que enlaza un producto con su propio insumo: distinto de los demás. */
  .acciones .tal-cual {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .descuenta.espejo {
    color: var(--acento-texto);
  }
  .convertir {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.9rem 1rem;
    background: var(--blanco);
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-sm);
  }
  .convertir > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  .convertir b {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .cuantas {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .cuantas span {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .cuantas input {
    width: 9rem;
    padding: 0.45rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-family: var(--font-cuerpo);
    font-size: 0.86rem;
    text-align: right;
  }
  .cuantas input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .botones-convertir {
    display: flex;
    gap: 0.4rem;
  }
  /* La confirmación de ordenar la carta: misma familia que la de «se vende tal
     cual», porque es la misma clase de pregunta —un cambio que llega al almacén
     o a la caja— hecha en el mismo sitio. */
  .reordenar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.9rem 1rem;
    background: var(--blanco);
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-sm);
  }
  .reordenar > div:first-child {
    flex: 1;
    min-width: 16rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .reordenar > div:first-child > b {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .reordenar .pista {
    font-size: 0.84rem;
    line-height: 1.5;
    color: var(--gris);
  }
  .reordenar .pista b {
    color: var(--pizarra);
  }
  .quedara {
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--pizarra);
  }
  .quedara span {
    font-weight: 700;
    color: var(--acento-texto);
    margin-right: 0.25rem;
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
    align-items: center;
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
    flex-wrap: wrap;
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
