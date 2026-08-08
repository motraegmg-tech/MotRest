<script lang="ts">
  /**
   * La cartera: lista de locales a la izquierda, ficha del elegido a la derecha.
   *
   * La ficha es donde se hace el trabajo de verdad: renovar la licencia, ver qué
   * versión tiene, y sacar el archivo que se pega en el local. Por eso el botón
   * de renovar está arriba y no escondido al final — es lo que se viene a hacer.
   */
  import { central, type CredencialesResponsableIniciales } from "../lib/central.svelte";
  import { desde, dinero, fecha, plazo } from "../lib/formato";
  import Alta from "./Alta.svelte";

  // `let` y no `const`: es un prop enlazado y esta pantalla lo reasigna al
  // elegir un local o al terminar un alta.
  let { seleccionado = $bindable("") }: { seleccionado?: string } = $props();

  let dandoAlta = $state(false);
  let aviso = $state("");
  let licenciaGenerada = $state("");
  let accesoResponsable = $state<{ nombre: string; pin: string } | null>(null);

  const cliente = $derived(central.clientes.find((c) => c.id === seleccionado) ?? null);
  const situacion = $derived(cliente ? central.situacionDe(cliente) : null);
  const salud = $derived(cliente ? central.saludDe(cliente) : null);
  const pulso = $derived(cliente ? central.pulsoDe(cliente.id) : null);

  const ETIQUETA_COBRO: Record<string, string> = {
    al_corriente: "Al corriente",
    por_cobrar: "Por cobrar",
    vencido: "Vencido — en gracia",
    bloqueado: "Bloqueado",
    sin_licencia: "Sin licencia",
  };

  async function renovar() {
    if (!cliente) return;
    aviso = "";
    const r = await central.emitir(cliente.id);
    if (!r.ok) {
      aviso = r.error ?? "No se pudo emitir";
      return;
    }
    licenciaGenerada = JSON.stringify(r.licencia, null, 2);
    if (r.credencialesResponsable) {
      accesoResponsable = {
        nombre: cliente.responsable?.nombre || cliente.contacto,
        pin: r.credencialesResponsable.pin,
      };
    }
    aviso = `Licencia emitida. Vence el ${fecha(r.licencia!.vence_ts)}.`;
  }

  function copiar() {
    void navigator.clipboard?.writeText(licenciaGenerada);
    aviso = "Copiada. Péguela en el local: Administración → Licencia.";
  }

  function copiarPinResponsable() {
    if (!accesoResponsable) return;
    void navigator.clipboard?.writeText(accesoResponsable.pin);
  }

  function mostrarAccesoResponsable(id: string, credenciales: CredencialesResponsableIniciales) {
    const nuevo = central.clientes.find((c) => c.id === id);
    accesoResponsable = {
      nombre: nuevo?.responsable?.nombre || nuevo?.contacto || "Responsable",
      pin: credenciales.pin,
    };
  }
</script>

<main class="contenido">
  <aside class="lista">
    <div class="cabeza">
      <h1>Restaurantes</h1>
      <button class="nuevo" onclick={() => (dandoAlta = true)}>+ Alta</button>
    </div>

    {#if central.clientes.length === 0}
      <p class="ninguno">Todavía no hay ninguno.</p>
    {/if}

    {#each central.clientes as c (c.id)}
      {@const s = central.situacionDe(c)}
      {@const h = central.saludDe(c)}
      <button
        class="fila"
        class:on={c.id === seleccionado}
        class:inactivo={!c.activo}
        onclick={() => {
          seleccionado = c.id;
          licenciaGenerada = "";
          aviso = "";
        }}
      >
        <span class="punto {h.estado} {s.cobro}"></span>
        <span class="txt">
          <b>{c.nombre}</b>
          <em>{ETIQUETA_COBRO[s.cobro]}</em>
        </span>
      </button>
    {/each}
  </aside>

  <div class="ficha">
    {#if !cliente}
      <p class="elige">Elija un restaurante de la lista.</p>
    {:else}
      <header>
        <div>
          <h2>{cliente.nombre}</h2>
          <code>{cliente.id}</code>
        </div>
        {#if cliente.activo}
          <button class="renovar" onclick={renovar}>
            {cliente.licencia ? "Renovar licencia" : "Emitir licencia"}
          </button>
        {/if}
      </header>

      {#if !cliente.activo}
        <p class="baja">Este local está dado de baja.</p>
      {/if}

      {#if aviso}
        <p class="aviso">{aviso}</p>
      {/if}

      {#if licenciaGenerada}
        <!--
          El archivo se enseña para copiar y pegar, no se descarga. Es lo que se
          hace en la práctica: se pega en la pantalla de licencia del local
          mientras se está al teléfono con el restaurantero.
        -->
        <div class="licencia">
          <div class="lic-cabeza">
            <b>licencia.json</b>
            <button onclick={copiar}>Copiar</button>
          </div>
          <pre>{licenciaGenerada}</pre>
        </div>
      {/if}

      <div class="datos">
        <div>
          <span>Cobro</span>
          <b>{situacion ? ETIQUETA_COBRO[situacion.cobro] : "—"}</b>
          {#if cliente.licencia}
            <em>Vence {plazo(situacion!.dias)} · {fecha(cliente.licencia.vence_ts)}</em>
          {/if}
        </div>
        <div>
          <span>Plan</span>
          <b>{dinero(cliente.cuota)}</b>
          <em>{cliente.plan === "anual" ? "al año" : "al mes"}</em>
        </div>
        <div>
          <span>Responsable</span>
          <b>{cliente.responsable?.nombre || cliente.contacto || "—"}</b>
          <em>{cliente.telefono ?? cliente.correo ?? ""}</em>
        </div>
        <div>
          <span>Versión instalada</span>
          <b>{pulso?.version ?? "—"}</b>
          <em>{pulso ? `Reportó ${desde(pulso.ts, central.ahora)}` : "Nunca ha reportado"}</em>
        </div>
      </div>

      <h3>Estado de la instalación</h3>
      {#if salud?.estado === "bien"}
        <p class="bien">Todo en orden.</p>
      {:else}
        <ul class="problemas">
          {#each salud?.motivos ?? [] as motivo (motivo)}
            <li>{motivo}</li>
          {/each}
        </ul>
      {/if}

      {#if pulso}
        <div class="pulso">
          {#if pulso.ventas_dia !== undefined}
            <span>Último día: <b>{dinero(pulso.ventas_dia)}</b> · {pulso.cuentas_dia ?? 0} cuentas</span>
          {/if}
          {#if pulso.terminales !== undefined}
            <span>{pulso.terminales} terminales</span>
          {/if}
          {#if pulso.respaldo_ts}
            <span>Respaldo {desde(pulso.respaldo_ts, central.ahora)}</span>
          {/if}
        </div>
      {/if}

      {#if cliente.activo}
        <button class="dar-baja" onclick={() => central.baja(cliente.id)}>
          Dar de baja
        </button>
      {:else}
        <button class="dar-baja" onclick={() => central.actualizar(cliente.id, { activo: true })}>
          Reactivar
        </button>
      {/if}
    {/if}
  </div>
</main>

{#if dandoAlta}
  <Alta
    onCerrar={() => (dandoAlta = false)}
    onCreado={(id, credenciales) => {
      seleccionado = id;
      dandoAlta = false;
      mostrarAccesoResponsable(id, credenciales);
    }}
  />
{/if}

{#if accesoResponsable}
  <div class="modal-fondo" role="presentation">
    <div class="modal-acceso" role="dialog" aria-modal="true" aria-labelledby="acceso-responsable-titulo">
      <h2 id="acceso-responsable-titulo">Acceso del responsable</h2>
      <p>
        Se creó la cuenta de <b>{accesoResponsable.nombre}</b> como <b>Propietario</b>.
        Es el nivel más alto del restaurante.
      </p>
      <p class="pin-etiqueta">PIN inicial</p>
      <div class="pin">
        <code>{accesoResponsable.pin}</code>
        <button onclick={copiarPinResponsable}>Copiar</button>
      </div>
      <p class="aviso-pin">
        Entrégalo por un medio privado. El responsable deberá cambiarlo al entrar por primera vez;
        este valor no se guarda en Central ni en el respaldo de la cartera.
      </p>
      <button class="renovar" onclick={() => (accesoResponsable = null)}>Ya lo anoté</button>
    </div>
  </div>
{/if}

<style>
  .contenido {
    display: grid;
    grid-template-columns: 17rem 1fr;
    height: 100%;
    min-height: 0;
  }
  .lista {
    border-right: 1px solid var(--borde);
    padding: 1.25rem 0.8rem;
    overflow-y: auto;
    background: var(--blanco);
  }
  .cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.9rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    margin: 0;
    color: var(--pizarra);
  }
  .nuevo {
    font: inherit;
    font-size: 0.76rem;
    font-weight: 700;
    padding: 0.3rem 0.7rem;
    border-radius: var(--r-pill);
    border: none;
    background: var(--acento);
    color: var(--blanco);
    cursor: pointer;
  }
  .ninguno {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .fila {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.55rem 0.6rem;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fila:hover {
    background: var(--fondo);
  }
  .fila.on {
    background: var(--claro);
  }
  .fila.inactivo {
    opacity: 0.45;
  }
  /*
   * Un solo punto para las dos cosas, y manda la peor: un local caído importa
   * más que uno que debe. Dos puntos por fila obligarían a mirar cuál es cuál.
   */
  .punto {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2f9e6b;
  }
  .punto.atencion,
  .punto.por_cobrar {
    background: var(--acento-2);
  }
  .punto.vencido {
    background: var(--acento);
  }
  .punto.sin_senal,
  .punto.nunca_reporto,
  .punto.bloqueado {
    background: var(--peligro);
  }
  .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .txt b {
    font-size: 0.87rem;
    font-weight: 600;
    color: var(--pizarra);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .txt em {
    font-style: normal;
    font-size: 0.72rem;
    color: var(--gris);
  }
  .ficha {
    padding: 1.5rem 1.75rem 3rem;
    overflow-y: auto;
  }
  .elige {
    color: var(--gris);
    font-size: 0.9rem;
  }
  .ficha header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.45rem;
    margin: 0 0 0.15rem;
    color: var(--pizarra);
  }
  code {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .renovar {
    flex: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.6rem 1.1rem;
    border: none;
    border-radius: var(--r-sm);
    background: var(--acento);
    color: var(--blanco);
    cursor: pointer;
  }
  .baja,
  .aviso {
    font-size: 0.84rem;
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.75rem;
    margin: 0 0 1rem;
    color: var(--pizarra);
  }
  .licencia {
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 1.2rem;
    overflow: hidden;
  }
  .lic-cabeza {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.7rem;
    background: var(--fondo);
    font-size: 0.78rem;
  }
  .lic-cabeza button {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid var(--borde);
    background: var(--blanco);
    border-radius: var(--r-sm);
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
  pre {
    margin: 0;
    padding: 0.7rem;
    font-size: 0.72rem;
    line-height: 1.5;
    max-height: 12rem;
    overflow: auto;
    background: var(--blanco);
  }
  .datos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .datos > div {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 0.85rem;
  }
  .datos span {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.2rem;
  }
  .datos b {
    display: block;
    font-size: 1rem;
    color: var(--pizarra);
  }
  .datos em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--gris);
  }
  h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.6rem 0 0.6rem;
  }
  .bien {
    font-size: 0.86rem;
    color: var(--gris);
    margin: 0;
  }
  .problemas {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.86rem;
    line-height: 1.7;
    color: var(--pizarra);
  }
  .pulso {
    display: flex;
    flex-wrap: wrap;
    gap: 1.1rem;
    margin-top: 1rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .dar-baja {
    margin-top: 2rem;
    font: inherit;
    font-size: 0.8rem;
    border: 1px solid var(--borde);
    background: none;
    border-radius: var(--r-sm);
    padding: 0.45rem 0.9rem;
    color: var(--gris);
    cursor: pointer;
  }
  .dar-baja:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .modal-fondo {
    position: fixed;
    z-index: 80;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: rgb(20 24 26 / 0.56);
  }
  .modal-acceso {
    width: min(100%, 29rem);
    padding: 1.35rem;
    border-radius: var(--r-md);
    background: var(--blanco);
    box-shadow: var(--sombra-lg);
  }
  .modal-acceso h2 { font-size: 1.2rem; }
  .modal-acceso p { font-size: 0.86rem; line-height: 1.55; color: var(--pizarra); }
  .pin-etiqueta { margin: 1.1rem 0 0.25rem; font-size: 0.72rem !important; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gris) !important; }
  .pin { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.75rem; border-radius: var(--r-sm); background: var(--fondo); }
  .pin code { font-size: 1.3rem; font-weight: 700; letter-spacing: 0.12em; color: var(--pizarra); }
  .pin button { font: inherit; font-size: 0.78rem; font-weight: 600; padding: 0.35rem 0.65rem; border: 1px solid var(--borde); border-radius: var(--r-sm); background: var(--blanco); cursor: pointer; }
  .aviso-pin { color: var(--gris) !important; }

  @media (max-width: 900px) {
    .contenido {
      grid-template-columns: 1fr;
    }
    .lista {
      border-right: none;
      border-bottom: 1px solid var(--borde);
      max-height: 14rem;
    }
  }
</style>
