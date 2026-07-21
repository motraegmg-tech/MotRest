<script lang="ts">
  /**
   * M9 · Usuarios y permisos.
   *
   * Alta de usuarios desplegando la lista completa de actividades, permisos y
   * alcances, y edición de los permisos de quien ya existe.
   */
  import { LISTA_ROLES, type Permiso, type RolId, type Usuario } from "@motrest/dominio";
  import EditorPermisos from "../../sesion/EditorPermisos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  type Vista = { modo: "lista" } | { modo: "nuevo" } | { modo: "editar"; usuario: Usuario };
  let vista = $state<Vista>({ modo: "lista" });

  let nombre = $state("");
  let puesto = $state("");
  let rolId = $state<RolId>("mesero");
  let pin = $state("");
  let permisos = $state<Permiso[]>(sesion.plantilla("mesero"));
  let permisosEdicion = $state<Permiso[]>([]);
  let error = $state("");
  let guardando = $state(false);

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
    if (r.ok) vista = { modo: "lista" };
    else error = r.error ?? "No se pudo crear el usuario";
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

<div class="seccion">
  {#if vista.modo === "lista"}
    <div class="encabezado">
      <div>
        <h1>Usuarios y permisos</h1>
        <p class="sub">Cada usuario ve y opera exactamente lo que su puesto requiere.</p>
      </div>
      {#if puedeCrear}
        <button class="principal" onclick={nuevo}>+ Nuevo usuario</button>
      {/if}
    </div>

    <div class="lista">
      {#each sesion.usuarios as usuario (usuario.id)}
        {@const bloqueado = sesion.estaBloqueado(usuario.id)}
        <div class="usuario" class:inactivo={!usuario.activo}>
          <span class="av">{usuario.iniciales}</span>
          <span class="datos">
            <b>
              {usuario.nombre}
              {#if bloqueado}<span class="candado">bloqueado</span>{/if}
            </b>
            <small>{usuario.puesto} · {usuario.permisos.length} actividades concedidas</small>
          </span>
          {#if puedeEditar}
            {#if bloqueado}
              <button class="accion urgente" onclick={() => sesion.desbloquear(usuario.id)}>
                Desbloquear
              </button>
            {/if}
            <button class="accion" onclick={() => editar(usuario)}>Permisos</button>
            <button class="accion" onclick={() => sesion.cambiarActivo(usuario.id, !usuario.activo)}>
              {usuario.activo ? "Desactivar" : "Activar"}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    {#if !puedeCrear && !puedeEditar}
      <p class="nota">Tu rol permite consultar la lista, pero no modificarla.</p>
    {/if}
  {:else if vista.modo === "nuevo"}
    <div class="encabezado">
      <h1>Nuevo usuario</h1>
    </div>

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
      <p class="etiqueta">Partir de un rol</p>
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
    <div class="encabezado">
      <div>
        <h1>Permisos de {editado.nombre}</h1>
        <p class="sub">
          {editado.puesto} · rol base {LISTA_ROLES.find((r) => r.id === editado.rol_id)?.nombre}
        </p>
      </div>
    </div>

    <EditorPermisos
      permisos={permisosEdicion}
      onCambio={(p) => (permisosEdicion = p)}
      soloLectura={!puedeEditar}
    />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="botones">
      <button class="secundario" onclick={() => (vista = { modo: "lista" })}>Cancelar</button>
      {#if puedeEditar}
        <button class="principal" onclick={() => guardarEdicion(editado)}>Guardar permisos</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 62rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }
  .encabezado > div {
    flex: 1;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    color: var(--gris);
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
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
  }
  .usuario.inactivo {
    opacity: 0.5;
  }
  .av {
    width: 2.4rem;
    height: 2.4rem;
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
    font-size: 0.97rem;
  }
  .datos small {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .candado {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #fff;
    background: var(--peligro);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.45rem;
    vertical-align: middle;
  }
  .accion {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .accion:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .accion.urgente {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .accion.urgente:hover {
    background: var(--peligro);
    color: #fff;
  }
  .campos {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .campos label {
    flex: 1;
    min-width: 11rem;
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
    padding: 0.65rem 0.8rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.92rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  .campos input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .etiqueta {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .roles {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .rol {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.85rem;
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .rol.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .desc {
    font-size: 0.84rem;
    color: var(--gris);
    margin-top: 0.5rem;
  }
  .nota {
    font-size: 0.86rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    padding-top: 0.25rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.7rem 1.25rem;
    font-family: var(--font-titulo);
    font-size: 0.95rem;
    font-weight: 600;
    flex: none;
  }
  .principal:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
</style>
