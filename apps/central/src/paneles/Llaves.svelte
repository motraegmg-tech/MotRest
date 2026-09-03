<script lang="ts">
  /**
   * La pantalla más delicada: aquí se crean las privadas Ed25519. Nunca se
   * muestran; el backend Tauri las cifra con DPAPI antes de guardarlas.
   */
  import { central } from "../lib/central.svelte";
  import { fecha } from "../lib/formato";

  let repositorio = $state(central.secretos.repositorio);
  let nubeUrl = $state(central.secretos.nube_url ?? "");
  let nubeServicio = $state("");
  let repositorioCargado = "";
  let guardado = $state("");
  let error = $state("");
  let trabajando = $state(false);
  let confirmacionGenerar = $state(false);
  let contrasena = $state("");
  let repetida = $state("");
  let avisoSoporte = $state("");
  let errorSoporte = $state("");
  let entradaRespaldo = $state<HTMLInputElement>();

  /* El respaldo que sí sobrevive a que muera esta computadora. */
  let contrasenaCofre = $state("");
  let cofreRepetida = $state("");
  let errorCofre = $state("");
  let trabajandoCofre = $state(false);
  let entradaCofre = $state<HTMLInputElement>();

  const soportePendiente = $derived(central.localesConSoportePendiente);

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
    const cambios: {
      repositorio: string;
      nube_url?: string;
      nube_servicio?: string;
    } = {
      repositorio,
    };
    if (nubeUrl.trim()) cambios.nube_url = nubeUrl.trim();
    if (nubeServicio.trim()) cambios.nube_servicio = nubeServicio.trim();
    const resultado = await central.guardarConfiguracion(cambios);
    if (!resultado.ok) {
      error = resultado.error;
      return;
    }
    repositorioCargado = repositorio.trim();
    guardado = "Guardado en el almacén protegido de esta máquina.";
    setTimeout(() => (guardado = ""), 4000);
  }

  function pedirGenerarPares() {
    error = "";
    if (trabajando || !puedeEditarSecretos) return;
    confirmacionGenerar = true;
  }

  function cancelarGeneracion() {
    if (!trabajando) confirmacionGenerar = false;
  }

  async function generarParesConfirmados() {
    if (!confirmacionGenerar || trabajando) return;

    confirmacionGenerar = false;
    trabajando = true;
    const resultado = await central.generarPares();
    trabajando = false;
    if (!resultado.ok) {
      error = resultado.error;
      return;
    }
    guardado = "Pares Ed25519 generados y protegidos con Windows DPAPI.";
  }

  function copiarConRespaldo(texto: string) {
    const auxiliar = document.createElement("textarea");
    auxiliar.value = texto;
    auxiliar.setAttribute("readonly", "");
    auxiliar.style.cssText = "position:fixed; opacity:0; pointer-events:none";
    document.body.append(auxiliar);
    auxiliar.focus();
    auxiliar.select();
    auxiliar.setSelectionRange(0, auxiliar.value.length);

    try {
      return document.execCommand("copy");
    } finally {
      auxiliar.remove();
    }
  }

  async function copiar(texto: string, cual: string) {
    error = "";
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      if (!copiarConRespaldo(texto)) {
        error = "No se pudo copiar automáticamente. Seleccione el texto y cópielo manualmente.";
        return;
      }
    }
    guardado = `Llave pública de ${cual} copiada.`;
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

  /**
   * El respaldo que abre en otra máquina.
   *
   * Se pide dos veces la contraseña porque si se teclea mal no hay forma de
   * enterarse: el archivo se genera igual, parece correcto, y el error solo
   * aparece el día que hace falta abrirlo — que es exactamente el día en que ya
   * no hay una segunda oportunidad.
   */
  async function descargarPortatil() {
    errorCofre = "";
    if (contrasenaCofre !== cofreRepetida) {
      errorCofre = "Las dos contraseñas no coinciden";
      return;
    }

    trabajandoCofre = true;
    const resultado = await central.respaldoPortatil(contrasenaCofre);
    trabajandoCofre = false;
    if (!resultado.ok) {
      errorCofre = resultado.error;
      return;
    }

    const url = URL.createObjectURL(new Blob([resultado.respaldo], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `motrest-llaves-portatil-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    contrasenaCofre = "";
    cofreRepetida = "";
    guardado = "Respaldo portátil descargado. Guárdelo fuera de esta computadora.";
  }

  async function restaurarPortatil(evento: Event) {
    errorCofre = "";
    const entrada = evento.currentTarget as HTMLInputElement;
    const archivo = entrada.files?.[0];
    if (!archivo) return;

    if (!contrasenaCofre) {
      errorCofre = "Escriba arriba la contraseña del respaldo antes de elegir el archivo";
      entrada.value = "";
      return;
    }

    trabajandoCofre = true;
    const resultado = await central.restaurarPortatil(await archivo.text(), contrasenaCofre);
    trabajandoCofre = false;
    entrada.value = "";

    if (!resultado.ok) errorCofre = resultado.error;
    else {
      contrasenaCofre = "";
      cofreRepetida = "";
      guardado = "Llaves restauradas desde el respaldo portátil y protegidas con DPAPI.";
    }
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
  {#if confirmacionGenerar}
    <div class="modal-fondo" role="presentation">
      <div
        class="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmar-pares-titulo"
      >
        <h2 id="confirmar-pares-titulo">Confirmar generación de pares</h2>
        {#if central.estadoSecretos === "migracion"}
          <p>
            Se crearán los dos pares Ed25519 y se migrará la Central. El secreto HMAC anterior
            se borrará solo después de que Windows proteja correctamente los nuevos pares.
          </p>
        {:else if tieneLicencias || tienePublicacion}
          <p>
            Vas a reemplazar los pares actuales. Las licencias vigentes dejarán de validar con
            el próximo Hub y tendrás que emitir licencias e instalador nuevos.
          </p>
        {:else}
          <p>
            Se crearán dos pares Ed25519: uno para licencias y otro para actualizaciones. Las
            llaves privadas quedarán protegidas por Windows DPAPI y no se volverán a mostrar.
          </p>
        {/if}
        <p class="modal-aviso">Esta acción requiere cuidado y no se puede deshacer.</p>
        <div class="acciones-modal">
          <button type="button" onclick={cancelarGeneracion}>Cancelar</button>
          <button type="button" class="peligro" onclick={generarParesConfirmados}>
            Sí, generar los pares
          </button>
        </div>
      </div>
    </div>
  {/if}

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
      <button class="primario" disabled={trabajando || !puedeEditarSecretos} onclick={pedirGenerarPares}>
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
      <button class="primario" disabled={trabajando || !puedeEditarSecretos} onclick={pedirGenerarPares}>
        {trabajando ? "Generando…" : "Generar los dos pares"}
      </button>
    {:else}
      <div class="llaves">
        <label>
          Llave pública de licencias
          <div class="campo">
            <input value={central.secretos.licencias!.publica} readonly spellcheck="false" />
            <button
              type="button"
              class="copiar"
              aria-label="Copiar llave pública de licencias"
              onclick={() => copiar(central.secretos.licencias!.publica, "licencias")}
            >Copiar</button>
          </div>
        </label>
        <label>
          Llave pública de publicación
          <div class="campo">
            <input value={central.secretos.publicacion!.publica} readonly spellcheck="false" />
            <button
              type="button"
              class="copiar"
              aria-label="Copiar llave pública de publicación"
              onclick={() => copiar(central.secretos.publicacion!.publica, "publicación")}
            >Copiar</button>
          </div>
        </label>
      </div>
      <p class="ojo">
        Al regenerar estos pares, reemita las licencias <b>antes</b> de distribuir el
        Hub nuevo. Una licencia HMAC no verifica con Ed25519.
      </p>
      <button disabled={trabajando || !puedeEditarSecretos} onclick={pedirGenerarPares}>Regenerar pares…</button>
    {/if}

    <h2>Canal de actualizaciones y estado</h2>
    <label>
      Repositorio de GitHub
      <input bind:value={repositorio} spellcheck="false" placeholder="motraegmg-tech/MotRest" />
      <small>Los Hubs bajan solo desde HTTPS de GitHub; el token opcional nunca sale a otro host.</small>
    </label>
    <div class="dos">
      <label>
        URL de la nube (Supabase)
        <input bind:value={nubeUrl} spellcheck="false" placeholder="https://xxxx.supabase.co" />
      </label>
      <label>
        Llave de servicio de la nube
        <input
          type="password"
          bind:value={nubeServicio}
          placeholder={central.secretos.nube_url ? "Guardada (escriba para cambiar)" : ""}
        />
        <small>
          Se salta todas las políticas: quien la tenga lee el padrón entero y
          reparte licencias. No puede <b>firmar</b> ninguna — para eso hace falta
          la privada, que no sale de aquí.
        </small>
      </label>
    </div>
    <button class="primario" disabled={!puedeEditarSecretos} onclick={guardar}>
      Guardar canal, relay y nube
    </button>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  {#if guardado}<p class="ok">{guardado}</p>{/if}

  <h2>Mi acceso a los restaurantes</h2>
  <p class="explica">
    El usuario <b>Gonzalo DJA</b> se habilita por licencia y no aparece en la lista
    de personal del restaurante. Se entra desde «Acceso de soporte MOTRAE» y todo lo que
    haga queda en la bitácora del local.
  </p>

  {#if tieneSoporte}
    <p class="estado-ok">Ya hay una contraseña de soporte configurada.</p>
  {:else}
    <p class="estado-falta">Las licencias que emita ahora saldrán sin acceso de MOTRAE.</p>
  {/if}

  <!--
    ROTAR NO ES CAMBIAR AQUÍ. La contraseña viaja firmada dentro de la licencia,
    así que un local no la cambia hasta que se le emite una nueva. Sin esta
    lista, rotar de urgencia era reemitir a ciegas y confiar en no dejarse a
    nadie — justo el día en que eso importa.
  -->
  {#if soportePendiente.length > 0}
    <div class="pendientes-soporte">
      <b>
        {soportePendiente.length === 1
          ? "Un local sigue con la contraseña anterior:"
          : `${soportePendiente.length} locales siguen con la contraseña anterior:`}
      </b>
      <span>{soportePendiente.map((c) => c.nombre).join(", ")}</span>
      <em>Reemítales la licencia desde Restaurantes para que el cambio les llegue.</em>
    </div>
  {:else if tieneSoporte && central.activos.length > 0}
    <p class="estado-ok">Todos los locales activos ya tienen la contraseña vigente.</p>
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

  <h2>Respaldo portátil de las llaves</h2>
  <!--
    LA MEJORA QUE MÁS RIESGO QUITA. El respaldo DPAPI de más abajo solo abre en
    este mismo perfil de Windows: si el equipo se pierde, se quema o Windows se
    reinstala, ese archivo no sirve en ninguna parte y con él se van las llaves
    que firman licencias y actualizaciones de TODOS los restaurantes. No se
    pueden regenerar — habría que reinstalar cada local a mano con un Hub nuevo.
  -->
  {#if !central.respaldoAlDia}
    <div class="alerta">
      <b>No hay un respaldo que abra fuera de esta computadora.</b>
      Si este equipo desaparece, se van con él las licencias y las actualizaciones
      de todos los restaurantes, y no hay forma de regenerarlas.
    </div>
  {:else}
    <p class="estado-ok">
      Último respaldo portátil: {fecha(central.secretos.ultimo_respaldo_ts!)}.
    </p>
  {/if}

  <p class="explica">
    Se cifra con una contraseña que solo usted sabe, así que se puede guardar
    fuera —otra máquina, una caja fuerte, un gestor de contraseñas— y abrir en
    otro equipo. <b>El archivo y la contraseña se guardan por separado</b>: quien
    tenga los dos puede firmar en nombre de MOTRAE.
  </p>

  <div class="dos">
    <label>
      Contraseña del respaldo
      <input type="password" bind:value={contrasenaCofre} placeholder="Mínimo 16 caracteres" />
    </label>
    <label>
      Repetirla
      <input type="password" bind:value={cofreRepetida} />
    </label>
  </div>
  {#if errorCofre}<p class="error">{errorCofre}</p>{/if}
  <div class="acciones">
    <button class="primario" disabled={trabajandoCofre || !puedeEditarSecretos} onclick={descargarPortatil}>
      {trabajandoCofre ? "Cifrando…" : "Descargar respaldo portátil"}
    </button>
    <button disabled={trabajandoCofre || !puedeRestaurarSecretos} onclick={() => entradaCofre?.click()}>
      Restaurar desde un respaldo portátil…
    </button>
    <input bind:this={entradaCofre} class="oculto" type="file" accept="application/json" onchange={restaurarPortatil} />
  </div>

  <h2>Respaldos de esta máquina</h2>
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
  .copiar { white-space: nowrap; }
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
  .pendientes-soporte { background: #fff3d8; border-radius: var(--r-sm); padding: 0.6rem 0.75rem; margin: 0.7rem 0; font-size: 0.83rem; line-height: 1.6; color: var(--pizarra); }
  .pendientes-soporte b { display: block; }
  .pendientes-soporte em { display: block; margin-top: 0.25rem; font-style: normal; font-size: 0.78rem; color: var(--gris); }
  .ok { font-size: 0.8rem; color: #1e6b4a; margin: 0.7rem 0; }
  .bloque { line-height: 1.5; }
  .llaves { display: flex; flex-direction: column; gap: 0.1rem; }
  .oculto { display: none; }
  .modal-fondo { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 1.25rem; background: rgb(20 24 26 / 0.62); }
  .modal { width: min(100%, 31rem); padding: 1.3rem; border: 1px solid var(--borde); border-radius: var(--r-md); background: var(--blanco); box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.28); }
  .modal h2 { margin: 0 0 0.85rem; color: var(--pizarra); }
  .modal p { margin: 0; font-size: 0.9rem; line-height: 1.55; color: var(--pizarra); }
  .modal .modal-aviso { margin-top: 0.8rem; font-weight: 700; color: var(--peligro); }
  .acciones-modal { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.2rem; }
  .peligro { border-color: var(--peligro); background: var(--peligro); color: var(--blanco); }
  section > button:last-child { margin-top: 0.65rem; }
  @media (max-width: 600px) { .dos { grid-template-columns: 1fr; } }
</style>
