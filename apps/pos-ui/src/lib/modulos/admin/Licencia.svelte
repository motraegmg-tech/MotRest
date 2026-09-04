<script lang="ts">
  /**
   * Pegar una licencia en un local que funciona con normalidad.
   *
   * POR QUÉ HACÍA FALTA. El único sitio donde se podía pegar una licencia era la
   * pantalla de «Servicio suspendido», y esa solo aparece con el local ya
   * bloqueado. Un restaurante sano al que hay que cambiarle la licencia —porque
   * se reemitió con datos nuevos, no porque haya vencido— no tenía por dónde: la
   * única salida era editar `licencia.json` a mano en el disco, y ahí el Bloc de
   * notas mete su marca de bytes y deja el archivo ilegible para el Hub.
   *
   * SOLO PARA LA CUENTA DE MOTRAE, y esa es la decisión importante.
   *
   * Cambiar la licencia de un local es lo que decide hasta cuándo abre y con qué
   * credenciales habla con MOTRAE. No es una tarea de restaurante: el propietario
   * no debe verla siquiera, porque un panel que no se puede usar solo invita a
   * pedir que alguien lo use. Se oculta, no se deshabilita.
   *
   * El Hub NO se fía de esto. `POST /licencia` verifica la firma Ed25519 contra
   * la pública compilada y comprueba que sea de ESTE local antes de escribir
   * nada. Esconder el panel es comodidad; la seguridad está del otro lado.
   */
  import { esSoporte } from "@motrest/dominio";
  import { sesion } from "../../sesion/sesion.svelte";
  import { licencia } from "../../licencia.svelte";

  let texto = $state("");
  let enviando = $state(false);
  let error = $state("");
  let hecho = $state("");

  const soyMotrae = $derived(esSoporte(sesion.usuarioActual));

  /** Lo que se ve del documento pegado, antes de mandarlo. */
  const previa = $derived.by(() => {
    const limpio = texto.trim();
    if (!limpio) return null;
    try {
      const j = JSON.parse(limpio) as Record<string, unknown>;
      const d = (j.licencia ?? j) as Record<string, unknown>;
      const nube = d.nube as { url?: string; clave?: string } | undefined;
      return {
        sucursal: String(d.sucursal_id ?? "—"),
        nombre: String(d.nombre ?? "—"),
        vence: typeof d.vence_ts === "number" ? new Date(d.vence_ts).toLocaleDateString("es-MX") : "—",
        nube: nube?.url ?? "",
        credencial: Boolean(nube?.clave),
      };
    } catch {
      return { invalida: true } as const;
    }
  });

  async function instalar(evento: SubmitEvent) {
    evento.preventDefault();
    error = "";
    hecho = "";

    /*
     * `.trim()` quita también la marca de bytes del Bloc de notas: en
     * JavaScript el U+FEFF cuenta como espacio en blanco. Es el mismo carácter
     * invisible que dejó un local sin licencia la primera vez que se pegó una a
     * mano, y aquí se limpia antes de salir.
     */
    const limpio = texto.trim();
    if (!limpio) {
      error = "Pegue la licencia emitida desde MotRest Central.";
      return;
    }

    enviando = true;
    try {
      const respuesta = await fetch("/licencia", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: limpio,
      });
      const datos = (await respuesta.json()) as { ok?: boolean; error?: unknown };
      if (!respuesta.ok || !datos.ok) {
        error = typeof datos.error === "string" ? datos.error : "No se pudo instalar la licencia.";
        return;
      }
      /*
       * No hace falta refrescar nada: el Hub difunde el veredicto nuevo a
       * todas las terminales en cuanto lo escribe, así que el estado de arriba
       * se actualiza solo. Pedirlo aquí sería preguntar por algo que ya viene.
       */
      hecho = "Licencia instalada. El local ya la está usando.";
      texto = "";
    } catch (causa) {
      error = `No se pudo hablar con el Hub del local: ${String(causa)}`;
    } finally {
      enviando = false;
    }
  }
</script>

{#if !soyMotrae}
  <!--
    No debería llegarse aquí: la sección no aparece en el menú para nadie más.
    Se comprueba igualmente porque una ruta se puede teclear a mano.
  -->
  <section class="vacio">
    <h1>Licencia</h1>
    <p>Esta sección es del soporte de MOTRAE. Si necesita renovar, escríbanos.</p>
  </section>
{:else}
  <section>
    <h1>Licencia del local</h1>
    <p class="nota">
      Pegue aquí el <code>licencia.json</code> que emitió MotRest Central. Sirve
      para reemitir con datos nuevos sin esperar a que el local se bloquee ni
      tocar archivos en el disco.
    </p>

    <div class="ficha">
      <span><b>{licencia.licencia?.nombre ?? "sin licencia todavía"}</b></span>
      <span>{licencia.situacion.mensaje}</span>
    </div>

    <form onsubmit={instalar}>
      <label for="licencia-nueva">Licencia nueva</label>
      <textarea
        id="licencia-nueva"
        bind:value={texto}
        rows="10"
        spellcheck="false"
        placeholder="Pegue aquí el contenido de licencia.json"
      ></textarea>

      {#if previa && "invalida" in previa}
        <p class="error">Eso no es un JSON válido. Vuelva a copiarlo desde Central.</p>
      {:else if previa}
        <!--
          Se enseña ANTES de instalar, y sobre todo si trae el enlace con la
          nube. Una licencia sin ese bloque es válida, se instala sin quejarse, y
          deja al local sin reportar su pulso ni recibir renovaciones — un fallo
          que no se nota hasta que alguien mira el panel y ve «nunca reportó».
        -->
        <div class="previa">
          <div><span>Restaurante</span><b>{previa.nombre}</b></div>
          <div><span>Sucursal</span><b>{previa.sucursal}</b></div>
          <div><span>Vence</span><b>{previa.vence}</b></div>
          <div>
            <span>Enlace con MOTRAE</span>
            {#if previa.nube && previa.credencial}
              <b class="si">{previa.nube}</b>
            {:else}
              <b class="no">NO LA TRAE — el local no reportará su pulso</b>
            {/if}
          </div>
        </div>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}
      {#if hecho}<p class="hecho">{hecho}</p>{/if}

      <button class="primario" type="submit" disabled={enviando || !texto.trim()}>
        {enviando ? "Instalando…" : "Instalar licencia"}
      </button>
    </form>
  </section>
{/if}

<style>
  section {
    padding: 1.5rem;
    max-width: 44rem;
  }
  h1 {
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 1.35rem;
    margin: 0 0 0.35rem;
  }
  .nota {
    color: var(--gris);
    font-size: 0.85rem;
    line-height: 1.5;
    margin: 0 0 1rem;
  }
  .ficha {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--borde);
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  label {
    display: block;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
  }
  textarea {
    width: 100%;
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 0.75rem;
    padding: 0.6rem;
    border: 1px solid var(--borde);
    border-radius: 8px;
    resize: vertical;
  }
  .previa {
    margin: 0.9rem 0;
    border: 1px solid var(--borde);
    border-radius: 8px;
    overflow: hidden;
  }
  .previa div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.8rem;
    font-size: 0.82rem;
    border-bottom: 1px solid var(--borde);
  }
  .previa div:last-child {
    border-bottom: 0;
  }
  .previa span {
    color: var(--gris);
  }
  .previa b {
    text-align: right;
    word-break: break-all;
  }
  .si {
    color: var(--acento);
  }
  .no {
    color: #e0392b;
  }
  .error {
    color: #e0392b;
    font-size: 0.85rem;
    margin: 0.7rem 0 0;
  }
  .hecho {
    color: var(--acento);
    font-size: 0.85rem;
    margin: 0.7rem 0 0;
  }
  .primario {
    margin-top: 1rem;
    padding: 0.6rem 1.2rem;
    border: 0;
    border-radius: 8px;
    background: var(--acento);
    color: #fff;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .primario:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .vacio {
    color: var(--gris);
  }
</style>
