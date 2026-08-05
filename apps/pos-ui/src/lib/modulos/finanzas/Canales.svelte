<script lang="ts">
  /**
   * Canales de venta: qué deja cada plataforma y cuánto te deben.
   *
   * Es el reporte que hoy no existe en ningún lado. Sin él, un restaurante ve
   * que "Rappi factura mucho" y no ve que después de la comisión deja menos que
   * el salón — porque la comisión nunca aparece junta en ninguna pantalla.
   *
   * Y la columna de lo que deben las plataformas es la que permite reclamar: hoy
   * depositan con retraso y con descuentos que nadie revisa, no por descuido
   * sino porque no hay contra qué compararlos.
   */
  import { CANALES } from "@motrest/dominio";
  import { canales } from "../../canales.svelte";
  import { mxn, pct } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("fin.egreso.registrar"));
  const puedeVer = $derived(sesion.puedeVer("fin.corte.ver"));

  const agregadores = $derived(CANALES.filter((c) => c.esAgregador));

  function cambiarComision(canal: string, valor: string) {
    const pct = Number(valor);
    if (!Number.isFinite(pct)) return;
    canales.actualizar(canal as never, { comision: Math.max(0, Math.min(100, pct)) / 100 });
  }

  function cambiarDias(canal: string, valor: string) {
    const dias = Number(valor);
    if (!Number.isFinite(dias)) return;
    canales.actualizar(canal as never, { dias_deposito: Math.max(0, Math.round(dias)) });
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Canales de venta</h1>
      <p class="sub">
        Lo que entra por el salón y lo que entra por las apps, con la comisión
        aparte. Es lo que decide si un agregador conviene.
      </p>
    </div>
  </div>

  {#if !puedeVer}
    <p class="nota">Tu perfil no puede consultar las ventas.</p>
  {:else}
    <!-- Configuración -->
    <section class="tarjeta">
      <h2>Con qué plataformas trabajas</h2>
      <p class="nota">
        La comisión que pongas es la que se <b>congela</b> en cada venta. Si
        renegocias, lo vendido antes sigue contando la de entonces — el reporte
        del mes pasado no puede cambiar porque hoy firmaste otro contrato.
      </p>

      {#each agregadores as a (a.canal)}
        {@const cfg = canales.config.find((c) => c.canal === a.canal)}
        <article class="canal" class:on={cfg?.activo}>
          <div class="datos">
            <b>{a.etiqueta}</b>
            <span>Comisión de lista ≈ {pct(a.comisionSugerida)}</span>
          </div>

          {#if cfg?.activo && puedeEditar}
            <label class="mini-campo">
              <span>Comisión %</span>
              <input
                type="number" min="0" max="100" step="0.5"
                value={((cfg?.comision ?? 0) * 100).toFixed(1)}
                onchange={(e) => cambiarComision(a.canal, e.currentTarget.value)}
              />
            </label>
            <label class="mini-campo">
              <span>Depositan en</span>
              <input
                type="number" min="0" max="60"
                value={cfg?.dias_deposito ?? 7}
                onchange={(e) => cambiarDias(a.canal, e.currentTarget.value)}
              />
            </label>
          {/if}

          {#if puedeEditar}
            <button class="interruptor" onclick={() => canales.alternar(a.canal)}>
              {cfg?.activo ? "Activo" : "Apagado"}
            </button>
          {/if}
        </article>
      {/each}
    </section>

    <!-- Lo que deja cada canal -->
    <section class="tarjeta">
      <h2>Qué deja cada canal</h2>
      {#if canales.resumen.length === 0}
        <p class="nota">Todavía no hay ventas cerradas que reportar.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Canal</th>
              <th class="n">Cuentas</th>
              <th class="n">Vendido</th>
              <th class="n">Comisión</th>
              <th class="n">Te queda</th>
            </tr>
          </thead>
          <tbody>
            {#each canales.resumen as r (r.canal)}
              <tr>
                <td>{r.etiqueta}</td>
                <td class="n">{r.cuentas}</td>
                <td class="n">{mxn(r.bruto)}</td>
                <td class="n resta">{r.comision > 0 ? `−${mxn(r.comision)}` : "—"}</td>
                <td class="n fuerte">{mxn(r.neto)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <!-- Lo que deben -->
    {#if canales.porCobrar.length > 0}
      <section class="tarjeta">
        <h2>Lo que te deben las plataformas</h2>
        <p class="nota">
          Ventas cobradas por la app que todavía no te depositan, ya sin su
          comisión. Lo <b>vencido</b> es lo que ya debió haber llegado según el
          plazo que pusiste arriba.
        </p>
        <table>
          <thead>
            <tr>
              <th>Plataforma</th>
              <th class="n">Pedidos</th>
              <th class="n">Te deben</th>
              <th class="n">Vencido</th>
            </tr>
          </thead>
          <tbody>
            {#each canales.porCobrar as d (d.canal)}
              <tr>
                <td>{d.etiqueta}</td>
                <td class="n">{d.cuentas}</td>
                <td class="n fuerte">{mxn(d.neto)}</td>
                <td class="n" class:alerta={d.vencido > 0}>
                  {d.vencido > 0 ? mxn(d.vencido) : "—"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}
  {/if}
</div>

<style>
  .seccion {
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .encabezado {
    margin-bottom: 1.1rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.55rem;
    font-weight: 700;
  }
  .sub {
    font-size: 0.88rem;
    color: var(--gris);
    margin-top: 0.25rem;
    max-width: 44rem;
    line-height: 1.5;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    margin-bottom: 1rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .nota {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.55;
    margin-bottom: 0.9rem;
    max-width: 46rem;
  }
  .canal {
    display: flex;
    align-items: flex-end;
    gap: 0.9rem;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 0.45rem;
    opacity: 0.65;
  }
  .canal.on {
    opacity: 1;
    border-color: var(--acento);
  }
  .canal .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .canal b {
    font-size: 0.95rem;
  }
  .canal span {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .mini-campo {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .mini-campo span {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--gris);
  }
  .mini-campo input {
    width: 5.5rem;
    padding: 0.4rem 0.5rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.88rem;
  }
  .interruptor {
    padding: 0.4rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    background: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .canal.on .interruptor {
    border-color: var(--acento);
    color: var(--acento);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--borde);
  }
  td {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .n {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .fuerte {
    font-weight: 700;
  }
  .resta {
    color: var(--peligro);
  }
  .alerta {
    color: var(--peligro);
    font-weight: 700;
  }
</style>
