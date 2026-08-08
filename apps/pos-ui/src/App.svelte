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
  import Clientes from "./lib/modulos/Clientes.svelte";
  import Reservas from "./lib/modulos/clientes/Reservas.svelte";
  import Ficha360 from "./lib/modulos/clientes/Ficha360.svelte";
  import Cocina from "./lib/modulos/Cocina.svelte";
  import Compras from "./lib/modulos/Compras.svelte";
  import Finanzas from "./lib/modulos/Finanzas.svelte";
  import Canales from "./lib/modulos/finanzas/Canales.svelte";
  import Grupo from "./lib/modulos/finanzas/Grupo.svelte";
  import Inteligencia from "./lib/modulos/Inteligencia.svelte";
  import Comparativo from "./lib/modulos/inteligencia/Comparativo.svelte";
  import Inventario from "./lib/modulos/Inventario.svelte";
  import Personal from "./lib/modulos/Personal.svelte";
  import Venta from "./lib/modulos/Venta.svelte";
  import Bitacora from "./lib/modulos/admin/Bitacora.svelte";
  import Catalogo from "./lib/modulos/admin/Catalogo.svelte";
  import Hub from "./lib/modulos/admin/Hub.svelte";
  import Impresoras from "./lib/modulos/admin/Impresoras.svelte";
  import MensajesAlCliente from "./lib/modulos/admin/MensajesAlCliente.svelte";
  import Salones from "./lib/modulos/admin/Salones.svelte";
  import Usuarios from "./lib/modulos/admin/Usuarios.svelte";
  import Acceso from "./lib/sesion/Acceso.svelte";
  import AltaResponsable from "./lib/sesion/AltaResponsable.svelte";
  import CambioCredencial from "./lib/sesion/CambioCredencial.svelte";
  import DialogoAutorizacion from "./lib/sesion/DialogoAutorizacion.svelte";
  import AvisoActualizacion from "./lib/licencia/AvisoActualizacion.svelte";
  import PantallaBloqueada from "./lib/licencia/PantallaBloqueada.svelte";
  import { contextoSeguro, explicacionContextoInseguro } from "./lib/entorno";
  import { arranque } from "./lib/persistencia/arranque.svelte";
  import { autorizacion } from "./lib/sesion/autorizacion.svelte";
  import { sesion } from "./lib/sesion/sesion.svelte";
  import { sync } from "./lib/sync.svelte";
  import { actualizaciones } from "./lib/actualizaciones.svelte";
  import { caja } from "./lib/caja.svelte";
  import { failover } from "./lib/failover.svelte";
  import { licencia } from "./lib/licencia.svelte";
  import { modoAbierto } from "./lib/modo-abierto.svelte";
  import { CONTACTO_MOTRAE } from "./lib/presentacion";
  import { esSoporte } from "@motrest/dominio";

  let mostrarAcceso = $state(false);

  const pendiente = $derived(autorizacion.pendiente);
  const modulo = $derived(MODULO_POR_CLAVE.get(rutas.actual.modulo) ?? MODULOS[0]!);
  const seccion = $derived(rutas.actual.seccion);

  /** ¿El usuario puede ver el módulo al que apunta la ruta? */
  const permitido = $derived(sesion.puedeVer(modulo.permiso));

  /*
   * La única excepción al bloqueo: MOTRAE. Si al vencer la licencia nadie
   * pudiera entrar, tampoco podría entrar quien va a reactivarla ni quien va a
   * sacarle sus datos al restaurante para dárselos. Un bloqueo del que ni el
   * proveedor puede salir es un ladrillo, no una palanca de cobro.
   */
  const bloqueado = $derived(licencia.bloqueado && !esSoporte(sesion.usuarioActual));

  /*
   * El bloqueo no cae con un turno de caja abierto.
   *
   * Bloquear con doce mesas abiertas encierra ese dinero: el restaurante no
   * puede cobrarle ni a los que están sentados, y esa llamada de auxilio le
   * llega a MOTRAE, no al moroso. Se enlaza aquí, en el shell, para que los dos
   * stores sigan sin conocerse.
   */
  $effect(() => licencia.marcarTurno(caja.activa !== undefined));
</script>

{#if arranque.cargando}
  <div class="cargando">
    <div class="marca">MotRest<span>.</span></div>
    <p>Cargando la operación del local…</p>
  </div>
{:else if bloqueado}
  <!--
    Se acabaron los tres días de gracia. Va ANTES que todo lo demás —incluida la
    pantalla de acceso— porque no tiene sentido pedirle la contraseña a alguien
    que no va a poder hacer nada con ella.
  -->
  <PantallaBloqueada contacto={CONTACTO_MOTRAE} />
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
    {:else if modulo.clave === "clientes"}
      {#if seccion === "reservas"}
        <Reservas />
      {:else if seccion === "comensales"}
        <Ficha360 />
      {:else}
        <Clientes />
      {/if}
    {:else if modulo.clave === "personal"}
      <Personal />
    {:else if modulo.clave === "inteligencia"}
      {#if seccion === "comparativo"}
        <Comparativo />
      {:else}
        <Inteligencia />
      {/if}
    {:else if modulo.clave === "finanzas"}
      {#if seccion === "canales"}
        <Canales />
      {:else if seccion === "grupo"}
        <Grupo />
      {:else}
        <Finanzas />
      {/if}
    {:else if modulo.clave === "administracion"}
      {#if seccion === "bitacora"}
        <Bitacora />
      {:else if seccion === "salones"}
        <Salones />
      {:else if seccion === "catalogo"}
        <Catalogo />
      {:else if seccion === "impresoras"}
        <Impresoras />
      {:else if seccion === "mensajes"}
        <MensajesAlCliente />
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

<!--
  Primer arranque de un restaurante nuevo: crear la cuenta del responsable.

  Va ANTES que la pantalla de acceso porque no tiene sentido pedir un PIN cuando
  todavía no existe nadie que pueda tenerlo. Y no se muestra mientras la terminal
  espera la operación del Hub: si el local ya tiene personal, viene de ahí, y dar
  de alta un propietario aquí crearía un segundo dueño del negocio.
-->
{#if sesion.requiereAltaInicial && !arranque.esperandoHub}
  <AltaResponsable />
{:else if mostrarAcceso || !sesion.autenticado}
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

<!--
  La licencia.

  El bloqueo diferido va aparte y en rojo: es la última oportunidad que tiene el
  restaurante de enterarse antes de quedarse sin sistema, y llega justo cuando
  está a punto de cerrar la caja.
-->
<!--
  Este local acepta terminales sin autorizar.

  Va arriba, en rojo y sin forma de cerrarlo, porque es un estado que NADIE
  debería tener puesto en un restaurante real y que hasta ahora solo se avisaba
  en una consola que en la aplicación instalada no existe.
-->
{#if modoAbierto.activo}
  <div class="modo-abierto" role="alert">
    <b>Este local acepta terminales sin autorizar</b>
    Cualquier equipo con la clave del local puede registrar ventas. Es para
    pruebas: en operación real hay que quitar <code>MOTREST_HUB_ABIERTO</code>.
  </div>
{/if}

<!--
  La caja no responde.

  Va arriba y ocupa el ancho: es lo único que el mesero necesita saber en ese
  momento, y saberlo cambia lo que hace —seguir vendiendo tranquilo o ir a
  avisar al gerente—. Sin este aviso, el personal se entera cuando algo falla.
-->
{#if failover.aviso}
  <div class="failover" class:grave={failover.grave} role="alert">
    {failover.aviso}
  </div>
{/if}

{#if licencia.bloqueoDiferido}
  <div class="licencia grave" role="alert">
    <b>Su licencia venció</b>
    Al cerrar este turno el sistema quedará suspendido. Comuníquese con MOTRAE
    para reactivarlo — su información no se pierde.
  </div>
{:else if licencia.aviso}
  <div class="licencia" class:grave={licencia.estado === "gracia"} role="status">
    {licencia.aviso}
  </div>
{/if}

<!--
  La actualización. El diálogo solo aparece cuando toca; el punto de la barra
  lateral se queda puesto mientras haya algo pendiente (ver Sidebar).
-->
{#if actualizaciones.avisar && actualizaciones.version}
  <AvisoActualizacion
    version={actualizaciones.version.version}
    notas={actualizaciones.version.notas}
    obligatoria={actualizaciones.obligatoria}
    onDecidir={(eleccion) => actualizaciones.decidir(eleccion)}
  />
{/if}
{/if}



<!--
  Reloj desfasado.

  Va arriba de todo y en rojo porque no se manifiesta de ninguna otra forma: las
  ventas se registran bien, la pantalla se ve bien, y los números salen mal.
-->
{#if Math.abs(sync.desfaseReloj) > 0}
  <div class="reloj-mal" role="alert">
    <b>La hora de esta terminal está mal</b>
    Va {sync.desfaseReloj > 0 ? "adelantada" : "atrasada"} unos
    {Math.round(Math.abs(sync.desfaseReloj) / 60000)} min respecto a la caja. Las
    ventas que registre aquí pueden caer en otro día y quedar fuera del corte.
    Ajusta la fecha y hora del dispositivo.
  </div>
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
  /*
   * Abajo a la izquierda, no arriba en medio: arriba ya viven el aviso del reloj
   * y el de contexto inseguro, y tres avisos apilados en el mismo sitio se tapan
   * entre ellos justo el día que importan.
   */
  .licencia {
    position: fixed;
    z-index: 46;
    bottom: 1.5rem;
    left: 1.5rem;
    max-width: min(22rem, calc(100vw - 3rem));
    background: var(--claro);
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.65rem 0.9rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--pizarra);
    box-shadow: var(--sombra-sm);
  }
  .licencia.grave {
    background: #fdeae8;
    border-color: var(--peligro);
  }
  .licencia b {
    display: block;
    color: var(--peligro);
    margin-bottom: 0.15rem;
  }
  /*
   * Ancho completo y arriba del todo: a diferencia del aviso de licencia --que
   * es del dueño-- este lo tiene que leer el mesero que está de pie con una
   * tablet, y de reojo.
   */
  /*
   * Rojo, arriba del todo y sin forma de cerrarlo. Es un estado que nadie
   * debería tener puesto en un restaurante real, y hasta ahora solo se avisaba
   * en una consola que en la aplicación instalada no existe.
   */
  .modo-abierto {
    position: fixed;
    z-index: 68;
    top: 0;
    left: 0;
    right: 0;
    background: var(--peligro);
    color: #fff;
    padding: 0.6rem 1.25rem;
    font-size: 0.83rem;
    line-height: 1.45;
    text-align: center;
    box-shadow: var(--sombra-sm);
  }
  .modo-abierto b {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.1rem;
  }
  .modo-abierto code {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    padding: 0 0.25rem;
  }
  .failover {
    position: fixed;
    z-index: 47;
    top: 0;
    left: 0;
    right: 0;
    background: var(--acento-2);
    color: var(--negro);
    padding: 0.55rem 1.25rem;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
    box-shadow: var(--sombra-sm);
  }
  .failover.grave {
    background: var(--peligro);
    color: #fff;
  }
  .reloj-mal {
    position: fixed;
    z-index: 70;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(38rem, calc(100vw - 2rem));
    background: #fdeae8;
    border: 1.5px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.83rem;
    line-height: 1.5;
    color: var(--pizarra);
    box-shadow: var(--sombra-sm);
  }
  .reloj-mal b {
    display: block;
    color: var(--peligro);
    margin-bottom: 0.15rem;
  }
</style>
