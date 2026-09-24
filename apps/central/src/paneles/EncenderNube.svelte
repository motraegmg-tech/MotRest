<script lang="ts">
  /**
   * «Encender Local en la Nube» (pedido de Gonzalo, 24-sep-2026).
   *
   * A un restaurante que ya trabaja con su computadora se le abre la entrada por
   * la web, sin mover sus datos: la caja sigue siendo la dueña de todo y la web
   * ve en vivo lo que pasa en ella. Aquí se elige la clave, se escribe la
   * contraseña y Central hace el resto (acceso, llave del túnel a la caja y
   * licencia reemitida con el mismo vencimiento).
   *
   * Al terminar se enseñan la dirección, la clave y la contraseña para
   * mandárselas al cliente. La contraseña se sigue pudiendo ver después en
   * «Editar datos → Acceso por internet».
   */
  import { untrack } from "svelte";
  import { central } from "../lib/central.svelte";
  import { contrasenaWebAceptable, generarContrasenaWeb, normalizarClaveRestaurante, type ClienteMotRest } from "@motrest/dominio";

  const { cliente, onCerrar }: { cliente: ClienteMotRest; onCerrar: () => void } = $props();

  const inicial = untrack(() => cliente);
  let clave = $state(inicial.clave_web ?? central.proponerClave(inicial.id));
  let contrasena = $state("");
  let repetida = $state("");
  let ver = $state(false);
  let trabajando = $state(false);
  let error = $state("");
  let resultado = $state<{ clave: string; contrasena: string; avisos: string[] } | null>(null);
  let copiado = $state("");

  const web = $derived(central.secretos.web_url ?? "");
  const avisoContrasena = $derived.by(() => {
    if (!contrasena) return "";
    const r = contrasenaWebAceptable(contrasena);
    if (!r.ok) return r.error;
    if (repetida && repetida !== contrasena) return "Las dos no coinciden";
    return "";
  });
  const listo = $derived(
    !trabajando &&
      normalizarClaveRestaurante(clave).length >= 3 &&
      contrasena.length > 0 &&
      contrasena === repetida &&
      !avisoContrasena,
  );

  function generar() {
    contrasena = generarContrasenaWeb();
    repetida = contrasena;
    ver = true;
  }

  async function encender(evento: Event) {
    evento.preventDefault();
    if (!listo) return;
    error = "";
    trabajando = true;
    try {
      const r = await central.encenderLocalEnLaNube(inicial.id, { clave, contrasena });
      if (!r.ok) {
        error = r.error;
        return;
      }
      resultado = { clave: r.clave, contrasena: r.contrasena, avisos: r.avisos };
    } finally {
      trabajando = false;
    }
  }

  async function copiar(texto: string, que: string) {
    try {
      await navigator.clipboard.writeText(texto);
      copiado = que;
      setTimeout(() => (copiado = ""), 1500);
    } catch {
      error = "No se pudo copiar; selecciónalo y cópialo a mano.";
    }
  }

  const mensajeParaCliente = $derived(
    resultado
      ? `Tu restaurante ya se puede usar desde internet.\n\nEntra en: ${web || "(la dirección de MotRest en la web)"}\nClave del restaurante: ${resultado.clave}\nContraseña: ${resultado.contrasena}\n\nDespués eliges quién eres con tu PIN de siempre. La computadora de la caja tiene que estar encendida y con internet.`
      : "",
  );
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="nube-titulo">
  {#if !resultado}
    <form class="tarjeta" onsubmit={encender}>
      <h2 id="nube-titulo">Encender Local en la Nube</h2>
      <p class="explica">
        <b>{inicial.nombre}</b> seguirá trabajando igual con su computadora, y además se podrá entrar desde
        cualquier navegador —iPad, iPhone, la casa del dueño— con una clave y una contraseña. Lo que se haga
        en la web llega a la caja y lo de la caja se ve en la web, en vivo.
      </p>

      <label>
        Clave del restaurante
        <span class="fila">
          <input
            bind:value={clave}
            oninput={() => (clave = clave.toUpperCase())}
            maxlength="20"
            spellcheck="false"
            autocomplete="off"
            required
          />
          <button type="button" onclick={() => (clave = central.proponerClave(inicial.id))}>Sugerir</button>
        </span>
        <small>La teclea el restaurante en «Entra a tu restaurante». Mayúsculas, números o guiones.</small>
      </label>

      <label>
        Contraseña
        <span class="fila">
          <input
            type={ver ? "text" : "password"}
            bind:value={contrasena}
            placeholder="Al menos 10 caracteres"
            autocomplete="new-password"
          />
          <button type="button" onclick={generar}>Generar una</button>
        </span>
      </label>
      <label>
        Repítela
        <span class="fila">
          <input type={ver ? "text" : "password"} bind:value={repetida} autocomplete="new-password" />
          <button type="button" onclick={() => (ver = !ver)}>{ver ? "Ocultar" : "Ver"}</button>
        </span>
        {#if avisoContrasena}<small class="aviso-campo">{avisoContrasena}</small>{/if}
      </label>

      <p class="nota">
        Al encenderla se vuelve a emitir su licencia <b>con el mismo vencimiento</b> y le llega sola a la caja.
        La caja necesita MotRest <b>1.6.0</b> o posterior.
      </p>

      {#if error}<p class="error">{error}</p>{/if}

      <div class="botones">
        <button type="button" class="cancelar" onclick={onCerrar} disabled={trabajando}>Cancelar</button>
        <button type="submit" class="primario" disabled={!listo}>
          {trabajando ? "Encendiendo…" : "Encender en la nube"}
        </button>
      </div>
    </form>
  {:else}
    <div class="tarjeta">
      <h2 id="nube-titulo">Local en la nube encendido</h2>
      <p class="explica">Mándale esto al restaurante:</p>

      <dl class="datos">
        <dt>Dirección</dt>
        <dd>{web || "Falta ponerla en Llaves → «MotRest en la web»"}</dd>
        <dt>Clave</dt>
        <dd><code>{resultado.clave}</code></dd>
        <dt>Contraseña</dt>
        <dd><code>{resultado.contrasena}</code></dd>
      </dl>

      <button type="button" class="primario" onclick={() => copiar(mensajeParaCliente, "mensaje")}>
        {copiado === "mensaje" ? "Copiado" : "Copiar mensaje para el cliente"}
      </button>

      {#each resultado.avisos as aviso (aviso)}<p class="aviso">{aviso}</p>{/each}
      {#if error}<p class="error">{error}</p>{/if}

      <div class="botones">
        <button type="button" class="primario" onclick={onCerrar}>Listo</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .fondo {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    /* Centra el `margin: auto` de la tarjeta: si no cabe, empieza arriba en vez de cortarse. */
    align-items: flex-start;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(20, 24, 26, 0.5);
    overflow-y: auto;
  }
  .tarjeta {
    margin: auto 0;
    width: min(30rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.5rem;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    margin: 0;
    color: var(--pizarra);
  }
  .explica {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--pizarra);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .fila {
    display: flex;
    gap: 0.4rem;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.9rem;
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
  .aviso-campo {
    color: var(--peligro);
  }
  .nota,
  .aviso {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--fondo);
    border-left: 3px solid var(--acento-2);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
  }
  .error {
    margin: 0;
    font-size: 0.82rem;
    color: var(--peligro);
  }
  .datos {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 0.8rem;
    margin: 0;
    font-size: 0.88rem;
  }
  .datos dt {
    color: var(--gris);
  }
  .datos dd {
    margin: 0;
    color: var(--pizarra);
    word-break: break-all;
  }
  .datos code {
    font-size: 0.95rem;
    user-select: all;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.3rem;
  }
  button {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.5rem 0.9rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
    white-space: nowrap;
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
  }
  .cancelar {
    border: none;
    color: var(--gris);
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
