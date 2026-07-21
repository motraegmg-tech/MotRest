<script lang="ts">
  /**
   * Configurador genérico: porciones (mitad y mitad), modificadores, cantidad
   * y notas. Sirve igual para una pizza, un rib eye o una ensalada.
   */
  import {
    describirProblemaSeleccion,
    productoDe,
    unidadesDe,
    type GrupoModificadores,
  } from "@motrest/dominio";
  import { catalogo } from "./catalogo";
  import { configurador } from "./configurador.svelte";
  import { mxn, pct } from "./formato";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  const veCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  function nombreProducto(id: string): string {
    return productoDe(catalogo, id).nombre;
  }

  function ayudaGrupo(g: GrupoModificadores): string {
    const partes: string[] = [];
    if (g.min > 0) partes.push(g.min === 1 ? "obligatorio" : `mínimo ${g.min}`);
    if (g.max > 0) partes.push(`hasta ${g.max}`);
    if (g.incluidas_gratis > 0) partes.push(`${g.incluidas_gratis} incluidos`);
    return partes.join(" · ");
  }
</script>

{#if configurador.abierto && configurador.producto}
  {@const producto = configurador.producto}
  <div class="velo" role="presentation" onclick={() => configurador.cerrar()}></div>

  <div class="panel" role="dialog" aria-modal="true" aria-label="Configurar {producto.nombre}">
    <header>
      <div>
        <h2>{producto.nombre}</h2>
        {#if configurador.descripcion}
          <p class="detalle">{configurador.descripcion}</p>
        {/if}
      </div>
      <button class="cerrar" onclick={() => configurador.cerrar()} aria-label="Cerrar">×</button>
    </header>

    <div class="cuerpo">
      <!-- Porciones (mitad y mitad, tercios, combos) -->
      {#if configurador.esquema}
        {@const esquema = configurador.esquema}
        <section class="bloque">
          <h3>Elige las porciones</h3>
          <div class="ranuras">
            {#each esquema.ranuras as ranura (ranura.id)}
              {@const elegida = configurador.porcionDe(ranura.id)}
              <div class="ranura">
                <span class="etiqueta">{ranura.etiqueta}</span>
                <div class="opciones">
                  {#each ranura.opciones_producto as opcionId (opcionId)}
                    <button
                      class="chip"
                      class:on={elegida?.producto_id === opcionId}
                      onclick={() => configurador.elegirPorcion(ranura.id, opcionId)}
                    >
                      {nombreProducto(opcionId)}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Grupos de modificadores -->
      {#each configurador.grupos as grupo (grupo.id)}
        {@const ayuda = ayudaGrupo(grupo)}
        {@const usadas = unidadesDe(configurador.modificadores, grupo.id)}
        <section class="bloque">
          <h3>
            {grupo.nombre}
            {#if ayuda}<span class="ayuda">{ayuda}</span>{/if}
            {#if grupo.max > 0}<span class="contador">{usadas}/{grupo.max}</span>{/if}
          </h3>
          <div class="opciones">
            {#each grupo.opciones as opcion (opcion.id)}
              {@const sel = configurador.seleccionado(opcion.id)}
              <div class="opcion-envoltura">
                <button
                  class="chip"
                  class:on={!!sel}
                  disabled={!opcion.disponible}
                  onclick={() => configurador.alternar(grupo, opcion)}
                >
                  {opcion.nombre}
                  {#if opcion.precio_delta > 0}
                    <span class="delta">+{mxn(opcion.precio_delta)}</span>
                  {/if}
                </button>

                {#if sel && opcion.max_repeticiones > 1}
                  <span class="repetir">
                    <button onclick={() => configurador.repetir(grupo.id, opcion.id, -1)}>−</button>
                    <b>{sel.cantidad}</b>
                    <button onclick={() => configurador.repetir(grupo.id, opcion.id, 1)}>+</button>
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}

      <!-- Notas -->
      <section class="bloque">
        <h3>Notas para cocina</h3>
        <input
          class="notas"
          bind:value={configurador.notas}
          placeholder="Sin sal, para compartir, alergias…"
        />
      </section>
    </div>

    <!-- Pie: cifras y acción -->
    <footer>
      {#if configurador.problemas.length > 0}
        <ul class="problemas" role="alert">
          {#each configurador.problemas as problema, i (i)}
            <li>{describirProblemaSeleccion(problema)}</li>
          {/each}
        </ul>
      {/if}

      <div class="cifras">
        <span class="cantidad">
          <button onclick={() => configurador.cambiarCantidad(-1)} aria-label="Menos">−</button>
          <b>{configurador.cantidad}</b>
          <button onclick={() => configurador.cambiarCantidad(1)} aria-label="Más">+</button>
        </span>

        <span class="desglose">
          {#if configurador.precioExtras !== 0}
            <small>
              {mxn(configurador.precioBase)} + {mxn(configurador.precioExtras)} en extras
            </small>
          {/if}
          {#if veCostos}
            <small class="costo">
              costo {mxn(configurador.costoUnitario)} · margen {pct(configurador.margen)}
            </small>
          {/if}
        </span>

        <button
          class="agregar"
          disabled={!configurador.listo}
          onclick={() => pos.agregarConfigurado()}
        >
          Agregar · {mxn(configurador.total)}
        </button>
      </div>
    </footer>
  </div>
{/if}

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 28;
  }
  .panel {
    position: fixed;
    z-index: 29;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(38rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.1rem 1.4rem 0.85rem;
    border-bottom: 1px solid var(--borde);
  }
  header > div {
    flex: 1;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .detalle {
    margin-top: 0.2rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .cuerpo {
    overflow-y: auto;
    padding: 1rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .bloque h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    margin-bottom: 0.55rem;
  }
  .ayuda {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--acento);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.45rem;
  }
  .contador {
    margin-left: auto;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
    text-transform: none;
  }
  .ranuras {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .ranura .etiqueta {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    margin-bottom: 0.35rem;
  }
  .opciones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .opcion-envoltura {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.8rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--pizarra);
  }
  .chip.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .delta {
    font-size: 0.72rem;
    opacity: 0.85;
  }
  .repetir {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.3rem;
  }
  .repetir button {
    width: 1.2rem;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--gris);
  }
  .repetir b {
    font-size: 0.8rem;
    min-width: 0.9rem;
    text-align: center;
  }
  .notas {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
  }
  .notas:focus {
    outline: none;
    border-color: var(--acento);
  }
  footer {
    border-top: 1px solid var(--borde);
    padding: 0.85rem 1.4rem 1.1rem;
    background: var(--fondo);
  }
  .problemas {
    margin-bottom: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .cifras {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
  }
  .cantidad {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.25rem 0.5rem;
    background: #fff;
  }
  .cantidad button {
    width: 1.6rem;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--gris);
  }
  .cantidad b {
    font-family: var(--font-titulo);
    min-width: 1.2rem;
    text-align: center;
  }
  .desglose {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: 0.75rem;
    color: var(--gris);
  }
  .desglose .costo {
    color: var(--acento);
    font-weight: 600;
  }
  .agregar {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 0.8rem 1.4rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
    box-shadow: var(--sombra-md);
  }
  .agregar:disabled {
    background: var(--borde);
    color: var(--gris);
    box-shadow: none;
    cursor: not-allowed;
  }
</style>
