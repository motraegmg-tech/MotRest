<script lang="ts">
  /**
   * M6 · Personal: checador de asistencia y jornadas del equipo.
   *
   * El checador está pensado para una tablet en la entrada: la sesión abierta es
   * la del dispositivo, y cada quien marca su hora con su PIN sin cambiarla.
   */
  import { etiquetaChecada, formatearJornada, type TipoChecada } from "@motrest/dominio";
  import { asistencia } from "../asistencia.svelte";
  import { hora } from "../formato";
  import { sesion } from "../sesion/sesion.svelte";

  let seleccionado = $state<string>("");
  let pin = $state("");
  let mensaje = $state("");
  let error = $state("");
  let verificando = $state(false);

  // Se refresca cada minuto para que las jornadas abiertas avancen solas.
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const equipo = $derived(sesion.usuariosActivos);
  const puedeAjustar = $derived(sesion.puedeOperar("rrhh.checada.ajustar"));
  const usuario = $derived(seleccionado ? sesion.usuarioDe(seleccionado) : undefined);
  const proxima = $derived<TipoChecada | null>(
    seleccionado ? asistencia.siguiente(seleccionado) : null,
  );

  function elegir(id: string) {
    seleccionado = seleccionado === id ? "" : id;
    pin = "";
    error = "";
    mensaje = "";
  }

  async function checar() {
    if (!seleccionado || pin.length < 4) return;
    verificando = true;
    error = "";

    const valida = await sesion.comprobarCredencial(seleccionado, pin);
    verificando = false;

    if (!valida.ok) {
      error = valida.error ?? "PIN incorrecto";
      pin = "";
      return;
    }

    // Quien captura es la sesión del dispositivo; el dueño de la jornada es
    // quien acaba de teclear su PIN.
    const r = asistencia.registrar(
      seleccionado,
      sesion.usuarioActual?.id ?? seleccionado,
    );
    mensaje = `${usuario?.nombre}: ${etiquetaChecada(r.tipo!).toLowerCase()} a las ${hora(Date.now())}`;
    pin = "";
    seleccionado = "";
  }

  function teclear(digito: string) {
    if (pin.length < 8) pin += digito;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Personal</h1>
      <p class="sub">
        Checador de asistencia. Cada checada es un hecho: no se edita, se corrige
        dejando rastro de quién la autorizó.
      </p>
    </div>
  </div>

  {#if mensaje}<p class="ok" role="status">{mensaje}</p>{/if}

  <div class="columnas">
    <!-- Checador -->
    <section class="tarjeta checador">
      <h2>Checar</h2>
      {#if !seleccionado}
        <p class="pista">Elige tu nombre y teclea tu PIN.</p>
        <div class="personas">
          {#each equipo as u (u.id)}
            {@const r = asistencia.resumen(u.id, ahora)}
            <button class="persona" class:dentro={r.dentro} onclick={() => elegir(u.id)}>
              <span class="ini">{u.iniciales}</span>
              <span class="nom">{u.nombre}</span>
              <span class="estado">{r.dentro ? "dentro" : "fuera"}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="quien">
          <b>{usuario?.nombre}</b>
          <span>va a registrar: <b class="accion">{etiquetaChecada(proxima!)}</b></span>
        </div>

        <input
          class="pin"
          type="password"
          inputmode="numeric"
          bind:value={pin}
          placeholder="PIN"
          onkeydown={(e) => e.key === "Enter" && checar()}
        />

        <div class="teclado">
          {#each ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as d (d)}
            <button onclick={() => teclear(d)}>{d}</button>
          {/each}
          <button class="borrar" onclick={() => (pin = pin.slice(0, -1))}>←</button>
          <button onclick={() => teclear("0")}>0</button>
          <button class="ok-btn" onclick={checar} disabled={pin.length < 4 || verificando}>
            ✓
          </button>
        </div>

        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button class="cancelar" onclick={() => elegir(seleccionado)}>Cancelar</button>
      {/if}
    </section>

    <!-- Jornadas -->
    <section class="tarjeta">
      <h2>Jornadas de hoy</h2>
      <table>
        <thead>
          <tr>
            <th>Empleado</th>
            <th>Estado</th>
            <th class="num">Turnos</th>
            <th class="num">Trabajado</th>
            <th class="num">Descanso</th>
          </tr>
        </thead>
        <tbody>
          {#each equipo as u (u.id)}
            {@const r = asistencia.resumen(u.id, ahora)}
            <tr>
              <td>
                <b>{u.nombre}</b>
                <small>{u.puesto}</small>
              </td>
              <td>
                {#if r.dentro}
                  <span class="chip dentro">Dentro</span>
                {:else if r.turnoAbierto}
                  <span class="chip abierto">Sin checar salida</span>
                {:else if r.turnos > 0}
                  <span class="chip">Fuera</span>
                {:else}
                  <span class="chip tenue">Sin checar</span>
                {/if}
              </td>
              <td class="num">{r.turnos}</td>
              <td class="num">{r.minutos > 0 ? formatearJornada(r.minutos) : "—"}</td>
              <td class="num tenue">
                {r.minutosDescanso > 0 ? formatearJornada(r.minutosDescanso) : "—"}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if puedeAjustar}
        <p class="pista">
          Una checada olvidada se corrige agregando la que falta, con tu
          autorización y su motivo. El registro original nunca se borra.
        </p>
      {/if}
    </section>
  </div>

  <!-- Bitácora de checadas -->
  <section class="tarjeta">
    <h2>Últimas checadas</h2>
    {#if !asistencia.hayRegistro}
      <p class="vacio">Todavía nadie ha checado en este dispositivo.</p>
    {:else}
      <div class="registro">
        {#each asistencia.recientes.slice(0, 20) as c (c.id)}
          <div class="checada">
            <span class="h">{hora(c.momento)}</span>
            <span class="nombre">{sesion.nombreDe(c.trabajador_id)}</span>
            <span class="tipo">{etiquetaChecada(c.tipo)}</span>
            {#if c.corregida}
              <span class="corregida">
                corrección de {sesion.nombreDe(c.autorizador_id ?? "")}
                {#if c.motivo}· {c.motivo}{/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 72rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 40rem;
  }
  .columnas {
    display: grid;
    grid-template-columns: minmax(18rem, 22rem) 1fr;
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 900px) {
    .columnas {
      grid-template-columns: 1fr;
    }
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  .pista {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
    margin-top: 0.6rem;
  }
  .personas {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .persona {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 0.75rem;
    text-align: left;
  }
  .persona:hover {
    border-color: var(--acento);
  }
  .ini {
    width: 2rem;
    height: 2rem;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--fondo);
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .persona.dentro .ini {
    background: var(--acento);
    color: #fff;
  }
  .nom {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .estado {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .quien {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-bottom: 0.75rem;
  }
  .quien > b {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
  }
  .quien span {
    font-size: 0.85rem;
    color: var(--gris);
  }
  .accion {
    color: var(--acento);
  }
  .pin {
    width: 100%;
    padding: 0.7rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    font-size: 1.3rem;
    font-family: var(--font-titulo);
    letter-spacing: 0.3em;
    text-align: center;
  }
  .pin:focus {
    outline: none;
    border-color: var(--acento);
  }
  .teclado {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .teclado button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem;
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 600;
  }
  .teclado button:hover {
    border-color: var(--acento);
  }
  .teclado .ok-btn {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .teclado .ok-btn:disabled {
    opacity: 0.4;
  }
  .cancelar {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num,
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  td {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .tenue {
    color: var(--gris);
  }
  .chip {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 600;
    border-radius: var(--r-pill);
    padding: 0.1rem 0.6rem;
    background: var(--fondo);
    color: var(--gris);
  }
  .chip.dentro {
    background: var(--acento);
    color: #fff;
  }
  .chip.abierto {
    background: #fdeae8;
    color: var(--peligro);
  }
  .registro {
    display: flex;
    flex-direction: column;
  }
  .checada {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.86rem;
  }
  .checada .h {
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    color: var(--gris);
    width: 3rem;
    flex: none;
  }
  .checada .nombre {
    font-weight: 600;
    min-width: 9rem;
  }
  .checada .tipo {
    color: var(--acento);
    font-weight: 600;
    font-size: 0.82rem;
  }
  .corregida {
    font-size: 0.76rem;
    color: var(--acento-2);
    font-style: italic;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .ok {
    background: #eef6e9;
    border: 1px solid #6b8f57;
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: #3f5c31;
  }
  .error {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
</style>
