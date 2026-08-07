<script lang="ts">
  /**
   * Las credenciales del propietario, enseñadas UNA sola vez.
   *
   * Es lo último del día de la instalación. A partir de aquí, nada de lo que hay
   * en el repositorio de MotRest sirve para entrar en este restaurante.
   *
   * ## Tres decisiones
   *
   * 1. **No se puede cerrar sin confirmar.** Sin botón de aspa ni de escape: si
   *    se cierra por accidente, estas credenciales se pierden para siempre y hay
   *    que recuperar el acceso con el código de rescate.
   *
   * 2. **Se dice que no se vuelven a mostrar**, y se dice antes de que la
   *    persona decida cerrarla, no después.
   *
   * 3. **Copiar al portapapeles existe, pero no sustituye a apuntarlo.** El
   *    portapapeles de la caja se pierde al reiniciar, y ese equipo se reinicia.
   */
  import { sesion } from "./sesion.svelte";

  const { contrasena, pin }: { contrasena: string; pin: string } = $props();

  let confirmado = $state(false);
  let copiado = $state("");

  function copiar(que: "contrasena" | "pin", valor: string) {
    void navigator.clipboard?.writeText(valor);
    copiado = que;
    setTimeout(() => (copiado = ""), 2000);
  }
</script>

<div class="fondo" role="alertdialog" aria-modal="true" aria-labelledby="ci-titulo">
  <div class="tarjeta">
    <div class="cinta"></div>

    <h1 id="ci-titulo">Anote estas claves</h1>
    <p class="sub">
      Son las de <b>este restaurante</b> y no existen en ningún otro lado.
      <b>No se volverán a mostrar.</b>
    </p>

    <div class="clave">
      <span class="etiqueta">Contraseña de la dirección</span>
      <div class="valor">
        <code>{contrasena}</code>
        <button onclick={() => copiar("contrasena", contrasena)}>
          {copiado === "contrasena" ? "Copiada" : "Copiar"}
        </button>
      </div>
      <small>Para entrar al sistema y a la administración.</small>
    </div>

    <div class="clave">
      <span class="etiqueta">PIN de autorizaciones</span>
      <div class="valor">
        <code>{pin}</code>
        <button onclick={() => copiar("pin", pin)}>
          {copiado === "pin" ? "Copiado" : "Copiar"}
        </button>
      </div>
      <small>Para firmar cancelaciones, descuentos y retiros de caja.</small>
    </div>

    <!--
      Lo importante que hay que decir aquí, y que se agradece meses después: que
      se pueden cambiar. Si no, la persona asume que carga con esto para siempre.
    -->
    <p class="nota">
      Las dos se cambian cuando quiera desde el menú de usuario. Guárdelas donde
      guarda las llaves del local, no en un papel pegado a la pantalla.
    </p>

    <label class="confirmar">
      <input type="checkbox" bind:checked={confirmado} />
      <span>Ya las anoté en un lugar seguro</span>
    </label>

    <button
      class="listo"
      disabled={!confirmado}
      onclick={() => sesion.confirmarCredencialesAnotadas()}
    >
      Entrar a MotRest
    </button>
  </div>
</div>

<style>
  /* Por encima de todo lo demás: no hay nada que hacer antes que esto. */
  .fondo {
    position: fixed;
    z-index: 8000;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--negro);
    overflow-y: auto;
  }
  .tarjeta {
    position: relative;
    width: min(30rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.8rem 1.6rem 1.5rem;
    box-shadow: var(--sombra-lg);
    overflow: hidden;
  }
  .cinta {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--acento) 0%, var(--peligro) 100%);
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    margin: 0.2rem 0 0.3rem;
    color: var(--pizarra);
  }
  .sub {
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--pizarra);
    margin: 0 0 1.3rem;
  }
  .clave {
    margin-bottom: 1.1rem;
  }
  .etiqueta {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.3rem;
  }
  .valor {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
  }
  code {
    flex: 1;
    /* Monoespaciada y grande: esto se copia a mano en un papel. */
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 1.4rem;
    letter-spacing: 0.08em;
    padding: 0.6rem 0.8rem;
    background: var(--fondo);
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    color: var(--pizarra);
    user-select: all;
  }
  .valor button {
    flex: none;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  small {
    display: block;
    font-size: 0.75rem;
    color: var(--gris);
    margin-top: 0.25rem;
  }
  .nota {
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.6rem 0.75rem;
    margin: 1.2rem 0;
  }
  .confirmar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
    color: var(--pizarra);
    margin-bottom: 0.9rem;
    cursor: pointer;
  }
  .listo {
    width: 100%;
    font: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    min-height: 3rem;
    border: none;
    border-radius: var(--r-sm);
    background: var(--acento);
    color: var(--blanco);
    cursor: pointer;
  }
  .listo:disabled {
    background: var(--borde);
    color: var(--gris);
    cursor: not-allowed;
  }
</style>
