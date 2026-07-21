<script lang="ts">
  /**
   * Vista de un módulo que todavía no tiene funcionalidad.
   *
   * No dice "próximamente" y ya: explica qué resolverá, qué funciones del Anexo A
   * del PRD cubre, qué parte queda lista en F1 y en qué etapa del plan llega.
   * Es honesto con el usuario y sirve de argumento comercial.
   */
  import { COLOR_FASE, type EntradaModulo } from "./modulos";

  interface Props {
    modulo: EntradaModulo;
  }
  let { modulo }: Props = $props();
</script>

<div class="roadmap">
  <header>
    <div class="titulo">
      <h1>{modulo.titulo}</h1>
      <span class="fase" style="background: {COLOR_FASE[modulo.fase]}">{modulo.fase}</span>
      <span class="id">{modulo.id.toUpperCase()}</span>
    </div>
    <p class="resumen">{modulo.resumen}</p>
  </header>

  <div class="tarjetas">
    {#if modulo.enF1}
      <section class="tarjeta destacada">
        <h2>Lo que ya existe</h2>
        <p>{modulo.enF1}</p>
      </section>
    {/if}

    {#if modulo.etapa}
      <section class="tarjeta">
        <h2>Cuándo llega</h2>
        <p>{modulo.etapa}</p>
      </section>
    {/if}
  </div>

  <section class="funciones">
    <h2>Funciones que cubrirá</h2>
    <p class="fuente">Del catálogo funcional del PRD (Anexo A)</p>
    <ul>
      {#each modulo.funciones as funcion (funcion)}
        <li>{funcion}</li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .roadmap {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 60rem;
  }
  .titulo {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  h1 {
    font-size: 1.9rem;
    font-weight: 600;
  }
  .fase {
    font-family: var(--font-titulo);
    font-size: 0.75rem;
    font-weight: 700;
    color: #fff;
    border-radius: var(--r-pill);
    padding: 0.2rem 0.6rem;
    letter-spacing: 0.04em;
  }
  .id {
    font-family: var(--font-titulo);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--gris);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.15rem 0.55rem;
  }
  .resumen {
    margin-top: 0.6rem;
    font-size: 1.02rem;
    line-height: 1.55;
    color: var(--pizarra);
    max-width: 46rem;
  }
  .tarjetas {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .tarjeta {
    flex: 1;
    min-width: 16rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
  }
  .tarjeta.destacada {
    border-color: var(--acento);
    background: #fffaf5;
  }
  .tarjeta h2 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.5rem;
  }
  .tarjeta.destacada h2 {
    color: var(--acento);
  }
  .tarjeta p {
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .funciones {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.25rem 1.5rem;
  }
  .funciones h2 {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .fuente {
    font-size: 0.78rem;
    color: var(--gris);
    margin-bottom: 0.85rem;
  }
  .funciones ul {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .funciones li {
    position: relative;
    padding-left: 1.35rem;
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .funciones li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.45rem;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 2px;
    background: var(--acento);
    opacity: 0.55;
  }
</style>
