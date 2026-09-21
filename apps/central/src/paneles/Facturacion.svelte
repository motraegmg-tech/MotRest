<script lang="ts">
  /**
   * La pestaña «Facturación y correo» de cada restaurante.
   *
   * ES PARA GONZALO CON EL RESTAURANTERO AL TELÉFONO, y por eso va en pasos
   * numerados y de arriba abajo: qué organización es la suya, en qué modo va a
   * facturar, y enviar. Debajo, lo que contesta el restaurante — porque «enviado»
   * no es «funciona», y la diferencia es un cliente que pide factura y no se la
   * pueden dar.
   *
   * NINGUNA LLAVE SE ENSEÑA ENTERA. Ni la de usuario de MOTRAE (vive en DPAPI y
   * no llega a esta ventana), ni la del restaurante (pasa por aquí en memoria lo
   * que dura el envío). De las dos solo se ven los cuatro últimos caracteres, que
   * basta para que Gonzalo y el responsable confirmen que hablan de la misma sin
   * dictarla.
   */
  import { onMount, untrack } from "svelte";
  import { haySobres, type ClienteMotRest, type ModoFacturapi } from "@motrest/dominio";
  import { central } from "../lib/central.svelte";
  import { desde, fecha } from "../lib/formato";
  import {
    DIAS_AVISO_CSD,
    SIN_LLAVE_PUBLICA,
    SIN_SOBRES,
    diasHasta,
    entregaDeSecreto,
    semaforoDeOrganizacion,
    textoDePendiente,
    type ColorSemaforo,
    type LlaveLive,
    type OrganizacionFacturapi,
  } from "../lib/facturacion";

  const { cliente }: { cliente: ClienteMotRest } = $props();

  let sobres = $state<boolean | null>(null);
  let cargandoOrgs = $state(false);
  let errorOrgs = $state("");
  /** La organización elegida, recién consultada: el semáforo tiene que ser de ahora. */
  let organizacion = $state<OrganizacionFacturapi | null>(null);
  let consultando = $state(false);
  let errorOrg = $state("");

  let enviando = $state<"" | "facturapi" | "gmail">("");
  let avisoFacturapi = $state("");
  let errorFacturapi = $state("");
  let avisoGmail = $state("");
  let errorGmail = $state("");
  let remitente = $state("");
  let contrasena = $state("");

  /* El portal de autofactura (1.5.6). */
  let portalUrl = $state(central.secretos.portal_autofactura ?? "");
  let claveEditada = $state("");
  let guardandoPortal = $state(false);
  let avisoPortal = $state("");
  let errorPortal = $state("");
  const claveActual = $derived(central.clavesDeAutofactura?.[cliente.id]);

  let llaves = $state<LlaveLive[] | null>(null);
  let cargandoLlaves = $state(false);
  let errorLlaves = $state("");
  let porRevocar = $state<LlaveLive | null>(null);
  let revocando = $state(false);

  const clienteId = $derived(cliente.id);
  const datos = $derived(central.facturacionDe(cliente.id));
  /* Primitivos a propósito: un `$derived` solo avisa si el VALOR cambia. */
  const orgId = $derived(datos.organizacion_id ?? "");
  const modo = $derived<ModoFacturapi>(datos.modo ?? "pruebas");
  /* La vista pública de las llaves sí es reactiva; `puedeUsarFacturapi` no. */
  const hayLlaveUsuario = $derived(Boolean(central.secretos.facturapi));

  const secretos = $derived(central.secretosDe(cliente.id));
  const estado = $derived(secretos.estado);
  const sinLlavePublica = $derived(!secretos.llave_publica);
  const hace = (ts: number) => desde(ts, central.ahora);
  const entregaFacturapi = $derived(entregaDeSecreto(central.filaSecretoDe(cliente.id, "facturapi"), hace));
  const entregaGmail = $derived(entregaDeSecreto(central.filaSecretoDe(cliente.id, "gmail"), hace));
  const semaforo = $derived(organizacion ? semaforoDeOrganizacion(organizacion, modo, central.ahora) : null);

  /** El color del estado que reporta el Hub, con el mismo criterio que el semáforo. */
  const colorFacturapi = $derived.by<ColorSemaforo>(() => {
    const f = estado?.facturapi;
    if (!f?.configurada) return "gris";
    if (f.error || (f.modo === "produccion" && f.lista === false)) return "rojo";
    const dias = diasHasta(f.csd_vence, central.ahora);
    if (f.modo !== "produccion" || (dias !== null && dias <= DIAS_AVISO_CSD)) return "ambar";
    return "verde";
  });
  const colorGmail = $derived.by<ColorSemaforo>(() => {
    const g = estado?.gmail;
    if (!g?.configurada) return "gris";
    return g.error ? "rojo" : "verde";
  });

  /** ¿El responsable la cambió desde la caja DESPUÉS del último envío de Central? */
  const cambiadaEnCaja = $derived(
    estado?.facturapi.origen === "local" &&
      (estado.facturapi.actualizado_ts ?? 0) > (datos.facturapi_enviado_ts ?? 0),
  );

  onMount(() => {
    void haySobres().then((si) => (sobres = si));
    void central.traerSecretosPendientes();
    void central.traerClavesDeAutofactura();
  });

  /* Al cambiar de restaurante, o al llegar las claves: la suya, o una propuesta. */
  $effect(() => {
    const actual = claveActual?.clave;
    void clienteId;
    void central.clavesDeAutofactura;
    untrack(() => {
      avisoPortal = errorPortal = "";
      claveEditada = actual ?? central.proponerClave(cliente.id);
    });
  });

  async function guardarDireccion() {
    guardandoPortal = true;
    avisoPortal = errorPortal = "";
    const r = await central.guardarPortalAutofactura(portalUrl);
    guardandoPortal = false;
    if (r.ok) avisoPortal = "Dirección guardada. Los tickets la imprimen desde el siguiente cobro.";
    else errorPortal = r.error;
  }

  async function guardarClave() {
    guardandoPortal = true;
    avisoPortal = errorPortal = "";
    const r = await central.fijarClaveDeAutofactura(cliente.id, claveEditada);
    guardandoPortal = false;
    if (r.ok) {
      avisoPortal = `Portal encendido con la clave ${claveEditada.trim().toUpperCase()}. En un minuto su caja empieza a imprimir el QR.`;
    } else errorPortal = r.error;
  }

  async function apagarPortal() {
    guardandoPortal = true;
    avisoPortal = errorPortal = "";
    const r = await central.apagarAutofactura(cliente.id);
    guardandoPortal = false;
    if (r.ok) avisoPortal = "Portal apagado. Su caja deja de imprimir el QR en un minuto.";
    else errorPortal = r.error;
  }

  /* La lista de organizaciones se pide una vez por sesión, y al guardar la llave. */
  $effect(() => {
    if (hayLlaveUsuario && untrack(() => central.organizaciones === null && !cargandoOrgs)) {
      void cargarOrganizaciones();
    }
  });

  /* Al cambiar de restaurante, nada del anterior se queda en pantalla. */
  $effect(() => {
    void clienteId;
    untrack(() => {
      avisoFacturapi = errorFacturapi = avisoGmail = errorGmail = "";
      contrasena = "";
      remitente = datos.gmail_remitente ?? estado?.gmail.remitente ?? "";
      porRevocar = null;
    });
  });

  /* Y al cambiar de organización (o de restaurante), se vuelve a preguntar por ella. */
  $effect(() => {
    const id = orgId;
    const hay = hayLlaveUsuario;
    untrack(() => {
      organizacion = null;
      llaves = null;
      errorOrg = errorLlaves = "";
      if (id && hay) void consultar(id);
    });
  });

  async function cargarOrganizaciones() {
    errorOrgs = "";
    cargandoOrgs = true;
    const r = await central.listarOrganizaciones();
    cargandoOrgs = false;
    if (!r.ok) errorOrgs = r.error;
  }

  async function consultar(id: string) {
    consultando = true;
    const r = await central.consultarOrganizacion(id);
    consultando = false;
    /* Si mientras tanto se eligió otra, esta respuesta ya no es de nadie. */
    if (id !== orgId) return;
    if (r.ok) organizacion = r.organizacion;
    else errorOrg = r.error;
  }

  function elegir(evento: Event) {
    const id = (evento.currentTarget as HTMLSelectElement).value;
    const org = central.organizaciones?.find((o) => o.id === id);
    central.elegirOrganizacion(cliente.id, org ? { id: org.id, nombre: org.nombre } : null);
    avisoFacturapi = errorFacturapi = "";
  }

  async function actualizar() {
    await central.traerPulsos();
    await central.traerSecretosPendientes();
    if (orgId && hayLlaveUsuario) await consultar(orgId);
  }

  async function enviarFacturapi() {
    avisoFacturapi = errorFacturapi = "";
    enviando = "facturapi";
    const r = await central.enviarFacturapi(cliente.id);
    enviando = "";
    if (!r.ok) {
      errorFacturapi = r.error;
      return;
    }
    avisoFacturapi =
      `Llave de ${modo === "produccion" ? "producción" : "pruebas"} enviada (termina en …${r.termina_en}). ` +
      `Si ${cliente.nombre} está encendido la recibe en segundos, la prueba contra FacturAPI ` +
      "y abajo verás «probada y puesta». Si está apagado, la recoge al encender.";
    llaves = null;
    await central.traerSecretosPendientes();
  }

  async function enviarGmail() {
    avisoGmail = errorGmail = "";
    enviando = "gmail";
    const r = await central.enviarGmail(cliente.id, { contrasena, remitente });
    enviando = "";
    if (!r.ok) {
      errorGmail = r.error;
      return;
    }
    /* Se vacía YA: no tiene por qué quedarse en un campo de esta ventana. */
    contrasena = "";
    avisoGmail =
      `Contraseña enviada (termina en …${r.termina_en}). El Hub la probará contra Gmail ` +
      "y abajo verás si quedó puesta.";
    await central.traerSecretosPendientes();
  }

  async function cargarLlaves() {
    if (!orgId) return;
    errorLlaves = "";
    cargandoLlaves = true;
    const r = await central.llavesLiveDe(orgId);
    cargandoLlaves = false;
    if (r.ok) llaves = r.llaves;
    else errorLlaves = r.error;
  }

  function nombreDe(sucursalId: string): string {
    return central.clientes.find((c) => c.id === sucursalId)?.nombre ?? sucursalId;
  }

  async function revocar() {
    if (!porRevocar || !orgId) return;
    revocando = true;
    const r = await central.revocarLlaveLive(orgId, porRevocar.id);
    revocando = false;
    if (!r.ok) {
      errorLlaves = r.error;
      porRevocar = null;
      return;
    }
    porRevocar = null;
    await cargarLlaves();
  }

  function fechaIso(iso: string): string {
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? fecha(ts) : iso;
  }
</script>

<div class="facturacion">
  {#if sobres === false}
    <div class="alerta">{SIN_SOBRES}</div>
  {/if}

  <!-- ============================ FACTURAPI ============================ -->
  <section class="bloque">
    <header class="cabeza-bloque">
      <div>
        <h3>Facturación electrónica</h3>
        <p class="sub">
          Las facturas de <b>{cliente.nombre}</b> las timbra FacturAPI con la llave de su
          propia organización.
        </p>
      </div>
      <button class="secundario" onclick={actualizar} disabled={consultando}>Actualizar estado</button>
    </header>

    {#if !hayLlaveUsuario}
      <p class="falta">
        Para elegir la organización, primero pega tu <b>llave de usuario de FacturAPI</b> en
        <b>Llaves → FacturAPI</b>. Se hace una sola vez y sirve para todos los restaurantes.
      </p>
    {:else}
      <div class="paso">
        <span class="num">1</span>
        <div class="cuerpo-paso">
          <label class="etiqueta" for="org-{cliente.id}">¿Cuál es su organización en FacturAPI?</label>
          <div class="fila-control">
            <select id="org-{cliente.id}" value={orgId} onchange={elegir} disabled={cargandoOrgs}>
              <option value="">
                {cargandoOrgs ? "Pidiendo la lista a FacturAPI…" : "Elige la organización de este restaurante…"}
              </option>
              {#each central.organizaciones ?? [] as o (o.id)}
                <option value={o.id}>{o.nombre}{o.rfc ? ` · ${o.rfc}` : ""}</option>
              {/each}
              <!-- La elegida sigue apareciendo aunque la lista todavía no haya llegado. -->
              {#if orgId && !(central.organizaciones ?? []).some((o) => o.id === orgId)}
                <option value={orgId}>{datos.organizacion_nombre ?? orgId}</option>
              {/if}
            </select>
            <button
              class="icono"
              onclick={cargarOrganizaciones}
              disabled={cargandoOrgs}
              title="Volver a pedir la lista a FacturAPI"
              aria-label="Volver a pedir la lista a FacturAPI"
            >↻</button>
          </div>
          {#if errorOrgs}<p class="error">{errorOrgs}</p>{/if}
          {#if central.organizaciones?.length === 0}
            <p class="nota">
              Tu cuenta de FacturAPI no tiene organizaciones. Crea la del restaurante en el panel
              de FacturAPI (con su RFC y su CSD) y pulsa ↻.
            </p>
          {/if}
        </div>
      </div>

      {#if orgId}
        <!-- El semáforo: lo que dice FacturAPI de esa organización, ahora mismo. -->
        <div class="semaforo {semaforo?.color ?? 'gris'}" aria-live="polite">
          {#if semaforo}
            <b class="titulo-semaforo"><span class="luz"></span>{semaforo.titulo}</b>
            <ul>
              {#each semaforo.puntos as p (p.texto)}
                <li class={p.color}>{p.texto}</li>
              {/each}
            </ul>
          {:else if errorOrg}
            <b class="titulo-semaforo"><span class="luz"></span>No se pudo consultar la organización</b>
            <p>{errorOrg}</p>
          {:else}
            <p>Preguntando a FacturAPI cómo está esta organización…</p>
          {/if}
        </div>

        <div class="paso">
          <span class="num">2</span>
          <div class="cuerpo-paso">
            <span class="etiqueta">¿Cómo va a facturar?</span>
            <div class="modos">
              <label class="modo" class:on={modo === "pruebas"}>
                <input
                  type="radio"
                  name="modo-{cliente.id}"
                  checked={modo === "pruebas"}
                  onchange={() => central.fijarModoFacturapi(cliente.id, "pruebas")}
                />
                <span>
                  <b>Pruebas</b>
                  <small>Facturas de ensayo, sin validez ante el SAT y sin gastar timbres.</small>
                </span>
              </label>
              <label class="modo" class:on={modo === "produccion"}>
                <input
                  type="radio"
                  name="modo-{cliente.id}"
                  checked={modo === "produccion"}
                  onchange={() => central.fijarModoFacturapi(cliente.id, "produccion")}
                />
                <span>
                  <b>Producción</b>
                  <small>Facturas de verdad ante el SAT. Cada una gasta un timbre.</small>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div class="paso">
          <span class="num">3</span>
          <div class="cuerpo-paso">
            {#if sinLlavePublica}
              <p class="bloqueo">
                <b>{SIN_LLAVE_PUBLICA}.</b> Su Hub todavía no publica la llave con la que se le
                cifran. Actualízalo desde <b>Versiones</b>; en cuanto reporte con la 1.5.5 podrás
                enviarla.
              </p>
            {/if}
            {#if modo === "produccion" && organizacion && !organizacion.lista}
              <p class="ojo">
                FacturAPI dice que esta organización todavía no está lista para producción. La llave
                llegará, pero no podrá timbrar hasta que se complete lo que está en rojo arriba.
              </p>
            {/if}
            <button
              class="primario"
              onclick={enviarFacturapi}
              disabled={enviando !== "" || sinLlavePublica || sobres === false}
            >
              {enviando === "facturapi"
                ? "Enviando…"
                : modo === "produccion"
                  ? `Crear llave de producción y enviarla a ${cliente.nombre}`
                  : `Enviar la llave de pruebas a ${cliente.nombre}`}
            </button>
            <small>
              {modo === "produccion"
                ? `Se crea una llave exclusiva de ${cliente.nombre}: si un día se filtra se revoca sola, sin tocar a nadie más.`
                : "Es la llave de pruebas de la organización: no timbra nada de verdad."}
              Viaja cifrada y solo el Hub de este restaurante puede abrirla. En Central no se guarda.
            </small>
            {#if avisoFacturapi}<p class="ok">{avisoFacturapi}</p>{/if}
            {#if errorFacturapi}<p class="error">{errorFacturapi}</p>{/if}
          </div>
        </div>
      {/if}
    {/if}

    <!-- Lo que contesta el restaurante: la única prueba de que funciona. -->
    <h4>En el restaurante</h4>
    {#if !estado}
      <p class="nota">
        {sinLlavePublica
          ? "Este restaurante todavía no reporta cómo está su facturación: necesita la 1.5.5."
          : "Su Hub todavía no ha reportado el estado de su facturación."}
      </p>
    {:else if !estado.facturapi.configurada}
      <div class="estado gris">
        <p>Todavía no tiene llave de facturación: no puede dar facturas.</p>
        {#if estado.facturapi.error}<p class="error">{estado.facturapi.error}</p>{/if}
      </div>
    {:else}
      {@const f = estado.facturapi}
      <div class="estado {colorFacturapi}">
        <div class="chips">
          <span class="chip fuerte">{f.modo === "produccion" ? "Producción" : "Pruebas"}</span>
          {#if f.termina_en}<span class="chip">llave …{f.termina_en}</span>{/if}
          <span class="chip">
            {f.origen === "local" ? "La puso el responsable desde la caja" : "Enviada desde Central"}
            {#if f.actualizado_ts}· {hace(f.actualizado_ts)}{/if}
          </span>
        </div>
        {#if f.razon_social || f.rfc}
          <p>Factura como <b>{f.razon_social ?? "—"}</b>{f.rfc ? ` · RFC ${f.rfc}` : ""}</p>
        {/if}
        {#if f.csd_vence}
          {@const dias = diasHasta(f.csd_vence, central.ahora)}
          <p>
            CSD vigente hasta el <b>{fechaIso(f.csd_vence)}</b>{#if dias !== null && dias <= DIAS_AVISO_CSD}
              — {dias < 0 ? "ya venció" : `vence en ${dias} ${dias === 1 ? "día" : "días"}`}{/if}
          </p>
        {/if}
        {#if f.lista === false}
          <p>
            FacturAPI todavía no la deja facturar de verdad{#if f.pendientes?.length}:
              {f.pendientes.map((p) => textoDePendiente(p)).join("; ")}{/if}.
          </p>
        {/if}
        {#if f.error}<p class="error">{f.error}</p>{/if}
        {#if cambiadaEnCaja}
          <p class="ojo">
            El responsable cambió la llave desde la caja después de tu último envío. Lo de arriba
            es lo que tiene ahora; gana siempre lo más reciente.
          </p>
        {/if}
        {#if f.organizacion_id && orgId && f.organizacion_id !== orgId}
          <p class="ojo">
            Factura con otra organización distinta a la elegida aquí. Si no es lo que quieres,
            vuelve a enviar la llave.
          </p>
        {/if}
      </div>
    {/if}
    {#if entregaFacturapi}
      <p class="entrega {entregaFacturapi.color}"><b>Último envío desde Central:</b> {entregaFacturapi.texto}</p>
    {/if}

    {#if hayLlaveUsuario && orgId}
      <details
        class="llaves"
        ontoggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && llaves === null) void cargarLlaves();
        }}
      >
        <summary>Llaves de producción de esta organización</summary>
        <p class="nota">
          Cada restaurante recibe la suya. Si una se filtra, revócala aquí y envía otra: los demás
          siguen facturando.
        </p>
        {#if cargandoLlaves}
          <p class="nota">Pidiendo la lista…</p>
        {:else if errorLlaves}
          <p class="error">{errorLlaves}</p>
        {:else if llaves && llaves.length === 0}
          <p class="nota">Ninguna todavía.</p>
        {:else if llaves}
          <ul>
            {#each llaves as l (l.id)}
              {@const dueno = central.duenoDeLlaveLive(l.id)}
              <li>
                <code>{l.inicio}…</code>
                <span class="cuando">{l.creada_ts ? `creada el ${fecha(l.creada_ts)}` : ""}</span>
                <span class="de" class:vigente={dueno?.vigente}>
                  {#if !dueno}
                    No la creó Central
                  {:else if dueno.vigente}
                    La que usa {nombreDe(dueno.sucursal_id)}
                  {:else}
                    Anterior de {nombreDe(dueno.sucursal_id)}: ya no debería usarse
                  {/if}
                </span>
                <button class="revocar" onclick={() => (porRevocar = l)}>Revocar</button>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {/if}
  </section>

  <!-- ======================= FACTURA POR INTERNET (1.5.6) ======================= -->
  <section class="bloque">
    <header class="cabeza-bloque">
      <div>
        <h3>Factura por internet</h3>
        <p class="sub">
          Con el portal encendido, cada ticket lleva un QR y el comensal pide su factura desde su
          teléfono, con sus datos móviles, dentro de las 72 horas. La timbra su propio Hub con su
          llave de FacturAPI.
        </p>
      </div>
    </header>

    <label>
      Dirección del portal (la misma para todos los restaurantes)
      <div class="fila-control">
        <input
          bind:value={portalUrl}
          placeholder="https://motrest-factura.vercel.app"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="secundario" onclick={guardarDireccion} disabled={guardandoPortal || !portalUrl.trim()}>
          Guardar dirección
        </button>
      </div>
    </label>

    <label>
      Clave de {cliente.nombre}
      <div class="fila-control">
        <input
          value={claveEditada}
          oninput={(e) => (claveEditada = e.currentTarget.value.toUpperCase())}
          placeholder="RODIZIO"
          maxlength="20"
          autocapitalize="characters"
          spellcheck="false"
        />
        <button
          class="primario"
          onclick={guardarClave}
          disabled={guardandoPortal || !claveEditada.trim() || claveEditada.trim() === claveActual?.clave}
        >
          {claveActual ? "Cambiar clave" : "Encender el portal"}
        </button>
        {#if claveActual}
          <button class="secundario" onclick={apagarPortal} disabled={guardandoPortal}>Apagar</button>
        {/if}
      </div>
    </label>
    <small class="ayuda">
      Va impresa en el ticket para quien no puede escanear: corta y fácil de dictar. Se propone
      sola a partir del nombre; si otro restaurante ya la tiene, lleva un número.
    </small>

    {#if claveActual}
      <div class="chips">
        <span class="chip fuerte">Encendido · {claveActual.clave}</span>
        <span class="chip">{claveActual.portal_url}</span>
      </div>
    {:else if central.clavesDeAutofactura}
      <p class="nota">Apagado: sus tickets no llevan QR de factura.</p>
    {/if}
    {#if claveActual && estado && !estado.facturapi.configurada}
      <p class="bloqueo">
        <b>Todavía no tiene FacturAPI:</b> el portal queda apagado en su caja hasta que llegue su
        llave. Envíala arriba.
      </p>
    {/if}
    {#if avisoPortal}<p class="ok">{avisoPortal}</p>{/if}
    {#if errorPortal}<p class="error">{errorPortal}</p>{/if}
    {#if central.errorClaves}<p class="nota">{central.errorClaves}</p>{/if}
  </section>

  <!-- ============================== GMAIL ============================== -->
  <section class="bloque">
    <header class="cabeza-bloque">
      <div>
        <h3>Correo al comensal</h3>
        <p class="sub">
          Tickets y facturas salen desde el Gmail del propio restaurante. Hace falta una
          <b>contraseña de aplicación</b> de esa cuenta, no la contraseña normal.
        </p>
      </div>
    </header>

    <div class="dos">
      <label>
        Cuenta de Gmail del restaurante
        <input
          type="email"
          bind:value={remitente}
          placeholder="restaurante@gmail.com"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label>
        Contraseña de aplicación
        <input
          type="password"
          bind:value={contrasena}
          placeholder="abcd efgh ijkl mnop"
          autocomplete="new-password"
          spellcheck="false"
        />
      </label>
    </div>
    <small class="ayuda">
      Se saca en myaccount.google.com → Seguridad → Verificación en dos pasos → Contraseñas de
      aplicación: son 16 letras. No se guarda en Central; viaja cifrada al restaurante y aquí solo
      se verá cómo termina.
    </small>
    {#if sinLlavePublica}
      <p class="bloqueo"><b>{SIN_LLAVE_PUBLICA}.</b> Actualízalo desde <b>Versiones</b> primero.</p>
    {/if}
    <button
      class="primario"
      onclick={enviarGmail}
      disabled={enviando !== "" || sinLlavePublica || sobres === false || !contrasena.trim()}
    >
      {enviando === "gmail" ? "Enviando…" : `Enviar a ${cliente.nombre}`}
    </button>
    {#if avisoGmail}<p class="ok">{avisoGmail}</p>{/if}
    {#if errorGmail}<p class="error">{errorGmail}</p>{/if}

    <h4>En el restaurante</h4>
    {#if !estado}
      <p class="nota">
        {sinLlavePublica
          ? "Este restaurante todavía no reporta su correo: necesita la 1.5.5."
          : "Su Hub todavía no ha reportado el estado de su correo."}
      </p>
    {:else}
      {@const g = estado.gmail}
      <div class="estado {colorGmail}">
        {#if !g.configurada}
          <p>Todavía no tiene contraseña de Gmail: no puede mandar correos al comensal.</p>
        {:else}
          <div class="chips">
            {#if g.remitente}<span class="chip fuerte">{g.remitente}</span>{/if}
            {#if g.termina_en}<span class="chip">contraseña …{g.termina_en}</span>{/if}
            <span class="chip">
              {g.origen === "local" ? "La puso el responsable desde la caja" : "Enviada desde Central"}
              {#if g.actualizado_ts}· {hace(g.actualizado_ts)}{/if}
            </span>
          </div>
        {/if}
        {#if g.error}<p class="error">{g.error}</p>{/if}
      </div>
    {/if}
    {#if entregaGmail}
      <p class="entrega {entregaGmail.color}"><b>Último envío desde Central:</b> {entregaGmail.texto}</p>
    {/if}
  </section>

  {#if central.errorSecretosPendientes}
    <p class="nota">No se pudo leer el buzón de la nube: {central.errorSecretosPendientes}</p>
  {/if}
</div>

{#if porRevocar}
  {@const dueno = central.duenoDeLlaveLive(porRevocar.id)}
  <div class="modal-fondo" role="presentation">
    <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="revocar-titulo">
      <h2 id="revocar-titulo">Revocar la llave {porRevocar.inicio}…</h2>
      {#if dueno?.vigente}
        <p>
          <b>Es la que usa {nombreDe(dueno.sucursal_id)} ahora.</b> Dejará de poder facturar en
          cuanto la revoques, hasta que le envíes otra desde su pestaña de Facturación.
        </p>
      {:else}
        <p>
          FacturAPI dejará de aceptarla en el acto. Quien la tenga —un restaurante, otro sistema o
          alguien que no debería— ya no podrá timbrar con ella.
        </p>
      {/if}
      <p class="aviso-modal">No se puede deshacer.</p>
      <div class="botones-modal">
        <button onclick={() => (porRevocar = null)} disabled={revocando}>Cancelar</button>
        <button class="peligro" onclick={revocar} disabled={revocando}>
          {revocando ? "Revocando…" : "Sí, revocarla"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .facturacion {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  .bloque {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 1.1rem 1.2rem 1.2rem;
  }
  .cabeza-bloque {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }
  h3 {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    margin: 0 0 0.2rem;
    color: var(--pizarra);
  }
  h4 {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.3rem 0 0.5rem;
  }
  .sub {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--gris);
  }
  .paso {
    display: flex;
    gap: 0.8rem;
    margin: 0.9rem 0;
  }
  /* El número del paso, en el naranja de la casa: se lee en orden sin pensarlo. */
  .num {
    flex: none;
    width: 1.6rem;
    height: 1.6rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--acento);
    color: var(--sobre-acento);
    font-family: var(--font-titulo);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .cuerpo-paso {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .etiqueta {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .fila-control {
    display: flex;
    gap: 0.4rem;
  }
  select,
  input {
    font: inherit;
    font-size: 0.88rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  select {
    flex: 1;
    min-width: 0;
  }
  select:focus,
  input:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  button {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .primario {
    align-self: flex-start;
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .secundario:hover:not(:disabled),
  .icono:hover:not(:disabled) {
    border-color: var(--acento);
  }
  .icono {
    flex: none;
    padding: 0.4rem 0.75rem;
    font-size: 1rem;
  }
  .modos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .modo {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .modo.on {
    border-color: var(--acento);
    background: var(--claro);
  }
  .modo input {
    margin-top: 0.2rem;
    accent-color: var(--acento);
  }
  .modo b {
    display: block;
    font-size: 0.88rem;
    color: var(--pizarra);
  }
  small,
  .modo small {
    display: block;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--gris);
  }
  .ayuda {
    margin: 0.4rem 0 0.7rem;
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }

  /* --- El semáforo, y los estados que usan sus mismos colores --- */
  .semaforo,
  .estado {
    border: 1.5px solid var(--borde);
    border-left-width: 5px;
    border-radius: var(--r-sm);
    padding: 0.7rem 0.85rem;
    background: var(--fondo);
    font-size: 0.83rem;
    line-height: 1.55;
    color: var(--pizarra);
  }
  .semaforo p,
  .estado p {
    margin: 0.25rem 0 0;
  }
  .verde {
    border-color: var(--exito);
    background: #eef7ea;
  }
  .ambar {
    border-color: var(--acento-2);
    background: #fff6df;
  }
  .rojo {
    border-color: var(--peligro);
    background: #fdeae8;
  }
  .titulo-semaforo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.92rem;
  }
  .luz {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--gris-claro);
  }
  .verde .luz {
    background: var(--exito);
  }
  .ambar .luz {
    background: var(--acento-2);
  }
  .rojo .luz {
    background: var(--peligro);
  }
  .semaforo ul {
    list-style: none;
    margin: 0.45rem 0 0;
    padding: 0;
  }
  .semaforo li {
    position: relative;
    padding-left: 1.1rem;
    margin: 0.2rem 0;
    background: none;
    border: none;
  }
  .semaforo li::before {
    content: "";
    position: absolute;
    left: 0.15rem;
    top: 0.5em;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--gris-claro);
  }
  .semaforo li.verde::before {
    background: var(--exito);
  }
  .semaforo li.ambar::before {
    background: var(--acento-2);
  }
  .semaforo li.rojo::before {
    background: var(--peligro);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    font-size: 0.74rem;
    padding: 0.15rem 0.55rem;
    border-radius: var(--r-pill);
    background: var(--blanco);
    border: 1px solid var(--borde);
    color: var(--pizarra);
  }
  .chip.fuerte {
    font-weight: 700;
  }
  .entrega {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--pizarra);
    padding: 0.4rem 0.6rem;
    border-radius: var(--r-sm);
    border: none;
  }

  .falta,
  .bloqueo,
  .ojo {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--pizarra);
    padding: 0.55rem 0.7rem;
    border-radius: var(--r-sm);
  }
  .falta {
    background: var(--claro);
  }
  .bloqueo {
    background: #fdeae8;
    border-left: 3px solid var(--peligro);
    margin-bottom: 0.4rem;
  }
  .ojo {
    background: #fff6df;
    border-left: 3px solid var(--acento-2);
    margin-top: 0.4rem;
  }
  .nota {
    margin: 0.3rem 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--gris);
  }
  .ok {
    margin: 0.3rem 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--exito-texto);
  }
  .error {
    margin: 0.3rem 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--peligro);
  }
  .alerta {
    background: #fdeae8;
    border: 1.5px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.75rem 0.95rem;
    font-size: 0.84rem;
    line-height: 1.55;
    color: var(--pizarra);
  }

  /* --- Llaves de producción --- */
  .llaves {
    margin-top: 1.1rem;
    font-size: 0.82rem;
  }
  .llaves summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--acento-texto);
  }
  .llaves ul {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .llaves li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
  }
  .llaves code {
    font-size: 0.78rem;
    color: var(--pizarra);
  }
  .cuando {
    color: var(--gris);
    font-size: 0.76rem;
  }
  .de {
    color: var(--gris);
    font-size: 0.78rem;
  }
  .de.vigente {
    color: var(--exito-texto);
    font-weight: 600;
  }
  .revocar {
    margin-left: auto;
    padding: 0.25rem 0.7rem;
    font-size: 0.76rem;
    color: var(--peligro);
    border-color: var(--peligro);
  }
  .revocar:hover {
    background: var(--peligro);
    color: var(--blanco);
  }

  .modal-fondo {
    position: fixed;
    z-index: 80;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: rgb(20 24 26 / 0.56);
  }
  .modal {
    width: min(100%, 29rem);
    padding: 1.35rem;
    border-radius: var(--r-md);
    background: var(--blanco);
    box-shadow: var(--sombra-lg);
  }
  .modal h2 {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    margin: 0 0 0.7rem;
    color: var(--pizarra);
  }
  .modal p {
    margin: 0 0 0.6rem;
    font-size: 0.86rem;
    line-height: 1.55;
    color: var(--pizarra);
  }
  .aviso-modal {
    font-weight: 700;
    color: var(--peligro) !important;
  }
  .botones-modal {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  .peligro {
    background: var(--peligro);
    border-color: var(--peligro);
    color: var(--blanco);
  }

  @media (max-width: 700px) {
    .modos,
    .dos {
      grid-template-columns: 1fr;
    }
  }
</style>
