<script lang="ts">
  /**
   * Shell de la aplicación: sidebar de módulos + cabecera + módulo activo.
   * El módulo que se muestra sale del router por hash (nav/rutas).
   */
  import Header from "./lib/Header.svelte";
  import ModuloEnRoadmap from "./lib/nav/ModuloEnRoadmap.svelte";
  import Sidebar from "./lib/nav/Sidebar.svelte";
  import { MODULO_POR_CLAVE, MODULOS } from "./lib/nav/modulos";
  import { rutas } from "./lib/nav/rutas.svelte";
  import Cocina from "./lib/modulos/Cocina.svelte";
  import Compras from "./lib/modulos/Compras.svelte";
  import Finanzas from "./lib/modulos/Finanzas.svelte";
  import Inteligencia from "./lib/modulos/Inteligencia.svelte";
  import Inventario from "./lib/modulos/Inventario.svelte";
  import Personal from "./lib/modulos/Personal.svelte";
  import Venta from "./lib/modulos/Venta.svelte";
  import Bitacora from "./lib/modulos/admin/Bitacora.svelte";
  import Catalogo from "./lib/modulos/admin/Catalogo.svelte";
  import Hub from "./lib/modulos/admin/Hub.svelte";
  import Impresoras from "./lib/modulos/admin/Impresoras.svelte";
  import Salones from "./lib/modulos/admin/Salones.svelte";
  import Usuarios from "./lib/modulos/admin/Usuarios.svelte";
  import Acceso from "./lib/sesion/Acceso.svelte";
  import CambioCredencial from "./lib/sesion/CambioCredencial.svelte";
  import DialogoAutorizacion from "./lib/sesion/DialogoAutorizacion.svelte";
  import { contextoSeguro, explicacionContextoInseguro } from "./lib/entorno";
  import { arranque } from "./lib/persistencia/arranque.svelte";
  import { autorizacion } from "./lib/sesion/autorizacion.svelte";
  import { sesion } from "./lib/sesion/sesion.svelte";
  import { sync } from "./lib/sync.svelte";

  let mostrarAcceso = $state(false);

  const pendiente = $derived(autorizacion.pendiente);
  const modulo = $derived(MODULO_POR_CLAVE.get(rutas.actual.modulo) ?? MODULOS[0]!);
  const seccion = $derived(rutas.actual.seccion);

  /** ¿El usuario puede ver el módulo al que apunta la ruta? */
  const permitido = $derived(sesion.puedeVer(modulo.permiso));
</script>

{#if arranque.cargando}
  <div class="cargando">
    <div class="marca">MotRest<span>.</span></div>
    <p>Cargando la operación del local…</p>
  </div>
{:else}
<div class="app">
  <Sidebar />
  <div class="main">
    <Header onAbrirAcceso={() => (mostrarAcceso = true)} />

    {#if !permitido}
      <div class="sin-acceso">
        <h1>Sin acceso</h1>
        <p>Tu rol no tiene permiso para ver el módulo {modulo.titulo}.</p>
      </div>
    {:else if modulo.clave === "venta"}
      <Venta />
    {:else if modulo.clave === "cocina"}
      <Cocina />
    {:else if modulo.clave === "inventario"}
      <Inventario />
    {:else if modulo.clave === "compras"}
      <Compras />
    {:else if modulo.clave === "personal"}
      <Personal />
    {:else if modulo.clave === "inteligencia"}
      <Inteligencia />
    {:else if modulo.clave === "finanzas"}
      <Finanzas />
    {:else if modulo.clave === "administracion"}
      {#if seccion === "bitacora"}
        <Bitacora />
      {:else if seccion === "salones"}
        <Salones />
      {:else if seccion === "catalogo"}
        <Catalogo />
      {:else if seccion === "impresoras"}
        <Impresoras />
      {:else if seccion === "hub"}
        <Hub />
      {:else}
        <Usuarios />
      {/if}
    {:else}
      <ModuloEnRoadmap {modulo} />
    {/if}
  </div>
</div>

<!--
  Sin motor criptográfico no se puede entrar ni cifrar nada. Se avisa ANTES de
  que alguien teclee su contraseña y se quede sin saber por qué no funciona.
-->
{#if !contextoSeguro()}
  <div class="inseguro" role="alert">
    <b>Esta terminal no puede verificar credenciales</b>
    {explicacionContextoInseguro()}
  </div>
{/if}

{#if arranque.efimero}
  <div class="efimero" role="status">
    Sin almacenamiento en este navegador: los datos se perderán al cerrar.
  </div>
{/if}

<!--
  Terminal recién emparejada: no siembra una demostración propia, espera a que
  el Hub le mande la operación del local. Si el Hub no responde, hay que decirlo
  en vez de dejar una pantalla vacía sin explicación.
-->
{#if arranque.esperandoHub}
  <div class="esperando" role="status">
    {#if sync.estado === "sincronizado"}
      Terminal enlazada. Este local todavía no tiene operación registrada.
    {:else if sync.estado === "isla"}
      Sin contacto con el Hub del local. Revisa que esté encendido: en cuanto
      responda, esta terminal recibirá la operación en curso.
    {:else}
      Recibiendo la operación del local…
    {/if}
  </div>
{/if}

{#if mostrarAcceso || !sesion.autenticado}
  <Acceso onCerrar={() => (mostrarAcceso = false)} />
{:else if sesion.debeCambiarCredencial}
  <CambioCredencial />
{/if}

{#if pendiente}
  <DialogoAutorizacion
    accion={pendiente.accion}
    razon={pendiente.razon}
    rolesAutorizantes={pendiente.roles}
    contexto={pendiente.contexto}
    onAutorizado={(id) => autorizacion.completar(id)}
    onCancelar={() => autorizacion.cancelar()}
  />
{/if}

{#if autorizacion.aviso}
  <div class="aviso" role="status">{autorizacion.aviso}</div>
{/if}
{/if}

<style>
  .cargando {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: var(--negro);
    color: #b9c2bc;
  }
  .cargando .marca {
    font-family: var(--font-titulo);
    font-size: 2.2rem;
    font-weight: 700;
    color: #fff;
  }
  .cargando .marca span {
    color: var(--acento);
  }
  .cargando p {
    font-size: 0.9rem;
  }
  .efimero,
  .esperando {
    position: fixed;
    z-index: 44;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--acento-2);
    color: var(--negro);
    border-radius: var(--r-pill);
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    box-shadow: var(--sombra-sm);
  }
  .esperando {
    top: 3rem;
    max-width: min(34rem, calc(100vw - 2rem));
    border-radius: var(--r-md);
    text-align: center;
    line-height: 1.4;
  }
  /*
   * Este aviso va por ENCIMA del diálogo de acceso (z-index 60): si quedara
   * detrás, quien no puede entrar tampoco podría leer por qué.
   */
  .inseguro {
    position: fixed;
    z-index: 60;
    top: 0;
    left: 0;
    right: 0;
    background: var(--peligro);
    color: #fff;
    padding: 0.7rem 1.25rem;
    font-size: 0.85rem;
    line-height: 1.45;
    text-align: center;
    box-shadow: var(--sombra-sm);
  }
  .inseguro b {
    display: block;
    font-size: 0.92rem;
    margin-bottom: 0.15rem;
  }
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .sin-acceso {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--gris);
  }
  .sin-acceso h1 {
    font-size: 1.5rem;
    color: var(--pizarra);
  }
  .aviso {
    position: fixed;
    z-index: 45;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.8rem 1.4rem;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow: var(--sombra-lg);
    max-width: min(28rem, calc(100vw - 2rem));
    text-align: center;
  }

  /*
   * En pantallas angostas el sidebar se estrecha pero SIGUE mostrando el
   * nombre de cada módulo junto a su color: un menú de puros cuadritos no se
   * lee de un vistazo, que es justo lo que un POS necesita.
   */
  @media (max-width: 1279px) {
    .app :global(.sb) {
      width: 11rem;
      padding: 1rem 0.6rem;
    }
    .app :global(.sb .logo) {
      font-size: 1.4rem;
      padding-bottom: 1rem;
    }
    .app :global(.sb .item) {
      font-size: 0.88rem;
      padding: 0.55rem 0.6rem;
    }
    .app :global(.sb .foot) {
      display: none;
    }
  }
</style>
