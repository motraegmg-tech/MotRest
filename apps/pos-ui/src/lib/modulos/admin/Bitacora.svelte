<script lang="ts">
  /**
   * M9 · Bitácora de auditoría.
   *
   * No es una tabla aparte: es el PROPIO event log leído al derecho, como manda
   * el TRD §10 ("el event log es la bitácora inmutable"). Fusiona los eventos de
   * identidad con los de operación y los ordena por el reloj del dispositivo.
   */
  import {
    deCentavos,
    etiquetaAccion,
    etiquetaFormaPago,
    type EventoComanda,
    type EventoIdentidad,
  } from "@motrest/dominio";
  import { hora, mxn } from "../../formato";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { socios } from "../../socios.svelte";

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
        // Se distingue el «Salir» de una persona del cierre que hace sola la
        // terminal desatendida: si no, el histórico le apunta a alguien un
        // cierre que no hizo.
        return { ...base, actor: sesion.nombreDe(ev.usuario_id),
          texto: ev.motivo === "inactividad"
            ? "Sesión cerrada sola · terminal sin usarse"
            : "Cerró sesión",
          tono: "normal" };
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
      /*
       * En alerta, y con el nombre que traía el evento.
       *
       * En alerta porque no se deshace y porque es lo que hay que poder revisar
       * si mañana falta alguien de la plantilla. Y con el nombre del evento
       * —no resuelto contra la lista— porque justamente ese usuario ya no está
       * en ella: preguntar por él devolvería un identificador ilegible.
       */
      case "usuario_eliminado":
        return { ...base, actor: sesion.nombreDe(ev.eliminado_por),
          texto: `Eliminó en definitiva al usuario ${ev.nombre}`, tono: "alerta" };
      case "credencial_cambiada":
        return { ...base, texto: `Cambió su ${ev.tipo_credencial}`, tono: "acento" };
      // En alerta a propósito: es el único cambio de credencial que NO firma
      // otra persona. Si el dueño no lo reconoce, hay que actuar.
      case "acceso_recuperado":
        return { ...base, actor: sesion.nombreDe(ev.usuario_id),
          texto: "Recuperó el acceso con el código de rescate", tono: "alerta" };
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
      case "orden_identificada":
        return { ...base, texto: `Pedido a nombre de ${ev.nombre}`, tono: "normal" };
      /*
       * En alerta desde la SEGUNDA copia. Pedir otra copia es normal; pedir
       * tres es el patrón de quien cobra dos veces con el mismo papel.
       */
      case "ticket_reimpreso":
        return { ...base,
          texto: `Reimprimió el ticket (copia ${ev.numero})`,
          tono: ev.numero > 1 ? "alerta" : "acento" };
      // En alerta: una cuenta que se cobró y se volvió a abrir merece una
      // segunda mirada al revisar el corte.
      case "cuenta_reabierta":
        return { ...base,
          texto: `Reabrió una cuenta cobrada · ${ev.motivo}${ev.autorizador_id ? ` · autorizó ${sesion.nombreDe(ev.autorizador_id)}` : ""}`,
          tono: "alerta" };
      case "item_modificado":
        return { ...base,
          texto: ev.cantidad !== undefined
            ? `Cambió la cantidad de un renglón a ${ev.cantidad}`
            : ev.notas
              ? `Cambió las indicaciones de cocina: "${ev.notas}"`
              : "Retiró las indicaciones de cocina de un renglón",
          tono: "normal" };
      /*
       * Queda en bitácora a propósito. Si un plato sale mal por una indicación
       * tardía, la diferencia entre "no le avisaron" y "le avisaron y no lo
       * aplicó" está exactamente aquí.
       */
      case "cambio_visto":
        return { ...base, texto: "Cocina se dio por enterada de un cambio", tono: "normal" };
      case "item_transferido":
        return { ...base, texto: "Traspasó un renglón a otra cuenta", tono: "acento" };
      case "item_recibido":
        return { ...base, texto: `Recibió ${ev.renglon.descripcion} de otra cuenta`, tono: "acento" };
      case "descuento_aplicado":
        return { ...base,
          texto: `Aplicó un descuento de ${
            ev.modo === "porcentaje" ? `${Math.round(ev.valor * 100)} %` : mxn(deCentavos(ev.valor))
          } (${ev.motivo})${ev.autorizador_id ? ` · autorizó ${sesion.nombreDe(ev.autorizador_id)}` : ""}`,
          tono: "alerta" };
      case "cortesia_otorgada":
        return { ...base,
          texto: `Otorgó una cortesía (${ev.motivo})${ev.autorizador_id ? ` · autorizó ${sesion.nombreDe(ev.autorizador_id)}` : ""}`,
          tono: "alerta" };
      // Retirar una cortesía SUBE la cuenta: no es una alerta, es la corrección
      // de un botón pulsado por error. Queda registrada igual.
      case "cortesia_retirada":
        return { ...base, texto: "Retiró una cortesía", tono: "acento" };
      case "propina_registrada":
        return { ...base, texto: `Registró propina de ${mxn(ev.monto)}`, tono: "normal" };
      case "items_enviados":
        return { ...base, texto: `Envió ${ev.renglon_ids.length} platillo(s) a cocina`, tono: "normal" };
      case "item_en_marcha":
        return { ...base, texto: "Cocina tomó un platillo", tono: "normal" };
      case "item_listo":
        return { ...base, texto: "Platillo listo", tono: "normal" };
      case "item_entregado":
        return { ...base, texto: "Platillo entregado", tono: "normal" };
      case "pago_registrado":
        return { ...base,
          texto:
            ev.forma === "socio"
              ? `Cargó ${mxn(ev.monto)} a la bolsa de ${socios.nombreDe(ev.socio_id ?? "")}${ev.autorizador_id ? ` · autorizó ${sesion.nombreDe(ev.autorizador_id)}` : ""}`
              : `Cobró ${mxn(ev.monto)} en ${etiquetaFormaPago(ev.forma)}`,
          // El consumo de socio se marca: el socio se entera a fin de mes, y
          // para entonces la única forma de comprobarlo es esta línea.
          tono: ev.forma === "socio" ? "alerta" : "acento" };
      case "cuenta_cerrada":
        return { ...base, texto: "Cerró la cuenta", tono: "acento" };
      // Una mesa que se abrió y se soltó sin consumo. No es una venta y no sale
      // en ningún reporte, así que este renglón es el único sitio donde consta.
      case "orden_anulada":
        return { ...base,
          texto: `Liberó la mesa sin consumo${ev.motivo ? ` · ${ev.motivo}` : ""}`,
          tono: "normal" };
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
