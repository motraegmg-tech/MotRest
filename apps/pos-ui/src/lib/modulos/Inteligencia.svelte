<script lang="ts">
  /**
   * M8 · Inteligencia: qué se vendió, quién lo vendió y a qué hora.
   *
   * Todo se PROYECTA del event log; no hay una tabla de reportes que mantener.
   * Los costos y los márgenes solo se calculan para quien puede verlos, con la
   * misma regla que el menú: el dato no viaja si no corresponde.
   */
  import {
    CONSEJOS_CLASE,
    ETIQUETAS_CLASE,
    conteoPorClase,
    cuentasCerradasEn,
    diaDe,
    menuEngineering,
    resumenVentas,
    ventasPorHora,
    ventasPorMesero,
    ventasPorProducto,
  } from "@motrest/dominio";
  import { mxn, pct } from "../formato";
  import { pos } from "../pos.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  type Periodo = "hoy" | "todo";
  let periodo = $state<Periodo>("hoy");

  const verCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  const comandas = $derived(
    cuentasCerradasEn(pos.todasLasComandas, periodo === "hoy" ? diaDe(Date.now()) : undefined),
  );

  const resumen = $derived(resumenVentas(comandas));
  const productos = $derived(ventasPorProducto(comandas));
  const meseros = $derived(ventasPorMesero(comandas));
  const horas = $derived(ventasPorHora(comandas));
  const clasificados = $derived(menuEngineering(productos));
  const conteo = $derived(conteoPorClase(clasificados));

  /** Escala de las barras: la hora más fuerte marca el 100 %. */
  const pico = $derived(Math.max(1, ...horas.map((h) => h.importe)));
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Inteligencia</h1>
      <p class="sub">
        Derivado de la operación registrada, sin capturar nada aparte.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={periodo === "hoy"} onclick={() => (periodo = "hoy")}>Hoy</button>
      <button class:on={periodo === "todo"} onclick={() => (periodo = "todo")}>Histórico</button>
    </div>
  </div>

  {#if resumen.cuentas === 0}
    <p class="vacio">
      Todavía no hay cuentas cobradas {periodo === "hoy" ? "hoy" : ""}. Los
      reportes aparecen conforme se cierran cuentas.
    </p>
  {:else}
    <!-- Indicadores -->
    <div class="indicadores">
      <div class="dato">
        <span class="etiqueta">Vendido</span>
        <b>{mxn(resumen.total)}</b>
        <small>{resumen.cuentas} cuentas · {resumen.platillos} platillos</small>
      </div>
      <div class="dato">
        <span class="etiqueta">Ticket promedio</span>
        <b>{mxn(resumen.ticketPromedio)}</b>
      </div>
      {#if verCostos}
        <div class="dato">
          <span class="etiqueta">Food cost</span>
          <b class:alerta={resumen.foodCost > 0.35}>{pct(resumen.foodCost)}</b>
          <small>costo {mxn(resumen.costo)}</small>
        </div>
        <div class="dato">
          <span class="etiqueta">Margen bruto</span>
          <b>{mxn(resumen.margen)}</b>
        </div>
      {/if}
      <div class="dato">
        <span class="etiqueta">Propinas</span>
        <b>{mxn(resumen.propinas)}</b>
      </div>
    </div>

    {#if resumen.descuentos > 0 || resumen.cortesias > 0}
      <p class="nota">
        Se rebajaron {mxn(resumen.descuentos)} en descuentos y {mxn(resumen.cortesias)}
        en cortesías. El IVA se calcula sobre lo efectivamente cobrado.
      </p>
    {/if}

    <div class="columnas">
      <!-- Curva del día -->
      <section class="tarjeta">
        <h2>Ventas por hora</h2>
        <p class="ayuda">Dónde están los picos: es la base para dotar turnos.</p>
        <div class="curva">
          {#each horas as h (h.hora)}
            <div class="barra-fila">
              <span class="etiqueta-h">{String(h.hora).padStart(2, "0")}:00</span>
              <div class="pista-barra">
                <div class="barra" style="width: {(h.importe / pico) * 100}%"></div>
              </div>
              <span class="valor">{mxn(h.importe)}</span>
              <span class="cuentas">{h.cuentas}</span>
            </div>
          {/each}
        </div>
      </section>

      <!-- Meseros -->
      <section class="tarjeta">
        <h2>Por mesero</h2>
        <table>
          <thead>
            <tr>
              <th>Mesero</th>
              <th class="num">Cuentas</th>
              <th class="num">Vendido</th>
              <th class="num">Ticket</th>
              <th class="num">Propina</th>
            </tr>
          </thead>
          <tbody>
            {#each meseros as m (m.mesero_id)}
              <tr>
                <td><b>{sesion.nombreDe(m.mesero_id)}</b></td>
                <td class="num">{m.cuentas}</td>
                <td class="num">{mxn(m.importe)}</td>
                <td class="num tenue">{mxn(m.ticketPromedio)}</td>
                <td class="num">{m.propinaPct > 0 ? pct(m.propinaPct) : "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    </div>

    <!-- Productos -->
    <section class="tarjeta">
      <h2>Productos vendidos</h2>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th class="num">Unidades</th>
            <th class="num">Importe</th>
            {#if verCostos}
              <th class="num">Margen</th>
              <th class="num">%</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each productos as p (p.producto_id)}
            <tr>
              <td><b>{p.descripcion}</b></td>
              <td class="num">{p.unidades}</td>
              <td class="num">{mxn(p.importe)}</td>
              {#if verCostos}
                <td class="num">{mxn(p.margen)}</td>
                <td class="num" class:alerta={p.margenPct < 0.55}>{pct(p.margenPct)}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <!-- Menu engineering -->
    {#if verCostos && clasificados.length > 0}
      <section class="tarjeta">
        <h2>Ingeniería de menú</h2>
        <p class="ayuda">
          Cada platillo cruzado por lo que se vende contra lo que deja. La
          popularidad se mide en unidades; la rentabilidad, contra el margen
          promedio de tu propia carta — no contra un porcentaje de manual.
        </p>

        <div class="cuadrantes">
          {#each ["estrella", "caballo", "rompecabezas", "perro"] as const as clase (clase)}
            <div class="cuadrante {clase}">
              <div class="cab-cuadrante">
                <b>{ETIQUETAS_CLASE[clase]}</b>
                <span>{conteo[clase]}</span>
              </div>
              <p class="consejo">{CONSEJOS_CLASE[clase]}</p>
              <ul>
                {#each clasificados.filter((c) => c.clase === clase) as p (p.producto_id)}
                  <li>
                    <span class="nom">{p.descripcion}</span>
                    <span class="det">{p.unidades} u · {mxn(p.margen)}</span>
                  </li>
                {:else}
                  <li class="ninguno">—</li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </section>
    {:else if !verCostos}
      <p class="nota">
        La ingeniería de menú necesita costos, y tu perfil no tiene acceso a ellos.
      </p>
    {/if}
  {/if}
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 76rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 15rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
  }
  .pestanas {
    display: flex;
    gap: 0.3rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.2rem;
  }
  .pestanas button {
    padding: 0.4rem 0.9rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
  }
  .pestanas button.on {
    background: var(--acento);
    color: #fff;
  }
  .indicadores {
    display: flex;
    gap: 0.85rem;
    flex-wrap: wrap;
  }
  .dato {
    flex: 1;
    min-width: 9.5rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
  }
  .etiqueta {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .dato b {
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    margin-top: 0.15rem;
  }
  .dato small {
    font-size: 0.74rem;
    color: var(--gris);
    margin-top: 0.1rem;
  }
  .alerta {
    color: var(--peligro);
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .columnas {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
  }
  .ayuda {
    margin: 0.25rem 0 0.85rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .curva {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .barra-fila {
    display: grid;
    grid-template-columns: 3.2rem 1fr 5.5rem 2rem;
    align-items: center;
    gap: 0.5rem;
  }
  .etiqueta-h {
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    color: var(--gris);
  }
  .pista-barra {
    background: var(--fondo);
    border-radius: var(--r-pill);
    height: 0.85rem;
    overflow: hidden;
  }
  .barra {
    height: 100%;
    background: var(--acento);
    border-radius: var(--r-pill);
    min-width: 2px;
  }
  .valor {
    text-align: right;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .cuentas {
    text-align: right;
    font-size: 0.76rem;
    color: var(--gris);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.7rem;
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
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .tenue {
    color: var(--gris);
  }
  .cuadrantes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.75rem;
  }
  .cuadrante {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 0.9rem;
  }
  .cuadrante.estrella {
    border-color: var(--acento);
  }
  .cuadrante.caballo {
    border-color: var(--acento-2);
  }
  .cuadrante.perro {
    border-color: var(--peligro);
  }
  .cab-cuadrante {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .cab-cuadrante b {
    flex: 1;
    font-family: var(--font-titulo);
    font-size: 0.98rem;
  }
  .cab-cuadrante span {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--gris);
  }
  .consejo {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.45;
    margin: 0.3rem 0 0.6rem;
  }
  .cuadrante ul {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .cuadrante li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.82rem;
    border-top: 1px solid var(--borde);
    padding-top: 0.3rem;
  }
  .cuadrante li.ninguno {
    color: var(--gris);
    justify-content: center;
  }
  .cuadrante .nom {
    flex: 1;
    font-weight: 600;
  }
  .cuadrante .det {
    font-size: 0.74rem;
    color: var(--gris);
    white-space: nowrap;
  }
  .vacio {
    font-size: 0.9rem;
    color: var(--gris);
    font-style: italic;
  }
</style>
