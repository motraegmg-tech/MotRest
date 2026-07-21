<script lang="ts">
  import { diaYHora } from "./formato";
  import { MODULO_POR_CLAVE } from "./nav/modulos";
  import { rutas } from "./nav/rutas.svelte";
  import { pos } from "./pos.svelte";
  import { cabecera } from "./presentacion";
  import { sesion } from "./sesion/sesion.svelte";

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

  // Reloj del propio dispositivo (ADR-17): el software no tiene reloj propio.
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  let menuAbierto = $state(false);
  const usuario = $derived(sesion.usuarioActual);
</script>

<header class="hd">
  <h1>{moduloActual?.titulo ?? cabecera.titulo}</h1>
  <span class="chip">{cabecera.sucursal} ▾</span>
  {#if enVenta}
    <span class="chip acento">Mesa {pos.nombreMesaActiva}</span>
  {/if}
  <span class="chip gray">{diaYHora(ahora)}</span>
  <span class="chip gray">{cabecera.demo}</span>
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
