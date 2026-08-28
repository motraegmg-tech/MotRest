<script lang="ts">
  /**
   * M5 · Los últimos tickets cobrados, y cómo deshacer uno.
   *
   * ## La pregunta que responde
   *
   * «Se cobró mal esa mesa: ¿cómo lo echo para atrás?» Hasta ahora no había
   * respuesta. Reabrir la cuenta desde el salón la dejaba viva otra vez con el
   * cobro dentro, y quien entonces cancelaba los renglones —lo natural— dejaba
   * la cuenta en **total 0 con 433 pesos pagados**: saldo negativo, la mesa
   * ocupada para siempre y ninguna pantalla desde la que arreglarlo. Le pasó a
   * la mesa 8 de Rodizio el 15 de agosto de 2026.
   *
   * ## Por qué vive en Finanzas y no en el salón
   *
   * Porque no es una corrección de servicio, es dinero que sale del cajón. El
   * mesero que se equivocó al cobrar reabre y vuelve a cobrar, y eso sigue en la
   * mesa. Deshacer la venta entera —devolver el efectivo, sacarla del corte y
   * del reporte del día— lo revisa quien lleva las cuentas, con la lista de lo
   * cobrado delante. Aquí es donde se mira esa lista.
   *
   * ## Lo que NO hace
   *
   * No borra nada. Registra la devolución sobre el cobro, que sigue ahí. En la
   * bitácora quedan las dos cosas y quién las firmó, que es exactamente lo que
   * separa una corrección de un desfalco.
   */
  import {
    etiquetaFormaPago,
    mesasDeComanda,
    totalesComanda,
    type Centavos,
    type EstadoComanda,
  } from "@motrest/dominio";
  import { hora, mxn } from "../../formato";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  /** Cuántos tickets se listan. Un servicio completo cabe sin desplazar. */
  const VENTANA = 40;

  const puedeCancelar = $derived(sesion.puedeVer("pos.cuenta.reabrir"));

  interface Fila {
    comanda: EstadoComanda;
    folio: string;
    mesa: string;
    mesero: string;
    cuando: number;
    total: Centavos;
    propina: Centavos;
    pagado: Centavos;
    saldo: Centavos;
    devuelto: Centavos;
    formas: string;
    /** Qué le pasa a este ticket: es lo que decide el color del renglón. */
    estado: "cobrada" | "cancelada" | "abierta";
    /** Cobrada y reabierta: la que se quedó a medias. */
    aRevisar: boolean;
  }

  const filas = $derived.by<Fila[]>(() =>
    pos.ticketsCobrados.slice(0, VENTANA).map((c) => {
      const t = totalesComanda(c);
      return {
        comanda: c,
        folio: c.orden_id.slice(-8).toUpperCase(),
        // La cuenta de un grupo grande ocupa varias mesas y aquí se nombra
        // igual que en el salón y en el ticket impreso: quien viene a cancelar
        // una venta la busca por el nombre que tiene delante, en papel.
        mesa: plano.etiquetaMesas(mesasDeComanda(c)),
        mesero: sesion.nombreDe(c.mesero_id),
        cuando: c.cerrada_ts ?? c.abierta_ts,
        total: t.total,
        propina: t.propina,
        pagado: t.pagado,
        saldo: t.saldo,
        devuelto: t.devuelto,
        formas:
          [...new Set(c.pagos.map((p) => etiquetaFormaPago(p.forma)))].join(" + ") || "—",
        estado: c.cancelada ? "cancelada" : c.cerrada ? "cobrada" : "abierta",
        /*
         * Se señala la cuenta cobrada que volvió a abrirse y sigue abierta: es
         * exactamente la que se quedó a medias. Mientras esté así, ocupa una
         * mesa que nadie puede usar y arrastra un saldo que no cuadra.
         */
        aRevisar: !c.cerrada && c.pagos.length > 0,
      };
    }),
  );

  const pendientes = $derived(filas.filter((f) => f.aRevisar).length);

  // --- Cancelación ------------------------------------------------------------------

  let cancelando = $state<Fila | null>(null);
  let motivo = $state("");
  let error = $state("");

  function abrir(fila: Fila) {
    cancelando = fila;
    motivo = "";
    error = "";
  }

  async function confirmar() {
    if (!cancelando) return;
    if (motivo.trim().length < 3) {
      error = "Escribe por qué se cancela esta venta: queda en la bitácora";
      return;
    }
    const ok = await pos.cancelarVenta(cancelando.comanda.orden_id, motivo);
    if (ok) cancelando = null;
    else error = "No se canceló: falta la autorización o la venta ya estaba cancelada";
  }
</script>

<section class="tarjeta">
  <div class="cab">
    <div>
      <h2>Tickets cobrados</h2>
      <p class="nota">
        Lo último que se cobró en el local. Desde aquí se <b>cancela una venta</b>
        cuando se cobró de más, en la mesa equivocada o el cliente se arrepintió:
        el dinero se devuelve, la mesa se libera y la venta deja de contar en el
        corte y en los reportes. El cobro no se borra —queda en la bitácora con
        quién lo deshizo—.
      </p>
    </div>
  </div>

  {#if pendientes > 0}
    <p class="alerta-sup" role="alert">
      <b>{pendientes} {pendientes === 1 ? "cuenta se quedó" : "cuentas se quedaron"} a medias.</b>
      Se cobraron y se volvieron a abrir sin terminar: su mesa sigue ocupada y su
      saldo no cuadra. Cancélalas o vuelve a cobrarlas desde el salón.
    </p>
  {/if}

  <div class="marco-tabla">
    <table>
      <thead>
        <tr>
          <th>Hora</th>
          <th>Mesa</th>
          <th>Folio</th>
          <th>Atendió</th>
          <th class="num">Total</th>
          <th class="num">Propina</th>
          <th>Cobro</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each filas as f (f.comanda.orden_id)}
          <tr class:cancelada={f.estado === "cancelada"} class:revisar={f.aRevisar}>
            <td>{hora(f.cuando)}</td>
            <td><b>{f.mesa}</b></td>
            <td class="folio">{f.folio}</td>
            <td class="tenue">{f.mesero}</td>
            <td class="num">{mxn(f.total)}</td>
            <td class="num tenue">{f.propina > 0 ? mxn(f.propina) : "—"}</td>
            <td class="tenue">{f.formas}</td>
            <td>
              {#if f.estado === "cancelada"}
                <span class="marca anulada">Cancelada</span>
                {#if f.devuelto > 0}
                  <small class="devuelto">se devolvió {mxn(f.devuelto)}</small>
                {/if}
              {:else if f.aRevisar}
                <span class="marca revisar-marca">Reabierta</span>
                <small class="devuelto">saldo {mxn(f.saldo)}</small>
              {:else}
                <span class="marca ok">Cobrada</span>
                {#if f.comanda.reabierta}<small class="devuelto">se reabrió</small>{/if}
              {/if}
            </td>
            <td class="acciones">
              {#if puedeCancelar && f.estado !== "cancelada"}
                <button class="mini peligro" onclick={() => abrir(f)}>Cancelar venta</button>
              {/if}
            </td>
          </tr>
        {:else}
          <tr><td colspan="9" class="vacio">Todavía no se ha cobrado ninguna cuenta.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<!--
  El diálogo dice EN PESOS lo que hay que sacar del cajón, y por qué forma.
  Cancelar una venta con tarjeta no se resuelve abriendo la caja: hay que
  reversar en la terminal, y quien pulsa el botón tiene que saberlo antes.
-->
{#if cancelando}
  <div class="velo" role="presentation" onclick={() => (cancelando = null)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Cancelar la venta">
    <h2>Cancelar la venta de la mesa {cancelando.mesa}</h2>
    <p class="quien">
      Folio {cancelando.folio} · {mxn(cancelando.total)}
      {#if cancelando.propina > 0}+ {mxn(cancelando.propina)} de propina{/if}
    </p>

    {#if cancelando.pagado > 0}
      <div class="devolver">
        <span class="rotulo">Hay que devolver</span>
        <b class="cifra">{mxn(cancelando.pagado)}</b>
        <ul>
          {#each cancelando.comanda.pagos as pago, i (i)}
            <li>{etiquetaFormaPago(pago.forma)} · {mxn(pago.monto)}</li>
          {/each}
        </ul>
        <p class="ojo">
          Lo cobrado con tarjeta se reversa en la terminal bancaria, no aquí.
          Esta pantalla registra la devolución para que el corte y los reportes
          cuadren.
        </p>
      </div>
    {:else}
      <p class="explica">
        Esta cuenta no tiene ningún pago registrado, así que no hay dinero que
        devolver: solo se libera la mesa y la venta deja de contar.
      </p>
    {/if}

    <label>
      <span>¿Por qué se cancela?</span>
      <input
        bind:value={motivo}
        placeholder="Se cobró la mesa equivocada"
        autocomplete="off"
      />
      <small class="pista">Queda en la bitácora, junto con quién lo autorizó.</small>
    </label>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (cancelando = null)}>No cancelar</button>
      <button class="peligro-solido" onclick={confirmar}>Cancelar la venta</button>
    </div>
  </div>
{/if}

<style>
  .tarjeta {
    background: var(--superficie, #fff);
    border: 1px solid var(--borde);
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .cab {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.85rem;
  }
  .cab > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .nota {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.55;
    margin-top: 0.2rem;
  }
  .alerta-sup {
    background: #fff6f5;
    border: 1px solid #e0392b;
    border-radius: var(--r-sm);
    padding: 0.6rem 0.8rem;
    font-size: 0.83rem;
    line-height: 1.5;
    margin-bottom: 0.85rem;
  }
  .alerta-sup b {
    color: #e0392b;
  }
  .marco-tabla {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
    min-width: 48rem;
  }
  th,
  td {
    border-bottom: 1px solid var(--borde);
    padding: 0.45rem 0.4rem;
    text-align: left;
    vertical-align: middle;
  }
  th {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .tenue {
    color: var(--gris);
  }
  .folio {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--gris);
  }
  tr.cancelada td {
    opacity: 0.6;
  }
  tr.cancelada .folio,
  tr.cancelada .num {
    text-decoration: line-through;
  }
  tr.revisar {
    background: #fff6f5;
  }
  .marca {
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 999px;
    padding: 0.12rem 0.5rem;
  }
  .marca.ok {
    background: color-mix(in srgb, var(--acento) 14%, transparent);
    color: var(--acento);
  }
  .marca.anulada {
    background: #eceff1;
    color: var(--gris);
  }
  .marca.revisar-marca {
    background: #e0392b;
    color: #fff;
  }
  .devuelto {
    display: block;
    font-size: 0.7rem;
    color: var(--gris);
  }
  .acciones {
    text-align: right;
    white-space: nowrap;
  }
  .vacio {
    text-align: center;
    color: var(--gris);
    font-style: italic;
    padding: 1.25rem 0;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini.peligro {
    color: #e0392b;
  }
  .mini.peligro:hover {
    border-color: #e0392b;
  }

  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .dialogo {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(30rem, calc(100vw - 2rem));
    background: #fff;
    border-radius: var(--r-md);
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: var(--sombra-lg);
  }
  .dialogo h2 {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .quien {
    color: var(--acento);
    font-weight: 600;
    font-size: 0.9rem;
    margin-top: -0.4rem;
  }
  .explica {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .devolver {
    background: #fff6f5;
    border: 1px solid #e0392b;
    border-radius: var(--r-sm);
    padding: 0.7rem 0.85rem;
  }
  .devolver .rotulo {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .devolver .cifra {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    font-weight: 700;
    color: #e0392b;
    line-height: 1.15;
  }
  .devolver ul {
    list-style: none;
    margin-top: 0.35rem;
    font-size: 0.82rem;
    color: var(--pizarra);
  }
  .devolver .ojo {
    margin-top: 0.45rem;
    font-size: 0.76rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .dialogo label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dialogo label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .dialogo input {
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
  }
  .dialogo input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .error {
    color: #e0392b;
    font-size: 0.85rem;
    line-height: 1.45;
    font-weight: 600;
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: #fff;
    color: var(--pizarra);
    padding: 0.6rem 1rem;
    font-weight: 600;
  }
  .peligro-solido {
    background: #e0392b;
    border: 1.5px solid #e0392b;
    border-radius: var(--r-sm);
    color: #fff;
    padding: 0.6rem 1rem;
    font-weight: 600;
  }
</style>
