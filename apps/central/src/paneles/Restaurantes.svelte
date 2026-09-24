<script lang="ts">
  /**
   * La cartera: lista de locales a la izquierda, ficha del elegido a la derecha.
   *
   * La ficha es donde se hace el trabajo de verdad: renovar la licencia, ver qué
   * versión tiene, y sacar el archivo que se pega en el local. Por eso el botón
   * de renovar está arriba y no escondido al final — es lo que se viene a hacer.
   */
  import {
    central,
    HORAS_MAXIMAS_DE_CORTE,
    type CredencialesResponsableIniciales,
    type EntregaLicencia,
  } from "../lib/central.svelte";
  import { desde, dinero, fecha, plazo } from "../lib/formato";
  import type { ActualizacionReportada } from "@motrest/dominio";
  import Alta from "./Alta.svelte";
  import EditarLocal from "./EditarLocal.svelte";
  import EncenderNube from "./EncenderNube.svelte";
  import Vencimiento from "./Vencimiento.svelte";
  import Cobros from "./Cobros.svelte";
  import Facturacion from "./Facturacion.svelte";

  /*
   * La ficha tiene dos pestañas y no una página más larga: la facturación se
   * configura con el restaurantero al teléfono, paso a paso, y mezclada con los
   * cobros y el equipo del local se perdía entre cosas que no vienen al caso. La
   * pestaña elegida se conserva al cambiar de local, porque lo normal es dejar
   * la facturación lista en varios seguidos.
   */
  let pestana = $state<"ficha" | "facturacion">("ficha");

  function textoActualizacion(a: ActualizacionReportada): string {
    const base = `Tiene la ${a.pendiente} esperando${a.vista_ts ? ` desde el ${fecha(a.vista_ts)}` : ""}`;
    if (a.error) return `${base} · falló al instalar: ${a.error}`;
    switch (a.eleccion) {
      case "ahora":
        return `${base} · pidió instalarla ya`;
      case "a_las":
        return `${base} · se instalará a las ${String(a.hora ?? 0).padStart(2, "0")}:00`;
      case "mas_tarde":
        return `${base} · la pospusieron`;
      default:
        return `${base} · nadie ha contestado el aviso en la caja`;
    }
  }

  /** ¿Algo de su facturación o su correo está en rojo? Se marca en la pestaña. */
  function facturacionConProblema(id: string): boolean {
    const estado = central.secretosDe(id).estado;
    return Boolean(
      central.filaSecretoDe(id, "facturapi")?.ultimo_error ||
        central.filaSecretoDe(id, "gmail")?.ultimo_error ||
        estado?.facturapi.error ||
        estado?.gmail.error,
    );
  }

  // `let` y no `const`: es un prop enlazado y esta pantalla lo reasigna al
  // elegir un local o al terminar un alta.
  let { seleccionado = $bindable("") }: { seleccionado?: string } = $props();

  let dandoAlta = $state(false);
  let editando = $state(false);
  /** «Encender Local en la Nube» abierto (1.6.0). */
  let encendiendoNube = $state(false);
  let cambiandoVencimiento = $state(false);
  let confirmandoCorte = $state(false);
  let aviso = $state("");
  let licenciaGenerada = $state("");
  let accesoResponsable = $state<{ nombre: string; pin: string } | null>(null);

  async function traerPulsos() {
    aviso = "";
    const resultado = await central.traerPulsos();
    aviso = resultado.ok
      ? `Se actualizó el estado de ${resultado.total} locales.`
      : resultado.error;
  }

  const cliente = $derived(central.clientes.find((c) => c.id === seleccionado) ?? null);
  const situacion = $derived(cliente ? central.situacionDe(cliente) : null);
  const salud = $derived(cliente ? central.saludDe(cliente) : null);
  const pulso = $derived(cliente ? central.pulsoDe(cliente.id) : null);

  /**
   * El equipo del local, con lo conectado primero.
   *
   * Se ordena por «visto» y no por nombre a propósito: lo que se busca en esta
   * lista es la tableta que dejó de aparecer, y esa está siempre al final.
   */
  const dispositivos = $derived(
    [...(pulso?.dispositivos ?? [])].sort((a, b) => b.visto_ts - a.visto_ts),
  );
  const sinAutorizar = $derived(dispositivos.filter((d) => !d.aprobado).length);

  const historia = $derived(cliente ? central.historiaDe(cliente.id) : null);
  /* La más reciente primero: lo que se discute es siempre la última o la anterior. */
  const emisiones = $derived([...(cliente?.emisiones ?? [])].sort((a, b) => b.ts - a.ts));

  const ETIQUETA_COBRO: Record<string, string> = {
    al_corriente: "Al corriente",
    por_cobrar: "Por cobrar",
    vencido: "Vencido — en gracia",
    bloqueado: "Bloqueado",
    sin_licencia: "Sin licencia",
  };

  /**
   * Emitir y —lo importante— hacérsela llegar al restaurante.
   *
   * EL ARCHIVO SE ENSEÑA SI HAY QUE PEGARLO, y hay un caso en que hace falta
   * aunque el depósito haya salido perfecto: **la primera licencia de un local**.
   *
   * Para recoger una licencia de la nube, el Hub necesita una dirección y una
   * credencial que viajan **dentro de esa licencia**. Un local que todavía no
   * tiene enlace no puede recibir por enlace el enlace. Central deposita, dice
   * «en espera», y el local se queda con su licencia vieja para siempre.
   *
   * Se distingue por el pulso: un local que **nunca ha reportado** no puede
   * recogerla, y punto. Uno que ya reportó alguna vez sí, y entonces enseñar el
   * JSON solo invita a pegarlo «por si acaso».
   */
  async function renovar() {
    if (!cliente) return;
    aviso = "";
    licenciaGenerada = "";
    const r = await central.emitir(cliente.id);
    if (!r.ok) {
      aviso = r.error ?? "No se pudo emitir";
      return;
    }
    if (r.credencialesResponsable) {
      accesoResponsable = {
        nombre: cliente.responsable?.nombre || cliente.contacto,
        pin: r.credencialesResponsable.pin,
      };
    }
    mostrarEntrega(r.licencia!.vence_ts, r.entrega!, r.motivoEntrega, r.licencia);
  }

  function mostrarEntrega(
    vence_ts: number,
    entrega: EntregaLicencia,
    motivo?: string,
    licencia?: unknown,
  ) {
    const hasta = `Vence el ${fecha(vence_ts)}.`;

    /*
     * ¿Este local ha dado señales alguna vez? Si no, no puede recogerla y hay
     * que pegarla a mano, por muy bien que haya ido el depósito.
     */
    const nuncaReporto = cliente ? !central.pulsoDe(cliente.id) : true;

    if (entrega === "entregada") {
      aviso = `Listo: el restaurante ya tiene su licencia. ${hasta} No hay que pegar nada.`;
      return;
    }
    if (entrega === "en_espera" && !nuncaReporto) {
      aviso =
        `Licencia enviada. ${hasta} El local está apagado o sin internet: ` +
        "la recogerá sola en cuanto encienda.";
      return;
    }
    if (entrega === "en_espera") {
      licenciaGenerada = JSON.stringify(licencia, null, 2);
      aviso =
        `Licencia depositada, pero este local NUNCA ha reportado. ${hasta} ` +
        "No puede recogerla solo: el enlace con la nube va dentro de esta " +
        "licencia. Péguela a mano esta vez; las siguientes sí llegarán solas.";
      return;
    }
    licenciaGenerada = JSON.stringify(licencia, null, 2);
    aviso = `${hasta} No se pudo enviar sola (${motivo ?? "sin nube"}): péguela en el local.`;
  }

  function copiar() {
    void navigator.clipboard?.writeText(licenciaGenerada);
    aviso = "Copiada. Péguela en el local: Administración → Licencia.";
  }

  function copiarPinResponsable() {
    if (!accesoResponsable) return;
    void navigator.clipboard?.writeText(accesoResponsable.pin);
  }

  /**
   * Enlazar con la nube un local que no lo está.
   *
   * Existe para dos casos: el alta cuya llamada a la nube no salió —internet
   * caído mientras se daba de alta al cliente— y los locales anteriores a que el
   * alta hiciera esto sola. Sin enlace, sus licencias hay que llevarlas a mano
   * una por una.
   */
  async function enlazarConLaNube() {
    if (!cliente) return;
    aviso = "";
    const r = await central.altaEnLaNube(cliente.id, cliente.nombre);
    aviso = r.ok
      ? `${cliente.nombre} quedó enlazado. Emítele una licencia y pégasela UNA vez en su caja: ` +
        "el enlace viaja dentro. De ahí en adelante las recibe solo."
      : `No se pudo enlazar: ${r.error}`;
  }

  /**
   * Cortar el servicio ahora, sin esperar a que la licencia venza sola.
   *
   * A un local ENLAZADO le llega solo, en segundos. A uno sin enlace hay que
   * pegarle el archivo, y por eso lo primero que hace esta pantalla es decir en
   * cuál de los dos casos está: prometer un corte que no va a llegar es peor que
   * no ofrecerlo.
   */
  async function cortarServicio() {
    if (!cliente) return;
    confirmandoCorte = false;
    aviso = "";
    licenciaGenerada = "";
    const r = await central.cortarServicio(cliente.id);
    if (!r.ok) {
      aviso = r.error ?? "No se pudo emitir el corte";
      return;
    }

    /*
     * SE DICE LO QUE VA A PASAR, NO LO QUE NOS GUSTARÍA.
     *
     * Antes, cualquier depósito contestaba «quedará suspendido en cuanto
     * encienda». Para un local que NUNCA ha reportado eso es simplemente falso:
     * el enlace con la nube viaja dentro de la licencia, así que un local con
     * licencia vieja no puede recoger nada —ni hoy ni al encender— y el corte se
     * quedaría esperando para siempre mientras el panel lo da por hecho. Es el
     * mismo error de fondo que dejó tres versiones publicadas sin llegarle a
     * nadie con todo en verde.
     */
    const nuncaReporto = !central.pulsoDe(cliente.id);

    if (r.entrega === "en_espera" && !nuncaReporto) {
      aviso =
        `Corte enviado a ${cliente.nombre}. Si está encendido lo recibe en segundos; ` +
        "si está apagado, al encender. Termina su jornada y queda bloqueado al cerrar " +
        `la caja, o a las ${HORAS_MAXIMAS_DE_CORTE} horas como máximo si no la cierra.`;
      return;
    }

    licenciaGenerada = JSON.stringify(r.licencia, null, 2);
    aviso =
      r.entrega === "en_espera"
        ? "Corte depositado, pero este local NUNCA ha reportado: NO puede recogerlo solo " +
          "y no se va a bloquear. Hay que pegarle este archivo en la caja una vez; a " +
          "partir de ahí sí obedecerá los cortes en remoto."
        : `No se pudo enviar solo (${r.motivoEntrega ?? "sin nube"}): pegue este archivo en el local.`;
  }

  function mostrarAccesoResponsable(id: string, credenciales: CredencialesResponsableIniciales) {
    const nuevo = central.clientes.find((c) => c.id === id);
    accesoResponsable = {
      nombre: nuevo?.responsable?.nombre || nuevo?.contacto || "Responsable",
      pin: credenciales.pin,
    };
  }
</script>

<main class="contenido">
  <aside class="lista">
    <div class="cabeza">
      <h1>Restaurantes</h1>
      <div class="acciones-cabeza">
        {#if central.puedeConsultarNube}
          <button
            class="secundario"
            disabled={central.consultandoPulsos}
            onclick={traerPulsos}
            title="Traer ahora el estado de los locales"
          >
            {central.consultandoPulsos ? "⏳" : "🔄"}
          </button>
        {/if}
        <button class="nuevo" onclick={() => (dandoAlta = true)}>+ Alta</button>
      </div>
    </div>

    <!--
      Se dice CUÁNDO se supo, no solo qué se sabe. Una versión instalada sin
      fecha al lado se lee como si fuera de ahora mismo, y podría ser de antes de
      la última publicación — que es justo cuando se mira.
    -->
    {#if central.puedeConsultarNube}
      <p class="sondeo" class:mal={central.errorPulsos !== ""}>
        {#if central.errorPulsos}
          Sin contacto con la nube: {central.errorPulsos}
        {:else if central.ultimaConsultaPulsos}
          Estado al día · consultado {desde(central.ultimaConsultaPulsos, central.ahora)}
        {:else}
          Consultando la nube…
        {/if}
      </p>
    {/if}

    {#if central.clientes.length === 0}
      <p class="ninguno">Todavía no hay ninguno.</p>
    {/if}

    {#each central.clientes as c (c.id)}
      {@const s = central.situacionDe(c)}
      {@const h = central.saludDe(c)}
      <button
        class="fila"
        class:on={c.id === seleccionado}
        class:inactivo={!c.activo}
        onclick={() => {
          seleccionado = c.id;
          licenciaGenerada = "";
          aviso = "";
        }}
      >
        <span class="punto {h.estado} {s.cobro}"></span>
        <span class="txt">
          <b>
            {c.nombre}
            {#if c.modalidad === "nube" || c.modalidad === "ambas"}
              <span class="modalidad" title={c.modalidad === "nube" ? "Sin computadora: datos en la nube" : "Con computadora y acceso por la web"}>
                {c.modalidad === "nube" ? "Nube" : "Web"}
              </span>
            {/if}
          </b>
          <em>{ETIQUETA_COBRO[s.cobro]}</em>
        </span>
      </button>
    {/each}
  </aside>

  <div class="ficha">
    {#if !cliente}
      <p class="elige">Elija un restaurante de la lista.</p>
    {:else}
      <header>
        <div>
          <h2>{cliente.nombre}</h2>
          <code>{cliente.id}</code>
        </div>
        <div class="acciones-ficha">
          <button class="editar" onclick={() => (editando = true)}>Editar datos</button>
          <!--
            LA NUBE, PARA UN LOCAL YA CONTRATADO (1.6.0). Solo si trabaja con su
            computadora y ya tiene licencia: la modalidad viaja dentro de ella.
            Encendida, el botón lleva a su acceso web (clave y contraseña).
          -->
          {#if cliente.activo && cliente.licencia && (cliente.modalidad ?? "app") === "app"}
            <button class="nube" onclick={() => (encendiendoNube = true)}>Encender Local en la Nube</button>
          {:else if cliente.modalidad === "ambas"}
            <button class="nube encendida" onclick={() => (editando = true)} title="Ver su clave y contraseña">
              Nube encendida
            </button>
          {/if}
          {#if cliente.activo}
            <button class="editar" onclick={() => (cambiandoVencimiento = true)}>
              Cambiar vencimiento…
            </button>
            <button class="renovar" onclick={renovar}>
              {cliente.licencia ? "Renovar licencia" : "Emitir licencia"}
            </button>
          {/if}
        </div>
      </header>

      {#if !cliente.activo}
        <p class="baja">Este local está dado de baja.</p>
      {/if}

      {#if aviso}
        <p class="aviso">{aviso}</p>
      {/if}

      {#if licenciaGenerada}
        <!--
          El archivo se enseña para copiar y pegar, no se descarga. Es lo que se
          hace en la práctica: se pega en la pantalla de licencia del local
          mientras se está al teléfono con el restaurantero.
        -->
        <div class="licencia">
          <div class="lic-cabeza">
            <b>licencia.json</b>
            <button onclick={copiar}>Copiar</button>
          </div>
          <pre>{licenciaGenerada}</pre>
        </div>
      {/if}

      <div class="pestanas" role="tablist">
        <button
          role="tab"
          aria-selected={pestana === "ficha"}
          class:on={pestana === "ficha"}
          onclick={() => (pestana = "ficha")}
        >
          Ficha
        </button>
        <button
          role="tab"
          aria-selected={pestana === "facturacion"}
          class:on={pestana === "facturacion"}
          onclick={() => (pestana = "facturacion")}
        >
          Facturación y correo
          {#if facturacionConProblema(cliente.id)}<b class="marca" title="Hay algo en rojo">!</b>{/if}
        </button>
      </div>

      {#if pestana === "facturacion"}
        <Facturacion {cliente} />
      {:else}
      <div class="datos">
        <div>
          <span>Cobro</span>
          <b>{situacion ? ETIQUETA_COBRO[situacion.cobro] : "—"}</b>
          {#if cliente.licencia}
            <em>Vence {plazo(situacion!.dias)} · {fecha(cliente.licencia.vence_ts)}</em>
          {/if}
        </div>
        <div>
          <span>Plan</span>
          <b>{dinero(cliente.cuota)}</b>
          <em>{cliente.plan === "anual" ? "al año" : "al mes"}</em>
        </div>
        <div>
          <span>Responsable</span>
          <b>{cliente.responsable?.nombre || cliente.contacto || "—"}</b>
          <em>
            {cliente.telefono || cliente.correo || "Sin teléfono ni correo"}
            {#if cliente.telefono && cliente.correo}<br />{cliente.correo}{/if}
          </em>
        </div>
        <div>
          <span>Versión instalada</span>
          <b>{pulso?.version ?? "—"}</b>
          <em>{pulso ? `Reportó ${desde(pulso.ts, central.ahora)}` : "Nunca ha reportado"}</em>
        </div>
        <div>
          <span>Equipo conectado</span>
          <b>
            {pulso?.terminales ?? "—"}{#if dispositivos.length > 0}<i>/{dispositivos.length}</i>{/if}
          </b>
          <em>
            {#if dispositivos.length > 0}
              conectadas ahora de {dispositivos.length} dadas de alta
            {:else}
              terminales conectadas
            {/if}
          </em>
        </div>
      </div>

      {#if cliente.notas}
        <p class="notas">{cliente.notas}</p>
      {/if}

      <h3>Estado de la instalación</h3>
      {#if salud?.estado === "bien"}
        <p class="bien">Todo en orden.</p>
      {:else}
        <ul class="problemas">
          {#each salud?.motivos ?? [] as motivo (motivo)}
            <li>{motivo}</li>
          {/each}
        </ul>
      {/if}

      <!--
        «¿Desde cuándo va mal?» es la pregunta que llega por teléfono, y con un
        solo estado guardado la única respuesta posible era «no sé».
      -->
      {#if historia && historia.partes > 0}
        <div class="historia">
          <span>
            {historia.partes}
            {historia.partes === 1 ? "parte recibido" : "partes recibidos"} ·
            reporta el <b>{historia.fiabilidad_pct} %</b> de los días
          </span>
          {#if historia.callado_desde_ts}
            <span class="mal">Callado desde el {fecha(historia.callado_desde_ts)}</span>
          {/if}
          {#if historia.versiones.length > 1}
            <span>
              Subió a {historia.versiones[0]!.version} el
              {fecha(historia.versiones[0]!.desde_ts)}
            </span>
          {/if}
        </div>
      {/if}

      {#if pulso}
        <div class="pulso">
          {#if pulso.ventas_dia !== undefined}
            <span>Último día: <b>{dinero(pulso.ventas_dia)}</b> · {pulso.cuentas_dia ?? 0} cuentas</span>
          {/if}
          {#if pulso.respaldo_ts}
            <span>Respaldo {desde(pulso.respaldo_ts, central.ahora)}</span>
          {/if}
          {#if pulso.eventos !== undefined}
            <span>{pulso.eventos.toLocaleString("es-MX")} eventos</span>
          {/if}
        </div>
      {/if}

      {#if dispositivos.length > 0}
        <h3>Su equipo</h3>
        <!--
          Emparejadas, no conectadas. Una tableta que lleva semanas sin aparecer
          sigue estando en esta lista, y ese es el punto: es la que hay que
          preguntar por teléfono, no la que se ve funcionando.
        -->
        <ul class="equipo">
          {#each dispositivos as d (d.device_id)}
            <li>
              <span class="nombre-equipo">{d.nombre || "Terminal sin nombre"}</span>
              <code>{d.device_id}</code>
              {#if !d.aprobado}
                <span class="sin-aprobar">Sin autorizar</span>
              {/if}
              <span class="visto">{d.visto_ts ? desde(d.visto_ts, central.ahora) : "nunca"}</span>
            </li>
          {/each}
        </ul>
        {#if sinAutorizar > 0}
          <p class="nota-equipo">
            {sinAutorizar === 1
              ? "Una terminal se presentó y el restaurante nunca la autorizó."
              : `${sinAutorizar} terminales se presentaron y el restaurante nunca las autorizó.`}
            Se autorizan desde el local, en <b>Administración → Terminales</b>.
          </p>
        {/if}
      {/if}

      {#if pulso?.hub_id || pulso?.plataforma || pulso?.arranque_automatico !== undefined || pulso?.actualizacion}
        <h3>Su Hub</h3>
        <div class="hub">
          {#if pulso.hub_id}
            <span>Hub <code>{pulso.hub_id}</code></span>
          {/if}
          {#if pulso.plataforma}
            <span>{pulso.plataforma}</span>
          {/if}
          {#if pulso.arranque_automatico !== undefined}
            <span class:mal={!pulso.arranque_automatico}>
              {pulso.arranque_automatico
                ? "Arranca solo al encender"
                : "NO arranca solo: el local abre a mano"}
            </span>
          {/if}
          <!-- Sin el campo, el Hub es anterior a él: no se dice nada en vez de adivinar. -->
          {#if pulso.actualizacion?.pendiente}
            <span class:mal={Boolean(pulso.actualizacion.error)}>
              {textoActualizacion(pulso.actualizacion)}
            </span>
          {:else if pulso.actualizacion}
            <span>Sin actualización pendiente</span>
          {/if}
        </div>
      {/if}

      <Cobros {cliente} />

      {#if emisiones.length > 0}
        <h3>Licencias emitidas</h3>
        <!--
          `cliente.licencia` guarda solo la última, que es justo la que borra la
          respuesta cuando alguien discute qué se le emitió y cuándo.
        -->
        <ul class="emisiones">
          {#each emisiones as e (e.ts)}
            <li>
              <span class="cuando">{fecha(e.ts)}</span>
              <span>{e.plan} · {dinero(e.cuota)}</span>
              <!--
                `corte` es la marca actual; `bloqueo_inmediato` se sigue mirando
                porque los cortes anteriores a sep-2026 se anotaron solo con ella
                y el historial tiene que seguir leyéndose entero.
              -->
              <span class="hasta">
                {e.corte || e.bloqueo_inmediato
                  ? "Corte de servicio"
                  : `Vigente hasta ${fecha(e.vence_ts)}`}
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      <!--
        EL LOCAL QUE NO ESTÁ EN LA NUBE, dicho donde se le mira la ficha.

        Desde sep-2026 el alta lo enlaza sola, así que esto solo sale para los
        locales anteriores o para un alta a la que le falló internet. Mientras no
        se enlace, sus licencias hay que llevárselas a mano una por una y no se
        le puede cortar en remoto — y nada en el panel lo decía.
      -->
      {#if cliente.activo && !central.tieneEnlaceNube(cliente.id)}
        <div class="sin-enlace">
          <div>
            <b>Este local no está enlazado con la nube.</b>
            <p>
              No recibirá licencias solo ni podrá cortársele el servicio en
              remoto. Al enlazarlo se le crea su identidad y su credencial; el
              enlace le llega dentro de la siguiente licencia, que hay que
              pegarle una vez en la caja.
            </p>
          </div>
          <button class="enlazar" onclick={enlazarConLaNube}>Enlazar con la nube</button>
        </div>
      {/if}

      <div class="pie-ficha">
        {#if cliente.activo}
          <button class="dar-baja" onclick={() => central.baja(cliente.id)}>
            Dar de baja
          </button>
          {#if cliente.licencia}
            <button class="cortar" onclick={() => (confirmandoCorte = true)}>
              Cortar el servicio ahora
            </button>
          {/if}
        {:else}
          <button class="dar-baja" onclick={() => central.actualizar(cliente.id, { activo: true })}>
            Reactivar
          </button>
        {/if}
      </div>
      {/if}
    {/if}
  </div>
</main>

{#if confirmandoCorte && cliente}
  <div class="modal-fondo" role="presentation">
    <div class="modal-acceso" role="alertdialog" aria-modal="true" aria-labelledby="corte-titulo">
      <h2 id="corte-titulo">Cortar el servicio de {cliente.nombre}</h2>
      <p>
        Se emitirá una licencia <b>ya vencida y sin días de gracia</b>. MotRest
        dejará de operar ahí: no podrán cobrar ni abrir cuentas.
      </p>
      <!--
        CUÁNDO cae, que es lo que de verdad hay que saber antes de pulsar.
        El corte no revienta el servicio en curso: espera a que cierren la caja.
      -->
      <p>
        <b>No corta a media cena.</b> Terminan la jornada que estén trabajando y
        quedan bloqueados al cerrar la caja — al día siguiente se encuentran la
        pantalla de MOTRAE con el teléfono para regularizar. Si no cierran la
        caja, cae igual a las <b>{HORAS_MAXIMAS_DE_CORTE} horas</b>.
      </p>
      {#if central.pulsoDe(cliente.id)}
        <p class="aviso-pin">
          Este local reporta, así que el corte le llega solo: en segundos si está
          encendido, o al encender si está apagado.
        </p>
      {:else}
        <!--
          Lo que hay que ver ANTES de pulsar, no después: un local que nunca
          reportó no puede recibir nada, y el corte se quedaría esperando para
          siempre mientras el panel lo da por hecho.
        -->
        <p class="aviso-pin">
          <b>Este local nunca ha reportado.</b> No va a recibir el corte solo: el
          enlace con la nube viaja dentro de la licencia, y la suya es anterior.
          Habrá que pegarle el archivo en la caja una vez; a partir de ahí sí
          obedecerá los cortes en remoto.
        </p>
      {/if}
      <div class="botones-modal">
        <button onclick={() => (confirmandoCorte = false)}>Cancelar</button>
        <button class="cortar" onclick={cortarServicio}>Sí, emitir el corte</button>
      </div>
    </div>
  </div>
{/if}

{#if dandoAlta}
  <Alta
    onCerrar={() => (dandoAlta = false)}
    onCreado={(id, credenciales, avisoNube, avisoWeb) => {
      seleccionado = id;
      dandoAlta = false;
      mostrarAccesoResponsable(id, credenciales);
      /*
       * Si el alta en la nube no salió, se dice AQUÍ y con el motivo. El
       * restaurante está creado y se puede trabajar con él, pero hasta que se
       * enlace no recibirá licencias solo — y eso hay que saberlo antes de
       * prometerle nada al cliente.
       */
      aviso = avisoNube
        ? `Restaurante creado, pero NO quedó enlazado con la nube: ${avisoNube} ` +
          "Sus licencias no le llegarán solas. Reintenta con «Enlazar con la nube»."
        : "";
      if (avisoWeb) {
        aviso = `${aviso} El acceso por internet no quedó configurado: ${avisoWeb} Reintenta desde «Editar datos».`.trim();
      }
    }}
  />
{/if}

{#if encendiendoNube && cliente}
  <EncenderNube {cliente} onCerrar={() => (encendiendoNube = false)} />
{/if}

{#if editando && cliente}
  <EditarLocal
    {cliente}
    onCerrar={() => (editando = false)}
    onGuardado={(avisos) => {
      editando = false;
      aviso = ["Datos guardados.", ...avisos].join(" ");
    }}
  />
{/if}

{#if cambiandoVencimiento && cliente}
  <Vencimiento
    {cliente}
    onCerrar={() => (cambiandoVencimiento = false)}
    onEmitida={(licencia, vence_ts, entrega, motivo) => {
      cambiandoVencimiento = false;
      licenciaGenerada = "";
      mostrarEntrega(vence_ts, entrega, motivo, JSON.parse(licencia));
    }}
  />
{/if}

{#if accesoResponsable}
  <div class="modal-fondo" role="presentation">
    <div class="modal-acceso" role="dialog" aria-modal="true" aria-labelledby="acceso-responsable-titulo">
      <h2 id="acceso-responsable-titulo">Acceso del responsable</h2>
      <p>
        Se creó la cuenta de <b>{accesoResponsable.nombre}</b> como <b>Propietario</b>.
        Es el nivel más alto del restaurante.
      </p>
      <p class="pin-etiqueta">PIN inicial</p>
      <div class="pin">
        <code>{accesoResponsable.pin}</code>
        <button onclick={copiarPinResponsable}>Copiar</button>
      </div>
      <p class="aviso-pin">
        Entrégalo por un medio privado. El responsable deberá cambiarlo al entrar por primera vez;
        este valor no se guarda en Central ni en el respaldo de la cartera.
      </p>
      <button class="renovar" onclick={() => (accesoResponsable = null)}>Ya lo anoté</button>
    </div>
  </div>
{/if}

<style>
  .modalidad {
    display: inline-block;
    margin-left: 0.3rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.66rem;
    font-weight: 600;
    vertical-align: middle;
    color: var(--acento);
    border: 1px solid var(--acento);
  }
  .contenido {
    display: grid;
    grid-template-columns: 17rem 1fr;
    height: 100%;
    min-height: 0;
  }
  .lista {
    border-right: 1px solid var(--borde);
    padding: 1.25rem 0.8rem;
    overflow-y: auto;
    background: var(--blanco);
  }
  .cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.9rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    margin: 0;
    color: var(--pizarra);
  }
  .nuevo {
    font: inherit;
    font-size: 0.76rem;
    font-weight: 700;
    padding: 0.3rem 0.7rem;
    border-radius: var(--r-pill);
    border: none;
    background: var(--acento);
    color: var(--blanco);
    cursor: pointer;
  }
  .acciones-cabeza {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .secundario {
    font: inherit;
    font-size: 0.76rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .secundario:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .ninguno {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .sondeo {
    margin: -0.4rem 0 0.7rem;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--gris);
  }
  .sondeo.mal {
    color: var(--peligro);
  }
  .fila {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fila:hover {
    background: var(--fondo);
  }
  .fila.on {
    background: var(--claro);
  }
  .fila.inactivo {
    opacity: 0.45;
  }
  /*
   * Un solo punto para las dos cosas, y manda la peor: un local caído importa
   * más que uno que debe. Dos puntos por fila obligarían a mirar cuál es cuál.
   */
  .punto {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2f9e6b;
  }
  .punto.atencion,
  .punto.por_cobrar {
    background: var(--acento-2);
  }
  .punto.vencido {
    background: var(--acento);
  }
  .punto.sin_senal,
  .punto.nunca_reporto,
  .punto.bloqueado {
    background: var(--peligro);
  }
  .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .txt b {
    font-size: 0.87rem;
    font-weight: 600;
    color: var(--pizarra);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt em {
    font-style: normal;
    font-size: 0.72rem;
    color: var(--gris);
  }
  .ficha {
    padding: 1.5rem 1.75rem 3rem;
    overflow-y: auto;
  }
  .elige {
    color: var(--gris);
    font-size: 0.9rem;
  }
  .ficha header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.45rem;
    margin: 0 0 0.15rem;
    color: var(--pizarra);
  }
  code {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .acciones-ficha {
    flex: none;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .nube {
    flex: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.6rem 1rem;
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--acento);
    cursor: pointer;
  }
  .nube.encendida {
    border-color: var(--borde);
    color: var(--pizarra);
  }
  .renovar {
    flex: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.6rem 1.1rem;
    border: none;
    border-radius: var(--r-sm);
    background: var(--acento);
    color: var(--blanco);
    cursor: pointer;
  }
  .editar {
    flex: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.6rem 1rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .editar:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .baja,
  .aviso {
    font-size: 0.84rem;
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.75rem;
    margin: 0 0 1rem;
    color: var(--pizarra);
  }
  .licencia {
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 1.2rem;
    overflow: hidden;
  }
  .lic-cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.7rem;
    background: var(--fondo);
    font-size: 0.78rem;
  }
  .lic-cabeza button {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--borde);
    background: var(--blanco);
    border-radius: var(--r-sm);
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
  pre {
    margin: 0;
    padding: 0.7rem;
    font-size: 0.72rem;
    line-height: 1.5;
    max-height: 12rem;
    overflow: auto;
    background: var(--blanco);
  }
  .pestanas {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--borde);
    margin-bottom: 1.1rem;
  }
  .pestanas button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    padding: 0.5rem 0.9rem;
    border: none;
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--gris);
    cursor: pointer;
  }
  .pestanas button:hover {
    color: var(--pizarra);
  }
  .pestanas button.on {
    color: var(--pizarra);
    border-bottom-color: var(--acento);
  }
  .marca {
    display: inline-grid;
    place-items: center;
    width: 1.05rem;
    height: 1.05rem;
    border-radius: 50%;
    background: var(--peligro);
    color: var(--blanco);
    font-size: 0.66rem;
  }
  .datos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .datos > div {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 0.85rem;
  }
  .datos span {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.2rem;
  }
  .datos b {
    display: block;
    font-size: 1rem;
    color: var(--pizarra);
  }
  .datos em {
    font-style: normal;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--gris);
  }
  /* «3/7»: el total va más discreto para que se lea primero lo conectado. */
  .datos b i {
    font-style: normal;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .notas {
    margin: 0.7rem 0 0;
    padding: 0.6rem 0.8rem;
    border-left: 3px solid var(--borde);
    font-size: 0.83rem;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--gris);
  }
  .equipo {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .equipo li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.83rem;
  }
  .nombre-equipo {
    font-weight: 600;
    color: var(--pizarra);
  }
  .equipo code {
    font-size: 0.72rem;
    color: var(--gris);
  }
  .sin-aprobar {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.45rem;
    border-radius: var(--r-pill);
    background: var(--acento-2);
    color: var(--negro);
  }
  .visto {
    margin-left: auto;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .nota-equipo {
    margin: 0.6rem 0 0;
    font-size: 0.79rem;
    line-height: 1.55;
    color: var(--gris);
  }
  .hub {
    display: flex;
    flex-wrap: wrap;
    gap: 1.1rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .hub code {
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .hub .mal {
    color: var(--peligro);
    font-weight: 600;
  }
  h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.6rem 0 0.6rem;
  }
  .bien {
    font-size: 0.86rem;
    color: var(--gris);
    margin: 0;
  }
  .problemas {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.86rem;
    line-height: 1.7;
    color: var(--pizarra);
  }
  .pulso {
    display: flex;
    flex-wrap: wrap;
    gap: 1.1rem;
    margin-top: 1rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .historia {
    display: flex;
    flex-wrap: wrap;
    gap: 1.1rem;
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .historia b {
    color: var(--pizarra);
  }
  .historia .mal {
    color: var(--peligro);
    font-weight: 600;
  }
  .emisiones {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .emisiones li {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.4rem 0.7rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .emisiones .cuando {
    font-weight: 600;
    min-width: 6.5rem;
  }
  .emisiones .hasta {
    margin-left: auto;
    color: var(--gris);
  }
  .pie-ficha {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 2rem;
  }
  /* El local sin enlace: se ve, porque es lo que impide todo lo demás. */
  .sin-enlace {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-top: 1.5rem;
    padding: 0.9rem 1rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    background: var(--claro);
  }
  .sin-enlace > div {
    flex: 1;
    min-width: 18rem;
  }
  .sin-enlace b {
    font-size: 0.9rem;
  }
  .sin-enlace p {
    margin-top: 0.25rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .enlazar {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    border: 1.5px solid var(--acento);
    background: var(--blanco);
    color: var(--acento-texto);
    border-radius: var(--r-sm);
    padding: 0.5rem 1rem;
    cursor: pointer;
    flex: none;
  }
  .enlazar:hover {
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .dar-baja,
  .cortar {
    font: inherit;
    font-size: 0.8rem;
    border: 1px solid var(--borde);
    background: none;
    border-radius: var(--r-sm);
    padding: 0.45rem 0.9rem;
    color: var(--gris);
    cursor: pointer;
  }
  .dar-baja:hover,
  .cortar:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .cortar {
    border-color: var(--peligro);
    color: var(--peligro);
    font-weight: 600;
  }
  .cortar:hover {
    background: var(--peligro);
    color: var(--blanco);
  }
  .botones-modal {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.1rem;
  }
  .botones-modal button {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
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
  .modal-acceso {
    width: min(100%, 29rem);
    padding: 1.35rem;
    border-radius: var(--r-md);
    background: var(--blanco);
    box-shadow: var(--sombra-lg);
  }
  .modal-acceso h2 { font-size: 1.2rem; }
  .modal-acceso p { font-size: 0.86rem; line-height: 1.55; color: var(--pizarra); }
  .pin-etiqueta { margin: 1.1rem 0 0.25rem; font-size: 0.72rem !important; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gris) !important; }
  .pin { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.75rem; border-radius: var(--r-sm); background: var(--fondo); }
  .pin code { font-size: 1.3rem; font-weight: 700; letter-spacing: 0.12em; color: var(--pizarra); }
  .pin button { font: inherit; font-size: 0.78rem; font-weight: 600; padding: 0.35rem 0.65rem; border: 1px solid var(--borde); border-radius: var(--r-sm); background: var(--blanco); cursor: pointer; }
  .aviso-pin { color: var(--gris) !important; }

  @media (max-width: 900px) {
    .contenido {
      grid-template-columns: 1fr;
    }
    .lista {
      border-right: none;
      border-bottom: 1px solid var(--borde);
      max-height: 14rem;
    }
  }
</style>
