<script lang="ts">
  /**
   * Resultado del día y captura de egresos (M5).
   *
   * La pregunta que responde: **¿ganamos dinero hoy?** No es un estado de
   * resultados de contador; son tres cifras que un restaurantero puede leer de
   * un vistazo antes de cerrar.
   *
   * Ojo con la línea de compras: aparece aparte y NO se resta. El costo de lo
   * vendido ya viene de las recetas, y restar además la compra de insumos haría
   * que un día de surtido apareciera en pérdida.
   */
  import {
    CATEGORIAS_EGRESO,
    cuentasCerradasEn,
    diaDe,
    pesos,
    resumenVentas,
    type CategoriaEgreso,
  } from "@motrest/dominio";
  import { egresos } from "../../egresos.svelte";
  import { pos } from "../../pos.svelte";
  import { mxn, hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeRegistrar = $derived(sesion.puedeOperar("fin.egreso.registrar"));
  const puedeVerCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  const rango = $derived(diaDe(Date.now()));
  // Solo las cuentas CERRADAS del día: una mesa abierta todavía no es venta.
  const ventas = $derived(resumenVentas(cuentasCerradasEn(pos.todasLasComandas, rango)));
  const resultado = $derived(egresos.resultado(ventas, rango));
  const delDia = $derived(egresos.del(rango));

  // --- Captura ---
  let abierto = $state(false);
  let categoria = $state<CategoriaEgreso>("servicios");
  let concepto = $state("");
  let montoTexto = $state("");
  let formaPago = $state("efectivo");
  let proveedor = $state("");
  let error = $state("");

  const categoriaElegida = $derived(CATEGORIAS_EGRESO.find((c) => c.id === categoria));

  function limpiar() {
    concepto = "";
    montoTexto = "";
    proveedor = "";
    error = "";
  }

  function guardar() {
    const monto = pesos(Number(montoTexto) || 0);
    egresos.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    const r = egresos.registrar({
      categoria,
      concepto,
      monto,
      forma_pago: formaPago,
      proveedor,
    });
    if (r.ok) {
      limpiar();
      abierto = false;
    } else {
      error = r.error;
    }
  }

  function anular(id: string) {
    const motivo = prompt("¿Por qué se anula este egreso?");
    if (!motivo) return;
    egresos.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    egresos.anular(id, motivo, sesion.usuarioActual?.id);
  }
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Resultado de hoy</h2>
    {#if puedeRegistrar}
      <button class="mini" onclick={() => (abierto = !abierto)}>
        {abierto ? "Cerrar" : "Registrar gasto"}
      </button>
    {/if}
  </div>

  {#if puedeVerCostos}
    <div class="cifras">
      <div>
        <span>Venta (sin IVA)</span>
        <b>{mxn(resultado.ingreso)}</b>
      </div>
      <div>
        <span>Costo de lo vendido</span>
        <b class="resta">−{mxn(resultado.costo)}</b>
      </div>
      <div>
        <span>Margen bruto</span>
        <b>{mxn(resultado.margen_bruto)}</b>
      </div>
      <div>
        <span>Gastos de operación</span>
        <b class="resta">−{mxn(resultado.egresos_operativos)}</b>
      </div>
      <div class="destacado" class:perdida={resultado.resultado < 0}>
        <span>{resultado.resultado < 0 ? "Pérdida" : "Resultado"}</span>
        <b>{mxn(resultado.resultado)}</b>
      </div>
    </div>

    <p class="nota">
      Food cost {(resultado.food_cost * 100).toFixed(1)} %.
      {#if resultado.compras > 0}
        Además salieron <b>{mxn(resultado.compras)}</b> en compra de insumos: no se
        restan aquí porque su costo llega cuando se venden, pero sí salieron del cajón.
      {/if}
    </p>
  {:else}
    <p class="nota">
      Los importes de costo y resultado están reservados a perfiles con permiso
      para verlos.
    </p>
  {/if}
</section>

{#if abierto && puedeRegistrar}
  <section class="tarjeta">
    <h2>Registrar un gasto</h2>
    <div class="campos">
      <label>
        <span>Categoría</span>
        <select bind:value={categoria}>
          {#each CATEGORIAS_EGRESO as c (c.id)}
            <option value={c.id}>{c.nombre}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Monto</span>
        <input bind:value={montoTexto} inputmode="decimal" placeholder="0.00" />
      </label>
      <label class="ancho">
        <span>Concepto</span>
        <input bind:value={concepto} placeholder="Recibo de luz de julio" />
      </label>
      <label>
        <span>Forma de pago</span>
        <select bind:value={formaPago}>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
        </select>
      </label>
      <label>
        <span>Proveedor (opcional)</span>
        <input bind:value={proveedor} placeholder="CFE" />
      </label>
    </div>

    {#if categoriaElegida && !categoriaElegida.afectaResultado}
      <p class="aviso-cat">
        {categoriaElegida.descripcion}
      </p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => { abierto = false; limpiar(); }}>Cancelar</button>
      <button class="principal" onclick={guardar}>Guardar gasto</button>
    </div>
  </section>
{/if}

{#if delDia.length > 0}
  <section class="tarjeta">
    <h2>Gastos de hoy</h2>
    <table>
      <thead>
        <tr><th>Hora</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th><th></th></tr>
      </thead>
      <tbody>
        {#each delDia as e (e.egreso_id)}
          <tr>
            <td>{hora(e.ts)}</td>
            <td>
              {e.concepto}
              {#if e.proveedor}<small> · {e.proveedor}</small>{/if}
            </td>
            <td>{CATEGORIAS_EGRESO.find((c) => c.id === e.categoria)?.nombre}</td>
            <td class="num">{mxn(e.monto)}</td>
            <td>
              {#if puedeRegistrar}
                <button class="mini" onclick={() => anular(e.egreso_id)}>Anular</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .tarjeta {
    background: var(--superficie);
    border: 1px solid var(--borde);
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .cabecera-tarjeta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 650;
  }

  .cifras {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cifras div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .cifras span {
    font-size: 0.88rem;
    color: var(--gris);
  }
  .cifras b {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }
  .resta {
    color: var(--gris);
  }
  /* El resultado es lo que se mira primero: se separa y se agranda. */
  .destacado {
    border-top: 1.5px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.3rem;
  }
  .destacado b {
    font-size: 1.35rem;
    font-family: var(--font-titulo);
    color: #57ad30;
  }
  .destacado.perdida b {
    color: #e0392b;
  }

  .nota {
    margin-top: 0.9rem;
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .aviso-cat {
    margin-top: 0.7rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: var(--claro);
    font-size: 0.83rem;
    line-height: 1.45;
  }

  .campos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.85rem;
  }
  .campos .ancho {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: 8px;
    font: inherit;
  }

  .error {
    margin-top: 0.7rem;
    color: #e0392b;
    font-size: 0.86rem;
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1px solid var(--borde);
    background: #fff;
    color: inherit;
    padding: 0.5rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .mini {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    padding-bottom: 0.5rem;
  }
  td {
    padding: 0.5rem 0.5rem 0.5rem 0;
    border-top: 1px solid var(--borde);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td small {
    color: var(--gris);
  }
</style>
