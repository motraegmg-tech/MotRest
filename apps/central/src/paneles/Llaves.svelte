<script lang="ts">
  /**
   * La pantalla más delicada: aquí se crean las privadas Ed25519. Nunca se
   * muestran; el backend Tauri las cifra con DPAPI antes de guardarlas.
   */
  import { central } from "../lib/central.svelte";

  let repositorio = $state(central.secretos.repositorio);
  let repositorioCargado = "";
  let guardado = $state("");
  let error = $state("");
  let trabajando = $state(false);
  let contrasena = $state("");
  let repetida = $state("");
  let avisoSoporte = $state("");
  let errorSoporte = $state("");
  let entradaRespaldo = $state<HTMLInputElement>();

  const tieneLicencias = $derived(central.secretos.licencias !== undefined);
  const tienePublicacion = $derived(central.secretos.publicacion !== undefined);
  const tieneSoporte = $derived(central.secretos.soporte !== undefined);
  const puedeEditarSecretos = $derived(
    central.estadoSecretos !== "cargando" && central.estadoSecretos !== "error",
  );
  const puedeRestaurarSecretos = $derived(central.estadoSecretos !== "cargando");

  /* La carga DPAPI es asíncrona: copia el valor al input solo cuando llega. */
  $effect(() => {
    const actual = central.secretos.repositorio;
    if (actual !== repositorioCargado) {
      repositorio = actual;
      repositorioCargado = actual;
    }
  });

  async function guardar() {
    error = "";
    const resultado = await central.guardarConfiguracion({ repositorio });
    if (!resultado.ok) {
      error = resultado.error;
      return;
    }
    repositorioCargado = repositorio.trim();
    guardado = "Guardado en el almacén protegido de esta máquina.";
    setTimeout(() => (guardado = ""), 4000);
  }

  async function generarPares() {
    error = "";
    if (
      (tieneLicencias || tienePublicacion) &&
      !confirm(
        "Cambiar los pares invalida las licencias actuales y exige un instalador nuevo. ¿Continuar?",
      )
    ) {
      return;
    }

    trabajando = true;
    const resultado = await central.generarPares();
    trabajando = false;
    if (!resultado.ok) {
      error = resultado.error;
      return;
    }
    guardado = "Pares Ed25519 generados y protegidos con Windows DPAPI.";
  }

  async function copiar(texto: string, cual: string) {
    try {
      await navigator.clipboard.writeText(texto);
      guardado = `Llave pública de ${cual} copiada.`;
    } catch {
      error = "No se pudo copiar. Seleccione el texto manualmente.";
    }
  }

  async function fijarSoporte() {
    errorSoporte = "";
    avisoSoporte = "";

    if (contrasena !== repetida) {
      errorSoporte = "Las dos contraseñas no coinciden";
      return;
    }

    const resultado = await central.fijarContrasenaSoporte(contrasena);
    if (!resultado.ok) {
      errorSoporte = resultado.error;
      return;
    }

    contrasena = "";
    repetida = "";
    avisoSoporte =
      "Contraseña guardada. Reemita las licencias de los locales para que el acceso llegue a cada uno.";
  }

  async function descargarRespaldo() {
    error = "";
    const resultado = await central.respaldoDeSecretos();
    if (!resultado.ok) {
      error = resultado.error;
      return;
    }
    const url = URL.createObjectURL(new Blob([resultado.respaldo], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `motrae-llaves-dpapi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restaurar(evento: Event) {
    error = "";
    const archivo = (evento.currentTarget as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const resultado = await central.restaurarSecretos(await archivo.text());
    if (!resultado.ok) error = resultado.error;
    else guardado = "Respaldo DPAPI restaurado. Las llaves volvieron a cargarse.";
    if (entradaRespaldo) entradaRespaldo.value = "";
  }
</script>

<section>
  <h1>Llaves</h1>

  <div class="alerta">
    <b>Esta computadora vale más que cualquier otra de MOTRAE.</b>
    Las privadas con las que se firman licencias y actualizaciones quedan cifradas
    por Windows DPAPI. No se muestran ni se guardan en el navegador.
  </div>

  {#if central.estadoSecretos === "cargando"}
    <p class="estado">Abriendo el almacén protegido de Windows…</p>
  {:else if central.estadoSecretos === "error"}
    <p class="error bloque">
      No se pudo abrir el almacén DPAPI: {central.errorSecretos}. No emita ni publique
      hasta resolverlo.
    </p>
  {:else if central.estadoSecretos === "desarrollo"}
    <p class="estado advertencia">
      Está en el navegador de desarrollo: las llaves solo viven en memoria y se perderán al
      recargar. Para operar use la app de escritorio de Central.
    </p>
  {/if}

  {#if central.estadoSecretos === "migracion"}
    <div class="migracion">
      <b>Hay una Central con el formato HMAC anterior.</b>
      Esos secretos no se pueden convertir a Ed25519. Generar pares nuevos conserva el
      repositorio y el acceso de soporte, los guarda con DPAPI y borra el secreto legado
      solo después de confirmar el guardado.
      <button class="primario" disabled={trabajando || !puedeEditarSecretos} onclick={generarPares}>
        {trabajando ? "Generando…" : "Generar pares y migrar"}
      </button>
    </div>
  {:else}
    <h2>Identidad de firma Ed25519</h2>

    <p class="explica">
      Hay dos pares distintos: uno para licencias y otro para publicaciones. Las privadas
      <b>no salen de esta máquina</b>; las públicas se incrustan al compilar el Hub.
    </p>

    {#if !tieneLicencias || !tienePublicacion}
      <button class="primario" disabled={trabajando || !puedeEditarSecretos} onclick={generarPares}>
        {trabajando ? "Generando…" : "Generar los dos pares"}
      </button>
    {:else}
      <div class="llaves">
        <label>
          Llave pública de licencias
          <div class="campo">
            <input value={central.secretos.licencias!.publica} readonly spellcheck="false" />
            <button onclick={() => copiar(central.secretos.licencias!.publica, "licencias")}>Copiar</button>
          </div>
        </label>
        <label>
          Llave pública de publicación
          <div class="campo">
            <input value={central.secretos.publicacion!.publica} readonly spellcheck="false" />
            <button onclick={() => copiar(central.secretos.publicacion!.publica, "publicación")}>Copiar</button>
          </div>
        </label>
      </div>
      <p class="ojo">
        Al regenerar estos pares, reemita las licencias <b>antes</b> de distribuir el
        Hub nuevo. Una licencia HMAC no verifica con Ed25519.
      </p>
      <button disabled={trabajando || !puedeEditarSecretos} onclick={generarPares}>Regenerar pares…</button>
    {/if}

    <h2>Canal de actualizaciones</h2>
    <label>
      Repositorio de GitHub
      <input bind:value={repositorio} spellcheck="false" placeholder="motrae/motrest" />
      <small>Los Hubs bajan solo desde HTTPS de GitHub; el token opcional nunca sale a otro host.</small>
    </label>
    <button class="primario" disabled={!puedeEditarSecretos} onclick={guardar}>Guardar repositorio</button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  {#if guardado}<p class="ok">{guardado}</p>{/if}

  <h2>Mi acceso a los restaurantes</h2>
  <p class="explica">
    El usuario <b>Gonz Motrae</b> existe en todas las instalaciones y no aparece en la lista
    del restaurante. Todo lo que haga queda en la bitácora del local.
  </p>

  {#if tieneSoporte}
    <p class="estado-ok">Ya hay una contraseña de soporte configurada.</p>
  {:else}
    <p class="estado-falta">Las licencias que emita ahora saldrán sin acceso de MOTRAE.</p>
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
  <button class="primario" disabled={!puedeEditarSecretos} onclick={fijarSoporte}>
    {tieneSoporte ? "Cambiar contraseña" : "Fijar contraseña"}
  </button>

  <h2>Respaldos</h2>
  <p class="explica">
    La cartera se puede compartir sin secretos. Las llaves tienen un respaldo DPAPI separado:
    sigue cifrado y solo se restaura en este mismo perfil de Windows.
  </p>
  <div class="acciones">
    <button disabled={central.estadoSecretos === "cargando"} onclick={descargarRespaldo}>Descargar respaldo de llaves</button>
    <button disabled={!puedeRestaurarSecretos} onclick={() => entradaRespaldo?.click()}>Restaurar respaldo…</button>
    <input bind:this={entradaRespaldo} class="oculto" type="file" accept="application/json" onchange={restaurar} />
  </div>
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
    Descargar respaldo de la cartera (sin llaves)
  </button>
</section>

<style>
  section { padding: 1.5rem 1.75rem 3rem; max-width: 46rem; }
  h1 { font-family: var(--font-titulo); font-size: 1.6rem; margin: 0 0 1.1rem; color: var(--pizarra); }
  h2 { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--gris); margin: 2rem 0 0.8rem; }
  .alerta, .migracion { background: #fdeae8; border: 1.5px solid var(--peligro); border-radius: var(--r-md); padding: 0.8rem 1rem; font-size: 0.84rem; line-height: 1.6; color: var(--pizarra); }
  .alerta b, .migracion b { display: block; color: var(--peligro); margin-bottom: 0.2rem; }
  .migracion button { margin-top: 0.7rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; font-weight: 600; color: var(--pizarra); margin-bottom: 0.9rem; }
  .campo, .acciones { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .campo input { flex: 1; min-width: 0; }
  input { font: inherit; font-size: 0.88rem; font-weight: 400; padding: 0.5rem 0.6rem; border: 1px solid var(--borde); border-radius: var(--r-sm); background: var(--blanco); color: var(--pizarra); }
  input:focus { outline: 2px solid var(--acento); outline-offset: -1px; }
  input[readonly] { color: var(--gris); background: var(--fondo); }
  small { font-size: 0.73rem; font-weight: 400; line-height: 1.5; color: var(--gris); }
  .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  button { font: inherit; font-size: 0.84rem; font-weight: 600; padding: 0.5rem 1rem; border-radius: var(--r-sm); border: 1px solid var(--borde); background: var(--blanco); color: var(--pizarra); cursor: pointer; }
  button:hover { border-color: var(--acento); }
  button:disabled { cursor: wait; opacity: 0.7; }
  .primario { background: var(--acento); border-color: var(--acento); color: var(--blanco); }
  .explica { font-size: 0.85rem; line-height: 1.65; color: var(--pizarra); margin: 0 0 0.8rem; }
  .ojo, .estado, .estado-ok, .estado-falta { font-size: 0.82rem; border-radius: var(--r-sm); padding: 0.5rem 0.7rem; margin: 0.7rem 0; }
  .ojo, .estado-falta { background: var(--claro); color: var(--pizarra); }
  .estado { background: #eef3f4; color: var(--pizarra); }
  .advertencia { background: #fff3d8; }
  .estado-ok { background: #eaf6f0; color: #1e6b4a; }
  .error { font-size: 0.82rem; color: var(--peligro); margin: 0.7rem 0; }
  .ok { font-size: 0.8rem; color: #1e6b4a; margin: 0.7rem 0; }
  .bloque { line-height: 1.5; }
  .llaves { display: flex; flex-direction: column; gap: 0.1rem; }
  .oculto { display: none; }
  section > button:last-child { margin-top: 0.65rem; }
  @media (max-width: 600px) { .dos { grid-template-columns: 1fr; } }
</style>
