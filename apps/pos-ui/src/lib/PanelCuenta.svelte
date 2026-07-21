<script lang="ts">
  import { importeRenglon } from "@motrest/dominio";
  import { hora, mxn } from "./formato";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  const etiquetaEstado: Record<string, string> = {
    enviado: "en cocina",
    en_marcha: "preparando",
    listo: "listo",
    entregado: "entregado",
  };
</script>

<aside class="cuenta">
  {#if pos.comanda && pos.hayCuenta}
    <div class="ch">
      <h2>Mesa {pos.numeroMesaActiva}</h2>
      {#if pos.enviadaACocina}
        <span class="chip cocina">En cocina</span>
      {:else}
        <span class="chip gray">Abierta</span>
      {/if}
    </div>
    <div class="sub">
      {sesion.nombreDe(pos.comanda.mesero_id)} · abierta {hora(pos.comanda.abierta_ts)}
    </div>

    <div class="items">
      {#each pos.renglones as renglon (renglon.id)}
        <div class="item">
          <span class="q">{renglon.cantidad}×</span>
          <span class="n">
            {renglon.descripcion}
            {#if renglon.detalle}<small>{renglon.detalle}</small>{/if}
            {#if etiquetaEstado[renglon.estado]}
              <em class="est-r">{etiquetaEstado[renglon.estado]}</em>
            {/if}
          </span>
          <span class="p">{mxn(importeRenglon(renglon))}</span>
          <button
            class="x"
            title="Cancelar renglón"
            aria-label="Cancelar {renglon.descripcion}"
            onclick={() => pos.cancelar(renglon.id)}
          >
            ×
          </button>
        </div>
      {/each}
    </div>

    {#if pos.totales}
      <div class="tot">
        <div><span>Subtotal</span><span>{mxn(pos.totales.subtotal)}</span></div>
        <div><span>IVA (16%)</span><span>{mxn(pos.totales.iva)}</span></div>
        {#if pos.totales.ieps > 0}
          <div><span>IEPS</span><span>{mxn(pos.totales.ieps)}</span></div>
        {/if}
        <div class="gt"><span>Total</span><span>{mxn(pos.totales.total)}</span></div>
        <div class="est">*Precios estimados, sujetos a la realidad de cada restaurante</div>
      </div>
    {/if}

    <div class="btns">
      <button
        class="b1"
        class:enviada={pos.pendientes.length === 0}
        disabled={pos.pendientes.length === 0}
        onclick={() => pos.enviarACocina()}
      >
        {pos.pendientes.length === 0
          ? "✓ Todo enviado a cocina"
          : `Enviar a cocina (${pos.pendientes.length})`}
      </button>
      <div class="brow">
        <button class="b2" disabled>Dividir</button>
        <button class="b2" disabled>Cortesía</button>
        <button class="b2 cobrar" onclick={() => pos.cobrar()}>Cobrar</button>
      </div>
    </div>
  {:else}
    <div class="vacia">
      <div class="mesa-num">Mesa {pos.numeroMesaActiva}</div>
      <p class="titulo-vacio">Sin cuenta abierta</p>
      <p class="hint">Toca una mesa del salón o agrega un producto para abrir la cuenta.</p>
    </div>
  {/if}

  {#if pos.mensaje}
    <div class="toast" role="status">{pos.mensaje}</div>
  {/if}
</aside>

<style>
  .cuenta {
    position: relative;
    background: #fff;
    border-left: 1px solid var(--borde);
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    overflow-y: auto;
  }
  .ch {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }
  h2 {
    font-size: 1.35rem;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-pill);
    padding: 0.25rem 0.7rem;
    font-size: 0.78rem;
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
    font-size: 0.85rem;
    color: var(--gris);
    margin-bottom: 1rem;
  }
  .items {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.95rem;
  }
  .item .q {
    font-weight: 700;
    color: var(--acento);
    width: 2rem;
  }
  .item .n {
    flex: 1;
  }
  .item .n small {
    display: block;
    color: var(--gris);
    font-size: 0.78rem;
    margin-top: 0.1rem;
  }
  .est-r {
    display: inline-block;
    margin-top: 0.2rem;
    font-size: 0.7rem;
    font-style: normal;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--acento);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.45rem;
  }
  .item .p {
    font-weight: 600;
  }
  .item .x {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    color: var(--gris);
    font-size: 1.1rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.1s ease,
      color 0.1s ease;
  }
  .item .x:hover {
    background: #fdecea;
    color: var(--peligro);
  }
  .tot {
    margin-top: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.95rem;
  }
  .tot > div {
    display: flex;
    justify-content: space-between;
    color: var(--gris);
  }
  .tot .gt {
    font-family: var(--font-titulo);
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--pizarra);
    border-top: 2px solid var(--borde);
    padding-top: 0.75rem;
    margin-top: 0.25rem;
  }
  .est {
    font-size: 0.72rem;
    color: var(--gris);
    font-style: italic;
  }
  .btns {
    margin-top: auto;
    padding-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .b1 {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 1rem;
    text-align: center;
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 600;
    transition: filter 0.12s ease;
  }
  .b1:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .b1.enviada,
  .b1:disabled {
    background: #eef1ed;
    color: #6b8f57;
    cursor: default;
  }
  .brow {
    display: flex;
    gap: 0.6rem;
  }
  .b2 {
    flex: 1;
    border: 2px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem;
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .b2:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .b2.cobrar {
    border-color: var(--acento);
    color: var(--acento);
  }
  .b2.cobrar:hover {
    background: var(--acento);
    color: #fff;
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
    font-size: 0.9rem;
    max-width: 16rem;
  }
  .toast {
    position: absolute;
    left: 1.5rem;
    right: 1.5rem;
    bottom: 1.5rem;
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
    font-size: 0.9rem;
    font-weight: 500;
    text-align: center;
    box-shadow: var(--sombra-lg);
  }
</style>
