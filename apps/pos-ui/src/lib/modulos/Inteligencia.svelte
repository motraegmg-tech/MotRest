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
    DIAS_SEMANA,
    MOTIVOS_OPINION,
    centinelaMermas,
    conteoPorClase,
    consejoMerma,
    cuentasCerradasEn,
    formatearCantidad,
    menuEngineering,
    pronosticoDemanda,
    resumenVentas,
    simular,
    ventasPorHora,
    ventasPorMesero,
    ventasPorProducto,
  } from "@motrest/dominio";
  import VentanaAmplia from "../VentanaAmplia.svelte";
  import { mxn, pct } from "../formato";
  import { inventario } from "../inventario.svelte";
  import { local } from "../local.svelte";
  import { opiniones } from "../opiniones.svelte";
  import { pos } from "../pos.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  type Periodo = "hoy" | "todo";
  let periodo = $state<Periodo>("hoy");

  const verCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  // La jornada del local, no el día natural: el servicio que cruza la
  // medianoche pertenece a la noche en que empezó.
  const rango = $derived(periodo === "hoy" ? local.jornadaActual : null);

  const comandas = $derived(
    cuentasCerradasEn(pos.todasLasComandas, rango ?? undefined),
  );

  const resumen = $derived(resumenVentas(comandas));
  const productos = $derived(ventasPorProducto(comandas));

  /**
   * Cuántos renglones se enseñan en la tarjeta antes de pedir «Ver más».
   *
   * Doce productos entran en pantalla sin cortar y cubren la carta de un local
   * pequeño entera. Por encima de eso lo que importa no es la lista completa
   * sino los primeros, que ya vienen ordenados por lo que más se vende; el resto
   * se mira cuando se quiere mirar, en la ventana.
   */
  const TOPE_PRODUCTOS = 12;
  const TOPE_CUADRANTE = 6;
  const TOPE_MERMAS = 8;
  const TOPE_QUEJAS = 3;
  const TOPE_SIMULADOR = 10;

  /**
   * Qué lista se está viendo completa, o `null` si ninguna.
   *
   * Una sola a la vez y en una ventana aparte: desplegarlas dentro de la tarjeta
   * empujaba el resto de la pantalla y obligaba a recorrerla entera para volver
   * a lo que se estaba mirando.
   */
  let ampliado = $state<
    null | "productos" | "menu" | "mermas" | "quejas" | "simulador"
  >(null);

  const productosVisibles = $derived(productos.slice(0, TOPE_PRODUCTOS));
  const meseros = $derived(ventasPorMesero(comandas));
  const horas = $derived(ventasPorHora(comandas));
  const clasificados = $derived(menuEngineering(productos));
  const conteo = $derived(conteoPorClase(clasificados));
  /** ¿Algún cuadrante tiene más platillos de los que caben en la tarjeta? */
  const hayMasEnMenu = $derived(
    (["estrella", "caballo", "rompecabezas", "perro"] as const).some(
      (clase) => conteo[clase] > TOPE_CUADRANTE,
    ),
  );

  // Centinela de mermas (C5): se calcula sobre los movimientos del mismo
  // periodo, para que la fuga cuadre con las ventas que se están mirando.
  const eventosInv = $derived(
    rango
      ? inventario.movimientos.filter((e) => e.ts >= rango.desde && e.ts < rango.hasta)
      : inventario.movimientos,
  );
  const centinela = $derived(
    verCostos ? centinelaMermas(eventosInv, inventario.insumos) : null,
  );

  // Pronóstico (C3): aprende de TODA la historia, no del periodo elegido — un
  // patrón semanal necesita varias semanas para verse.
  const pronostico = $derived(
    pronosticoDemanda(cuentasCerradasEn(pos.todasLasComandas), {
      horaCorte: local.horaCorte,
    }),
  );
  const ventaPico = $derived(Math.max(1, ...pronostico.proximos.map((d) => d.venta_esperada)));

  function horaTexto(h: number | null): string {
    return h === null ? "—" : `${String(h).padStart(2, "0")}:00`;
  }
  function diaCorto(dow: number): string {
    return DIAS_SEMANA[dow]!.slice(0, 3);
  }
  function fechaCorta(ts: number): string {
    return new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  // --- Voz del cliente (C4) -----------------------------------------------------------
  const voz = $derived(opiniones.resumen);
  const espera = $derived(opiniones.efectoEspera());

  function etiquetaMotivo(m: string): string {
    return MOTIVOS_OPINION.find((x) => x.valor === m)?.etiqueta ?? m;
  }

  // --- Simulador de escenarios (C1) ---------------------------------------------------
  let simProducto = $state("");
  let simPrecio = $state(0);
  let simCosto = $state(0);
  let simVolumen = $state(0);

  /** Días que cubre el periodo, para poder proyectar el efecto a un mes. */
  const diasPeriodo = $derived.by(() => {
    if (periodo === "hoy") return 1;
    const cerradas = comandas.map((c) => c.cerrada_ts ?? c.abierta_ts);
    if (cerradas.length === 0) return 1;
    const span = Math.max(...cerradas) - Math.min(...cerradas);
    return Math.max(1, Math.ceil(span / 86_400_000));
  });

  const escenario = $derived(
    simular(
      productos,
      {
        producto_id: simProducto || undefined,
        precio_pct: simPrecio,
        costo_pct: simCosto,
        volumen_pct: simVolumen,
      },
      { dias: diasPeriodo },
    ),
  );

  const hayCambio = $derived(simPrecio !== 0 || simCosto !== 0 || simVolumen !== 0);
  const afectados = $derived(escenario.renglones.filter((r) => r.afectado && r.delta !== 0));

  function limpiarSim() {
    simProducto = "";
    simPrecio = 0;
    simCosto = 0;
    simVolumen = 0;
  }

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
        <span class="etiqueta">Vendido (con IVA)</span>
        <b>{mxn(resumen.total)}</b>
        <small>
          {resumen.cuentas} cuentas · {resumen.platillos} platillos ·
          sin IVA {mxn(resumen.subtotal)}
        </small>
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

    <!-- Pronóstico de demanda (C3) -->
    <section class="tarjeta">
      <div class="cab-centinela">
        <h2>Pronóstico de demanda</h2>
        {#if !pronostico.listo}
          <span class="aprendiendo">
            Aprendiendo · {pronostico.dias_observados}
            {pronostico.dias_observados === 1 ? "día observado" : "días observados"}
          </span>
        {/if}
      </div>
      <p class="ayuda">
        Lo que viene, aprendido del patrón del propio local: cada día se proyecta
        con el promedio de los días de ese tipo ya vistos. Un viernes no se dota
        como un martes. {#if !pronostico.listo}Con una semana completa gana confianza.{/if}
      </p>

      <div class="semana">
        {#each pronostico.proximos as d, i (d.fecha)}
          <div class="dia-pron" class:hoy={i === 0} class:sin-dato={d.cuentas_esperadas === 0}>
            <div class="dia-cab">
              <b>{i === 0 ? "Hoy" : diaCorto(d.dia_semana)}</b>
              <small>{fechaCorta(d.fecha)}</small>
            </div>
            {#if d.cuentas_esperadas > 0}
              <div class="barra-pron">
                <div class="relleno" style="height: {(d.venta_esperada / ventaPico) * 100}%"></div>
              </div>
              <div class="dia-num">
                <span class="cuentas-pron">{d.cuentas_esperadas} <em>cuentas</em></span>
                <span class="venta-pron">{mxn(d.venta_esperada)}</span>
                <span class="pico-pron">pico {horaTexto(d.hora_pico)}</span>
                <span class="conf {d.confianza}">{d.confianza}</span>
              </div>
            {:else}
              <div class="barra-pron"><div class="relleno vacio-barra"></div></div>
              <div class="dia-num"><span class="sin">Sin historia</span></div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

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
              <th class="num">Vendido (con IVA)</th>
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
    {#snippet tablaProductos(lista: typeof productos)}
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th class="num">Unidades</th>
            <th class="num">Vendido (con IVA)</th>
            {#if verCostos}
              <th class="num">Margen</th>
              <th class="num">%</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each lista as p (p.producto_id)}
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
    {/snippet}

    <section class="tarjeta">
      <h2>Productos vendidos</h2>
      {@render tablaProductos(productosVisibles)}
      <!--
        VER MÁS, con la cuenta de lo que falta.
        La tabla se cortaba y no había forma de saber si debajo quedaban tres
        productos o cuarenta: la carta entera parecía ser lo que cupiera en la
        pantalla. Decir cuántos faltan es la mitad del arreglo.
      -->
      {#if productos.length > TOPE_PRODUCTOS}
        <button class="ver-todo" onclick={() => (ampliado = "productos")}>
          Ver más ({productos.length - TOPE_PRODUCTOS} productos más)
        </button>
      {/if}
    </section>

    <!-- Menu engineering -->
    {#snippet cuadrantesMenu(tope: number)}
      <div class="cuadrantes">
        {#each ["estrella", "caballo", "rompecabezas", "perro"] as const as clase (clase)}
          {@const dela = clasificados.filter((c) => c.clase === clase)}
          <div class="cuadrante {clase}">
            <div class="cab-cuadrante">
              <b>{ETIQUETAS_CLASE[clase]}</b>
              <span>{conteo[clase]}</span>
            </div>
            <p class="consejo">{CONSEJOS_CLASE[clase]}</p>
            <ul>
              {#each dela.slice(0, tope) as p (p.producto_id)}
                <li>
                  <span class="nom">{p.descripcion}</span>
                  <span class="det">{p.unidades} u · {mxn(p.margen)}</span>
                </li>
              {:else}
                <li class="ninguno">—</li>
              {/each}
              <!--
                Se dice cuántos quedan fuera DENTRO del cuadrante: sin esto, un
                cuadrante recortado y uno completo se ven igual, y el que decide
                qué platillo quitar de la carta se queda con media lista creyendo
                que la vio entera.
              -->
              {#if dela.length > tope}
                <li class="ninguno">+{dela.length - tope} más</li>
              {/if}
            </ul>
          </div>
        {/each}
      </div>
    {/snippet}

    {#if verCostos && clasificados.length > 0}
      <section class="tarjeta">
        <h2>Ingeniería de menú</h2>
        <p class="ayuda">
          Cada platillo cruzado por lo que se vende contra lo que deja. La
          popularidad se mide en unidades; la rentabilidad, contra el margen
          promedio de tu propia carta — no contra un porcentaje de manual.
        </p>

        {@render cuadrantesMenu(TOPE_CUADRANTE)}

        {#if hayMasEnMenu}
          <button class="ver-todo" onclick={() => (ampliado = "menu")}>
            Ver más ({clasificados.length} platillos clasificados)
          </button>
        {/if}
      </section>
    {:else if !verCostos}
      <p class="nota">
        La ingeniería de menú necesita costos, y tu perfil no tiene acceso a ellos.
      </p>
    {/if}


    <!-- Voz del cliente (C4) -->
    {#if voz.total > 0}
      <section class="tarjeta">
        <div class="cab-centinela">
          <h2>Voz del cliente</h2>
          <div class="indice-voz" class:bajo={(voz.indice ?? 0) < 70}>
            <span class="etiqueta">Satisfacción</span>
            <b>{voz.indice}<em>/100</em></b>
          </div>
        </div>
        <p class="ayuda">
          Lo que dijeron {voz.total} {voz.total === 1 ? "mesa" : "mesas"} al cobrar.
          Vale por el cruce con lo que ya sabemos de esa cuenta —cuánto esperó,
          quién la atendió—, no por el promedio suelto.
        </p>

        <div class="barras-voz">
          <div class="franja bien" style="flex: {voz.bien || 0.001}">
            {#if voz.bien > 0}{voz.bien} bien{/if}
          </div>
          <div class="franja regular" style="flex: {voz.regular || 0.001}">
            {#if voz.regular > 0}{voz.regular}{/if}
          </div>
          <div class="franja mal" style="flex: {voz.mal || 0.001}">
            {#if voz.mal > 0}{voz.mal} mal{/if}
          </div>
        </div>

        {#if voz.quejas.length > 0}
          <p class="nota">
            Lo que más se queja:
            {#each voz.quejas.slice(0, TOPE_QUEJAS) as q, i (q.motivo)}
              {i > 0 ? " · " : " "}<b>{etiquetaMotivo(q.motivo)}</b> ({q.veces})
            {/each}
          </p>
          {#if voz.quejas.length > TOPE_QUEJAS}
            <button class="ver-todo" onclick={() => (ampliado = "quejas")}>
              Ver más ({voz.quejas.length - TOPE_QUEJAS} motivos más)
            </button>
          {/if}
        {/if}

        <!--
          El cruce. Es lo que un cuadernito de comentarios no puede dar: la
          espera sale de los sellos que el KDS ya registra.
        -->
        {#if espera.caida !== null}
          <div class="cruce" class:duele={espera.caida > 15}>
            <b>
              {#if espera.caida > 15}
                La espera está costando satisfacción
              {:else}
                La espera no está pesando
              {/if}
            </b>
            <p>
              Las mesas que esperaron más de {espera.umbral_min} min calificaron
              <b>{espera.caida > 0 ? `${espera.caida} puntos peor` : "igual o mejor"}</b>
              ({espera.rapidas.indice} contra {espera.lentas.indice} sobre 100).
              Son {espera.lentas.total} de {espera.rapidas.total + espera.lentas.total} mesas.
            </p>
          </div>
        {:else}
          <p class="nota">
            Todavía no hay mesas suficientes en los dos grupos —rápidas y
            lentas— para comparar. No se saca conclusión con dos datos.
          </p>
        {/if}
      </section>
    {/if}

    <!-- Centinela de mermas (C5) -->
    {#if centinela}
      <section class="tarjeta">
        <div class="cab-centinela">
          <h2>Centinela de mermas</h2>
          <div class="marcador" class:sano={centinela.perdida_total === 0}>
            <span>Fuga del periodo</span>
            <b>{mxn(centinela.perdida_total)}</b>
          </div>
        </div>
        <p class="ayuda">
          Dónde se está yendo el dinero. Separa la <b>merma declarada</b> —lo que
          alguien registró como desperdicio— del <b>faltante de conteo</b>, que es
          lo que nadie registró y suele ser la fuga cara: sobre-porción, derrame,
          robo.
        </p>

        {#if centinela.alertas.length === 0}
          <p class="vacio">Sin mermas ni faltantes en el periodo. Nada que vigilar.</p>
        {:else}
          {#if centinela.costo_faltante_total > 0}
            <p class="nota alerta-nota">
              Hay <b>{mxn(centinela.costo_faltante_total)}</b> de faltante que el
              conteo encontró y nadie registró.
              {#if centinela.criticos > 0}
                {centinela.criticos}
                {centinela.criticos === 1 ? "insumo lo tiene" : "insumos lo tienen"}
                en nivel crítico.
              {/if}
            </p>
          {/if}
          {@render tablaMermas(centinela.alertas.slice(0, TOPE_MERMAS))}
          {#if centinela.alertas.length > TOPE_MERMAS}
            <button class="ver-todo" onclick={() => (ampliado = "mermas")}>
              Ver más ({centinela.alertas.length - TOPE_MERMAS} insumos más)
            </button>
          {/if}
        {/if}
      </section>
    {/if}

    {#snippet tablaMermas(alertas: NonNullable<typeof centinela>["alertas"])}
      <table>
        <thead>
          <tr>
            <th>Insumo</th>
            <th class="num">Merma</th>
            <th class="num">Faltante</th>
            <th class="num">Pérdida</th>
            <th class="num">Fuga</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each alertas as a (a.insumo_id)}
            <tr>
              <td>
                <span class="punto {a.severidad}"></span>
                <b>{a.nombre}</b>
              </td>
              <td class="num tenue">
                {a.merma > 0 ? formatearCantidad(a.merma, a.unidad) : "—"}
                {#if a.costo_merma > 0}<small>{mxn(a.costo_merma)}</small>{/if}
              </td>
              <td class="num" class:alerta={a.costo_faltante > 0}>
                {a.faltante > 0 ? formatearCantidad(a.faltante, a.unidad) : "—"}
                {#if a.costo_faltante > 0}<small>{mxn(a.costo_faltante)}</small>{/if}
              </td>
              <td class="num"><b>{mxn(a.perdida)}</b></td>
              <td class="num" class:alerta={a.severidad === "alta"}>{pct(a.tasa)}</td>
              <td class="consejo-celda">{consejoMerma(a)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/snippet}

    <!-- Gemelo digital: simulador de escenarios (C1) -->
    {#if verCostos && productos.length > 0}
      <section class="tarjeta">
        <h2>Simulador de escenarios</h2>
        <p class="ayuda">
          «¿Y si le subo diez pesos a la pizza?» Se aplica el cambio a lo que de
          verdad se vendió en el periodo y se ve qué pasa con el margen.
        </p>

        <div class="palancas">
          <label>
            <span>Sobre</span>
            <select bind:value={simProducto}>
              <option value="">Toda la carta</option>
              {#each productos as p (p.producto_id)}
                <option value={p.producto_id}>{p.descripcion}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Precio {simPrecio > 0 ? "+" : ""}{simPrecio} %</span>
            <input type="range" min="-30" max="30" step="1" bind:value={simPrecio} />
          </label>
          <label>
            <span>Costo {simCosto > 0 ? "+" : ""}{simCosto} %</span>
            <input type="range" min="-30" max="30" step="1" bind:value={simCosto} />
          </label>
          <label>
            <span>Volumen {simVolumen > 0 ? "+" : ""}{simVolumen} %</span>
            <input type="range" min="-50" max="50" step="1" bind:value={simVolumen} />
          </label>
        </div>

        {#if !hayCambio}
          <p class="vacio">Mueve una palanca para ver el escenario.</p>
        {:else}
          <div class="resultado-sim" class:gana={escenario.delta > 0} class:pierde={escenario.delta < 0}>
            <div>
              <span class="etiqueta">Margen del periodo</span>
              <b>{mxn(escenario.margen_base)} → {mxn(escenario.margen_sim)}</b>
            </div>
            <div class="delta-sim">
              <span class="etiqueta">Diferencia</span>
              <b>{escenario.delta > 0 ? "+" : ""}{mxn(escenario.delta)}</b>
              {#if escenario.delta_mensual !== null}
                <small>
                  ≈ {escenario.delta_mensual > 0 ? "+" : ""}{mxn(escenario.delta_mensual)} al mes
                </small>
              {/if}
            </div>
          </div>

          <!--
            El aviso más importante de la pantalla: sin un supuesto de volumen,
            el escenario asume que subir el precio no espanta a nadie — y eso
            casi nunca es cierto.
          -->
          {#if escenario.volumen_constante && simPrecio !== 0}
            <p class="nota advertencia-sim">
              Este escenario supone que se vende <b>lo mismo</b> al precio nuevo.
              Cuánto se dejará de vender no se puede saber desde el punto de
              venta; por eso abajo está el dato que sí es exacto: cuánta venta
              puedes perder antes de que el cambio deje de convenir.
            </p>
          {/if}

          {#if afectados.length > 0}
            {@render tablaSimulador(afectados.slice(0, TOPE_SIMULADOR))}
            {#if afectados.length > TOPE_SIMULADOR}
              <button class="ver-todo" onclick={() => (ampliado = "simulador")}>
                Ver más ({afectados.length - TOPE_SIMULADOR} productos más)
              </button>
            {/if}
          {/if}

          <div class="botones-sim">
            <button class="mini" onclick={limpiarSim}>Reiniciar</button>
          </div>
        {/if}
      </section>
    {/if}

    {#snippet tablaSimulador(lista: typeof afectados)}
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th class="num">Precio</th>
            <th class="num">Unidades</th>
            <th class="num">Margen</th>
            <th class="num">Aguanta perder</th>
          </tr>
        </thead>
        <tbody>
          {#each lista as r (r.producto_id)}
                  <tr>
                    <td><b>{r.descripcion}</b></td>
                    <td class="num">
                      {mxn(r.precio_base)}
                      {#if r.precio_sim !== r.precio_base}<small>→ {mxn(r.precio_sim)}</small>{/if}
                    </td>
                    <td class="num tenue">
                      {r.unidades_base}
                      {#if r.unidades_sim !== r.unidades_base}<small>→ {r.unidades_sim}</small>{/if}
                    </td>
                    <td class="num" class:alerta={r.delta < 0}>
                      {r.delta > 0 ? "+" : ""}{mxn(r.delta)}
                    </td>
                    <td class="num">
                      {#if r.caida_tolerable !== null}
                        <b class="tolera">{pct(r.caida_tolerable)}</b>
                        <small>de la venta</small>
                      {:else}
                        <span class="tenue">—</span>
                      {/if}
            </td>
          </tr>
        {/each}
        </tbody>
      </table>
    {/snippet}

    <!--
      LAS LISTAS COMPLETAS.

      Van al final del marcado y no dentro de cada tarjeta: la ventana se dibuja
      sobre toda la pantalla, así que colgarla del sitio donde está el botón solo
      la ataría al scroll de una tarjeta que en ese momento no se ve.
    -->
    {#if ampliado === "productos"}
      <VentanaAmplia
        titulo="Productos vendidos"
        subtitulo="{productos.length} productos · {periodo === 'hoy' ? 'la jornada de hoy' : 'todo el histórico'}"
        onCerrar={() => (ampliado = null)}
      >
        {@render tablaProductos(productos)}
      </VentanaAmplia>
    {:else if ampliado === "menu"}
      <VentanaAmplia
        titulo="Ingeniería de menú"
        subtitulo="{clasificados.length} platillos · popularidad contra margen de tu propia carta"
        onCerrar={() => (ampliado = null)}
      >
        {@render cuadrantesMenu(Number.POSITIVE_INFINITY)}
      </VentanaAmplia>
    {:else if ampliado === "mermas" && centinela}
      <VentanaAmplia
        titulo="Centinela de mermas"
        subtitulo="{centinela.alertas.length} insumos con merma o faltante · fuga de {mxn(centinela.perdida_total)}"
        onCerrar={() => (ampliado = null)}
      >
        {@render tablaMermas(centinela.alertas)}
      </VentanaAmplia>
    {:else if ampliado === "quejas"}
      <VentanaAmplia
        titulo="Lo que más se queja"
        subtitulo="{voz.total} {voz.total === 1 ? 'mesa opinó' : 'mesas opinaron'} en el periodo"
        onCerrar={() => (ampliado = null)}
      >
        <ul class="lista-quejas">
          {#each voz.quejas as q (q.motivo)}
            <li>
              <b>{etiquetaMotivo(q.motivo)}</b>
              <span>{q.veces} {q.veces === 1 ? "vez" : "veces"}</span>
            </li>
          {/each}
        </ul>
      </VentanaAmplia>
    {:else if ampliado === "simulador"}
      <VentanaAmplia
        titulo="Simulador de escenarios"
        subtitulo="{afectados.length} productos afectados por el escenario"
        onCerrar={() => (ampliado = null)}
      >
        {@render tablaSimulador(afectados)}
      </VentanaAmplia>
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
  .cab-centinela {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .marcador {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.4rem 0.85rem;
  }
  .marcador.sano {
    background: #eef7e8;
    border-color: #b6d9a0;
  }
  .marcador span {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .marcador b {
    font-family: var(--font-titulo);
    font-size: 1.25rem;
    color: var(--peligro);
  }
  .marcador.sano b {
    color: #3f6b2c;
  }
  .alerta-nota {
    background: #fdeae8;
    border-color: var(--peligro);
    color: var(--pizarra);
  }
  .punto {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    margin-right: 0.45rem;
    background: var(--gris);
    vertical-align: middle;
  }
  .punto.alta {
    background: var(--peligro);
  }
  .punto.media {
    background: var(--acento-2);
  }
  .punto.ok {
    background: #b6d9a0;
  }
  td small {
    display: block;
    font-size: 0.72rem;
    color: var(--gris);
    margin-top: 0.05rem;
  }
  .consejo-celda {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.4;
    max-width: 20rem;
    white-space: normal;
  }
  .aprendiendo {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--acento-2);
    background: #fff5ec;
    border: 1px solid var(--acento-2);
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    white-space: nowrap;
  }
  .semana {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  @media (max-width: 720px) {
    .semana {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  .dia-pron {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 0.4rem;
  }
  .dia-pron.hoy {
    border-color: var(--acento);
    background: #fbfff8;
  }
  .dia-pron.sin-dato {
    opacity: 0.6;
  }
  .dia-cab {
    text-align: center;
  }
  .dia-cab b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 0.9rem;
    text-transform: capitalize;
  }
  .dia-cab small {
    font-size: 0.7rem;
    color: var(--gris);
  }
  .barra-pron {
    width: 100%;
    height: 3rem;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .relleno {
    width: 1.6rem;
    min-height: 3px;
    background: var(--acento);
    border-radius: 3px 3px 0 0;
  }
  .relleno.vacio-barra {
    background: var(--borde);
    height: 3px;
  }
  .dia-num {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    text-align: center;
  }
  .cuentas-pron {
    font-family: var(--font-titulo);
    font-weight: 700;
    font-size: 0.95rem;
  }
  .cuentas-pron em {
    font-style: normal;
    font-weight: 400;
    font-size: 0.68rem;
    color: var(--gris);
  }
  .venta-pron {
    font-size: 0.78rem;
    font-weight: 600;
  }
  .pico-pron {
    font-size: 0.7rem;
    color: var(--gris);
  }
  .conf {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    margin-top: 0.15rem;
  }
  .conf.alta {
    background: #eef7e8;
    color: #3f6b2c;
  }
  .conf.media {
    background: #fff5ec;
    color: var(--acento-2);
  }
  .conf.baja {
    background: var(--fondo);
    color: var(--gris);
  }
  .sin {
    font-size: 0.72rem;
    color: var(--gris);
    font-style: italic;
  }

  /* --- Simulador --- */
  .palancas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.85rem;
    margin: 0.5rem 0 1rem;
  }
  .palancas label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .palancas span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .palancas select {
    padding: 0.5rem 0.65rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  .palancas select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .palancas input[type="range"] {
    accent-color: var(--acento);
    width: 100%;
  }
  .resultado-sim {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
  }
  .resultado-sim.gana {
    border-color: #b6d9a0;
    background: #f6fbf2;
  }
  .resultado-sim.pierde {
    border-color: var(--peligro);
    background: #fdf4f3;
  }
  .resultado-sim b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    margin-top: 0.15rem;
  }
  .delta-sim {
    text-align: right;
  }
  .delta-sim b {
    font-size: 1.5rem;
  }
  .resultado-sim.gana .delta-sim b {
    color: #3f6b2c;
  }
  .resultado-sim.pierde .delta-sim b {
    color: var(--peligro);
  }
  .delta-sim small {
    font-size: 0.75rem;
    color: var(--gris);
  }
  .advertencia-sim {
    margin-top: 0.8rem;
    background: #fff5ec;
    border-color: var(--acento-2);
    color: var(--pizarra);
  }
  .tolera {
    font-family: var(--font-titulo);
    font-size: 1rem;
    color: var(--acento);
  }
  .botones-sim {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.85rem;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .indice-voz {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    background: #eef7e8;
    border: 1px solid #b6d9a0;
    border-radius: var(--r-md);
    padding: 0.4rem 0.85rem;
  }
  .indice-voz.bajo {
    background: #fdeae8;
    border-color: var(--peligro);
  }
  .indice-voz b {
    font-family: var(--font-titulo);
    font-size: 1.35rem;
    color: #3f6b2c;
  }
  .indice-voz.bajo b {
    color: var(--peligro);
  }
  .indice-voz em {
    font-style: normal;
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--gris);
  }
  .barras-voz {
    display: flex;
    gap: 2px;
    height: 1.8rem;
    border-radius: var(--r-sm);
    overflow: hidden;
    margin: 0.6rem 0;
  }
  .franja {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.76rem;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
  }
  .franja.bien { background: #57ad30; }
  .franja.regular { background: var(--acento-2); }
  .franja.mal { background: var(--peligro); }
  .cruce {
    margin-top: 0.9rem;
    border: 1.5px solid #b6d9a0;
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
    background: #f6fbf2;
  }
  .cruce.duele {
    border-color: var(--peligro);
    background: #fdf4f3;
  }
  .cruce b {
    font-family: var(--font-titulo);
    font-size: 0.98rem;
  }
  .cruce p {
    margin-top: 0.3rem;
    font-size: 0.84rem;
    line-height: 1.5;
    color: var(--pizarra);
  }

  /* Discreto y a lo ancho: no compite con los datos, pero se ve que está. */
  .ver-todo {
    width: 100%;
    margin-top: 0.6rem;
    padding: 0.5rem;
    border: 1px dashed var(--borde);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--gris);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .ver-todo:hover {
    color: var(--pizarra);
    border-color: var(--acento);
  }
  .lista-quejas li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0.2rem;
    border-bottom: 1px solid var(--borde);
  }
  .lista-quejas li span {
    font-size: 0.85rem;
    color: var(--gris);
  }
</style>
