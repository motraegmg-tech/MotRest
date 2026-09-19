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
  import {
    esCuentaGmail,
    problemasDeRemitente,
    remitenteGmail,
    type TipoCorreo,
  } from "@motrest/dominio";
  import {
    correo,
    direccionDe,
    normalizarConfiguracion,
  } from "../../correo.svelte";
  import { PARA_DE_EJEMPLO, datosDeEjemplo } from "../../correos-del-comensal";
  import { sesion } from "../../sesion/sesion.svelte";
  import VistaPreviaCorreo from "../../VistaPreviaCorreo.svelte";

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
  const COMO_SALE: Record<TipoCorreo, string> = {
    reserva_confirmada:
      "Sale solo cuando la casa acepta una reserva pedida desde el celular. Las que se apartan por teléfono se confirman desde la ficha del comensal.",
    reserva_recordatorio:
      "Se manda la víspera: con «Recordarle» en Reservas, o desde la ficha del comensal.",
    encuesta:
      "Se manda desde la ficha del comensal, después de su visita. Necesita el enlace de la encuesta.",
    gracias: "Se manda desde la ficha del comensal, después de su visita.",
    cupon:
      "Se manda desde la ficha, y solo a quien aceptó promociones. El mensaje lo escribes al mandarlo.",
    te_extranamos:
      "Se manda desde la ficha, y solo a quien aceptó promociones. El mensaje lo escribes al mandarlo.",
  };

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

  let editandoAsunto = $state<TipoCorreo | null>(null);
  let textoAsunto = $state("");

  function abrirAsunto(tipo: TipoCorreo, porDefecto: string) {
    editandoAsunto = tipo;
    textoAsunto = correo.config.asuntos?.[tipo] ?? porDefecto;
  }

  function guardarAsunto() {
    if (!editandoAsunto) return;
    correo.cambiarAsunto(editandoAsunto, textoAsunto);
    editandoAsunto = null;
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (editandoAsunto) editandoAsunto = null;
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
          Esa contraseña no se escribe en esta pantalla: es la llave para mandar
          correo en nombre del restaurante y se guarda solo en el Hub del local,
          no en las tabletas del salón. Soporte de MOTRAE la instala contigo.
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

      {#each correo.catalogo as d (d.tipo)}
        {@const encendido = !!correo.config.activos[d.tipo]}
        <article class="correo" class:on={encendido}>
          <div class="datos">
            <b>
              {d.etiqueta}
              {#if d.clase === "marketing"}<span class="chip">Publicidad</span>{/if}
            </b>
            <span>{d.descripcion}</span>
            <span class="como">{COMO_SALE[d.tipo]}</span>
            <span class="asunto">
              Asunto: «{correo.config.asuntos?.[d.tipo] ?? d.asuntoPorDefecto}»
              {#if puedeEditar}
                <button class="editar" onclick={() => abrirAsunto(d.tipo, d.asuntoPorDefecto)}>
                  cambiar
                </button>
              {/if}
            </span>
          </div>
          <div class="botones-correo">
            <button class="ver" onclick={() => (viendo = d.tipo)}>Ver cómo queda</button>
            {#if puedeEditar}
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
    {#if !correo.config.activos[viendo]}
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

{#if editandoAsunto}
  <div class="velo" role="presentation" onclick={() => (editandoAsunto = null)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Cambiar el asunto">
    <h3>Asunto del correo</h3>
    <input bind:value={textoAsunto} />
    <p class="pista">
      Puedes usar <code>{"{{local}}"}</code> y <code>{"{{nombre}}"}</code>: se
      cambian por el nombre del restaurante y el del comensal. Si lo dejas vacío
      vuelve el de siempre.
    </p>
    <div class="acciones">
      <button class="secundario" onclick={() => (editandoAsunto = null)}>Cancelar</button>
      <button class="principal" onclick={guardarAsunto}>Guardar</button>
    </div>
  </div>
{/if}

<style>
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
  .editar {
    margin-left: 0.3rem;
    padding: 0;
    color: var(--acento-texto);
    font-size: var(--t-sm);
    text-decoration: underline;
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
</style>
