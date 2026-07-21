<script lang="ts">
  /**
   * M5 · Finanzas — datos fiscales del restaurante y comprobantes emitidos.
   *
   * El timbrado requiere contratar un PAC y tener el Certificado de Sello
   * Digital del SAT. Mientras no existan, los comprobantes se generan y quedan
   * en cola: el ticket sale al momento y la factura espera.
   */
  import {
    REGIMENES_FISCALES,
    etiquetaEstadoCfdi,
    problemaRfc,
    type DatosEmisor,
    type RegistroCfdi,
  } from "@motrest/dominio";
  import { fiscal } from "../fiscal.svelte";
  import { hora, mxn } from "../formato";
  import { sesion } from "../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("fin.factura.emitir"));

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

  <!-- Aviso honesto sobre el estado del timbrado -->
  <div class="aviso">
    <b>Timbrado pendiente de conectar</b>
    <p>
      Todo lo que depende del restaurante está resuelto: los comprobantes se
      generan completos y validados, listos para enviarse. Para timbrarlos ante
      el SAT hacen falta dos cosas que se contratan aparte: un <b>PAC</b>
      (Facturama, SW Sapien o Finkok) y tu <b>Certificado de Sello Digital</b>.
      En cuanto existan, la cola se timbra sola.
    </p>
  </div>

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
            <button class="mini" onclick={() => (verXml = registro)}>Ver XML</button>
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
