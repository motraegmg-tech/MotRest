<script lang="ts">
  /**
   * M9 · Insumos del almacén y estaciones de cocina.
   *
   * Es la última pieza que estaba escrita en el código. Con esto, dar de alta un
   * restaurante desde cero ya no exige tocar el repositorio.
   */
  import {
    UNIDADES,
    formatearCantidad,
    interpretarCarta,
    pesos,
    type BorradorEstacion,
    type BorradorInsumo,
    type ProblemaMenu,
    type Unidad,
  } from "@motrest/dominio";
  import { mxn } from "../../formato";
  import { inventario } from "../../inventario.svelte";
  import { local } from "../../local.svelte";
  import { menu } from "../../menu.svelte";
  import { rutas } from "../../nav/rutas.svelte";

  type Vista = "insumos" | "estaciones" | "carta";
  const VISTAS: Vista[] = ["insumos", "estaciones", "carta"];

  /*
   * La pestaña se puede pedir desde la URL (`…/catalogo?ver=estaciones`).
   *
   * Existe para poder enlazar aquí desde Cocina → Menú: las estaciones se
   * configuran en esta pantalla, y quien las busca las busca junto al menú. Un
   * enlace que deja al usuario en la pestaña equivocada no resuelve nada.
   */
  const pedida = rutas.actual.params.ver;
  let vista = $state<Vista>(
    VISTAS.includes(pedida as Vista) ? (pedida as Vista) : "insumos",
  );
  let problemas = $state<ProblemaMenu[]>([]);

  // --- Insumo en edición ---
  let insumoId = $state<string | null>(null);
  let iNombre = $state("");
  let iUnidad = $state<Unidad>("g");
  let iCostoPesos = $state("");
  let iMinimo = $state("");
  let iCategoria = $state("");

  // --- Estación en edición ---
  let estacionId = $state<string | null>(null);
  let eNombre = $state("");
  let eObjetivo = $state("10");
  let eLimite = $state("15");

  const puedeEditar = $derived(menu.permisos.editarProductos);

  function limpiarInsumo() {
    insumoId = null;
    iNombre = "";
    iUnidad = "g";
    iCostoPesos = "";
    iMinimo = "";
    iCategoria = "";
    problemas = [];
  }

  function editarInsumo(id: string) {
    const i = menu.insumos.find((x) => x.id === id);
    if (!i) return;
    insumoId = id;
    iNombre = i.nombre;
    iUnidad = i.unidad_base;
    iCostoPesos = (i.costo_unitario / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    iMinimo = String(i.stock_minimo);
    iCategoria = i.categoria ?? "";
    problemas = [];
  }

  function guardarInsumo() {
    const borrador: BorradorInsumo = {
      nombre: iNombre,
      unidad_base: iUnidad,
      costo_unitario: pesos(Number(iCostoPesos) || 0),
      stock_minimo: Number(iMinimo) || 0,
      categoria: iCategoria,
    };
    const r = insumoId
      ? menu.actualizarInsumo(insumoId, borrador)
      : menu.crearInsumo(borrador);
    problemas = r.problemas;
    if (r.ok) limpiarInsumo();
  }

  function borrarInsumo(id: string) {
    problemas = menu.borrarInsumo(id).problemas;
  }

  function limpiarEstacion() {
    estacionId = null;
    eNombre = "";
    eObjetivo = "10";
    eLimite = "15";
    problemas = [];
  }

  function editarEstacion(id: string) {
    const e = menu.estaciones.find((x) => x.id === id);
    if (!e) return;
    estacionId = id;
    eNombre = e.nombre;
    eObjetivo = String(e.minutos_objetivo);
    eLimite = String(e.minutos_limite);
    problemas = [];
  }

  function guardarEstacion() {
    const borrador: BorradorEstacion = {
      nombre: eNombre,
      minutos_objetivo: Number(eObjetivo) || 0,
      minutos_limite: Number(eLimite) || 0,
    };
    const r = estacionId
      ? menu.actualizarEstacion(estacionId, borrador)
      : menu.crearEstacion(borrador);
    problemas = r.problemas;
    if (r.ok) limpiarEstacion();
  }

  // --- Cargar la carta en bloque -------------------------------------------------------

  let textoCarta = $state("");
  let importado = $state<{ creados: number; categorias: number } | null>(null);

  const previa = $derived(
    textoCarta.trim() === ""
      ? null
      : interpretarCarta(textoCarta, {
          categoriasExistentes: menu.categorias.map((c) => c.nombre),
        }),
  );

  function confirmarImportacion() {
    if (!previa) return;
    importado = menu.importarCarta(previa);
    textoCarta = "";
  }

  const EJEMPLO = [
    "Pizzas",
    "Margarita | 249 | 62",
    "Pepperoni | 269 | 71",
    "Bebidas",
    "Limonada | 45 | 8",
  ].join("\n");
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Catálogo del local</h1>
      <p class="sub">
        Insumos del almacén y estaciones de cocina. Con esto, dar de alta un
        restaurante nuevo no requiere tocar el código.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={vista === "insumos"} onclick={() => { vista = "insumos"; problemas = []; }}>
        Insumos
      </button>
      <button class:on={vista === "estaciones"} onclick={() => { vista = "estaciones"; problemas = []; }}>
        Estaciones
      </button>
      <button class:on={vista === "carta"} onclick={() => { vista = "carta"; problemas = []; }}>
        Local y carta
      </button>
    </div>
  </div>

  {#if !puedeEditar}
    <p class="nota">Tu perfil puede consultar el catálogo, pero no modificarlo.</p>
  {/if}

  {#each problemas as p (p.campo + p.mensaje)}
    <p class:error={p.gravedad === "error"} class:advertencia={p.gravedad === "advertencia"}>
      {p.gravedad === "advertencia" ? "⚠ " : ""}{p.mensaje}
    </p>
  {/each}

  {#if vista === "insumos"}
    {#if puedeEditar}
      <section class="tarjeta">
        <h2>{insumoId ? "Editar insumo" : "Nuevo insumo"}</h2>
        <div class="campos">
          <label class="ancho">
            <span>Nombre</span>
            <input bind:value={iNombre} placeholder="Mozzarella, masa madre, limón…" />
          </label>
          <label>
            <span>Unidad base</span>
            <select bind:value={iUnidad} disabled={insumoId !== null}>
              {#each UNIDADES as u (u.valor)}
                <option value={u.valor}>{u.etiqueta} ({u.valor})</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Costo por {iUnidad}</span>
            <div class="moneda">
              <i>$</i>
              <input type="number" inputmode="decimal" step="0.0001" bind:value={iCostoPesos} placeholder="0.00" />
            </div>
          </label>
          <label>
            <span>Mínimo ({iUnidad})</span>
            <input type="number" inputmode="decimal" bind:value={iMinimo} placeholder="0" />
          </label>
          <label>
            <span>Categoría</span>
            <input bind:value={iCategoria} placeholder="Lácteos, cárnicos…" />
          </label>
        </div>
        {#if insumoId}
          <p class="pista">
            La unidad base no se puede cambiar: las existencias registradas están
            expresadas en ella, y cambiarla convertiría 5 000 g en 5 000 kg. Para
            usar otra unidad, da de alta un insumo nuevo.
          </p>
        {/if}
        <div class="botones">
          {#if insumoId}
            <button class="secundario" onclick={limpiarInsumo}>Cancelar</button>
          {/if}
          <button class="principal" onclick={guardarInsumo}>
            {insumoId ? "Guardar cambios" : "Agregar insumo"}
          </button>
        </div>
      </section>
    {/if}

    <section class="tarjeta">
      <h2>Insumos ({menu.insumos.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th>Unidad</th>
            <th class="num">Costo unitario</th>
            <th class="num">Mínimo</th>
            <th class="num">Existencia</th>
            <th class="num">Recetas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each menu.insumos as insumo (insumo.id)}
            {@const usos = menu.recetasQueUsan(insumo.id).length}
            <tr>
              <td>
                <b>{insumo.nombre}</b>
                {#if insumo.categoria}<small>{insumo.categoria}</small>{/if}
              </td>
              <td>{insumo.unidad_base}</td>
              <td class="num">{mxn(insumo.costo_unitario)}</td>
              <td class="num tenue">{formatearCantidad(insumo.stock_minimo, insumo.unidad_base)}</td>
              <td class="num">
                {formatearCantidad(inventario.cantidad(insumo.id), insumo.unidad_base)}
              </td>
              <td class="num tenue">{usos > 0 ? usos : "—"}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <button onclick={() => editarInsumo(insumo.id)}>Editar</button>
                  <button
                    class="peligro"
                    onclick={() => borrarInsumo(insumo.id)}
                    disabled={usos > 0}
                    title={usos > 0 ? "Lo usa una receta" : "Dar de baja"}
                  >
                    Baja
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {:else if vista === "estaciones"}
    {#if puedeEditar}
      <section class="tarjeta">
        <h2>{estacionId ? "Editar estación" : "Nueva estación"}</h2>
        <div class="campos">
          <label class="ancho">
            <span>Nombre</span>
            <input bind:value={eNombre} placeholder="Horno, barra, parrilla…" />
          </label>
          <label>
            <span>Objetivo (min)</span>
            <input type="number" inputmode="numeric" bind:value={eObjetivo} />
          </label>
          <label>
            <span>Límite (min)</span>
            <input type="number" inputmode="numeric" bind:value={eLimite} />
          </label>
        </div>
        <p class="pista">
          Pasado el <b>objetivo</b> el platillo se pinta en ámbar; pasado el
          <b>límite</b>, en rojo. Cada estación tiene su propio ritmo: una barra
          sirve en minutos y un horno tarda un cuarto de hora.
        </p>
        <div class="botones">
          {#if estacionId}
            <button class="secundario" onclick={limpiarEstacion}>Cancelar</button>
          {/if}
          <button class="principal" onclick={guardarEstacion}>
            {estacionId ? "Guardar cambios" : "Agregar estación"}
          </button>
        </div>
      </section>
    {/if}

    <section class="tarjeta">
      <h2>Estaciones ({menu.estaciones.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Estación</th>
            <th class="num">Objetivo</th>
            <th class="num">Límite</th>
            <th class="num">Productos</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each menu.estaciones as estacion (estacion.id)}
            {@const cuantos = menu.cuantosEnEstacion(estacion.id)}
            <tr>
              <td><b>{estacion.nombre}</b></td>
              <td class="num">{estacion.minutos_objetivo} min</td>
              <td class="num">{estacion.minutos_limite} min</td>
              <td class="num tenue">{cuantos}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <button onclick={() => editarEstacion(estacion.id)}>Editar</button>
                  <button
                    class="peligro"
                    onclick={() => (problemas = menu.borrarEstacion(estacion.id).problemas)}
                    title={cuantos > 0 ? `${cuantos} producto(s) quedarán sin ruteo` : "Eliminar"}
                  >
                    Eliminar
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="pista">
        Al eliminar una estación sus productos quedan <b>sin ruteo</b>: siguen
        vendiéndose y aparecen en la vista de todas las estaciones del tablero,
        en vez de desaparecer de cocina sin aviso.
      </p>
    </section>
  {:else}
    <!--
      La jornada operativa. Vive junto a la carta porque las dos son ajustes del
      LOCAL, no operación.
    -->
    <section class="tarjeta">
      <h2>Jornada del local</h2>
      <p class="pista">
        A qué hora cierra contablemente el día. Un servicio que termina a la una
        de la madrugada pertenece a la noche en que empezó: con el corte a las
        <b>5:00</b>, el viernes cuenta como viernes en el resultado del día y en
        el pronóstico. Cortar a medianoche partiría el servicio en dos.
      </p>
      {#if puedeEditar}
        <label class="jornada">
          <span>Cierre de la jornada</span>
          <select
            value={String(local.horaCorte)}
            onchange={(e) => local.fijarHoraCorte(Number(e.currentTarget.value))}
          >
            {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
              <option value={String(h)}>
                {String(h).padStart(2, "0")}:00{h === 5 ? " (recomendado)" : ""}
              </option>
            {/each}
          </select>
        </label>
      {/if}
    </section>

    <!--
      Cargar la carta en bloque. Nunca se importa a ciegas: primero se muestra
      renglón por renglón lo que va a quedar, y solo entonces se confirma.
    -->
    <section class="tarjeta">
      <h2>Cargar la carta</h2>
      <p class="pista">
        Pega aquí la carta y se da de alta completa. Sirve un copiado de Excel,
        o una lista escrita por secciones. El orden de columnas es
        <b>Categoría · Producto · Precio · Costo</b>, y el costo puede faltar.
      </p>

      {#if puedeEditar}
        <textarea
          bind:value={textoCarta}
          rows="8"
          placeholder={EJEMPLO}
          spellcheck="false"
        ></textarea>

        {#if importado}
          <p class="ok" role="status">
            Listo: {importado.creados} platillos dados de alta
            {#if importado.categorias > 0}y {importado.categorias} categorías creadas{/if}.
          </p>
        {/if}

        {#if previa}
          <div class="marcador-import">
            <span class="cuenta alta">{previa.altas} se darán de alta</span>
            {#if previa.avisos > 0}
              <span class="cuenta aviso">{previa.avisos} con aviso</span>
            {/if}
            {#if previa.errores > 0}
              <span class="cuenta error">{previa.errores} con error</span>
            {/if}
            {#if previa.categorias.length > 0}
              <span class="cuenta nueva">
                {previa.categorias.length} categorías nuevas: {previa.categorias.join(", ")}
              </span>
            {/if}
          </div>

          {#if previa.sin_costos}
            <p class="advertencia">
              ⚠ Ninguna línea trae costo. Los platillos se crearán, pero el
              <b>food cost</b>, el margen y la ingeniería de menú saldrán en
              100 % hasta que captures los costos.
            </p>
          {/if}

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Categoría</th>
                <th>Producto</th>
                <th class="num">Precio</th>
                <th class="num">Costo</th>
                <th>Qué pasa</th>
              </tr>
            </thead>
            <tbody>
              {#each previa.lineas as l (l.renglon)}
                <tr class={l.estado}>
                  <td class="tenue">{l.renglon}</td>
                  <td>{l.categoria || "—"}</td>
                  <td><b>{l.nombre || "—"}</b></td>
                  <td class="num">{l.estado === "error" ? "—" : mxn(l.precio)}</td>
                  <td class="num tenue">{l.costo > 0 ? mxn(l.costo) : "—"}</td>
                  <td class="detalle-import">
                    {#if l.estado === "alta"}
                      <span class="tenue">Se da de alta</span>
                    {:else}
                      {l.detalle}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <div class="botones">
            <button class="secundario" onclick={() => (textoCarta = "")}>Limpiar</button>
            <button
              class="principal"
              disabled={previa.altas === 0}
              onclick={confirmarImportacion}
            >
              Dar de alta {previa.altas} platillos
            </button>
          </div>
          {#if previa.errores > 0}
            <p class="pista">
              Las líneas con error <b>no se importan</b>. Corrígelas en el texto
              y vuelve a revisar, o dales de alta a mano después.
            </p>
          {/if}
        {/if}
      {:else}
        <p class="nota">Tu perfil no puede modificar la carta.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 70rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
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
    max-width: 38rem;
  }
  .pestanas {
    display: flex;
    gap: 0.3rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.2rem;
  }
  .pestanas button {
    padding: 0.4rem 0.9rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
  }
  .pestanas button.on {
    background: var(--acento);
    color: #fff;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  select:disabled {
    background: var(--fondo);
    color: var(--gris);
  }
  .moneda {
    position: relative;
    display: flex;
    align-items: center;
  }
  .moneda i {
    position: absolute;
    left: 0.65rem;
    font-style: normal;
    font-weight: 600;
    color: var(--gris);
  }
  .moneda input {
    padding-left: 1.4rem;
  }
  .pista {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.85rem;
    color: var(--gris);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num,
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  td {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .tenue {
    color: var(--gris);
  }
  .acciones {
    text-align: right;
    white-space: nowrap;
  }
  .acciones button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    margin-left: 0.3rem;
  }
  .acciones button:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento);
  }
  .acciones .peligro:hover:not(:disabled) {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .acciones button:disabled {
    opacity: 0.35;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.85rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .advertencia {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--acento-2);
  }

  /* --- Cargar carta --- */
  textarea {
    width: 100%;
    margin-top: 0.85rem;
    padding: 0.75rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    resize: vertical;
    background: #fff;
  }
  textarea:focus {
    outline: none;
    border-color: var(--acento);
  }
  .marcador-import {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0.85rem 0;
  }
  .cuenta {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: var(--fondo);
    color: var(--gris);
  }
  .cuenta.alta {
    background: #eef7e8;
    color: #3f6b2c;
  }
  .cuenta.aviso {
    background: #fff5ec;
    color: var(--acento-2);
  }
  .cuenta.error {
    background: #fdeae8;
    color: var(--peligro);
  }
  tr.error td {
    background: #fdf4f3;
  }
  tr.aviso td {
    background: #fffaf5;
  }
  .detalle-import {
    font-size: 0.8rem;
    line-height: 1.4;
    white-space: normal;
    max-width: 20rem;
  }
  .ok {
    margin-top: 0.85rem;
    background: #eef7e8;
    border: 1px solid #b6d9a0;
    border-radius: var(--r-md);
    padding: 0.7rem 0.95rem;
    font-size: 0.86rem;
    font-weight: 600;
    color: #3f6b2c;
  }
  .jornada {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-width: 18rem;
    margin-top: 0.85rem;
  }
  .jornada span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .jornada select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  .jornada select:focus {
    outline: none;
    border-color: var(--acento);
  }
</style>
