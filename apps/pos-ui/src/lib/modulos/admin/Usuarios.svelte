<script lang="ts">
  /**
   * M9 · Usuarios y permisos.
   *
   * Alta de usuarios desplegando la lista completa de actividades, permisos y
   * alcances, y edición de los permisos de quien ya existe.
   */
  import { LISTA_ROLES, type Permiso, type RolId, type Usuario } from "@motrest/dominio";
  import { arranque } from "../../persistencia/arranque.svelte";
  import EditorPermisos from "../../sesion/EditorPermisos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  let confirmandoReinicio = $state(false);

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

  /** El código de rescate es del propietario: nadie más puede usarlo. */
  const esPropietario = $derived(sesion.usuarioActual?.rol_id === "propietario");

  const puedeCrear = $derived(sesion.puedeOperar("admin.usuario.crear"));
  const puedeEditar = $derived(sesion.puedeOperar("admin.usuario.editar"));

  /** Solo roles por debajo del propio: nadie crea a un igual ni a un superior. */
  const rolesDisponibles = $derived(
    LISTA_ROLES.filter((r) => sesion.rolesAsignables.includes(r.id)),
  );

  function nuevo() {
    const inicial = rolesDisponibles.at(-1)?.id ?? "mesero";
    nombre = "";
    puesto = "";
    rolId = inicial;
    pin = "";
    permisos = sesion.plantilla(inicial);
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

  /*
   * Eliminar se confirma escribiendo el nombre, no con un «¿seguro?».
   *
   * Un «¿seguro?» se contesta que sí sin leerlo: es un reflejo, no una decisión.
   * Y esto no se deshace — el usuario desaparece de la plantilla y su credencial
   * se destruye—. Teclear el nombre obliga a mirar a quién se está borrando, que
   * es exactamente el error que hay que evitar: eliminar al de la fila de al
   * lado.
   */
  let eliminando = $state<Usuario | null>(null);
  let nombreEscrito = $state("");
  let errorEliminar = $state("");

  const nombreCoincide = $derived(
    eliminando !== null &&
      nombreEscrito.trim().toLocaleLowerCase("es") ===
        eliminando.nombre.trim().toLocaleLowerCase("es"),
  );

  function pedirEliminar(usuario: Usuario) {
    eliminando = usuario;
    nombreEscrito = "";
    errorEliminar = "";
  }

  function confirmarEliminar() {
    if (!eliminando || !nombreCoincide) return;
    const r = sesion.eliminarUsuario(eliminando.id);
    if (r.ok) {
      eliminando = null;
      nombreEscrito = "";
    } else {
      errorEliminar = r.error ?? "No se pudo eliminar al usuario";
    }
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


    <!--
      Código de rescate, a petición.

      Ya no se emite solo ni se enseña al arrancar: salía en cada instalación y
      estorbaba. Queda aquí, callado, para el día que se quiera tener uno — es
      la única forma de recuperar el acceso si el propietario olvida su
      contraseña, porque por encima de él no hay quien se la restablezca.
    -->
    {#if esPropietario}
      <section class="rescate">
        {#if sesion.codigoRescateNuevo}
          <p class="titulo-resc">Anótalo ahora: no se puede volver a mostrar</p>
          <p class="codigo-resc">{sesion.codigoRescateNuevo}</p>
          <p class="pie-resc">
            Guárdalo <b>fuera de esta computadora</b>. Aquí solo queda cifrado.
          </p>
          <button class="mini-resc" onclick={() => sesion.olvidarCodigoMostrado()}>Ya lo anoté</button>
        {:else}
          <div class="fila-resc">
            <div>
              <b>Código de rescate</b>
              <span>
                {sesion.hayCodigoRescate
                  ? "Ya hay uno emitido. Generar otro invalida el anterior."
                  : "No hay ninguno. Sin él, olvidar tu contraseña te deja fuera."}
              </span>
            </div>
            <button class="mini-resc" onclick={() => sesion.emitirCodigoRescate()}>
              {sesion.hayCodigoRescate ? "Generar otro" : "Generar"}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    <div class="lista">
      {#each sesion.usuariosAdministrables as usuario (usuario.id)}
        {@const bloqueado = sesion.estaBloqueado(usuario.id)}
        {@const gestionable = sesion.puedeGestionar(usuario)}
        {@const propio = sesion.usuarioActual?.id === usuario.id}
        <div class="usuario" class:inactivo={!usuario.activo}>
          <span class="av">{usuario.iniciales}</span>
          <span class="datos">
            <b>
              {usuario.nombre}
              {#if propio}<span class="marca">tú</span>{/if}
              {#if bloqueado}<span class="candado">bloqueado</span>{/if}
            </b>
            <small>{usuario.puesto} · {usuario.permisos.length} actividades concedidas</small>
          </span>

          {#if puedeEditar && gestionable}
            {#if bloqueado}
              <button class="accion urgente" onclick={() => sesion.desbloquear(usuario.id)}>
                Desbloquear
              </button>
            {/if}
            <button class="accion" onclick={() => editar(usuario)}>Permisos</button>
            <button class="accion" onclick={() => sesion.cambiarActivo(usuario.id, !usuario.activo)}>
              {usuario.activo ? "Desactivar" : "Activar"}
            </button>
            <!--
              Eliminar solo aparece para quien de verdad puede. Enseñar un botón
              que va a contestar «no tienes permiso» no informa: enfada, y encima
              revela que la función existe a quien no le toca.
            -->
            {#if sesion.puedeEliminar(usuario.id)}
              <button class="accion peligro" onclick={() => pedirEliminar(usuario)}>
                Eliminar
              </button>
            {/if}
          {:else}
            <button class="accion" onclick={() => editar(usuario)}>Ver permisos</button>
            {#if puedeEditar}
              <span class="protegido" title="Su rol está a tu mismo nivel o por encima del tuyo">
                {propio ? "No puedes editarte" : "Fuera de tu alcance"}
              </span>
            {/if}
          {/if}
        </div>
      {/each}
    </div>

    {#if !puedeCrear && !puedeEditar}
      <p class="nota">Tu rol permite consultar la lista, pero no modificarla.</p>
    {/if}

    {#if eliminando}
      <div class="eliminar" role="alertdialog" aria-labelledby="eliminar-titulo">
        <h2 id="eliminar-titulo">Eliminar a {eliminando.nombre}</h2>
        <p>
          Desaparecerá de la plantilla y su PIN dejará de servir para entrar y para
          firmar cancelaciones o descuentos. <b>Esto no se puede deshacer.</b>
        </p>
        <!--
          Se dice qué NO se borra, porque es lo que la gente teme y lo que le
          hace elegir mal. Sin esta línea, el dueño desactiva en vez de eliminar
          «por si acaso» y la lista se llena de gente que ya no trabaja ahí.
        -->
        <p class="matiz">
          Su historial se conserva: las cuentas que cobró siguen a su nombre en la
          bitácora, y ahí queda escrito que tú lo eliminaste hoy. Si solo dejó de
          trabajar aquí y puede volver, usa <b>Desactivar</b>.
        </p>
        <label>
          <span>Escribe <b>{eliminando.nombre}</b> para confirmar</span>
          <input bind:value={nombreEscrito} placeholder={eliminando.nombre} autocomplete="off" />
        </label>
        {#if errorEliminar}<p class="error">{errorEliminar}</p>{/if}
        <div class="botones">
          <button class="accion urgente" disabled={!nombreCoincide} onclick={confirmarEliminar}>
            Eliminar en definitiva
          </button>
          <button class="accion" onclick={() => (eliminando = null)}>Cancelar</button>
        </div>
      </div>
    {/if}

    {#if sesion.puedeOperar("admin.usuario.editar")}
      <div class="mantenimiento">
        <div>
          <b>Reiniciar datos de demostración</b>
          <small>
            Borra el registro de operación guardado en este dispositivo y vuelve al
            estado inicial. No afecta a otros equipos.
          </small>
        </div>
        {#if confirmandoReinicio}
          <button class="accion urgente" onclick={() => arranque.reiniciarDemostracion()}>
            Confirmar borrado
          </button>
          <button class="accion" onclick={() => (confirmandoReinicio = false)}>Cancelar</button>
        {:else}
          <button class="accion" onclick={() => (confirmandoReinicio = true)}>Reiniciar</button>
        {/if}
      </div>
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
        {#each rolesDisponibles as rol (rol.id)}
          <button class="rol" class:on={rol.id === rolId} onclick={() => cambiarRol(rol.id)}>
            {rol.nombre}
          </button>
        {/each}
      </div>
      <p class="desc">{LISTA_ROLES.find((r) => r.id === rolId)?.descripcion}</p>
      <p class="nota-jerarquia">
        Solo puedes crear usuarios con un rol por debajo del tuyo, y concederles
        actividades que tú mismo tengas.
      </p>
    </div>

    <p class="etiqueta">Actividades, permisos y alcances</p>
    <EditorPermisos
      {permisos}
      onCambio={(p) => (permisos = p)}
      puedeOtorgar={(p) => sesion.puedeOtorgar(p)}
    />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="botones">
      <button class="secundario" onclick={() => (vista = { modo: "lista" })}>Cancelar</button>
      <button class="principal" onclick={guardar} disabled={guardando}>
        {guardando ? "Creando…" : "Crear usuario"}
      </button>
    </div>
  {:else}
    {@const editado = vista.usuario}
    {@const editable = puedeEditar && sesion.puedeGestionar(editado)}
    <div class="encabezado">
      <div>
        <h1>Permisos de {editado.nombre}</h1>
        <p class="sub">
          {editado.puesto} · rol base {LISTA_ROLES.find((r) => r.id === editado.rol_id)?.nombre}
        </p>
      </div>
    </div>

    {#if !editable}
      <div class="protegido-aviso" role="note">
        <b>Solo lectura.</b>
        {sesion.usuarioActual?.id === editado.id
          ? "Nadie edita sus propios permisos: evita que alguien se conceda más poder del que tiene."
          : "Su rol está a tu mismo nivel o por encima del tuyo, así que no puedes modificarlo."}
      </div>
    {/if}

    <EditorPermisos
      permisos={permisosEdicion}
      onCambio={(p) => (permisosEdicion = p)}
      soloLectura={!editable}
      puedeOtorgar={(p) => sesion.puedeOtorgar(p)}
    />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="botones">
      <button class="secundario" onclick={() => (vista = { modo: "lista" })}>
        {editable ? "Cancelar" : "Volver"}
      </button>
      {#if editable}
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
  /* Eliminar se distingue del resto de acciones sin gritar: la confirmación es
     la que frena, no el color. */
  .accion.peligro {
    color: var(--peligro);
  }
  .accion.peligro:hover {
    border-color: var(--peligro);
    background: var(--peligro);
    color: #fff;
  }
  .accion:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .accion:disabled:hover {
    background: #fff;
    border-color: var(--borde);
    color: var(--pizarra);
  }
  .eliminar {
    margin-top: 1rem;
    padding: 1rem 1.1rem;
    border: 1.5px solid var(--peligro);
    border-radius: var(--r-md);
    background: #fff;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .eliminar h2 {
    font-size: 1rem;
    margin: 0;
  }
  .eliminar p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .eliminar .matiz {
    color: var(--gris);
    font-size: 0.82rem;
  }
  .eliminar label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.82rem;
  }
  .eliminar input {
    padding: 0.6rem 0.8rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.92rem;
  }
  .eliminar .botones {
    display: flex;
    gap: 0.5rem;
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
  .nota-jerarquia {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--gris);
    max-width: 40rem;
  }
  .mantenimiento {
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    border: 1px dashed var(--borde);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
  }
  .mantenimiento > div {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .mantenimiento b {
    font-size: 0.9rem;
  }
  .mantenimiento small {
    font-size: 0.78rem;
    color: var(--gris);
    max-width: 34rem;
  }
  .marca {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--acento);
    border: 1px solid var(--acento);
    border-radius: var(--r-pill);
    padding: 0.05rem 0.4rem;
    vertical-align: middle;
  }
  .protegido {
    font-size: 0.76rem;
    color: var(--gris);
    font-style: italic;
    white-space: nowrap;
  }
  .protegido-aviso {
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    font-size: 0.86rem;
    color: var(--pizarra);
    line-height: 1.5;
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
  .rescate {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    margin-bottom: 1rem;
    background: #fff;
  }
  .fila-resc {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .fila-resc b {
    display: block;
    font-size: 0.9rem;
  }
  .fila-resc span {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .mini-resc {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.4rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    flex: none;
  }
  .mini-resc:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .titulo-resc {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--acento);
  }
  .codigo-resc {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-align: center;
    color: var(--acento);
    background: #fffaf5;
    border: 1.5px dashed var(--acento);
    border-radius: var(--r-md);
    padding: 0.75rem 0.5rem;
    margin: 0.6rem 0;
    user-select: all;
    word-break: break-all;
  }
  .pie-resc {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.45;
    margin-bottom: 0.6rem;
  }
</style>
