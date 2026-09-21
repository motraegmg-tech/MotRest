<script lang="ts">
  /**
   * Gastos (1.5.6, pedido de Gonzalo): todos los gastos del restaurante en un
   * solo sitio, y no solo los de hoy.
   *
   * Hasta la 1.5.5 solo se veían los gastos de la jornada, al pie de la venta
   * del día. Para saber cuánto se fue en gas el mes pasado había que descargar
   * el estado financiero. Ahora se miran como el movimiento del dinero —Hoy,
   * 7 días, Este mes, Todo— y con el calendario se salta a cualquier mes.
   *
   * Las cuentas por pagar se mudan aquí también: una compra a crédito es un
   * gasto que todavía no sale, y su sitio es junto a los que ya salieron.
   *
   * «Registrar gasto» está en esta tarjeta y en la de la venta del día, pero el
   * formulario es uno solo (ver `formulario-de-gasto.svelte.ts`).
   */
  import { CATEGORIAS_EGRESO, sumar, type Centavos, type RegistroEgreso } from "@motrest/dominio";
  import Icono from "../../Icono.svelte";
  import { egresos } from "../../egresos.svelte";
  import { hora, mxn } from "../../formato";
  import { local } from "../../local.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { revelar } from "../../subir";
  import Ordenar from "../../listas/Ordenar.svelte";
  import VerMas from "../../listas/VerMas.svelte";
  import {
    Paginado,
    ordenRecordado,
    ordenar,
    ordenesComunes,
    type OpcionOrden,
  } from "../../listas/listas.svelte";
  import { abrirFormularioDeGasto } from "./formulario-de-gasto.svelte";

  const puedeRegistrar = $derived(sesion.puedeOperar("fin.egreso.registrar"));
  const puedeVerCostos = $derived(sesion.puedeVer("fin.costo.ver"));

  // --- El período -------------------------------------------------------------------

  /*
   * Las mismas cuatro ventanas que «Movimiento del dinero», con los mismos
   * nombres: quien aprende una pantalla ya sabe usar la otra. La quinta,
   * «un mes», es la que se elige con el calendario.
   */
  type Ventana = "hoy" | "semana" | "mes" | "todo" | "elegido";
  let ventana = $state<Ventana>("mes");

  const VENTANAS: [Ventana, string][] = [
    ["hoy", "Hoy"],
    ["semana", "7 días"],
    ["mes", "Este mes"],
    ["todo", "Todo"],
  ];

  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const MESES_LARGOS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  const hoy = new Date();
  /** El mes elegido en el calendario, con el mes en base 0 como `Date`. */
  let elegido = $state({ anio: hoy.getFullYear(), mes: hoy.getMonth() });

  const rango = $derived.by(() => {
    const ahora = Date.now();
    // La jornada, no el día natural: un viernes que cierra a la una es viernes.
    if (ventana === "hoy") return local.jornadaActual;
    if (ventana === "todo") return { desde: 0, hasta: ahora + 1 };
    if (ventana === "semana") return { desde: ahora - 7 * 86_400_000, hasta: ahora + 1 };
    if (ventana === "mes") {
      const d = new Date();
      return { desde: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), hasta: ahora + 1 };
    }
    return {
      desde: new Date(elegido.anio, elegido.mes, 1).getTime(),
      hasta: new Date(elegido.anio, elegido.mes + 1, 1).getTime(),
    };
  });

  const rotuloPeriodo = $derived.by(() => {
    if (ventana === "hoy") return "hoy";
    if (ventana === "semana") return "en los últimos 7 días";
    if (ventana === "mes") return `en ${MESES_LARGOS[hoy.getMonth()]}`;
    if (ventana === "todo") return "desde que se usa MotRest";
    return `en ${MESES_LARGOS[elegido.mes]} de ${elegido.anio}`;
  });

  const pag = new Paginado();

  function elegirVentana(v: Ventana) {
    ventana = v;
    calendarioAbierto = false;
    // Otro período es otra lista: se vuelve a los 10 primeros.
    pag.reiniciar();
  }

  // --- El calendario ----------------------------------------------------------------

  let calendarioAbierto = $state(false);
  let anioCalendario = $state(hoy.getFullYear());

  /*
   * Los meses que tienen gastos se marcan con un punto, para no andar abriendo
   * meses vacíos. Se cuentan UNA vez por año a la vista, no por botón.
   */
  const conGastos = $derived.by(() => {
    const marcados = new Set<number>();
    for (const r of egresos.registros) {
      if (r.anulado) continue;
      const d = new Date(r.ts);
      if (d.getFullYear() === anioCalendario) marcados.add(d.getMonth());
    }
    return marcados;
  });

  function esFuturo(anio: number, mes: number): boolean {
    return anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth());
  }

  function abrirCalendario() {
    calendarioAbierto = !calendarioAbierto;
    if (calendarioAbierto) {
      anioCalendario = ventana === "elegido" ? elegido.anio : hoy.getFullYear();
    }
  }

  function elegirMes(mes: number) {
    elegido = { anio: anioCalendario, mes };
    elegirVentana("elegido");
  }

  // --- La lista ---------------------------------------------------------------------

  const delPeriodo = $derived(egresos.del(rango));
  const total = $derived(sumar(...delPeriodo.map((e) => e.monto)) as Centavos);
  const aCredito = $derived(
    sumar(...delPeriodo.filter((e) => !e.pagado).map((e) => e.monto)) as Centavos,
  );

  /** En qué se fue: las categorías del período, de la que más pesa a la que menos. */
  const porCategoria = $derived.by(() => {
    const suma = new Map<string, number>();
    for (const e of delPeriodo) suma.set(e.categoria, (suma.get(e.categoria) ?? 0) + e.monto);
    return [...suma.entries()]
      .map(([id, monto]) => ({ id, nombre: nombreCategoria(id), monto: monto as Centavos }))
      .sort((a, b) => b.monto - a.monto);
  });

  /*
   * «ORDENAR» (1.5.6). Aquí solo cambia la vista. Además de fecha y nombre,
   * el importe: lo primero que se pregunta de una lista de gastos es cuál fue
   * el más grande.
   */
  const OPCIONES: OpcionOrden<RegistroEgreso>[] = [
    ...ordenesComunes<RegistroEgreso>({ nombre: (e) => e.concepto, fecha: (e) => e.ts }),
    { id: "mayor", etiqueta: "Mayor importe primero", comparar: (a, b) => b.monto - a.monto },
    { id: "menor", etiqueta: "Menor importe primero", comparar: (a, b) => a.monto - b.monto },
  ];
  let orden = $state(ordenRecordado("gastos", "recientes"));
  const ordenados = $derived(ordenar(delPeriodo, OPCIONES.find((o) => o.id === orden)));

  function nombreCategoria(id: string): string {
    return CATEGORIAS_EGRESO.find((c) => c.id === id)?.nombre ?? id;
  }

  /** Hoy basta la hora; en un período largo hace falta el día. */
  function cuando(ts: number): string {
    if (ventana === "hoy") return hora(ts);
    const dia = new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    return `${dia} · ${hora(ts)}`;
  }

  function fechaCorta(ts?: number): string {
    if (ts === undefined) return "sin fecha";
    return new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  function anular(id: string) {
    const motivo = prompt("¿Por qué se anula este egreso?");
    if (!motivo) return;
    egresos.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    egresos.anular(id, motivo, sesion.usuarioActual?.id);
  }

  // --- Cuentas por pagar ------------------------------------------------------------

  /*
   * Las deudas no dependen del período: una factura a crédito de hace dos meses
   * se debe hoy igual. Por eso van aparte y siempre completas.
   */
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
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Gastos</h2>
    {#if puedeRegistrar}
      <button class="mini" onclick={abrirFormularioDeGasto}>Registrar gasto</button>
    {/if}
  </div>

  <div class="periodo">
    <div class="ventanas">
      {#each VENTANAS as [clave, texto] (clave)}
        <button class="pestana" class:on={ventana === clave} onclick={() => elegirVentana(clave)}>
          {texto}
        </button>
      {/each}
      <button
        class="pestana calendario"
        class:on={ventana === "elegido" || calendarioAbierto}
        aria-expanded={calendarioAbierto}
        aria-label="Elegir un mes"
        title="Elegir un mes"
        onclick={abrirCalendario}
      >
        <Icono nombre="reservas" tam={16} />
        {#if ventana === "elegido"}{MESES[elegido.mes]} {elegido.anio}{/if}
      </button>
    </div>

    {#if calendarioAbierto}
      <div class="meses" use:revelar>
        <div class="anio">
          <button class="mini" aria-label="Año anterior" onclick={() => anioCalendario--}>‹</button>
          <b>{anioCalendario}</b>
          <button
            class="mini"
            aria-label="Año siguiente"
            disabled={anioCalendario >= hoy.getFullYear()}
            onclick={() => anioCalendario++}
          >›</button>
        </div>
        <div class="rejilla">
          {#each MESES as nombre, i (nombre)}
            <button
              class="mes"
              class:on={ventana === "elegido" && elegido.anio === anioCalendario && elegido.mes === i}
              disabled={esFuturo(anioCalendario, i)}
              onclick={() => elegirMes(i)}
            >
              {nombre}
              {#if conGastos.has(i)}<i class="punto" aria-label="tiene gastos"></i>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="cifras">
    <div class="fuerte">
      <span>Se gastó {rotuloPeriodo}</span>
      <b>{mxn(total)}</b>
    </div>
    <div>
      <span>Gastos</span>
      <b>{delPeriodo.length}</b>
    </div>
    {#if aCredito > 0}
      <div class="credito">
        <span>De eso, a crédito sin pagar</span>
        <b>{mxn(aCredito)}</b>
      </div>
    {/if}
  </div>

  {#if porCategoria.length > 1}
    <ul class="categorias" aria-label="En qué se gastó">
      {#each porCategoria as c (c.id)}
        <li><span>{c.nombre}</span> <b>{mxn(c.monto)}</b></li>
      {/each}
    </ul>
  {/if}

  {#if delPeriodo.length === 0}
    <p class="vacio">No hay gastos registrados {rotuloPeriodo}.</p>
  {:else}
    <div class="herramientas">
      <Ordenar
        opciones={OPCIONES}
        bind:valor={orden}
        recordar="gastos"
        onCambiar={() => pag.reiniciar()}
      />
    </div>
    <div class="marco-tabla">
      <table>
        <thead>
          <tr>
            <th>Cuándo</th>
            <th>Concepto</th>
            <th>Categoría</th>
            <th>Pago</th>
            <th class="num">Monto</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each pag.de(ordenados) as e (e.egreso_id)}
            <tr>
              <td class="tenue">{cuando(e.ts)}</td>
              <td>
                {e.concepto}
                {#if e.proveedor}<small> · {e.proveedor}</small>{/if}
              </td>
              <td class="tenue">{nombreCategoria(e.categoria)}</td>
              <td>
                {#if e.pagado}
                  <span class="tenue">Pagado</span>
                {:else}
                  <span class="debe">A crédito · vence {fechaCorta(e.vence_ts)}</span>
                {/if}
              </td>
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
    </div>
    <VerMas {pag} lista={ordenados} />
  {/if}
</section>

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

    <div class="marco-tabla">
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
    </div>
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
      <button onclick={() => (liquidando = null)}>Cancelar</button>
      <button class="principal" onclick={liquidar}>Registrar el pago</button>
    </div>
  </div>
{/if}

<style>
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
  .cuentas,
  .tenue {
    color: var(--gris);
    font-size: 0.85rem;
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
  button:disabled {
    cursor: default;
    opacity: 0.4;
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

  /* --- El período --- */
  .periodo {
    position: relative;
    margin-bottom: 0.9rem;
  }
  .ventanas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .pestana {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.75rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .pestana.on {
    border-color: var(--acento);
    color: var(--acento-texto);
    background: #fff7f0;
  }
  .calendario {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .meses {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md, 10px);
    max-width: 20rem;
    background: #fff;
    box-shadow: var(--sombra-lg);
  }
  .anio {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }
  .anio b {
    font-family: var(--font-titulo);
  }
  .rejilla {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.35rem;
  }
  .mes {
    position: relative;
    padding: 0.5rem 0;
    font-size: 0.82rem;
  }
  .mes.on {
    border-color: var(--acento);
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .punto {
    position: absolute;
    top: 0.25rem;
    right: 0.3rem;
    width: 0.35rem;
    height: 0.35rem;
    border-radius: 50%;
    background: var(--acento);
  }
  .mes.on .punto {
    background: var(--sobre-acento);
  }

  /* --- Cifras --- */
  .cifras {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding-bottom: 0.9rem;
    margin-bottom: 0.7rem;
    border-bottom: 1px solid var(--borde);
  }
  .cifras div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .cifras span {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .cifras b {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  .cifras .fuerte b {
    font-family: var(--font-titulo);
    font-size: 1.35rem;
  }
  .cifras .credito b {
    color: #b4541a;
  }
  .categorias {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .categorias li {
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    border-radius: var(--r-pill);
    background: var(--claro);
  }
  .categorias b {
    font-variant-numeric: tabular-nums;
  }
  .vacio {
    font-size: 0.86rem;
    color: var(--gris);
  }
  .herramientas {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.5rem;
  }

  /* --- Tabla --- */
  .marco-tabla {
    overflow-x: auto;
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
  td.tenue {
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td small {
    color: var(--gris);
  }
  .debe {
    font-size: 0.8rem;
    font-weight: 600;
    color: #b4541a;
    white-space: nowrap;
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
  .nota {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
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
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
</style>
