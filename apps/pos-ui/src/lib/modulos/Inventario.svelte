<script lang="ts">
  /**
   * M3 · Inventario: existencias, mermas y conteos.
   *
   * El stock es la suma de los movimientos, nunca un campo que se sobrescribe,
   * así que el histórico siempre explica el número. El stock negativo se señala
   * pero NO bloquea la venta (TRD §5.1).
   */
  import {
    MOTIVOS_MANUALES,
    costeoIdealReal,
    cuentasCerradasEn,
    explicarVarianza,
    seDesvia,
    etiquetaMotivo,
    formatearCantidad,
    valorDe,
    type MotivoMovimiento,
    calcularRendimiento
  } from "@motrest/dominio";
  import VentanaAmplia from "../VentanaAmplia.svelte";
  import { catalogo } from "../catalogo";
  import { hora, mxn, pct } from "../formato";
  import { local } from "../local.svelte";
  import { pos } from "../pos.svelte";
  import { inventario } from "../inventario.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  type Vista = "existencias" | "movimiento" | "conteo" | "costeo" | "rendimiento";
  let vista = $state<Vista>("existencias");

  // Movimiento manual
  let insumoId = $state(inventario.insumos[0]?.id ?? "");
  let cantidad = $state("");
  let motivo = $state<MotivoMovimiento>("merma");
  let nota = $state("");
  let error = $state("");

  // Conteo cíclico
  let contados = $state<Record<string, string>>({});

  const puedeMerma = $derived(sesion.puedeOperar("inv.merma.registrar"));
  const puedeConteo = $derived(sesion.puedeOperar("inv.conteo.cerrar"));
  const puedeVerCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  // Rendimiento
  let prodRendimientoId = $state(
    [...catalogo.productos.values()].find(p => p.receta_id)?.id ?? ""
  );

  const rendimiento = $derived.by(() => {
    if (!prodRendimientoId) return null;
    const mapaInsumos = new Map(inventario.insumos.map((i) => [i.id, i]));
    return calcularRendimiento(prodRendimientoId, catalogo, inventario.existencias, mapaInsumos);
  });

  /*
   * Costeo ideal contra real (F2), sobre la jornada en curso: lo que las recetas
   * dicen que debió salir del almacén contra lo que de verdad salió.
   */
  const rangoJornada = $derived(local.jornadaActual);
  const costeo = $derived(
    costeoIdealReal(
      cuentasCerradasEn(pos.todasLasComandas, rangoJornada),
      inventario.movimientos.filter(
        (m) => m.ts >= rangoJornada.desde && m.ts < rangoJornada.hasta,
      ),
      catalogo,
      inventario.insumos,
    ),
  );

  // Una sola proyección por render: consultarla insumo por insumo la recalcularía
  // entera en cada fila.
  const existencias = $derived(inventario.existencias);
  const cantidadDe = $derived((insumoId: string) => existencias.get(insumoId)?.cantidad ?? 0);

  /** Insumo cuyo historial se está mirando desplegado. Vacío = ninguno. */
  let detalle = $state("");

  /**
   * Cuántos movimientos se listan en la tarjeta antes de pedir «Ver más».
   *
   * Veinticinco cubren un servicio entero; el resto se mira cuando se está
   * aclarando una diferencia, y para eso está la ventana.
   */
  const TOPE_MOVIMIENTOS = 25;
  let verMovimientos = $state(false);

  /** Los últimos movimientos de UN insumo, que es como se aclara una diferencia. */
  function movimientosDe(insumoId: string) {
    return inventario.movimientos
      .filter((m) => m.tipo === "movimiento_inventario" && m.insumo_id === insumoId)
      .slice(0, 15) as Extract<
      (typeof inventario.movimientos)[number],
      { tipo: "movimiento_inventario" }
    >[];
  }

  function registrar() {
    error = "";
    const r = inventario.registrar(
      insumoId,
      Number(cantidad),
      motivo,
      nota,
      sesion.usuarioActual?.id,
    );
    if (!r.ok) {
      error = r.error ?? "No se pudo registrar";
      return;
    }
    cantidad = "";
    nota = "";
    vista = "existencias";
  }

  function cerrarConteo() {
    error = "";
    const lineas = Object.entries(contados)
      .filter(([, valor]) => valor.trim() !== "" && Number.isFinite(Number(valor)))
      .map(([insumo_id, valor]) => ({ insumo_id, contado: Number(valor) }));

    const r = inventario.registrarConteo(lineas, "Conteo cíclico", sesion.usuarioActual?.id);
    if (!r.ok) {
      error = r.error ?? "No se pudo cerrar el conteo";
      return;
    }
    contados = {};
    vista = "existencias";
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Inventario</h1>
      <p class="sub">
        Las existencias se calculan sumando los movimientos: el histórico siempre
        explica el número.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={vista === "existencias"} onclick={() => (vista = "existencias")}>
        Existencias
      </button>
      {#if puedeMerma}
        <button class:on={vista === "movimiento"} onclick={() => (vista = "movimiento")}>
          Registrar movimiento
        </button>
      {/if}
      {#if puedeConteo}
        <button class:on={vista === "conteo"} onclick={() => (vista = "conteo")}>Conteo</button>
      {/if}
      {#if puedeVerCostos}
        <button class:on={vista === "costeo"} onclick={() => (vista = "costeo")}>
          Ideal vs. real
        </button>
      {/if}
      <button class:on={vista === "rendimiento"} onclick={() => (vista = "rendimiento")}>
        Calculadora
      </button>
    </div>
  </div>

  <!-- Indicadores -->
  <div class="indicadores">
    <div class="dato">
      <span class="etiqueta">Valor del inventario</span>
      <b>{mxn(inventario.valor)}</b>
    </div>
    <div class="dato">
      <span class="etiqueta">Merma acumulada</span>
      <b class="alerta">{mxn(inventario.costoMerma)}</b>
    </div>
    <div class="dato">
      <span class="etiqueta">Por reponer</span>
      <b>{inventario.porReponer.length}</b>
    </div>
    {#if inventario.enNegativo.length > 0}
      <div class="dato">
        <span class="etiqueta">En negativo</span>
        <b class="alerta">{inventario.enNegativo.length}</b>
      </div>
    {/if}
  </div>

  {#if inventario.enNegativo.length > 0}
    <p class="aviso">
      Hay insumos con existencia negativa. <b>No se bloquea la venta</b> por esto:
      significa que falta registrar una recepción o hacer un conteo.
    </p>
  {/if}

  {#if vista === "existencias"}
    <section class="tarjeta">
      <!--
        CÓMO SE FUE USANDO CADA INSUMO.

        La tabla ya decía cuánto QUEDA; lo que faltaba era en qué se fue. Las
        tres columnas nuevas separan lo que entró por compra, lo que salió
        vendido —el descuento automático de las recetas— y lo que se tiró. Ese
        contraste es el que enseña un problema: un insumo con mucha merma y poca
        venta está costando dinero sin producirlo.
      -->
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th class="num">Existencia</th>
            <th class="num">Mínimo</th>
            <th class="num">Comprado</th>
            <th class="num">Usado en platillos</th>
            <th class="num">Merma</th>
            <th class="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {#each inventario.insumos as insumo (insumo.id)}
            {@const cant = cantidadDe(insumo.id)}
            {@const bajo = cant < insumo.stock_minimo}
            {@const uso = inventario.consumoDe(insumo.id)}
            {@const abierto = detalle === insumo.id}
            <tr class:bajo class:negativo={cant < 0}>
              <td>
                <button class="abrir-insumo" onclick={() => (detalle = abierto ? "" : insumo.id)}>
                  <b>{insumo.nombre}</b>
                  {#if insumo.categoria}<small>{insumo.categoria}</small>{/if}
                </button>
              </td>
              <td class="num">{formatearCantidad(cant, insumo.unidad_base)}</td>
              <td class="num tenue">{formatearCantidad(insumo.stock_minimo, insumo.unidad_base)}</td>
              <td class="num tenue">
                {uso.recepcion ? formatearCantidad(uso.recepcion, insumo.unidad_base) : "—"}
              </td>
              <td class="num">
                {uso.consumo_receta
                  ? formatearCantidad(uso.consumo_receta, insumo.unidad_base)
                  : "—"}
              </td>
              <td class="num" class:alerta={(uso.merma ?? 0) > 0}>
                {uso.merma ? formatearCantidad(uso.merma, insumo.unidad_base) : "—"}
              </td>
              <td class="num">{mxn(valorDe(insumo, Math.max(0, cant)))}</td>
            </tr>
            {#if abierto}
              <tr class="detalle">
                <td colspan="7">
                  <div class="mov-insumo">
                    <span class="titulo-detalle">
                      Movimientos de {insumo.nombre}
                      · {existencias.get(insumo.id)?.movimientos ?? 0} en total
                    </span>
                    {#each movimientosDe(insumo.id) as mov (mov.id)}
                      <div class="mov {mov.motivo}">
                        <span class="hora">{hora(mov.ts)}</span>
                        <span class="motivo">{etiquetaMotivo(mov.motivo)}</span>
                        <span class="delta" class:resta={mov.delta < 0}>
                          {mov.delta > 0 ? "+" : ""}{formatearCantidad(mov.delta, mov.unidad)}
                        </span>
                      </div>
                    {:else}
                      <p class="vacio">Este insumo todavía no se ha movido.</p>
                    {/each}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
      <p class="pista-tabla">
        Lo <b>usado en platillos</b> lo descuenta el sistema solo, al enviar a
        cocina: sale de la receta de cada platillo y de su gramaje. Un insumo sin
        receta que lo use nunca se moverá por esta vía.
      </p>
    </section>

    {#snippet listaMovimientos(lista: typeof inventario.movimientos)}
      <div class="movimientos">
        {#each lista as mov (mov.id)}
          {#if mov.tipo === "movimiento_inventario"}
            {@const insumo = inventario.insumo(mov.insumo_id)}
            <div class="mov {mov.motivo}">
              <span class="hora">{hora(mov.ts)}</span>
              <span class="nombre">{insumo?.nombre ?? mov.insumo_id}</span>
              <span class="motivo">{etiquetaMotivo(mov.motivo)}</span>
              <span class="delta" class:resta={mov.delta < 0}>
                {mov.delta > 0 ? "+" : ""}{formatearCantidad(mov.delta, mov.unidad)}
              </span>
            </div>
          {:else}
            <div class="mov conteo">
              <span class="hora">{hora(mov.ts)}</span>
              <span class="nombre">Conteo cíclico</span>
              <span class="motivo">{mov.lineas.length} insumos ajustados</span>
              <span class="delta"></span>
            </div>
          {/if}
        {/each}
      </div>
    {/snippet}

    <section class="tarjeta">
      <h2>Últimos movimientos</h2>
      {#if inventario.movimientos.length === 0}
        <p class="vacio">Sin movimientos todavía.</p>
      {:else}
        {@render listaMovimientos(inventario.movimientos.slice(0, TOPE_MOVIMIENTOS))}
        {#if inventario.movimientos.length > TOPE_MOVIMIENTOS}
          <button class="ver-todo" onclick={() => (verMovimientos = true)}>
            Ver más ({inventario.movimientos.length - TOPE_MOVIMIENTOS} movimientos más)
          </button>
        {/if}
      {/if}
    </section>

    {#if verMovimientos}
      <VentanaAmplia
        titulo="Movimientos de inventario"
        subtitulo="{inventario.movimientos.length} movimientos registrados, del más reciente al más antiguo"
        onCerrar={() => (verMovimientos = false)}
      >
        {@render listaMovimientos(inventario.movimientos)}
      </VentanaAmplia>
    {/if}
  {:else if vista === "movimiento"}
    <section class="tarjeta">
      <h2>Registrar movimiento</h2>
      <div class="campos">
        <label>
          <span>Insumo</span>
          <select bind:value={insumoId}>
            {#each inventario.insumos as insumo (insumo.id)}
              <option value={insumo.id}>{insumo.nombre}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Motivo</span>
          <select bind:value={motivo}>
            {#each MOTIVOS_MANUALES as m (m.valor)}
              <option value={m.valor}>{m.etiqueta}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Cantidad ({inventario.insumo(insumoId)?.unidad_base ?? ""})</span>
          <input type="number" inputmode="decimal" bind:value={cantidad} placeholder="0" />
        </label>
        <label class="ancho">
          <span>Nota</span>
          <input bind:value={nota} placeholder="Producto vencido, se cayó, ajuste…" />
        </label>
      </div>
      <p class="pista">
        El signo lo decide el motivo: merma, traspaso y devolución restan aunque
        captures la cantidad en positivo. Solo el <b>ajuste por conteo</b> respeta
        el signo que escribas, porque puede corregir en las dos direcciones.
      </p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="botones">
        <button class="secundario" onclick={() => (vista = "existencias")}>Cancelar</button>
        <button class="principal" onclick={registrar}>Registrar</button>
      </div>
    </section>
  {:else if vista === "costeo"}
    <!--
      Costeo ideal contra real (F2). Distinto del centinela: aquel mira lo que
      alguien REGISTRÓ como merma; esto compara contra la RECETA y saca el
      consumo que nadie declaró.
    -->
    <section class="tarjeta">
      <div class="encabezado">
        <div>
          <h2>Lo que debió salir contra lo que salió</h2>
          <p class="pista">
            Si se vendieron 40 pizzas de 200 g de masa, debieron salir 8 kg. Lo
            que salga de más es producto que se fue sin venderse y sin que nadie
            lo anotara.
          </p>
        </div>
        <div class="dato">
          <span class="etiqueta">Desviación</span>
          <b class:alerta={costeo.desviacion > 0}>{mxn(costeo.desviacion)}</b>
        </div>
      </div>

      {#if costeo.sin_datos}
        <p class="vacio">
          Todavía no hay ventas de productos con receta en esta jornada. Sin
          recetas no hay contra qué comparar.
        </p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Insumo</th>
              <th class="num">Debió salir</th>
              <th class="num">Salió</th>
              <th class="num">Diferencia</th>
              <th class="num">%</th>
              <th>Qué mirar</th>
            </tr>
          </thead>
          <tbody>
            {#each costeo.insumos as v (v.insumo_id)}
              {@const insumo = inventario.insumo(v.insumo_id)}
              <tr>
                <td><b>{v.nombre}</b></td>
                <td class="num tenue">{formatearCantidad(v.ideal, insumo?.unidad_base ?? "pz")}</td>
                <td class="num">{formatearCantidad(v.real, insumo?.unidad_base ?? "pz")}</td>
                <td class="num" class:alerta={seDesvia(v)}>
                  {v.varianza > 0 ? "+" : ""}{formatearCantidad(v.varianza, insumo?.unidad_base ?? "pz")}
                  <small>{mxn(v.costo_varianza)}</small>
                </td>
                <td class="num" class:alerta={seDesvia(v)}>{pct(v.tasa)}</td>
                <td class="explica">{explicarVarianza(v)}</td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!--
          El límite del cálculo, dicho siempre: un food cost «bajo control»
          calculado sobre media carta no vale nada.
        -->
        {#if costeo.productos_sin_receta > 0}
          <p class="aviso">
            <b>Esto no mide toda la carta.</b>
            {costeo.productos_sin_receta}
            {costeo.productos_sin_receta === 1 ? "producto vendido no tiene" : "productos vendidos no tienen"}
            receta, así que su consumo no se puede comparar. Captura sus
            ingredientes para que entren aquí.
          </p>
        {/if}
      {/if}
    </section>
  {:else if vista === "conteo"}
    <section class="tarjeta">
      <h2>Conteo cíclico</h2>
      <p class="pista">
        Captura lo que contaste físicamente. Lo que dejes en blanco no se toca.
        El conteo <b>fija</b> la existencia; la diferencia queda registrada.
      </p>
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th>Sistema</th>
            <th>Contado</th>
            <th>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {#each inventario.insumos as insumo (insumo.id)}
            {@const esperado = cantidadDe(insumo.id)}
            {@const texto = contados[insumo.id] ?? ""}
            {@const dif = texto === "" ? null : Number(texto) - esperado}
            <tr>
              <td><b>{insumo.nombre}</b></td>
              <td class="num tenue">{formatearCantidad(esperado, insumo.unidad_base)}</td>
              <td class="num">
                <input
                  class="conteo-input"
                  type="number"
                  inputmode="decimal"
                  value={texto}
                  oninput={(e) => (contados = { ...contados, [insumo.id]: e.currentTarget.value })}
                  placeholder="—"
                />
              </td>
              <td class="num" class:alerta={dif !== null && dif !== 0}>
                {dif === null ? "" : formatearCantidad(dif, insumo.unidad_base)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="botones">
        <button class="secundario" onclick={() => { contados = {}; vista = "existencias"; }}>
          Cancelar
        </button>
        <button class="principal" onclick={cerrarConteo}>Cerrar conteo</button>
      </div>
    </section>
  {:else if vista === "rendimiento"}
    <section class="tarjeta">
      <div class="encabezado">
        <div>
          <h2>Calculadora de rendimiento</h2>
          <p class="pista">
            Calcula cuántas unidades de un producto puedes preparar con el almacén actual.
            Identifica qué ingrediente te limita para saber qué necesitas comprar.
          </p>
        </div>
      </div>
      
      <div class="campos" style="margin-top: 1rem; margin-bottom: 1.5rem;">
        <label class="ancho">
          <span>Producto</span>
          <select bind:value={prodRendimientoId}>
            {#each [...catalogo.productos.values()].filter(p => p.receta_id) as p (p.id)}
              <option value={p.id}>{p.nombre}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if prodRendimientoId && rendimiento}
        <div class="rendimiento-resultado">
          <div class="dato-grande">
            <span>Salen aprox.</span>
            <b>{rendimiento.piezas}</b>
            <span class="unidades">unidades</span>
          </div>
          
          <div class="limitante">
            <span class="etiqueta">Insumo limitante (topa la producción):</span>
            <b>{inventario.insumo(rendimiento.insumo_limitante_id)?.nombre ?? rendimiento.insumo_limitante_id}</b>
          </div>
        </div>
      {:else if prodRendimientoId}
        <p class="vacio">No hay existencias suficientes o el producto no requiere insumos inventariables.</p>
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
    max-width: 66rem;
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
    font-size: 0.9rem;
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
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
  }
  .pestanas button.on {
    background: var(--acento);
    color: #fff;
  }
  .indicadores {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .dato {
    flex: 1;
    min-width: 10rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
  }
  .etiqueta {
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .dato b {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    margin-top: 0.2rem;
  }
  .alerta {
    color: var(--peligro);
  }
  .aviso {
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    font-size: 0.86rem;
    line-height: 1.5;
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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th:not(:first-child) {
    text-align: right;
  }
  td {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .tenue {
    color: var(--gris);
  }
  tr.bajo .num:first-of-type {
    color: var(--acento);
    font-weight: 700;
  }
  tr.negativo .num:first-of-type {
    color: var(--peligro);
    font-weight: 700;
  }
  .conteo-input {
    width: 6rem;
    padding: 0.35rem 0.5rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.88rem;
    font-family: var(--font-cuerpo);
    text-align: right;
  }
  .conteo-input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .movimientos {
    display: flex;
    flex-direction: column;
  }
  .mov {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.86rem;
  }
  .mov .hora {
    font-family: var(--font-titulo);
    font-size: 0.78rem;
    color: var(--gris);
    width: 3rem;
    flex: none;
  }
  .mov .nombre {
    flex: 1;
    font-weight: 600;
  }
  .mov .motivo {
    color: var(--gris);
    font-size: 0.8rem;
  }
  .mov .delta {
    font-weight: 700;
    white-space: nowrap;
    min-width: 5rem;
    text-align: right;
    color: #6b8f57;
  }
  .mov .delta.resta {
    color: var(--peligro);
  }
  .mov.merma .nombre {
    color: var(--peligro);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 11rem;
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
  .campos input,
  .campos select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    margin-top: 0.75rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    margin-top: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
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
    padding: 0.65rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .explica {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.4;
    max-width: 22rem;
    white-space: normal;
  }
  td small {
    display: block;
    font-size: 0.72rem;
    color: var(--gris);
  }
  .encabezado .dato {
    flex: none;
    min-width: 9rem;
  }
  .rendimiento-resultado {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
    align-items: center;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 1.5rem;
  }
  .dato-grande {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .dato-grande span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .dato-grande b {
    font-family: var(--font-titulo);
    font-size: 3rem;
    line-height: 1;
    color: var(--acento);
    margin: 0.2rem 0;
  }
  .dato-grande .unidades {
    font-size: 0.85rem;
    color: var(--pizarra);
    text-transform: none;
    letter-spacing: normal;
  }
  .limitante {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .limitante b {
    font-size: 1.15rem;
    color: var(--peligro);
  }
</style>
