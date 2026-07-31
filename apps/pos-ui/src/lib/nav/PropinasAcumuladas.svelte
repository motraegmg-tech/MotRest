<script lang="ts">
  /**
   * Cuánta propina se lleva acumulada, en el panel de siempre.
   *
   * Es la pregunta que el personal se hace varias veces por turno, y hasta
   * ahora la única forma de responderla era esperar a la prenómina del sábado.
   * Puesto en el panel, se responde sin abrir nada.
   *
   * DE QUIÉN SON LAS PROPINAS QUE SE VEN. Lo deciden los permisos, no esta
   * pantalla:
   *
   *   rrhh.propina.ver        → las propias, y solo las propias (mesero, cajero)
   *   rrhh.propina.ver_local  → el fondo del local (gerencia, contabilidad)
   *
   * Un mesero tiene que poder saber cuánto lleva; cuánto lleva el de al lado no
   * es asunto suyo.
   */
  import { propinasAcumuladas } from "@motrest/dominio";
  import { mxn } from "../formato";
  import { local } from "../local.svelte";
  import { pos } from "../pos.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  const puedeVer = $derived(
    sesion.puedeVer("rrhh.propina.ver") || sesion.puedeVer("rrhh.propina.ver_local"),
  );
  /** Con este permiso se ve el fondo completo del local, no solo lo propio. */
  const todoElLocal = $derived(sesion.puedeVer("rrhh.propina.ver_local"));

  /*
   * `ahora` avanza solo para que el corte de jornada ocurra sin recargar: a las
   * 5 de la mañana el acumulado del día tiene que volver a cero por su cuenta.
   * Cada minuto basta y no cuesta nada.
   */
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const acumulado = $derived(
    propinasAcumuladas(
      pos.todasLasComandas,
      ahora,
      local.horaCorte,
      todoElLocal ? undefined : sesion.usuarioActual?.id,
    ),
  );
</script>

{#if puedeVer}
  <section class="propinas" aria-label="Propinas acumuladas">
    <div class="titulo">
      <span>Propinas</span>
      <!--
        Se dice SIEMPRE de quién son las cifras. Un mesero que crea que está
        viendo el fondo del local, o un gerente que crea que ve solo lo suyo,
        toma decisiones con el número equivocado.
      -->
      <b class="alcance">{todoElLocal ? "del local" : "tuyas"}</b>
    </div>

    <div class="cifra">
      <span>Hoy</span>
      <b>{mxn(acumulado.dia)}</b>
    </div>
    <div class="cifra tenue">
      <span>Semana</span>
      <b>{mxn(acumulado.semana)}</b>
    </div>
    <div class="cifra tenue">
      <span>Quincena</span>
      <b>{mxn(acumulado.quincena)}</b>
    </div>

    <p class="pie">
      {#if acumulado.cuentasDelDia === 0}
        Todavía no hay cuentas cobradas con propina hoy.
      {:else}
        {acumulado.cuentasDelDia}
        {acumulado.cuentasDelDia === 1 ? "cuenta cobrada" : "cuentas cobradas"} con propina.
      {/if}
    </p>
  </section>
{/if}

<style>
  .propinas {
    margin-top: 1.25rem;
    padding: 0.85rem 0.9rem;
    border-radius: var(--r-md);
    background: rgba(255, 255, 255, 0.05);
  }
  .titulo {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .titulo span {
    font-family: var(--font-titulo);
    font-size: 0.9rem;
    font-weight: 600;
    color: #fff;
  }
  .alcance {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--acento);
  }
  .cifra {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.15rem 0;
  }
  .cifra span {
    font-size: 0.82rem;
    color: #8a969c;
  }
  .cifra b {
    font-variant-numeric: tabular-nums;
    font-size: 1.15rem;
    font-weight: 700;
    color: #fff;
  }
  .cifra.tenue b {
    font-size: 0.92rem;
    font-weight: 600;
    color: #b9c2bc;
  }
  .pie {
    margin-top: 0.5rem;
    font-size: 0.72rem;
    line-height: 1.4;
    color: #6f7b81;
  }
</style>
