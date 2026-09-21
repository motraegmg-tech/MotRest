<script lang="ts">
  /**
   * Facturación electrónica: la conexión con FacturAPI, la factura global del
   * mes y la cola de timbrado.
   *
   * Sustituye a la pantalla del CSD (1.5.5). Con FacturAPI el certificado ya no
   * se sube a la caja: vive en el panel de FacturAPI, que es quien sella y
   * timbra (ver `docs/PLAN-FACTURAPI-1.5.5.md`). Lo que el restaurante entrega
   * ahora es la LLAVE de su organización, y esa llave es un secreto del Hub:
   *
   *  - Normalmente la manda MOTRAE desde Central, cifrada para este Hub.
   *  - Aquí la puede pegar SOLO el responsable del restaurante o el soporte de
   *    MOTRAE —por rol, no por permiso: decisión de Gonzalo—. El Hub lo vuelve a
   *    comprobar y prueba la llave contra FacturAPI antes de guardarla.
   *  - La llave va directo al Hub. Esta pantalla no la guarda, y de vuelta solo
   *    llegan sus cuatro últimos caracteres.
   */
  import { puedeGuardarSecretos, type Centavos, type ModoFacturapi } from "@motrest/dominio";
  import { sesion } from "../../sesion/sesion.svelte";
  import { sync } from "../../sync.svelte";
  import { mxn } from "../../formato";
  import VerMas from "../../listas/VerMas.svelte";
  import { Paginado } from "../../listas/listas.svelte";
  import { revelar } from "../../subir";

  /*
   * «VER MÁS» EN LAS FACTURAS (1.5.6, pedido de Gonzalo). La cola que manda el
   * Hub trae también las ya timbradas, así que crece con cada factura del mes, y
   * se pintaba entera. Se ven 10 y el resto a petición.
   */
  const pagFacturas = new Paginado();

  /** Reintentar una factura rechazada: el mismo permiso que ya lo pedía. */
  const puedeAdministrar = $derived(sesion.puedeOperar("fin.csd.administrar"));
  const puedeConfigurar = $derived(puedeGuardarSecretos(sesion.usuarioActual));
  const estado = $derived(sync.fiscal);
  const empleadoId = $derived(sesion.usuarioActual?.id ?? "");
  const conectada = $derived(sync.estado === "sincronizado");

  /*
   * Lo que se sabe de FacturAPI llega por dos caminos —la respuesta a las
   * llaves y el estado fiscal— y el más fresco es el de las llaves, que es el
   * que cambia al guardar. El fiscal sirve de respaldo al abrir la pantalla.
   */
  const facturapi = $derived(sync.secretos?.facturapi ?? estado?.facturapi ?? null);
  const global = $derived(estado?.global);

  // Al abrir, y cada vez que vuelve la conexión: pedir el estado de todo.
  $effect(() => {
    if (!conectada || !empleadoId) return;
    sync.consultarSecretos(empleadoId);
    sync.pedirEstadoFiscal(empleadoId, true);
  });

  let editando = $state(false);
  let modo = $state<ModoFacturapi>("produccion");
  let llave = $state("");
  let confirmandoQuitar = $state(false);

  const prefijo = $derived(modo === "produccion" ? "sk_live_" : "sk_test_");
  const llaveLimpia = $derived(llave.trim());
  const pistaLlave = $derived.by(() => {
    if (!llaveLimpia) return "";
    if (llaveLimpia.startsWith("sk_user_")) {
      return "Esa es la llave de USUARIO de la cuenta de MOTRAE: nunca va en un restaurante. Aquí va la de la organización del local.";
    }
    if (!llaveLimpia.startsWith(prefijo)) {
      return modo === "produccion"
        ? "En producción la llave empieza con sk_live_. La de sk_test_ timbra sin validez fiscal."
        : "En modo pruebas la llave empieza con sk_test_.";
    }
    return "";
  });
  const listaParaEnviar = $derived(
    llaveLimpia.length > prefijo.length + 8 && llaveLimpia.startsWith(prefijo),
  );

  function abrirEdicion() {
    modo = facturapi?.modo ?? "produccion";
    llave = "";
    sync.resultadoSecreto = null;
    editando = true;
  }

  function conectar() {
    if (!listaParaEnviar) return;
    sync.guardarSecreto({ empleadoId, clase: "facturapi", valor: llaveLimpia, modo });
    // La llave sale de la pantalla en cuanto se manda.
    llave = "";
  }

  function quitar() {
    sync.quitarSecreto(empleadoId, "facturapi");
    confirmandoQuitar = false;
  }

  // Cerrar el formulario cuando el Hub confirma que la guardó.
  $effect(() => {
    if (editando && sync.resultadoSecreto?.ok) editando = false;
  });

  function fecha(iso: string | undefined | null): string {
    return iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "long" }) : "—";
  }
  function fechaTs(ts: number | undefined): string {
    return ts ? new Date(ts).toLocaleDateString("es-MX", { dateStyle: "medium" }) : "";
  }

  /** Días que le quedan al CSD en FacturAPI. */
  const diasCsd = $derived.by(() => {
    if (!facturapi?.csd_vence) return null;
    return Math.floor((new Date(facturapi.csd_vence).getTime() - Date.now()) / 86_400_000);
  });

  /** «2026-08» → «agosto de 2026». */
  function mesLegible(periodo: string): string {
    const [anio, mes] = periodo.split("-").map(Number);
    if (!anio || !mes) return periodo;
    return new Date(anio, mes - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  }
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Facturación electrónica</h2>
    {#if facturapi?.configurada && puedeConfigurar && !editando}
      <button class="mini" onclick={abrirEdicion}>Cambiar la llave</button>
    {/if}
  </div>

  {#if !conectada && !facturapi}
    <p class="vacio">
      Conecta esta terminal al Hub del local para ver la facturación. La llave de
      FacturAPI vive en la caja, no en las tabletas.
    </p>
  {:else if facturapi?.configurada && !editando}
    <p class="explicacion">
      Las facturas se timbran con <b>FacturAPI</b>. El certificado (CSD) está en su
      panel: la caja ya no lo guarda.
    </p>

    {#if facturapi.modo === "pruebas"}
      <p class="alerta-caja" role="alert">
        <b>Modo pruebas.</b> Las facturas que salen ahora NO tienen validez ante el
        SAT. Sirve para probar; para facturar de verdad hace falta la llave de
        producción.
      </p>
    {/if}

    <dl class="datos">
      <div><dt>Factura como</dt><dd>{facturapi.razon_social ?? "—"}</dd></div>
      <div><dt>RFC</dt><dd class="mono">{facturapi.rfc ?? "—"}</dd></div>
      <div>
        <dt>Modo</dt>
        <dd class:alerta={facturapi.modo === "pruebas"}>
          {facturapi.modo === "pruebas" ? "Pruebas" : "Producción"}
        </dd>
      </div>
      <div><dt>Llave</dt><dd class="mono">…{facturapi.termina_en ?? "????"}</dd></div>
      <div><dt>CSD vigente hasta</dt><dd class:alerta={diasCsd !== null && diasCsd < 60}>{fecha(facturapi.csd_vence)}</dd></div>
      <div>
        <dt>La puso</dt>
        <dd>
          {facturapi.origen === "local" ? "El responsable, desde la caja" : "MOTRAE, desde Central"}
          {#if facturapi.actualizado_ts}<small> · {fechaTs(facturapi.actualizado_ts)}</small>{/if}
        </dd>
      </div>
    </dl>

    {#if diasCsd !== null && diasCsd < 60}
      <p class="alerta-caja" role="alert">
        El certificado vence en {Math.max(diasCsd, 0)} días. Tramita el nuevo en el
        portal del SAT y súbelo al panel de FacturAPI: el día que caduque, la
        facturación se detiene.
      </p>
    {/if}
    {#if facturapi.lista === false}
      <div class="alerta-caja" role="alert">
        <b>FacturAPI todavía no deja facturar a esta organización.</b> Le falta:
        <ul class="pendientes">
          {#each facturapi.pendientes ?? [] as paso (paso)}<li>{paso}</li>{/each}
        </ul>
        Se completa en el panel de FacturAPI.
      </div>
    {/if}
    {#if facturapi.error}
      <p class="error" role="alert">{facturapi.error}</p>
    {/if}

    {#if puedeConfigurar}
      {#if confirmandoQuitar}
        <p class="alerta-caja" use:revelar>
          Al quitarla, la caja sigue vendiendo pero <b>no factura</b>: las facturas se
          quedan en la cola hasta que haya otra llave.
        </p>
        <div class="botones">
          <button class="secundario" onclick={() => (confirmandoQuitar = false)}>Cancelar</button>
          <button class="peligro" onclick={quitar}>Quitar la llave</button>
        </div>
      {:else}
        <button class="enlace" onclick={() => (confirmandoQuitar = true)}>Quitar la llave</button>
      {/if}
    {/if}
  {:else if puedeConfigurar}
    <p class="explicacion">
      {#if !facturapi?.configurada}
        Este restaurante todavía no está conectado a FacturAPI. Normalmente lo
        conecta MOTRAE desde Central. Si te dieron la llave de tu organización,
        pégala aquí.
      {:else}
        Pega la llave nueva. La anterior deja de usarse en cuanto el Hub compruebe
        la nueva.
      {/if}
    </p>

    <div class="modo" role="group" aria-label="Modo">
      <button class="mini" class:on={modo === "produccion"} aria-pressed={modo === "produccion"} onclick={() => (modo = "produccion")}>
        Producción
      </button>
      <button class="mini" class:on={modo === "pruebas"} aria-pressed={modo === "pruebas"} onclick={() => (modo = "pruebas")}>
        Pruebas (sin validez fiscal)
      </button>
    </div>

    <div class="campos">
      <label class="ancho">
        <span>Llave de la organización en FacturAPI</span>
        <input
          type="password"
          bind:value={llave}
          autocomplete="off"
          spellcheck="false"
          placeholder={`${prefijo}…`}
        />
      </label>
    </div>
    {#if pistaLlave}<p class="error">{pistaLlave}</p>{/if}

    <p class="nota">
      La llave va directo al Hub de la caja y se prueba contra FacturAPI antes de
      guardarse. No se queda en esta pantalla ni en ninguna tableta.
    </p>

    {#if sync.resultadoSecreto && !sync.resultadoSecreto.ok}
      <p class="error" role="alert">{sync.resultadoSecreto.problema}</p>
    {/if}

    <div class="botones">
      {#if editando}
        <button class="secundario" onclick={() => (editando = false)}>Cancelar</button>
      {/if}
      <button class="principal" disabled={!listaParaEnviar || sync.guardandoSecreto} onclick={conectar}>
        {sync.guardandoSecreto ? "Verificando con FacturAPI…" : "Conectar"}
      </button>
    </div>
  {:else}
    <p class="vacio">
      Este restaurante todavía no está conectado a FacturAPI. Lo conecta MOTRAE
      desde Central, o el responsable del restaurante desde esta pantalla.
    </p>
  {/if}
</section>

<!-- La factura global del mes -->
{#if facturapi?.configurada}
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Factura global del mes</h2>
    </div>
    <p class="explicacion">
      Cada mes, el Hub factura solo a <b>PÚBLICO EN GENERAL</b> todas las cuentas
      cobradas que nadie pidió a su nombre. Sale el día 1 a partir de las 6:00, y
      el SAT da 72 horas. Un comensal puede pedir factura de su ticket hasta que
      termine el mes; después ya está incluido en la global.
    </p>
    {#if global?.pendiente}
      <p class="alerta-caja" role="alert">
        La de <b>{mesLegible(global.pendiente.periodo)}</b> todavía no sale.
        {global.pendiente.problema ?? "Se reintenta sola en cuanto haya conexión."}
      </p>
    {/if}
    {#if global?.ultima}
      <dl class="datos">
        <div><dt>Última</dt><dd>{mesLegible(global.ultima.periodo)}</dd></div>
        <div><dt>Cuentas</dt><dd>{global.ultima.cuentas}</dd></div>
        <div><dt>Total</dt><dd>{mxn(global.ultima.total as Centavos)}</dd></div>
        <div><dt>Folio fiscal</dt><dd class="mono">{global.ultima.uuid}</dd></div>
      </dl>
    {:else if !global?.pendiente}
      <p class="nota">Todavía no se ha emitido ninguna.</p>
    {/if}
  </section>
{/if}

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
          {#each pagFacturas.de(sync.colaFiscal) as factura (factura.orden_id)}
            <tr>
              <td class="mono">{factura.serie}-{factura.folio}</td>
              <!-- El total viaja como entero por el canal; ya son centavos. -->
              <td class="num">{mxn(factura.total as Centavos)}</td>
              <td>
                <!--
                  "Recuperando" no es un error y no debe leerse como tal: la
                  factura YA está timbrada ante el SAT y el sistema está yendo
                  por el documento. Nadie tiene que hacer nada.
                -->
                <span
                  class="etiqueta {factura.estado}"
                  class:recuperando={factura.estado === "pendiente" && factura.modo === "recuperar"}
                >
                  {factura.estado === "timbrado"
                    ? "Timbrada"
                    : factura.estado === "rechazado"
                      ? "Con problema"
                      : factura.modo === "recuperar"
                        ? "Recuperando"
                        : "Por timbrar"}
                </span>
              </td>
              <td class="detalle">
                {#if factura.uuid}
                  <span class="mono">{factura.uuid}</span>
                {:else if factura.estado === "pendiente" && factura.modo === "recuperar"}
                  Esta factura ya está timbrada ante el SAT. Se está recuperando
                  del PAC el documento; no hace falta hacer nada.
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
      <VerMas pag={pagFacturas} lista={sync.colaFiscal} />
    {/if}
  </section>
{/if}

<style>
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
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
    color: var(--acento-texto);
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
    color: var(--sobre-acento);
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
  .etiqueta.recuperando {
    color: var(--acento-texto);
    border-color: color-mix(in srgb, var(--acento) 45%, transparent);
  }

  @media (max-width: 640px) {
    .contadores {
      grid-template-columns: 1fr;
    }
    .detalle {
      max-width: none;
    }
  }
  /* --- FacturAPI --- */
  .modo {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.9rem;
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .pendientes {
    margin: 0.35rem 0 0.35rem 1.2rem;
  }
  .secundario {
    background: #fff;
  }
</style>
