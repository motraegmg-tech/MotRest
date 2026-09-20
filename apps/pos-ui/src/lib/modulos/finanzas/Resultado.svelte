<script lang="ts">
  /**
   * Resultado del día y captura de egresos (M5).
   *
   * La pregunta que responde: **¿ganamos dinero hoy?** No es un estado de
   * resultados de contador; son tres cifras que un restaurantero puede leer de
   * un vistazo antes de cerrar.
   *
   * Ojo con la compra de insumos: hay DOS utilidades (pedido de Gonzalo,
   * sep-2026). La contable no la resta —el costo de lo vendido ya viene de las
   * recetas, y restarla también contaría el mismo queso dos veces—; la de
   * efectivo sí, el día que se compra, y por eso no resta el costo de lo
   * vendido. Los nombres y la explicación vienen del dominio, iguales que en el
   * mes y en el PDF.
   */
  import {
    CATEGORIAS_EGRESO,
    CERO,
    DIFERENCIA_ENTRE_UTILIDADES,
    FORMAS_PAGO,
    UTILIDAD_CONTABLE,
    UTILIDAD_EN_EFECTIVO,
    avisoDe,
    cuentasCerradasEn,
    etiquetaFormaPago,
    egresosEn,
    formatearCantidad,
    pesos,
    reporteContable,
    resumenVentas,
    sumar,
    type CategoriaEgreso,
    type Centavos,
    type LineaEgresoInsumo,
  } from "@motrest/dominio";
  import SelectorInsumo from "../../SelectorInsumo.svelte";
  import { caja } from "../../caja.svelte";
  import { egresos } from "../../egresos.svelte";
  import { fiscal } from "../../fiscal.svelte";
  import { licencia } from "../../licencia.svelte";
  import { local } from "../../local.svelte";
  import { menu } from "../../menu.svelte";
  import { pos } from "../../pos.svelte";
  import { revelar } from "../../subir";
  import { tesoreria } from "../../tesoreria.svelte";
  import { mxn, hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeRegistrar = $derived(sesion.puedeOperar("fin.egreso.registrar"));
  const puedeVerCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  /*
   * La JORNADA, no el día natural: un viernes que cierra a la una de la
   * madrugada es viernes. Cortar a medianoche partía el servicio en dos y hacía
   * que el viernes pareciera flojo y el sábado tuviera ventas fantasma.
   */
  const rango = $derived(local.jornadaActual);
  // Solo las cuentas CERRADAS del día: una mesa abierta todavía no es venta.
  const cerradasHoy = $derived(cuentasCerradasEn(pos.todasLasComandas, rango));
  const ventas = $derived(resumenVentas(cerradasHoy));
  const resultado = $derived(egresos.resultado(ventas, rango));

  /**
   * Las categorías que SÍ restan al resultado, para desglosar los «gastos de
   * operación» en vez de enseñar un total ciego.
   *
   * Se filtra por `afectaResultado` y no por una lista escrita a mano: el día
   * que se añada una categoría nueva, aparece sola en el sitio correcto. Una
   * lista a mano se habría quedado corta sin que nadie lo notara, y el desglose
   * dejaría de sumar el total de arriba.
   */
  const operativosDesglosados = $derived(
    resultado.por_categoria.filter((c) => c.afectaResultado),
  );
  const delDia = $derived(egresos.del(rango));

  /*
   * LA VENTA DEL DÍA, CON IVA Y POR DÓNDE ENTRÓ.
   *
   * Arriba va la cifra CON IVA porque es la que se cobró y la que el dueño
   * compara con el cajón y con el banco; el IVA trasladado va debajo, que es
   * donde le sirve al contador. Mezclar las dos lecturas en un solo número es
   * lo que hacía que la pantalla nunca cuadrara con lo que había en la caja.
   *
   * El desglose por forma de pago suma los PAGOS, así que incluye la propina:
   * es dinero que entró y hay que entregarlo, y esconderlo del corte sería la
   * forma más rápida de que el cajón nunca cuadre. Se dice en su renglón.
   */
  const reporteHoy = $derived(reporteContable(cerradasHoy, fiscal.registros, [], rango, fiscal.globales));

  const formasEfectivo = new Set(FORMAS_PAGO.filter((f) => f.efectivo).map((f) => f.valor));
  const formasTarjeta = new Set<string>(["tarjeta_debito", "tarjeta_credito"]);
  const formasSocio = new Set<string>(["socio"]);

  const cobrado = $derived.by(() => {
    let efectivo = CERO;
    let tarjeta = CERO;
    let digitales = CERO;
    let socios = CERO;
    for (const r of reporteHoy.por_forma_pago) {
      if (formasEfectivo.has(r.forma)) efectivo = sumar(efectivo, r.importe);
      else if (formasTarjeta.has(r.forma)) tarjeta = sumar(tarjeta, r.importe);
      else if (formasSocio.has(r.forma)) socios = sumar(socios, r.importe);
      else digitales = sumar(digitales, r.importe);
    }
    return {
      efectivo,
      tarjeta,
      digitales,
      socios,
      total: sumar(efectivo, tarjeta, digitales, socios) as Centavos,
    };
  });



  // --- Captura ---
  let abierto = $state(false);
  let categoria = $state<CategoriaEgreso>("servicios");
  let concepto = $state("");
  let montoTexto = $state("");
  let formaPago = $state("efectivo");
  let proveedor = $state("");
  let error = $state("");

  /** false = se recibió a crédito y el dinero sale el día que se pague. */
  let pagado = $state(true);
  let venceTexto = $state("");

  const categoriaElegida = $derived(CATEGORIAS_EGRESO.find((c) => c.id === categoria));

  /*
   * LA COMPRA DE INSUMOS, DENTRO DEL MISMO GASTO.
   *
   * Es el pedido de Gonzalo: poder registrar la compra de insumos aquí, como
   * ya se hacía en Inventario, y que ese gasto reste al dinero. Se activa al
   * elegir la categoría «Compra de insumos» y no antes: un formulario que
   * enseña renglones de almacén para capturar el recibo de la luz solo estorba.
   */
  const esCompraInsumos = $derived(categoria === "insumos");

  interface RenglonCompra {
    insumo_id: string;
    /** En la unidad base del insumo, tal como se lleva el almacén. */
    cantidad: string;
    /** Lo que costó ESTE renglón completo, en pesos. */
    importe: string;
  }

  let renglones = $state<RenglonCompra[]>([]);

  function agregarRenglon() {
    renglones = [...renglones, { insumo_id: menu.insumos[0]?.id ?? "", cantidad: "", importe: "" }];
  }

  function quitarRenglon(i: number) {
    renglones = renglones.filter((_, n) => n !== i);
  }

  const lineas = $derived.by<LineaEgresoInsumo[]>(() =>
    renglones
      .map((r) => ({
        insumo_id: r.insumo_id,
        cantidad: Number(r.cantidad) || 0,
        importe: pesos(Number(r.importe) || 0),
      }))
      .filter((l) => l.insumo_id && l.cantidad > 0),
  );

  /** La suma de los renglones. Es la que manda cuando hay mercancía capturada. */
  const totalLineas = $derived(sumar(...lineas.map((l) => l.importe)));

  /*
   * Con renglones capturados el monto lo pone la suma, no el dedo.
   *
   * Que el total del gasto y el de la mercancía puedan diferir es pedir que un
   * día difieran: el almacén diría que entraron 14 000 pesos de queso y
   * finanzas que salieron 1 400.
   */
  const montoFinal = $derived(
    lineas.length > 0 ? totalLineas : pesos(Number(montoTexto) || 0),
  );

  function insumoDe(id: string) {
    return menu.insumos.find((i) => i.id === id);
  }

  function limpiar() {
    concepto = "";
    montoTexto = "";
    proveedor = "";
    error = "";
    renglones = [];
    pagado = true;
    venceTexto = "";
  }

  function guardar() {
    error = "";
    const r = egresos.registrar(
      {
        categoria,
        concepto,
        monto: montoFinal,
        forma_pago: formaPago,
        proveedor,
        pagado,
        vence_ts: !pagado && venceTexto ? new Date(`${venceTexto}T12:00`).getTime() : undefined,
        lineas: esCompraInsumos ? lineas : undefined,
      },
      sesion.usuarioActual?.id,
    );
    if (r.ok) {
      limpiar();
      abierto = false;
    } else {
      error = r.error;
    }
  }

  function anular(id: string) {
    const motivo = prompt("¿Por qué se anula este egreso?");
    if (!motivo) return;
    egresos.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    egresos.anular(id, motivo, sesion.usuarioActual?.id);
  }

  // --- Cuentas por pagar ---------------------------------------------------------------

  const porPagar = $derived(egresos.porPagar);
  const vencidas = $derived(egresos.vencidas());

  let liquidando = $state<string | null>(null);
  let formaLiquidacion = $state("transferencia");
  let refLiquidacion = $state("");

  function liquidar() {
    if (!liquidando) return;
    const r = egresos.pagar(liquidando, formaLiquidacion, {
      referencia: refLiquidacion,
      autorizadorId: sesion.usuarioActual?.id,
    });
    if (r.ok) {
      liquidando = null;
      refLiquidacion = "";
    }
  }

  function fechaCorta(ts?: number): string {
    if (ts === undefined) return "sin fecha";
    return new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  // --- Presupuesto del mes -------------------------------------------------------------

  /*
   * Se sigue contra el MES NATURAL y no contra la jornada: un techo de gasto es
   * mensual por definición, y compararlo con lo gastado hoy no diría nada.
   */
  const mesEnCurso = $derived.by(() => {
    const d = new Date();
    return {
      desde: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      hasta: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    };
  });

  const presupuesto = $derived(egresos.seguimiento(mesEnCurso));
</script>

<!--
  LA VENTA DEL DÍA. Va en su propia tarjeta y ANTES del resultado porque es la
  cifra que se consulta a cada rato durante el servicio, y porque no está
  reservada a quien puede ver costos: cualquiera que entre a Finanzas tiene que
  poder saber cuánto se ha vendido y cómo se ha cobrado.
-->
<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Venta y resultado de hoy</h2>
    <span class="cuentas">
      {reporteHoy.cuentas}
      {reporteHoy.cuentas === 1 ? "cuenta cobrada" : "cuentas cobradas"}
    </span>
    {#if puedeRegistrar}
      <button class="mini" onclick={() => (abierto = !abierto)}>
        {abierto ? "Cerrar" : "Registrar gasto"}
      </button>
    {/if}
  </div>

  <div class="venta-total">
    <span>Venta con IVA</span>
    <b>{mxn(reporteHoy.total)}</b>
  </div>
  <div class="desglose-fiscal">
    <div>
      <span>Del total, IVA trasladado</span>
      <b>{mxn(reporteHoy.iva)}</b>
    </div>
    {#if reporteHoy.ieps > 0}
      <div><span>IEPS</span><b>{mxn(reporteHoy.ieps)}</b></div>
    {/if}
    <div>
      <span>Base sin impuestos</span>
      <b>{mxn(reporteHoy.subtotal)}</b>
    </div>
  </div>

  <div class="formas">
    <div class="forma">
      <span>Efectivo</span>
      <b>{mxn(cobrado.efectivo)}</b>
    </div>
    <div class="forma">
      <span>Tarjeta</span>
      <b>{mxn(cobrado.tarjeta)}</b>
    </div>
    <div class="forma">
      <span>Digitales</span>
      <b>{mxn(cobrado.digitales)}</b>
      <small>Transferencia, vales y apps</small>
    </div>
    {#if cobrado.socios > 0}
      <div class="forma">
        <span>Socios</span>
        <b>{mxn(cobrado.socios)}</b>
        <small>No entró dinero: salió de su bolsa</small>
      </div>
    {/if}
  </div>

  <p class="nota">
    Lo cobrado suma <b>{mxn(cobrado.total)}</b>, que es la venta más
    <b>{mxn(reporteHoy.propinas)}</b> de propinas: entraron al cajón y a la
    terminal, pero no son ingreso del negocio, son del personal.
  </p>

  <!--
    Y DEBAJO, EL RESULTADO. Antes eran dos tarjetas separadas —«Venta de hoy» y
    «Resultado de hoy»— que contestaban la misma pregunta con las mismas cifras
    repetidas: la venta salía dos veces, una con IVA y otra sin él, sin que nada
    dijera que eran la misma. Se fundieron (pedido de Gonzalo, sep-2026) en un
    solo recorrido: cuánto entró y cómo se cobró, y a partir de ahí qué quedó.
  -->
  <div class="corte">
    <h3>Resultado del día</h3>
  </div>

  {#if puedeVerCostos}
    <div class="cifras">
      <div>
        <span>
          Venta (sin IVA)
          <small>la de arriba, menos {mxn(reporteHoy.iva)} de IVA</small>
        </span>
        <b>{mxn(resultado.ingreso)}</b>
      </div>
      <div>
        <span>Costo de lo vendido</span>
        <b class="resta">−{mxn(resultado.costo)}</b>
      </div>
      <div>
        <span>Margen bruto</span>
        <b>{mxn(resultado.margen_bruto)}</b>
      </div>
      <div>
        <span>Gastos de operación</span>
        <b class="resta">−{mxn(resultado.egresos_operativos)}</b>
      </div>
      <!--
        DESGLOSADOS, no un total ciego. Pedido de Gonzalo.
        Un «−$10,000.00» a secas no se puede discutir con nadie: no dice si fue
        la renta, la nómina o la luz, y quien mira el resultado del día lo mira
        para saber qué recortar.
      -->
      {#each operativosDesglosados as linea (linea.categoria)}
        <div class="detalle">
          <span>{linea.nombre}</span>
          <b class="resta">−{mxn(linea.monto)}</b>
        </div>
      {/each}
      <div class="destacado" class:perdida={resultado.resultado < 0}>
        <span>{UTILIDAD_CONTABLE}</span>
        <b>{mxn(resultado.resultado)}</b>
      </div>
    </div>

    <!--
      LA UTILIDAD EN EFECTIVO, aparte y debajo. Pedido de Gonzalo, sep-2026:
      que la compra de insumos reste. Aquí resta, el día que se compra, junto
      con todo lo demás que salió; por eso este bloque NO resta el costo de lo
      vendido. Si restara las dos cosas contaría el mismo queso dos veces y
      pondría en pérdida cualquier día de surtido.

      Parte de la misma venta sin IVA que la contable: así lo ÚNICO que separa
      las dos cifras es cuándo pesan los insumos, y la nota de abajo lo explica
      en una línea. Se enseña aunque hoy no haya salido nada, para que la
      pantalla tenga siempre la misma forma y nadie busque la cifra que falta.
    -->
    <div class="cifras caja-salida">
      <div>
        <span>Venta (sin IVA)</span>
        <b>{mxn(resultado.ingreso)}</b>
      </div>
      <div>
        <span>Todo lo que salió hoy</span>
        <b class="resta">−{mxn(resultado.salida_total)}</b>
      </div>
      {#each resultado.por_categoria as linea (linea.categoria)}
        <div class="detalle">
          <span>{linea.nombre}</span>
          <b class="resta">−{mxn(linea.monto)}</b>
        </div>
      {/each}
      <div class="destacado" class:perdida={resultado.utilidad_efectivo < 0}>
        <span>{UTILIDAD_EN_EFECTIVO}</span>
        <b>{mxn(resultado.utilidad_efectivo)}</b>
      </div>
    </div>

    <p class="nota">
      {DIFERENCIA_ENTRE_UTILIDADES}
      Food cost {(resultado.food_cost * 100).toFixed(1)} %.
    </p>
  {:else}
    <p class="nota">
      Los importes de costo y resultado están reservados a perfiles con permiso
      para verlos.
    </p>
  {/if}
</section>

{#if abierto && puedeRegistrar}
  <!-- «Registrar gasto» se pulsa arriba y el formulario nace bajo el resultado,
       fuera de cuadro en una tableta: se baja hasta él. -->
  <section class="tarjeta" use:revelar>
    <h2>Registrar un gasto</h2>
    <div class="campos">
      <label>
        <span>Categoría</span>
        <select bind:value={categoria}>
          {#each CATEGORIAS_EGRESO as c (c.id)}
            <option value={c.id}>{c.nombre}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Monto</span>
        <input
          bind:value={montoTexto}
          inputmode="decimal"
          placeholder="0.00"
          disabled={lineas.length > 0}
        />
        {#if lineas.length > 0}
          <small class="pista">Lo pone la suma de la mercancía: {mxn(totalLineas)}</small>
        {/if}
      </label>
      <label class="ancho">
        <span>Concepto</span>
        <input bind:value={concepto} placeholder="Recibo de luz de julio" />
      </label>
      <label>
        <span>Forma de pago</span>
        <select bind:value={formaPago}>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta_debito">Tarjeta</option>
        </select>
        <small class="pista">
          {formaPago === "efectivo"
            ? "Sale del cajón: baja el efectivo y el corte lo descuenta."
            : "Sale del banco: no toca el efectivo del cajón."}
        </small>
      </label>
      <label>
        <span>Proveedor (opcional)</span>
        <input bind:value={proveedor} placeholder="CFE" />
      </label>
    </div>

    <!--
      PAGADO O A CRÉDITO. La diferencia no es contable: es la que decide si el
      dinero baja hoy o el día que se liquide. Un restaurante que compra a
      crédito y lo apunta como pagado tiene el saldo mal toda la semana.
    -->
    <div class="cuando-paga">
      <label class="check">
        <input type="checkbox" bind:checked={pagado} />
        <span>Ya se pagó</span>
      </label>
      {#if pagado}
        <p class="pista">El dinero sale ahora y baja el saldo del restaurante.</p>
      {:else}
        <p class="pista">
          Queda como <b>cuenta por pagar</b>. El gasto cuenta desde hoy, pero el
          dinero no se mueve hasta que se liquide.
        </p>
        <label class="vence">
          <span>¿Cuándo se paga?</span>
          <input type="date" bind:value={venceTexto} />
        </label>
      {/if}
    </div>

    <!--
      LA MERCANCÍA, DENTRO DEL MISMO GASTO.

      Es lo que convierte «registrar el gasto del queso» y «dar entrada al
      queso» en un solo acto. Antes eran dos pantallas y la segunda se olvidaba,
      así que el almacén decía una cosa y la despensa otra.
    -->
    {#if esCompraInsumos}
      <div class="mercancia">
        <div class="cab-mercancia">
          <h3>¿Qué entró al almacén?</h3>
          <button class="mini" onclick={agregarRenglon} disabled={menu.insumos.length === 0}>
            Agregar insumo
          </button>
        </div>

        {#if menu.insumos.length === 0}
          <p class="pista">
            Todavía no hay insumos dados de alta. Se capturan en Administración →
            Catálogo. Sin ellos el gasto se registra igual, solo que sin cargar
            el almacén.
          </p>
        {:else if renglones.length === 0}
          <p class="pista">
            Opcional. Si captura la mercancía, entra sola al inventario y el
            monto del gasto lo pone la suma de los renglones.
          </p>
        {:else}
          {#each renglones as r, i (i)}
            {@const ins = insumoDe(r.insumo_id)}
            <div class="renglon">
              <!--
                Primero la categoría y luego el insumo. Cada renglón lleva el
                suyo, así que `onElegir` escribe sobre ESTE renglón —`r` es el
                objeto de la lista, no una copia— y no sobre el primero: con la
                lista plana anterior, capturar una compra de ocho renglones era
                recorrer ocho veces la despensa entera de arriba abajo.
              -->
              <div class="insumo">
                <SelectorInsumo
                  valor={r.insumo_id}
                  onElegir={(id) => (r.insumo_id = id)}
                  rotulo="Insumo que entró al almacén"
                />
              </div>
              <label class="cant">
                <input bind:value={r.cantidad} inputmode="decimal" placeholder="0" />
                <span>{ins?.unidad_base ?? ""}</span>
              </label>
              <input
                class="importe"
                bind:value={r.importe}
                inputmode="decimal"
                placeholder="Importe"
              />
              <button class="quitar" onclick={() => quitarRenglon(i)} aria-label="Quitar">×</button>
            </div>
            {#if ins && Number(r.cantidad) > 0}
              <p class="entrada">
                Entran {formatearCantidad(Number(r.cantidad), ins.unidad_base)} de {ins.nombre}
              </p>
            {/if}
          {/each}
          <p class="total-mercancia">
            Total de la compra: <b>{mxn(totalLineas)}</b>
          </p>
        {/if}
      </div>
    {/if}

    {#if categoriaElegida && !categoriaElegida.afectaResultado}
      <p class="aviso-cat">
        {categoriaElegida.descripcion}
        {#if pagado}
          Sí baja el dinero del restaurante: salió de la caja hoy.
        {/if}
      </p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => { abierto = false; limpiar(); }}>Cancelar</button>
      <button class="principal" onclick={guardar}>
        {pagado ? "Guardar gasto" : "Guardar como pendiente"}
      </button>
    </div>
  </section>
{/if}

<!--
  CUENTAS POR PAGAR. Nace de las compras a crédito: sin esta lista, la deuda con
  el proveedor solo vivía en la cabeza del dueño y en el cuaderno del almacén.
-->
{#if puedeVerCostos && porPagar.length > 0}
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Cuentas por pagar</h2>
      <span class="cuentas">
        {mxn(egresos.totalPorPagar)} en {porPagar.length}
        {porPagar.length === 1 ? "documento" : "documentos"}
      </span>
    </div>

    {#if vencidas.length > 0}
      <p class="alerta-sup" role="alert">
        <b>{vencidas.length} {vencidas.length === 1 ? "cuenta venció" : "cuentas vencieron"}.</b>
        La fecha comprometida ya pasó.
      </p>
    {/if}

    <table>
      <thead>
        <tr><th>Vence</th><th>Concepto</th><th>Proveedor</th><th class="num">Monto</th><th></th></tr>
      </thead>
      <tbody>
        {#each porPagar as d (d.egreso_id)}
          <tr class:vencida={d.vence_ts !== undefined && d.vence_ts < Date.now()}>
            <td>{fechaCorta(d.vence_ts)}</td>
            <td>{d.concepto}</td>
            <td>{d.proveedor ?? "—"}</td>
            <td class="num">{mxn(d.monto)}</td>
            <td>
              {#if puedeRegistrar}
                <button class="mini" onclick={() => (liquidando = d.egreso_id)}>Pagar</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<!--
  PRESUPUESTO DEL MES. Solo aparece cuando hay algo que decir: una tarjeta que
  repite «vas bien» todos los días deja de leerse a la semana.
-->
{#if puedeVerCostos && presupuesto.alertas.length > 0}
  <section class="tarjeta presupuesto">
    <h2>Presupuesto del mes</h2>
    {#each presupuesto.alertas as a (a.categoria)}
      <div class="barra-presupuesto" class:excedido={a.estado === "excedido"}>
        <div class="rotulo-presupuesto">
          <span>{avisoDe(a)}</span>
          <b>{mxn(a.gastado)} / {mxn(a.techo)}</b>
        </div>
        <div class="pista-barra">
          <i style="width: {Math.min(100, Math.round(a.consumido * 100))}%"></i>
        </div>
      </div>
    {/each}
    <p class="nota">
      Los techos se fijan en Caja y dinero. El aviso no bloquea nada: informa
      para que se pueda decidir a tiempo si el pedido de esta semana espera.
    </p>
  </section>
{/if}

{#if liquidando}
  <div class="velo" role="presentation" onclick={() => (liquidando = null)}></div>
  <div class="dialogo-pago" role="dialog" aria-modal="true" aria-label="Pagar una cuenta">
    <h2>Pagar la cuenta</h2>
    <p class="nota">
      Aquí es donde sale el dinero. El gasto ya contaba desde que se recibió la
      mercancía, así que esto no lo vuelve a restar del resultado: solo baja el
      saldo.
    </p>
    <label>
      <span>¿Con qué se paga?</span>
      <select bind:value={formaLiquidacion}>
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="tarjeta_debito">Tarjeta</option>
      </select>
    </label>
    <label>
      <span>Referencia (opcional)</span>
      <input bind:value={refLiquidacion} placeholder="Folio de la transferencia" />
    </label>
    <div class="botones">
      <button class="secundario" onclick={() => (liquidando = null)}>Cancelar</button>
      <button class="principal" onclick={liquidar}>Registrar el pago</button>
    </div>
  </div>
{/if}

{#if delDia.length > 0}
  <section class="tarjeta">
    <h2>Gastos de hoy</h2>
    <table>
      <thead>
        <tr><th>Hora</th><th>Concepto</th><th>Categoría</th><th class="num">Monto</th><th></th></tr>
      </thead>
      <tbody>
        {#each delDia as e (e.egreso_id)}
          <tr>
            <td>{hora(e.ts)}</td>
            <td>
              {e.concepto}
              {#if e.proveedor}<small> · {e.proveedor}</small>{/if}
            </td>
            <td>{CATEGORIAS_EGRESO.find((c) => c.id === e.categoria)?.nombre}</td>
            <td class="num">{mxn(e.monto)}</td>
            <td>
              {#if puedeRegistrar}
                <button class="mini" onclick={() => anular(e.egreso_id)}>Anular</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}


<!-- El mismo visor que usa la lista de tickets cobrados. -->
<style>
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .cabecera-tarjeta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.9rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 650;
  }

  /* --- Venta del día --- */
  .cuentas {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .venta-total {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  .venta-total span {
    font-size: 0.9rem;
    color: var(--gris);
  }
  .venta-total b {
    font-family: var(--font-titulo);
    font-size: 1.9rem;
    font-weight: 700;
    color: var(--acento-texto);
    font-variant-numeric: tabular-nums;
  }
  /* El desglose fiscal va DEBAJO y en pequeño: el número que se mira es el de
     arriba, este se consulta al cerrar el mes. */
  .desglose-fiscal {
    margin-top: 0.35rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--borde);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .desglose-fiscal div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.84rem;
    color: var(--gris);
  }
  .desglose-fiscal b {
    color: var(--pizarra);
    font-variant-numeric: tabular-nums;
  }
  .formas {
    margin-top: 0.85rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .forma {
    border: 1px solid var(--borde);
    border-radius: var(--r-md, 10px);
    padding: 0.6rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .forma span {
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .forma b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .forma small {
    font-size: 0.7rem;
    color: var(--gris);
    line-height: 1.35;
  }

  /* El corte entre lo que entró y lo que quedó, dentro de la misma tarjeta. */
  .corte {
    margin: 1.1rem 0 0.8rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--borde);
  }
  .corte h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
  }
  .cifras {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cifras div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .cifras span {
    font-size: 0.88rem;
    color: var(--gris);
  }
  /* La aclaración de que es la MISMA venta de arriba, sin competir con ella. */
  .cifras span small {
    display: block;
    font-size: 0.72rem;
    color: var(--gris);
    opacity: 0.85;
  }
  .cifras b {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }
  .resta {
    color: var(--gris);
  }
  /* El resultado es lo que se mira primero: se separa y se agranda. */
  .destacado {
    border-top: 1.5px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.3rem;
  }
  /*
   * Los renglones del desglose: sangrados y más pequeños, para que se lean como
   * lo que son —el detalle de la línea de arriba— y no como cifras que compiten
   * con ella.
   */
  .cifras .detalle {
    padding-left: 1rem;
  }
  .cifras .detalle span,
  .cifras .detalle b {
    font-size: 0.8rem;
    color: var(--gris);
    font-weight: 500;
  }
  /* El dinero que salió va separado del resultado: son dos preguntas distintas. */
  .caja-salida {
    margin-top: 1rem;
  }
  .destacado b {
    font-size: 1.35rem;
    font-family: var(--font-titulo);
    color: #57ad30;
  }
  .destacado.perdida b {
    color: #e0392b;
  }

  .nota {
    margin-top: 0.9rem;
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .aviso-cat {
    margin-top: 0.7rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: var(--claro);
    font-size: 0.83rem;
    line-height: 1.45;
  }

  .campos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.85rem;
  }
  .campos .ancho {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: 8px;
    font: inherit;
  }

  .error {
    margin-top: 0.7rem;
    color: #e0392b;
    font-size: 0.86rem;
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1px solid var(--borde);
    background: #fff;
    color: inherit;
    padding: 0.5rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .mini {
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    padding-bottom: 0.5rem;
  }
  td {
    padding: 0.5rem 0.5rem 0.5rem 0;
    border-top: 1px solid var(--borde);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td small {
    color: var(--gris);
  }

  /* --- Compra de insumos dentro del gasto --- */
  .pista {
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--gris);
  }
  .cuando-paga {
    margin-top: 0.85rem;
    padding: 0.7rem 0.85rem;
    background: #faf9f8;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .check input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--acento);
  }
  .vence {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 12rem;
  }
  .vence span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .vence input {
    padding: 0.5rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
  }
  .mercancia {
    margin-top: 0.85rem;
    padding: 0.85rem;
    border: 1px dashed var(--borde);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cab-mercancia {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cab-mercancia h3 {
    flex: 1;
    font-size: 0.92rem;
    font-weight: 650;
  }
  .renglon {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  /*
   * El hueco del insumo. El selector trae su propio borde y su propio fondo
   * —se pinta como un campo— así que aquí solo se le dice cuánto sitio ocupa
   * en la fila; era lo único que aportaba el `<select>` que había antes.
   */
  .renglon .insumo {
    flex: 1;
    min-width: 8rem;
  }
  .renglon .cant {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex: none;
  }
  .renglon .cant input {
    width: 5rem;
    text-align: right;
  }
  .renglon .cant span {
    font-size: 0.76rem;
    color: var(--gris);
    min-width: 2rem;
  }
  .renglon input {
    padding: 0.5rem 0.55rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .renglon .importe {
    width: 7rem;
    text-align: right;
  }
  .quitar {
    flex: none;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 8px;
    border: 1.5px solid var(--borde);
    background: #fff;
    font-size: 1.1rem;
    line-height: 1;
    color: var(--gris);
  }
  .quitar:hover {
    border-color: #e0392b;
    color: #e0392b;
  }
  .entrada {
    font-size: 0.75rem;
    color: var(--acento-texto);
    padding-left: 0.25rem;
    margin-top: -0.25rem;
  }
  .total-mercancia {
    font-size: 0.88rem;
    text-align: right;
    padding-top: 0.35rem;
    border-top: 1px solid var(--borde);
  }
  .total-mercancia b {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
  }

  /* --- Cuentas por pagar --- */
  .alerta-sup {
    font-size: 0.85rem;
    line-height: 1.45;
    color: #8a2018;
    background: #fdf2f0;
    border: 1px solid #e0392b;
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    margin-bottom: 0.7rem;
  }
  tr.vencida td {
    background: #fdf6f5;
  }

  /* --- Presupuesto --- */
  .barra-presupuesto {
    margin-bottom: 0.7rem;
  }
  .rotulo-presupuesto {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.84rem;
    margin-bottom: 0.3rem;
  }
  .rotulo-presupuesto b {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--gris);
    font-weight: 600;
  }
  .pista-barra {
    height: 0.45rem;
    border-radius: 999px;
    background: #eeebe8;
    overflow: hidden;
  }
  .pista-barra i {
    display: block;
    height: 100%;
    background: var(--acento);
  }
  .barra-presupuesto.excedido .pista-barra i {
    background: #e0392b;
  }

  /* --- Diálogo de pago --- */
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .dialogo-pago {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(28rem, calc(100vw - 2rem));
    background: #fff;
    border-radius: 14px;
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: var(--sombra-lg);
  }
  .dialogo-pago h2 {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .dialogo-pago label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dialogo-pago label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .dialogo-pago input,
  .dialogo-pago select {
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
    background: #fff;
  }
</style>
