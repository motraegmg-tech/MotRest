<script lang="ts">
  /**
   * M9 · Bitácora de auditoría.
   *
   * No es una tabla aparte: es el PROPIO event log leído al derecho, como manda
   * el TRD §10 ("el event log es la bitácora inmutable"). Fusiona los eventos de
   * identidad con los de operación y los ordena por el reloj del dispositivo.
   */
  import { etiquetaAccion, type EventoComanda, type EventoIdentidad } from "@motrest/dominio";
  import { hora } from "../../formato";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  type Tono = "normal" | "alerta" | "acento";
  type Entrada = { id: string; ts: number; actor: string; texto: string; tono: Tono };

  let filtro = $state<"todo" | "alertas">("todo");

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
      case "usuario_bloqueado":
        return { ...base, actor: sesion.nombreDe(ev.usuario_id),
          texto: `Cuenta bloqueada tras ${ev.intentos} intentos fallidos`, tono: "alerta" };
      case "usuario_desbloqueado":
        return { ...base, actor: sesion.nombreDe(ev.desbloqueado_por),
          texto: `Desbloqueó la cuenta de ${sesion.nombreDe(ev.usuario_id)}`, tono: "acento" };
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

  const todas = $derived(
    [
      ...sesion.eventos.map(describirIdentidad),
      ...pos.todosLosEventos.map(describirComanda),
    ].sort((a, b) => b.ts - a.ts),
  );

  const entradas = $derived(filtro === "alertas" ? todas.filter((e) => e.tono === "alerta") : todas);
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Bitácora</h1>
      <p class="sub">
        El registro de auditoría es el propio event log: inmutable, con quién, qué,
        en qué dispositivo y a qué hora.
      </p>
    </div>
    <div class="filtros">
      <button class:on={filtro === "todo"} onclick={() => (filtro = "todo")}>
        Todo ({todas.length})
      </button>
      <button class:on={filtro === "alertas"} onclick={() => (filtro = "alertas")}>
        Alertas ({todas.filter((e) => e.tono === "alerta").length})
      </button>
    </div>
  </div>

  <div class="lista">
    {#each entradas as entrada (entrada.id)}
      <div class="entrada {entrada.tono}">
        <span class="hora">{hora(entrada.ts)}</span>
        <span class="actor">{entrada.actor}</span>
        <span class="texto">{entrada.texto}</span>
      </div>
    {:else}
      <p class="vacia">No hay registros que mostrar.</p>
    {/each}
  </div>
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 62rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 38rem;
  }
  .filtros {
    display: flex;
    gap: 0.3rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.2rem;
  }
  .filtros button {
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
  }
  .filtros button.on {
    background: var(--acento);
    color: #fff;
  }
  .lista {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 0.25rem 1.25rem;
  }
  .entrada {
    display: flex;
    gap: 0.85rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.89rem;
    align-items: baseline;
  }
  .entrada:last-child {
    border-bottom: none;
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
    min-width: 7rem;
  }
  .texto {
    flex: 1;
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
