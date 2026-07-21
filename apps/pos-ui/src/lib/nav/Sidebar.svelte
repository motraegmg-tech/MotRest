<script lang="ts">
  /**
   * Navegación de los 9 módulos. Se construye desde el registro MODULOS y se
   * filtra por los permisos del usuario en sesión: quien no puede ver un módulo
   * no lo ve en el menú.
   */
  import { COLOR_FASE, MODULOS } from "./modulos";
  import { rutas } from "./rutas.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  const visibles = $derived(MODULOS.filter((m) => sesion.puedeVer(m.permiso)));

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
      <button class="item" class:on={activo} onclick={() => abrir(modulo.clave)}>
        <i style="background: {activo ? 'currentColor' : COLOR_FASE[modulo.fase]}"></i>
        <span class="txt">{modulo.titulo}</span>
        {#if !modulo.operativo}
          <span class="fase">{modulo.fase}</span>
        {/if}
      </button>

      {#if activo && modulo.secciones.length > 1}
        <div class="secciones">
          {#each modulo.secciones.filter((s) => sesion.puedeVer(s.permiso)) as seccion (seccion.clave)}
            <button
              class="seccion"
              class:on={rutas.actual.seccion === seccion.clave}
              onclick={() => rutas.ir(modulo.clave, seccion.clave)}
            >
              {seccion.titulo}
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  </nav>

  <div class="foot">MOTRAE · Innovation already in motion</div>
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
    color: #fff;
    font-weight: 600;
  }
  .item i {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 3px;
    flex: none;
    opacity: 0.9;
  }
  .txt {
    flex: 1;
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
  .foot {
    margin-top: auto;
    padding: 1.5rem 0.85rem 0;
    font-size: 0.8rem;
    color: var(--gris);
  }
</style>
