<script lang="ts">
  /**
   * Lo primero que se ve al abrir Central.
   *
   * ARRIBA LO QUE ESTÁ MAL, ABAJO EL DINERO. No es una preferencia estética: el
   * ingreso del mes que viene depende de que los restaurantes funcionen hoy, así
   * que un panel que abre con la gráfica de ingresos y esconde "Rodizio lleva 30
   * horas sin reportar" está ordenado al revés.
   *
   * Si no hay nada urgente, se dice explícitamente. Un espacio en blanco donde
   * debería ir una lista no se lee como "todo bien": se lee como "no cargó".
   */
  import { central } from "../lib/central.svelte";
  import { dinero } from "../lib/formato";
  import type { Urgencia } from "@motrest/dominio";

  const { onAbrir }: { onAbrir: (id: string) => void } = $props();

  const pendientes = $derived(central.pendientes);
  const resumen = $derived(central.resumen);

  const ETIQUETA: Record<Urgencia, string> = {
    caido: "Caído",
    bloqueado: "Bloqueado",
    vence_hoy: "Vence",
    por_cobrar: "Por cobrar",
    revisar: "Revisar",
  };
</script>

<section>
  <h1>Hoy</h1>

  {#if central.clientes.length === 0}
    <div class="vacio">
      <p><b>Todavía no hay ningún restaurante dado de alta.</b></p>
      <p>
        Empieza en <b>Llaves</b> capturando los secretos de firma, y después da de
        alta tu primer local en <b>Restaurantes</b>.
      </p>
    </div>
  {:else}
    <h2>Qué atender</h2>

    {#if pendientes.length === 0}
      <div class="tranquilo">
        Todos los locales reportando y al corriente. Nada que atender.
      </div>
    {:else}
      <ul class="pendientes">
        {#each pendientes as p (p.sucursal_id)}
          <li>
            <button onclick={() => onAbrir(p.sucursal_id)}>
              <span class="marca {p.urgencia}">{ETIQUETA[p.urgencia]}</span>
              <span class="nombre">{p.nombre}</span>
              <span class="detalle">{p.detalle}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>El negocio</h2>
    <div class="cifras">
      <div class="cifra">
        <b>{resumen.locales}</b>
        <span>locales activos</span>
      </div>
      <div class="cifra destacada">
        <b>{dinero(resumen.ingreso_mensual)}</b>
        <span>al mes si todos pagan</span>
      </div>
      <div class="cifra">
        <b>{resumen.al_corriente}</b>
        <span>al corriente</span>
      </div>
      <div class="cifra" class:mal={resumen.bloqueados > 0}>
        <b>{resumen.bloqueados}</b>
        <span>bloqueados</span>
      </div>
    </div>

    {#if resumen.versiones.length > 0}
      <h2>Qué versión tiene cada quien</h2>
      <!--
        Muchas versiones distintas es un despliegue disperso, y eso convierte
        cada soporte en una adivinanza: "no me funciona X" significa cosas
        distintas según la versión que tenga delante.
      -->
      <div class="versiones">
        {#each resumen.versiones as v (v.version)}
          <span class="chip">
            {v.version}
            <b>{v.locales}</b>
          </span>
        {/each}
        {#if resumen.versiones.length > 2}
          <span class="disperso">
            {resumen.versiones.length} versiones distintas en la calle: conviene
            emparejarlas.
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  section {
    padding: 1.5rem 1.75rem 3rem;
    max-width: 62rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    margin: 0 0 1.4rem;
    color: var(--pizarra);
  }
  h2 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.9rem 0 0.7rem;
  }
  h2:first-of-type {
    margin-top: 0;
  }
  .vacio,
  .tranquilo {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 1.1rem 1.2rem;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .vacio p {
    margin: 0 0 0.5rem;
  }
  .vacio p:last-child {
    margin: 0;
  }
  .tranquilo {
    border-left: 3px solid #2f9e6b;
    color: var(--gris);
  }
  .pendientes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .pendientes button {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    padding: 0.7rem 0.9rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pendientes button:hover {
    border-color: var(--acento);
  }
  .marca {
    flex: none;
    min-width: 5.6rem;
    text-align: center;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.25rem 0.5rem;
    border-radius: var(--r-pill);
    color: var(--blanco);
  }
  /* Rojo lo que está parado, ámbar lo que urge cobrar, gris lo que solo se mira. */
  .marca.caido,
  .marca.bloqueado {
    background: var(--peligro);
  }
  .marca.vence_hoy {
    background: var(--acento);
  }
  .marca.por_cobrar {
    background: var(--acento-2);
    color: var(--negro);
  }
  .marca.revisar {
    background: var(--borde);
    color: var(--gris);
  }
  .nombre {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--pizarra);
  }
  .detalle {
    font-size: 0.82rem;
    color: var(--gris);
    margin-left: auto;
    text-align: right;
  }
  .cifras {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.6rem;
  }
  .cifra {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
  }
  .cifra b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.5rem;
    color: var(--pizarra);
  }
  .cifra span {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .cifra.destacada b {
    color: var(--acento);
  }
  .cifra.mal b {
    color: var(--peligro);
  }
  .versiones {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .chip b {
    color: var(--acento);
  }
  .disperso {
    font-size: 0.78rem;
    color: var(--gris);
    margin-left: 0.4rem;
  }
</style>
