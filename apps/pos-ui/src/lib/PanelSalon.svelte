<script lang="ts">
  /**
   * Salón del POS: dibuja el plano real del local sobre su retícula, de modo que
   * la disposición en pantalla corresponda a la del piso.
   */
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
</script>

<section class="salon">
  <div class="cabecera">
    <h2>Salón</h2>
  </div>

  {#if plano.areas.length > 1}
    <div class="areas">
      {#each plano.areas as area (area.id)}
        <button
          class="area"
          class:on={area.id === plano.areaActiva}
          onclick={() => (plano.areaActiva = area.id)}
        >
          {area.nombre}
        </button>
      {/each}
    </div>
  {/if}

  {#if plano.area}
    {@const area = plano.area}
    <div
      class="lienzo"
      style="--columnas: {area.columnas}; --filas: {area.filas}"
      role="group"
      aria-label="Plano de {area.nombre}"
    >
      {#each plano.mesas as mesa (mesa.id)}
        {@const estado = pos.estadoMesa(mesa.id)}
        <button
          class="mesa {estado} {mesa.forma}"
          class:sel={mesa.id === pos.mesaActiva}
          style="grid-column: {mesa.columna + 1} / span {mesa.ancho};
                 grid-row: {mesa.fila + 1} / span {mesa.alto}"
          onclick={() => pos.seleccionarMesa(mesa.id)}
          title="Mesa {mesa.nombre}"
        >
          <span class="nombre">{mesa.nombre}</span>
          <small>
            {#if estado === "libre"}libre
            {:else if estado === "cuenta"}en cocina
            {:else}en servicio{/if}
          </small>
        </button>
      {/each}
    </div>
  {:else}
    <p class="vacio">Este local todavía no tiene áreas configuradas.</p>
  {/if}

  <div class="leyenda">
    <span><i style="background: var(--peligro)"></i>Ocupada · en servicio</span>
    <span><i style="background: var(--acento)"></i>Enviada a cocina</span>
    <span><i style="background: #dde3da"></i>Libre</span>
  </div>
</section>

<style>
  .salon {
    background: #fff;
    border-right: 1px solid var(--borde);
    padding: 1.25rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .cabecera h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .areas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0.85rem 0;
  }
  .area {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.28rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .lienzo {
    display: grid;
    grid-template-columns: repeat(var(--columnas), 1fr);
    grid-template-rows: repeat(var(--filas), minmax(1.6rem, auto));
    gap: 0.25rem;
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--r-md);
    /* Retícula de fondo: ancla visual para reconocer el espacio real. */
    background-image:
      linear-gradient(to right, var(--borde) 1px, transparent 1px),
      linear-gradient(to bottom, var(--borde) 1px, transparent 1px);
    background-size: calc(100% / var(--columnas)) calc(100% / var(--filas));
    background-color: var(--fondo);
  }
  .mesa {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    border: 2px solid var(--borde);
    background: #fff;
    color: var(--gris);
    min-height: 2.6rem;
    padding: 0.2rem;
    transition:
      transform 0.08s ease,
      box-shadow 0.12s ease;
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
  .mesa:hover {
    transform: translateY(-1px);
    box-shadow: var(--sombra-sm);
  }
  .mesa .nombre {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1;
  }
  .mesa small {
    font-size: 0.6rem;
    font-weight: 500;
    line-height: 1;
    text-align: center;
  }
  .mesa.ocupada {
    background: #fdeae8;
    border-color: var(--peligro);
    color: var(--pizarra);
  }
  .mesa.cuenta {
    background: var(--claro);
    border-color: var(--acento);
    color: var(--pizarra);
  }
  .mesa.sel {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
    box-shadow: var(--sombra-md);
  }
  .vacio {
    margin-top: 1rem;
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .leyenda {
    margin-top: 1.25rem;
    font-size: 0.82rem;
    color: var(--gris);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .leyenda span {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .leyenda i {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 4px;
  }
</style>
