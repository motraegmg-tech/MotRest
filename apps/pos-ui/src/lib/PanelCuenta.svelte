<script lang="ts">
  import {
    CERO,
    FORMAS_PAGO,
    importeRenglon,
    pesos,
    repartir,
    restar,
    sumar,
    type FormaPago,
  } from "@motrest/dominio";
  import DialogoFactura from "./DialogoFactura.svelte";
  import { hora, mxn } from "./formato";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  let facturando = $state(false);

  const etiquetaEstado: Record<string, string> = {
    enviado: "en cocina",
    en_marcha: "preparando",
    listo: "listo",
    entregado: "entregado",
  };

  type Vista = "cuenta" | "cobro" | "traspaso";
  let vista = $state<Vista>("cuenta");
  let formaPago = $state<FormaPago>("efectivo");
  let recibido = $state("");
  let partes = $state(2);
  let renglonATraspasar = $state<string | null>(null);

  const t = $derived(pos.totales);
  const recibidoCentavos = $derived(pesos(Number(recibido) || 0));
  const cambio = $derived(
    t && recibidoCentavos > t.saldo ? restar(recibidoCentavos, t.saldo) : CERO,
  );

  async function cobrarAhora() {
    if (!t) return;
    const esEfectivo = formaPago === "efectivo";
    await pos.cobrar(formaPago, t.saldo, esEfectivo && recibidoCentavos > 0 ? recibidoCentavos : undefined);
    recibido = "";
    vista = "cuenta";
  }

  async function dividir() {
    await pos.dividirEnPartes(partes, formaPago);
    vista = "cuenta";
  }

  async function traspasar(mesaId: string) {
    if (!renglonATraspasar) return;
    await pos.traspasarRenglon(renglonATraspasar, mesaId);
    renglonATraspasar = null;
    vista = "cuenta";
  }
</script>

<aside class="cuenta">
  {#if pos.comanda && pos.comandaAbierta && t}
    <div class="ch">
      <h2>Mesa {pos.nombreMesaActiva}</h2>
      {#if pos.enviadaACocina}
        <span class="chip cocina">En cocina</span>
      {:else}
        <span class="chip gray">Abierta</span>
      {/if}
    </div>
    <div class="sub">
      {sesion.nombreDe(pos.comanda.mesero_id)} · abierta {hora(pos.comanda.abierta_ts)}
    </div>

    {#if vista === "cuenta"}
      <div class="items">
        {#if pos.renglones.length === 0}
          <p class="sin-consumo">
            Mesa en servicio, sin consumo todavía. Toma el pedido para empezar la cuenta.
          </p>
        {/if}
        {#each pos.renglones as renglon (renglon.id)}
          <div class="item">
            <span class="cant">
              <button onclick={() => pos.cambiarCantidad(renglon.id, -1)} aria-label="Menos">−</button>
              <b>{renglon.cantidad}</b>
              <button onclick={() => pos.cambiarCantidad(renglon.id, 1)} aria-label="Más">+</button>
            </span>
            <span class="n">
              {renglon.descripcion}
              {#if renglon.detalle}<small>{renglon.detalle}</small>{/if}
              {#if etiquetaEstado[renglon.estado]}
                <em class="est-r">{etiquetaEstado[renglon.estado]}</em>
              {/if}
            </span>
            <span class="p">{mxn(importeRenglon(renglon))}</span>
            <span class="acciones">
              <button
                class="mini"
                title="Traspasar a otra mesa"
                aria-label="Traspasar {renglon.descripcion}"
                onclick={() => { renglonATraspasar = renglon.id; vista = "traspaso"; }}
              >⇄</button>
              <button
                class="mini x"
                title="Cancelar renglón"
                aria-label="Cancelar {renglon.descripcion}"
                onclick={() => pos.cancelar(renglon.id)}
              >×</button>
            </span>
          </div>
        {/each}
      </div>

      <div class="tot">
        {#if t.descuentos > 0 || t.cortesias > 0}
          <div><span>Bruto</span><span>{mxn(t.bruto)}</span></div>
          {#if t.descuentos > 0}
            <div class="rebaja"><span>Descuentos</span><span>−{mxn(t.descuentos)}</span></div>
          {/if}
          {#if t.cortesias > 0}
            <div class="rebaja"><span>Cortesías</span><span>−{mxn(t.cortesias)}</span></div>
          {/if}
        {/if}
        <div><span>Subtotal</span><span>{mxn(t.subtotal)}</span></div>
        <div><span>IVA (16%)</span><span>{mxn(t.iva)}</span></div>
        {#if t.ieps > 0}<div><span>IEPS</span><span>{mxn(t.ieps)}</span></div>{/if}
        {#if t.propina > 0}
          <div class="propina"><span>Propina</span><span>{mxn(t.propina)}</span></div>
        {/if}
        <div class="gt"><span>Total</span><span>{mxn(sumar(t.total, t.propina))}</span></div>
        {#if t.pagado > 0}
          <div><span>Pagado</span><span>{mxn(t.pagado)}</span></div>
          <div class="saldo"><span>Saldo</span><span>{mxn(t.saldo)}</span></div>
        {/if}
      </div>

      <div class="extras" class:oculto={!pos.hayCuenta}>
        {#if sesion.puedeOperar("fin.factura.emitir")}
          <span class="grupo">
            Factura
            <button class="mini" onclick={() => (facturando = true)}>Emitir CFDI</button>
          </span>
        {/if}
        <span class="grupo">
          Propina
          {#each [0.1, 0.15, 0.2] as pct (pct)}
            <button class="mini" onclick={() => pos.propinaPorcentaje(pct)}>
              {Math.round(pct * 100)}%
            </button>
          {/each}
          {#if t.propina > 0}
            <button class="mini" onclick={() => pos.propinaPorcentaje(0)}>Quitar</button>
          {/if}
        </span>
        <span class="grupo">
          <button class="mini" onclick={() => pos.aplicarDescuento(0.1, "Descuento de cortesía")}>
            −10%
          </button>
          <button class="mini" onclick={() => pos.otorgarCortesia(undefined, "Cortesía de la casa")}>
            Cortesía
          </button>
        </span>
      </div>

      <div class="btns">
        <button
          class="b1"
          disabled={pos.pendientes.length === 0}
          onclick={() => pos.enviarACocina()}
        >
          {pos.pendientes.length === 0
            ? "✓ Todo enviado a cocina"
            : `Enviar a cocina (${pos.pendientes.length})`}
        </button>
        <button
          class="b2 cobrar"
          disabled={!pos.hayCuenta}
          onclick={() => (vista = "cobro")}
        >
          Cobrar {mxn(t.saldo)}
        </button>
      </div>
    {:else if vista === "cobro"}
      <div class="panel-cobro">
        <p class="titulo-panel">Cobrar {mxn(t.saldo)}</p>

        <div class="formas">
          {#each FORMAS_PAGO as forma (forma.valor)}
            <button
              class="mini"
              class:on={formaPago === forma.valor}
              onclick={() => (formaPago = forma.valor)}
            >
              {forma.etiqueta}
            </button>
          {/each}
        </div>

        {#if formaPago === "efectivo"}
          <label class="campo">
            <span>Recibido</span>
            <input type="number" inputmode="decimal" bind:value={recibido} placeholder="0.00" />
          </label>
          {#if cambio > 0}
            <p class="cambio">Cambio: <b>{mxn(cambio)}</b></p>
          {/if}
        {/if}

        <button class="b1" onclick={cobrarAhora}>Registrar pago</button>

        <div class="dividir">
          <span>Dividir en</span>
          <button class="mini" onclick={() => (partes = Math.max(2, partes - 1))}>−</button>
          <b>{partes}</b>
          <button class="mini" onclick={() => (partes = Math.min(20, partes + 1))}>+</button>
          <span class="cada">{mxn(repartir(sumar(t.total, t.propina), partes)[0] ?? CERO)} c/u</span>
          <button class="mini" onclick={dividir}>Dividir y cobrar</button>
        </div>

        <button class="volver" onclick={() => (vista = "cuenta")}>← Volver a la cuenta</button>
      </div>
    {:else}
      <div class="panel-cobro">
        <p class="titulo-panel">Traspasar a la mesa…</p>
        <div class="mesas-destino">
          {#each plano.todasLasMesas.filter((m) => m.id !== pos.mesaActiva) as mesa (mesa.id)}
            <button class="mini" onclick={() => traspasar(mesa.id)}>{mesa.nombre}</button>
          {/each}
        </div>
        <button class="volver" onclick={() => { renglonATraspasar = null; vista = "cuenta"; }}>
          ← Cancelar
        </button>
      </div>
    {/if}
  {:else}
    <div class="vacia">
      <div class="mesa-num">Mesa {pos.nombreMesaActiva}</div>
      <p class="titulo-vacio">Sin cuenta abierta</p>
      <p class="hint">Toca una mesa del salón o agrega un producto de la carta.</p>
    </div>
  {/if}

  {#if pos.mensaje}
    <div class="toast" role="status">{pos.mensaje}</div>
  {/if}
</aside>

{#if facturando && pos.comanda}
  <DialogoFactura comanda={pos.comanda} onCerrar={() => (facturando = false)} />
{/if}

<style>
  .cuenta {
    position: relative;
    background: #fff;
    border-left: 1px solid var(--borde);
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    overflow-y: auto;
  }
  .ch {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.3rem;
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-pill);
    padding: 0.22rem 0.65rem;
    font-size: 0.76rem;
    font-weight: 600;
  }
  .chip.gray {
    background: #eef1ed;
    color: var(--gris);
  }
  .chip.cocina {
    background: var(--claro);
    color: var(--acento);
  }
  .sub {
    font-size: 0.82rem;
    color: var(--gris);
    margin-bottom: 0.85rem;
  }
  .items {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.92rem;
  }
  .cant {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex: none;
  }
  .cant button {
    width: 1.15rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--gris);
    line-height: 1;
  }
  .cant button:hover {
    color: var(--acento);
  }
  .cant b {
    font-family: var(--font-titulo);
    color: var(--acento);
    min-width: 1.1rem;
    text-align: center;
  }
  .item .n {
    flex: 1;
    min-width: 0;
  }
  .item .n small {
    display: block;
    color: var(--gris);
    font-size: 0.74rem;
    margin-top: 0.1rem;
  }
  .est-r {
    display: inline-block;
    margin-top: 0.2rem;
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--acento);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.08rem 0.4rem;
  }
  .item .p {
    font-weight: 600;
    white-space: nowrap;
  }
  .acciones {
    display: inline-flex;
    gap: 0.1rem;
    flex: none;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.22rem 0.5rem;
    font-size: 0.76rem;
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
  .acciones .mini {
    border: none;
    color: var(--gris);
    padding: 0.15rem 0.3rem;
  }
  .acciones .x:hover {
    color: var(--peligro);
  }
  .tot {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  .tot > div {
    display: flex;
    justify-content: space-between;
    color: var(--gris);
  }
  .tot .rebaja {
    color: var(--peligro);
  }
  .tot .propina {
    color: var(--acento);
  }
  .tot .saldo {
    font-weight: 700;
    color: var(--acento);
  }
  .tot .gt {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--pizarra);
    border-top: 2px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.2rem;
  }
  .extras {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .extras.oculto {
    display: none;
  }
  .sin-consumo {
    padding: 1.25rem 0;
    font-size: 0.86rem;
    color: var(--gris);
    font-style: italic;
    line-height: 1.5;
  }
  .grupo {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .btns {
    margin-top: auto;
    padding-top: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .b1 {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 0.85rem;
    text-align: center;
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .b1:disabled {
    background: #eef1ed;
    color: #6b8f57;
    cursor: default;
  }
  .b2 {
    border: 2px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem;
    text-align: center;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .b2.cobrar {
    border-color: var(--acento);
    color: var(--acento);
  }
  .b2.cobrar:hover {
    background: var(--acento);
    color: #fff;
  }
  .panel-cobro {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.5rem;
  }
  .titulo-panel {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .formas,
  .mesas-destino {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .campo {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--gris);
  }
  .campo input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 1rem;
    font-family: var(--font-cuerpo);
  }
  .campo input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .cambio {
    font-size: 0.95rem;
    color: var(--acento);
  }
  .cambio b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .dividir {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
    color: var(--gris);
    border-top: 1px solid var(--borde);
    padding-top: 0.75rem;
  }
  .dividir b {
    font-family: var(--font-titulo);
    color: var(--pizarra);
  }
  .cada {
    color: var(--acento);
    font-weight: 600;
  }
  .volver {
    font-size: 0.82rem;
    color: var(--gris);
    text-decoration: underline;
    align-self: flex-start;
  }
  .vacia {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--gris);
    gap: 0.5rem;
  }
  .mesa-num {
    font-family: var(--font-titulo);
    font-size: 2rem;
    font-weight: 700;
    color: var(--borde);
  }
  .titulo-vacio {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .hint {
    font-size: 0.88rem;
    max-width: 16rem;
  }
  .toast {
    position: absolute;
    left: 1.25rem;
    right: 1.25rem;
    bottom: 1.25rem;
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    font-size: 0.88rem;
    text-align: center;
    box-shadow: var(--sombra-lg);
  }
</style>
