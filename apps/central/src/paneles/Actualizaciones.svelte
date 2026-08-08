<script lang="ts">
  /**
   * Preparar y publicar una versión.
   *
   * LO QUE ESTA PANTALLA IMPIDE, que es para lo que existe: publicar sin haber
   * mirado. Una actualización se instala sola en TODOS los restaurantes; si sale
   * rota, salen rotos todos a la vez y no hay forma de deshacerlo desde aquí —
   * hay que publicar otra y esperar a que la bajen.
   *
   * De ahí las dos cosas que no son adorno:
   *
   *   1. **La vista previa.** El POS de verdad, embebido, con la versión que se
   *      va a publicar. Verlo cuesta treinta segundos y es lo único que atrapa
   *      "se me quedó un panel en blanco".
   *
   *   2. **La lista de comprobación.** Hasta que no está completa, el botón de
   *      firmar no se enciende. No es burocracia: es la diferencia entre un
   *      despliegue y una apuesta.
   */
  import { central } from "../lib/central.svelte";

  let version = $state("");
  let notas = $state("");
  let url = $state("");
  let sha256 = $state("");
  let obligatoria = $state(false);
  let versionMinima = $state("");
  let manifiesto = $state("");
  let error = $state("");
  let firmando = $state(false);
  let previa = $state("http://localhost:5173/");
  let mostrarPrevia = $state(false);

  /**
   * A cuánta flota se le ofrece esta versión.
   *
   * Vacío = a todos, que es lo que se hacía antes de que existiera el anillo y
   * es exactamente el riesgo que documenta este panel: si sale rota, salen rotos
   * todos a la vez. Con un porcentaje se publica al 10 %, se ve un fin de semana
   * completo y después se sube.
   */
  let anillo = $state("");

  const anilloNumero = $derived(anillo.trim() ? Number(anillo.trim()) : undefined);

  /*
   * Quién entra con este porcentaje, por nombre.
   *
   * El manifiesto NO lleva la lista de sucursales —es un archivo público de
   * GitHub y la cartera de MOTRAE no puede estar ahí—, así que el porcentaje
   * solo es utilizable si desde aquí se ve a quién corresponde. Cada local ocupa
   * siempre la misma posición, de modo que el canario es el mismo cada vez.
   */
  const alcanzados = $derived(central.localesEnElAnillo(anilloNumero));
  const orden = $derived(central.ordenDeDespliegue);

  /**
   * La lista de comprobación. Cada renglón corresponde a algo que ya ha salido
   * mal en algún despliegue de alguien — no son buenas intenciones.
   */
  const COMPROBACIONES = [
    { id: "pruebas", texto: "Toda la suite pasa (dominio, hub, pos-ui)" },
    { id: "ensayo", texto: "El ensayo del viernes corre completo contra el binario instalado" },
    { id: "previa", texto: "Vi la aplicación funcionando con esta versión" },
    { id: "instalador", texto: "Instalé el .exe sobre una instalación anterior, sin perder datos" },
    { id: "notas", texto: "Las notas están escritas para el restaurantero, no para mí" },
  ];
  let hechas = $state<Record<string, boolean>>({});

  const listo = $derived(
    COMPROBACIONES.every((c) => hechas[c.id]) &&
      version.trim().length > 0 &&
      url.trim().length > 0 &&
      sha256.trim().length === 64 &&
      central.puedePublicar,
  );

  const repositorio = $derived(central.secretos.repositorio || "motrae/motrest");

  async function firmar() {
    error = "";
    manifiesto = "";
    firmando = true;
    try {
      const resultado = await central.firmarActualizacion(
        {
          version: version.trim(),
          notas: notas.trim(),
          url: url.trim(),
          sha256: sha256.trim().toLowerCase(),
          ...(obligatoria ? { obligatoria: true } : {}),
          ...(versionMinima.trim() ? { version_minima_soportada: versionMinima.trim() } : {}),
          ...(anilloNumero !== undefined ? { anillo: anilloNumero } : {}),
        },
      );
      if (!resultado.ok) {
        error = resultado.error;
        return;
      }
      manifiesto = JSON.stringify(resultado.manifiesto, null, 2);
    } finally {
      firmando = false;
    }
  }

  function copiar() {
    void navigator.clipboard?.writeText(manifiesto);
  }
</script>

<section>
  <h1>Actualizaciones</h1>

  <p class="intro">
    Cada versión se sube a un <b>release</b> de
    <code>github.com/{repositorio}</code> con dos archivos: el instalador y este
    <code>motrest.json</code> firmado. Los Hubs lo comprueban antes de bajar nada
    — sin la firma de MOTRAE no instalan aunque el archivo esté en su sitio.
  </p>

  <div class="columnas">
    <div class="formulario">
      <h2>1 · La versión</h2>

      <div class="dos">
        <label>
          Versión
          <input bind:value={version} placeholder="1.5.0" />
        </label>
        <label class="marca">
          <input type="checkbox" bind:checked={obligatoria} />
          <span>No se puede posponer</span>
        </label>
      </div>

      <label>
        Versión mínima soportada <small>(opcional, para retirar una versión vulnerable)</small>
        <input bind:value={versionMinima} placeholder="1.4.2" />
      </label>

      <label>
        Anillo <small>(opcional: a qué % de la flota se le ofrece. Vacío = a todos)</small>
        <input bind:value={anillo} placeholder="10" inputmode="numeric" />
      </label>

      <!--
        Sin esto el porcentaje sería a ciegas. El manifiesto no puede llevar la
        lista de sucursales —es un archivo público de GitHub— así que lleva un
        número; verlo traducido a nombres AQUÍ es lo que lo hace utilizable.
      -->
      <div class="anillo">
        {#if anilloNumero === undefined}
          <p class="anillo-todos">
            Se ofrecerá a <b>los {central.activos.length} locales</b> de la cartera
            a la vez. Para una versión mayor, conviene un anillo.
          </p>
        {:else if alcanzados.length === 0}
          <p class="anillo-vacio">
            Con {anilloNumero} % no entra ningún local de la cartera. Súbalo hasta
            que aparezca el que quiera usar de prueba.
          </p>
        {:else}
          <p class="anillo-titulo">
            Entran <b>{alcanzados.length} de {central.activos.length}</b>:
          </p>
          <ul class="anillo-lista">
            {#each alcanzados as cliente (cliente.id)}
              <li>{cliente.nombre}</li>
            {/each}
          </ul>
        {/if}

        {#if orden.length > 0}
          <details>
            <summary>Orden de despliegue de la cartera</summary>
            <p class="anillo-nota">
              Cada local ocupa siempre el mismo lugar, en todas las versiones: el
              primero de esta lista es el que sirve de prueba una y otra vez, y de
              ese modo se aprende de él. Subir el porcentaje solo añade locales,
              nunca quita.
            </p>
            <ol class="anillo-orden">
              {#each orden as fila (fila.cliente.id)}
                <li>
                  <span>{fila.cliente.nombre}</span>
                  <em>entra desde {fila.posicion + 1} %</em>
                </li>
              {/each}
            </ol>
          </details>
        {/if}
      </div>

      {#if obligatoria}
        <!--
          Se avisa cada vez que se marca. Usarlo para cualquier mejora convierte
          el "obligatoria" en ruido y el restaurante deja de distinguir cuál lo
          es de verdad.
        -->
        <p class="ojo">
          Resérvelo para un fallo de seguridad o un cambio del SAT con fecha. Si
          todo es obligatorio, nada lo es.
        </p>
      {/if}

      <label>
        Notas — las lee el restaurantero
        <textarea
          bind:value={notas}
          rows="3"
          placeholder="Los cortes de caja salen más rápido y se arregló el ticket de cocina que se cortaba."
        ></textarea>
      </label>

      <label>
        URL del instalador
        <input
          bind:value={url}
          placeholder="https://github.com/{repositorio}/releases/download/v1.5.0/MotRest_setup.exe"
        />
      </label>

      <label>
        Huella SHA-256 del instalador
        <input bind:value={sha256} placeholder="64 caracteres" spellcheck="false" />
        <small>
          En PowerShell: <code>Get-FileHash MotRest_setup.exe</code>
        </small>
      </label>

      <h2>2 · Antes de publicar</h2>
      <ul class="lista">
        {#each COMPROBACIONES as c (c.id)}
          <li>
            <label>
              <input type="checkbox" bind:checked={hechas[c.id]} />
              <span>{c.texto}</span>
            </label>
          </li>
        {/each}
      </ul>

      <h2>3 · Firmar</h2>
      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button class="primario" disabled={!listo || firmando} onclick={firmar}>
        {firmando ? "Firmando…" : "Firmar el manifiesto"}
      </button>
      {#if !listo}
        <p class="falta">
          {#if !central.puedePublicar}
            Falta el par Ed25519 de publicación — genérelo en <b>Llaves</b>.
          {:else}
            Complete la versión, la URL, la huella y la lista de arriba.
          {/if}
        </p>
      {/if}

      {#if manifiesto}
        <div class="salida">
          <div class="salida-cabeza">
            <b>motrest.json</b>
            <button onclick={copiar}>Copiar</button>
          </div>
          <pre>{manifiesto}</pre>
        </div>
        <p class="siguiente">
          Súbalo como archivo adjunto del release, junto al instalador. Los Hubs
          lo verán en su siguiente comprobación (cada 12 h).
        </p>
      {/if}
    </div>

    <div class="previa">
      <h2>Vista previa</h2>
      <p class="previa-nota">
        La aplicación de verdad, tal como la verá el restaurante. Levante el POS
        (<code>pnpm dev:pos</code>) y compruébelo antes de firmar.
      </p>

      <div class="previa-barra">
        <input bind:value={previa} spellcheck="false" />
        <button onclick={() => (mostrarPrevia = !mostrarPrevia)}>
          {mostrarPrevia ? "Ocultar" : "Ver"}
        </button>
      </div>

      {#if mostrarPrevia}
        <!--
          `sandbox` contiene lo que la vista previa puede hacer dentro de Central.
          Lo que se carga aquí es una versión de MotRest que TODAVÍA NO se ha
          revisado —ese es el propósito del panel—, así que se le deja lo justo
          para verse funcionando: scripts, su propio origen y formularios. Sin
          `allow-top-navigation` no puede sacar a Central de su sitio, y sin
          `allow-popups` no puede abrir ventanas.
        -->
        <iframe
          src={previa}
          title="Vista previa de MotRest"
          sandbox="allow-scripts allow-same-origin allow-forms"
        ></iframe>
      {:else}
        <div class="previa-vacia">
          <span>Pulse «Ver» para cargar la aplicación aquí.</span>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  section {
    padding: 1.5rem 1.75rem 3rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    margin: 0 0 0.6rem;
    color: var(--pizarra);
  }
  .intro {
    font-size: 0.86rem;
    line-height: 1.65;
    color: var(--gris);
    max-width: 46rem;
    margin: 0 0 1.6rem;
  }
  code {
    font-size: 0.86em;
    color: var(--acento);
  }
  .columnas {
    display: grid;
    grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  h2 {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.6rem 0 0.6rem;
  }
  h2:first-child {
    margin-top: 0;
  }
  .formulario {
    display: flex;
    flex-direction: column;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    margin-bottom: 0.7rem;
  }
  input,
  textarea {
    font: inherit;
    font-size: 0.88rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    resize: vertical;
  }
  input:focus,
  textarea:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  small {
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--gris);
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    align-items: end;
  }
  .marca {
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
    padding-bottom: 0.55rem;
  }
  .marca input {
    width: auto;
  }
  .ojo {
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--pizarra);
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.65rem;
    margin: 0 0 0.7rem;
  }
  .lista {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .lista label {
    flex-direction: row;
    align-items: flex-start;
    gap: 0.5rem;
    font-weight: 400;
    font-size: 0.83rem;
    line-height: 1.45;
    margin: 0;
    cursor: pointer;
  }
  .lista input {
    margin-top: 0.15rem;
  }
  button {
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    padding: 0.55rem 1.1rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
    align-self: flex-start;
  }
  .primario:disabled {
    background: var(--borde);
    border-color: var(--borde);
    color: var(--gris);
    cursor: not-allowed;
  }
  .falta,
  .siguiente {
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--gris);
    margin: 0.5rem 0 0;
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
    margin: 0 0 0.5rem;
  }
  .salida {
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    overflow: hidden;
    margin-top: 1rem;
  }
  .salida-cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.65rem;
    background: var(--fondo);
    font-size: 0.78rem;
  }
  .salida-cabeza button {
    font-size: 0.74rem;
    padding: 0.2rem 0.55rem;
  }
  pre {
    margin: 0;
    padding: 0.7rem;
    font-size: 0.71rem;
    line-height: 1.5;
    max-height: 14rem;
    overflow: auto;
    background: var(--blanco);
  }
  .previa {
    position: sticky;
    top: 1.5rem;
  }
  .previa-nota {
    font-size: 0.78rem;
    line-height: 1.55;
    color: var(--gris);
    margin: 0 0 0.6rem;
  }
  .previa-barra {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .previa-barra input {
    flex: 1;
    font-size: 0.8rem;
  }
  iframe,
  .previa-vacia {
    width: 100%;
    height: 32rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--blanco);
  }
  .previa-vacia {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.84rem;
    color: var(--gris);
  }

  @media (max-width: 1100px) {
    .columnas {
      grid-template-columns: 1fr;
    }
    .previa {
      position: static;
    }
  }
</style>
