<script lang="ts">
  /**
   * Cuánta propina lleva acumulada el equipo, en el panel de siempre.
   *
   * Es la pregunta que el personal se hace varias veces por turno, y hasta
   * ahora la única forma de responderla era esperar a la prenómina del sábado.
   * Puesto en el panel, se responde sin abrir nada.
   *
   * ## Por qué la cifra es la del bote y no la de cada quien
   *
   * Antes se enseñaban dos números: lo recaudado por quien estaba en sesión, en
   * grande, y el bote del local debajo. Ya no: la cifra es una sola y es la del
   * equipo, para todos. Es decisión de Gonzalo, y dicha con sus palabras —
   * «quiero que aparezcan las propinas de todos, no individuales, ya que se
   * supone que un restaurante es un equipo, no individual».
   *
   * Tiene su razón operativa. La propina se reparte: nadie se lleva lo que él
   * mismo recaudó, sino la parte que le toca del bote. El bote es entonces el
   * único número del que sale lo que cada quien va a cobrar, y era justo el que
   * no se podía consultar hasta el sábado.
   *
   * La cifra individual, en cambio, no decidía nada durante el turno. Lo único
   * que hacía era invitar a compararse con el de al lado en mitad del servicio
   * —quién levantó más, a quién le tocaron las mesas buenas—, que es lo
   * contrario de atender la misma sala entre todos. Mostrar el total no es
   * enseñar lo del compañero: es una suma en la que nadie queda identificado.
   *
   * Si la cifra por persona vuelve a hacer falta —para revisar un reparto o
   * explicar una raya— sigue estando en la prenómina, renglón por trabajador y
   * con la semana completa delante, que es donde de verdad se usa.
   *
   * QUIÉN VE EL PANEL lo siguen decidiendo los permisos, no esta pantalla:
   * `rrhh.propina.ver` o `rrhh.propina.ver_local`. Lo que ya no cambian es QUÉ
   * cifra se ve: el piso y la gerencia miran exactamente el mismo número.
   */
  import { propinasAcumuladas } from "@motrest/dominio";
  import { mxn } from "../formato";
  import { local } from "../local.svelte";
  import { pos } from "../pos.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  const puedeVer = $derived(
    sesion.puedeVer("rrhh.propina.ver") || sesion.puedeVer("rrhh.propina.ver_local"),
  );

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

  /**
   * El bote entero del local: lo que entre todos se recaudó.
   *
   * Sin filtrar por trabajador a propósito — ese `undefined` es la decisión de
   * arriba hecha código, y no depende de quién esté en sesión.
   */
  const bote = $derived(
    propinasAcumuladas(pos.todasLasComandas, ahora, local.horaCorte, undefined),
  );
</script>

{#if puedeVer}
  <section class="propinas" aria-label="Propinas acumuladas del equipo">
    <div class="titulo">
      <span>Propinas</span>
      <!--
        Se dice SIEMPRE de quién son las cifras, aunque ahora la respuesta sea
        una sola. Un número de dinero sin dueño escrito se lee como propio, y
        quien lo tome por suyo se llevará un disgusto el día del reparto.
      -->
      <b class="alcance">del equipo</b>
    </div>

    <div class="cifra">
      <span>Hoy</span>
      <b>{mxn(bote.dia)}</b>
    </div>
    <div class="cifra tenue">
      <span>Semana</span>
      <b>{mxn(bote.semana)}</b>
    </div>
    <div class="cifra tenue">
      <span>Quincena</span>
      <b>{mxn(bote.quincena)}</b>
    </div>

    <p class="pie">
      {#if bote.cuentasDelDia === 0}
        Todavía no hay cuentas cobradas con propina hoy.
      {:else}
        {bote.cuentasDelDia}
        {bote.cuentasDelDia === 1 ? "cuenta cobrada" : "cuentas cobradas"} con propina.
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
