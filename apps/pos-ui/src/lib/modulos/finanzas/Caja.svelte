<script lang="ts">
  /**
   * Corte de caja (M1) — apertura del turno, movimientos de efectivo y arqueo
   * sellado.
   *
   * El arqueo compara el efectivo que DEBERÍA haber en el cajón (fondo + ventas
   * en efectivo ± retiros) contra lo que el cajero contó. La diferencia se sella
   * e imprime: un corte sin sello es una hoja que cualquiera puede rehacer.
   */
  import { pesos, sumar, type MotivoMovimientoCaja } from "@motrest/dominio";
  import { caja } from "../../caja.svelte";
  import { impresion } from "../../impresion.svelte";
  import { mxn, hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeAbrir = $derived(sesion.puedeOperar("caja.sesion.abrir"));
  const puedeMover = $derived(sesion.puedeOperar("caja.retiro.registrar"));
  const puedeSellar = $derived(sesion.puedeOperar("caja.corte.sellar"));
  const puedeVerArqueos = $derived(sesion.puedeVer("caja.arqueo.ver"));

  const activa = $derived(caja.activa);
  const corte = $derived(caja.corteEnVivo);
  const cerradas = $derived(caja.sesiones.filter((s) => s.cerrada));

  let error = $state("");

  // --- Abrir turno ---
  let fondoTexto = $state("");

  function abrir() {
    error = "";
    const usuario = sesion.usuarioActual;
    if (!usuario) { error = "Inicia sesión para abrir la caja"; return; }
    const r = caja.abrir(usuario.id, pesos(Number(fondoTexto) || 0));
    if (!r.ok) { error = r.error ?? ""; return; }
    fondoTexto = "";
  }

  // --- Movimiento de efectivo ---
  let movAbierto = $state(false);
  let movMotivo = $state<MotivoMovimientoCaja>("retiro");
  let movMonto = $state("");
  let movConcepto = $state("");

  function registrarMovimiento() {
    error = "";
    const r = caja.movimiento(
      movMotivo,
      pesos(Number(movMonto) || 0),
      movConcepto,
      sesion.usuarioActual?.id,
    );
    if (!r.ok) { error = r.error ?? ""; return; }
    movMonto = "";
    movConcepto = "";
    movAbierto = false;
  }

  // --- Cierre / arqueo ---
  let cerrando = $state(false);
  let declaradoTexto = $state("");

  /** Propina que NO llegó en efectivo: el local se la debe al mesero. */
  const propinaEnPlastico = $derived(
    sumar(
      ...Object.entries(corte?.propinasPorForma ?? {})
        .filter(([forma]) => forma !== "efectivo")
        .map(([, monto]) => monto ?? pesos(0)),
    ),
  );

  const declarado = $derived(pesos(Number(declaradoTexto) || 0));
  const diferenciaPrevia = $derived(
    corte ? (declarado - corte.efectivoEsperado) : 0,
  );

  async function cerrar() {
    error = "";
    const nombre = sesion.usuarioActual?.nombre ?? "Cajero";
    const r = await caja.cerrar(declarado, nombre);
    if (!r.ok) { error = r.error ?? ""; return; }
    cerrando = false;
    declaradoTexto = "";
  }

  function etiquetaDif(dif: number): string {
    return dif === 0 ? "Cuadra" : dif > 0 ? "Sobrante" : "Faltante";
  }
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Corte de caja</h2>
    {#if activa}
      <span class="turno">Turno abierto · {hora(activa.abierta_ts)}</span>
    {/if}
  </div>

  {#if !activa}
    <p class="nota">
      No hay ningún turno abierto. Abre la caja con el efectivo del fondo para
      empezar a cobrar y poder cerrar el corte al final.
    </p>
    {#if puedeAbrir}
      <div class="fila">
        <label>
          <span>Fondo inicial</span>
          <input bind:value={fondoTexto} inputmode="decimal" placeholder="0.00" />
        </label>
        <button class="principal" onclick={abrir}>Abrir caja</button>
      </div>
    {:else}
      <p class="nota">Tu perfil no puede abrir la caja.</p>
    {/if}
  {:else if corte}
    <!-- Corte en vivo del turno abierto -->
    <!--
      Se muestra lo COBRADO por forma —lo que de verdad entró por cada canal— y
      abajo, desglosado, cuánto de eso fue venta y cuánto propina. Quien cierra
      la caja puede sumar los renglones con el dedo y ver que cuadran; un
      "total vendido" que no coincide con la suma de arriba destruye la
      confianza en los tres números a la vez.
    -->
    <div class="cifras">
      <div><span>Fondo inicial</span><b>{mxn(corte.fondoInicial)}</b></div>
      {#each Object.entries(corte.cobrado) as [forma, monto] (forma)}
        <div><span>Cobrado · {forma}</span><b>{mxn(monto ?? pesos(0))}</b></div>
      {/each}
      {#if corte.movimientos !== 0}
        <div>
          <span>Entradas y retiros</span>
          <b class:resta={corte.movimientos < 0}>{mxn(corte.movimientos)}</b>
        </div>
      {/if}
      <!--
        Las devoluciones se enseñan con su propio renglón y no escondidas dentro
        del «cobrado». Quien cuenta el cajón va a encontrar menos dinero del que
        dicen las ventas del día, y esta línea es la que se lo explica antes de
        que empiece a buscar un faltante que no existe.
      -->
      {#if corte.devoluciones > 0}
        <div>
          <span>
            Devuelto por {corte.ventasCanceladas}
            {corte.ventasCanceladas === 1 ? "venta cancelada" : "ventas canceladas"}
          </span>
          <b class="resta">−{mxn(corte.devoluciones)}</b>
        </div>
      {/if}
      <div class="destacado">
        <span>Efectivo esperado en el cajón</span>
        <b>{mxn(corte.efectivoEsperado)}</b>
      </div>
    </div>

    <div class="cifras desglose">
      <div><span>De eso, venta del restaurante</span><b>{mxn(corte.totalVendido)}</b></div>
      {#if corte.propinas > 0}
        <div><span>De eso, propina del personal</span><b>{mxn(corte.propinas)}</b></div>
        {#if propinaEnPlastico > 0}
          <!--
            La propina que llegó con tarjeta no está en el cajón como propina:
            entró revuelta con la venta y el restaurante se la debe al mesero en
            efectivo. Es de las diferencias que más se discuten al cerrar.
          -->
          <div class="aviso">
            <span>Propina cobrada con tarjeta o transferencia</span>
            <b>{mxn(propinaEnPlastico)}</b>
          </div>
        {/if}
      {/if}
    </div>

    <p class="nota">
      {corte.cuentasCerradas} cuentas cerradas. Solo el <b>efectivo</b> llega al
      cajón: las tarjetas y transferencias no se cuentan en el arqueo.
      {#if propinaEnPlastico > 0}
        Los {mxn(propinaEnPlastico)} de propina con tarjeta salen del efectivo al
        pagarle al personal.
      {/if}
    </p>

    <div class="acciones">
      {#if puedeMover}
        <button class="secundario" onclick={() => (movAbierto = !movAbierto)}>
          {movAbierto ? "Cancelar movimiento" : "Retiro o ingreso"}
        </button>
      {/if}
      {#if puedeSellar}
        <button class="principal" onclick={() => (cerrando = !cerrando)}>
          {cerrando ? "Cancelar cierre" : "Cerrar turno y sellar corte"}
        </button>
      {/if}
    </div>

    {#if movAbierto && puedeMover}
      <div class="panel">
        <div class="fila">
          <label>
            <span>Tipo</span>
            <select bind:value={movMotivo}>
              <option value="retiro">Retiro (sale del cajón)</option>
              <option value="ingreso">Ingreso (entra al cajón)</option>
            </select>
          </label>
          <label>
            <span>Monto</span>
            <input bind:value={movMonto} inputmode="decimal" placeholder="0.00" />
          </label>
          <label class="ancho">
            <span>Concepto</span>
            <input bind:value={movConcepto} placeholder="A la caja fuerte, pago de contado…" />
          </label>
        </div>
        <div class="botones">
          <button class="principal" onclick={registrarMovimiento}>Registrar movimiento</button>
        </div>
      </div>
    {/if}

    {#if cerrando && puedeSellar}
      <div class="panel">
        <h3>Arqueo</h3>
        <p class="nota">
          Cuenta el efectivo del cajón y captúralo. El corte se sella con esta
          cifra: una vez cerrado, no se reabre.
        </p>
        <div class="fila">
          <label>
            <span>Efectivo contado</span>
            <input bind:value={declaradoTexto} inputmode="decimal" placeholder="0.00" />
          </label>
          <div class="dif {etiquetaDif(diferenciaPrevia).toLowerCase()}">
            <span>{etiquetaDif(diferenciaPrevia)}</span>
            <b>{mxn(Math.abs(diferenciaPrevia) as typeof declarado)}</b>
          </div>
        </div>
        <div class="botones">
          <button class="principal" onclick={cerrar}>Sellar e imprimir corte</button>
        </div>
      </div>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

{#if puedeVerArqueos && cerradas.length > 0}
  <section class="tarjeta">
    <h2>Cortes anteriores</h2>
    <table>
      <thead>
        <tr>
          <th>Cierre</th><th>Cajero</th><th class="num">Vendido</th>
          <th class="num">Esperado</th><th class="num">Diferencia</th><th>Sello</th>
        </tr>
      </thead>
      <tbody>
        {#each cerradas as s (s.sesion_id)}
          {#if s.resumen}
            <tr>
              <td>{s.cerrada_ts ? hora(s.cerrada_ts) : "—"}</td>
              <td>{s.cajero_id}</td>
              <td class="num">{mxn(s.resumen.total_vendido)}</td>
              <td class="num">{mxn(s.resumen.efectivo_esperado)}</td>
              <td class="num" class:alerta={s.resumen.diferencia !== 0}>
                {mxn(s.resumen.diferencia)}
              </td>
              <td class="sello">{s.sello}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<!-- Vista previa del corte impreso (hace de papel si no hay impresora) -->
{#if impresion.vistaPrevia}
  <div class="velo" role="presentation" onclick={() => impresion.cerrarVista()}></div>
  <div class="previa" role="dialog" aria-label="Vista previa del corte">
    <header>
      <b>{impresion.vistaPrevia.titulo}</b>
      <button class="cerrar" onclick={() => impresion.cerrarVista()} aria-label="Cerrar">✕</button>
    </header>
    <pre>{impresion.vistaPrevia.texto}</pre>
  </div>
{/if}

<style>
  .tarjeta {
    background: var(--superficie, #fff);
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
  h3 {
    font-size: 0.95rem;
    font-weight: 650;
    margin-bottom: 0.3rem;
  }
  .turno {
    font-size: 0.8rem;
    font-weight: 600;
    color: #3f6b2c;
    background: #eef7e8;
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
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
    color: var(--peligro);
  }
  /* El desglose de lo cobrado: qué fue venta y qué fue propina. */
  .desglose {
    margin-top: 0.75rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-sm);
    background: var(--fondo);
  }
  .desglose .aviso span,
  .desglose .aviso b {
    color: var(--acento);
  }
  .destacado {
    border-top: 1.5px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.3rem;
  }
  .destacado b {
    font-size: 1.3rem;
    font-family: var(--font-titulo);
    color: var(--acento);
  }
  .nota {
    margin-top: 0.8rem;
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .fila {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
    margin-top: 0.9rem;
  }
  .fila label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .fila label.ancho {
    flex-basis: 100%;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
    background: #fff;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .acciones {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .panel {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--borde);
  }
  .dif {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    min-width: 8rem;
    padding: 0.3rem 0.8rem;
    border-radius: 8px;
    background: var(--fondo);
  }
  .dif span {
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .dif b {
    font-variant-numeric: tabular-nums;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .dif.cuadra {
    background: #eef7e8;
  }
  .dif.cuadra b {
    color: #3f6b2c;
  }
  .dif.faltante b,
  .dif.sobrante b {
    color: var(--peligro);
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
    border: 1.5px solid var(--borde);
    background: #fff;
    color: inherit;
    padding: 0.6rem 1.1rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .secundario {
    color: var(--pizarra);
  }
  .error {
    margin-top: 0.8rem;
    color: var(--peligro);
    font-size: 0.86rem;
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num {
    text-align: right;
  }
  td {
    padding: 0.5rem 0.5rem 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .alerta {
    color: var(--peligro);
    font-weight: 700;
  }
  .sello {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .previa {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-lg, 12px);
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg, 0 20px 60px rgba(0, 0, 0, 0.3));
    overflow: hidden;
  }
  .previa header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.1rem;
    border-bottom: 1px solid var(--borde);
  }
  .cerrar {
    border: none;
    font-size: 1.1rem;
    color: var(--gris);
    padding: 0.2rem 0.5rem;
  }
  .previa pre {
    margin: 0;
    padding: 1rem 1.2rem;
    overflow: auto;
    font-size: 0.78rem;
    line-height: 1.45;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    white-space: pre;
    color: var(--pizarra);
  }
</style>
