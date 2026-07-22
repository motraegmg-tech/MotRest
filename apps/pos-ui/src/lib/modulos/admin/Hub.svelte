<script lang="ts">
  /**
   * M9 · Enlace con el Hub del local.
   *
   * El Hub NO es requisito para vender: es lo que permite que varias terminales
   * compartan el mismo salón en vivo. Sin él, cada dispositivo opera en isla y
   * se reconcilia cuando vuelva (TRD R3).
   */
  import { sync } from "../../sync.svelte";

  let borrador = $state(sync.url);
  let guardando = $state(false);

  const estado = $derived(sync.estado);

  async function guardar() {
    guardando = true;
    await sync.configurar(borrador);
    guardando = false;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Hub del local</h1>
      <p class="sub">
        El servicio que comparte la operación entre las terminales del
        restaurante y arbitra el orden de los eventos.
      </p>
    </div>
    <div class="estado {estado}" class:sin={!sync.configurado}>
      <span class="punto"></span>
      {sync.etiqueta}
    </div>
  </div>

  <section class="tarjeta">
    <h2>Dirección</h2>
    <div class="campos">
      <label>
        <span>Canal de sincronización</span>
        <input bind:value={borrador} placeholder="ws://192.168.1.50:8787/sync" />
      </label>
      <button class="principal" onclick={guardar} disabled={guardando}>
        {sync.configurado ? "Reconectar" : "Conectar"}
      </button>
    </div>
    <p class="pista">
      Es la dirección del equipo donde corre el Hub, dentro de la red del local.
      Déjala en blanco para trabajar solo con este dispositivo.
    </p>
    {#if sync.detalle}
      <p class="detalle">{sync.detalle}</p>
    {/if}
    {#if sync.recibidos > 0}
      <p class="detalle ok">
        {sync.recibidos} eventos recibidos de otras terminales en esta sesión.
      </p>
    {/if}
  </section>

  <section class="tarjeta">
    <h2>Cómo funciona</h2>
    <dl>
      <dt>Sin Hub, el restaurante sigue vendiendo</dt>
      <dd>
        Cada terminal escribe en su propio registro. Si el Hub se apaga a media
        noche de viernes, nadie se entera: las comandas se siguen tomando y se
        cobran igual.
      </dd>

      <dt>Al volver, todo se reconcilia solo</dt>
      <dd>
        Lo que se vendió sin enlace se envía en cuanto hay conexión. Cada evento
        lleva un identificador único, así que reenviar algo que el Hub ya tenía
        <b>no lo duplica</b>: conserva el lugar que ya se le había asignado.
      </dd>

      <dt>El Hub decide el orden</dt>
      <dd>
        Los relojes de las terminales pueden ir desfasados. Quién ocurrió antes
        lo determina un solo árbitro, para que el corte de caja y la bitácora
        cuadren siempre.
      </dd>
    </dl>
  </section>

  <section class="tarjeta aviso">
    <h2>Lo que todavía falta</h2>
    <p>
      El canal viaja <b>sin cifrar</b> por la red del local y hay que capturar la
      dirección a mano. El cifrado con certificado fijado y el descubrimiento
      automático del Hub llegan en la etapa 12. Mientras tanto, esto es para una
      red de local controlada, no para exponerlo a internet.
    </p>
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
    max-width: 56rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 34rem;
  }
  .estado {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .punto {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--gris);
  }
  .estado.sincronizado {
    border-color: #6b8f57;
    color: #3f5c31;
  }
  .estado.sincronizado .punto {
    background: #6b8f57;
  }
  .estado.conectando .punto,
  .estado.sincronizando .punto {
    background: var(--acento-2);
  }
  .estado.isla:not(.sin) {
    border-color: var(--acento-2);
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
  .campos {
    display: flex;
    gap: 0.6rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .campos label {
    flex: 1;
    min-width: 15rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .detalle {
    margin-top: 0.5rem;
    font-size: 0.82rem;
    color: var(--acento-2);
    font-weight: 600;
  }
  .detalle.ok {
    color: #3f5c31;
  }
  dl {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  dt {
    font-weight: 600;
    font-size: 0.92rem;
  }
  dd {
    margin-top: 0.2rem;
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.55;
  }
  .aviso {
    border-color: var(--acento-2);
    background: #fdf6ee;
  }
  .aviso p {
    font-size: 0.85rem;
    line-height: 1.55;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.62rem 1.3rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .principal:disabled {
    opacity: 0.5;
  }
</style>
