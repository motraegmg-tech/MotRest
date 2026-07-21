<script lang="ts">
  /**
   * Bitácora de auditoría.
   *
   * No es una tabla aparte: es el PROPIO event log leído al derecho, como manda
   * el TRD §10 ("el event log es la bitácora inmutable"). Fusiona los eventos de
   * identidad con los de operación y los ordena por el reloj del dispositivo.
   */
  import { etiquetaAccion, type EventoIdentidad } from "@motrest/dominio";
  import type { EventoComanda } from "@motrest/dominio";
  import { hora } from "../formato";
  import { pos } from "../pos.svelte";
  import { sesion } from "./sesion.svelte";

  interface Props {
    onCerrar: () => void;
  }
  let { onCerrar }: Props = $props();

  type Entrada = {
    id: string;
    ts: number;
    actor: string;
    texto: string;
    tono: "normal" | "alerta" | "acento";
  };

  function describirIdentidad(ev: EventoIdentidad): Entrada {
    const base = { id: ev.id, ts: ev.ts, actor: sesion.nombreDe(ev.empleado_id) };
    switch (ev.tipo) {
      case "sesion_iniciada":
        return { ...base, actor: sesion.nombreDe(ev.usuario_id),
          texto: ev.cambio_rapido ? "Cambio rápido de usuario" : "Inició sesión", tono: "normal" };
      case "sesion_cerrada":
        return { ...base, actor: sesion.nombreDe(ev.usuario_id), texto: "Cerró sesión", tono: "normal" };
      case "acceso_rechazado":
        return { ...base, actor: ev.usuario_id ? sesion.nombreDe(ev.usuario_id) : "Desconocido",
          texto: `Acceso rechazado (${ev.motivo.replace(/_/g, " ")})`, tono: "alerta" };
      case "autorizacion_otorgada":
        return { ...base, actor: sesion.nombreDe(ev.autorizador_id),
          texto: `Autorizó "${etiquetaAccion(ev.accion)}" a ${sesion.nombreDe(ev.solicitante_id)}${ev.contexto ? ` · ${ev.contexto}` : ""}`,
          tono: "acento" };
      case "autorizacion_denegada":
        return { ...base, actor: sesion.nombreDe(ev.solicitante_id),
          texto: `Autorización denegada para "${etiquetaAccion(ev.accion)}"`, tono: "alerta" };
      case "usuario_creado":
        return { ...base, texto: `Creó al usuario ${ev.nombre} (${ev.permisos.length} actividades)`, tono: "acento" };
      case "usuario_actualizado":
        return { ...base, texto: `Modificó al usuario ${sesion.nombreDe(ev.usuario_id)}`, tono: "acento" };
      case "credencial_cambiada":
        return { ...base, texto: `Cambió su ${ev.tipo_credencial}`, tono: "acento" };
    }
  }

  function describirComanda(ev: EventoComanda): Entrada {
    const base = { id: ev.id, ts: ev.ts, actor: sesion.nombreDe(ev.empleado_id) };
    switch (ev.tipo) {
      case "orden_creada":
        return { ...base, texto: `Abrió la ${ev.mesa_id.replace("mesa-", "mesa ")}`, tono: "normal" };
      case "item_agregado":
        return { ...base, texto: `Agregó ${ev.renglon.cantidad}× ${ev.renglon.descripcion}`, tono: "normal" };
      case "item_cancelado":
        return { ...base,
          texto: `Canceló un renglón${ev.autorizador_id ? ` · autorizó ${sesion.nombreDe(ev.autorizador_id)}` : ""}`,
          tono: "alerta" };
      case "items_enviados":
        return { ...base, texto: `Envió ${ev.renglon_ids.length} platillo(s) a cocina`, tono: "normal" };
      case "item_en_marcha":
        return { ...base, texto: "Cocina tomó un platillo", tono: "normal" };
      case "item_listo":
        return { ...base, texto: "Platillo listo", tono: "normal" };
      case "item_entregado":
        return { ...base, texto: "Platillo entregado", tono: "normal" };
      case "pago_registrado":
        return { ...base, texto: `Registró un pago (${ev.forma})`, tono: "acento" };
      case "cuenta_cerrada":
        return { ...base, texto: "Cerró la cuenta", tono: "acento" };
    }
  }

  const entradas = $derived(
    [
      ...sesion.eventos.map(describirIdentidad),
      ...pos.todosLosEventos.map(describirComanda),
    ].sort((a, b) => b.ts - a.ts),
  );
</script>

<div class="velo" role="presentation" onclick={onCerrar}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Bitácora">
  <header>
    <h2>Bitácora</h2>
    <span class="conteo">{entradas.length} registros</span>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
  </header>

  <p class="nota">
    El registro de auditoría es el propio event log: inmutable, con quién, qué,
    en qué dispositivo y a qué hora.
  </p>

  <div class="lista">
    {#each entradas as entrada (entrada.id)}
      <div class="entrada {entrada.tono}">
        <span class="hora">{hora(entrada.ts)}</span>
        <span class="actor">{entrada.actor}</span>
        <span class="texto">{entrada.texto}</span>
      </div>
    {:else}
      <p class="vacia">Todavía no hay registros.</p>
    {/each}
  </div>
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 30;
  }
  .panel {
    position: fixed;
    z-index: 31;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.1rem 1.5rem 0.6rem;
  }
  h2 {
    flex: 1;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .conteo {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .nota {
    padding: 0 1.5rem 0.85rem;
    font-size: 0.8rem;
    color: var(--gris);
    border-bottom: 1px solid var(--borde);
  }
  .lista {
    overflow-y: auto;
    padding: 0.5rem 1.5rem 1.5rem;
  }
  .entrada {
    display: flex;
    gap: 0.85rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.88rem;
    align-items: baseline;
  }
  .hora {
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    color: var(--gris);
    flex: none;
    width: 3rem;
  }
  .actor {
    font-weight: 600;
    flex: none;
    min-width: 6rem;
  }
  .texto {
    flex: 1;
    color: var(--pizarra);
  }
  .entrada.alerta .texto {
    color: var(--peligro);
    font-weight: 500;
  }
  .entrada.acento .texto {
    color: var(--acento);
    font-weight: 500;
  }
  .vacia {
    padding: 1.5rem 0;
    text-align: center;
    color: var(--gris);
    font-size: 0.9rem;
  }
</style>
