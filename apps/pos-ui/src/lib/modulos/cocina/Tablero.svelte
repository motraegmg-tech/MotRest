<script lang="ts">
  /**
   * M2 · Pantalla de cocina (KDS).
   *
   * Los tickets se derivan de las MISMAS comandas que el POS: no hay una cola
   * de cocina aparte que pueda desincronizarse. Lo que el mesero envía es
   * literalmente lo que la cocina ve.
   *
   * Fondo oscuro y tipografía grande a propósito: se lee a distancia, de pie y
   * con las manos ocupadas (TRD §12, perfil KDS).
   */
  import {
    cargaPorEstacion,
    etiquetaSemaforo,
    proyectarTablero,
  } from "@motrest/dominio";
  import { menu } from "../../menu.svelte";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  // Las estaciones las configura el restaurante desde Administración.
  const estaciones = $derived(menu.estaciones);

  let estacionActiva = $state<string | null>(null);
  let verEntregados = $state(false);

  // Reloj de los cronómetros: se refresca cada 15 s, que es la resolución útil
  // en una cocina. Lo marca el reloj del propio dispositivo (ADR-17).
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  const comandas = $derived(pos.comandasAbiertas);
  const carga = $derived(cargaPorEstacion(comandas));

  const tickets = $derived(
    proyectarTablero(comandas, {
      estacion_id: estacionActiva ?? undefined,
      ahora,
      estaciones,
      incluirEntregados: verEntregados,
    }),
  );

  const puedeOperar = $derived(sesion.puedeOperar("cocina.item.marcar_listo"));
  const total = $derived([...carga.values()].reduce((a, b) => a + b, 0));

  function minutos(n: number): string {
    return n < 1 ? "recién" : `${n} min`;
  }
</script>

<div class="kds">
  <header>
    <div class="titulo">
      <h1>Cocina</h1>
      <span class="pendientes">{total} pendientes</span>
    </div>

    <div class="estaciones">
      <button class="est" class:on={estacionActiva === null} onclick={() => (estacionActiva = null)}>
        Todas
      </button>
      {#each estaciones as estacion (estacion.id)}
        {@const n = carga.get(estacion.id) ?? 0}
        <button
          class="est"
          class:on={estacionActiva === estacion.id}
          onclick={() => (estacionActiva = estacion.id)}
        >
          {estacion.nombre}
          {#if n > 0}<span class="cuenta">{n}</span>{/if}
        </button>
      {/each}
      <!--
        «Recall» no le decía nada a nadie. Es el término del oficio para volver a
        traer a la pantalla lo que ya se despachó, y sirve para lo de siempre: la
        mesa dice que no le llegó el postre, o un plato se regresa y hay que
        rehacerlo. Sin esto, un ticket entregado desaparece y no hay forma de
        volver a él desde la cocina.
      -->
      <button
        class="est recall"
        class:on={verEntregados}
        title="Vuelve a mostrar lo ya entregado, para rehacer un platillo o comprobar qué salió"
        onclick={() => (verEntregados = !verEntregados)}
      >
        {verEntregados ? "Ocultar entregados" : "Ver entregados"}
      </button>
    </div>
  </header>

  {#if tickets.length === 0}
    <div class="vacio">
      <p class="grande">Sin comandas pendientes</p>
      <p>Lo que el mesero envíe aparecerá aquí al instante.</p>
    </div>
  {:else}
    <div class="tickets">
      {#each tickets as ticket (ticket.orden_id)}
        <article class="ticket {ticket.semaforo}">
          <div class="cabecera">
            <!--
              El nombre manda sobre el número de mesa: si el pedido es para
              llevar, es el dato con el que se entrega.
            -->
            <span class="mesa">
              {#if ticket.a_nombre_de}
                {ticket.a_nombre_de}
              {:else}
                <!-- Las mesas EN PLURAL cuando el grupo ocupa varias: quien
                     lleva el plato tiene que saber a dónde va. -->
                {ticket.mesas.length > 1 ? "Mesas" : "Mesa"}
                {plano.etiquetaMesas(ticket.mesas)}
              {/if}
            </span>
            <span class="tiempo">{minutos(ticket.minutos)}</span>
          </div>
          <p class="mesero">{sesion.nombreDe(ticket.mesero_id)} · {etiquetaSemaforo(ticket.semaforo)}</p>

          <ul class="platillos">
            {#each ticket.renglones as renglon (renglon.renglon_id)}
              <li class="platillo {renglon.semaforo}" class:hecho={renglon.estado === "listo" || renglon.estado === "entregado"}>
                <div class="linea">
                  <span class="cant">{renglon.cantidad}×</span>
                  <span class="nombre">{renglon.descripcion}</span>
                  <span class="min">{minutos(renglon.minutos)}</span>
                </div>
                {#if renglon.detalle}<p class="detalle">{renglon.detalle}</p>{/if}

                <!--
                  Las indicaciones van en recuadro, no como una línea más: es lo
                  que más caro cuesta pasar por alto. Un platillo que sale con
                  tomate cuando lo pidieron sin tomate se regresa entero.
                -->
                {#if renglon.notas}
                  <div class="recuadro" class:cambiada={renglon.notas_cambiadas}>
                    {#if renglon.notas_cambiadas}
                      <span class="cambio">CAMBIÓ</span>
                    {/if}
                    <p>{renglon.notas}</p>
                    {#if renglon.notas_cambiadas && puedeOperar}
                      <button
                        class="visto"
                        onclick={() => pos.marcarCambioVisto(ticket.orden_id, renglon.renglon_id)}
                      >
                        Enterado
                      </button>
                    {/if}
                  </div>
                {:else if renglon.notas_cambiadas}
                  <!-- Quitaron la indicación: también hay que enterarse. -->
                  <div class="recuadro cambiada">
                    <span class="cambio">CAMBIÓ</span>
                    <p>Se retiró la indicación anterior.</p>
                    {#if puedeOperar}
                      <button
                        class="visto"
                        onclick={() => pos.marcarCambioVisto(ticket.orden_id, renglon.renglon_id)}
                      >
                        Enterado
                      </button>
                    {/if}
                  </div>
                {/if}

                {#if puedeOperar}
                  <div class="acciones">
                    <!--
                      EL COLOR SIGUE AL SIGUIENTE PASO, NO AL ESTADO FINAL.

                      Antes «Listo» estaba encendido desde que el ticket entraba
                      a la cocina, y «Empezar» apagado a su lado: el botón que
                      llamaba la atención era el que NO tocaba pulsar todavía, y
                      el atajo evidente era saltarse la marca de arranque —con
                      ella se pierde el cronómetro por platillo, que es lo único
                      que hace útil el semáforo—.

                      Ahora manda el orden real del pase: primero se enciende
                      «Empezar»; en cuanto el cocinero lo toma, ese botón
                      desaparece y «Listo» se queda solo, grande y encendido.
                      En cada momento hay exactamente un botón que pide algo.
                    -->
                    {#if renglon.estado === "enviado"}
                      <button
                        class="accion primaria"
                        onclick={() => pos.marcarEnMarcha(ticket.orden_id, renglon.renglon_id, renglon.estacion_id)}
                      >
                        Empezar
                      </button>
                      <button
                        class="accion"
                        onclick={() => pos.marcarListo(ticket.orden_id, renglon.renglon_id)}
                      >
                        Listo
                      </button>
                    {:else if renglon.estado === "en_marcha"}
                      <button
                        class="accion primaria grande"
                        onclick={() => pos.marcarListo(ticket.orden_id, renglon.renglon_id)}
                      >
                        Listo
                      </button>
                    {:else if renglon.estado === "listo"}
                      <button
                        class="accion entregar"
                        onclick={() => pos.marcarEntregado(ticket.orden_id, renglon.renglon_id)}
                      >
                        Entregado
                      </button>
                      <button
                        class="accion volver"
                        onclick={() => pos.marcarEnMarcha(ticket.orden_id, renglon.renglon_id, renglon.estacion_id)}
                      >
                        ↩ Rehacer
                      </button>
                    {:else}
                      <span class="entregado-nota">Entregado</span>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .kds {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--negro);
    color: #fff;
  }
  header {
    padding: 1.1rem 1.5rem 0.85rem;
    border-bottom: 1px solid #2a3237;
    flex: none;
  }
  .titulo {
    display: flex;
    align-items: baseline;
    gap: 0.85rem;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 600;
  }
  .pendientes {
    font-size: 0.9rem;
    color: #8a969c;
  }
  .estaciones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.85rem;
  }
  .est {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: 1.5px solid #2a3237;
    border-radius: var(--r-pill);
    padding: 0.4rem 0.95rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #b9c2bc;
    background: #1c2226;
  }
  .est:hover {
    border-color: var(--acento);
    color: #fff;
  }
  .est.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .est .cuenta {
    background: rgba(0, 0, 0, 0.3);
    border-radius: var(--r-pill);
    padding: 0 0.4rem;
    font-size: 0.8rem;
  }
  .est.recall {
    margin-left: auto;
  }
  .vacio {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #8a969c;
  }
  .vacio .grande {
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    color: #b9c2bc;
  }
  .tickets {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
    gap: 1rem;
    align-content: start;
  }
  .ticket {
    background: #1c2226;
    border: 2px solid #2a3237;
    border-radius: var(--r-lg);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
  }
  .ticket.advertencia {
    border-color: var(--acento-2);
  }
  .ticket.demorado {
    border-color: var(--peligro);
    box-shadow: 0 0 0 3px rgba(224, 57, 43, 0.18);
  }
  .ticket.listo {
    border-color: #57ad30;
    box-shadow: 0 0 0 2px rgba(87, 173, 48, 0.25);
  }
  .cabecera {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }
  .mesa {
    flex: 1;
    font-family: var(--font-titulo);
    font-size: 1.5rem;
    font-weight: 700;
  }
  .tiempo {
    font-family: var(--font-titulo);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--acento);
  }
  .ticket.demorado .tiempo {
    color: #ff8a7a;
  }
  .ticket.advertencia .tiempo {
    color: var(--acento-2);
  }
  .mesero {
    font-size: 0.8rem;
    color: #8a969c;
    margin-bottom: 0.6rem;
  }
  .platillos {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .platillo {
    border-top: 1px solid #2a3237;
    padding-top: 0.55rem;
  }
  /*
   * Un platillo listo NO se apaga.
   *
   * Antes bajaba al 50% de opacidad, y una comanda entera lista para entregar
   * terminaba tan descolorida que costaba leerla de reojo —justo cuando hay que
   * recogerla YA—. El estado ya se ve por el borde verde del ticket, el botón
   * de entregar y el semáforo; el texto se queda a plena luz, igual que el de
   * una comanda recién pedida.
   */
  .platillo.hecho .nombre {
    text-decoration: line-through;
    text-decoration-color: #57ad30;
  }
  .linea {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .cant {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--acento);
  }
  .nombre {
    flex: 1;
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1.25;
  }
  .min {
    font-size: 0.85rem;
    color: #8a969c;
  }
  .platillo.demorado .min {
    color: #ff8a7a;
    font-weight: 700;
  }
  .detalle {
    font-size: 0.85rem;
    color: #b9c2bc;
    margin-top: 0.15rem;
  }
  /*
   * El recuadro de indicaciones.
   *
   * Se lee de reojo, a metro y medio, con las manos ocupadas. Por eso va
   * enmarcado y con tipografía grande en vez de como una línea más: el resto
   * del ticket se puede releer, esto no se puede pasar por alto.
   */
  .recuadro {
    margin-top: 0.4rem;
    padding: 0.45rem 0.6rem;
    border: 2px solid var(--acento-2);
    border-radius: 6px;
    background: color-mix(in srgb, var(--acento-2) 10%, transparent);
  }
  .recuadro p {
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.3;
    text-transform: uppercase;
  }
  /* Un cambio tardío grita más que una indicación de origen: quien leyó el
     ticket hace tres minutos no lo va a releer por su cuenta. */
  .recuadro.cambiada {
    border-color: #e0392b;
    background: color-mix(in srgb, #e0392b 14%, transparent);
    animation: latir 1.4s ease-in-out infinite;
  }
  @keyframes latir {
    50% {
      border-color: color-mix(in srgb, #e0392b 45%, transparent);
    }
  }
  .cambio {
    display: inline-block;
    background: #e0392b;
    color: #fff;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    margin-bottom: 0.3rem;
  }
  .visto {
    margin-top: 0.4rem;
    width: 100%;
    border: 1.5px solid #e0392b;
    background: #fff;
    color: #e0392b;
    border-radius: 6px;
    padding: 0.35rem;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .recuadro.cambiada {
      animation: none;
    }
  }
  .acciones {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  .accion {
    flex: 1;
    border: 1.5px solid #2a3237;
    border-radius: var(--r-sm);
    padding: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #b9c2bc;
    background: #14181a;
  }
  .accion:hover {
    border-color: var(--acento);
    color: #fff;
  }
  /* El paso que toca ahora. Solo hay uno encendido por platillo. */
  .accion.primaria {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  /*
   * Cuando «Listo» se queda solo, ocupa el renglón entero y crece.
   *
   * No es adorno: se pulsa con la mano ocupada, sin mirar del todo, y a veces
   * con guante. Un botón que abarca todo el ancho no se falla.
   */
  .accion.grande {
    padding: 0.7rem;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  /*
   * El botón de entregar es lo único encendido del tablero, a propósito.
   *
   * El KDS vive apagado —fondo oscuro, tipografía tenue— para que la cocina lo
   * mire de reojo sin que canse la vista en un turno de ocho horas. Pero cuando
   * un platillo está listo, alguien tiene que recogerlo YA: cada segundo que
   * espera bajo la lámpara es un plato que se enfría.
   *
   * Por eso este botón rompe la paleta y ninguno más: es el único que tiene
   * prisa. Si se iluminara todo, no destacaría nada.
   */
  /*
   * Verde vivo, no olivo.
   *
   * El color plano `#57ad30` a este tamaño y sobre fondo oscuro se apaga y
   * parece deshabilitado —justo lo que NO puede parecer el botón que hay que
   * pulsar—. Un degradado hacia un verde más claro le da volumen, y quitar la
   * sombra oscura del texto deja de ensuciarlo. Es lo único encendido del
   * tablero: tiene que verse como un semáforo en verde, no como una etiqueta.
   */
  .accion.entregar {
    background: linear-gradient(180deg, #6fd440 0%, #57ad30 100%);
    border-color: #7ee84a;
    color: #0d2a05;
    font-weight: 800;
    letter-spacing: 0.02em;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      0 0 0 1px rgba(126, 232, 74, 0.5),
      0 0 18px rgba(111, 212, 64, 0.65);
  }
  .accion.entregar:hover {
    background: linear-gradient(180deg, #8ae85f 0%, #6fd440 100%);
    border-color: #9dff6b;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.45),
      0 0 0 1px rgba(157, 255, 107, 0.6),
      0 0 26px rgba(126, 232, 74, 0.85);
  }
  .accion.volver {
    flex: none;
    padding: 0.5rem 0.7rem;
  }
  .entregado-nota {
    font-size: 0.82rem;
    color: #6b8f57;
    font-weight: 600;
  }
</style>
