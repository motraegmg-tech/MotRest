<script lang="ts">
  /**
   * "Mensajes para el Cliente": qué correos manda este restaurante.
   *
   * El restaurantero decide QUÉ se manda; MotRest ya trae escrito el CUÁNDO y el
   * CÓMO. Es a propósito: pedirle que redacte seis correos y que decida cuándo
   * salen es garantizar que no configure ninguno.
   *
   * Los correos van separados en dos grupos porque las reglas son distintas y no
   * conviene disimularlo:
   *
   *   AVISOS — responden a algo que el comensal hizo. Salen sin pedir permiso
   *            porque él los provocó.
   *   PROMOCIONES — las decide el negocio. Solo van a quien dijo que sí, y
   *            siempre con enlace de baja. No es cortesía: es la ley.
   */
  import { correo } from "../../correo.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("admin.usuario.editar"));

  let remitente = $state(correo.config.remitente);
  let responder = $state(correo.config.responder_a ?? "");
  let telefono = $state(correo.config.telefono ?? "");
  let local = $state(correo.config.local);
  let aviso = $state("");
  let editandoAsunto = $state<string | null>(null);
  let textoAsunto = $state("");

  const avisos = $derived(correo.catalogo.filter((d) => d.clase === "transaccional"));
  const promociones = $derived(correo.catalogo.filter((d) => d.clase === "marketing"));

  function guardarRemitente() {
    const r = correo.actualizar({
      remitente,
      responder_a: responder,
      telefono: telefono.trim() || undefined,
      local: local.trim(),
    });
    aviso = r.ok ? "" : (r.error ?? "");
  }

  function abrirAsunto(tipo: string, actual: string) {
    editandoAsunto = tipo;
    textoAsunto = correo.config.asuntos?.[tipo as never] ?? actual;
  }

  function guardarAsunto() {
    if (!editandoAsunto) return;
    correo.cambiarAsunto(editandoAsunto as never, textoAsunto);
    editandoAsunto = null;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Mensajes para el cliente</h1>
      <p class="sub">
        Los correos que este restaurante le manda al comensal. Enciende los que
        quieras: MotRest los manda solos cuando toca.
      </p>
    </div>
  </div>

  {#if !correo.listo}
    <!--
      Sin remitente no sale NADA. Se dice arriba y no al final, para que nadie
      encienda seis correos y descubra después que ninguno llegó.
    -->
    <p class="alerta" role="alert">
      Falta el remitente. Mientras no esté, <b>no se manda ningún correo</b>.
    </p>
  {/if}

  <!-- Quién manda -->
  <section class="tarjeta">
    <h2>Quién los manda</h2>
    <div class="campos">
      <label class="ancho">
        <span>Remitente</span>
        <input bind:value={remitente} placeholder="Rodizio &lt;reservas@rodizio.mx&gt;" />
        <small>
          El dominio tiene que estar verificado en Resend. Con nombre delante
          —"Rodizio &lt;…&gt;"— el comensal ve el restaurante y no una dirección.
        </small>
      </label>
      <label>
        <span>Nombre del local</span>
        <input bind:value={local} placeholder="Rodizio" />
      </label>
      <label>
        <span>Responder a</span>
        <input bind:value={responder} placeholder="hola@rodizio.mx" />
      </label>
      <label>
        <span>Teléfono</span>
        <input bind:value={telefono} inputmode="tel" placeholder="33 1122 3344" />
        <small>Aparece como botón «Llamar al restaurante» en cada correo.</small>
      </label>
    </div>
    {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}
    {#if puedeEditar}
      <div class="acciones">
        <button class="principal" onclick={guardarRemitente}>Guardar</button>
      </div>
    {/if}
  </section>

  <!-- Avisos -->
  <section class="tarjeta">
    <h2>Avisos</h2>
    <p class="nota">
      Responden a algo que el comensal hizo, así que salen sin pedirle permiso.
    </p>

    {#each avisos as d (d.tipo)}
      <article class="correo" class:on={correo.config.activos[d.tipo]}>
        <div class="datos">
          <b>{d.etiqueta}</b>
          <span>{d.descripcion}</span>
          <span class="cuando">{d.cuando}</span>
          <span class="asunto">
            Asunto: «{correo.config.asuntos?.[d.tipo] ?? d.asuntoPorDefecto}»
            {#if puedeEditar}
              <button class="editar" onclick={() => abrirAsunto(d.tipo, d.asuntoPorDefecto)}>
                cambiar
              </button>
            {/if}
          </span>
        </div>
        {#if puedeEditar}
          <button class="interruptor" onclick={() => correo.alternar(d.tipo)}>
            {correo.config.activos[d.tipo] ? "Encendido" : "Apagado"}
          </button>
        {/if}
      </article>
    {/each}
  </section>

  <!-- Promociones -->
  <section class="tarjeta">
    <h2>Promociones</h2>
    <p class="nota">
      Las decide el restaurante, así que <b>solo van a quien dijo que sí</b> y
      siempre llevan un enlace para darse de baja. No es cortesía: lo exige la ley
      de datos personales, y esconderlo es lo que hace que un dominio acabe en
      spam — y entonces dejan de llegar hasta las confirmaciones de reserva.
    </p>

    {#each promociones as d (d.tipo)}
      <article class="correo" class:on={correo.config.activos[d.tipo]}>
        <div class="datos">
          <b>{d.etiqueta}</b>
          <span>{d.descripcion}</span>
          <span class="cuando">{d.cuando}</span>
        </div>
        {#if puedeEditar}
          <button class="interruptor" onclick={() => correo.alternar(d.tipo)}>
            {correo.config.activos[d.tipo] ? "Encendido" : "Apagado"}
          </button>
        {/if}
      </article>
    {/each}
  </section>

  {#if editandoAsunto}
    <div class="velo" role="presentation" onclick={() => (editandoAsunto = null)}></div>
    <div class="dialogo" role="dialog" aria-modal="true" aria-label="Cambiar el asunto">
      <h3>Asunto del correo</h3>
      <input bind:value={textoAsunto} />
      <p class="pista">
        Puedes usar <code>{"{{local}}"}</code> y <code>{"{{nombre}}"}</code>: se
        cambian por el nombre del restaurante y el del comensal.
      </p>
      <div class="acciones">
        <button class="secundario" onclick={() => (editandoAsunto = null)}>Cancelar</button>
        <button class="principal" onclick={guardarAsunto}>Guardar</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .seccion {
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .encabezado {
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
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    margin-bottom: 1rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .nota,
  .alerta {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.55;
    margin-bottom: 0.9rem;
    max-width: 46rem;
  }
  .alerta {
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 7%, transparent);
    color: var(--pizarra);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .campos label {
    flex: 1;
    min-width: 12rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos small {
    font-size: 0.74rem;
    color: var(--gris);
    line-height: 1.45;
  }
  input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.92rem;
    width: 100%;
    box-sizing: border-box;
  }
  .correo {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 0.45rem;
    opacity: 0.65;
  }
  .correo.on {
    opacity: 1;
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 4%, transparent);
  }
  .correo .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .correo b {
    font-size: 0.95rem;
  }
  .correo span {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .cuando {
    font-style: italic;
  }
  .asunto {
    margin-top: 0.2rem;
    font-size: 0.78rem !important;
  }
  .editar {
    margin-left: 0.3rem;
    background: none;
    border: none;
    padding: 0;
    color: var(--acento);
    font: inherit;
    font-size: 0.78rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .interruptor {
    padding: 0.4rem 0.9rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    background: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .correo.on .interruptor {
    border-color: var(--acento);
    color: var(--acento);
  }
  .acciones {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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
    border: none;
  }
  .secundario {
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .error {
    color: var(--peligro);
    font-size: 0.85rem;
    margin-top: 0.6rem;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
  }
  .dialogo {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(28rem, 92vw);
    background: #fff;
    border-radius: var(--r-lg);
    padding: 1.25rem;
    box-shadow: var(--sombra-md);
  }
  h3 {
    font-size: 1.05rem;
    margin-bottom: 0.7rem;
  }
  .pista {
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
    margin-top: 0.5rem;
  }
  code {
    background: var(--fondo);
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    font-size: 0.9em;
  }
</style>
