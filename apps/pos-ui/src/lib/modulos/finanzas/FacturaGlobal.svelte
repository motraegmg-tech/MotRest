<script lang="ts">
  /**
   * La factura global del mes, decidida por el restaurantero (1.5.6).
   *
   * QUÉ ES UNA FACTURA GLOBAL
   *
   * El SAT pide que lo que se vendió y nadie pidió a su nombre se ampare en un
   * solo comprobante por periodo, a PÚBLICO EN GENERAL. En un restaurante eso
   * son casi todas las mesas: el comensal que no pide factura.
   *
   * POR QUÉ ESTA PANTALLA EXISTE
   *
   * En la 1.5.5 el Hub la emitía solo, con todo. Gonzalo lo cambió: «el
   * restaurantero elige y es dueño de su tipo de facturación». Así que aquí se
   * ve el mes cuenta por cuenta, se marca lo que entra y se emite. La que sigue
   * emitiéndola es el Hub —con su llave, su idempotencia y sus reintentos—;
   * esta pantalla solo dice QUÉ.
   *
   * Lo que NO hace, a propósito: no esconde lo que deja fuera. Al confirmar se
   * dice cuántas cuentas quedan sin amparar y qué significa eso, porque el
   * sistema no puede fingir que esa decisión no tiene consecuencias.
   */
  import {
    consumoDeSocio,
    cuentasCerradasEn,
    limitesDelPeriodo,
    ordenEnFacturaGlobal,
    periodoDe,
    ticketsParaGlobal,
    totalesComanda,
    sumar,
    CERO,
    type Centavos,
    type EstadoComanda,
    type ID,
  } from "@motrest/dominio";
  import { facturacion } from "../../facturacion.svelte";
  import { fiscal } from "../../fiscal.svelte";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { sync } from "../../sync.svelte";
  import { dia, hora, mxn } from "../../formato";
  import { revelar } from "../../subir";
  import Ordenar from "../../listas/Ordenar.svelte";
  import VerMas from "../../listas/VerMas.svelte";
  import { Paginado, ordenRecordado, ordenar, type OpcionOrden } from "../../listas/listas.svelte";

  const puedeEmitir = $derived(sesion.puedeOperar("fin.factura.emitir"));
  const empleadoId = $derived(sesion.usuarioActual?.id ?? "");
  const conectada = $derived(sync.estado === "sincronizado");
  const conFacturapi = $derived(
    !!(sync.secretos?.facturapi.configurada ?? sync.fiscal?.facturapi?.configurada),
  );

  /*
   * El mes que se mira. Por defecto el ANTERIOR, que es el que toca facturar:
   * el mes en curso todavía no ha cerrado y sus cuentas siguen pudiendo
   * facturarse a nombre de quien las pida.
   */
  const mesPasado = (() => {
    const d = new Date();
    return periodoDe(new Date(d.getFullYear(), d.getMonth() - 1, 15).getTime());
  })();
  let periodo = $state(mesPasado);

  const rango = $derived(limitesDelPeriodo(periodo));
  const cerrado = $derived(Date.now() >= rango.hasta);

  /** «2026-09» → «septiembre de 2026». */
  function mesLegible(p: string): string {
    const { desde } = limitesDelPeriodo(p);
    return new Date(desde).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  }

  /** Los últimos doce meses, para el selector. */
  const meses = $derived.by(() => {
    const lista: string[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      lista.push(periodoDe(new Date(d.getFullYear(), d.getMonth() - i, 15).getTime()));
    }
    return lista;
  });

  // --- Qué hay en el mes -----------------------------------------------------------

  /** Por qué una cuenta puede o no entrar en la global. */
  type Motivo = "puede" | "facturada" | "en_global" | "socio" | "sin_importe";

  interface Renglon {
    orden_id: ID;
    folio: string;
    mesa: string;
    cuando: number;
    total: Centavos;
    motivo: Motivo;
    /** El comprobante o la global que ya la ampara, para poder decirlo. */
    detalle: string;
  }

  const cerradasDelMes = $derived(cuentasCerradasEn(pos.todasLasComandas, rango));

  /*
   * Lo que PUEDE entrar lo decide el dominio, no esta pantalla: la misma
   * función que usa el Hub al emitir (`ticketsParaGlobal`). Si la pantalla
   * hiciera su propia lista, un día marcaría una cuenta que el Hub descarta y
   * el restaurantero vería desaparecer ventas sin explicación.
   */
  const elegibles = $derived(
    new Set(
      ticketsParaGlobal({
        comandas: cerradasDelMes,
        cfdis: fiscal.registros,
        globales: fiscal.globales,
        periodo,
      }).map((t) => t.orden_id),
    ),
  );

  function clasificar(c: EstadoComanda): { motivo: Motivo; detalle: string } {
    if (elegibles.has(c.orden_id)) return { motivo: "puede", detalle: "" };

    const enGlobal = ordenEnFacturaGlobal(fiscal.eventosFiscales, c.orden_id);
    if (enGlobal) {
      return { motivo: "en_global", detalle: `Global de ${mesLegible(enGlobal.periodo)}` };
    }
    const cfdi = fiscal.cfdiDeOrden(c.orden_id);
    if (cfdi) return { motivo: "facturada", detalle: `${cfdi.serie}-${cfdi.folio}` };
    if (consumoDeSocio(c) > 0) return { motivo: "socio", detalle: "Lo cubrió su bolsa" };
    return { motivo: "sin_importe", detalle: "Cuenta en $0" };
  }

  const renglones = $derived.by<Renglon[]>(() =>
    cerradasDelMes
      .map((c) => {
        const { motivo, detalle } = clasificar(c);
        return {
          orden_id: c.orden_id,
          folio: c.orden_id.slice(-8).toUpperCase(),
          mesa: plano.etiquetaMesas([c.mesa_id, ...(c.mesas_unidas ?? [])]),
          cuando: c.cerrada_ts ?? c.abierta_ts,
          total: totalesComanda(c).total,
          motivo,
          detalle,
        };
      })
      .sort((a, b) => a.cuando - b.cuando),
  );

  /*
   * «ORDENAR» Y «VER MÁS» (1.5.6). Un mes de un local con movimiento son cientos
   * de cuentas: la tabla empujaba el botón de emitir y el historial varias
   * pantallas abajo. Se ven 10 y el resto a petición.
   *
   * Ordenar solo cambia la VISTA. Las casillas no dependen de lo que se ve: la
   * selección se guarda como lo desmarcado y «Marcar todas» / «Ninguna» actúan
   * sobre el mes completo, se vea o no cada renglón.
   */
  const OPCIONES_CUENTAS: OpcionOrden<Renglon>[] = [
    { id: "dia", etiqueta: "Por día, del 1 al 31", comparar: (a, b) => a.cuando - b.cuando },
    { id: "recientes", etiqueta: "Más recientes primero", comparar: (a, b) => b.cuando - a.cuando },
    { id: "mayor", etiqueta: "Mayor total primero", comparar: (a, b) => b.total - a.total },
    { id: "menor", etiqueta: "Menor total primero", comparar: (a, b) => a.total - b.total },
    {
      id: "pueden",
      etiqueta: "Primero las que pueden entrar",
      comparar: (a, b) =>
        Number(b.motivo === "puede") - Number(a.motivo === "puede") || a.cuando - b.cuando,
    },
  ];
  let ordenCuentas = $state(ordenRecordado("finanzas.global", "dia"));
  const cuentasOrdenadas = $derived(
    ordenar(renglones, OPCIONES_CUENTAS.find((o) => o.id === ordenCuentas)),
  );
  const pagCuentas = new Paginado();
  const pagHistorial = new Paginado();

  const ETIQUETA: Record<Motivo, string> = {
    puede: "Puede entrar",
    facturada: "Ya facturada",
    en_global: "Ya en una global",
    socio: "Consumo de socio",
    sin_importe: "Sin importe",
  };

  // --- La selección ----------------------------------------------------------------

  /*
   * SE GUARDA LO QUE SE DESMARCÓ, no lo marcado.
   *
   * Todas las que pueden entrar vienen marcadas: es lo que el SAT espera, y
   * quien quiera dejar algo fuera lo hace a propósito. Guardar la lista de
   * MARCADAS tenía un defecto caro: cada venta que llegaba del Hub —otra caja
   * cobrando una mesa— recalculaba lo elegible y la volvía a marcar toda, así
   * que alguien que había desmarcado tres cuentas podía emitir sin notarlo con
   * las tres dentro. Guardando lo desmarcado, esas decisiones se quedan; lo
   * nuevo entra marcado; y lo que alguien factura a nombre mientras tanto sale
   * solo de la lista, porque deja de ser elegible.
   */
  let desmarcadas = $state<Set<ID>>(new Set());

  // Al cambiar de mes se empieza de cero: lo desmarcado era de otro mes.
  $effect(() => {
    void periodo;
    desmarcadas = new Set();
    pagCuentas.reiniciar();
    pagHistorial.reiniciar();
  });

  const elegidas = $derived(new Set([...elegibles].filter((id) => !desmarcadas.has(id))));

  function alternar(id: ID) {
    if (!elegibles.has(id)) return;
    const nuevas = new Set(desmarcadas);
    if (nuevas.has(id)) nuevas.delete(id);
    else nuevas.add(id);
    desmarcadas = nuevas;
  }

  function todas() {
    desmarcadas = new Set();
  }

  function ninguna() {
    desmarcadas = new Set(elegibles);
  }

  const totalElegido = $derived(
    sumar(...renglones.filter((r) => elegidas.has(r.orden_id)).map((r) => r.total)),
  );
  const fuera = $derived(elegibles.size - elegidas.size);
  const totalElegible = $derived(
    sumar(...renglones.filter((r) => r.motivo === "puede").map((r) => r.total)),
  );

  // --- Emitir ----------------------------------------------------------------------

  let confirmando = $state(false);
  let emitiendo = $state(false);
  let resultado = $state<{ ok: boolean; texto: string } | null>(null);

  async function emitir() {
    if (elegidas.size === 0 || emitiendo) return;
    emitiendo = true;
    resultado = null;
    const r = await sync.emitirFacturaGlobal(empleadoId, periodo, [...elegidas]);
    emitiendo = false;
    confirmando = false;
    /*
     * El Hub no contesta sí o no: puede haberla emitido Y avisar que algunas
     * cuentas quedaron fuera porque, entre que se marcaron y se mandaron, ya las
     * facturó alguien. Por eso lo que diga se enseña tal cual, como aviso y no
     * como error: casi siempre es información, no un fallo.
     */
    resultado = r.ok
      ? { ok: true, texto: "La factura global se mandó a timbrar. Aparecerá abajo en cuanto el SAT la selle." }
      : { ok: false, texto: r.problema || "No se pudo emitir. Revisa la conexión con el Hub." };
  }

  /** Las globales que ya constan en el registro para este mes. */
  const emitidas = $derived(fiscal.globales.filter((g) => g.periodo === periodo));

  /** Cuánto falta —o cuánto se pasó— del plazo del SAT. */
  const plazo = $derived.by(() => {
    if (!cerrado) return null;
    const limite = rango.hasta + 72 * 3_600_000;
    const horas = Math.round((limite - Date.now()) / 3_600_000);
    return horas >= 0 ? { quedan: horas } : { vencido: -horas };
  });
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Factura global del mes</h2>
    <label class="mes">
      <span>Mes</span>
      <select bind:value={periodo}>
        {#each meses as m (m)}
          <option value={m}>{mesLegible(m)}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if !conFacturapi}
    <p class="vacio">
      Este restaurante todavía no está conectado a FacturAPI, así que no se puede
      timbrar nada. Se conecta arriba, en <b>Facturación electrónica</b>.
    </p>
  {:else}
    <p class="explicacion">
      El SAT pide que lo que se vendió y nadie pidió a su nombre se ampare en un
      solo comprobante del mes, a <b>público en general</b>. Aquí decides qué
      entra: lo que puede entrar viene marcado, y lo que desmarques se queda sin
      amparar.
    </p>

    <!-- El modo: quién decide cada mes. -->
    <div class="modo" role="group" aria-label="Cómo se emite la global">
      <button
        class="mini"
        class:on={!facturacion.esAutomatica}
        aria-pressed={!facturacion.esAutomatica}
        disabled={!puedeEmitir}
        onclick={() => facturacion.fijarModo("manual")}
      >
        Yo elijo qué va
      </button>
      <button
        class="mini"
        class:on={facturacion.esAutomatica}
        aria-pressed={facturacion.esAutomatica}
        disabled={!puedeEmitir}
        onclick={() => facturacion.fijarModo("automatica")}
      >
        Automática, todo lo no facturado
      </button>
    </div>
    <p class="pista">
      {#if facturacion.esAutomatica}
        La caja la emite sola el día 1, a partir de las 6:00, con todo lo que
        nadie pidió a su nombre. Aquí puedes ver qué incluyó.
      {:else}
        Nadie la emite hasta que la autorices desde esta pantalla.
      {/if}
    </p>

    {#if plazo?.quedan !== undefined && emitidas.length === 0}
      <p class="alerta-caja" role="alert">
        {mesLegible(periodo)} ya cerró y la global todavía no sale. El SAT da 72
        horas: quedan <b>{plazo.quedan}</b>.
      </p>
    {:else if plazo?.vencido !== undefined && emitidas.length === 0}
      <p class="alerta-caja" role="alert">
        {mesLegible(periodo)} cerró hace más de 72 horas y su global no se ha
        emitido. Sale igual, pero fuera del plazo que marca el SAT: consúltalo con
        tu contador.
      </p>
    {/if}

    <!-- El resumen del mes, antes del detalle. -->
    <div class="resumen">
      <div>
        <b>{renglones.length}</b>
        <span>cuentas cobradas</span>
      </div>
      <div>
        <b>{renglones.filter((r) => r.motivo === "facturada").length}</b>
        <span>ya facturadas a nombre</span>
      </div>
      <div class="destaca">
        <b>{elegibles.size}</b>
        <span>pueden entrar · {mxn(totalElegible)}</span>
      </div>
    </div>

    {#if elegibles.size === 0}
      <p class="vacio">
        No queda ninguna venta por amparar en {mesLegible(periodo)}.
        {#if emitidas.length > 0}Su global ya se emitió.{/if}
      </p>
    {:else}
      <div class="acciones-lista">
        <span class="elegidas">
          Se van a facturar <b>{elegidas.size}</b>
          {elegidas.size === 1 ? "cuenta" : "cuentas"} por <b>{mxn(totalElegido)}</b>
        </span>
        <button class="mini" onclick={todas}>Marcar todas</button>
        <button class="mini" onclick={ninguna}>Ninguna</button>
        <Ordenar
          opciones={OPCIONES_CUENTAS}
          bind:valor={ordenCuentas}
          recordar="finanzas.global"
          onCambiar={() => pagCuentas.reiniciar()}
        />
      </div>

      <div class="marco-tabla">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Día</th>
              <th>Hora</th>
              <th>Mesa</th>
              <th>Folio</th>
              <th class="num">Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {#each pagCuentas.de(cuentasOrdenadas) as r (r.orden_id)}
              <tr class:fuera={r.motivo !== "puede"}>
                <td>
                  <input
                    type="checkbox"
                    checked={elegidas.has(r.orden_id)}
                    disabled={r.motivo !== "puede" || !puedeEmitir}
                    onchange={() => alternar(r.orden_id)}
                    aria-label="Incluir la cuenta {r.folio} en la factura global"
                  />
                </td>
                <td class="tenue">{dia(r.cuando)}</td>
                <td class="tenue">{hora(r.cuando)}</td>
                <td><b>{r.mesa}</b></td>
                <td class="folio">{r.folio}</td>
                <td class="num">{mxn(r.total)}</td>
                <td class="estado">
                  <span class="etiqueta {r.motivo}">{ETIQUETA[r.motivo]}</span>
                  {#if r.detalle}<small>{r.detalle}</small>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <VerMas pag={pagCuentas} lista={cuentasOrdenadas} />

      {#if resultado}
        <p class="resultado" class:mal={!resultado.ok} role="status">{resultado.texto}</p>
      {/if}

      {#if puedeEmitir}
        {#if confirmando}
          <div class="confirma" use:revelar>
            <h3>¿Emitir la global de {mesLegible(periodo)}?</h3>
            <p>
              Se van a amparar <b>{elegidas.size}</b>
              {elegidas.size === 1 ? "cuenta" : "cuentas"} por
              <b>{mxn(totalElegido)}</b>, a nombre de público en general.
            </p>
            {#if fuera > 0}
              <p class="ojo">
                <b>Quedan {fuera} {fuera === 1 ? "cuenta" : "cuentas"} fuera.</b>
                Esa venta se queda sin amparar ante el SAT hasta que la incluyas en
                otra global o se facture a nombre de alguien. Quedará registrado que
                tú lo decidiste.
              </p>
            {/if}
            <p class="ojo">
              Una vez timbrada no se puede deshacer sin cancelarla ante el SAT.
            </p>
            <div class="botones">
              <button class="secundario" onclick={() => (confirmando = false)}>Cancelar</button>
              <button class="principal" disabled={emitiendo} onclick={emitir}>
                {emitiendo ? "Emitiendo…" : "Sí, emitir la global"}
              </button>
            </div>
          </div>
        {:else}
          <div class="botones">
            <button
              class="principal"
              disabled={elegidas.size === 0 || !conectada}
              onclick={() => (confirmando = true)}
            >
              Emitir la factura global
            </button>
          </div>
          {#if !conectada}
            <p class="pista">
              Esta terminal no está conectada al Hub. La global la emite la caja:
              hazlo desde ahí o espera a que vuelva la conexión.
            </p>
          {/if}
        {/if}
      {:else}
        <p class="pista">
          Tu perfil puede consultar el mes, pero no emitir comprobantes.
        </p>
      {/if}
    {/if}

    <!-- Lo que ya se emitió de este mes. -->
    {#if emitidas.length > 0}
      <h3 class="titulo-historial">Globales emitidas de {mesLegible(periodo)}</h3>
      <div class="marco-tabla">
        <table>
          <thead>
            <tr>
              <th>Emitida</th>
              <th>Folio fiscal</th>
              <th class="num">Cuentas</th>
              <th class="num">Total</th>
              <th>Modo</th>
            </tr>
          </thead>
          <tbody>
            {#each pagHistorial.de(emitidas) as g (g.uuid)}
              <tr>
                <td class="tenue">{dia(g.ts)} {hora(g.ts)}</td>
                <td class="folio">{g.uuid}</td>
                <td class="num">{g.ordenes.length}</td>
                <td class="num">{mxn(g.total)}</td>
                <td class="tenue">{g.modo === "pruebas" ? "Pruebas" : "Producción"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <VerMas pag={pagHistorial} lista={emitidas} />
    {/if}
  {/if}
</section>

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
  .mes {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .mes select {
    padding: 0.4rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm, 8px);
    font: inherit;
    font-size: 0.85rem;
    background: #fff;
  }
  .explicacion,
  .vacio,
  .pista {
    font-size: 0.86rem;
    color: var(--gris);
    line-height: 1.55;
  }
  .pista {
    font-size: 0.8rem;
    margin-top: 0.4rem;
  }
  .modo {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.9rem;
  }
  .mini {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm, 8px);
    background: #fff;
    cursor: pointer;
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .mini:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .alerta-caja {
    margin-top: 0.9rem;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--acento);
    background: var(--claro);
    border-radius: var(--r-md, 10px);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .resumen {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .resumen div {
    border: 1px solid var(--borde);
    border-radius: var(--r-md, 10px);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
  }
  .resumen b {
    font-family: var(--font-titulo);
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
  .resumen span {
    font-size: 0.75rem;
    color: var(--gris);
  }
  .resumen .destaca {
    border-color: var(--acento);
  }
  .acciones-lista {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 1rem 0 0.5rem;
  }
  .elegidas {
    flex: 1;
    font-size: 0.86rem;
  }
  .marco-tabla {
    overflow-x: auto;
    max-height: 26rem;
    overflow-y: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
  }
  th {
    position: sticky;
    top: 0;
    background: #fff;
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding: 0.35rem 0.45rem;
    border-bottom: 1px solid var(--borde);
    white-space: nowrap;
  }
  td {
    padding: 0.4rem 0.45rem;
    border-bottom: 1px solid #f2f0ee;
    vertical-align: top;
  }
  tr.fuera td {
    color: var(--gris);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tenue {
    color: var(--gris);
  }
  .folio {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .estado small {
    display: block;
    font-size: 0.7rem;
    color: var(--gris);
  }
  .etiqueta {
    display: inline-block;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-pill, 999px);
    background: var(--claro);
    color: var(--acento-texto);
  }
  .etiqueta.facturada,
  .etiqueta.en_global {
    background: #eef3ee;
    color: #3d6b2e;
  }
  .etiqueta.socio,
  .etiqueta.sin_importe {
    background: #f1efed;
    color: var(--gris);
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .principal,
  .secundario {
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    padding: 0.55rem 1.1rem;
    border-radius: var(--r-md, 10px);
    border: 1.5px solid var(--borde);
    background: #fff;
    cursor: pointer;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .principal:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .confirma {
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md, 10px);
    background: var(--claro);
  }
  .confirma h3 {
    font-size: 0.95rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
  }
  .confirma p {
    font-size: 0.85rem;
    line-height: 1.5;
    margin-bottom: 0.4rem;
  }
  .confirma .ojo {
    color: #8a4b12;
  }
  .resultado {
    margin-top: 0.8rem;
    font-size: 0.86rem;
    font-weight: 600;
    color: #3d6b2e;
  }
  /* Aviso, no alarma: lo más común es «emitida, pero N cuentas quedaron fuera». */
  .resultado.mal {
    color: #8a4b12;
  }
  .titulo-historial {
    margin: 1.3rem 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
  }
</style>
