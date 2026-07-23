<script lang="ts">
  import CambioCredencial from "./sesion/CambioCredencial.svelte";
  import { MODULO_POR_CLAVE } from "./nav/modulos";
  import { rutas } from "./nav/rutas.svelte";
  import { pos } from "./pos.svelte";
  import { cabecera } from "./presentacion";
  import { sesion } from "./sesion/sesion.svelte";
  import { sync } from "./sync.svelte";

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
  const usuario = $derived(sesion.usuarioActual);
  const esPin = $derived(usuario ? sesion.tipoCredencialDe(usuario.id) === "pin" : false);
</script>

<header class="hd">
  <h1>{moduloActual?.titulo ?? cabecera.titulo}</h1>
  <span class="chip">{cabecera.sucursal} ▾</span>
  {#if enVenta}
    <span class="chip acento">Mesa {pos.nombreMesaActiva}</span>
  {/if}
  <!--
    El enlace solo se anuncia si hay un Hub configurado. Un local de una sola
    terminal no tiene por qué ver un aviso permanente de algo que no usa.
  -->
  {#if sync.configurado}
    <span class="chip enlace {sync.estado}" title={sync.detalle}>
      <span class="punto"></span>{sync.etiqueta}
    </span>
  {/if}
  <span class="sp"></span>

  <div class="usuario">
    <button class="avatar" onclick={() => (menuAbierto = !menuAbierto)} aria-expanded={menuAbierto}>
      <span class="av">{usuario?.iniciales ?? "?"}</span>
      <span class="quien">
        <b>{usuario?.nombre ?? "Sin sesión"}</b>
        <small>{usuario?.puesto ?? ""}</small>
      </span>
      <span class="flecha">▾</span>
    </button>

    {#if menuAbierto}
      <div class="velo" role="presentation" onclick={() => (menuAbierto = false)}></div>
      <div class="menu">
        <button onclick={() => { menuAbierto = false; cambiandoClave = true; }}>
          Cambiar mi {esPin ? "PIN" : "contraseña"}
        </button>
        <button onclick={() => { menuAbierto = false; onAbrirAcceso(); }}>
          Cambiar de usuario
        </button>
        {#if sesion.puedeVer("admin.usuario.editar")}
          <button onclick={() => irA("administracion", "usuarios")}>Usuarios y permisos</button>
        {/if}
        {#if sesion.puedeVer("admin.bitacora.ver")}
          <button onclick={() => irA("administracion", "bitacora")}>Bitácora</button>
        {/if}
        <button
          class="salir"
          onclick={() => { menuAbierto = false; sesion.cerrarSesion(); onAbrirAcceso(); }}
        >
          Cerrar sesión
        </button>
      </div>
    {/if}
  </div>
</header>

{#if cambiandoClave}
  <CambioCredencial onCerrar={() => (cambiandoClave = false)} />
{/if}

<style>
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
    color: #fff;
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
    color: #fff;
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
  .menu .salir {
    color: var(--peligro);
    border-top: 1px solid var(--borde);
    margin-top: 0.2rem;
    padding-top: 0.6rem;
  }
</style>
