<script lang="ts">
  /**
   * Navegación de los 9 módulos. Se construye desde el registro MODULOS y se
   * filtra por los permisos del usuario en sesión: quien no puede ver un módulo
   * no lo ve en el menú.
   */
  import { esSoporte, modalidadDe, puedeGuardarSecretos } from "@motrest/dominio";
  import { licencia } from "../licencia.svelte";
  import { MODULOS } from "./modulos";
  import PropinasAcumuladas from "./PropinasAcumuladas.svelte";
  import { rutas } from "./rutas.svelte";
  import { actualizaciones } from "../actualizaciones.svelte";
  import Icono from "../Icono.svelte";
  import { sesion } from "../sesion/sesion.svelte";
  import { revelar } from "../subir";
  import { VERSION_MOTREST } from "../version";

  const visibles = $derived(MODULOS.filter((m) => sesion.puedeVer(m.permiso)));

  /* Pedido de Gonzalo: solo quien decide sobre el sistema del local. */
  const puedeBuscarActualizacion = $derived(
    ["propietario", "gerente", "soporte"].includes(sesion.usuarioActual?.rol_id ?? ""),
  );
  let buscando = $state(false);
  let resultadoBusqueda = $state<{ hay: boolean; texto: string } | null>(null);
  let limpiarResultado: ReturnType<typeof setTimeout> | undefined;

  async function buscarActualizacion() {
    buscando = true;
    resultadoBusqueda = null;
    clearTimeout(limpiarResultado);
    resultadoBusqueda = await actualizaciones.buscar();
    buscando = false;
    limpiarResultado = setTimeout(() => (resultadoBusqueda = null), 8000);
  }

  function abrir(clave: string) {
    const modulo = MODULOS.find((m) => m.clave === clave);
    rutas.ir(clave, modulo?.secciones[0]?.clave);
  }
</script>

<aside class="sb">
  <div class="logo">MotRest<span>.</span></div>

  <nav>
    {#each visibles as modulo (modulo.id)}
      {@const activo = rutas.enModulo(modulo.clave)}
      <!--
        EL ICONO VA A COLOR SALVO EN EL MÓDULO ABIERTO.

        El módulo activo se pinta sobre el naranja de marca, y ahí un relleno de
        color propio pelearía con el fondo. Abierto, el icono pasa a heredar el
        mismo tono oscuro del rótulo, y lo que distingue al módulo deja de ser
        el color del dibujo: ya lo dice el panel entero.
      -->
      <button class="item" class:on={activo} onclick={() => abrir(modulo.clave)}>
        <Icono nombre={modulo.icono} tam={20} color={!activo} />
        <span class="txt">{modulo.titulo}</span>
        {#if !modulo.operativo}
          <span class="fase">{modulo.fase}</span>
        {/if}
      </button>

      {#if activo && modulo.secciones.length > 1}
        <div class="secciones">
          {#each modulo.secciones.filter((s) => sesion.puedeVer(s.permiso) && (!s.soloMotrae || esSoporte(sesion.usuarioActual)) && (!s.soloConAccesoWeb || (modalidadDe(licencia.licencia) !== "app" && puedeGuardarSecretos(sesion.usuarioActual)))) as seccion (seccion.clave)}
            <button
              class="seccion"
              class:on={rutas.actual.seccion === seccion.clave}
              onclick={() => rutas.ir(modulo.clave, seccion.clave)}
            >
              <Icono nombre={seccion.icono} tam={15} />
              <span>{seccion.titulo}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  </nav>

  <!--
    Se pinta solo para quien tiene el permiso, y el propio componente decide si
    muestra las propinas del local o solo las de quien está en sesión.
  -->
  <PropinasAcumuladas />

  <!--
    EL AVISO QUE SE QUEDA PUESTO (pedido de Gonzalo).

    Cuando el restaurante pospone una actualización, el diálogo se cierra pero
    esto no. Un aviso que desaparece al posponerlo es un aviso que nadie vuelve a
    ver, y una versión que nunca se instala.
  -->
  {#if actualizaciones.pendiente}
    <button class="actualizacion" onclick={() => actualizaciones.reabrir()}>
      <i></i>
      <span>{actualizaciones.resumen}</span>
    </button>
  {/if}

  <!--
    LA VERSIÓN VA AQUÍ, JUNTO A LA FIRMA (pedido de Gonzalo).

    Es el dato que se pide en la primera frase de cada llamada a soporte y el
    que decide si un defecto ya está arreglado en el local que llama. Estaba
    solo en Administración → Hub, que es una pantalla que un mesero no abre y
    una tablet del salón ni siquiera puede consultar.

    Sale del empaquetado, no de una consulta al Hub: ver `version.ts`.
  -->
  <div class="foot">
    MOTRAE{#if VERSION_MOTREST}&nbsp;{VERSION_MOTREST}{/if} · Innovation already in motion
    {#if puedeBuscarActualizacion}
      <button
        class="buscar"
        onclick={buscarActualizacion}
        disabled={buscando}
        title="Pregunta ahora mismo a la nube de MOTRAE si hay una versión nueva de MotRest, sin esperar a que el sistema lo revise solo."
      >
        {buscando ? "Buscando…" : "Buscar actualizaciones"}
      </button>
      {#if resultadoBusqueda}
        <p class="resultado" class:hay={resultadoBusqueda.hay} role="status" use:revelar={resultadoBusqueda.texto}>{resultadoBusqueda.texto}</p>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .sb {
    width: 15rem;
    flex: none;
    background: var(--negro);
    color: #fff;
    display: flex;
    flex-direction: column;
    padding: 1.5rem 1rem;
    overflow-y: auto;
    /*
     * `overflow-y: auto` enciende también el horizontal. Con la barra de un
     * navegador de Windows restando ~15 px, «Administración» ya no cabía y
     * salía una barra horizontal debajo del menú (web, 24-sep-2026).
     */
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }
  .logo {
    font-family: var(--font-titulo);
    font-size: 1.75rem;
    font-weight: 700;
    padding: 0 0.75rem 1.5rem;
  }
  .logo span {
    color: var(--acento);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-md);
    color: #b9c2bc;
    font-size: 1rem;
    font-weight: 500;
    text-align: left;
    width: 100%;
  }
  .item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
  .item.on {
    background: var(--acento);
    color: var(--sobre-acento);
    font-weight: 600;
  }
  .txt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fase {
    font-family: var(--font-titulo);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.35rem;
    border-radius: var(--r-pill);
    border: 1px solid currentColor;
    opacity: 0.75;
  }
  .secciones {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin: 0.15rem 0 0.35rem 1.6rem;
  }
  .seccion {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-radius: var(--r-sm);
    font-size: 0.85rem;
    color: #8a969c;
  }
  .seccion:hover {
    color: #fff;
  }
  .seccion.on {
    color: var(--acento);
    font-weight: 600;
  }
  /*
   * El punto naranja pulsa despacio. Es el único elemento animado del menú a
   * propósito: en una pantalla que un mesero mira de reojo cien veces por turno,
   * lo que no se mueve deja de verse a los dos días.
   */
  .actualizacion {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    margin-bottom: 0.6rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid rgba(242, 133, 58, 0.35);
    border-radius: var(--r-sm);
    background: rgba(242, 133, 58, 0.1);
    color: #e6ece8;
    font: inherit;
    font-size: 0.72rem;
    line-height: 1.35;
    text-align: left;
    cursor: pointer;
  }
  .actualizacion:hover {
    border-color: var(--acento);
  }
  .actualizacion i {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--acento);
    animation: latido 2.4s ease-in-out infinite;
  }
  @keyframes latido {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  /* Quien pidió menos movimiento no debe pelearse con un punto que parpadea. */
  @media (prefers-reduced-motion: reduce) {
    .actualizacion i {
      animation: none;
    }
  }
  /*
   * `--gris-claro` y no `--gris`: este pie está sobre el carril negro, y el
   * gris de la aplicación se oscureció para poder leerse sobre las tarjetas
   * blancas. Aquí ese mismo gris quedaría en 3.6:1 contra el fondo.
   */
  .foot {
    margin-top: auto;
    padding: 1.5rem 0.85rem 0;
    font-size: var(--t-xs);
    color: var(--gris-claro);
  }
  .buscar {
    display: block;
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--r-sm);
    background: transparent;
    color: #e6ece8;
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .buscar:hover:not(:disabled) {
    border-color: var(--acento);
    color: #fff;
  }
  .buscar:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .resultado {
    margin: 0.5rem 0 0;
    font-size: 0.72rem;
    line-height: 1.35;
    color: #e6ece8;
  }
  .resultado.hay {
    color: var(--acento);
    font-weight: 600;
  }
</style>
