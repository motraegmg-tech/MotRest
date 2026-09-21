<script lang="ts">
  /**
   * Correos al comensal: desde qué cuenta salen, cuáles se mandan y cómo le
   * llegan.
   *
   * Vivía en Administración como «Mensajes para el cliente» y se vino a
   * Clientes a petición de Gonzalo: es la relación con el comensal, no la
   * configuración de la caja. Y quien lo configura es quien después lo manda
   * desde la ficha.
   *
   * El restaurantero decide QUÉ correos existen; MotRest ya trae escrito el
   * CÓMO. Es a propósito: pedirle que redacte seis correos es garantizar que no
   * configure ninguno. Lo que sí puede es VER cada uno antes de encenderlo, con
   * el botón «Ver cómo queda», que enseña el correo de verdad y no un dibujo.
   *
   * DESDE LA 1.5.6 TAMBIÉN LOS ESCRIBE, si quiere. Gonzalo: «que estén las
   * versiones ejemplo, que son las que ya están, y aparte agregarles un botón
   * editar a cada uno». Los seis siguen llegando escritos —ese es el ejemplo— y
   * «Editar» abre el asunto, el título, el texto y, donde hay, el botón, con la
   * vista previa al lado. Y abajo, «Correos del restaurante»: los que crea él,
   * que nacen de un ejemplo ya redactado y son siempre publicidad.
   *
   * Lo que se escribe son palabras, no HTML. El diseño lo pone `armarCorreo`,
   * igual para los seis y para los nuevos, y la vista previa sale de esa misma
   * función: lo que se ve mientras se escribe es lo que va a llegar.
   *
   * LO QUE SE QUITÓ, Y POR QUÉ:
   *
   *   - «Responder a». Con Gmail el remitente ES el correo del restaurante, así
   *     que la respuesta le llega sola. El campo solo servía para mandar las
   *     respuestas —y las bajas de la publicidad— a una dirección vieja.
   *   - «El dominio tiene que estar verificado en Resend». Era falso para el caso
   *     normal: un `@gmail.com` no pasa por Resend, pasa por el servidor de
   *     Google con una contraseña de aplicación.
   *   - «MotRest los manda solos cuando toca». Solo la confirmación de una
   *     reserva sale sola; los demás se mandan desde la ficha o desde Reservas.
   *     Cada renglón dice ahora cómo sale de verdad el suyo.
   */
  import { tick } from "svelte";
  import {
    ARRANQUES_DE_CORREO,
    TOPES_CORREO,
    botonEditable,
    definicionCorreo,
    esCuentaGmail,
    esTipoPropio,
    estaEditado,
    marcadorEscrito,
    marcadoresDe,
    normalizarContrasenaGmail,
    plantillaDe,
    problemasDeRemitente,
    problemasDelBorrador,
    puedeGuardarSecretos,
    remitenteGmail,
    type ArranqueDeCorreo,
    type BorradorDeCorreo,
    type CampoDeCorreo,
    type ClaveMarcador,
    type TipoCorreo,
    type TipoCorreoDeLaCasa,
    type TipoCorreoPropio,
  } from "@motrest/dominio";
  import {
    correo,
    direccionDe,
    normalizarConfiguracion,
  } from "../../correo.svelte";
  import {
    PARA_DE_EJEMPLO,
    TIPO_EN_BORRADOR,
    borradorDe,
    borradorDelEjemplo,
    configConBorrador,
    datosDeEjemplo,
  } from "../../correos-del-comensal";
  import { sesion } from "../../sesion/sesion.svelte";
  import { revelar, subirAlPrincipio } from "../../subir";
  import { sync } from "../../sync.svelte";
  import VistaPreviaCorreo from "../../VistaPreviaCorreo.svelte";
  import Ordenar from "../../listas/Ordenar.svelte";
  import { ordenRecordado, ordenar, ordenesComunes, type OpcionOrden } from "../../listas/listas.svelte";

  /*
   * El mismo permiso que dar de alta y editar comensales: quien cuida la
   * relación con el cliente decide qué correos le llegan. La contraseña de la
   * cuenta NO pasa por esta pantalla —vive en el Hub—, así que no hace falta
   * subir el permiso al de administrar usuarios, que era el de antes.
   */
  const puedeVer = $derived(sesion.puedeVer("crm.cliente.editar"));
  const puedeEditar = $derived(sesion.puedeOperar("crm.cliente.editar"));

  /**
   * Cómo sale cada correo HOY, dicho con verdad.
   *
   * El catálogo del dominio dice CUÁNDO conviene cada uno («el día antes de su
   * reserva»); esto dice QUIÉN lo manda. Antes la pantalla prometía que
   * MotRest los mandaba solos, y salía uno de seis.
   */
  const COMO_SALE: Record<TipoCorreoDeLaCasa, string> = {
    reserva_confirmada:
      "Sale solo cuando la casa acepta una reserva pedida desde el celular. Las que se apartan por teléfono se confirman desde la ficha del comensal.",
    reserva_recordatorio:
      "Se manda la víspera: con «Recordarle» en Reservas, o desde la ficha del comensal.",
    encuesta:
      "Se manda desde la ficha del comensal, después de su visita. Necesita el enlace de la encuesta.",
    gracias: "Se manda desde la ficha del comensal, después de su visita.",
    cupon: "Se manda desde la ficha, y solo a quien aceptó promociones.",
    te_extranamos: "Se manda desde la ficha, y solo a quien aceptó promociones.",
  };

  /**
   * Cómo sale un correo, dicho según su plantilla: el cupón de fábrica pide el
   * mensaje al mandarlo; si el restaurante lo dejó escrito, ya no. Decir «el
   * mensaje lo escribes al mandarlo» de un correo que ya no lo pide es mandar a
   * alguien a buscar un cuadro que no va a aparecer.
   */
  function comoSale(tipo: TipoCorreo): string {
    const base = esTipoPropio(tipo)
      ? "Se manda desde la ficha, y solo a quien aceptó promociones."
      : COMO_SALE[tipo];
    const pide = plantillaDe(tipo, correo.config)?.texto.includes(marcadorEscrito("mensaje"));
    return pide ? `${base} Lo que dice lo escribes al mandarlo.` : base;
  }

  // --- Quién los manda -------------------------------------------------------------

  let cuenta = $state(direccionDe(correo.config.remitente));
  let local = $state(correo.config.local);
  let telefono = $state(correo.config.telefono ?? "");
  let avisoRemitente = $state("");
  let guardadoRemitente = $state(false);

  /*
   * EL REMITENTE SE ARMA, NO SE TECLEA. Se escribe la cuenta y el nombre del
   * local por separado, y aquí se juntan en «Rodizio <rodizio.gdl@gmail.com>».
   * Pedir esa forma a mano era pedir que alguien olvidara los ángulos, y sin el
   * nombre delante al comensal le llega un correo de «rodizio.gdl» y no de
   * «Rodizio».
   */
  const remitenteArmado = $derived(
    cuenta.trim() ? remitenteGmail(local, direccionDe(cuenta)) : "",
  );

  /*
   * Los problemas se calculan sobre lo que se está escribiendo, no sobre lo
   * guardado: decir «ese remitente no sirve» después de guardarlo es decirlo
   * tarde.
   */
  const problemasEnVivo = $derived(
    cuenta.trim()
      ? problemasDeRemitente(
          normalizarConfiguracion({
            ...correo.config,
            remitente: remitenteArmado,
            local: local.trim(),
          }),
        )
      : [],
  );

  function guardarRemitente() {
    guardadoRemitente = false;
    if (problemasEnVivo.length > 0) {
      avisoRemitente = "Corrige lo de arriba antes de guardar: así como está, no saldría ningún correo.";
      return;
    }
    const r = correo.actualizar({
      remitente: remitenteArmado,
      telefono: telefono.trim() || undefined,
      local: local.trim(),
    });
    avisoRemitente = r.ok ? "" : (r.error ?? "");
    guardadoRemitente = r.ok;
  }

  // --- La contraseña de aplicación (1.5.5) -------------------------------------------
  /*
   * Antes no tenía DÓNDE capturarse: el Hub la leía de una variable de entorno
   * y la pantalla decía «la instala soporte contigo». Ahora llega por dos
   * caminos, los mismos que la llave de FacturAPI: desde Central, cifrada para
   * este Hub, o aquí —solo el responsable del restaurante o el soporte de
   * MOTRAE, por rol—. Va directo al Hub y esta pantalla no la guarda: de vuelta
   * solo llegan sus cuatro últimas letras.
   */
  const puedeLlave = $derived(puedeGuardarSecretos(sesion.usuarioActual));
  const gmail = $derived(sync.secretos?.gmail ?? null);
  let contrasenaApp = $state("");
  let cambiandoLlave = $state(false);
  const contrasenaNormal = $derived(normalizarContrasenaGmail(contrasenaApp));

  $effect(() => {
    const id = sesion.usuarioActual?.id;
    if (sync.estado === "sincronizado" && id) sync.consultarSecretos(id);
  });
  // Se cierra el formulario cuando el Hub confirma que la guardó.
  $effect(() => {
    if (cambiandoLlave && sync.resultadoSecreto?.ok) cambiandoLlave = false;
  });

  function guardarContrasena() {
    const id = sesion.usuarioActual?.id;
    if (!contrasenaNormal || !id) return;
    sync.guardarSecreto({
      empleadoId: id,
      clase: "gmail",
      valor: contrasenaNormal,
      remitente: direccionDe(cuenta) || undefined,
    });
    // Sale de la pantalla en cuanto se manda.
    contrasenaApp = "";
  }

  // --- Enlace de la encuesta ---------------------------------------------------------

  let enlace = $state(correo.config.enlace_encuesta ?? "");
  let avisoEnlace = $state("");
  let guardadoEnlace = $state(false);

  function guardarEnlace() {
    const r = correo.actualizar({ enlace_encuesta: enlace });
    avisoEnlace = r.ok ? "" : (r.error ?? "");
    guardadoEnlace = r.ok;
  }

  // --- Qué correos se mandan --------------------------------------------------------

  let viendo = $state<TipoCorreo | null>(null);
  const definicionViendo = $derived(
    viendo ? correo.catalogo.find((d) => d.tipo === viendo) : undefined,
  );

  const propios = $derived(correo.propios);

  /*
   * «ORDENAR» (1.5.6): los correos que escribe el restaurante son una lista que
   * él mismo llena. Solo cambia la vista; por omisión, en el orden en que se
   * crearon, que es como se guardan.
   */
  type Propio = (typeof propios)[number];
  const OPCIONES_PROPIOS: OpcionOrden<Propio>[] = [
    ...ordenesComunes<Propio>({ nombre: (p) => p.nombre, fecha: (p) => p.creado_ts }),
    {
      id: "encendidos",
      etiqueta: "Encendidos primero",
      comparar: (a, b) => Number(b.activo) - Number(a.activo),
    },
  ];
  let ordenPropios = $state(ordenRecordado("clientes.correos", "antiguos"));
  const propiosOrdenados = $derived(
    ordenar(propios, OPCIONES_PROPIOS.find((o) => o.id === ordenPropios)),
  );

  /**
   * El último correo que se guardó o se creó. Su tarjeta dice «Guardado» y la
   * vista baja hasta ella: un correo nuevo se añade AL FINAL de la lista, que
   * en la pantalla de la caja suele quedar fuera de cuadro, y sin esto parecía
   * que «Crear correo» no había hecho nada (regla de Gonzalo, `subir.ts`).
   */
  let recienGuardado = $state<TipoCorreo | null>(null);

  /** El correo propio cuyo «Borrar» espera confirmación. */
  let borrando = $state<TipoCorreoPropio | null>(null);

  // --- El editor (1.5.6) ------------------------------------------------------------

  /**
   * Qué se está escribiendo: uno de los seis, uno propio, o uno nuevo — que
   * primero elige de qué ejemplo parte y después se escribe.
   */
  type Edicion =
    | { modo: "casa"; tipo: TipoCorreoDeLaCasa }
    | { modo: "propio"; tipo: TipoCorreoPropio }
    | { modo: "nuevo"; paso: "elegir" | "escribir"; arranque?: ArranqueDeCorreo };

  let edicion = $state<Edicion | null>(null);
  let borrador = $state<BorradorDeCorreo>({ asunto: "", titulo: "", texto: "" });
  let intentoGuardar = $state(false);
  let errorEditor = $state("");
  let avisoEjemplo = $state(false);
  let dialogoEditor = $state<HTMLDivElement | null>(null);

  const eligiendo = $derived(edicion?.modo === "nuevo" && edicion.paso === "elegir");
  /** Con qué tipo se valida y se ve la vista previa. Uno nuevo, con uno provisional. */
  const tipoEditando = $derived<TipoCorreo | null>(
    !edicion || eligiendo ? null : edicion.modo === "nuevo" ? TIPO_EN_BORRADOR : edicion.tipo,
  );
  const editandoPropio = $derived(!!tipoEditando && esTipoPropio(tipoEditando));
  const conBoton = $derived(!!tipoEditando && botonEditable(tipoEditando));
  const marcadores = $derived(tipoEditando ? marcadoresDe(tipoEditando) : []);
  const publicidadEditando = $derived(
    !!tipoEditando && definicionCorreo(tipoEditando)?.clase === "marketing",
  );

  const tituloEditor = $derived.by(() => {
    if (!edicion) return "";
    if (edicion.modo === "nuevo") {
      return edicion.paso === "elegir" ? "Nuevo correo" : `Nuevo correo: ${edicion.arranque?.nombre ?? ""}`;
    }
    return `Editar: ${definicionCorreo(edicion.tipo, correo.config)?.etiqueta ?? ""}`;
  });

  /*
   * LOS PROBLEMAS, EN VIVO Y SIN REGAÑAR. Un marcador que no aplica, un hueco
   * entre corchetes o un enlace que no es https se dicen mientras se escribe,
   * junto a su campo. «Falta el asunto» se calla hasta que se intenta guardar:
   * decirlo mientras alguien apenas abrió un correo en blanco es regañar antes
   * de tiempo.
   */
  const problemasEditor = $derived(tipoEditando ? problemasDelBorrador(tipoEditando, borrador) : []);
  const problemasVisibles = $derived(
    intentoGuardar ? problemasEditor : problemasEditor.filter((p) => !p.vacio),
  );
  function problemaDe(campo: CampoDeCorreo): string | undefined {
    return problemasVisibles.find((p) => p.campo === campo)?.mensaje;
  }

  /** La configuración como quedaría: de aquí sale la vista previa, con `armarCorreo`. */
  const configPrevia = $derived(
    tipoEditando ? configConBorrador(correo.config, tipoEditando, borrador) : correo.config,
  );

  function reiniciarEditor() {
    intentoGuardar = false;
    errorEditor = "";
    avisoEjemplo = false;
    reiniciarMarcas();
  }

  function editar(tipo: TipoCorreo) {
    const b = borradorDe(tipo, correo.config);
    if (!b) return;
    borrador = b;
    edicion = esTipoPropio(tipo)
      ? { modo: "propio", tipo }
      : { modo: "casa", tipo };
    recienGuardado = null;
    reiniciarEditor();
  }

  function nuevoCorreo() {
    edicion = { modo: "nuevo", paso: "elegir" };
    recienGuardado = null;
    reiniciarEditor();
  }

  /*
   * Elegir el ejemplo cambia TODO lo que hay dentro del diálogo —de la lista de
   * arranques al editor—, y la lista puede haberse desplazado para llegar al
   * último. Sin subir, el editor se abría a media altura, con el nombre y el
   * asunto fuera de cuadro. Lo mismo al volver a elegir. Ver `subir.ts`.
   */
  function elegirArranque(a: ArranqueDeCorreo) {
    borrador = { ...a.borrador };
    edicion = { modo: "nuevo", paso: "escribir", arranque: a };
    reiniciarEditor();
    subirAlPrincipio(dialogoEditor);
  }

  function elegirOtroArranque() {
    edicion = { modo: "nuevo", paso: "elegir" };
    reiniciarEditor();
    subirAlPrincipio(dialogoEditor);
  }

  function cerrarEditor() {
    edicion = null;
  }

  /**
   * «Volver al ejemplo» llena el editor con el texto de fábrica, y ahí se queda
   * hasta que se guarda. No se aplica solo: quien lo pulsó por curiosidad
   * cancela y no pierde lo que había escrito.
   */
  function volverAlEjemplo() {
    if (edicion?.modo !== "casa") return;
    borrador = borradorDelEjemplo(edicion.tipo);
    avisoEjemplo = true;
    reiniciarMarcas();
  }

  function reiniciarMarcas() {
    ultimoCampo = "texto";
    seleccion = { inicio: -1, fin: -1 };
  }

  function guardarEditor() {
    if (!edicion) return;
    intentoGuardar = true;

    let guardado: TipoCorreo;
    if (edicion.modo === "casa") {
      const r = correo.guardarPlantilla(edicion.tipo, borrador);
      if (!r.ok) return fallo(r.error, r.problemas?.length);
      guardado = edicion.tipo;
    } else if (edicion.modo === "propio") {
      const r = correo.guardarPropio(edicion.tipo, borrador);
      if (!r.ok) return fallo(r.error, r.problemas?.length);
      guardado = edicion.tipo;
    } else {
      const r = correo.crearPropio(borrador, edicion.arranque?.id);
      if (!r.ok) return fallo(r.error, r.problemas?.length);
      guardado = r.tipo;
    }

    edicion = null;
    recienGuardado = guardado;
  }

  /**
   * Por qué no se guardó, dicho JUNTO al botón de guardar. Cada problema se
   * marca también en su campo, pero el campo puede estar arriba, fuera de
   * cuadro, y quien pulsó «Guardar» está mirando aquí.
   */
  function fallo(error: string | undefined, cuantos = 0) {
    errorEditor =
      cuantos > 1
        ? `No se guardó: ${error ?? ""} (y ${cuantos - 1} más, marcados en su campo).`
        : `No se guardó: ${error ?? ""}`;
  }

  // --- Poner un dato con un toque -----------------------------------------------------

  type CampoConMarcas = "asunto" | "titulo" | "texto" | "boton";

  /*
   * DÓNDE ESTABA EL CURSOR. El toque en «Nombre del comensal» le quita el foco
   * al campo, así que se recuerda en qué campo y en qué posición se estaba
   * justo al perderlo (`onblur`). Funciona igual con ratón que con el dedo en
   * una tableta, que es donde `preventDefault` sobre el botón no basta.
   */
  let ultimoCampo = $state<CampoConMarcas>("texto");
  let seleccion = { inicio: -1, fin: -1 };
  let campoAsunto = $state<HTMLInputElement | null>(null);
  let campoTitulo = $state<HTMLInputElement | null>(null);
  let campoTexto = $state<HTMLTextAreaElement | null>(null);
  let campoBoton = $state<HTMLInputElement | null>(null);

  function elementoDe(campo: CampoConMarcas): HTMLInputElement | HTMLTextAreaElement | null {
    return { asunto: campoAsunto, titulo: campoTitulo, texto: campoTexto, boton: campoBoton }[campo];
  }

  function recordar(campo: CampoConMarcas, e: Event) {
    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    ultimoCampo = campo;
    seleccion = {
      inicio: el.selectionStart ?? el.value.length,
      fin: el.selectionEnd ?? el.value.length,
    };
  }

  async function insertar(clave: ClaveMarcador, soloEnTexto: boolean) {
    // El mensaje de varios renglones solo cabe en el texto, esté donde esté el cursor.
    const campo: CampoConMarcas = soloEnTexto || (ultimoCampo === "boton" && !conBoton) ? "texto" : ultimoCampo;
    const actual = borrador[campo] ?? "";
    const enSuSitio = seleccion.inicio >= 0 && seleccion.inicio <= actual.length && campo === ultimoCampo;
    const inicio = enSuSitio ? seleccion.inicio : actual.length;
    const fin = enSuSitio ? Math.min(Math.max(seleccion.fin, inicio), actual.length) : actual.length;
    const marca = marcadorEscrito(clave);

    borrador[campo] = actual.slice(0, inicio) + marca + actual.slice(fin);
    const cursor = inicio + marca.length;
    ultimoCampo = campo;
    seleccion = { inicio: cursor, fin: cursor };

    await tick();
    const el = elementoDe(campo);
    el?.focus();
    el?.setSelectionRange(cursor, cursor);
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (edicion) edicion = null;
    else if (borrando) borrando = null;
    else if (viendo) viendo = null;
  }
</script>

<svelte:window onkeydown={alTeclear} />

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Correos al comensal</h1>
      <p class="sub">
        Desde qué cuenta salen, cuáles se mandan y cómo le llegan. Se mandan desde
        la <b>ficha de cada comensal</b>; el recordatorio, también desde
        <b>Reservas</b>.
      </p>
    </div>
  </div>

  {#if !puedeVer}
    <p class="alerta" role="alert">
      Tu rol no puede ver la configuración de los correos del restaurante.
    </p>
  {:else}
    {#if !correo.listo}
      <!--
        Sin cuenta no sale NADA. Se dice arriba y no al final, para que nadie
        encienda seis correos y descubra después que ninguno llegó.
      -->
      <p class="alerta" role="alert">
        Falta la cuenta desde la que salen. Mientras no esté, <b>no se manda ningún correo</b>.
      </p>
    {:else if gmail && !gmail.configurada}
      <p class="alerta" role="alert">
        Falta la <b>contraseña de aplicación</b> de la cuenta. Mientras no esté en el
        Hub, <b>no se manda ningún correo</b>.
      </p>
    {/if}

    <section class="tarjeta bloque">
      <h2>Quién los manda</h2>
      <div class="campos">
        <label class="ancho">
          <span>Cuenta de Gmail del restaurante</span>
          <input
            type="email"
            bind:value={cuenta}
            placeholder="rodizio.gdl@gmail.com"
            autocomplete="off"
            spellcheck="false"
            disabled={!puedeEditar}
          />
        </label>
        <label>
          <span>Nombre del local</span>
          <input bind:value={local} placeholder="Rodizio" disabled={!puedeEditar} />
        </label>
        <label>
          <span>Teléfono</span>
          <input bind:value={telefono} inputmode="tel" placeholder="33 1122 3344" disabled={!puedeEditar} />
        </label>
      </div>

      <div class="ayuda">
        <p>
          La cuenta de Gmail que el restaurante ya usa, la que sus clientes
          conocen. Google entrega el correo con su propia firma, así que llega a
          la bandeja de entrada y no a spam, y no cuesta nada.
        </p>
        <p>
          Para que MotRest pueda mandar desde ella hace falta una
          <b>contraseña de aplicación</b> de Google: se genera en la cuenta de
          Google, en <i>Seguridad → Contraseñas de aplicaciones</i>, y Google solo
          la ofrece si la cuenta tiene activada la <b>verificación en dos pasos</b>.
          No es la contraseña de siempre de la cuenta.
        </p>
        <p>
          Esa contraseña es la llave para mandar correo en nombre del restaurante:
          se guarda solo en el Hub del local, nunca en las tabletas. La instala
          MOTRAE desde Central, o el responsable del restaurante aquí abajo.
        </p>
        <p>El teléfono aparece como botón «Llamar al restaurante» en cada correo.</p>
      </div>

      {#if remitenteArmado}
        <p class="asi-se-ve">Así lo verá el comensal: <b>{remitenteArmado}</b></p>
      {/if}

      {#if problemasEnVivo.length > 0}
        <ul class="problemas" role="alert">
          {#each problemasEnVivo as problema (problema)}
            <li>{problema}</li>
          {/each}
        </ul>
      {:else if cuenta.trim() && !esCuentaGmail(direccionDe(cuenta))}
        <p class="nota">
          Esa dirección no es de Gmail: saldrá por el dominio propio del
          restaurante, que tiene que estar dado de alta con MOTRAE.
        </p>
      {/if}

      <div class="llave-gmail">
        <h3>Contraseña de aplicación</h3>
        {#if gmail?.configurada && !cambiandoLlave}
          <p class="estado-llave">
            Instalada en el Hub · termina en <b>…{gmail.termina_en ?? "????"}</b> ·
            la puso {gmail.origen === "local" ? "el responsable, desde la caja" : "MOTRAE, desde Central"}
          </p>
          {#if gmail.error}<p class="error" role="alert">{gmail.error}</p>{/if}
          {#if puedeLlave}
            <button
              class="mini"
              onclick={() => {
                sync.resultadoSecreto = null;
                cambiandoLlave = true;
              }}
            >
              Cambiarla
            </button>
          {/if}
        {:else if puedeLlave}
          <label>
            <span>Las 16 letras que da Google</span>
            <input
              type="password"
              bind:value={contrasenaApp}
              placeholder="abcd efgh ijkl mnop"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          {#if contrasenaApp.trim() && !contrasenaNormal}
            <p class="error">Son 16 letras, sin números; Google las enseña en cuatro grupos de cuatro.</p>
          {/if}
          {#if sync.resultadoSecreto && !sync.resultadoSecreto.ok}
            <p class="error" role="alert">{sync.resultadoSecreto.problema}</p>
          {/if}
          <div class="acciones">
            {#if cambiandoLlave}
              <button class="mini" onclick={() => (cambiandoLlave = false)}>Cancelar</button>
            {/if}
            <button
              class="principal"
              disabled={!contrasenaNormal || sync.guardandoSecreto}
              onclick={guardarContrasena}
            >
              {sync.guardandoSecreto ? "Enviando al Hub…" : "Guardar en el Hub"}
            </button>
          </div>
        {:else}
          <p class="nota">
            {gmail
              ? "Todavía no está instalada. La instala MOTRAE desde Central, o el responsable del restaurante desde esta pantalla."
              : "Conecta esta terminal al Hub del local para ver si está instalada."}
          </p>
        {/if}
      </div>

      {#if avisoRemitente}<p class="error" role="alert">{avisoRemitente}</p>{/if}
      {#if puedeEditar}
        <div class="acciones">
          {#if guardadoRemitente}<span class="guardado" role="status">Guardado</span>{/if}
          <button class="principal" onclick={guardarRemitente}>Guardar</button>
        </div>
      {/if}
    </section>

    <section class="tarjeta bloque">
      <h2>Enlace de la encuesta</h2>
      <p class="nota">
        A dónde lleva el botón «Dejar mi opinión» de la encuesta: la página de
        reseñas de Google del restaurante o un formulario suyo. Sin este enlace la
        encuesta no se manda, porque preguntaría sin dejar contestar.
      </p>
      <div class="campos">
        <label class="ancho">
          <span>Enlace</span>
          <input
            type="url"
            bind:value={enlace}
            placeholder="https://g.page/r/…/review"
            autocomplete="off"
            spellcheck="false"
            disabled={!puedeEditar}
          />
        </label>
      </div>
      {#if avisoEnlace}<p class="error" role="alert">{avisoEnlace}</p>{/if}
      {#if puedeEditar}
        <div class="acciones">
          {#if guardadoEnlace}<span class="guardado" role="status">Guardado</span>{/if}
          <button class="principal" onclick={guardarEnlace}>Guardar</button>
        </div>
      {/if}
    </section>

    <section class="tarjeta bloque">
      <h2>Qué correos se mandan</h2>
      <p class="nota">
        Los <b>avisos</b> responden a algo que el comensal hizo —reservó, vino a
        comer— y no necesitan su permiso. La <b>publicidad</b> la decide el
        restaurante: solo va a quien aceptó recibirla en su ficha, y siempre le
        dice cómo darse de baja. No es cortesía: lo exige la ley de datos
        personales, y es lo que evita que la cuenta acabe en spam — y entonces
        dejarían de llegar hasta las confirmaciones de reserva.
      </p>

      <p class="nota">
        Cada uno trae su texto de ejemplo, que es el que sale mientras no lo
        cambies. Con <b>Editar</b> lo escribes a tu manera —el asunto, el título y
        el texto—, y <b>Volver al ejemplo</b> lo deja como venía.
      </p>

      {#each correo.deLaCasa as d (d.tipo)}
        {@const encendido = correo.encendido(d.tipo)}
        <article class="correo" class:on={encendido}>
          <div class="datos">
            <b>
              {d.etiqueta}
              {#if d.clase === "marketing"}<span class="chip">Publicidad</span>{/if}
              {#if estaEditado(d.tipo, correo.config)}<span class="chip editado">Escrito por ti</span>{/if}
            </b>
            <span>{d.descripcion}</span>
            <span class="como">{comoSale(d.tipo)}</span>
            <span class="asunto">Asunto: «{plantillaDe(d.tipo, correo.config)?.asunto}»</span>
            {#if recienGuardado === d.tipo}
              <span class="guardado" role="status" use:revelar>Guardado</span>
            {/if}
          </div>
          <div class="botones-correo">
            <button class="ver" onclick={() => (viendo = d.tipo)}>Ver cómo queda</button>
            {#if puedeEditar}
              <button class="ver" onclick={() => editar(d.tipo)}>Editar</button>
              <button
                class="interruptor"
                role="switch"
                aria-checked={encendido}
                aria-label={`${d.etiqueta}: ${encendido ? "encendido" : "apagado"}`}
                onclick={() => correo.alternar(d.tipo)}
              >
                {encendido ? "Encendido" : "Apagado"}
              </button>
            {:else}
              <span class="interruptor fijo">{encendido ? "Encendido" : "Apagado"}</span>
            {/if}
          </div>
        </article>
      {/each}
    </section>

    <!--
      LOS CORREOS DEL RESTAURANTE (1.5.6). Lo que los seis no cubren: un evento,
      el menú de temporada, el aniversario. Son publicidad siempre —decisión de
      Gonzalo—, y la pantalla lo dice antes de que alguien cree el primero.
    -->
    <section class="tarjeta bloque">
      <div class="cabeza">
        <h2>Correos del restaurante</h2>
        {#if puedeEditar}
          <button class="principal" disabled={!correo.cabeOtro} onclick={nuevoCorreo}>
            + Nuevo correo
          </button>
        {/if}
      </div>
      <p class="nota">
        Los que escribes tú, para lo que los de arriba no cubren. Vienen ya
        redactados como ejemplo: los cambias a tu gusto y llenas lo que va entre
        corchetes. Son <b>publicidad</b> siempre: solo llegan a quien aceptó
        promociones en su ficha, y al pie llevan cómo dejar de recibirlos. Se
        mandan desde la ficha del comensal.
      </p>

      {#if propios.length === 0}
        <p class="vacio">Todavía no hay ninguno.</p>
      {:else}
        {#if propios.length > 1}
          <div class="barra-orden">
            <Ordenar opciones={OPCIONES_PROPIOS} bind:valor={ordenPropios} recordar="clientes.correos" />
          </div>
        {/if}
        {#each propiosOrdenados as p (p.tipo)}
          <article class="correo" class:on={p.activo}>
            <div class="datos">
              <b>{p.nombre}<span class="chip">Publicidad</span></b>
              <span class="como">{comoSale(p.tipo)}</span>
              <span class="asunto">Asunto: «{p.asunto}»</span>
              {#if p.enlace}<span class="asunto">Botón: «{p.boton || "Ver más"}» → {p.enlace}</span>{/if}
              {#if recienGuardado === p.tipo}
                <span class="guardado" role="status" use:revelar>Guardado</span>
              {/if}
            </div>
            <div class="botones-correo">
              <button class="ver" onclick={() => (viendo = p.tipo)}>Ver cómo queda</button>
              {#if puedeEditar}
                <button class="ver" onclick={() => editar(p.tipo)}>Editar</button>
                <button
                  class="interruptor"
                  role="switch"
                  aria-checked={p.activo}
                  aria-label={`${p.nombre}: ${p.activo ? "encendido" : "apagado"}`}
                  onclick={() => correo.alternar(p.tipo)}
                >
                  {p.activo ? "Encendido" : "Apagado"}
                </button>
                <button class="ver quitar" onclick={() => (borrando = p.tipo)}>Borrar</button>
              {:else}
                <span class="interruptor fijo">{p.activo ? "Encendido" : "Apagado"}</span>
              {/if}
            </div>
            {#if borrando === p.tipo}
              <!-- Debajo de la tarjeta, y la vista baja hasta aquí: ver `subir.ts`. -->
              <div class="confirmar" role="alert" use:revelar>
                <p>
                  ¿Borrar «{p.nombre}»? Deja de ofrecerse en la ficha del comensal. Lo
                  que ya se mandó sigue en su historial.
                </p>
                <div class="acciones">
                  <button class="secundario" onclick={() => (borrando = null)}>Cancelar</button>
                  <button
                    class="peligro"
                    onclick={() => {
                      correo.borrarPropio(p.tipo);
                      borrando = null;
                    }}
                  >
                    Sí, borrarlo
                  </button>
                </div>
              </div>
            {/if}
          </article>
        {/each}
        <p class="cuenta">{propios.length} de {TOPES_CORREO.propios}</p>
      {/if}

      {#if puedeEditar && !correo.cabeOtro}
        <p class="nota">
          Ya hay {TOPES_CORREO.propios}: borra uno que ya no uses para hacer otro.
        </p>
      {/if}
    </section>
  {/if}
</div>

{#if viendo && definicionViendo}
  <div class="velo" role="presentation" onclick={() => (viendo = null)}></div>
  <div class="dialogo ancho" role="dialog" aria-modal="true" aria-label={`Cómo queda: ${definicionViendo.etiqueta}`}>
    <header>
      <h3>{definicionViendo.etiqueta}</h3>
      <button class="cerrar" onclick={() => (viendo = null)} aria-label="Cerrar">×</button>
    </header>
    <p class="pista">
      Con un comensal de ejemplo —Ana Ruiz, que reservó el viernes a las 21:00
      para cuatro— y con la configuración guardada de este restaurante.
    </p>
    {#if !correo.encendido(viendo)}
      <p class="pista aviso">Está apagado: así quedaría si lo enciendes.</p>
    {/if}
    {#if viendo === "encuesta" && !correo.config.enlace_encuesta}
      <p class="pista aviso">
        Sin enlace de la encuesta no tiene botón para contestar, y por eso no se
        manda.
      </p>
    {/if}
    <VistaPreviaCorreo
      tipo={viendo}
      para={PARA_DE_EJEMPLO}
      config={correo.config}
      datos={datosDeEjemplo(viendo)}
    />
    <div class="acciones">
      <button class="secundario" onclick={() => (viendo = null)}>Cerrar</button>
    </div>
  </div>
{/if}

{#if edicion}
  <!--
    EL VELO NO CIERRA EL EDITOR. En los demás diálogos un toque fuera cierra; aquí
    se perdería un correo a medio escribir por rozar la orilla de la tableta. Se
    cierra con «Cancelar», con la × o con Esc.
  -->
  <div class="velo" role="presentation"></div>
  <div
    class="dialogo editor"
    role="dialog"
    aria-modal="true"
    aria-label={tituloEditor}
    bind:this={dialogoEditor}
  >
    <header>
      <h3>{tituloEditor}</h3>
      <button class="cerrar" onclick={cerrarEditor} aria-label="Cerrar">×</button>
    </header>

    {#if eligiendo}
      <p class="pista">
        Elige de qué ejemplo partir. Todos vienen escritos: los cambias a tu gusto
        y llenas lo que va entre corchetes. Siempre son publicidad: solo llegan a
        quien aceptó promociones.
      </p>
      <ul class="arranques">
        {#each ARRANQUES_DE_CORREO as a (a.id)}
          <li>
            <button class="arranque" onclick={() => elegirArranque(a)}>
              <b>{a.nombre}</b>
              <span>{a.descripcion}</span>
              {#if a.borrador.asunto}<span class="asunto">Asunto: «{a.borrador.asunto}»</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
      <div class="acciones">
        <button class="secundario" onclick={cerrarEditor}>Cancelar</button>
      </div>
    {:else if tipoEditando}
      <p class="pista">
        Escribe con tus palabras. El diseño, el saludo con el nombre del comensal,
        el botón para llamar{publicidadEditando ? " y, al pie, cómo darse de baja" : ""}
        los pone MotRest.
      </p>

      <div class="rejilla">
        <div class="campos-editor">
          {#if editandoPropio}
            <label>
              <span>Nombre del correo <small>· lo ves tú, no el comensal</small></span>
              <input
                bind:value={borrador.nombre}
                maxlength={TOPES_CORREO.nombre}
                placeholder="Noche italiana"
                class:mal={!!problemaDe("nombre")}
              />
              {#if problemaDe("nombre")}<small class="error">{problemaDe("nombre")}</small>{/if}
            </label>
          {/if}

          <label>
            <span>Asunto</span>
            <input
              bind:this={campoAsunto}
              bind:value={borrador.asunto}
              maxlength={TOPES_CORREO.asunto}
              onfocus={(e) => recordar("asunto", e)}
              onblur={(e) => recordar("asunto", e)}
              class:mal={!!problemaDe("asunto")}
            />
            {#if problemaDe("asunto")}<small class="error">{problemaDe("asunto")}</small>{/if}
          </label>

          <label>
            <span>Título <small>· vacío, va el nombre del local</small></span>
            <input
              bind:this={campoTitulo}
              bind:value={borrador.titulo}
              maxlength={TOPES_CORREO.titulo}
              onfocus={(e) => recordar("titulo", e)}
              onblur={(e) => recordar("titulo", e)}
              class:mal={!!problemaDe("titulo")}
            />
            {#if problemaDe("titulo")}<small class="error">{problemaDe("titulo")}</small>{/if}
          </label>

          <label>
            <span>Texto <small>· una línea en blanco separa los párrafos</small></span>
            <textarea
              bind:this={campoTexto}
              bind:value={borrador.texto}
              rows="9"
              maxlength={TOPES_CORREO.texto}
              onfocus={(e) => recordar("texto", e)}
              onblur={(e) => recordar("texto", e)}
              class:mal={!!problemaDe("texto")}
            ></textarea>
            {#if problemaDe("texto")}<small class="error">{problemaDe("texto")}</small>{/if}
          </label>

          <!--
            Los datos que se ponen solos, con un toque. Van donde estaba el
            cursor, y al mandarlo se cambian por el dato de verdad: la vista
            previa de al lado ya lo enseña con los de Ana Ruiz.
          -->
          <div class="marcadores" role="group" aria-label="Poner un dato">
            <span>Poner un dato:</span>
            {#each marcadores as m (m.clave)}
              <button type="button" class="marcador" onclick={() => insertar(m.clave, m.soloEnTexto)}>
                + {m.etiqueta}
              </button>
            {/each}
          </div>
          <p class="pista">
            Cada dato aparece escrito entre llaves —<code>{marcadorEscrito("nombre")}</code>— y al
            mandarlo se cambia solo por el de ese comensal.
          </p>
          {#if borrador.texto.includes(marcadorEscrito("mensaje"))}
            <p class="pista">
              <code>{marcadorEscrito("mensaje")}</code> es lo que escribas al mandarlo desde la
              ficha. Si lo quitas, el correo sale siempre con este texto y ya no pide
              mensaje.
            </p>
          {/if}

          {#if conBoton}
            <label>
              <span>Texto del botón</span>
              <input
                bind:this={campoBoton}
                bind:value={borrador.boton}
                maxlength={TOPES_CORREO.boton}
                placeholder={editandoPropio ? "Ver el menú" : ""}
                onfocus={(e) => recordar("boton", e)}
                onblur={(e) => recordar("boton", e)}
                class:mal={!!problemaDe("boton")}
              />
              {#if problemaDe("boton")}<small class="error">{problemaDe("boton")}</small>{/if}
            </label>
          {/if}
          {#if editandoPropio}
            <label>
              <span>A dónde lleva el botón <small>· opcional, solo https://</small></span>
              <input
                type="url"
                bind:value={borrador.enlace}
                placeholder="https://…"
                autocomplete="off"
                spellcheck="false"
                class:mal={!!problemaDe("enlace")}
              />
              {#if problemaDe("enlace")}<small class="error">{problemaDe("enlace")}</small>{/if}
            </label>
          {/if}
        </div>

        <div class="previa">
          <h4>Así le llega a Ana Ruiz</h4>
          <VistaPreviaCorreo
            tipo={tipoEditando}
            para={PARA_DE_EJEMPLO}
            config={configPrevia}
            datos={datosDeEjemplo(tipoEditando)}
          />
        </div>
      </div>

      {#if avisoEjemplo}
        <p class="pista aviso" role="status">
          Es el texto de fábrica. Guarda para quedarte con él, o Cancelar para
          dejarlo como estaba.
        </p>
      {/if}
      {#if errorEditor}<p class="error" role="alert">{errorEditor}</p>{/if}

      <div class="acciones">
        {#if edicion.modo === "casa"}
          <button class="secundario izquierda" onclick={volverAlEjemplo}>Volver al ejemplo</button>
        {:else if edicion.modo === "nuevo"}
          <button class="secundario izquierda" onclick={elegirOtroArranque}>Elegir otro ejemplo</button>
        {/if}
        <button class="secundario" onclick={cerrarEditor}>Cancelar</button>
        <button class="principal" onclick={guardarEditor}>
          {edicion.modo === "nuevo" ? "Crear correo" : "Guardar"}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* --- La contraseña de aplicación --- */
  .llave-gmail {
    margin-top: 1rem;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--borde);
    border-radius: var(--r-md, 10px);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .llave-gmail h3 {
    font-size: 0.92rem;
    font-weight: 650;
  }
  .llave-gmail label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-width: 22rem;
  }
  .estado-llave {
    font-size: 0.85rem;
    color: var(--pizarra);
  }
  .seccion {
    flex: 1;
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 60rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.55rem;
    font-weight: 700;
  }
  .sub {
    font-size: 0.88rem;
    color: var(--gris);
    margin-top: 0.25rem;
    max-width: 44rem;
    line-height: 1.5;
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css. Aquí solo
     el relleno, con una clase propia para no redefinir la tarjeta. */
  .bloque {
    padding: 1.1rem 1.25rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.6rem;
  }
  .nota,
  .alerta {
    font-size: var(--t-sm);
    color: var(--gris);
    line-height: 1.55;
    margin-bottom: 0.9rem;
    max-width: 46rem;
  }
  .alerta {
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 7%, transparent);
    color: var(--pizarra);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 12rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.92rem;
    width: 100%;
    background: var(--blanco);
  }
  input:focus {
    border-color: var(--acento);
  }
  input:disabled {
    background: var(--fondo);
    color: var(--gris);
  }
  .ayuda {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    max-width: 46rem;
  }
  .ayuda p {
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.55;
  }
  .ayuda b,
  .ayuda i {
    color: var(--pizarra);
  }
  .asi-se-ve {
    margin-top: 0.8rem;
    font-size: var(--t-sm);
    color: var(--gris);
    overflow-wrap: anywhere;
  }
  .asi-se-ve b {
    color: var(--pizarra);
  }
  .problemas {
    margin-top: 0.7rem;
    padding: 0.6rem 0.85rem 0.6rem 1.9rem;
    border: 1px solid var(--peligro);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--peligro) 6%, var(--blanco));
    list-style: disc;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--pizarra);
  }
  .correo {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 0.45rem;
  }
  .correo.on {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 4%, transparent);
  }
  .correo .datos {
    flex: 1;
    min-width: 16rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .correo b {
    font-size: 0.95rem;
  }
  .correo .datos > span {
    font-size: var(--t-sm);
    color: var(--gris);
    line-height: 1.5;
  }
  .como {
    font-style: italic;
  }
  .asunto {
    margin-top: 0.2rem;
  }
  .chip {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0.05rem 0.45rem;
    border-radius: var(--r-pill);
    background: var(--claro);
    color: var(--acento-texto);
    font-size: var(--t-xs);
    font-weight: 600;
    vertical-align: middle;
  }
  .chip.editado {
    background: var(--fondo);
    color: var(--pizarra);
    border: 1px solid var(--borde);
  }
  .botones-correo {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .ver,
  .interruptor {
    padding: 0.45rem 0.9rem;
    min-height: 2.4rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    background: var(--blanco);
    font-size: var(--t-sm);
    font-weight: 600;
    white-space: nowrap;
    color: var(--pizarra);
  }
  .ver:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .correo.on .interruptor {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .interruptor.fijo {
    display: inline-flex;
    align-items: center;
    cursor: default;
  }
  .acciones {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.8rem;
  }
  .guardado {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--exito-texto);
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    min-height: var(--toque);
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    background: var(--blanco);
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    min-height: var(--toque);
    font-weight: 600;
  }
  .error {
    color: var(--peligro);
    font-size: var(--t-sm);
    margin-top: 0.6rem;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: var(--z-velo);
  }
  .dialogo {
    position: fixed;
    z-index: var(--z-dialogo);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.25rem;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .dialogo.ancho {
    width: min(40rem, calc(100vw - 2rem));
  }
  .dialogo header {
    display: flex;
    align-items: center;
  }
  h3 {
    flex: 1;
    font-size: 1.1rem;
  }
  .cerrar {
    font-size: 1.5rem;
    line-height: 1;
    color: var(--gris);
    min-width: var(--toque);
    min-height: var(--toque);
  }
  .pista {
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.5;
  }
  .pista.aviso {
    color: var(--acento-texto);
    font-weight: 600;
  }
  code {
    background: var(--fondo);
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    font-size: 0.9em;
  }

  /* --- Correos del restaurante (1.5.6) --- */
  .cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }
  .cabeza h2 {
    margin-bottom: 0;
  }
  .principal:disabled {
    background: var(--borde);
    color: var(--gris);
    cursor: not-allowed;
  }
  .vacio,
  .cuenta {
    font-size: var(--t-sm);
    color: var(--gris);
  }
  .cuenta {
    text-align: right;
    margin-top: 0.3rem;
  }
  .ver.quitar:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .confirmar {
    flex-basis: 100%;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--peligro);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--peligro) 6%, var(--blanco));
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--pizarra);
  }
  .confirmar .acciones {
    margin-top: 0.5rem;
  }
  .peligro {
    background: var(--peligro);
    color: var(--blanco);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    min-height: var(--toque);
    font-weight: 600;
  }

  /* --- El editor --- */
  .dialogo.editor {
    width: min(70rem, calc(100vw - 2rem));
  }
  .rejilla {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.1rem;
  }
  @media (min-width: 960px) {
    .rejilla {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
    /* La vista previa acompaña mientras se baja por los campos. */
    .previa {
      position: sticky;
      top: 0;
    }
  }
  .campos-editor {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-width: 0;
  }
  .campos-editor label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos-editor label > span {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--gris);
  }
  .campos-editor label small {
    font-weight: 400;
  }
  textarea {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.92rem;
    line-height: 1.55;
    width: 100%;
    resize: vertical;
    background: var(--blanco);
  }
  textarea:focus {
    border-color: var(--acento);
  }
  input.mal,
  textarea.mal {
    border-color: var(--peligro);
  }
  small.error {
    margin-top: 0;
    font-size: var(--t-xs);
  }
  .marcadores {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .marcadores > span {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--gris);
    margin-right: 0.2rem;
  }
  .marcador {
    padding: 0.35rem 0.75rem;
    min-height: 2.3rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-pill);
    background: color-mix(in srgb, var(--acento) 6%, var(--blanco));
    color: var(--acento-texto);
    font-size: var(--t-xs);
    font-weight: 600;
  }
  .previa {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .previa h4 {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--gris);
  }
  .arranques {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }
  .arranque {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.8rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--blanco);
    text-align: left;
  }
  .arranque:hover {
    border-color: var(--acento);
  }
  .arranque b {
    font-size: 0.95rem;
  }
  .arranque span {
    font-size: var(--t-sm);
    color: var(--gris);
    line-height: 1.45;
  }
  .acciones .izquierda {
    margin-right: auto;
  }
  .barra-orden {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.5rem;
  }
</style>
