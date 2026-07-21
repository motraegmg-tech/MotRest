<script lang="ts">
  /**
   * Cambio de credencial obligatorio en el primer inicio de sesión.
   * El usuario propietario nace con esta bandera porque su contraseña inicial
   * fue comunicada fuera del sistema.
   */
  import { sesion } from "./sesion.svelte";

  let nueva = $state("");
  let repetida = $state("");
  let error = $state("");
  let guardando = $state(false);

  async function guardar() {
    if (guardando) return;
    error = "";
    if (nueva !== repetida) {
      error = "Las contraseñas no coinciden";
      return;
    }
    guardando = true;
    const r = await sesion.cambiarCredencialPropia(nueva, "contrasena");
    guardando = false;
    if (!r.ok) {
      error = r.error ?? "No se pudo guardar";
      return;
    }
    nueva = "";
    repetida = "";
  }
</script>

<div class="velo"></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Cambiar contraseña">
  <h2>Cambia tu contraseña</h2>
  <p class="motivo">
    Tu contraseña inicial se comunicó fuera del sistema. Por seguridad, define una
    nueva antes de continuar.
  </p>

  <input
    type="password"
    bind:value={nueva}
    placeholder="Nueva contraseña"
    autocomplete="new-password"
  />
  <input
    type="password"
    bind:value={repetida}
    placeholder="Repite la contraseña"
    autocomplete="new-password"
    onkeydown={(e) => e.key === "Enter" && guardar()}
  />

  <p class="regla">Mínimo 8 caracteres, combinando letras y números.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <button class="guardar" onclick={guardar} disabled={guardando || nueva.length === 0}>
    {guardando ? "Guardando…" : "Guardar y continuar"}
  </button>
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.75);
    z-index: 60;
  }
  .panel {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    padding: 2rem;
    width: min(24rem, calc(100vw - 2rem));
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
  }
  .motivo {
    font-size: 0.88rem;
    color: var(--gris);
    line-height: 1.5;
  }
  input {
    padding: 0.8rem 1rem;
    border-radius: var(--r-md);
    border: 1.5px solid var(--borde);
    font-size: 1rem;
    font-family: var(--font-cuerpo);
    color: var(--pizarra);
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .regla {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .guardar {
    margin-top: 0.4rem;
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
  }
  .guardar:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
