<script lang="ts">
  /**
   * El primer arranque del restaurante: crear la cuenta del responsable.
   *
   * Es lo primero que ve un local nuevo, antes de cualquier pantalla de acceso.
   * No pide identificarse —todavía no hay nadie que pueda hacerlo— sino crear al
   * dueño del sistema. En cuanto se crea, esa persona queda dentro y con acceso a
   * todo, y desde el siguiente arranque MotRest abre pidiendo el PIN contra la
   * lista de personal.
   *
   * ## Lo que sustituye
   *
   * Antes, aquí se enseñaba una contraseña y un PIN que el software se inventaba,
   * con la instrucción de apuntarlos porque no se volverían a mostrar. Fallaba por
   * lo humano: quien cerraba la pantalla sin apuntar se quedaba fuera de su propio
   * negocio, y la cuenta se seguía llamando «Gonzalo DJA» en un local ajeno. Una
   * clave que el cliente elige es una clave que el cliente recuerda.
   *
   * ## Dos decisiones
   *
   * 1. **No se puede cerrar ni saltar.** No hay aspa ni «más tarde»: un sistema
   *    con la caja, el inventario y las finanzas del negocio no puede quedarse
   *    abierto sin dueño porque alguien pulsó «después».
   *
   * 2. **Si MOTRAE ya mandó el nombre en la licencia, no se vuelve a pedir.** Se
   *    enseña y solo se pide el PIN. Escribirlo otra vez aquí sería mentirle al
   *    usuario: el perfil firmado lo sobrescribiría en el siguiente arranque.
   */
  import { sesion } from "./sesion.svelte";

  /** El responsable que la licencia de MOTRAE ya trajo, si lo trajo. */
  const licenciado = $derived(sesion.responsablePendiente);

  let nombre = $state("");
  let pin = $state("");
  let repetido = $state("");
  let error = $state("");
  let guardando = $state(false);

  const nombreFinal = $derived(licenciado?.nombre ?? nombre);
  const listo = $derived(nombreFinal.trim().length >= 2 && pin.length >= 4 && repetido.length >= 4);

  async function crear() {
    if (guardando || !listo) return;
    error = "";

    if (pin !== repetido) {
      error = "Los dos PIN no coinciden";
      return;
    }

    guardando = true;
    try {
      const r = await sesion.crearResponsableInicial({ nombre: nombreFinal, pin });
      if (!r.ok) error = r.error ?? "No se pudo crear la cuenta";
    } catch (causa) {
      console.error("Fallo al crear la cuenta del responsable", causa);
      error = "No se pudo crear la cuenta en este dispositivo. Revisa la consola del navegador.";
    } finally {
      guardando = false;
      // El PIN no se queda en memoria más de lo necesario.
      if (!error) {
        pin = "";
        repetido = "";
      }
    }
  }
</script>

<div class="fondo" role="alertdialog" aria-modal="true" aria-labelledby="ar-titulo">
  <div class="tarjeta">
    <div class="cinta"></div>

    <div class="marca">MotRest<span>.</span></div>
    <h1 id="ar-titulo">Bienvenido. Vamos a crear su usuario</h1>
    <p class="sub">
      Este restaurante todavía no tiene ninguna cuenta. La primera es la del
      <b>responsable</b>: tendrá acceso a todo el sistema y podrá dar de alta a su
      personal desde <b>Administración → Usuarios</b>.
    </p>

    {#if licenciado}
      <div class="campo">
        <span class="etiqueta">Responsable del restaurante</span>
        <p class="dado">{licenciado.nombre}</p>
        <small>Lo registró MOTRAE al dar de alta este local.</small>
      </div>
    {:else}
      <label class="campo">
        <span class="etiqueta">Nombre del responsable</span>
        <input
          bind:value={nombre}
          placeholder="Nombre y apellido"
          autocomplete="off"
          spellcheck="false"
        />
        <small>Es el nombre con el que aparecerá en la bitácora del negocio.</small>
      </label>
    {/if}

    <label class="campo">
      <span class="etiqueta">Su PIN</span>
      <input
        type="password"
        bind:value={pin}
        inputmode="numeric"
        autocomplete="new-password"
        placeholder="De 4 a 8 dígitos"
      />
    </label>

    <label class="campo">
      <span class="etiqueta">Repítalo</span>
      <input
        type="password"
        bind:value={repetido}
        inputmode="numeric"
        autocomplete="new-password"
        onkeydown={(e) => e.key === "Enter" && crear()}
      />
    </label>

    <!--
      Lo que hay que decir aquí y se agradece meses después: que con este PIN se
      firman las autorizaciones del negocio, y que se puede cambiar.
    -->
    <p class="nota">
      Con este PIN entrará al sistema y firmará lo que necesita permiso del dueño:
      cancelaciones, descuentos y retiros de caja. Puede cambiarlo cuando quiera
      desde el menú de usuario.
    </p>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="listo" disabled={!listo || guardando} onclick={crear}>
      {guardando ? "Creando…" : "Crear mi usuario y entrar"}
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
    /* Opaco: esta pantalla es lo único que hay: detrás no hay aplicación que
       dejar entrever, y un velo translúcido sobre nada se ve como un fallo. */
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
  .marca {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .marca span {
    color: var(--acento);
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    margin: 0.5rem 0 0.3rem;
    color: var(--pizarra);
  }
  .sub {
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--pizarra);
    margin: 0 0 1.3rem;
  }
  .campo {
    display: block;
    margin-bottom: 1rem;
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
  input {
    width: 100%;
    font: inherit;
    font-size: 1.05rem;
    padding: 0.7rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  /* El nombre que vino firmado en la licencia: se lee, no se edita. */
  .dado {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--pizarra);
    padding: 0.7rem 0.85rem;
    background: var(--fondo);
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
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
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
    margin-bottom: 0.9rem;
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
