<script lang="ts">
  /**
   * Cómo está este restaurante frente a los que se le parecen (F5).
   *
   * LA PANTALLA EMPIEZA POR EL PERMISO, no por los números. Compartir las cifras
   * de un restaurante es una decisión del dueño y tiene que ser explícita: si se
   * enseñara el comparativo antes de preguntarle, ya se habrían usado sus datos.
   *
   * Y cuando hay comparativo, arriba van **las tres cosas que arreglar**, no la
   * tabla. Una tabla de seis indicadores se mira y se olvida; tres frases con lo
   * que está peor se accionan.
   */
  import {
    INDICADORES,
    compararConElMercado,
    deCentavos,
    dondeGanarMas,
    puedeRecibirComparativo,
    type AporteAnonimo,
    type PosicionIndicador,
  } from "@motrest/dominio";
  import { benchmark } from "../../benchmark.svelte";
  import { mxn, pct } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeVer = $derived(sesion.puedeVer("bi.reporte.ver"));
  const puedeDecidir = $derived(sesion.puedeOperar("cat.producto.editar"));

  const permiso = $derived(puedeRecibirComparativo(benchmark.consentimiento));
  const resultado = $derived(
    permiso.puede && benchmark.propio
      ? compararConElMercado(benchmark.propio as AporteAnonimo, benchmark.muestra)
      : null,
  );
  const foco = $derived(resultado ? dondeGanarMas(resultado) : []);

  function valor(p: PosicionIndicador, dato: number): string {
    const def = INDICADORES.find((i) => i.id === p.indicador)!;
    // Los percentiles se interpolan, así que el ticket promedio del grupo puede
    // caer entre dos centavos. Se redondea al centavo antes de darlo por dinero.
    if (def.formato === "dinero") return mxn(deCentavos(Math.round(dato)));
    if (def.formato === "porcentaje") return pct(dato);
    return dato.toFixed(1);
  }
</script>

<div class="seccion">
  <h1>Cómo va su restaurante</h1>
  <p class="sub">Frente a locales del mismo tipo, tamaño y estado. Siempre anónimo.</p>

  {#if !puedeVer}
    <p class="vacio">Tu rol no tiene acceso a los reportes.</p>
  {:else if !permiso.puede}
    <!--
      El permiso primero. Se explica qué se comparte y qué NO, porque la
      pregunta real del restaurantero es "¿va a ver alguien mis ventas?".
    -->
    <div class="permiso">
      <h2>Compare su restaurante con otros</h2>
      <p>{permiso.razon}</p>

      <ul class="promesa">
        <li><b>Nunca sale su nombre</b>, ni el de su local, ni su dirección.</li>
        <li>
          <b>Nadie ve un dato suyo.</b> Solo se calculan medianas de grupos de al menos
          cinco restaurantes: ni el mejor ni el peor se publican jamás.
        </li>
        <li><b>Se apaga cuando quiera</b>, y desde ese momento deja de aportar.</li>
      </ul>

      {#if puedeDecidir}
        <button class="activar" onclick={() => benchmark.activar()}>
          Participar y ver mi comparativo
        </button>
      {:else}
        <p class="nota">Esta decisión la toma la dirección del restaurante.</p>
      {/if}
    </div>
  {:else if !resultado || !resultado.hay}
    <div class="esperando">
      <b>Todavía no hay suficientes restaurantes parecidos al suyo.</b>
      <p>{resultado?.hay === false ? resultado.razon : "Aún no se ha calculado el comparativo."}</p>
      <p class="nota">
        En cuanto haya bastantes, aparece aquí. Mientras tanto sus datos ya están
        contando para el grupo.
      </p>
    </div>
  {:else}
    <p class="muestra">
      Comparado con <b>{resultado.participantes}</b> restaurantes parecidos al suyo.
    </p>

    <h2>Dónde hay más que ganar</h2>
    <ul class="foco">
      {#each foco as p (p.indicador)}
        <li class="c{p.cuartil}">
          <span class="que">{p.etiqueta}</span>
          <span class="lectura">{p.lectura}</span>
          <span class="cifras">
            Usted <b>{valor(p, p.propio)}</b> · la mitad de los locales
            <b>{valor(p, p.mediana)}</b>
          </span>
        </li>
      {/each}
    </ul>

    <h2>Todo el detalle</h2>
    <div class="tabla">
      <table>
        <thead>
          <tr>
            <th>Indicador</th>
            <th class="num">Usted</th>
            <th class="num">La mitad</th>
            <th class="num">El 25 % mejor</th>
            <th>Cómo va</th>
          </tr>
        </thead>
        <tbody>
          {#each resultado.posiciones as p (p.indicador)}
            {@const def = INDICADORES.find((i) => i.id === p.indicador)!}
            <tr>
              <td>{p.etiqueta}</td>
              <td class="num propio c{p.cuartil}">{valor(p, p.propio)}</td>
              <td class="num tenue">{valor(p, p.mediana)}</td>
              <!--
                Se enseña el percentil que es MEJOR según el indicador: en un
                costo, el 25 % más bajo; en el ticket, el 25 % más alto. Enseñar
                siempre el p25 haría leer "peor" como "mejor" en la mitad de las filas.
              -->
              <td class="num tenue">{valor(p, def.masEsMejor ? p.p75 : p.p25)}</td>
              <td class="barra">
                <span class="pip c{p.cuartil}"></span>
                {p.cuartil === 1 ? "De los mejores" : p.cuartil === 2 ? "Mejor que la mitad" : p.cuartil === 3 ? "Por debajo" : "De los últimos"}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if puedeDecidir}
      <button class="salir" onclick={() => benchmark.desactivar()}>
        Dejar de participar
      </button>
    {/if}
  {/if}
</div>

<style>
  .seccion {
    padding: 1.25rem 1.5rem 3rem;
    overflow-y: auto;
    flex: 1;
    max-width: 58rem;
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
    margin: 0 0 1.4rem;
  }
  h2 {
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.7rem 0 0.6rem;
  }
  .vacio,
  .nota {
    font-size: 0.84rem;
    color: var(--gris);
  }
  .permiso,
  .esperando {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 1.2rem 1.3rem;
  }
  .permiso h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
    text-transform: none;
    letter-spacing: 0;
    color: var(--pizarra);
    font-family: var(--font-titulo);
  }
  .permiso p,
  .esperando p {
    font-size: 0.88rem;
    line-height: 1.6;
    color: var(--pizarra);
    margin: 0 0 0.8rem;
  }
  .esperando b {
    display: block;
    margin-bottom: 0.3rem;
    color: var(--pizarra);
  }
  .promesa {
    list-style: none;
    margin: 0 0 1.1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .promesa li {
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--pizarra);
    padding-left: 1.1rem;
    position: relative;
  }
  .promesa li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.5rem;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--acento);
  }
  button {
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    min-height: 2.6rem;
    padding: 0 1.2rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .activar {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
  }
  .salir {
    margin-top: 2rem;
    color: var(--gris);
    border: none;
  }
  .salir:hover {
    color: var(--peligro);
  }
  .muestra {
    font-size: 0.85rem;
    color: var(--gris);
    margin: 0;
  }
  .foco {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .foco li {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-left: 3px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .que {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .lectura {
    font-size: 0.92rem;
    color: var(--pizarra);
  }
  .cifras {
    font-size: 0.8rem;
    color: var(--gris);
  }
  /*
   * Verde para lo que va bien y rojo para lo que va mal, con el ámbar en medio.
   * El color es lo único que se lee de un vistazo en una tabla de seis filas.
   */
  .c1 { border-left-color: #2f9e6b; }
  .c2 { border-left-color: #7bbf8f; }
  .c3 { border-left-color: var(--acento-2); }
  .c4 { border-left-color: var(--peligro); }

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
    min-width: 38rem;
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
  .propio {
    font-weight: 700;
    border-left: none;
  }
  .propio.c1 { color: #1e6b4a; }
  .propio.c4 { color: var(--peligro); }
  .tenue {
    color: var(--gris);
  }
  .barra {
    font-size: 0.8rem;
    color: var(--gris);
    white-space: nowrap;
  }
  .pip {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.4rem;
    background: var(--borde);
    border-left: none;
  }
  .pip.c1 { background: #2f9e6b; }
  .pip.c2 { background: #7bbf8f; }
  .pip.c3 { background: var(--acento-2); }
  .pip.c4 { background: var(--peligro); }
</style>
