<script lang="ts">
  /**
   * Los secretos de MOTRAE y el acceso de soporte.
   *
   * ES LA PANTALLA MÁS DELICADA DEL PROYECTO ENTERO. Aquí viven las llaves con
   * las que se firman las licencias y las actualizaciones de todos los
   * restaurantes. Quien las tenga puede emitirse licencias gratis y —mucho
   * peor— publicar una actualización que se instala sola en cada local.
   *
   * Por eso:
   *   - Los campos van enmascarados y solo se enseñan a petición.
   *   - Nunca se escriben en el repositorio. Se capturan aquí, una vez.
   *   - La contraseña de soporte se guarda SOLO como hash. Ni esta máquina la
   *     tiene en claro; si se olvida, se pone otra y se reemiten las licencias.
   */
  import { central } from "../lib/central.svelte";

  let licencias = $state(central.secretos.licencias);
  let publicacion = $state(central.secretos.publicacion);
  let repositorio = $state(central.secretos.repositorio);
  let verSecretos = $state(false);
  let guardado = $state("");

  let contrasena = $state("");
  let repetida = $state("");
  let avisoSoporte = $state("");
  let errorSoporte = $state("");

  const tieneSoporte = $derived(central.secretos.soporte !== undefined);

  function guardar() {
    central.guardarSecretos({ licencias, publicacion, repositorio });
    guardado = "Guardado en esta máquina.";
    setTimeout(() => (guardado = ""), 4000);
  }

  /** Genera un secreto largo al azar, para quien no tiene uno todavía. */
  function generar(cual: "licencias" | "publicacion") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const texto = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (cual === "licencias") licencias = texto;
    else publicacion = texto;
    verSecretos = true;
  }

  async function fijarSoporte() {
    errorSoporte = "";
    avisoSoporte = "";

    if (contrasena !== repetida) {
      errorSoporte = "Las dos contraseñas no coinciden";
      return;
    }

    const r = await central.fijarContrasenaSoporte(contrasena);
    if (!r.ok) {
      errorSoporte = r.error ?? "No se pudo guardar";
      return;
    }

    contrasena = "";
    repetida = "";
    avisoSoporte =
      "Contraseña guardada. Reemita las licencias de los locales para que el acceso llegue a cada uno.";
  }
</script>

<section>
  <h1>Llaves</h1>

  <!--
    El aviso va arriba y no al final. Quien llega aquí necesita entender el peso
    de esta máquina ANTES de pegar nada, no después.
  -->
  <div class="alerta">
    <b>Esta computadora vale más que cualquier otra de MOTRAE.</b>
    Con estas llaves se firman las licencias y las actualizaciones de todos los
    restaurantes. Guarde una copia en un gestor de contraseñas: si se pierden, no
    se puede volver a firmar nada y hay que reinstalar todos los locales.
  </div>

  <h2>Secretos de firma</h2>

  <label>
    Firma de licencias
    <div class="campo">
      <input
        type={verSecretos ? "text" : "password"}
        bind:value={licencias}
        spellcheck="false"
        placeholder="Pegue el secreto, o genere uno"
      />
      <button onclick={() => generar("licencias")}>Generar</button>
    </div>
    <small>Es lo que hace que una licencia valga en un Hub. Nunca cambiarlo sin reemitir todas.</small>
  </label>

  <label>
    Firma de publicación
    <div class="campo">
      <input
        type={verSecretos ? "text" : "password"}
        bind:value={publicacion}
        spellcheck="false"
        placeholder="Pegue el secreto, o genere uno"
      />
      <button onclick={() => generar("publicacion")}>Generar</button>
    </div>
    <small>
      Con esto se firman las actualizaciones. Tiene que ser <b>distinto</b> del de
      licencias: si se filtrara uno, el otro sigue protegiendo lo suyo.
    </small>
  </label>

  <label>
    Repositorio de GitHub
    <input bind:value={repositorio} spellcheck="false" placeholder="motrae/motrest" />
    <small>De donde los Hubs bajan las versiones.</small>
  </label>

  <div class="acciones">
    <label class="ver">
      <input type="checkbox" bind:checked={verSecretos} />
      <span>Mostrar los secretos</span>
    </label>
    <button class="primario" onclick={guardar}>Guardar</button>
    {#if guardado}<span class="ok">{guardado}</span>{/if}
  </div>

  <h2>Mi acceso a los restaurantes</h2>

  <p class="explica">
    El usuario <b>Gonz Motrae</b> existe en todas las instalaciones y no aparece
    en ninguna lista del restaurante. Sirve para entrar a resolver un problema sin
    pedirle a nadie su contraseña, y es el único que puede entrar a un local
    bloqueado por falta de pago.
  </p>

  <p class="explica">
    Todo lo que haga queda en la <b>bitácora del restaurante</b> con su nombre, y
    esa bitácora solo agrega: ni desde aquí se pueden borrar sus pasos. Es lo que
    separa un acceso de mantenimiento de una puerta trasera, y va declarado en el
    contrato del cliente.
  </p>

  {#if tieneSoporte}
    <p class="estado-ok">Ya hay una contraseña de soporte configurada.</p>
  {:else}
    <p class="estado-falta">
      Todavía no hay contraseña de soporte. Las licencias que emita ahora saldrán
      sin acceso de MOTRAE.
    </p>
  {/if}

  <div class="dos">
    <label>
      Contraseña
      <input type="password" bind:value={contrasena} placeholder="Mínimo 12 caracteres" />
    </label>
    <label>
      Repetirla
      <input type="password" bind:value={repetida} />
    </label>
  </div>

  {#if errorSoporte}<p class="error">{errorSoporte}</p>{/if}
  {#if avisoSoporte}<p class="ok bloque">{avisoSoporte}</p>{/if}

  <button class="primario" onclick={fijarSoporte}>
    {tieneSoporte ? "Cambiar contraseña" : "Fijar contraseña"}
  </button>

  <small class="pie">
    Se guarda solo el hash (PBKDF2, 600 000 iteraciones). Ni esta máquina conserva
    la contraseña: si se olvida, se pone otra y se reemiten las licencias.
  </small>

  <h2>Respaldo de la cartera</h2>
  <p class="explica">
    Descarga los restaurantes y sus pulsos. <b>No incluye los secretos</b> a
    propósito: este archivo se manda por correo sin pensarlo, y no debe llevar
    dentro la llave que firma las actualizaciones.
  </p>
  <button
    onclick={() => {
      const url = URL.createObjectURL(new Blob([central.exportar()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `motrae-cartera-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }}
  >
    Descargar respaldo
  </button>
</section>

<style>
  section {
    padding: 1.5rem 1.75rem 3rem;
    max-width: 42rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    margin: 0 0 1.1rem;
    color: var(--pizarra);
  }
  h2 {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 2rem 0 0.8rem;
  }
  .alerta {
    background: #fdeae8;
    border: 1.5px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
    font-size: 0.84rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .alerta b {
    display: block;
    color: var(--peligro);
    margin-bottom: 0.2rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    margin-bottom: 0.9rem;
  }
  .campo {
    display: flex;
    gap: 0.4rem;
  }
  .campo input {
    flex: 1;
    min-width: 0;
  }
  input {
    font: inherit;
    font-size: 0.88rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  input:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  small {
    font-size: 0.73rem;
    font-weight: 400;
    line-height: 1.5;
    color: var(--gris);
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .acciones {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }
  .ver {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--gris);
    margin: 0;
    cursor: pointer;
  }
  .ver input {
    width: auto;
  }
  button {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  button:hover {
    border-color: var(--acento);
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
    align-self: flex-start;
  }
  .explica {
    font-size: 0.85rem;
    line-height: 1.65;
    color: var(--pizarra);
    margin: 0 0 0.8rem;
  }
  .estado-ok,
  .estado-falta {
    font-size: 0.82rem;
    border-radius: var(--r-sm);
    padding: 0.5rem 0.7rem;
    margin: 0 0 0.9rem;
  }
  .estado-ok {
    background: #eaf6f0;
    color: #1e6b4a;
  }
  .estado-falta {
    background: var(--claro);
    color: var(--pizarra);
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
    margin: 0 0 0.6rem;
  }
  .ok {
    font-size: 0.8rem;
    color: #1e6b4a;
  }
  .ok.bloque {
    margin: 0 0 0.7rem;
    line-height: 1.5;
  }
  .pie {
    display: block;
    margin-top: 0.7rem;
  }
</style>
