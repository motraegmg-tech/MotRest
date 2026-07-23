<script lang="ts">
  /**
   * El Certificado de Sello Digital y la cola de timbrado.
   *
   * Es la pantalla donde el restaurantero entrega la firma fiscal de su
   * negocio, así que está escrita para alguien que NO es contador: dice qué
   * archivo pedir, avisa de la confusión clásica con la e.firma, y cuando algo
   * falla explica qué hacer en vez de mostrar un código.
   *
   * Los archivos nunca se quedan en esta pantalla: viajan cifrados al Hub de la
   * caja, que es el único que sella. Ninguna tablet guarda el CSD.
   */
  import type { Centavos } from "@motrest/dominio";
  import { sesion } from "../../sesion/sesion.svelte";
  import { sync } from "../../sync.svelte";
  import { mxn } from "../../formato";

  const puedeAdministrar = $derived(sesion.puedeOperar("fin.csd.administrar"));
  const estado = $derived(sync.fiscal);
  const empleadoId = $derived(sesion.usuarioActual?.id ?? "");

  let cer = $state<File | null>(null);
  let key = $state<File | null>(null);
  let contrasena = $state("");
  let mostrandoFormulario = $state(false);
  let confirmandoRetiro = $state(false);
  let enviando = $state(false);

  /*
   * El RFC del emisor no se teclea aquí: ya está en los datos fiscales del
   * restaurante. Pedirlo dos veces invita a que no coincidan, y entonces el CSD
   * se rechazaría por un error de captura.
   */
  const { rfcEmisor }: { rfcEmisor: string } = $props();

  const listo = $derived(cer !== null && key !== null && contrasena.length > 0);

  /** Aviso de vencimiento con antelación suficiente para tramitar la renovación. */
  const porVencer = $derived(
    estado?.csd_cargado && (estado.dias_restantes ?? 999) < 60,
  );

  async function instalar() {
    if (!cer || !key || !listo) return;
    enviando = true;
    try {
      sync.instalarCsd({
        empleadoId,
        cer: new Uint8Array(await cer.arrayBuffer()),
        key: new Uint8Array(await key.arrayBuffer()),
        contrasena,
        rfcEmisor,
      });
      // La contraseña se borra de la pantalla en cuanto sale de ella.
      contrasena = "";
    } finally {
      enviando = false;
    }
  }

  function retirar() {
    sync.desinstalarCsd(empleadoId);
    confirmandoRetiro = false;
  }

  function fecha(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "long" }) : "—";
  }
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Certificado de Sello Digital</h2>
    {#if estado?.csd_cargado && puedeAdministrar && !mostrandoFormulario}
      <button class="mini" onclick={() => (mostrandoFormulario = true)}>Reemplazar</button>
    {/if}
  </div>

  {#if !sync.fiscal}
    <p class="vacio">
      Conecta esta terminal al Hub del local para ver el certificado. El CSD vive
      en la caja, no en las tablets.
    </p>
  {:else if estado?.csd_cargado && !mostrandoFormulario}
    <dl class="datos">
      <div><dt>RFC</dt><dd>{estado.rfc ?? "—"}</dd></div>
      <div><dt>N.º de certificado</dt><dd class="mono">{estado.no_certificado}</dd></div>
      <div><dt>Vigente hasta</dt><dd>{fecha(estado.valido_hasta)}</dd></div>
      <div>
        <dt>Días restantes</dt>
        <dd class:alerta={porVencer}>{estado.dias_restantes}</dd>
      </div>
    </dl>

    {#if porVencer}
      <p class="alerta-caja" role="alert">
        Este certificado vence pronto. Tramita el nuevo en el portal del SAT: el
        día que caduque, la facturación se detiene.
      </p>
    {/if}

    {#if puedeAdministrar}
      {#if confirmandoRetiro}
        <p class="alerta-caja">
          Al retirarlo, esta caja podrá seguir vendiendo pero <b>no facturar</b>.
          Las facturas pendientes se quedarán en la cola.
        </p>
        <div class="botones">
          <button class="secundario" onclick={() => (confirmandoRetiro = false)}>Cancelar</button>
          <button class="peligro" onclick={retirar}>Retirar el certificado</button>
        </div>
      {:else}
        <button class="enlace" onclick={() => (confirmandoRetiro = true)}>
          Retirar este certificado
        </button>
      {/if}
    {/if}
  {:else if puedeAdministrar}
    <p class="explicacion">
      Sube los dos archivos que te entregó el SAT al tramitar tu
      <b>Certificado de Sello Digital</b>: uno termina en <code>.cer</code> y el
      otro en <code>.key</code>. No es tu e.firma —esa sirve para trámites, no
      para facturar—.
    </p>

    <div class="campos">
      <label>
        <span>Certificado (.cer)</span>
        <input
          type="file"
          accept=".cer"
          onchange={(e) => (cer = e.currentTarget.files?.[0] ?? null)}
        />
      </label>
      <label>
        <span>Llave privada (.key)</span>
        <input
          type="file"
          accept=".key"
          onchange={(e) => (key = e.currentTarget.files?.[0] ?? null)}
        />
      </label>
      <label class="ancho">
        <span>Contraseña de la llave privada</span>
        <input
          type="password"
          bind:value={contrasena}
          autocomplete="off"
          placeholder="La que definiste al tramitar el CSD"
        />
      </label>
    </div>

    <p class="nota">
      Se guarda solo en esta caja y se usa para firmar tus facturas. No se envía
      a MOTRAE ni a ningún otro sitio.
    </p>

    {#if sync.problemaFiscal}
      <p class="error" role="alert">{sync.problemaFiscal}</p>
    {/if}

    <div class="botones">
      {#if mostrandoFormulario}
        <button class="secundario" onclick={() => (mostrandoFormulario = false)}>Cancelar</button>
      {/if}
      <button class="principal" disabled={!listo || enviando} onclick={instalar}>
        {enviando ? "Verificando…" : "Instalar certificado"}
      </button>
    </div>
  {:else}
    <p class="vacio">
      Todavía no hay certificado en esta caja. Pídeselo al dueño: solo un
      perfil autorizado puede instalarlo.
    </p>
  {/if}
</section>

<!-- Cola de timbrado -->
{#if sync.fiscal}
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Cola de timbrado</h2>
      <button class="mini" onclick={() => sync.pedirEstadoFiscal(empleadoId, true)}>
        Actualizar
      </button>
    </div>

    <div class="contadores">
      <div><b>{estado?.cola.pendientes ?? 0}</b><span>Por timbrar</span></div>
      <div><b>{estado?.cola.timbradas ?? 0}</b><span>Timbradas</span></div>
      <div class:hay={(estado?.cola.rechazadas ?? 0) > 0}>
        <b>{estado?.cola.rechazadas ?? 0}</b><span>Con problema</span>
      </div>
    </div>

    <p class="nota">
      {#if estado?.pac}
        Timbrando con <b>{estado.pac}</b>. Las facturas pendientes se reintentan
        solas cuando hay conexión.
      {:else}
        Todavía no hay un PAC conectado: las facturas se generan y esperan en la
        cola. El SAT permite timbrar dentro de las 72 horas siguientes.
      {/if}
    </p>

    {#if sync.colaFiscal.length > 0}
      <table>
        <thead>
          <tr>
            <th>Folio</th><th>Total</th><th>Estado</th><th>Detalle</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each sync.colaFiscal as factura (factura.orden_id)}
            <tr>
              <td class="mono">{factura.serie}-{factura.folio}</td>
              <!-- El total viaja como entero por el canal; ya son centavos. -->
              <td class="num">{mxn(factura.total as Centavos)}</td>
              <td>
                <span class="etiqueta {factura.estado}">
                  {factura.estado === "timbrado"
                    ? "Timbrada"
                    : factura.estado === "rechazado"
                      ? "Con problema"
                      : "Por timbrar"}
                </span>
              </td>
              <td class="detalle">
                {#if factura.uuid}
                  <span class="mono">{factura.uuid}</span>
                {:else if factura.problema}
                  {factura.problema}
                {:else if factura.intentos > 0}
                  {factura.intentos} intento{factura.intentos === 1 ? "" : "s"}
                {/if}
              </td>
              <td>
                {#if factura.estado === "rechazado" && puedeAdministrar}
                  <button
                    class="mini"
                    onclick={() => sync.reintentarFactura(empleadoId, factura.orden_id)}
                  >
                    Reintentar
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

<style>
  .tarjeta {
    background: var(--superficie);
    border: 1px solid var(--borde);
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .cabecera-tarjeta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 650;
  }
  .explicacion,
  .nota,
  .vacio {
    font-size: 0.88rem;
    color: var(--texto-suave);
    line-height: 1.55;
  }
  .nota {
    margin-top: 0.75rem;
    font-size: 0.82rem;
  }
  code {
    background: var(--fondo);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .campos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 0.85rem;
    margin-top: 1rem;
  }
  .campos .ancho {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--texto-suave);
  }
  input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: 8px;
    background: var(--fondo);
    color: inherit;
    font: inherit;
  }
  input[type="file"] {
    padding: 0.4rem;
    font-size: 0.85rem;
  }

  .datos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.9rem;
  }
  .datos div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--texto-suave);
  }
  dd {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .mono {
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 0.85em;
  }
  .alerta {
    color: var(--acento);
  }
  .alerta-caja {
    margin-top: 0.9rem;
    padding: 0.7rem 0.9rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--acento) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--acento) 35%, transparent);
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .error {
    margin-top: 0.75rem;
    color: #e0392b;
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1px solid var(--borde);
    background: var(--fondo);
    color: inherit;
    padding: 0.5rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .mini {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .principal:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .peligro {
    background: #e0392b;
    border-color: #e0392b;
    color: #fff;
  }
  .enlace {
    border: none;
    background: none;
    padding: 0.4rem 0;
    color: var(--texto-suave);
    text-decoration: underline;
    font-size: 0.84rem;
    margin-top: 0.9rem;
  }

  .contadores {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }
  .contadores div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.8rem 0.5rem;
    border: 1px solid var(--borde);
    border-radius: 10px;
  }
  .contadores b {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .contadores span {
    font-size: 0.76rem;
    color: var(--texto-suave);
  }
  .contadores .hay b {
    color: #e0392b;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
    font-size: 0.86rem;
  }
  th {
    text-align: left;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--texto-suave);
    padding-bottom: 0.5rem;
  }
  td {
    padding: 0.55rem 0.5rem 0.55rem 0;
    border-top: 1px solid var(--borde);
    vertical-align: top;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .detalle {
    color: var(--texto-suave);
    line-height: 1.45;
    max-width: 22rem;
  }
  .etiqueta {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--fondo);
    border: 1px solid var(--borde);
  }
  .etiqueta.timbrado {
    color: #57ad30;
    border-color: color-mix(in srgb, #57ad30 45%, transparent);
  }
  .etiqueta.rechazado {
    color: #e0392b;
    border-color: color-mix(in srgb, #e0392b 45%, transparent);
  }

  @media (max-width: 640px) {
    .contadores {
      grid-template-columns: 1fr;
    }
    .detalle {
      max-width: none;
    }
  }
</style>
