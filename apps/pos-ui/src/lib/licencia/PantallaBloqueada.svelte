<script lang="ts">
  /**
   * La pantalla que queda cuando se acaban los tres días de gracia.
   *
   * El software queda inservible: solo esto. Es lo que decidió Gonzalo y es lo
   * que hace que la mensualidad se cobre.
   *
   * TRES DECISIONES DE DISEÑO, Y NINGUNA ES DECORATIVA:
   *
   *   1. **No hay botón de cerrar ni forma de esquivarla.** Cubre la pantalla
   *      entera. Una pantalla de bloqueo con una salida no bloquea nada.
   *
   *   2. **Dice que su información está intacta.** El primer miedo de un
   *      restaurantero al ver esto es "perdí mis ventas". Es falso —no se borra
   *      nada— y callarlo convierte un problema de cobranza en pánico y en una
   *      llamada furiosa. Decirlo cuesta una línea.
   *
   *   3. **Trae el teléfono para pagar, no un correo de soporte.** Lo que el
   *      restaurante necesita en este momento es reactivarse, y cada paso que se
   *      interpone entre el bloqueo y el pago es un día más sin cobrar.
   */
  import { licencia } from "../licencia.svelte";

  const { contacto = "" }: { contacto?: string } = $props();
  let identificador = $state("");
  let textoLicencia = $state("");
  let instalando = $state(false);
  let error = $state("");

  /**
   * ¿Es un equipo recién instalado, o un local que dejó de pagar?
   *
   * No son la misma pantalla ni de lejos. Al restaurante que se instala hoy
   * decirle «servicio suspendido» lo asusta sin motivo; al que debe, hablarle de
   * un alta le da una excusa. El Hub sabe cuál es cada uno —si su identidad
   * todavía es provisional, nadie le ha asignado restaurante— y aquí solo se
   * pinta lo que corresponde.
   */
  let sinAsignar = $state(false);

  $effect(() => {
    void cargarIdentificador();
  });

  async function cargarIdentificador() {
    try {
      const respuesta = await fetch("/licencia", { signal: AbortSignal.timeout(2500) });
      if (!respuesta.ok) return;
      const datos = (await respuesta.json()) as {
        sucursal_id?: unknown;
        sin_asignar?: unknown;
      };
      if (typeof datos.sucursal_id === "string") identificador = datos.sucursal_id;
      sinAsignar = datos.sin_asignar === true;
    } catch {
      // El mensaje principal ya explica que la caja necesita reactivarse.
    }
  }

  async function instalarLicencia(evento: SubmitEvent) {
    evento.preventDefault();
    error = "";
    const licenciaJson = textoLicencia.trim();
    if (!licenciaJson) {
      error = "Pegue la licencia emitida desde MotRest Central.";
      return;
    }

    instalando = true;
    try {
      const respuesta = await fetch("/licencia", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: licenciaJson,
      });
      const datos = (await respuesta.json()) as { ok?: boolean; error?: unknown };
      if (!respuesta.ok || !datos.ok) {
        error = typeof datos.error === "string" ? datos.error : "No se pudo instalar la licencia.";
        return;
      }
      location.reload();
    } catch {
      error = "No se pudo comunicar con el Hub local. Reintente en unos segundos.";
    } finally {
      instalando = false;
    }
  }
</script>

<div class="bloqueo" role="alertdialog" aria-modal="true" aria-labelledby="bloqueo-titulo">
  <div class="marca" aria-hidden="true">
    <span class="logo">MOTRAE</span>
    <span class="barra"></span>
  </div>

  {#if sinAsignar}
    <h1 id="bloqueo-titulo">Active su MotRest</h1>
    <p class="motivo">
      Este equipo todavía no está asignado a ningún restaurante. Pegue abajo la
      licencia que MOTRAE emitió para el suyo y quedará listo para trabajar.
    </p>
  {:else}
    <h1 id="bloqueo-titulo">Servicio suspendido</h1>
    <p class="motivo">{licencia.situacion.mensaje}</p>

    <!--
      Lo que más tranquiliza y lo que menos cuesta decir. Sin esta línea, el
      restaurantero asume que perdió su historial.
    -->
    <p class="datos">
      Toda la información de su restaurante está guardada. En cuanto se registre el
      pago, el sistema vuelve exactamente como lo dejó.
    </p>
  {/if}

  {#if contacto}
    <p class="contacto">
      {sinAsignar ? "Si no tiene su licencia:" : "Para reactivarlo:"} <b>{contacto}</b>
    </p>
  {/if}

  <div class="alta">
    <!--
      El código solo se pide cuando hace falta.

      Un equipo sin asignar no necesita registrar nada: la propia licencia le
      dice qué restaurante es. Enseñarle un identificador provisional que nadie
      va a teclear en Central solo sirve para que alguien lo copie mal.
    -->
    {#if !sinAsignar}
      <p>
        Código de instalación:
        <code>{identificador || "Cargando…"}</code>
      </p>
      <small>Registre este código en MotRest Central; después pegue aquí la licencia emitida.</small>
    {:else}
      <small>
        Dé de alta el restaurante en MotRest Central, descargue su
        <code>licencia.json</code> y pegue aquí su contenido.
      </small>
    {/if}
    <form onsubmit={instalarLicencia}>
      <label for="licencia">Licencia de MOTRAE</label>
      <textarea
        id="licencia"
        bind:value={textoLicencia}
        rows="4"
        spellcheck="false"
        placeholder="Pegue aquí el contenido de licencia.json"
      ></textarea>
      <button type="submit" disabled={instalando}>
        {instalando ? "Activando…" : "Activar licencia"}
      </button>
    </form>
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  <p class="pie">MotRest · una plataforma de MOTRAE</p>
</div>

<style>
  /*
   * z-index por encima de todo lo demás de la aplicación (el máximo que se usa
   * en App.svelte es 70, el aviso del reloj). Si algo quedara por encima, sería
   * una rendija por la que se puede seguir operando.
   */
  .bloqueo {
    position: fixed;
    z-index: 9000;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 2rem;
    text-align: center;
    background: var(--negro);
    color: #dfe5e2;
    font-family: var(--font-cuerpo);
  }
  .marca {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 1.6rem;
  }
  .logo {
    font-family: var(--font-titulo);
    font-size: clamp(2.4rem, 8vw, 3.6rem);
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #fff;
  }
  /* El degradado de energía de la marca, en su única aparición de la pantalla. */
  .barra {
    width: clamp(7rem, 22vw, 11rem);
    height: 5px;
    border-radius: var(--r-pill);
    background: linear-gradient(90deg, var(--acento) 0%, var(--peligro) 100%);
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: clamp(1.3rem, 4vw, 1.7rem);
    font-weight: 600;
    color: #fff;
    margin: 0;
  }
  .motivo {
    max-width: 30rem;
    font-size: 0.98rem;
    line-height: 1.6;
    margin: 0;
  }
  .datos {
    max-width: 27rem;
    font-size: 0.86rem;
    line-height: 1.6;
    color: #97a3a9;
    margin: 0.4rem 0 0;
  }
  .contacto {
    margin: 1.4rem 0 0;
    font-size: 0.95rem;
    padding: 0.6rem 1.3rem;
    border: 1.5px solid #2f3a3e;
    border-radius: var(--r-pill);
  }
  .contacto b {
    color: var(--acento);
  }
  .alta {
    width: min(100%, 31rem);
    margin-top: 0.6rem;
    padding: 0.9rem;
    border: 1px solid #2f3a3e;
    border-radius: var(--r-md);
    text-align: left;
  }
  .alta > p {
    margin: 0;
    font-size: 0.82rem;
  }
  .alta code {
    margin-left: 0.3rem;
    color: var(--acento);
    font-weight: 700;
  }
  .alta small {
    display: block;
    margin: 0.3rem 0 0.65rem;
    color: #97a3a9;
    font-size: 0.76rem;
    line-height: 1.45;
  }
  .alta form {
    display: grid;
    gap: 0.35rem;
  }
  .alta label {
    font-size: 0.78rem;
    font-weight: 700;
  }
  .alta textarea {
    resize: vertical;
    min-height: 4.8rem;
    border: 1px solid #3b474c;
    border-radius: var(--r-sm);
    padding: 0.5rem;
    background: #182024;
    color: #dfe5e2;
    font: 0.72rem/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  .alta button {
    justify-self: end;
    padding: 0.45rem 0.8rem;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--acento);
    color: var(--negro);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .alta button:disabled {
    cursor: wait;
    opacity: 0.7;
  }
  .error {
    margin: 0.6rem 0 0;
    color: #ff9b94;
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .pie {
    position: absolute;
    bottom: 1.6rem;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: #55636a;
    margin: 0;
  }
</style>
