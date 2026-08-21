<script lang="ts">
  /**
   * M5 · Finanzas — datos fiscales del restaurante y comprobantes emitidos.
   *
   * El timbrado requiere contratar un PAC y tener el Certificado de Sello
   * Digital del SAT. Mientras no existan, los comprobantes se generan y quedan
   * en cola: el ticket sale al momento y la factura espera.
   */
  import {
    MOTIVOS_CANCELACION,
    REGIMENES_FISCALES,
    etiquetaEstadoCfdi,
    motivoRequiereSustitucion,
    problemaRfc,
    type DatosEmisor,
    type RegistroCfdi,
  } from "@motrest/dominio";
  import { fiscal } from "../fiscal.svelte";
  import { impresion } from "../impresion.svelte";
  import { hora, mxn } from "../formato";
  import { sesion } from "../sesion/sesion.svelte";
  import { sync } from "../sync.svelte";
  import Caja from "./finanzas/Caja.svelte";
  import CortePorFechas from "./finanzas/CortePorFechas.svelte";
  import Csd from "./finanzas/Csd.svelte";
  import Resultado from "./finanzas/Resultado.svelte";
  import TicketsCobrados from "./finanzas/TicketsCobrados.svelte";
  import VentasPorDia from "./finanzas/VentasPorDia.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("fin.factura.emitir"));

  /*
   * Se pregunta al Hub al abrir la pantalla. El estado del CSD vive en la caja,
   * no en esta terminal: preguntarlo cada vez evita mostrar un certificado que
   * ya retiraron desde otro dispositivo.
   */
  $effect(() => {
    const id = sesion.usuarioActual?.id;
    if (id && sync.estado !== "isla") sync.pedirEstadoFiscal(id, true);
  });

  let editando = $state(false);
  let borrador = $state<DatosEmisor>({ ...fiscal.emisor });
  let error = $state("");
  let verXml = $state<RegistroCfdi | null>(null);

  function abrirEdicion() {
    borrador = { ...fiscal.emisor };
    error = "";
    editando = true;
  }

  async function guardar() {
    const problema = problemaRfc(borrador.rfc);
    if (problema) {
      error = problema;
      return;
    }
    if (borrador.nombre.trim().length < 3) {
      error = "Escribe la razón social tal como aparece en tu constancia fiscal";
      return;
    }
    if (!/^\d{5}$/.test(borrador.codigo_postal.trim())) {
      error = "El código postal debe tener cinco dígitos";
      return;
    }
    await fiscal.guardarEmisor(borrador);
    editando = false;
    error = "";
  }

  function copiarXml(registro: RegistroCfdi) {
    void navigator.clipboard?.writeText(fiscal.xmlDe(registro.comprobante));
  }

  /**
   * Imprime la representación del comprobante.
   *
   * Timbrado, sale la factura con su QR de verificación del SAT; sin timbrar,
   * un borrador para revisar. La vista previa hace de papel cuando no hay
   * impresora configurada.
   */
  function imprimirFactura(registro: RegistroCfdi) {
    impresion.factura(fiscal.representacionDe(registro), `${registro.serie}-${registro.folio}`);
  }

  // --- Cancelación de un CFDI ---
  let cancelando = $state<RegistroCfdi | null>(null);
  let motivoCancel = $state("02");
  let sustitucionCancel = $state("");
  let errorCancel = $state("");

  const requiereSustitucion = $derived(motivoRequiereSustitucion(motivoCancel));

  function abrirCancelacion(registro: RegistroCfdi) {
    cancelando = registro;
    motivoCancel = "02";
    sustitucionCancel = "";
    errorCancel = "";
  }

  function confirmarCancelacion() {
    if (!cancelando) return;
    const r = fiscal.solicitarCancelacion(cancelando.cfdi_id, motivoCancel, {
      uuidSustitucion: sustitucionCancel,
      autorizadorId: sesion.usuarioActual?.id,
    });
    if (r.ok) {
      cancelando = null;
    } else {
      errorCancel = r.error;
    }
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Finanzas y facturación</h1>
      <p class="sub">
        Comprobantes CFDI 4.0 del restaurante. Se generan al cobrar y quedan en
        cola hasta que haya un PAC conectado.
      </p>
    </div>
  </div>

  <!--
    El aviso solo aparece mientras falte algo. Cuando el CSD está cargado y hay
    PAC, dejar un cartel de "pendiente" sería mentir sobre el estado del sistema.
  -->
  {#if !sync.fiscal?.csd_cargado || !sync.fiscal?.pac}
    <div class="aviso">
      <b>Falta un paso para timbrar</b>
      <p>
        Los comprobantes ya se generan completos y validados, y esperan en la
        cola. Para timbrarlos ante el SAT hacen falta dos cosas que se contratan
        aparte:
        {#if !sync.fiscal?.csd_cargado}tu <b>Certificado de Sello Digital</b>{/if}
        {#if !sync.fiscal?.csd_cargado && !sync.fiscal?.pac}y{/if}
        {#if !sync.fiscal?.pac}un <b>PAC</b> que timbre{/if}. En cuanto existan,
        la cola se timbra sola.
      </p>
    </div>
  {/if}

  <!--
    El resultado va PRIMERO: es lo que el dueño abre a ver. Los datos fiscales y
    los comprobantes se consultan de vez en cuando; "¿ganamos hoy?", todos los días.
  -->
  <Resultado />

  <!--
    Y justo debajo, la misma pregunta pero hacia atrás: qué se hizo cada día y
    por dónde entró. Va antes del corte porque se consulta más —cada mañana— y
    porque es donde se ve si el efectivo del cajón de ayer tenía sentido.
  -->
  <VentasPorDia />

  <!--
    El detalle de esas cifras, ticket por ticket, y la única pantalla desde la
    que se puede deshacer un cobro. Va pegada a «Ventas por día» porque se llega
    a ella desde ahí: se ve un día que no cuadra y se baja a buscar cuál fue.
  -->
  <TicketsCobrados />

  <!--
    El corte de caja va junto al resultado: ambos se hacen al cerrar el día. El
    resultado dice si se ganó; el corte, si el efectivo del cajón cuadra.
  -->
  <Caja />

  <!--
    Y justo debajo, el mismo corte pero hacia atrás: un día pasado o varios
    juntos. Va pegado a la caja porque se llega desde ahí — se cierra el turno,
    el papel no sale, y hay que volver a sacarlo.
  -->
  <CortePorFechas />

  <!-- Datos fiscales del emisor -->
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Datos fiscales del restaurante</h2>
      {#if puedeEditar && !editando}
        <button class="mini" onclick={abrirEdicion}>
          {fiscal.emisorCompleto ? "Editar" : "Completar"}
        </button>
      {/if}
    </div>

    {#if editando}
      <div class="campos">
        <label>
          <span>RFC</span>
          <input bind:value={borrador.rfc} placeholder="XAXX010101000" maxlength="13" />
        </label>
        <label class="ancho">
          <span>Razón social (exacta, como en la constancia)</span>
          <input bind:value={borrador.nombre} placeholder="MI RESTAURANTE SA DE CV" />
        </label>
        <label>
          <span>Código postal fiscal</span>
          <input bind:value={borrador.codigo_postal} placeholder="44100" maxlength="5" />
        </label>
        <label class="ancho">
          <span>Régimen fiscal</span>
          <select bind:value={borrador.regimen_fiscal}>
            {#each REGIMENES_FISCALES as r (r.clave)}
              <option value={r.clave}>{r.clave} · {r.descripcion}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Nombre comercial (solo para el ticket)</span>
          <input bind:value={borrador.nombre_comercial} placeholder="Rodizio Centro" />
        </label>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="botones">
        <button class="secundario" onclick={() => (editando = false)}>Cancelar</button>
        <button class="principal" onclick={guardar}>Guardar</button>
      </div>
    {:else if fiscal.emisorCompleto}
      <dl class="datos">
        <div><dt>RFC</dt><dd>{fiscal.emisor.rfc}</dd></div>
        <div><dt>Razón social</dt><dd>{fiscal.emisor.nombre}</dd></div>
        <div><dt>Régimen</dt><dd>{fiscal.emisor.regimen_fiscal}</dd></div>
        <div><dt>CP fiscal</dt><dd>{fiscal.emisor.codigo_postal}</dd></div>
      </dl>
    {:else}
      <p class="faltante">
        Sin estos datos no se puede emitir ninguna factura. Los encuentras en tu
        Constancia de Situación Fiscal.
      </p>
    {/if}
  </section>

  <!--
    El CSD va DESPUÉS de los datos fiscales y no antes: el certificado se coteja
    contra el RFC del emisor, así que ese dato tiene que existir primero.
  -->
  {#if fiscal.emisorCompleto}
    <Csd rfcEmisor={fiscal.emisor.rfc} />
  {/if}

  <!-- Comprobantes -->
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Comprobantes</h2>
      <span class="resumen">
        {fiscal.cola.length} en cola · {fiscal.timbrados.length} timbrados
        {#if fiscal.atorados.length > 0}
          · <b class="alerta">{fiscal.atorados.length} requieren atención</b>
        {/if}
      </span>
    </div>

    {#if fiscal.registros.length === 0}
      <p class="faltante">
        Todavía no se ha emitido ninguna factura. Al cobrar una cuenta aparece la
        opción de facturarla.
      </p>
    {:else}
      <div class="lista">
        {#each fiscal.registros as registro (registro.cfdi_id)}
          <div class="cfdi {registro.estado}">
            <span class="folio">{registro.serie}-{registro.folio}</span>
            <span class="receptor">
              <b>{registro.comprobante.receptor.nombre}</b>
              <small>{registro.comprobante.receptor.rfc} · {hora(registro.generado_ts)}</small>
            </span>
            <span class="importe">{mxn(registro.comprobante.total)}</span>
            <span class="estado">{etiquetaEstadoCfdi(registro.estado)}</span>
            <button class="mini" onclick={() => imprimirFactura(registro)}>Imprimir</button>
            <button class="mini" onclick={() => (verXml = registro)}>Ver XML</button>
            {#if puedeEditar && registro.estado === "timbrado"}
              <button class="mini peligro" onclick={() => abrirCancelacion(registro)}>Cancelar</button>
            {/if}
          </div>
          {#if registro.error}
            <p class="error-cfdi">{registro.error} · intento {registro.intentos}</p>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
</div>

{#if verXml}
  <div class="velo" role="presentation" onclick={() => (verXml = null)}></div>
  <div class="visor" role="dialog" aria-modal="true" aria-label="XML del comprobante">
    <header>
      <h2>{verXml.serie}-{verXml.folio}</h2>
      <button class="mini" onclick={() => copiarXml(verXml!)}>Copiar</button>
      <button class="cerrar" onclick={() => (verXml = null)} aria-label="Cerrar">×</button>
    </header>
    <p class="nota-xml">
      Esto es exactamente lo que se le envía al PAC. Faltan el Sello y el
      Certificado, que se agregan con el CSD, y el Timbre Fiscal Digital, que
      incorpora el PAC.
    </p>
    <pre>{fiscal.xmlDe(verXml.comprobante)}</pre>
  </div>
{/if}

<!-- Cancelación de un CFDI, con el motivo del SAT -->
{#if cancelando}
  <div class="velo" role="presentation" onclick={() => (cancelando = null)}></div>
  <div class="dialogo-cancel" role="dialog" aria-modal="true" aria-label="Cancelar comprobante">
    <h2>Cancelar {cancelando.serie}-{cancelando.folio}</h2>
    <p class="quien">{cancelando.comprobante.receptor.nombre} · {mxn(cancelando.comprobante.total)}</p>
    <p class="explica">
      La factura se cancela ante el SAT, no aquí: se manda la solicitud y el
      resultado vuelve en un momento. Elige el motivo correcto —el SAT rechaza
      la cancelación si no aplica—.
    </p>

    <label>
      <span>Motivo de cancelación</span>
      <select bind:value={motivoCancel}>
        {#each MOTIVOS_CANCELACION as m (m.clave)}
          <option value={m.clave}>{m.clave} · {m.descripcion}</option>
        {/each}
      </select>
    </label>

    {#if requiereSustitucion}
      <label>
        <span>Folio fiscal (UUID) del comprobante que lo sustituye</span>
        <input
          bind:value={sustitucionCancel}
          placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
          autocomplete="off"
        />
        <small class="pista">
          El motivo 01 es para un comprobante con errores: debe existir ya la
          factura correcta que lo reemplaza.
        </small>
      </label>
    {/if}

    {#if errorCancel}<p class="error" role="alert">{errorCancel}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (cancelando = null)}>No cancelar</button>
      <button class="peligro-solido" onclick={confirmarCancelacion}>Solicitar cancelación</button>
    </div>
  </div>
{/if}

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 62rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 42rem;
  }
  .aviso {
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 1.1rem;
    font-size: 0.86rem;
    line-height: 1.55;
  }
  .aviso b {
    color: var(--acento);
  }
  .aviso p {
    margin-top: 0.3rem;
    color: var(--pizarra);
  }
  .aviso p b {
    color: var(--pizarra);
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
  }
  .cabecera-tarjeta {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 0.85rem;
  }
  h2 {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .resumen {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .resumen .alerta {
    color: var(--peligro);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 11rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos input,
  .campos select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .datos {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }
  .datos dt {
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .datos dd {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .faltante {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cfdi {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 0.85rem;
    font-size: 0.88rem;
  }
  .cfdi.timbrado {
    border-color: var(--acento);
  }
  .cfdi.rechazado {
    border-color: var(--peligro);
  }
  .folio {
    font-family: var(--font-titulo);
    font-weight: 700;
    color: var(--acento);
    flex: none;
    min-width: 4.5rem;
  }
  .receptor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .receptor small {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .importe {
    font-weight: 600;
    white-space: nowrap;
  }
  .estado {
    font-size: 0.76rem;
    color: var(--gris);
    white-space: nowrap;
  }
  .error-cfdi {
    font-size: 0.78rem;
    color: var(--peligro);
    padding: 0 0.85rem 0.3rem;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    flex: none;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini.peligro {
    color: #e0392b;
  }
  .mini.peligro:hover {
    border-color: #e0392b;
    color: #e0392b;
  }

  .dialogo-cancel {
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
  .dialogo-cancel h2 {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .dialogo-cancel .quien {
    color: var(--acento);
    font-weight: 600;
    font-size: 0.9rem;
    margin-top: -0.4rem;
  }
  .dialogo-cancel .explica {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .dialogo-cancel label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dialogo-cancel label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .dialogo-cancel select,
  .dialogo-cancel input {
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
  }
  .dialogo-cancel .pista {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.4;
  }
  .dialogo-cancel .error {
    color: #e0392b;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .dialogo-cancel .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .dialogo-cancel .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: #fff;
    color: var(--pizarra);
    padding: 0.6rem 1rem;
    font-weight: 600;
  }
  .dialogo-cancel .peligro-solido {
    background: #e0392b;
    border: 1.5px solid #e0392b;
    border-radius: var(--r-sm);
    color: #fff;
    padding: 0.6rem 1rem;
    font-weight: 600;
  }
  .error {
    margin-top: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.85rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 30;
  }
  .visor {
    position: fixed;
    z-index: 31;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(52rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  .visor header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.4rem 0.6rem;
  }
  .visor h2 {
    flex: 1;
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .nota-xml {
    padding: 0 1.4rem 0.75rem;
    font-size: 0.8rem;
    color: var(--gris);
    border-bottom: 1px solid var(--borde);
  }
  .visor pre {
    margin: 0;
    padding: 1rem 1.4rem 1.4rem;
    overflow: auto;
    font-size: 0.75rem;
    line-height: 1.5;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    color: var(--pizarra);
    white-space: pre;
  }
</style>
