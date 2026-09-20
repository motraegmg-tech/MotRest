<script lang="ts">
  /**
   * M9 · Salones y plano de piso.
   *
   * Cada restaurante dibuja aquí sus espacios reales: crea áreas, ajusta la
   * retícula y coloca las mesas arrastrándolas, para que el plano de la pantalla
   * corresponda al del piso.
   *
   * NADA DE `prompt()` NI `confirm()` DEL NAVEGADOR. Esta pantalla se usa en la
   * tableta y en el kiosco de la caja, donde el diálogo del sistema sale con
   * tipografía ajena, sin teclado numérico y —en la ventana de escritorio— a
   * veces no sale. Renombrar y borrar piden un diálogo propio, que además puede
   * decir en qué se está metiendo uno antes de aceptar.
   */
  import {
    LIMITES_MESA,
    cabeEnArea,
    capacidadDe,
    describirProblema,
    haySolape,
    type FormaMesa,
    type Mesa,
  } from "@motrest/dominio";
  import { rutas } from "../../nav/rutas.svelte";
  import { plano } from "../../plano.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { revelar } from "../../subir";

  const puedeEditar = $derived(sesion.puedeOperar("cat.area.editar"));

  let seleccionada = $state<string | null>(null);
  let error = $state("");
  let nombreArea = $state("");
  let creandoArea = $state(false);

  // Arrastre
  let arrastrando = $state<string | null>(null);
  let lienzo = $state<HTMLElement | null>(null);
  /**
   * La sombra que sigue al dedo mientras se arrastra.
   *
   * Sin ella, un movimiento inválido —fuera de la retícula o encima de otra
   * mesa— simplemente no pasaba nada, y parecía que la pantalla se había
   * trabado. Con la sombra en rojo se ve POR QUÉ no se puede soltar ahí.
   */
  let celdaDestino = $state<{
    columna: number;
    fila: number;
    ancho: number;
    alto: number;
    valida: boolean;
  } | null>(null);

  const mesaSeleccionada = $derived(seleccionada ? plano.mesa(seleccionada) : undefined);

  // --- Diálogos propios ------------------------------------------------------------

  type Dialogo =
    | { tipo: "renombrar_area"; id: string; valor: string }
    | { tipo: "renombrar_mesa"; id: string; valor: string }
    | { tipo: "capacidad"; id: string; valor: string }
    | { tipo: "eliminar_area"; id: string; nombre: string }
    | { tipo: "eliminar_mesa"; id: string; nombre: string };

  let dialogo = $state<Dialogo | null>(null);

  function cerrarDialogo() {
    dialogo = null;
  }

  function confirmarDialogo() {
    if (!dialogo) return;
    switch (dialogo.tipo) {
      case "renombrar_area":
        if (!avisar(plano.renombrarArea(dialogo.id, dialogo.valor))) return;
        break;
      case "renombrar_mesa":
        if (!avisar(plano.renombrarMesa(dialogo.id, dialogo.valor))) return;
        break;
      case "capacidad": {
        const texto = dialogo.valor.trim();
        const valor = texto === "" ? null : Number(texto);
        if (!avisar(plano.cambiarCapacidad(dialogo.id, valor))) return;
        break;
      }
      case "eliminar_area":
        if (!avisar(plano.eliminarArea(dialogo.id))) return;
        break;
      case "eliminar_mesa": {
        const id = dialogo.id;
        if (!avisar(plano.eliminarMesa(id))) return;
        if (seleccionada === id) seleccionada = null;
        break;
      }
    }
    cerrarDialogo();
  }

  /** Escape cierra, Enter acepta: en la caja se teclea, no se apunta. */
  function teclasDelDialogo(evento: KeyboardEvent) {
    if (!dialogo) return;
    if (evento.key === "Escape") cerrarDialogo();
    if (evento.key === "Enter" && dialogo.tipo !== "eliminar_area" && dialogo.tipo !== "eliminar_mesa") {
      confirmarDialogo();
    }
  }

  /** Publica el error de una operación. Devuelve si salió bien, para encadenar. */
  function avisar(r: { ok: boolean; error?: string }): boolean {
    error = r.ok ? "" : (r.error ?? "");
    return r.ok;
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
    const area = plano.area;
    if (!mesa || !celda || !area) {
      celdaDestino = null;
      return;
    }

    // Se ancla por el centro para que la mesa siga al dedo con naturalidad.
    const columna = Math.max(0, celda.columna - Math.floor(mesa.ancho / 2));
    const fila = Math.max(0, celda.fila - Math.floor(mesa.alto / 2));

    const tentativa: Mesa = { ...mesa, columna, fila };
    celdaDestino = {
      columna,
      fila,
      ancho: mesa.ancho,
      alto: mesa.alto,
      valida: cabeEnArea(tentativa, area) && !haySolape(tentativa, plano.mesas),
    };

    if (columna === mesa.columna && fila === mesa.fila) return;

    const r = plano.moverMesa(mesa.id, columna, fila);
    // Durante el arrastre no se grita: la sombra roja ya lo está diciendo.
    if (!r.ok) return;
    error = "";
  }

  function soltarArrastre() {
    arrastrando = null;
    celdaDestino = null;
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
    <button class="volver" onclick={() => rutas.ir("venta", "salon")}>← Volver a la venta</button>
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
        <button class="area agregar boton-agregar" onclick={() => (creandoArea = true)}>
          + Área
        </button>
      {/if}
    {/if}
  </div>

  {#if plano.area}
    {@const area = plano.area}

    {#if puedeEditar}
      <div class="herramientas">
        <span class="grupo">
          <b>{area.nombre}</b>
          <button
            class="mini"
            onclick={() => (dialogo = { tipo: "renombrar_area", id: area.id, valor: area.nombre })}
          >
            Renombrar
          </button>
          <button
            class="mini peligro"
            onclick={() => (dialogo = { tipo: "eliminar_area", id: area.id, nombre: area.nombre })}
          >
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

    <!--
      Lienzo. Va dentro de una caja que desplaza en horizontal: la retícula
      tiene celdas CUADRADAS y un salón muy ancho no puede encogerlas hasta
      volverlas ilegibles, así que a partir de cierto punto se desplaza.
    -->
    <div class="lienzo-caja">
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
      <!--
        La sombra del destino. Va DEBAJO de las mesas (z-index) para que no tape
        la que se está moviendo, y solo existe mientras dura el arrastre.
      -->
      {#if celdaDestino}
        {@const d = celdaDestino}
        <div
          class="sombra"
          class:invalida={!d.valida}
          style="grid-column: {d.columna + 1} / span {d.ancho};
                 grid-row: {d.fila + 1} / span {d.alto}"
          aria-hidden="true"
        ></div>
      {/if}

      {#each plano.mesas as mesa (mesa.id)}
        <button
          class="mesa {mesa.forma}"
          class:sel={mesa.id === seleccionada}
          class:moviendo={mesa.id === arrastrando}
          style="grid-column: {mesa.columna + 1} / span {mesa.ancho};
                 grid-row: {mesa.fila + 1} / span {mesa.alto}"
          onpointerdown={(e) => iniciarArrastre(e, mesa)}
          onclick={() => (seleccionada = mesa.id)}
          title="Mesa {mesa.nombre} · {capacidadDe(mesa)} comensales"
        >
          <span class="rotulo">{mesa.nombre}</span>
          <!--
            La capacidad se pinta en la mesa, no solo en el inspector: colocar el
            plano es justo el momento en que uno se da cuenta de que la de la
            esquina es de dos y la del ventanal de seis.
          -->
          <small class="plazas">{capacidadDe(mesa)}p</small>
        </button>
      {/each}
    </div>
    </div>

    <!-- Mesa seleccionada -->
    {#if mesaSeleccionada && puedeEditar}
      {@const m = mesaSeleccionada}
      <!-- Se abre bajo el plano: con un salón grande queda fuera de cuadro. Se
           baja hasta él, y otra vez al tocar otra mesa con el panel abierto. -->
      <div class="detalle" use:revelar={m.id}>
        <span class="grupo">
          <b>Mesa {m.nombre}</b>
          <button
            class="mini"
            onclick={() => (dialogo = { tipo: "renombrar_mesa", id: m.id, valor: m.nombre })}
          >
            Renombrar
          </button>
        </span>

        <!--
          CUÁNTA GENTE CABE. Es el dato con el que se sienta a una reserva y con
          el que el sistema propone juntar mesas; sin él, «somos diez» se
          contesta a ojo. Se puede dejar en automático: entonces se estima del
          tamaño en la retícula, y el rótulo lo dice para que nadie crea que es
          un número que alguien midió.
        -->
        <span class="grupo">
          Comensales
          <button
            class="mini"
            onclick={() => avisar(plano.cambiarCapacidad(m.id, capacidadDe(m) - 1))}
            aria-label="Un comensal menos"
          >
            −
          </button>
          <span class="valor">{capacidadDe(m)}</span>
          <button
            class="mini"
            onclick={() => avisar(plano.cambiarCapacidad(m.id, capacidadDe(m) + 1))}
            aria-label="Un comensal más"
          >
            +
          </button>
          <button
            class="mini"
            onclick={() => (dialogo = { tipo: "capacidad", id: m.id, valor: String(capacidadDe(m)) })}
          >
            Fijar…
          </button>
          {#if m.capacidad === undefined}
            <em class="estimada">estimada del tamaño</em>
          {:else}
            <button class="mini" onclick={() => avisar(plano.cambiarCapacidad(m.id, null))}>
              Volver a automático
            </button>
          {/if}
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
          onclick={() => (dialogo = { tipo: "eliminar_mesa", id: m.id, nombre: m.nombre })}
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

<svelte:window onkeydown={teclasDelDialogo} />

<!--
  Los diálogos de esta pantalla. Uno solo a la vez, y siempre con el nombre de
  lo que se va a tocar escrito dentro: «¿Eliminar?» a secas es como se borra el
  área equivocada.
-->
{#if dialogo}
  {@const d = dialogo}
  <div class="velo" role="presentation" onclick={cerrarDialogo}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Editar el plano">
    {#if d.tipo === "renombrar_area" || d.tipo === "renombrar_mesa"}
      <h2>{d.tipo === "renombrar_area" ? "Nombre del área" : "Identificador de la mesa"}</h2>
      <p class="ayuda">
        {d.tipo === "renombrar_area"
          ? "Como lo llama el personal: Terraza, Salón, Barra."
          : "Es lo que se pinta en la mesa y sale en el ticket: 1, 12, Barra 3."}
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="campo" bind:value={d.valor} autofocus />
    {:else if d.tipo === "capacidad"}
      <h2>Comensales en la mesa {plano.nombreMesa(d.id)}</h2>
      <p class="ayuda">
        De {LIMITES_MESA.capacidadMin} a {LIMITES_MESA.capacidadMax}. Déjalo vacío
        para que se estime del tamaño de la mesa.
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="campo" type="number" inputmode="numeric" bind:value={d.valor} autofocus />
    {:else if d.tipo === "eliminar_area"}
      <h2>¿Eliminar el área «{d.nombre}»?</h2>
      <p class="ayuda">
        El área tiene que estar vacía. Las mesas que hubiera dentro se quitan
        antes, una por una: no se borran de golpe.
      </p>
    {:else}
      <h2>¿Quitar la mesa {d.nombre}?</h2>
      <p class="ayuda">
        Deja de existir en el plano. Lo que ya se cobró en ella sigue en los
        reportes: quitar una mesa no borra su historia.
      </p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={cerrarDialogo}>Cancelar</button>
      <button
        class="principal"
        class:peligro={d.tipo === "eliminar_area" || d.tipo === "eliminar_mesa"}
        onclick={confirmarDialogo}
      >
        {d.tipo === "eliminar_area" || d.tipo === "eliminar_mesa" ? "Sí, quitar" : "Guardar"}
      </button>
    </div>
  </div>
{/if}

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
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .encabezado > div {
    flex: 1;
  }
  .volver {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.5rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    white-space: nowrap;
  }
  .volver:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
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
    border-radius: var(--r-pill);
    padding: 0.35rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  /*
   * El color va aparte y EXCLUYENDO al de agregar. Si se declarase en `.area` a
   * secas, ganaría por especificidad a la utilidad `.boton-agregar` de base.css
   * —los estilos de Svelte llevan su clase de ámbito y suman un escalón— y el
   * botón de «+ Área» se quedaría con el mismo gris del resto.
   */
  .area:not(.boton-agregar) {
    border: 1.5px solid var(--borde);
    color: var(--gris);
    background: #fff;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .area .cuenta {
    font-size: 0.7rem;
    opacity: 0.8;
  }
  /*
   * Mantiene la forma de píldora de las demás áreas; el contorno naranja y la
   * sombra los pone `.boton-agregar` (base.css), que es la misma para todos los
   * botones de «agregar» de la aplicación. Antes era un punteado gris que se
   * confundía con una etiqueta más de la fila.
   */
  .area.agregar {
    border-radius: var(--r-pill);
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
    color: var(--acento-texto);
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .mini.peligro {
    color: var(--peligro);
    border-color: #f3c8c3;
  }
  .mini.peligro:hover {
    background: var(--peligro);
    color: #fff;
  }
  /*
   * LA CELDA ES CUADRADA, Y ESO GOBIERNA TODO LO DE AQUÍ (pedido de Gonzalo).
   *
   * Antes las columnas eran `1fr` y las filas `minmax(2.2rem, 1fr)`: el ancho lo
   * repartía el espacio disponible y el alto lo ponía otra cuenta distinta, así
   * que la celda salía rectangular y una mesa declarada de 1×1 —la cuadrada de
   * dos personas— se dibujaba como un rectángulo. Peor: una mesa REDONDA salía
   * ovalada, porque el 50% de radio se calcula sobre cada lado.
   *
   * Ahora el lienzo lleva `aspect-ratio: columnas / filas` y reparte ese espacio
   * en partes iguales, así que alto de celda = ancho de celda a cualquier
   * tamaño. Las tres piezas que lo sostienen:
   *
   *   - `minmax(0, 1fr)` y no `1fr`: con `1fr` a secas el contenido de una mesa
   *     puede estirar su fila —`1fr` es `minmax(auto, 1fr)`— y ahí se pierde el
   *     cuadrado. El mínimo de cero se lo impide.
   *   - `gap: 0` y sin relleno: la separación entre mesas la pone el margen de
   *     cada mesa. Un hueco entre celdas rompería tanto el cuadrado como la
   *     retícula de fondo, que se dibuja en porcentajes del lienzo.
   *   - `width: min(100%, …)`: con espacio de sobra la celda no crece sin
   *     límite; con poco espacio encoge hasta el mínimo y luego se desplaza.
   *
   * Y de paso queda ALINEADA: las líneas de fondo caen exactamente donde
   * empieza cada celda, que con el relleno y el hueco anteriores nunca ocurría.
   * Eso también arregla el arrastre —`celdaDesdePuntero` divide el ancho de la
   * caja entre las columnas, una cuenta que solo es exacta sin relleno—.
   */
  .lienzo-caja {
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }
  .lienzo {
    --celda: 3.25rem;
    --hueco: 2px;
    display: grid;
    grid-template-columns: repeat(var(--columnas), minmax(0, 1fr));
    grid-template-rows: repeat(var(--filas), minmax(0, 1fr));
    aspect-ratio: var(--columnas) / var(--filas);
    width: min(100%, calc(var(--columnas) * var(--celda)));
    /* Por debajo de esto no se encoge: se desplaza dentro de su caja. */
    min-width: calc(var(--columnas) * 2.1rem);
    gap: 0;
    border-radius: var(--r-lg);
    /*
     * El marco va como sombra interior y no como `border`: con `border-box` un
     * borde de 1px se come una línea del área de contenido, y entonces el
     * `aspect-ratio` deja de repartirse sobre el mismo rectángulo que las
     * celdas. La celda volvería a no ser cuadrada, por poco, y la retícula de
     * fondo —que se pinta en porcentajes— quedaría corrida ese mismo píxel.
     */
    box-shadow: inset 0 0 0 1px var(--borde);
    background-color: var(--fondo);
    background-image:
      linear-gradient(to right, var(--borde) 1px, transparent 1px),
      linear-gradient(to bottom, var(--borde) 1px, transparent 1px);
    background-size: calc(100% / var(--columnas)) calc(100% / var(--filas));
    touch-action: none;
  }
  /*
   * La sombra del destino durante el arrastre. Naranja cuando se puede soltar,
   * roja cuando no: los dos colores de la marca, usados con su significado.
   */
  .sombra {
    z-index: 0;
    /* El mismo margen que la mesa: la sombra tiene que caer donde va a caer ella. */
    margin: var(--hueco);
    border-radius: var(--r-sm);
    border: 2px dashed var(--acento);
    background: rgba(242, 133, 58, 0.14);
    pointer-events: none;
  }
  .sombra.invalida {
    border-color: var(--peligro);
    background: rgba(224, 57, 43, 0.14);
  }
  .mesa {
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.05rem;
    /* La separación entre mesas vive aquí, no en el `gap` de la retícula. */
    margin: var(--hueco);
    /* Un rótulo largo no puede estirar la celda: el cuadrado manda. */
    overflow: hidden;
    min-width: 0;
    border: 2px solid var(--acento);
    background: var(--claro);
    color: var(--pizarra);
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 700;
    line-height: 1;
  }
  .mesa .rotulo {
    line-height: 1;
  }
  .mesa .plazas {
    font-family: var(--font-cuerpo);
    font-size: 0.6rem;
    font-weight: 600;
    line-height: 1;
    color: var(--acento-texto);
  }
  .estimada {
    font-size: 0.75rem;
    color: var(--gris);
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
    color: var(--acento-texto);
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
    color: var(--acento-texto);
  }

  /* --- Diálogos propios ------------------------------------------------------
   *
   * La tarjeta blanca sobre velo oscuro es lo que trajo la revisión de Alejandro
   * y se queda: se lee mejor que el diálogo del navegador y funciona igual en la
   * tableta. Lo que cambia son los colores — nada de paletas prestadas: el botón
   * que confirma va en NARANJA MOTRAE y el que destruye en el rojo de la marca.
   */
  .velo {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(20, 24, 26, 0.55);
  }
  .dialogo {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(26rem, calc(100vw - 2rem));
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1.25rem;
    border-radius: var(--r-lg);
    background: var(--blanco);
    box-shadow: var(--sombra-lg);
  }
  .dialogo h2 {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .dialogo .ayuda {
    font-size: 0.85rem;
    color: var(--gris);
  }
  .campo {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.6rem 0.7rem;
    font-family: var(--font-cuerpo);
    font-size: 1rem;
    color: var(--pizarra);
  }
  .campo:focus {
    outline: none;
    border-color: var(--acento);
    box-shadow: 0 0 0 3px rgba(242, 133, 58, 0.2);
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .botones button {
    border-radius: var(--r-sm);
    padding: 0.55rem 1rem;
    font-family: var(--font-titulo);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    background: var(--blanco);
    color: var(--gris);
  }
  .secundario:hover {
    border-color: var(--pizarra);
    color: var(--pizarra);
  }
  .principal {
    border: 1.5px solid var(--acento);
    background: var(--acento);
    color: var(--blanco);
  }
  .principal:hover {
    box-shadow: var(--sombra-md);
  }
  .principal.peligro {
    border-color: var(--peligro);
    background: var(--peligro);
  }
</style>
