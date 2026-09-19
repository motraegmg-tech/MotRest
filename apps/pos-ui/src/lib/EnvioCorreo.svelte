<script lang="ts">
  /**
   * Mandar UN correo a UN comensal: verlo, mandarlo y saber cómo acabó.
   *
   * Lo usan la ficha del comensal y la pantalla de Reservas. Va en un solo
   * componente para que las dos digan lo mismo: un «Enviado» que en una
   * pantalla significa «el Hub lo mandó» y en otra «lo pedí» es cómo se acaba
   * mandando el mismo cupón dos veces.
   *
   * EL ESTADO SALE DEL REGISTRO, no de este componente. Aquí solo se recuerda
   * el `solicitud_id` de lo que se acaba de pedir; si está «Enviado» o «No se
   * mandó» lo dice la respuesta del Hub cuando llega, a esta terminal o a
   * cualquier otra.
   */
  import {
    definicionCorreo,
    puedeMandarCorreo,
    type DatosCorreo,
    type ID,
    type TipoCorreo,
  } from "@motrest/dominio";
  import { correo } from "./correo.svelte";
  import { MENSAJE_DE_EJEMPLO } from "./correos-del-comensal";
  import { hora } from "./formato";
  import { sesion } from "./sesion/sesion.svelte";
  import VistaPreviaCorreo from "./VistaPreviaCorreo.svelte";

  interface Props {
    tipo: TipoCorreo;
    /** La dirección del comensal. */
    para: string;
    /** Cómo se llama, para el botón: «Mandar a Ana Ruiz». */
    nombre: string;
    /** Lo que ya se sabe: su nombre, y la fecha de su reserva si es de reserva. */
    datos: DatosCorreo;
    clienteId?: ID;
    /** Lo que dice su ficha. El Hub lo vuelve a comprobar contra la ficha al mandar. */
    aceptaMarketing: boolean;
    /** Si se pasa, aparece «Elegir otro correo». */
    onvolver?: () => void;
    oncerrar: () => void;
  }

  let { tipo, para, nombre, datos, clienteId, aceptaMarketing, onvolver, oncerrar }: Props =
    $props();

  const definicion = $derived(definicionCorreo(tipo));
  const publicidad = $derived(definicion?.clase === "marketing");

  /** El cuerpo de una promoción. Empieza vacío: lo escribe quien la manda. */
  let mensaje = $state("");
  let error = $state("");
  let solicitudId = $state<ID | null>(null);

  const datosFinales = $derived<DatosCorreo>(
    publicidad && mensaje.trim() ? { ...datos, mensaje: mensaje.trim() } : datos,
  );

  const veredicto = $derived(puedeMandarCorreo(tipo, para, correo.config, aceptaMarketing));
  const faltaMensaje = $derived(publicidad && !mensaje.trim());

  const solicitud = $derived(
    solicitudId ? correo.solicitudes.find((s) => s.solicitud_id === solicitudId) : undefined,
  );

  /*
   * EL RELOJ SOLO CORRE MIENTRAS SE ESPERA. Sirve para una cosa: decir que el
   * Hub no ha contestado cuando ya pasó un minuto, en vez de dejar «Enviando…»
   * para siempre. Un «Enviando…» eterno es lo que hace que alguien lo pida otra
   * vez — y entonces, cuando el Hub vuelve, salen los dos.
   */
  let ahora = $state(Date.now());
  $effect(() => {
    if (solicitud?.estado !== "pendiente") return;
    const reloj = setInterval(() => (ahora = Date.now()), 5_000);
    return () => clearInterval(reloj);
  });
  const sinRespuesta = $derived(
    solicitud?.estado === "pendiente" && ahora - solicitud.pedido_ts > 60_000,
  );

  function mandar() {
    const usuario = sesion.usuarioActual;
    if (!usuario) {
      error = "Inicia sesión para mandar correos";
      return;
    }
    // A nombre de quien pulsa, justo ahora: la caja cambia de manos a media
    // pantalla, y el correo tiene que quedar a nombre de quien lo decidió.
    correo.actuarComo(usuario.id);
    const r = correo.solicitar(tipo, para, datosFinales, {
      cliente_id: clienteId,
      acepta_marketing: aceptaMarketing,
    });
    if (!r.ok) {
      error = r.error;
      return;
    }
    error = "";
    ahora = Date.now();
    solicitudId = r.solicitud_id;
  }

  /** Tras un rechazo: se puede volver a pedir, ya con lo que se haya corregido. */
  function otraVez() {
    solicitudId = null;
    error = "";
  }
</script>

<div class="envio">
  {#if publicidad}
    <label class="mensaje">
      <span>El mensaje</span>
      <textarea
        bind:value={mensaje}
        rows="4"
        maxlength="1200"
        placeholder={MENSAJE_DE_EJEMPLO[tipo] ?? ""}
        disabled={solicitudId !== null}
      ></textarea>
      <small>
        Es lo que leerá debajo de su nombre. Al pie va solo, siempre, cómo dejar
        de recibirlas: responder BAJA a este correo.
      </small>
    </label>
  {/if}

  <VistaPreviaCorreo {tipo} {para} config={correo.config} datos={datosFinales} />

  {#if solicitud}
    <!--
      Lo que dice el registro. «Enviado» significa que el Hub se lo entregó a
      Google, no que alguien pulsó un botón.
    -->
    {#if solicitud.estado === "enviado"}
      <p class="estado bien" role="status">
        <b>Enviado</b> a {solicitud.correo}{#if solicitud.resuelto_ts} a las {hora(solicitud.resuelto_ts)}{/if}.
      </p>
    {:else if solicitud.estado === "rechazado"}
      <p class="estado mal" role="alert">
        <b>No se mandó:</b> {solicitud.motivo ?? "el Hub no dijo por qué"}
      </p>
    {:else if sinRespuesta}
      <p class="estado espera" role="status">
        <b>El Hub todavía no lo ha visto</b>, o lo tiene esperando a que vuelva
        internet para mandarlo. No lo pidas otra vez: saldría dos veces. Aquí
        mismo verás cuando salga.
      </p>
    {:else}
      <p class="estado espera" role="status"><b>Enviando…</b></p>
    {/if}

    <div class="botones">
      {#if solicitud.estado === "rechazado"}
        <button class="secundario" onclick={otraVez}>Intentar otra vez</button>
      {/if}
      {#if onvolver}
        <button class="secundario" onclick={onvolver}>Mandar otro correo</button>
      {/if}
      <button class="principal" onclick={oncerrar}>Listo</button>
    </div>
  {:else if !veredicto.puede}
    <!-- Nunca un botón gris sin explicación: quien no entiende por qué, llama a soporte. -->
    <p class="estado mal" role="alert"><b>No se puede mandar:</b> {veredicto.razon}</p>
    <div class="botones">
      {#if onvolver}
        <button class="secundario" onclick={onvolver}>Elegir otro correo</button>
      {/if}
      <button class="secundario" onclick={oncerrar}>Cerrar</button>
    </div>
  {:else}
    {#if error}<p class="estado mal" role="alert">{error}</p>{/if}
    <div class="botones">
      {#if onvolver}
        <button class="secundario" onclick={onvolver}>Elegir otro correo</button>
      {/if}
      <button class="principal" disabled={faltaMensaje} onclick={mandar}>
        Mandar a {nombre}
      </button>
    </div>
    {#if faltaMensaje}
      <p class="pista">Escribe el mensaje para poder mandarlo.</p>
    {/if}
  {/if}
</div>

<style>
  .envio {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .mensaje {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .mensaje span {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--gris);
  }
  textarea {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: var(--t-sm);
    line-height: 1.5;
    resize: vertical;
  }
  textarea:focus {
    border-color: var(--acento);
  }
  .mensaje small,
  .pista {
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.5;
  }
  .pista {
    text-align: right;
  }
  .estado {
    padding: 0.65rem 0.85rem;
    border-radius: var(--r-sm);
    font-size: var(--t-sm);
    line-height: 1.5;
    border: 1px solid var(--borde);
    background: var(--fondo);
    color: var(--pizarra);
  }
  .estado.bien {
    border-color: var(--exito);
    background: color-mix(in srgb, var(--exito) 8%, var(--blanco));
  }
  .estado.bien b {
    color: var(--exito-texto);
  }
  .estado.mal {
    border-color: var(--peligro);
    background: color-mix(in srgb, var(--peligro) 6%, var(--blanco));
  }
  .estado.mal b {
    color: var(--peligro);
  }
  .estado.espera {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 7%, var(--blanco));
  }
  .botones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
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
  .principal:disabled {
    background: var(--borde);
    color: var(--gris);
    cursor: not-allowed;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    min-height: var(--toque);
    font-weight: 600;
    color: var(--pizarra);
    background: var(--blanco);
  }
</style>
