<script lang="ts">
  /**
   * M9 · Salones y plano de piso.
   *
   * Cada restaurante dibuja aquí sus espacios reales: crea áreas, ajusta la
   * retícula y coloca las mesas arrastrándolas, para que el plano de la pantalla
   * corresponda al del piso.
   */
  import { describirProblema, type FormaMesa, type Mesa } from "@motrest/dominio";
  import { plano } from "../../plano.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("cat.area.editar"));

  let seleccionada = $state<string | null>(null);
  let error = $state("");
  let nombreArea = $state("");
  let creandoArea = $state(false);

  // Arrastre
  let arrastrando = $state<string | null>(null);
  let lienzo = $state<HTMLElement | null>(null);

  const mesaSeleccionada = $derived(seleccionada ? plano.mesa(seleccionada) : undefined);

  function avisar(r: { ok: boolean; error?: string }) {
    error = r.ok ? "" : (r.error ?? "");
  }

  /** Traduce la posición del puntero a una celda de la retícula. */
  function celdaDesdePuntero(evento: PointerEvent): { columna: number; fila: number } | null {
    const area = plano.area;
    if (!lienzo || !area) return null;
    const caja = lienzo.getBoundingClientRect();
    const columna = Math.floor(((evento.clientX - caja.left) / caja.width) * area.columnas);
    const fila = Math.floor(((evento.clientY - caja.top) / caja.height) * area.filas);
    return { columna, fila };
  }

  function iniciarArrastre(evento: PointerEvent, mesa: Mesa) {
    if (!puedeEditar) return;
    seleccionada = mesa.id;
    arrastrando = mesa.id;
    (evento.target as HTMLElement).setPointerCapture?.(evento.pointerId);
  }

  function moverArrastre(evento: PointerEvent) {
    if (!arrastrando) return;
    const mesa = plano.mesa(arrastrando);
    const celda = celdaDesdePuntero(evento);
    if (!mesa || !celda) return;

    // Se ancla por el centro para que la mesa siga al dedo con naturalidad.
    const columna = Math.max(0, celda.columna - Math.floor(mesa.ancho / 2));
    const fila = Math.max(0, celda.fila - Math.floor(mesa.alto / 2));
    if (columna === mesa.columna && fila === mesa.fila) return;

    const r = plano.moverMesa(mesa.id, columna, fila);
    // Durante el arrastre no se grita: solo se ignora el movimiento inválido.
    if (!r.ok) return;
    error = "";
  }

  function soltarArrastre() {
    arrastrando = null;
  }

  function crearArea() {
    const r = plano.crearArea(nombreArea);
    avisar(r);
    if (r.ok) {
      nombreArea = "";
      creandoArea = false;
    }
  }

  const FORMAS: { valor: FormaMesa; etiqueta: string }[] = [
    { valor: "cuadrada", etiqueta: "Cuadrada" },
    { valor: "redonda", etiqueta: "Redonda" },
    { valor: "rectangular", etiqueta: "Rectangular" },
  ];
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Salones y plano de piso</h1>
      <p class="sub">
        Dibuja aquí la distribución real del local. Arrastra las mesas sobre la
        retícula para que coincidan con su lugar en el piso.
      </p>
    </div>
  </div>

  <!-- Áreas -->
  <div class="areas">
    {#each plano.areas as area (area.id)}
      <button
        class="area"
        class:on={area.id === plano.areaActiva}
        onclick={() => (plano.areaActiva = area.id)}
      >
        {area.nombre}
        <span class="cuenta">{plano.plano.mesas.filter((m) => m.area_id === area.id).length}</span>
      </button>
    {/each}

    {#if puedeEditar}
      {#if creandoArea}
        <span class="nueva-area">
          <input
            bind:value={nombreArea}
            placeholder="Nombre del área"
            onkeydown={(e) => e.key === "Enter" && crearArea()}
          />
          <button class="mini" onclick={crearArea}>Crear</button>
          <button class="mini" onclick={() => (creandoArea = false)}>×</button>
        </span>
      {:else}
        <button class="area agregar" onclick={() => (creandoArea = true)}>+ Área</button>
      {/if}
    {/if}
  </div>

  {#if plano.area}
    {@const area = plano.area}

    {#if puedeEditar}
      <div class="herramientas">
        <span class="grupo">
          <b>{area.nombre}</b>
          <button class="mini" onclick={() => avisar(plano.renombrarArea(area.id, prompt("Nombre del área", area.nombre) ?? area.nombre))}>
            Renombrar
          </button>
          <button class="mini peligro" onclick={() => avisar(plano.eliminarArea(area.id))}>
            Eliminar área
          </button>
        </span>

        <span class="grupo">
          Retícula
          <button class="mini" onclick={() => avisar(plano.redimensionarArea(area.id, area.columnas - 1, area.filas))}>−</button>
          <span class="valor">{area.columnas}</span>
          <button class="mini" onclick={() => avisar(plano.redimensionarArea(area.id, area.columnas + 1, area.filas))}>+</button>
          ×
          <button class="mini" onclick={() => avisar(plano.redimensionarArea(area.id, area.columnas, area.filas - 1))}>−</button>
          <span class="valor">{area.filas}</span>
          <button class="mini" onclick={() => avisar(plano.redimensionarArea(area.id, area.columnas, area.filas + 1))}>+</button>
        </span>

        <span class="grupo">
          {#each FORMAS as forma (forma.valor)}
            <button class="mini" onclick={() => avisar(plano.agregarMesa(area.id, forma.valor))}>
              + {forma.etiqueta}
            </button>
          {/each}
        </span>
      </div>
    {/if}

    <!-- Lienzo -->
    <div
      class="lienzo"
      class:editable={puedeEditar}
      bind:this={lienzo}
      style="--columnas: {area.columnas}; --filas: {area.filas}"
      role="application"
      aria-label="Plano de {area.nombre}: arrastra las mesas para colocarlas"
      onpointermove={moverArrastre}
      onpointerup={soltarArrastre}
      onpointercancel={soltarArrastre}
    >
      {#each plano.mesas as mesa (mesa.id)}
        <button
          class="mesa {mesa.forma}"
          class:sel={mesa.id === seleccionada}
          class:moviendo={mesa.id === arrastrando}
          style="grid-column: {mesa.columna + 1} / span {mesa.ancho};
                 grid-row: {mesa.fila + 1} / span {mesa.alto}"
          onpointerdown={(e) => iniciarArrastre(e, mesa)}
          onclick={() => (seleccionada = mesa.id)}
        >
          {mesa.nombre}
        </button>
      {/each}
    </div>

    <!-- Mesa seleccionada -->
    {#if mesaSeleccionada && puedeEditar}
      {@const m = mesaSeleccionada}
      <div class="detalle">
        <span class="grupo">
          <b>Mesa {m.nombre}</b>
          <button class="mini" onclick={() => avisar(plano.renombrarMesa(m.id, prompt("Identificador de la mesa", m.nombre) ?? m.nombre))}>
            Renombrar
          </button>
        </span>

        <span class="grupo">
          Forma
          {#each FORMAS as forma (forma.valor)}
            <button
              class="mini"
              class:on={m.forma === forma.valor}
              onclick={() => avisar(plano.cambiarForma(m.id, forma.valor))}
            >
              {forma.etiqueta}
            </button>
          {/each}
        </span>

        <span class="grupo">
          Tamaño
          <button class="mini" onclick={() => avisar(plano.redimensionarMesa(m.id, m.ancho - 1, m.alto))}>−</button>
          <span class="valor">{m.ancho}</span>
          <button class="mini" onclick={() => avisar(plano.redimensionarMesa(m.id, m.ancho + 1, m.alto))}>+</button>
          ×
          <button class="mini" onclick={() => avisar(plano.redimensionarMesa(m.id, m.ancho, m.alto - 1))}>−</button>
          <span class="valor">{m.alto}</span>
          <button class="mini" onclick={() => avisar(plano.redimensionarMesa(m.id, m.ancho, m.alto + 1))}>+</button>
        </span>

        <button
          class="mini peligro"
          onclick={() => { avisar(plano.eliminarMesa(m.id)); seleccionada = null; }}
        >
          Quitar mesa
        </button>
      </div>
    {:else if puedeEditar}
      <p class="pista">Toca una mesa para renombrarla, cambiar su forma o su tamaño.</p>
    {:else}
      <p class="pista">Tu rol permite ver el plano, pero no modificarlo.</p>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if plano.problemas.length > 0}
    <div class="problemas">
      <b>Revisa el plano</b>
      <ul>
        {#each plano.problemas as problema, i (i)}
          <li>{describirProblema(problema)}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 66rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 42rem;
  }
  .areas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .area {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .area .cuenta {
    font-size: 0.7rem;
    opacity: 0.8;
  }
  .area.agregar {
    border-style: dashed;
  }
  .nueva-area {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .nueva-area input {
    padding: 0.35rem 0.6rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    font-size: 0.85rem;
    font-family: var(--font-cuerpo);
  }
  .herramientas,
  .detalle {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 0.9rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .grupo {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .grupo b {
    color: var(--pizarra);
    margin-right: 0.2rem;
  }
  .valor {
    font-family: var(--font-titulo);
    font-weight: 700;
    color: var(--pizarra);
    min-width: 1.2rem;
    text-align: center;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.25rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .mini.peligro {
    color: var(--peligro);
    border-color: #f3c8c3;
  }
  .mini.peligro:hover {
    background: var(--peligro);
    color: #fff;
  }
  .lienzo {
    display: grid;
    grid-template-columns: repeat(var(--columnas), 1fr);
    grid-template-rows: repeat(var(--filas), minmax(2.2rem, 1fr));
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: var(--r-lg);
    border: 1px solid var(--borde);
    background-color: var(--fondo);
    background-image:
      linear-gradient(to right, var(--borde) 1px, transparent 1px),
      linear-gradient(to bottom, var(--borde) 1px, transparent 1px);
    background-size: calc(100% / var(--columnas)) calc(100% / var(--filas));
    touch-action: none;
    min-height: 18rem;
  }
  .mesa {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--acento);
    background: var(--claro);
    color: var(--pizarra);
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 700;
  }
  .lienzo.editable .mesa {
    cursor: grab;
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
  .mesa.sel {
    box-shadow: 0 0 0 3px rgba(242, 133, 58, 0.35);
  }
  .mesa.moviendo {
    cursor: grabbing;
    opacity: 0.85;
    box-shadow: var(--sombra-lg);
  }
  .pista {
    font-size: 0.84rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .problemas {
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    font-size: 0.85rem;
  }
  .problemas b {
    color: var(--acento);
  }
  .problemas ul {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    color: var(--pizarra);
  }
  .problemas li::before {
    content: "· ";
    color: var(--acento);
  }
</style>
