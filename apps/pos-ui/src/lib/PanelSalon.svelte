<script lang="ts">
  /**
   * Salón del POS: dibuja el plano real del local sobre su retícula, de modo que
   * la disposición en pantalla corresponda a la del piso.
   *
   * EL PLANO ES LA VISTA, NO UNA DE VARIAS. Se probó ofrecer también una lista
   * de tarjetas y se descartó: el mesero no busca «la mesa 12» en una lista,
   * busca la mesa del ventanal. El plano es lo único que responde a eso, y
   * partirlo en dos vistas obligaba a elegir antes de mirar.
   *
   * Lo que sí hacía falta cuando el salón es grande son tres cosas, y esas se
   * quedan: buscar una mesa por número, filtrar por estado y poder ampliar el
   * plano cuando la columna del POS se queda chica.
   */
  import { capacidadDe } from "@motrest/dominio";
  import { rutas } from "./nav/rutas.svelte";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  const puedeEditarPlano = $derived(sesion.puedeOperar("cat.area.editar"));

  let busqueda = $state("");
  let filtro = $state<"todas" | "libre" | "ocupada" | "cuenta">("todas");
  let ampliado = $state(false);
  /** Escala del plano ampliado. La columna del POS se dibuja siempre a 1. */
  let zoom = $state(1);

  const ZOOM_MIN = 0.6;
  const ZOOM_MAX = 2.4;

  function ajustarZoom(delta: number) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + delta) * 100) / 100));
  }

  function normalizar(texto: string): string {
    return texto.trim().toLowerCase().replace(/\s+/g, " ");
  }

  /**
   * ¿Esta mesa responde a lo que se escribió?
   *
   * Se acepta el nombre tal cual («Barra 3», «M1»), un trozo de él, y la forma
   * en que la gente dicta una mesa en voz alta: «mesa 7», «m 7», «#7». La
   * comparación con el nombre completo va PRIMERO y por eso una mesa llamada
   * «M1» se encuentra escribiendo «M1» — antes se le quitaba la «m» de prefijo
   * y se buscaba una mesa «1» que no existía.
   *
   * Escribir «1» trae también la 10 y la 12, a propósito: es un buscador, y el
   * contador de al lado dice cuántas quedaron. Filtrar a una sola obligaría a
   * teclear el número completo para ver algo.
   */
  function coincideMesa(nombre: string, consulta: string): boolean {
    const q = normalizar(consulta);
    if (q === "") return true;

    const n = normalizar(nombre);
    if (n === q || n.includes(q)) return true;

    const sinPrefijo = q.replace(/^(mesas?|m|#)\s*/, "").trim();
    return sinPrefijo !== "" && sinPrefijo !== q && n.includes(sinPrefijo);
  }

  const buscando = $derived(busqueda.trim() !== "");

  const conteo = $derived.by(() => {
    let libre = 0;
    let ocupada = 0;
    let cuenta = 0;
    for (const mesa of plano.mesas) {
      const estado = pos.estadoMesa(mesa.id);
      if (estado === "libre") libre++;
      else if (estado === "ocupada") ocupada++;
      else cuenta++;
    }
    return { libre, ocupada, cuenta, total: plano.mesas.length };
  });

  /**
   * Las mesas no se quitan del plano al filtrar: se apagan.
   *
   * Un plano al que le faltan mesas deja de ser un plano —los huecos son parte
   * de cómo se reconoce el espacio—, así que lo que no coincide se atenúa y lo
   * que sí, se resalta.
   */
  function atenuada(nombre: string, estado: string): boolean {
    if (filtro !== "todas" && estado !== filtro) return true;
    return buscando && !coincideMesa(nombre, busqueda);
  }

  const visibles = $derived(
    plano.mesas.filter((m) => !atenuada(m.nombre, pos.estadoMesa(m.id))).length,
  );

  function tocar(mesaId: string) {
    pos.seleccionarMesa(mesaId);
    ampliado = false;
  }

  function teclas(evento: KeyboardEvent) {
    if (evento.key === "Escape" && ampliado) ampliado = false;
  }
</script>

<svelte:window onkeydown={teclas} />

<section class="salon">
  <div class="cabecera">
    <h2>Salón</h2>
    <span class="total">{conteo.total} mesas</span>
    {#if plano.area}
      <button class="chico" title="Ver el plano en grande" onclick={() => (ampliado = true)}>
        Ampliar
      </button>
    {/if}
    {#if puedeEditarPlano}
      <button
        class="chico"
        title="Editar salones y acomodo de mesas"
        onclick={() => rutas.ir("administracion", "salones")}
      >
        Editar plano
      </button>
    {/if}
  </div>

  {#if plano.areas.length > 1}
    <div class="areas">
      {#each plano.areas as area (area.id)}
        <button
          class="area"
          class:on={area.id === plano.areaActiva}
          onclick={() => (plano.areaActiva = area.id)}
        >
          {area.nombre}
        </button>
      {/each}
    </div>
  {/if}

  {#if plano.area}
    <div class="herramientas">
      <div class="buscador" class:activo={buscando}>
        <input
          type="search"
          bind:value={busqueda}
          placeholder="Buscar mesa: 7, barra…"
          aria-label="Buscar una mesa por nombre o número"
        />
        {#if buscando}
          <span class="hallazgos">{visibles}</span>
          <button class="limpiar" onclick={() => (busqueda = "")} aria-label="Borrar la búsqueda">
            ✕
          </button>
        {/if}
      </div>

      <div class="filtros">
        <button class:on={filtro === "todas"} onclick={() => (filtro = "todas")}>
          Todas <b>{conteo.total}</b>
        </button>
        <button class="libre" class:on={filtro === "libre"} onclick={() => (filtro = "libre")}>
          Libres <b>{conteo.libre}</b>
        </button>
        <button
          class="ocupada"
          class:on={filtro === "ocupada"}
          onclick={() => (filtro = "ocupada")}
        >
          En servicio <b>{conteo.ocupada}</b>
        </button>
        <button class="cuenta" class:on={filtro === "cuenta"} onclick={() => (filtro = "cuenta")}>
          En cocina <b>{conteo.cuenta}</b>
        </button>
      </div>
    </div>
  {/if}

  {#if plano.area}
    {@const area = plano.area}
    <div
      class="lienzo"
      style="--columnas: {area.columnas}; --filas: {area.filas}"
      role="group"
      aria-label="Plano de {area.nombre}"
    >
      {#each plano.mesas as mesa (mesa.id)}
        {@const estado = pos.estadoMesa(mesa.id)}
        {@const apagada = atenuada(mesa.nombre, estado)}
        {@const unida = pos.estaUnida(mesa.id)}
        <button
          class="mesa {estado} {mesa.forma}"
          class:sel={mesa.id === pos.mesaActiva}
          class:apagada
          class:hallada={buscando && !apagada}
          class:unida
          style="grid-column: {mesa.columna + 1} / span {mesa.ancho};
                 grid-row: {mesa.fila + 1} / span {mesa.alto}"
          onclick={() => tocar(mesa.id)}
          title="Mesa {mesa.nombre} · {capacidadDe(mesa)} comensales{unida
            ? ` · unida a la cuenta de la ${plano.nombreMesa(pos.mesaPrincipalDe(mesa.id))}`
            : ''}"
        >
          <span class="nombre">{mesa.nombre}</span>
          <small>
            {#if unida}unida
            {:else if estado === "libre"}{capacidadDe(mesa)} pers.
            {:else if estado === "cuenta"}en cocina
            {:else}en servicio{/if}
          </small>
        </button>
      {/each}
    </div>

    {#if visibles === 0}
      <p class="vacio">Ninguna mesa coincide con lo que buscas.</p>
    {/if}
  {:else}
    <!--
      SIN ÁREAS NO SE DIBUJA NADA, y hay que decirlo. Un local recién instalado
      llega aquí con el plano vacío: dejar la columna en blanco lo hacía parecer
      una pantalla rota en lugar de una tarea pendiente.
    -->
    <p class="vacio">Este local todavía no tiene áreas configuradas.</p>
    {#if puedeEditarPlano}
      <button class="chico" onclick={() => rutas.ir("administracion", "salones")}>
        Configurar el plano
      </button>
    {/if}
  {/if}

  <div class="leyenda">
    <span><i style="background: var(--peligro)"></i>Ocupada · en servicio</span>
    <span><i style="background: var(--acento)"></i>Enviada a cocina</span>
    <span><i style="background: #dde3da"></i>Libre</span>
  </div>
</section>

<!--
  EL PLANO EN GRANDE. La columna del salón mide lo que mide, y un local de
  cuarenta mesas ahí dentro sale ilegible. Ampliado ocupa la pantalla, con zoom
  para recorrerlo. Tocar una mesa lo cierra: se vino a elegir mesa, no a mirar.
-->
{#if ampliado && plano.area}
  {@const area = plano.area}
  <div class="velo" role="presentation" onclick={() => (ampliado = false)}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Plano de {area.nombre}">
    <div class="modal-cabecera">
      <h2>{area.nombre}</h2>
      <span class="total">{area.columnas}×{area.filas} · {conteo.total} mesas</span>

      {#if plano.areas.length > 1}
        <div class="areas">
          {#each plano.areas as otra (otra.id)}
            <button
              class="area"
              class:on={otra.id === plano.areaActiva}
              onclick={() => (plano.areaActiva = otra.id)}
            >
              {otra.nombre}
            </button>
          {/each}
        </div>
      {/if}

      <div class="zoom">
        <button onclick={() => ajustarZoom(-0.2)} aria-label="Alejar">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onclick={() => ajustarZoom(0.2)} aria-label="Acercar">+</button>
      </div>

      <button class="cerrar" onclick={() => (ampliado = false)}>Cerrar</button>
    </div>

    <div class="modal-cuerpo">
      <div
        class="lienzo grande"
        style="--columnas: {area.columnas}; --filas: {area.filas}; --zoom: {zoom}"
        role="group"
        aria-label="Plano ampliado de {area.nombre}"
      >
        {#each plano.mesas as mesa (mesa.id)}
          {@const estado = pos.estadoMesa(mesa.id)}
          {@const apagada = atenuada(mesa.nombre, estado)}
          {@const unida = pos.estaUnida(mesa.id)}
          <button
            class="mesa {estado} {mesa.forma}"
            class:sel={mesa.id === pos.mesaActiva}
            class:apagada
            class:hallada={buscando && !apagada}
            class:unida
            style="grid-column: {mesa.columna + 1} / span {mesa.ancho};
                   grid-row: {mesa.fila + 1} / span {mesa.alto}"
            onclick={() => tocar(mesa.id)}
          >
            <span class="nombre">{mesa.nombre}</span>
            <small>
              {#if unida}unida a la {plano.nombreMesa(pos.mesaPrincipalDe(mesa.id))}
              {:else if estado === "libre"}{capacidadDe(mesa)} comensales
              {:else if estado === "cuenta"}en cocina
              {:else}en servicio{/if}
            </small>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .salon {
    background: #fff;
    border-right: 1px solid var(--borde);
    padding: 1.25rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .cabecera {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .cabecera h2 {
    flex: 1;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .total {
    border-radius: var(--r-pill);
    background: var(--claro);
    padding: 0.1rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--acento);
    white-space: nowrap;
  }
  .chico {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.28rem 0.6rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
    white-space: nowrap;
    cursor: pointer;
  }
  .chico:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .areas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.85rem 0 0;
  }
  .area {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.28rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
    cursor: pointer;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }

  /* --- Buscar y filtrar ------------------------------------------------- */

  .herramientas {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .buscador {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.1rem 0.4rem;
    background: var(--fondo);
  }
  .buscador.activo {
    border-color: var(--acento);
    background: #fff;
  }
  .buscador input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 0.35rem 0.15rem;
    font-family: var(--font-cuerpo);
    font-size: 0.82rem;
    color: var(--pizarra);
  }
  .buscador input:focus {
    outline: none;
  }
  .hallazgos {
    border-radius: var(--r-pill);
    background: var(--acento);
    padding: 0.05rem 0.45rem;
    font-size: 0.7rem;
    font-weight: 700;
    color: #fff;
  }
  .limpiar {
    border: none;
    background: transparent;
    color: var(--gris);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .filtros {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .filtros button {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
    cursor: pointer;
  }
  .filtros button b {
    font-variant-numeric: tabular-nums;
  }
  .filtros button.on {
    border-color: var(--pizarra);
    color: var(--pizarra);
  }
  .filtros button.libre.on {
    border-color: var(--exito);
    color: var(--exito);
  }
  .filtros button.ocupada.on {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .filtros button.cuenta.on {
    border-color: var(--acento);
    color: var(--acento);
  }

  /* --- El plano ---------------------------------------------------------- */

  .lienzo {
    display: grid;
    grid-template-columns: repeat(var(--columnas), 1fr);
    grid-template-rows: repeat(var(--filas), minmax(1.6rem, auto));
    gap: 0.25rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--r-md);
    /* Retícula de fondo: ancla visual para reconocer el espacio real. */
    background-image:
      linear-gradient(to right, var(--borde) 1px, transparent 1px),
      linear-gradient(to bottom, var(--borde) 1px, transparent 1px);
    background-size: calc(100% / var(--columnas)) calc(100% / var(--filas));
    background-color: var(--fondo);
  }
  .lienzo.grande {
    grid-template-columns: repeat(var(--columnas), minmax(calc(2.6rem * var(--zoom)), 1fr));
    grid-template-rows: repeat(var(--filas), minmax(calc(2.6rem * var(--zoom)), auto));
    gap: 0.4rem;
    margin: 0 auto;
    min-width: min-content;
  }
  .mesa {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    border: 2px solid var(--borde);
    background: #fff;
    color: var(--gris);
    min-height: 2.6rem;
    padding: 0.2rem;
    cursor: pointer;
    transition:
      transform 0.08s ease,
      box-shadow 0.12s ease,
      opacity 0.12s ease;
  }
  .mesa.cuadrada {
    border-radius: var(--r-sm);
  }
  .mesa.rectangular {
    border-radius: var(--r-md);
  }
  .mesa.redonda {
    border-radius: 50%;
  }
  .mesa:hover {
    transform: translateY(-1px);
    box-shadow: var(--sombra-sm);
  }
  .mesa .nombre {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1;
  }
  .mesa small {
    font-size: 0.6rem;
    font-weight: 500;
    line-height: 1;
    text-align: center;
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
  /* Una mesa juntada se ve atada a otra cuenta: borde punteado, no llena. */
  .mesa.unida {
    border-style: dashed;
  }
  .mesa.sel {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
    box-shadow: var(--sombra-md);
  }
  .mesa.apagada {
    opacity: 0.28;
  }
  .mesa.hallada {
    box-shadow: 0 0 0 3px rgba(242, 133, 58, 0.45);
  }
  .vacio {
    margin-top: 1rem;
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .leyenda {
    margin-top: 1.25rem;
    font-size: 0.82rem;
    color: var(--gris);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .leyenda span {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .leyenda i {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 4px;
  }

  /* --- El plano ampliado -------------------------------------------------- */

  .velo {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(20, 24, 26, 0.6);
  }
  .modal {
    position: fixed;
    z-index: 61;
    inset: 3vh 3vw;
    display: flex;
    flex-direction: column;
    border-radius: var(--r-lg);
    background: #fff;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  .modal-cabecera {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--borde);
  }
  .modal-cabecera h2 {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .modal-cabecera .areas {
    margin: 0;
    flex: 1;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    font-variant-numeric: tabular-nums;
  }
  .zoom button {
    width: 1.6rem;
    height: 1.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: #fff;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--pizarra);
    cursor: pointer;
  }
  .zoom button:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .cerrar {
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    background: var(--acento);
    padding: 0.35rem 0.85rem;
    font-family: var(--font-titulo);
    font-size: 0.82rem;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
  }
  .modal-cuerpo {
    flex: 1;
    overflow: auto;
    padding: 1rem;
    background: var(--fondo);
  }
</style>
