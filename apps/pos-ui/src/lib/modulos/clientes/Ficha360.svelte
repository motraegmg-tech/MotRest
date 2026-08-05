<script lang="ts">
  /**
   * La ficha 360° del comensal, y quiénes se están yendo.
   *
   * Nada de esto se capturó: estaba escrito en el event log desde el primer día
   * que el restaurante operó, repartido entre cuentas, opiniones, reservas y
   * lealtad. Aquí se cruza.
   *
   * La lista arranca por LOS QUE SE ESTÁN YENDO, no por los mejores clientes.
   * Es la única de las dos donde todavía se puede hacer algo: al mejor cliente
   * no hay que recuperarlo, hay que no perderlo — y eso se ve aquí antes.
   */
  import {
    comensalesConocidos,
    enRiesgoDePerderse,
    fichaDe,
    identidadDe,
    type Ficha360,
  } from "@motrest/dominio";
  import { mxn } from "../../formato";
  import { opiniones } from "../../opiniones.svelte";
  import { pos } from "../../pos.svelte";
  import { reservas } from "../../reservas.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeVer = $derived(sesion.puedeVer("crm.cliente.ver"));

  let filtro = $state("");
  let abierta = $state<string | null>(null);

  const fuentes = $derived({
    comandas: pos.todasLasComandas,
    opiniones: opiniones.opiniones,
    reservas: reservas.reservas,
  });

  const fichas = $derived(
    comensalesConocidos(fuentes)
      .map((id) => ({ id, ficha: fichaDe(id, fuentes) }))
      .filter((f) => f.ficha.visitas > 0 || f.ficha.reservas > 0),
  );

  const seVan = $derived(enRiesgoDePerderse(fichas.map((f) => f.ficha)));

  const listadas = $derived.by(() => {
    const texto = filtro.trim().toLowerCase();
    const todas = [...fichas].sort((a, b) => b.ficha.gastado - a.ficha.gastado);
    if (!texto) return todas;
    return todas.filter(
      (f) =>
        f.ficha.nombre.toLowerCase().includes(texto) ||
        (f.ficha.telefono ?? "").includes(texto),
    );
  });

  function fecha(ts: number | undefined): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  }

  function cadaCuanto(f: Ficha360): string {
    if (f.cada_cuantos_dias === null) return "primera visita";
    if (f.cada_cuantos_dias <= 1) return "casi a diario";
    if (f.cada_cuantos_dias <= 9) return `cada ${f.cada_cuantos_dias} días`;
    if (f.cada_cuantos_dias <= 45) return `cada ${Math.round(f.cada_cuantos_dias / 7)} semanas`;
    return `cada ${Math.round(f.cada_cuantos_dias / 30)} meses`;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Comensales</h1>
      <p class="sub">
        {fichas.length} personas reconocidas. No se capturó nada: sale de las
        cuentas, las opiniones y las reservas que ya estaban registradas.
      </p>
    </div>
  </div>

  {#if !puedeVer}
    <p class="nota">Tu perfil no puede consultar la ficha de los comensales.</p>
  {:else}
    <!--
      LOS QUE SE ESTÁN YENDO, primero. Un cliente que venía cada quince días y
      lleva cincuenta sin aparecer todavía se puede recuperar; dentro de tres
      meses ya no. Es el único momento en que una promoción sirve de algo.
    -->
    {#if seVan.length > 0}
      <section class="tarjeta riesgo">
        <h2>Se están yendo <span class="cuantas">{seVan.length}</span></h2>
        <p class="nota">
          Venían seguido y llevan tiempo sin aparecer. Ordenados por lo que
          gastaban: primero el que más duele perder.
        </p>
        <div class="chips">
          {#each seVan.slice(0, 12) as f (f.nombre + f.telefono)}
            <span class="chip">
              <b>{f.nombre}</b>
              {f.dias_sin_venir} días · {mxn(f.gastado)}
            </span>
          {/each}
        </div>
      </section>
    {/if}

    <input class="buscar" bind:value={filtro} placeholder="Buscar por nombre o teléfono…" />

    {#if listadas.length === 0}
      <p class="nota">
        Todavía no hay comensales reconocidos. Se reconocen solos en cuanto una
        cuenta sale a nombre de alguien o llega una reserva.
      </p>
    {/if}

    {#each listadas as { id, ficha } (id)}
      <article class="ficha" class:abierta={abierta === id}>
        <button class="cabecera" onclick={() => (abierta = abierta === id ? null : id)}>
          <span class="nombre">{ficha.nombre}</span>
          {#if ficha.telefono}<span class="tel">{ficha.telefono}</span>{/if}
          <span class="resumen">
            {ficha.visitas}
            {ficha.visitas === 1 ? "visita" : "visitas"} · {mxn(ficha.gastado)}
          </span>
          {#if ficha.malas > 0}
            <!-- Antes de mandarle nada hay que saber que se fue enojado. -->
            <span class="marca mala">{ficha.malas} queja{ficha.malas === 1 ? "" : "s"}</span>
          {/if}
          {#if ficha.plantones > 0}
            <span class="marca planton">{ficha.plantones} plantón{ficha.plantones === 1 ? "" : "es"}</span>
          {/if}
        </button>

        {#if abierta === id}
          <div class="detalle">
            <div class="cifras">
              <div><span>Ticket promedio</span><b>{mxn(ficha.ticket_promedio)}</b></div>
              <div><span>Propinas que dejó</span><b>{mxn(ficha.propinas)}</b></div>
              <div><span>Viene</span><b>{cadaCuanto(ficha)}</b></div>
              <div><span>Última visita</span><b>{fecha(ficha.ultima_visita)}</b></div>
              <div><span>Cliente desde</span><b>{fecha(ficha.primera_visita)}</b></div>
              {#if ficha.puntos > 0 || ficha.monedero > 0}
                <div><span>Puntos</span><b>{ficha.puntos}</b></div>
                <div><span>Monedero</span><b>{mxn(ficha.monedero)}</b></div>
              {/if}
            </div>

            {#if ficha.favoritos.length > 0}
              <p class="pide">
                <b>Pide siempre:</b>
                {ficha.favoritos.map((f) => `${f.descripcion} (${f.veces})`).join(" · ")}
              </p>
            {/if}

            {#if ficha.ultima_opinion}
              <p class="opinion {ficha.ultima_opinion.calificacion}">
                Última opinión: <b>{ficha.ultima_opinion.calificacion}</b>
                {#if ficha.ultima_opinion.comentario}
                  — «{ficha.ultima_opinion.comentario}»
                {/if}
              </p>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
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
    max-width: 46rem;
    line-height: 1.5;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .riesgo {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 5%, #fff);
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .cuantas {
    display: inline-block;
    min-width: 1.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-pill);
    background: var(--acento);
    color: #fff;
    font-size: 0.8rem;
    text-align: center;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }
  .chip {
    padding: 0.35rem 0.7rem;
    border-radius: var(--r-pill);
    border: 1px solid var(--borde);
    background: #fff;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .chip b {
    color: var(--pizarra);
  }
  .buscar {
    width: 100%;
    max-width: 26rem;
    padding: 0.6rem 0.8rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.92rem;
    margin-bottom: 0.8rem;
  }
  .ficha {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    margin-bottom: 0.4rem;
    overflow: hidden;
  }
  .ficha.abierta {
    border-color: var(--acento);
  }
  .cabecera {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.7rem 0.9rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .nombre {
    font-weight: 650;
    font-size: 0.95rem;
  }
  .tel {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .resumen {
    margin-left: auto;
    font-size: 0.85rem;
    color: var(--gris);
    white-space: nowrap;
  }
  .marca {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: var(--r-pill);
    white-space: nowrap;
  }
  .marca.mala {
    background: color-mix(in srgb, var(--peligro) 12%, transparent);
    color: var(--peligro);
  }
  .marca.planton {
    background: var(--fondo);
    color: var(--gris);
  }
  .detalle {
    padding: 0 0.9rem 0.9rem;
    border-top: 1px solid var(--borde);
  }
  .cifras {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
    padding-top: 0.8rem;
  }
  .cifras div {
    display: flex;
    flex-direction: column;
  }
  .cifras span {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .cifras b {
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .pide,
  .opinion {
    margin-top: 0.8rem;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--gris);
  }
  .opinion.mal {
    color: var(--peligro);
  }
  .nota {
    font-size: 0.86rem;
    color: var(--gris);
    line-height: 1.5;
  }
</style>
