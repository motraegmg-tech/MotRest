<script lang="ts">
  /**
   * «Entra a tu restaurante» (MotRest en la web, 1.6.0).
   *
   * Es la pantalla de acceso de siempre —el logo a la izquierda, lo que se
   * teclea a la derecha—, un paso antes: primero el restaurante, después
   * «¿Quién eres?». Gonzalo la pidió así, y eligió la instrucción en vez de la
   * pregunta («¿Qué restaurante eres?») porque deja claro qué hacer con los
   * dos campos.
   *
   * NUNCA SE LISTAN RESTAURANTES. Ni con la clave a medias, ni en un error. El
   * mensaje de fallo es siempre el mismo, exista la clave o no: decir «esa clave
   * no existe» le enseñaría a quien prueba qué restaurantes usan MotRest.
   */
  import { accesoWeb } from "../web/acceso-web.svelte";
  import { contextoSeguro, explicacionContextoInseguro } from "../entorno";
  import logoMotRest from "../../assets/motrest-logo-claro.png";

  let clave = $state(accesoWeb.ultimaClave);
  let contrasena = $state("");
  let verContrasena = $state(false);

  const entrando = $derived(accesoWeb.estado === "entrando");
  const listo = $derived(clave.trim().length >= 3 && contrasena.length > 0 && !entrando);

  async function entrar(evento: Event) {
    evento.preventDefault();
    if (!listo) return;
    if (!contextoSeguro()) {
      accesoWeb.error = explicacionContextoInseguro();
      return;
    }
    await accesoWeb.entrar(clave.trim().toUpperCase(), contrasena);
    // Si entró, la página se recarga. Si no, se borra lo tecleado: el error dice qué pasó.
    contrasena = "";
  }
</script>

<div class="velo"></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Entra a tu restaurante">
  <div class="lado-marca">
    <img class="logo" src={logoMotRest} alt="MotRest · Software para restaurantes" />
  </div>

  <form class="lado-acceso" onsubmit={entrar}>
    <h2>Entra a tu restaurante</h2>

    <label class="campo">
      <span>Clave del restaurante</span>
      <input
        class="clave"
        bind:value={clave}
        oninput={() => (clave = clave.toUpperCase())}
        placeholder="Ej. RODIZIO"
        autocomplete="username"
        autocapitalize="characters"
        spellcheck="false"
        maxlength="20"
      />
    </label>

    <label class="campo">
      <span>Contraseña</span>
      <span class="con-ojo">
        <input
          class="clave"
          type={verContrasena ? "text" : "password"}
          bind:value={contrasena}
          placeholder="Contraseña"
          autocomplete="current-password"
          autocapitalize="off"
          spellcheck="false"
        />
        <button
          type="button"
          class="ojo"
          aria-label={verContrasena ? "Ocultar la contraseña" : "Mostrar la contraseña"}
          onclick={() => (verContrasena = !verContrasena)}
        >
          {verContrasena ? "Ocultar" : "Ver"}
        </button>
      </span>
    </label>

    {#if accesoWeb.error}
      <p class="error" role="alert">{accesoWeb.error}</p>
    {/if}

    <button class="entrar" type="submit" disabled={!listo}>
      {entrando ? "Entrando…" : "Entrar"}
    </button>

    <p class="pista">
      La clave y la contraseña te las da MOTRAE. Después elegirás quién eres, con tu PIN de siempre.
    </p>
  </form>
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
    align-items: center;
    justify-content: center;
    gap: clamp(2rem, 8vw, 7rem);
    padding: 2rem clamp(1rem, 6vw, 5rem);
    overflow-y: auto;
    color: #fff;
  }
  .lado-marca {
    flex: 0 1 26rem;
    display: flex;
    justify-content: center;
  }
  .logo {
    width: 100%;
    max-width: 24rem;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  .lado-acceso {
    flex: 0 1 24rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    min-width: 0;
  }
  @media (max-width: 899px), (max-height: 620px) {
    .panel {
      flex-direction: column;
      /* En columna se arranca por arriba: centrado, el teclado del teléfono
         taparía los campos y no habría cómo llegar a ellos. */
      justify-content: flex-start;
      gap: 1.25rem;
    }
    .lado-marca {
      flex: none;
    }
    /*
     * En columna la base de 24rem se aplicaba al ALTO, y el ancho quedaba al
     * del contenido: los campos se salían por la derecha en un teléfono.
     */
    .lado-acceso {
      flex: none;
      width: 100%;
      max-width: 22rem;
    }
    .logo {
      max-width: min(11rem, 40vw);
    }
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
    margin-bottom: 0.3rem;
  }
  .campo {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: min(20rem, 100%);
  }
  .campo > span:first-child {
    font-size: 0.85rem;
    color: #b9c2bc;
  }
  .clave {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.85rem 1rem;
    border-radius: var(--r-md);
    border: 1.5px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 1rem;
    font-family: var(--font-cuerpo);
  }
  .clave:focus {
    outline: none;
    border-color: var(--acento);
  }
  .clave::placeholder {
    color: #8a969c;
  }
  .con-ojo {
    position: relative;
    display: flex;
  }
  .con-ojo .clave {
    padding-right: 5rem;
  }
  .ojo {
    position: absolute;
    right: 0.4rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    color: #b9c2bc;
    font-size: 0.8rem;
    padding: 0.4rem 0.6rem;
  }
  .entrar {
    width: min(20rem, 100%);
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.85rem;
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 600;
    margin-top: 0.3rem;
  }
  .entrar:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    width: min(20rem, 100%);
    color: #ffb4a8;
    font-size: 0.88rem;
    line-height: 1.45;
    text-align: center;
  }
  .pista {
    width: min(20rem, 100%);
    font-size: 0.8rem;
    color: #8a969c;
    line-height: 1.5;
    text-align: center;
  }
</style>
