<script lang="ts">
  /**
   * Los avisos de «platillo listo» flotando sobre el salón.
   *
   * Vigila la proyección de las comandas abiertas y, en cuanto un renglón de
   * UNA DE MIS MESAS pasa a listo, lo anuncia. Tocar el aviso lleva a esa mesa;
   * el botón de la derecha da el platillo por entregado sin moverse de donde se
   * está, que es lo que se hace nueve de cada diez veces.
   */
  import { mesasDeComanda, renglonesActivos } from "@motrest/dominio";
  import { asignaciones } from "./asignaciones.svelte";
  import { avisosCocina } from "./avisos-cocina.svelte";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";
  import { vistaMesa } from "./vista-mesa.svelte";

  /** Todo lo que está listo y sin entregar ahora mismo, sea de quien sea. */
  const listos = $derived.by(() =>
    pos.comandasAbiertas.flatMap((comanda) =>
      renglonesActivos(comanda)
        .filter((r) => r.estado === "listo")
        .map((r) => ({ comanda, renglon: r })),
    ),
  );

  /** Lo que le toca a quien está en sesión, según el rol de mesas de hoy. */
  const mios = $derived.by(() => {
    const yo = sesion.usuarioActual?.id;
    if (!yo) return [];
    return listos.filter(({ comanda }) => {
      const asignados = asignaciones.meserosDe(comanda.mesa_id);
      // Sin rol capturado, la mesa es de quien la abrió: es lo más parecido a
      // «tu mesa» que se puede saber sin obligar a nadie a llenar una tabla.
      return asignados.length > 0 ? asignados.includes(yo) : comanda.mesero_id === yo;
    });
  });

  /*
   * Lo que ya estaba listo al llegar NO se anuncia.
   *
   * Entrar al módulo a media noche dispararía una tarjeta por cada plato que
   * lleva rato en el pase, y esa avalancha es justo lo que enseña a ignorar los
   * avisos que sí importan.
   */
  // Deliberadamente NO reactivo: si lo fuera, escribirlo dentro del efecto lo
  // haría correr una segunda vez sin que hubiera nada nuevo que anunciar.
  let arrancado = false;
  $effect(() => {
    const vigentes = listos.map(({ renglon }) => renglon.id);
    if (!arrancado) {
      avisosCocina.sembrar(vigentes);
      arrancado = true;
      return;
    }
    for (const { comanda, renglon } of mios) {
      avisosCocina.anunciar({
        renglon_id: renglon.id,
        orden_id: comanda.orden_id,
        mesa_id: comanda.mesa_id,
        // Una cuenta puede ocupar varias mesas: el aviso dice las que sean, con
        // la misma etiqueta que el encabezado y el ticket. Enviar a alguien a la
        // «mesa 3» cuando el grupo está sentado en la 3 y la 4 es hacerle dar
        // una vuelta de más con el plato en la mano.
        mesa: plano.etiquetaMesas(mesasDeComanda(comanda)),
        descripcion: renglon.descripcion,
        cantidad: renglon.cantidad,
        ts: Date.now(),
      });
    }
    avisosCocina.podar(new Set(vigentes));
  });

  // Al cerrar sesión no puede quedar en pantalla el aviso de la mesa de otro.
  $effect(() => {
    if (!sesion.usuarioActual) avisosCocina.limpiar();
  });

  function irALaMesa(mesaId: string) {
    pos.seleccionarMesa(mesaId);
    vistaMesa.fijar(mesaId, { modo: "mesa", vista: "cuenta" });
  }
</script>

{#if avisosCocina.avisos.length > 0}
  <div class="avisos" role="status" aria-live="polite">
    {#each avisosCocina.avisos as aviso (aviso.renglon_id)}
      <div class="aviso">
        <button class="cuerpo" onclick={() => irALaMesa(aviso.mesa_id)}>
          <span class="marca">Listo</span>
          <span class="texto">
            <b>{aviso.cantidad}× {aviso.descripcion}</b>
            <small>Mesa {aviso.mesa} · recógelo en cocina</small>
          </span>
        </button>
        <button
          class="entregado"
          title="Ya lo llevé a la mesa"
          onclick={async () => {
            await pos.marcarEntregado(aviso.orden_id, aviso.renglon_id);
            avisosCocina.descartar(aviso.renglon_id);
          }}
        >
          Entregado
        </button>
        <button
          class="cerrar"
          aria-label="Descartar aviso"
          onclick={() => avisosCocina.descartar(aviso.renglon_id)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  /*
   * Abajo a la derecha, encima de la cuenta.
   *
   * Arriba ya viven los avisos del sistema —reloj, licencia, failover— y apilar
   * un cuarto ahí los taparía entre sí justo la noche que importan. Aquí queda
   * cerca del pulgar de quien sostiene la tablet.
   */
  .avisos {
    position: absolute;
    z-index: 30;
    right: 1.25rem;
    bottom: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(22rem, calc(100vw - 2.5rem));
    pointer-events: none;
  }
  .aviso {
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    border-left: 4px solid var(--acento);
    box-shadow: var(--sombra-lg);
    overflow: hidden;
    pointer-events: auto;
    animation: entrar 0.22s ease-out;
  }
  @keyframes entrar {
    from {
      transform: translateY(0.6rem);
      opacity: 0;
    }
  }
  .cuerpo {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 0.75rem;
    text-align: left;
    color: inherit;
    min-width: 0;
  }
  /*
   * La única cosa que late en toda la pantalla de venta. El halo es lento y
   * suave a propósito: un destello rápido delante de alguien durante ocho horas
   * cansa, y lo que cansa se acaba tapando con una servilleta.
   */
  .marca {
    flex: none;
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-pill);
    padding: 0.12rem 0.55rem;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    animation: latido 1.6s ease-in-out infinite;
  }
  @keyframes latido {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--acento) 60%, transparent);
    }
    55% {
      box-shadow: 0 0 0 0.4rem color-mix(in srgb, var(--acento) 0%, transparent);
    }
  }
  .texto {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .texto b {
    font-size: 0.92rem;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .texto small {
    font-size: 0.74rem;
    color: #b9c2bc;
  }
  .entregado {
    flex: none;
    align-self: center;
    margin: 0.4rem 0;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.6rem;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--acento);
    background: transparent;
  }
  .entregado:hover {
    background: var(--acento);
    color: #fff;
  }
  .cerrar {
    flex: none;
    padding: 0 0.6rem;
    font-size: 0.85rem;
    color: #8a969c;
  }
  .cerrar:hover {
    color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .marca,
    .aviso {
      animation: none;
    }
  }
  @media (max-width: 767px) {
    .avisos {
      right: 0.75rem;
      left: 0.75rem;
      bottom: 4.25rem;
      max-width: none;
    }
  }
</style>
