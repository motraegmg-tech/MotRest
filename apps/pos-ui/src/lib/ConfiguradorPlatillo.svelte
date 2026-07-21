<script lang="ts">
  import { productoDe } from "@motrest/dominio";
  import { catalogo, idsVariedades, tamanosPizza } from "./catalogo";
  import { mxn, pct } from "./formato";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  // El food cost es información sensible: un mesero no lo ve (PRD §2).
  const veCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  function nombreVariedad(id: string): string {
    return productoDe(catalogo, id).nombre;
  }

  function precioTamano(productoId: string) {
    return productoDe(catalogo, productoId).precio;
  }
</script>

<section class="conf">
  <div class="top">
    <h2>Pizza mitad y mitad</h2>
    <div class="tabs">
      {#each tamanosPizza as tamano (tamano.clave)}
        <button
          class="tab"
          class:on={tamano.clave === pos.tamano}
          onclick={() => (pos.tamano = tamano.clave)}
        >
          {tamano.clave}
          <span class="tp">{mxn(precioTamano(tamano.producto_id))}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="stage">
    <div class="izquierda">
      <div class="pz">
        <div class="mitad izq"></div>
        <div class="mitad der"></div>
        <div class="divisor"></div>
        <span class="lb l">½ {pos.etiquetaIzq}</span>
        <span class="lb r">½ {pos.etiquetaDer}</span>
      </div>
      <button class="agregar" onclick={() => pos.agregarPizza()}>
        Agregar a la cuenta · {mxn(pos.precioPizza)}
      </button>
    </div>

    <div class="halfs">
      {#each pos.mitades as mitad (mitad.ranuraId)}
        <div class="half">
          <h3>
            {mitad.posicion} · {mitad.nombre}
            {#if veCostos}
              <span class="mg">costo {mxn(mitad.costo)} · margen {pct(mitad.margen)}</span>
            {/if}
          </h3>
          <div class="selector">
            {#each idsVariedades as id (id)}
              <button
                class="chip-r"
                class:on={id === mitad.productoId}
                onclick={() =>
                  mitad.ranuraId === "izq" ? (pos.mitadIzq = id) : (pos.mitadDer = id)}
              >
                {nombreVariedad(id)}
              </button>
            {/each}
          </div>
          {#if mitad.ingredientes.length > 0}
            <div class="ing">
              {#each mitad.ingredientes as ing (ing.nombre)}
                <span>{ing.nombre} {#if veCostos}<b>{mxn(ing.costo)}</b>{/if}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      <div class="live">
        {#if veCostos}
          <span class="t">Costeo en vivo</span>
          <span class="kv">Costo del platillo<b>{mxn(pos.costoPizza)}</b></span>
          <span class="kv">Precio de carta<b>{mxn(pos.precioPizza)}</b></span>
          <span class="kv gain">Margen<b>{pct(pos.margenPizza)}</b></span>
        {:else}
          <span class="t">Precio</span>
          <span class="kv">Precio de carta<b>{mxn(pos.precioPizza)}</b></span>
          <span class="kv oculto">Los costos y márgenes no están disponibles para tu rol</span>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .conf {
    padding: 1.5rem 1.75rem 1rem;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    flex: 1;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 1.25rem;
  }
  h2 {
    font-size: 1.4rem;
    font-weight: 600;
    flex: 1;
  }
  .tabs {
    display: flex;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.25rem;
    gap: 0.25rem;
  }
  .tab {
    padding: 0.4rem 0.9rem;
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--gris);
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }
  .tab .tp {
    font-size: 0.72rem;
    font-weight: 500;
    opacity: 0.8;
  }
  .tab.on {
    background: var(--acento);
    color: #fff;
  }
  .stage {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1.75rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-xl);
    padding: 1.5rem;
    min-height: 0;
  }
  .izquierda {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
    align-self: start;
  }
  .pz {
    width: 14rem;
    height: 14rem;
    border-radius: 50%;
    position: relative;
    overflow: hidden;
    border: 0.55rem solid #f3d9a6;
    box-shadow: var(--sombra-lg);
  }
  .mitad {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
  }
  .mitad.izq {
    left: 0;
    background: radial-gradient(circle at 70% 50%, #f7e9c9 0%, #efd9a8 100%);
  }
  .mitad.der {
    right: 0;
    background: radial-gradient(circle at 30% 50%, #f2c9ae 0%, #e8b08b 100%);
  }
  .divisor {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 3px;
    background: #fff;
    transform: translateX(-50%);
  }
  .lb {
    position: absolute;
    bottom: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 0.75rem;
    font-weight: 600;
    background: rgba(20, 24, 26, 0.78);
    color: #fff;
    border-radius: var(--r-pill);
    padding: 0.28rem 0.6rem;
    max-width: 45%;
    text-align: center;
  }
  .lb.l {
    left: 0.5rem;
  }
  .lb.r {
    right: 0.5rem;
  }
  .agregar {
    width: 14rem;
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
    box-shadow: var(--sombra-md);
    transition: filter 0.12s ease;
  }
  .agregar:hover {
    filter: brightness(1.05);
  }
  .halfs {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  .half {
    border: 2px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 0.85rem 1.1rem;
  }
  .half h3 {
    font-size: 1.05rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .half h3 .mg {
    margin-left: auto;
    font-size: 0.78rem;
    font-family: var(--font-cuerpo);
    font-weight: 600;
    background: var(--claro);
    color: var(--acento);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.65rem;
  }
  .selector {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }
  .chip-r {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
    transition: all 0.1s ease;
  }
  .chip-r:hover {
    border-color: var(--acento);
    color: var(--pizarra);
  }
  .chip-r.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .ing {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .ing span {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    color: var(--pizarra);
  }
  .ing span b {
    color: var(--gris);
    font-weight: 500;
    margin-left: 0.3rem;
  }
  .live {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1.5rem;
    background: var(--negro);
    border-radius: var(--r-lg);
    padding: 1rem 1.5rem;
    color: #fff;
  }
  .live .t {
    font-family: var(--font-titulo);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--acento);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .live .kv {
    font-size: 0.85rem;
    color: #b9c2bc;
  }
  .live .kv b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    color: #fff;
  }
  .live .kv.gain b {
    color: var(--acento);
  }
  .live .kv.oculto {
    font-style: italic;
    font-size: 0.8rem;
  }
</style>
