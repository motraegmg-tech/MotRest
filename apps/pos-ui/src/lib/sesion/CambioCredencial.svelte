<script lang="ts">
  /**
   * Cambiar la propia credencial, estando dentro.
   *
   * Antes solo aparecía forzado en el primer inicio. Esa obligación se quitó
   * porque no cumplía su fin: como solo se levanta al completar el cambio,
   * quien cerraba el diálogo se lo encontraba otra vez en cada inicio, y un
   * aviso que se cierra sin leer no protege nada.
   *
   * Ahora es voluntario y vive en el menú del usuario, que es donde se busca.
   * Y es además la ÚNICA vía para el propietario: como el restablecimiento con
   * firma exige un rango superior y por encima de él no hay nadie, su clave
   * solo la cambia él mismo desde aquí.
   */
  import { sesion } from "./sesion.svelte";

  interface Props {
    onCerrar?: () => void;
  }
  let { onCerrar }: Props = $props();

  const esPin = $derived(
    sesion.usuarioActual ? sesion.tipoCredencialDe(sesion.usuarioActual.id) === "pin" : false,
  );

  let nueva = $state("");
  let repetida = $state("");
  let error = $state("");
  let guardando = $state(false);
  let listo = $state(false);

  async function guardar() {
    if (guardando) return;
    error = "";
    if (nueva !== repetida) {
      error = esPin ? "Los dos PIN no coinciden" : "Las contraseñas no coinciden";
      return;
    }
    guardando = true;
    const r = await sesion.cambiarCredencialPropia(nueva, esPin ? "pin" : "contrasena");
    guardando = false;
    if (!r.ok) {
      error = r.error ?? "No se pudo guardar";
      return;
    }
    nueva = "";
    repetida = "";
    listo = true;
  }
</script>

<div class="velo" role="presentation" onclick={() => onCerrar?.()}></div>
<div
  class="panel"
  role="dialog"
  aria-modal="true"
  aria-label={esPin ? "Cambiar PIN" : "Cambiar contraseña"}
>
  {#if listo}
    <h2>Listo</h2>
    <p class="motivo">
      Tu {esPin ? "PIN" : "contraseña"} quedó actualizado. Úsalo la próxima vez que entres.
    </p>
    <button class="guardar" onclick={() => onCerrar?.()}>Cerrar</button>
  {:else}
    <h2>Cambiar {esPin ? "tu PIN" : "tu contraseña"}</h2>
    <p class="motivo">
      Solo tú puedes cambiarla desde aquí. No hace falta que nadie la autorice
      porque ya iniciaste sesión con la anterior.
    </p>

    <input
      type="password"
      bind:value={nueva}
      inputmode={esPin ? "numeric" : "text"}
      placeholder={esPin ? "PIN nuevo" : "Contraseña nueva"}
      autocomplete="new-password"
    />
    <input
      type="password"
      bind:value={repetida}
      inputmode={esPin ? "numeric" : "text"}
      placeholder={esPin ? "Repite el PIN" : "Repite la contraseña"}
      autocomplete="new-password"
      onkeydown={(e) => e.key === "Enter" && guardar()}
    />

    <p class="regla">
      {esPin ? "De 4 a 8 dígitos." : "Mínimo 8 caracteres, combinando letras y números."}
    </p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="acciones">
      {#if onCerrar}
        <button class="cancelar" onclick={() => onCerrar()}>Cancelar</button>
      {/if}
      <button class="guardar" onclick={guardar} disabled={guardando || nueva.length === 0}>
        {guardando ? "Guardando…" : "Guardar"}
      </button>
    </div>
  {/if}
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
  .acciones {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
  .acciones .guardar {
    flex: 1;
    margin-top: 0;
  }
  .cancelar {
    flex: 1;
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    border-radius: var(--r-md);
    background: transparent;
    color: #b9c2bc;
    padding: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
  }
</style>
