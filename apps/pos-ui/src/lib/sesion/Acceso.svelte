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
        <div class="puntos">
          {#each Array(8) as _, i (i)}
            <span class="punto" class:lleno={i < secreto.length}></span>
          {/each}
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

    <button class="volver" onclick={() => (elegido = null)}>← Elegir otro usuario</button>
  {/if}
</div>

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
    gap: 0.4rem;
  }
  .punto {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
  }
  .punto.lleno {
    background: var(--acento);
    border-color: var(--acento);
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
</style>
