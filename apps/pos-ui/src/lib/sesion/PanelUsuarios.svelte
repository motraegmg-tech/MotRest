<script lang="ts">
  /**
   * Gestión de usuarios: alta con permisos granulares y edición de los
   * existentes. En la etapa 3 este panel se mueve al módulo M9 del sidebar.
   */
  import { LISTA_ROLES, type Permiso, type RolId, type Usuario } from "@motrest/dominio";
  import { sesion } from "./sesion.svelte";
  import EditorPermisos from "./EditorPermisos.svelte";

  interface Props {
    onCerrar: () => void;
  }
  let { onCerrar }: Props = $props();

  type Vista = { modo: "lista" } | { modo: "nuevo" } | { modo: "editar"; usuario: Usuario };
  let vista = $state<Vista>({ modo: "lista" });

  // Borrador del alta
  let nombre = $state("");
  let puesto = $state("");
  let rolId = $state<RolId>("mesero");
  let pin = $state("");
  let permisos = $state<Permiso[]>(sesion.plantilla("mesero"));
  let error = $state("");
  let guardando = $state(false);

  // Borrador de la edición
  let permisosEdicion = $state<Permiso[]>([]);

  const puedeCrear = $derived(sesion.puedeOperar("admin.usuario.crear"));
  const puedeEditar = $derived(sesion.puedeOperar("admin.usuario.editar"));

  function nuevo() {
    nombre = "";
    puesto = "";
    rolId = "mesero";
    pin = "";
    permisos = sesion.plantilla("mesero");
    error = "";
    vista = { modo: "nuevo" };
  }

  function cambiarRol(nuevoRol: RolId) {
    rolId = nuevoRol;
    permisos = sesion.plantilla(nuevoRol);
    const rol = LISTA_ROLES.find((r) => r.id === nuevoRol);
    if (rol && puesto.trim() === "") puesto = rol.nombre;
  }

  async function guardar() {
    if (guardando) return;
    guardando = true;
    error = "";
    const r = await sesion.crearUsuario({ nombre, puesto, rol_id: rolId, permisos, pin });
    guardando = false;
    if (r.ok) {
      vista = { modo: "lista" };
    } else {
      error = r.error ?? "No se pudo crear el usuario";
    }
  }

  function editar(usuario: Usuario) {
    permisosEdicion = usuario.permisos.map((p) => ({ ...p }));
    error = "";
    vista = { modo: "editar", usuario };
  }

  function guardarEdicion(usuario: Usuario) {
    const r = sesion.actualizarPermisos(usuario.id, permisosEdicion);
    if (r.ok) vista = { modo: "lista" };
    else error = r.error ?? "";
  }
</script>

<div class="velo" role="presentation" onclick={onCerrar}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Usuarios y permisos">
  <header>
    <h2>
      {#if vista.modo === "lista"}Usuarios y permisos
      {:else if vista.modo === "nuevo"}Nuevo usuario
      {:else}Permisos de {vista.usuario.nombre}{/if}
    </h2>
    <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
  </header>

  <div class="cuerpo">
    {#if vista.modo === "lista"}
      <div class="lista">
        {#each sesion.usuarios as usuario (usuario.id)}
          <div class="usuario" class:inactivo={!usuario.activo}>
            <span class="av">{usuario.iniciales}</span>
            <span class="datos">
              <b>{usuario.nombre}</b>
              <small>{usuario.puesto} · {usuario.permisos.length} actividades</small>
            </span>
            {#if puedeEditar}
              <button class="accion" onclick={() => editar(usuario)}>Permisos</button>
              <button
                class="accion"
                onclick={() => sesion.cambiarActivo(usuario.id, !usuario.activo)}
              >
                {usuario.activo ? "Desactivar" : "Activar"}
              </button>
            {/if}
          </div>
        {/each}
      </div>

      {#if puedeCrear}
        <button class="principal" onclick={nuevo}>+ Nuevo usuario</button>
      {:else}
        <p class="nota">Tu rol no permite crear usuarios.</p>
      {/if}
    {:else if vista.modo === "nuevo"}
      <div class="campos">
        <label>
          <span>Nombre</span>
          <input bind:value={nombre} placeholder="Nombre completo" />
        </label>
        <label>
          <span>Puesto</span>
          <input bind:value={puesto} placeholder="Puesto en el restaurante" />
        </label>
        <label>
          <span>PIN de acceso</span>
          <input bind:value={pin} inputmode="numeric" maxlength="8" placeholder="4 a 8 dígitos" />
        </label>
      </div>

      <div class="plantillas">
        <span class="etiqueta">Partir de un rol</span>
        <div class="roles">
          {#each LISTA_ROLES as rol (rol.id)}
            <button class="rol" class:on={rol.id === rolId} onclick={() => cambiarRol(rol.id)}>
              {rol.nombre}
            </button>
          {/each}
        </div>
        <p class="desc">{LISTA_ROLES.find((r) => r.id === rolId)?.descripcion}</p>
      </div>

      <p class="etiqueta">Actividades, permisos y alcances</p>
      <EditorPermisos {permisos} onCambio={(p) => (permisos = p)} />

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="botones">
        <button class="secundario" onclick={() => (vista = { modo: "lista" })}>Cancelar</button>
        <button class="principal" onclick={guardar} disabled={guardando}>
          {guardando ? "Creando…" : "Crear usuario"}
        </button>
      </div>
    {:else}
      {@const editado = vista.usuario}
      <p class="desc">
        {editado.puesto} · rol base {LISTA_ROLES.find((r) => r.id === editado.rol_id)?.nombre}
      </p>
      <EditorPermisos
        permisos={permisosEdicion}
        onCambio={(p) => (permisosEdicion = p)}
        soloLectura={!puedeEditar}
      />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="botones">
        <button class="secundario" onclick={() => (vista = { modo: "lista" })}>Cancelar</button>
        {#if puedeEditar}
          <button class="principal" onclick={() => guardarEdicion(editado)}>
            Guardar permisos
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 30;
  }
  .panel {
    position: fixed;
    z-index: 31;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(52rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    padding: 1.1rem 1.5rem;
    border-bottom: 1px solid var(--borde);
  }
  h2 {
    flex: 1;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .cuerpo {
    padding: 1.25rem 1.5rem 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .usuario {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 0.85rem;
  }
  .usuario.inactivo {
    opacity: 0.5;
  }
  .av {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    background: var(--acento);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-titulo);
    font-weight: 700;
    flex: none;
  }
  .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .datos b {
    font-size: 0.95rem;
  }
  .datos small {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .accion {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .accion:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .campos {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .campos label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .campos span {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.92rem;
    font-family: var(--font-cuerpo);
  }
  .campos input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .etiqueta {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .rol {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.8rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gris);
  }
  .rol.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .desc {
    font-size: 0.82rem;
    color: var(--gris);
    margin-top: 0.4rem;
  }
  .nota {
    font-size: 0.85rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    padding-top: 0.5rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-family: var(--font-titulo);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .principal:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
  }
</style>
