<script lang="ts">
  /**
   * La puerta del restaurante: reservas del día y quién está esperando.
   *
   * Es la pantalla del anfitrión un viernes. Todo lo que hace falta para no
   * perder gente en la entrada cabe aquí: quién viene, quién se retrasó, qué
   * mesa hay, y cuánto decirle a quien acaba de llegar sin reserva.
   */
  import { franjaDe, type Reserva } from "@motrest/dominio";
  import { hora } from "../../formato";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { reservas } from "../../reservas.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("crm.cliente.editar"));

  /* El reloj avanza solo: "se retrasó 20 min" tiene que envejecer sin recargar. */
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const puerta = $derived(reservas.enPuerta(ahora));
  const rotacion = $derived(reservas.rotacion);
  const esperaAhora = $derived(reservas.esperaPara(reservas.espera.length, ahora));

  /** Mesas libres ahora mismo, para el desplegable de "sentar". */
  const libres = $derived(
    plano.todasLasMesas.filter((m) => pos.estadoMesa(m.id) === "libre"),
  );

  let aviso = $state("");

  // --- Alta de reserva ---
  let abrirAlta = $state(false);
  let nombre = $state("");
  let telefono = $state("");
  let personas = $state("2");
  let fecha = $state(new Date().toISOString().slice(0, 10));
  let horaTexto = $state("21:00");
  let mesaId = $state("");

  const paraTs = $derived(new Date(`${fecha}T${horaTexto || "00:00"}`).getTime());
  /* Se avisa del choque MIENTRAS se captura, no al guardar. */
  const choques = $derived(
    mesaId && Number.isFinite(paraTs) ? reservas.choques(mesaId, paraTs) : [],
  );
  const plantones = $derived(reservas.plantonesDe(telefono.trim() || undefined));

  function apartar() {
    const r = reservas.apartar({
      nombre,
      telefono,
      personas: Number(personas) || 0,
      para_ts: paraTs,
      mesa_id: mesaId || undefined,
    });
    aviso = r.ok ? "" : (r.error ?? "");
    if (r.ok) {
      nombre = "";
      telefono = "";
      abrirAlta = false;
    }
  }

  async function sentar(reserva: Reserva, mesa: string) {
    if (!mesa) return;
    const r = await reservas.sentar(reserva.id, mesa);
    aviso = r.ok ? "" : (r.error ?? "");
  }

  function confirmar(reserva: Reserva, valor: string) {
    if (!valor) return;
    // "sin-mesa" acepta la reserva sin comprometer una mesa concreta: es lo
    // normal cuando todavía falta una semana y el salón puede cambiar.
    const r = reservas.confirmar(reserva.id, valor === "sin-mesa" ? undefined : valor);
    aviso = r.ok ? "" : (r.error ?? "");
  }

  function cancelar(reserva: Reserva) {
    const motivo = prompt(`¿Por qué se cancela la reserva de ${reserva.nombre}?`);
    if (!motivo) return;
    const r = reservas.cancelar(reserva.id, motivo);
    aviso = r.ok ? "" : (r.error ?? "");
  }

  // --- Lista de espera ---
  let esperaNombre = $state("");
  let esperaTelefono = $state("");
  let esperaPersonas = $state("2");

  function anotar() {
    const r = reservas.anotarEnEspera({
      nombre: esperaNombre,
      telefono: esperaTelefono,
      personas: Number(esperaPersonas) || 0,
    });
    aviso = r.ok ? "" : (r.error ?? "");
    if (r.ok) {
      esperaNombre = "";
      esperaTelefono = "";
    }
  }

  function minutosDesde(ts: number): number {
    return Math.max(0, Math.round((ahora - ts) / 60_000));
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Reservas y lista de espera</h1>
      <p class="sub">
        {#if rotacion.confiable}
          Una mesa dura <b>{rotacion.minutos_mediana} min</b> en este local, medido
          sobre {rotacion.muestras} sentadas reales.
        {:else}
          Todavía no hay suficientes sentadas para medir la rotación real
          ({rotacion.muestras} de las que hacen falta). Se usa
          <b>{rotacion.minutos_mediana} min</b> mientras tanto.
        {/if}
      </p>
    </div>
    {#if puedeEditar}
      <button class="principal" onclick={() => (abrirAlta = !abrirAlta)}>
        {abrirAlta ? "Cerrar" : "+ Apartar mesa"}
      </button>
    {/if}
  </div>

  {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}

  {#if abrirAlta && puedeEditar}
    <div class="tarjeta">
      <div class="campos">
        <label class="ancho">
          <span>A nombre de</span>
          <input bind:value={nombre} placeholder="Familia Ramírez" />
        </label>
        <label>
          <span>Teléfono</span>
          <input bind:value={telefono} inputmode="tel" placeholder="33 1122 3344" />
        </label>
        <label>
          <span>Personas</span>
          <input type="number" min="1" bind:value={personas} />
        </label>
        <label>
          <span>Día</span>
          <input type="date" bind:value={fecha} />
        </label>
        <label>
          <span>Hora</span>
          <input type="time" bind:value={horaTexto} />
        </label>
        <label>
          <span>Mesa</span>
          <select bind:value={mesaId}>
            <option value="">Sin mesa asignada</option>
            {#each plano.todasLasMesas as m (m.id)}
              <option value={m.id}>{m.nombre}</option>
            {/each}
          </select>
        </label>
      </div>

      <!--
        El choque se avisa MIENTRAS se captura. Descubrirlo cuando llegan los dos
        grupos significa mandar a alguien a esperar de pie con una reserva en la
        mano: la peor forma de perder a un cliente que ya había decidido venir.
      -->
      {#each choques as choque (choque.reserva.id)}
        <p class="choque" role="alert">
          Esa mesa ya está apartada para <b>{choque.reserva.nombre}</b> a las
          {hora(choque.reserva.para_ts)} — se encimarían {choque.minutos_encimados} min.
        </p>
      {/each}

      {#if plantones > 0}
        <!-- El dato caro: con esto se decide si se le vuelve a apartar mesa. -->
        <p class="antecedente">
          Este teléfono no llegó {plantones} {plantones === 1 ? "vez" : "veces"}.
        </p>
      {/if}

      <div class="acciones">
        <button class="principal" onclick={apartar}>Apartar</button>
      </div>
    </div>
  {/if}

  <!--
    BANDEJA DE SOLICITUDES. Lo que pidieron desde el portal y nadie ha
    contestado. Va arriba de todo y con su propio color porque es lo único de
    esta pantalla que ESPERA UNA DECISIÓN: un comensal que pidió mesa y no
    recibe respuesta se va a otro lado, y ni siquiera nos enteramos.
  -->
  {#if reservas.solicitadas.length > 0}
    <section class="tarjeta solicitudes">
      <h2>
        Pidieron mesa desde el celular
        <span class="cuantas">{reservas.solicitadas.length}</span>
      </h2>
      <p class="nota">
        Todavía <b>no tienen mesa apartada</b>. Confirma o cancela: al confirmar,
        la mesa queda comprometida.
      </p>

      {#each reservas.solicitadas as r (r.id)}
        <article class="reserva pedida">
          <div class="datos">
            <b>{r.nombre}</b>
            <span>
              {new Date(r.para_ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
              {hora(r.para_ts)} · {r.personas}
              {r.personas === 1 ? "persona" : "personas"}
              {#if r.telefono} · {r.telefono}{/if}
            </span>
          </div>
          {#if puedeEditar}
            <select onchange={(e) => confirmar(r, e.currentTarget.value)}>
              <option value="">Confirmar en…</option>
              <option value="sin-mesa">Sin asignar mesa</option>
              {#each plano.todasLasMesas as m (m.id)}<option value={m.id}>{m.nombre}</option>{/each}
            </select>
            <button class="mini x" onclick={() => cancelar(r)}>Rechazar</button>
          {/if}
        </article>
      {/each}
    </section>
  {/if}

  <div class="columnas">
    <!-- Quién viene -->
    <section class="tarjeta">
      <h2>En puerta</h2>

      {#if puerta.retrasadas.length > 0}
        <h3 class="alerta">Se retrasaron</h3>
        {#each puerta.retrasadas as r (r.id)}
          <article class="reserva tarde">
            <div class="datos">
              <b>{r.nombre}</b>
              <span>
                {hora(r.para_ts)} · {r.personas}
                {r.personas === 1 ? "persona" : "personas"} ·
                {minutosDesde(r.para_ts)} min de retraso
              </span>
            </div>
            {#if puedeEditar}
              <select onchange={(e) => sentar(r, e.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#each libres as m (m.id)}<option value={m.id}>{m.nombre}</option>{/each}
              </select>
              <!--
                Nadie se marca plantado solo: el reloj no sabe que vienen
                llegando. Liberar la mesa lo decide quien está en la puerta.
              -->
              <button class="mini" onclick={() => reservas.noLlego(r.id)}>No llegó</button>
            {/if}
          </article>
        {/each}
      {/if}

      <h3>Por llegar</h3>
      {#if puerta.esperando.length === 0}
        <p class="vacio">Sin reservas por llegar.</p>
      {:else}
        {#each puerta.esperando as r (r.id)}
          <article class="reserva">
            <div class="datos">
              <b>{r.nombre}</b>
              <span>
                {hora(r.para_ts)}–{hora(franjaDe(r).hasta)} · {r.personas}
                {r.personas === 1 ? "persona" : "personas"}
                {#if r.mesa_id} · mesa {plano.nombreMesa(r.mesa_id)}{/if}
              </span>
            </div>
            {#if puedeEditar}
              <select onchange={(e) => sentar(r, e.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#each libres as m (m.id)}<option value={m.id}>{m.nombre}</option>{/each}
              </select>
              <button class="mini x" onclick={() => cancelar(r)}>Cancelar</button>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    <!-- Quién espera de pie -->
    <section class="tarjeta">
      <h2>Lista de espera</h2>

      <div class="estimacion" class:tenue={!esperaAhora.confiable}>
        <span>Al siguiente que llegue, dile</span>
        <b>
          {esperaAhora.minutos === 0 ? "pasan de inmediato" : `~${esperaAhora.minutos} min`}
        </b>
        <small>
          {esperaAhora.mesas_libres} libres · {esperaAhora.mesas_ocupadas} ocupadas
          {#if !esperaAhora.confiable} · estimación provisional{/if}
        </small>
      </div>

      {#if puedeEditar}
        <div class="campos">
          <label class="ancho">
            <span>Nombre</span>
            <input bind:value={esperaNombre} placeholder="Para llamarlos" />
          </label>
          <label>
            <span>Teléfono</span>
            <input bind:value={esperaTelefono} inputmode="tel" />
          </label>
          <label>
            <span>Personas</span>
            <input type="number" min="1" bind:value={esperaPersonas} />
          </label>
        </div>
        <div class="acciones">
          <button class="secundario" onclick={anotar}>Anotar en la lista</button>
        </div>
      {/if}

      {#if reservas.espera.length === 0}
        <p class="vacio">Nadie esperando.</p>
      {:else}
        {#each reservas.espera as e, i (e.id)}
          <article class="reserva">
            <div class="datos">
              <b>{i + 1}. {e.nombre}</b>
              <span>
                {e.personas} {e.personas === 1 ? "persona" : "personas"} ·
                lleva {minutosDesde(e.desde_ts)} min ·
                le toca en ~{reservas.esperaPara(i, ahora).minutos} min
              </span>
            </div>
            {#if puedeEditar}
              <select onchange={(e2) => reservas.sentarDeEspera(e.id, e2.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#each libres as m (m.id)}<option value={m.id}>{m.nombre}</option>{/each}
              </select>
              <button class="mini x" onclick={() => reservas.quitarDeEspera(e.id)}>Se fue</button>
            {/if}
          </article>
        {/each}
        <p class="nota">
          La lista vive solo en esta terminal: quien espera de pie no es historia
          del negocio. Si la caja se reinicia hay que volver a anotarlos.
        </p>
      {/if}
    </section>
  </div>
</div>

<style>
  .seccion {
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.1rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.55rem;
    font-weight: 700;
  }
  .sub {
    font-size: 0.88rem;
    color: var(--gris);
    margin-top: 0.25rem;
    max-width: 44rem;
    line-height: 1.5;
  }
  .columnas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
    gap: 1rem;
    margin-top: 1rem;
    align-items: start;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    margin: 0.9rem 0 0.5rem;
  }
  h3.alerta {
    color: var(--peligro);
    margin-top: 0;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 8rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  .acciones {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.8rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    cursor: pointer;
  }
  .secundario {
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .reserva {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 0.4rem;
  }
  .reserva.tarde {
    border-color: var(--peligro);
    background: color-mix(in srgb, var(--peligro) 6%, transparent);
  }
  /* La bandeja: lo único de la pantalla que espera una decisión. */
  .solicitudes {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 5%, #fff);
    margin-bottom: 1rem;
  }
  .cuantas {
    display: inline-block;
    min-width: 1.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-pill);
    background: var(--acento);
    color: #fff;
    font-size: 0.8rem;
    text-align: center;
    vertical-align: middle;
  }
  .reserva.pedida {
    border-color: var(--acento);
    background: #fff;
  }
  .reserva .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .reserva b {
    font-size: 0.92rem;
  }
  .reserva span {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .reserva select {
    width: auto;
    font-size: 0.8rem;
    padding: 0.3rem 0.5rem;
  }
  .mini {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.76rem;
    background: #fff;
    cursor: pointer;
    white-space: nowrap;
  }
  .mini.x {
    color: var(--peligro);
  }
  .estimacion {
    display: flex;
    flex-direction: column;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 9%, transparent);
    margin-bottom: 0.9rem;
  }
  .estimacion.tenue {
    background: var(--fondo);
  }
  .estimacion span {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .estimacion b {
    font-family: var(--font-titulo);
    font-size: 1.5rem;
    color: var(--acento);
  }
  .estimacion.tenue b {
    color: var(--pizarra);
  }
  .estimacion small {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .choque {
    margin-top: 0.7rem;
    padding: 0.55rem 0.7rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--peligro);
    color: var(--pizarra);
    font-size: 0.83rem;
    line-height: 1.45;
  }
  .antecedente {
    margin-top: 0.5rem;
    font-size: 0.83rem;
    color: var(--peligro);
    font-weight: 600;
  }
  .error {
    color: var(--peligro);
    font-size: 0.86rem;
    margin-bottom: 0.7rem;
  }
  .vacio,
  .nota {
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .nota {
    margin-top: 0.7rem;
    font-size: 0.76rem;
  }
</style>
