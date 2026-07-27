<script lang="ts">
  /**
   * Pantalla de acceso. Los perfiles administrativos entran con contraseña;
   * el personal de piso con PIN.
   */
  import { MAX_INTENTOS, type Usuario } from "@motrest/dominio";
  import { contextoSeguro, explicacionContextoInseguro } from "../entorno";
  import { sesion } from "./sesion.svelte";
  import TecladoPin from "./TecladoPin.svelte";

  interface Props {
    onCerrar: () => void;
  }
  let { onCerrar }: Props = $props();

  let elegido = $state<Usuario | null>(null);
  let secreto = $state("");
  let error = $state("");
  let verificando = $state(false);

  const esContrasena = $derived(elegido ? sesion.tipoCredencialDe(elegido.id) === "contrasena" : false);
  const bloqueado = $derived(elegido ? sesion.estaBloqueado(elegido.id) : false);
  const restantes = $derived(elegido ? sesion.intentosRestantes(elegido.id) : 0);

  /*
   * No se ofrece un botón que no lleva a ningún lado.
   *
   * Si en el local no hay nadie de rango superior con permiso para firmarlo, el
   * restablecimiento no puede ocurrir; decirlo ahora ahorra dos minutos de
   * teclear claves ajenas. Es también el caso del propietario: por encima de él
   * no hay nadie, así que su contraseña la cambia él mismo desde dentro.
   */
  const hayQuienAutorice = $derived(
    elegido ? sesion.hayQuienAutoriceCredencialDe(elegido) : false,
  );

  // --- Recuperar con código de rescate (solo el propietario) ---
  let rescatando = $state(false);
  let codigoRescate = $state("");
  let claveNueva = $state("");
  let claveNuevaOtra = $state("");
  let errorRescate = $state("");
  let rescatandoAhora = $state(false);
  /** El código nuevo que reemplaza al usado, para anotarlo antes de seguir. */
  let codigoEmitido = $state<string | null>(null);

  function cerrarRescate() {
    rescatando = false;
    codigoRescate = "";
    claveNueva = "";
    claveNuevaOtra = "";
    errorRescate = "";
    codigoEmitido = null;
    sesion.olvidarCodigoMostrado();
  }

  async function recuperar() {
    if (rescatandoAhora) return;
    if (claveNueva !== claveNuevaOtra) {
      errorRescate = "Las dos contraseñas no coinciden";
      return;
    }
    rescatandoAhora = true;
    errorRescate = "";
    const r = await sesion.recuperarAcceso(codigoRescate, claveNueva);
    rescatandoAhora = false;
    if (!r.ok) {
      errorRescate = r.error ?? "No se pudo recuperar el acceso";
      return;
    }
    // El código usado se quemó; se entrega el nuevo ANTES de cerrar.
    codigoEmitido = sesion.codigoRescateNuevo;
    codigoRescate = "";
    claveNueva = "";
    claveNuevaOtra = "";
  }

  // --- Restablecer credencial olvidada ---
  let restableciendo = $state(false);
  let nuevoSecreto = $state("");
  let confirmacion = $state("");
  let claveAutorizador = $state("");
  let errorRestablecer = $state("");
  let restableciendoAhora = $state(false);

  function cerrarRestablecer() {
    restableciendo = false;
    // Las claves no se quedan en memoria más de lo necesario.
    nuevoSecreto = "";
    confirmacion = "";
    claveAutorizador = "";
    errorRestablecer = "";
  }

  async function restablecer() {
    if (!elegido || restableciendoAhora) return;
    if (nuevoSecreto !== confirmacion) {
      errorRestablecer = "Las dos claves no coinciden";
      return;
    }

    restableciendoAhora = true;
    errorRestablecer = "";
    try {
      const r = await sesion.restablecerCredencial(
        elegido.id,
        nuevoSecreto,
        esContrasena ? "contrasena" : "pin",
        claveAutorizador,
      );
      if (r.ok) {
        cerrarRestablecer();
        error = "";
        secreto = "";
        return;
      }
      errorRestablecer = r.error ?? "No se pudo restablecer";
      claveAutorizador = "";
    } catch (causa) {
      console.error("Fallo al restablecer la credencial", causa);
      errorRestablecer = motivoTecnico();
    } finally {
      restableciendoAhora = false;
    }
  }

  function elegir(u: Usuario) {
    elegido = u;
    secreto = "";
    error = "";
  }

  async function entrar() {
    if (!elegido || verificando) return;
    verificando = true;
    error = "";

    /*
     * El `finally` no es adorno: sin él, un fallo al verificar dejaba el botón
     * en "Verificando…" para siempre, sin decir qué pasó. Quien abre la caja
     * no tiene forma de saber que el problema es el navegador y no su
     * contraseña.
     */
    try {
      const r = await sesion.iniciarSesion(elegido.id, secreto);
      if (r.ok) {
        onCerrar();
        return;
      }
      error = r.error ?? "No se pudo iniciar sesión";
      secreto = "";
    } catch (causa) {
      console.error("Fallo al verificar la credencial", causa);
      error = motivoTecnico();
      secreto = "";
    } finally {
      verificando = false;
    }
  }

  /**
   * Explica un fallo que no es culpa de quien teclea.
   *
   * El caso real: el navegador solo permite comprobar contraseñas en una
   * dirección segura. Abrir el POS por la IP de la red en `http://` deja sin
   * esa capacidad a toda la aplicación, y el síntoma —"no me deja entrar"— no
   * apunta a la causa por ningún lado.
   */
  function motivoTecnico(): string {
    if (!contextoSeguro()) return explicacionContextoInseguro();
    return "No se pudo verificar la credencial en este dispositivo. Revisa la consola del navegador.";
  }
</script>

<div class="velo"></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Iniciar sesión">
  <div class="marca">MotRest<span>.</span></div>

  {#if !elegido}
    <h2>¿Quién eres?</h2>
    <div class="lista">
      {#each sesion.usuariosActivos as usuario (usuario.id)}
        <button class="usuario" onclick={() => elegir(usuario)}>
          <span class="av">{usuario.iniciales}</span>
          <span class="datos">
            <b>{usuario.nombre}</b>
            <small>{usuario.puesto}</small>
          </span>
        </button>
      {/each}
    </div>
    <button class="volver" onclick={onCerrar}>Cancelar</button>
  {:else}
    <h2>Hola, {elegido.nombre}</h2>

    {#if bloqueado}
      <div class="bloqueo" role="alert">
        <p class="titulo-bloqueo">Cuenta bloqueada</p>
        <p>
          Se agotaron los {MAX_INTENTOS} intentos permitidos. Un usuario con permiso de
          administración debe desbloquear esta cuenta.
        </p>
      </div>
    {:else}
      <p class="pista">
        {esContrasena ? "Escribe tu contraseña" : "Marca tu PIN"}
      </p>

      {#if esContrasena}
        <input
          class="clave"
          type="password"
          bind:value={secreto}
          placeholder="Contraseña"
          autocomplete="current-password"
          onkeydown={(e) => e.key === "Enter" && entrar()}
        />
        <button class="entrar" onclick={entrar} disabled={verificando || secreto.length === 0}>
          {verificando ? "Verificando…" : "Entrar"}
        </button>
      {:else}
        <!--
          Un punto naranja por dígito tecleado, y nada más.

          Antes había ocho huecos fijos que dejaban ver de un vistazo la
          longitud del PIN —una pista de más para quien mira por encima del
          hombro—. Ahora los puntos aparecen conforme se escribe: no se anuncia
          cuántos faltan ni cuántos son.
        -->
        <div class="puntos" aria-hidden="true">
          {#each Array(secreto.length) as _, i (i)}
            <span class="punto"></span>
          {/each}
          {#if secreto.length === 0}
            <span class="punto-guia"></span>
          {/if}
        </div>
        <TecladoPin
          valor={secreto}
          onCambio={(v) => (secreto = v)}
          onAceptar={entrar}
          bloqueado={verificando}
        />
      {/if}

      {#if restantes < MAX_INTENTOS && restantes > 0}
        <p class="restantes">
          {restantes === 1 ? "Queda 1 intento" : `Quedan ${restantes} intentos`} antes del bloqueo
        </p>
      {/if}
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if verificando}<p class="pista">Verificando…</p>{/if}

    <!--
      Olvidar el PIN a media tarde pasa varias veces al mes. Sin esta salida,
      la única alternativa es que alguien deje la caja para editarlo desde
      Administración — o que el mesero deje de cobrar.
    -->
    {#if hayQuienAutorice}
      <button class="restablecer" onclick={() => (restableciendo = true)}>
        {esContrasena ? "Olvidé mi contraseña" : "Olvidé mi PIN"}
      </button>
    {:else if elegido.rol_id === "propietario" && sesion.hayCodigoRescate}
      <!--
        Por encima del propietario no hay nadie que pueda firmarle un
        restablecimiento. Su salida es el código de rescate que se emitió al
        instalar: sin ella, olvidar la contraseña lo dejaba fuera de su propio
        negocio para siempre.
      -->
      <button class="restablecer" onclick={() => (rescatando = true)}>
        Olvidé mi contraseña · usar código de rescate
      </button>
    {/if}

    <button class="volver" onclick={() => (elegido = null)}>← Elegir otro usuario</button>
  {/if}
</div>

<!-- Restablecer credencial, con la firma de un superior -->
{#if restableciendo && elegido}
  <div class="velo-2"></div>
  <div class="dialogo" role="dialog" aria-label="Restablecer credencial">
    <h2>Restablecer {esContrasena ? "contraseña" : "PIN"}</h2>
    <p class="quien">{elegido.nombre} · {elegido.puesto}</p>

    <p class="explica">
      Necesitas que lo autorice alguien de rango superior con permiso para
      hacerlo. Escribe primero tu clave nueva y pídele que la firme.
    </p>

    <label>
      <span>{esContrasena ? "Contraseña nueva" : "PIN nuevo"}</span>
      <input
        type="password"
        bind:value={nuevoSecreto}
        inputmode={esContrasena ? "text" : "numeric"}
        autocomplete="new-password"
        placeholder={esContrasena ? "Al menos 8 caracteres" : "4 a 8 dígitos"}
      />
    </label>

    <label>
      <span>Repítela</span>
      <input type="password" bind:value={confirmacion} autocomplete="new-password" />
    </label>

    <label>
      <span>Clave de quien autoriza</span>
      <input
        type="password"
        bind:value={claveAutorizador}
        autocomplete="off"
        placeholder="PIN o contraseña del superior"
        onkeydown={(e) => e.key === "Enter" && restablecer()}
      />
    </label>

    {#if errorRestablecer}<p class="error" role="alert">{errorRestablecer}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={cerrarRestablecer}>Cancelar</button>
      <button class="entrar" onclick={restablecer} disabled={restableciendoAhora}>
        {restableciendoAhora ? "Verificando…" : "Restablecer"}
      </button>
    </div>
  </div>
{/if}


<!-- Recuperar el acceso del propietario con el código de rescate -->
{#if rescatando}
  <div class="velo-2"></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Recuperar acceso">
    {#if codigoEmitido}
      <!--
        Se entrega el código NUEVO antes de dejar salir: el usado se quemó, y
        quien acaba de recuperar el acceso se quedaría sin llave de repuesto.
      -->
      <h2>Listo. Anota tu nuevo código</h2>
      <p class="explica">
        Tu contraseña quedó cambiada. El código que usaste ya no sirve; este es
        el nuevo. <b>Guárdalo fuera de la computadora</b> —en papel, en una caja
        fuerte—: es la única forma de volver a entrar si olvidas la contraseña.
      </p>
      <p class="codigo">{codigoEmitido}</p>
      <div class="botones">
        <button class="principal" onclick={cerrarRescate}>Ya lo anoté</button>
      </div>
    {:else}
      <h2>Recuperar el acceso</h2>
      <p class="explica">
        Teclea el código de rescate que se te entregó al instalar MotRest y
        elige una contraseña nueva. Da igual si lo escribes con guiones o sin
        ellos.
      </p>

      <label>
        <span>Código de rescate</span>
        <input
          bind:value={codigoRescate}
          placeholder="A7K2M-9PQRS-3TVWX-YZ4BC"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label>
        <span>Contraseña nueva</span>
        <input type="password" bind:value={claveNueva} autocomplete="new-password" />
      </label>
      <label>
        <span>Repítela</span>
        <input type="password" bind:value={claveNuevaOtra} autocomplete="new-password" />
      </label>

      {#if errorRescate}<p class="error" role="alert">{errorRescate}</p>{/if}

      <div class="botones">
        <button class="secundario" onclick={cerrarRescate}>Cancelar</button>
        <button class="principal" disabled={rescatandoAhora} onclick={recuperar}>
          {rescatandoAhora ? "Comprobando…" : "Recuperar acceso"}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: var(--negro);
    opacity: 0.97;
    z-index: 50;
  }
  .panel {
    position: fixed;
    z-index: 51;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    padding: 2rem 1rem;
    overflow-y: auto;
    color: #fff;
  }
  .marca {
    font-family: var(--font-titulo);
    font-size: 2rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
  .marca span {
    color: var(--acento);
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
  }
  .pista {
    font-size: 0.9rem;
    color: #b9c2bc;
  }
  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(22rem, 100%);
    margin-top: 0.5rem;
  }
  .usuario {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    background: rgba(255, 255, 255, 0.07);
    border: 1.5px solid rgba(255, 255, 255, 0.14);
    border-radius: var(--r-lg);
    padding: 0.85rem 1rem;
    text-align: left;
    color: #fff;
    transition: border-color 0.12s ease;
  }
  .usuario:hover {
    border-color: var(--acento);
  }
  .av {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--acento);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-titulo);
    font-weight: 700;
    flex: none;
  }
  .datos {
    display: flex;
    flex-direction: column;
  }
  .datos b {
    font-size: 1rem;
  }
  .datos small {
    font-size: 0.8rem;
    color: #b9c2bc;
  }
  .clave {
    width: min(18rem, 100%);
    padding: 0.85rem 1rem;
    border-radius: var(--r-md);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 1rem;
    font-family: var(--font-cuerpo);
  }
  .clave::placeholder {
    color: #8a969c;
  }
  .entrar {
    width: min(18rem, 100%);
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
  }
  .entrar:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .puntos {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 0.8rem;
  }
  /* Cada dígito tecleado enciende un punto naranja. */
  .punto {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--acento);
    box-shadow: 0 0 8px color-mix(in srgb, var(--acento) 60%, transparent);
    animation: aparecer 0.12s ease-out;
  }
  /* Una marca tenue mientras no se ha escrito nada, para que el campo no quede vacío. */
  .punto-guia {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.22);
  }
  @keyframes aparecer {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .punto {
      animation: none;
    }
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ff8a7a;
    max-width: 20rem;
    text-align: center;
  }
  .restantes {
    font-size: 0.78rem;
    color: #e6b23a;
    font-weight: 600;
  }
  .bloqueo {
    max-width: 20rem;
    text-align: center;
    background: rgba(224, 57, 43, 0.12);
    border: 1.5px solid rgba(224, 57, 43, 0.5);
    border-radius: var(--r-lg);
    padding: 1rem 1.25rem;
    font-size: 0.85rem;
    color: #ffc9c2;
    line-height: 1.5;
  }
  .titulo-bloqueo {
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 700;
    color: #ff8a7a;
    margin-bottom: 0.35rem;
  }
  .volver {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: #b9c2bc;
    text-decoration: underline;
  }

  /* --- Restablecer credencial olvidada --- */

  .restablecer {
    margin-top: 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--acento);
    text-decoration: underline;
  }

  .velo-2 {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 52;
  }
  .dialogo {
    position: fixed;
    z-index: 53;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(26rem, calc(100vw - 2rem));
    max-height: 92vh;
    overflow-y: auto;
    background: #1c2226;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--r-md);
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  }
  .dialogo h2 {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
    color: #fff;
  }
  .quien {
    font-size: 0.88rem;
    color: var(--acento);
    font-weight: 600;
    margin-top: -0.4rem;
  }
  .explica {
    font-size: 0.85rem;
    color: #b9c2bc;
    line-height: 1.5;
  }
  .dialogo label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dialogo label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: #8a969c;
  }
  .dialogo input {
    width: 100%;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-sm);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 1rem;
    font-family: var(--font-cuerpo);
  }
  .dialogo input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .botones {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .botones .entrar,
  .secundario {
    width: auto;
    flex: 1;
    padding: 0.7rem;
  }
  .secundario {
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: var(--r-md);
    background: transparent;
    color: #b9c2bc;
    font-family: var(--font-titulo);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .codigo {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-align: center;
    color: var(--acento);
    background: #fffaf5;
    border: 1.5px dashed var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 0.5rem;
    margin: 0.9rem 0 0.2rem;
    user-select: all;
    word-break: break-all;
  }
</style>
