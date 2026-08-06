<script lang="ts">
  /**
   * El consolidado del grupo (F4 · multisucursal).
   *
   * LO PRIMERO QUE SE PINTA ES LO QUE FALTA, y no el total. Un local que vendió
   * $40 000 y no reportó no es un local que vendió cero: si el consolidado suma
   * lo que tiene y lo presenta como el total del grupo, el dueño decide con un
   * número que no existe. Con el hueco a la vista, pregunta.
   *
   * Y LA SEGUNDA PREGUNTA NO ES "CUÁNTO VENDIMOS". Es cuál de mis locales tiene
   * un problema. Por eso la salud del grupo va antes que las cifras: quien abre
   * esto por la mañana viene a eso.
   */
  import { grupo, inicioDeJornada } from "../../grupo.svelte";
  import { mxn, pct } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeVer = $derived(sesion.puedeVer("fin.corte.ver"));
  const c = $derived(grupo.consolidado);
  const comparativa = $derived(grupo.comparativa);
  const salud = $derived(grupo.salud);

  const problemas = $derived(salud.filter((s) => s.estado !== "al_dia"));

  function dia(ts: number): string {
    return new Date(ts).toLocaleDateString("es-MX", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>El grupo</h1>
      <p class="sub">
        Cada local calcula lo suyo y manda su jornada cerrada. Aquí solo se juntan.
      </p>
    </div>

    {#if grupo.jornadas.length > 0}
      <select bind:value={grupo.dia}>
        {#each grupo.jornadas as j (j)}
          <option value={j}>{dia(j)}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if !puedeVer}
    <p class="sin-permiso">Tu rol no tiene acceso a las cifras del grupo.</p>
  {:else if !grupo.esGrupo}
    <div class="aviso">
      <b>Este local no pertenece a un grupo.</b>
      Esta pantalla junta las cifras de varias sucursales. Se configuran desde
      Administración cuando hay más de un local.
    </div>
  {:else}
    <!--
      EL HUECO PRIMERO. Es el dato más importante de la pantalla: dice cuánto NO
      se está viendo. Ponerlo debajo del total sería enseñar la conclusión antes
      que la advertencia.
    -->
    {#if !c.completo}
      <div class="incompleto" role="alert">
        <b>Faltan {c.sin_reportar.length} de {c.sin_reportar.length + c.renglones.length} locales</b>
        No reportaron esta jornada: <b>{c.sin_reportar.map((s) => s.nombre).join(", ")}</b>.
        Los totales de abajo son solo de los que sí reportaron.
      </div>
    {/if}

    {#if problemas.length > 0}
      <h2>Qué revisar</h2>
      <ul class="problemas">
        {#each problemas as s (s.sucursal_id)}
          <li class:grave={s.estado === "sin_señal"}>
            <b>{s.nombre}</b>
            {#if s.estado === "sin_señal"}
              lleva más de un día sin dar señales
            {:else}
              todavía no cierra su jornada
            {/if}
            {#if s.ultima_diferencia !== undefined && s.ultima_diferencia !== 0}
              · último arqueo {mxn(s.ultima_diferencia)}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>{c.completo ? "El grupo" : "Los que reportaron"}</h2>
    <div class="cifras">
      <div class="cifra destacada">
        <b>{mxn(c.ventas)}</b><span>vendido</span>
      </div>
      <div class="cifra"><b>{c.cuentas}</b><span>cuentas</span></div>
      <div class="cifra"><b>{mxn(c.ticket_promedio)}</b><span>ticket promedio</span></div>
      <div class="cifra"><b>{pct(c.margen)}</b><span>margen</span></div>
    </div>

    <h2>Local por local</h2>
    {#if c.renglones.length === 0}
      <p class="vacio">Ningún local ha reportado esta jornada todavía.</p>
    {:else}
      <div class="tabla">
        <table>
          <thead>
            <tr>
              <th>Local</th>
              <th class="num">Venta</th>
              <th class="num">Parte</th>
              <th class="num">Cuentas</th>
              <th class="num">Ticket</th>
              <th class="num">Margen</th>
              <th class="num">Arqueo</th>
            </tr>
          </thead>
          <tbody>
            {#each comparativa as s (s.sucursal_id)}
              {@const r = c.renglones.find((x) => x.sucursal_id === s.sucursal_id)}
              <tr>
                <td>{s.nombre}</td>
                <td class="num">{mxn(s.ventas)}</td>
                <td class="num tenue">{pct(s.participacion)}</td>
                <td class="num tenue">{r?.cuentas ?? 0}</td>
                <td class="num">{mxn(s.ticket_promedio)}</td>
                <!--
                  El margen se compara entre locales, no contra un ideal. Uno en
                  plaza chica que vende la mitad con mejor margen lo está haciendo
                  mejor que uno grande que factura mucho y no deja nada.
                -->
                <td class="num" class:bien={s.margen > c.margen}>{pct(s.margen)}</td>
                <td
                  class="num"
                  class:mal={r?.diferencia_arqueo !== undefined && r.diferencia_arqueo < 0}
                >
                  {r?.diferencia_arqueo === undefined ? "—" : mxn(r.diferencia_arqueo)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if c.sin_reportar.length > 0}
      <ul class="faltantes">
        {#each c.sin_reportar as s (s.sucursal_id)}
          <li>{s.nombre} — sin reportar</li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .seccion {
    padding: 1.25rem 1.5rem 3rem;
    overflow-y: auto;
    flex: 1;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.3rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.4rem;
    margin: 0 0 0.15rem;
    color: var(--pizarra);
  }
  .sub {
    font-size: 0.82rem;
    color: var(--gris);
    margin: 0;
  }
  select {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  h2 {
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.7rem 0 0.6rem;
  }
  .sin-permiso,
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
  }
  .aviso {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .aviso b {
    display: block;
    margin-bottom: 0.2rem;
  }
  /* Rojo y arriba del todo: es una advertencia sobre los números de abajo. */
  .incompleto {
    background: #fdeae8;
    border: 1.5px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.75rem 0.95rem;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .incompleto > b:first-child {
    display: block;
    color: var(--peligro);
    margin-bottom: 0.15rem;
  }
  .problemas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .problemas li {
    font-size: 0.85rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-left: 3px solid var(--acento-2);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.75rem;
    color: var(--pizarra);
  }
  .problemas li.grave {
    border-left-color: var(--peligro);
  }
  .cifras {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.55rem;
  }
  .cifra {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.8rem 0.9rem;
  }
  .cifra b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    color: var(--pizarra);
  }
  .cifra span {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .cifra.destacada b {
    color: var(--acento);
  }
  /* La tabla desborda en horizontal DENTRO de su caja, nunca la página. */
  .tabla {
    overflow-x: auto;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    min-width: 40rem;
  }
  th,
  td {
    padding: 0.55rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--borde);
  }
  th {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    font-weight: 700;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .tenue {
    color: var(--gris);
  }
  .bien {
    color: #1e6b4a;
    font-weight: 600;
  }
  .mal {
    color: var(--peligro);
    font-weight: 600;
  }
  .faltantes {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    font-size: 0.8rem;
    color: var(--gris);
  }
</style>
