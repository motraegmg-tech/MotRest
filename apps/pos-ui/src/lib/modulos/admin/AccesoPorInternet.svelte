<script lang="ts">
  /**
   * «Acceso por internet» (1.6.0): el propietario cambia la contraseña con la
   * que su restaurante entra por la web.
   *
   * Gonzalo lo decidió así: la contraseña la cambian MOTRAE (desde Central) y el
   * propietario (desde aquí), y MOTRAE la puede seguir viendo para dar soporte.
   * Por eso se dice en pantalla: no es un secreto que el dueño tenga solo.
   *
   * DOS CAMINOS, según dónde se abra:
   * - en la WEB, el navegador tiene la clave remota y lo hace él; pide la
   *   contraseña actual, porque una tableta olvidada con la sesión abierta no
   *   debe bastar para dejar fuera al dueño;
   * - en la CAJA (modalidad «ambas»), lo hace el Hub con su propio pase; el
   *   propietario ya entró con su PIN.
   */
  import { contrasenaWebAceptable, modalidadDe } from "@motrest/dominio";
  import { esLaCaja } from "../../entorno";
  import { licencia } from "../../licencia.svelte";
  import { accesoWeb } from "../../web/acceso-web.svelte";

  const enLaWeb = $derived(accesoWeb.restaurante !== null);
  const modalidad = $derived(modalidadDe(licencia.licencia));

  let actual = $state("");
  let nueva = $state("");
  let repetida = $state("");
  let trabajando = $state(false);
  let error = $state("");
  let listo = $state("");

  const aviso = $derived.by(() => {
    if (!nueva) return "";
    const r = contrasenaWebAceptable(nueva);
    if (!r.ok) return r.error;
    if (repetida && repetida !== nueva) return "Las dos no coinciden";
    return "";
  });
  const puedeGuardar = $derived(
    !trabajando && nueva.length > 0 && nueva === repetida && !aviso && (!enLaWeb || actual.length > 0),
  );

  async function guardar(evento: Event) {
    evento.preventDefault();
    if (!puedeGuardar) return;
    error = "";
    listo = "";
    trabajando = true;
    try {
      if (enLaWeb) {
        // Si sale bien, la página vuelve a entrar sola con la nueva.
        const r = await accesoWeb.cambiarContrasena(actual, nueva, licencia.licencia?.web?.buzon_central);
        if (!r.ok) error = r.error;
        return;
      }
      const respuesta = await fetch("/acceso-web/contrasena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contrasena: nueva }),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!respuesta.ok || !cuerpo.ok) {
        error = cuerpo.error ?? "No se pudo cambiar la contraseña.";
        return;
      }
      listo = "Contraseña cambiada. Quien estuviera dentro por la web tendrá que volver a entrar con la nueva.";
      nueva = "";
      repetida = "";
    } catch {
      error = "No se pudo hablar con el Hub del local.";
    } finally {
      trabajando = false;
    }
  }
</script>

<section class="acceso">
  <header>
    <h2>Acceso por internet</h2>
    <p class="sub">
      {#if modalidad === "nube"}
        Tu restaurante vive en la nube: se entra desde cualquier navegador con su clave y su contraseña.
      {:else if modalidad === "ambas"}
        Los datos viven en la computadora de tu restaurante, y también se entra por la web con su clave y su
        contraseña mientras esa computadora esté encendida y con internet.
      {:else}
        Tu restaurante no tiene acceso por internet. Lo activa MOTRAE.
      {/if}
    </p>
  </header>

  {#if modalidad !== "app" && (enLaWeb || esLaCaja())}
    {#if enLaWeb && accesoWeb.restaurante}
      <p class="dato">Clave del restaurante: <b>{accesoWeb.restaurante.clave}</b></p>
    {/if}

    <form onsubmit={guardar}>
      <h3>Cambiar la contraseña web</h3>
      {#if enLaWeb}
        <label>
          Contraseña actual
          <input type="password" bind:value={actual} autocomplete="current-password" />
        </label>
      {/if}
      <label>
        Contraseña nueva
        <input type="password" bind:value={nueva} autocomplete="new-password" placeholder="Al menos 10 caracteres" />
      </label>
      <label>
        Repítela
        <input type="password" bind:value={repetida} autocomplete="new-password" />
      </label>
      {#if aviso}<p class="aviso">{aviso}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if listo}<p class="ok" role="status">{listo}</p>{/if}
      <button type="submit" class="primario" disabled={!puedeGuardar}>
        {trabajando ? "Cambiando…" : "Cambiar contraseña"}
      </button>
      <p class="nota">
        Al cambiarla se cierran todas las sesiones abiertas por la web. MOTRAE conserva la contraseña vigente
        para poder darte soporte.
      </p>
    </form>
  {:else if modalidad !== "app"}
    <p class="nota">La contraseña se cambia desde la caja del restaurante o desde la web.</p>
  {/if}
</section>

<style>
  .acceso {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 34rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
  }
  h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
  }
  .sub,
  .nota {
    color: var(--gris);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .dato {
    font-size: 0.95rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.2rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    font-weight: 600;
  }
  input {
    font: inherit;
    font-weight: 400;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
  }
  .primario {
    align-self: flex-start;
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.65rem 1.1rem;
    font-weight: 600;
  }
  .primario:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .aviso {
    color: var(--gris);
    font-size: 0.85rem;
  }
  .error {
    color: var(--peligro);
    font-size: 0.88rem;
  }
  .ok {
    color: var(--exito, var(--acento));
    font-size: 0.88rem;
  }
</style>
