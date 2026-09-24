<script lang="ts">
  import CambioCredencial from "./sesion/CambioCredencial.svelte";
  import Icono from "./Icono.svelte";
  import { MODULO_POR_CLAVE } from "./nav/modulos";
  import { orientacion } from "./nav/orientacion.svelte";
  import { rutas } from "./nav/rutas.svelte";
  import { nombreDelLocal as leerNombreDelLocal } from "./nombre-del-local";
  import { pos } from "./pos.svelte";
  import { cabecera } from "./presentacion";
  import { sesion } from "./sesion/sesion.svelte";
  import { sync } from "./sync.svelte";
  import { accesoWeb } from "./web/acceso-web.svelte";
  import { arranque } from "./persistencia/arranque.svelte";

  interface Props {
    onAbrirAcceso: () => void;
  }
  let { onAbrirAcceso }: Props = $props();

  const moduloActual = $derived(MODULO_POR_CLAVE.get(rutas.actual.modulo));
  const enVenta = $derived(rutas.actual.modulo === "venta");

  function irA(modulo: string, seccion: string) {
    menuAbierto = false;
    rutas.ir(modulo, seccion);
  }

  let menuAbierto = $state(false);
  let cambiandoClave = $state(false);

  /*
   * SALIR DEL RESTAURANTE, solo en la web (1.6.0).
   *
   * No es «cerrar sesión»: borra de este dispositivo todo lo del restaurante,
   * porque una tableta o una computadora prestada no puede quedarse con sus
   * ventas. Por eso pide confirmación, y avisa si hay algo que todavía no llegó
   * a la nube o al Hub: eso se perdería.
   */
  let confirmandoSalida = $state(false);
  let sinEnviar = $state(0);

  async function pedirSalida() {
    sinEnviar = (await arranque.repositorio?.eventos.pendientes(1000))?.length ?? 0;
    confirmandoSalida = true;
  }
  const usuario = $derived(sesion.usuarioActual);
  const esPin = $derived(usuario ? sesion.tipoCredencialDe(usuario.id) === "pin" : false);
  /* Sin licencia todavía no hay restaurante, y el chip no se enseña. */
  const nombreDelLocal = $derived(leerNombreDelLocal());

  /*
   * EL SEMÁFORO DEL TELÉFONO (pedido de Gonzalo, 24-sep-2026).
   *
   * Rojo es «este aparato no tiene red en absoluto», que el navegador sabe sin
   * preguntarle a nadie. NO es «sin internet» a secas: una caja sin internet
   * pero con el Hub en la red del local está sincronizada de verdad, y ahí el
   * punto tiene que salir verde. Amarillo es trabajar sin el Hub a la vista
   * (isla) o estar buscándolo; verde, enlazado.
   */
  let enLinea = $state(typeof navigator === "undefined" ? true : navigator.onLine);
  const colorEnlace = $derived(
    !enLinea
      ? "rojo"
      : sync.estado === "sincronizado" || sync.estado === "sincronizando"
        ? "verde"
        : "amarillo",
  );
  const textoEnlace = $derived(enLinea ? sync.etiqueta : "Sin conexión");
  let detalleEnlace = $state(false);

  function cerrarSesion() {
    menuAbierto = false;
    sesion.cerrarSesion();
    onAbrirAcceso();
  }
</script>

<svelte:window ononline={() => (enLinea = true)} onoffline={() => (enLinea = false)} />

<!--
  EN TELÉFONO, LA BARRA ES DE ICONOS (pedido de Gonzalo, 24-sep-2026).

  Con los rótulos completos solo cabían el módulo y el local, y el usuario y
  «Cerrar sesión» quedaban fuera de la pantalla. En teléfono van el icono del
  módulo, el semáforo del enlace y el gafete del usuario. El nombre del local
  se muda al menú de las tres rayas, y «Cerrar sesión» al menú del gafete.
-->
<header class="hd" class:telefono={orientacion.telefono}>
  {#if orientacion.telefono && moduloActual}
    <h1 class="modulo-icono" title={moduloActual.titulo}>
      <Icono nombre={moduloActual.icono} tam={28} />
      <span class="solo-lector">{moduloActual.titulo}</span>
    </h1>
  {:else}
    <h1>{moduloActual?.titulo ?? cabecera.titulo}</h1>
  {/if}
  {#if nombreDelLocal && !orientacion.telefono}
    <span class="chip">{nombreDelLocal}</span>
  {/if}
  <!-- En teléfono, la barra de pasos de Venta ya dice qué mesa se atiende. -->
  {#if enVenta && !orientacion.telefono}
    <span class="chip acento">Mesa {pos.nombreMesaActiva}</span>
  {/if}
  <!--
    El enlace solo se anuncia si hay un Hub configurado. Un local de una sola
    terminal no tiene por qué ver un aviso permanente de algo que no usa.
  -->
  {#if sync.configurado}
    {#if orientacion.telefono}
      <!-- Sin rótulo, el texto queda a un toque: el color dice el qué; esto, el porqué. -->
      <div class="enlace-tel">
        <button
          class="circulo {colorEnlace}"
          aria-label="Conexión: {textoEnlace}"
          aria-expanded={detalleEnlace}
          onclick={() => (detalleEnlace = !detalleEnlace)}
        >
          <span class="punto"></span>
        </button>
        {#if detalleEnlace}
          <div class="velo" role="presentation" onclick={() => (detalleEnlace = false)}></div>
          <div class="globo" role="status">
            <b>{textoEnlace}</b>
            {#if !enLinea}
              <span>Este teléfono no tiene red. Lo que hagas se guarda en él y se envía al volver la conexión.</span>
            {:else if sync.detalle}
              <span>{sync.detalle}</span>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <span class="chip enlace {sync.estado}" title={sync.detalle}>
        <span class="punto"></span>{sync.etiqueta}
      </span>
    {/if}
  {/if}
  <span class="sp"></span>

  <div class="usuario">
    <button
      class="avatar"
      onclick={() => (menuAbierto = !menuAbierto)}
      aria-expanded={menuAbierto}
      aria-label={orientacion.telefono ? `Usuario: ${usuario?.nombre ?? "sin sesión"}` : undefined}
    >
      {#if orientacion.telefono}
        <Icono nombre="personal" tam={28} />
      {:else}
        <span class="av">{usuario?.iniciales ?? "?"}</span>
        <span class="quien">
          <b>{usuario?.nombre ?? "Sin sesión"}</b>
          <small>{usuario?.puesto ?? ""}</small>
        </span>
        <span class="flecha">▾</span>
      {/if}
    </button>

    {#if menuAbierto}
      <div class="velo" role="presentation" onclick={() => (menuAbierto = false)}></div>
      <div class="menu">
        {#if orientacion.telefono}
          <div class="yo">
            <b>{usuario?.nombre ?? "Sin sesión"}</b>
            {#if usuario?.puesto}<small>{usuario.puesto}</small>{/if}
          </div>
        {/if}
        <button onclick={() => { menuAbierto = false; cambiandoClave = true; }}>
          Cambiar mi {esPin ? "PIN" : "contraseña"}
          <!--
            Ya no se fuerza al entrar (ver App.svelte): se señala aquí, que es
            donde se busca, y quien tenga todavía la clave que le dieron lo ve
            marcado sin que le tape la pantalla cada mañana.
          -->
          {#if sesion.debeCambiarCredencial}<span class="pendiente">pendiente</span>{/if}
        </button>
        <!--
          Aquí iba «Cambiar de usuario». Se quitó (Gonzalo, 24-sep-2026): era
          cerrar sesión y entrar con otro, o sea el mismo botón con otro nombre.
        -->
        {#if sesion.puedeVer("admin.usuario.editar")}
          <button onclick={() => irA("administracion", "usuarios")}>Usuarios y permisos</button>
        {/if}
        {#if sesion.puedeVer("admin.bitacora.ver")}
          <button onclick={() => irA("administracion", "bitacora")}>Bitácora</button>
        {/if}
        {#if accesoWeb.restaurante}
          {#if !confirmandoSalida}
            <button onclick={pedirSalida}>Salir de {accesoWeb.restaurante.nombre}</button>
          {:else}
            <div class="salida">
              <p>
                Se borrará de este dispositivo todo lo de {accesoWeb.restaurante.nombre}.
                {#if sinEnviar > 0}
                  <b>Hay {sinEnviar} {sinEnviar === 1 ? "movimiento" : "movimientos"} sin enviar que se perderían.</b>
                {/if}
              </p>
              <span class="botones-salida">
                <button onclick={() => (confirmandoSalida = false)}>Cancelar</button>
                <button class="peligro" onclick={() => void accesoWeb.salir()}>Sí, salir</button>
              </span>
            </div>
          {/if}
        {/if}
        {#if orientacion.telefono}
          <button class="cerrar" onclick={cerrarSesion}>Cerrar sesión</button>
        {/if}
      </div>
    {/if}
  </div>

  <!--
    CERRAR SESIÓN, SIEMPRE A LA VISTA.

    En un turno la caja cambia de manos cada pocos minutos: termina un mesero,
    entra el siguiente y comanda. Escondido dentro del menú del avatar, lo que
    pasaba de verdad es que nadie lo pulsaba y todo el turno se registraba a
    nombre de quien abrió por la mañana — con lo que la bitácora, las propinas
    por mesero y el rol de mesas dejaban de significar nada.

    No se pierde nada al salir: cada comanda, cada pago y cada checada ya están
    guardados en el log del dispositivo en el momento en que ocurrieron. Las
    mesas abiertas siguen abiertas para el que entre después.

    En teléfono no hay sitio en la barra y va al final del menú del gafete.
  -->
  {#if !orientacion.telefono}
    <button class="salir" onclick={cerrarSesion}>Cerrar sesión</button>
  {/if}
</header>

{#if cambiandoClave}
  <CambioCredencial onCerrar={() => (cambiandoClave = false)} />
{/if}

<style>
  .salida {
    padding: 0.6rem 0.8rem;
    max-width: 16rem;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--pizarra);
  }
  .salida b {
    display: block;
    margin-top: 0.3rem;
    color: var(--peligro);
  }
  .botones-salida {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .botones-salida .peligro {
    color: var(--peligro);
    font-weight: 600;
  }
  .hd {
    height: 4rem;
    background: #fff;
    border-bottom: 1px solid var(--borde);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1.5rem;
    flex: none;
  }
  h1 {
    font-size: 1.4rem;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.4rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip.gray {
    background: #eef1ed;
    color: var(--gris);
  }
  .chip.acento {
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .chip.enlace {
    background: #eef1ed;
    color: var(--gris);
    gap: 0.4rem;
  }
  .chip.enlace .punto {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--gris);
  }
  .chip.enlace.sincronizado {
    color: #3f5c31;
  }
  .chip.enlace.sincronizado .punto {
    background: #6b8f57;
  }
  .chip.enlace.conectando .punto,
  .chip.enlace.sincronizando .punto {
    background: var(--acento-2);
  }
  /* Isla no es un error: es el modo de trabajo cuando no hay Hub a la vista. */
  .chip.enlace.isla {
    color: var(--acento-2);
  }
  .chip.enlace.isla .punto {
    background: var(--acento-2);
  }
  .sp {
    flex: 1;
  }
  .usuario {
    position: relative;
  }
  .avatar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--r-md);
    white-space: nowrap;
  }
  .avatar:hover {
    background: var(--fondo);
  }
  .av {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--acento);
    color: var(--sobre-acento);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex: none;
  }
  .quien {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.15;
  }
  .quien b {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .quien small {
    font-size: 0.72rem;
    color: var(--gris);
  }
  .flecha {
    color: var(--gris);
    font-size: 0.7rem;
  }
  .velo {
    position: fixed;
    inset: 0;
    z-index: 19;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 20;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-lg);
    min-width: 12rem;
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
  }
  .menu button {
    text-align: left;
    padding: 0.6rem 0.7rem;
    border-radius: var(--r-sm);
    font-size: 0.88rem;
    font-weight: 500;
    color: var(--pizarra);
  }
  .menu button:hover {
    background: var(--fondo);
  }
  .pendiente {
    margin-left: 0.4rem;
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-pill);
    padding: 0.05rem 0.4rem;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  /*
   * Visible pero no llamativo: se usa muchas veces por turno, así que tiene que
   * estar donde la mano ya sabe, sin competir con el módulo que se está usando.
   */
  .salir {
    flex: none;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.45rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
    white-space: nowrap;
  }
  .salir:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }

  /* --- Teléfono ----------------------------------------------------------- */

  .hd.telefono {
    gap: 0.5rem;
    padding-right: 0.75rem;
  }
  .modulo-icono {
    display: flex;
    align-items: center;
  }
  .solo-lector {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .enlace-tel {
    position: relative;
  }
  /* El mismo gris del óvalo de computadora, hecho círculo. */
  .circulo {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: #eef1ed;
    display: grid;
    place-items: center;
  }
  .circulo .punto {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
  }
  /* Colores intensos a propósito: se leen de reojo, a un brazo de distancia. */
  .circulo.verde .punto {
    background: #1ec41e;
    box-shadow: 0 0 0 3px rgba(30, 196, 30, 0.28);
  }
  .circulo.amarillo .punto {
    background: #ffc400;
    box-shadow: 0 0 0 3px rgba(255, 196, 0, 0.32);
  }
  .circulo.rojo .punto {
    background: #ff1f1f;
    box-shadow: 0 0 0 3px rgba(255, 31, 31, 0.28);
  }
  .globo {
    position: absolute;
    left: 0;
    top: calc(100% + 0.4rem);
    z-index: 20;
    width: max-content;
    max-width: min(16rem, calc(100vw - 5rem));
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    box-shadow: var(--sombra-lg);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--gris);
  }
  .globo b {
    font-size: 0.88rem;
    color: var(--pizarra);
  }
  .hd.telefono .avatar {
    padding: 0.35rem;
  }
  .yo {
    display: flex;
    flex-direction: column;
    padding: 0.55rem 0.7rem 0.6rem;
    margin-bottom: 0.2rem;
    border-bottom: 1px solid var(--borde);
    line-height: 1.25;
  }
  .yo b {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .yo small {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .menu .cerrar {
    margin-top: 0.2rem;
    border-top: 1px solid var(--borde);
    border-radius: 0 0 var(--r-sm) var(--r-sm);
    color: var(--peligro);
    font-weight: 600;
  }
</style>
