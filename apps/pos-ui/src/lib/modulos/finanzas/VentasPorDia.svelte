<script lang="ts">
  /**
   * M5 · Cuánto entró cada día, y por dónde.
   *
   * ## La pregunta que responde
   *
   * «¿Cuánto se hizo el sábado, cuánto en efectivo y cuánto con tarjeta?» Hasta
   * ahora eso solo se podía ver del día en curso o exportando el mes a un CSV, y
   * el desglose por forma de pago vivía únicamente dentro de ese archivo. Es la
   * cifra que el dueño consulta cada mañana y la que compara con lo que hay en
   * el cajón, así que tiene que estar en pantalla.
   *
   * ## Las cifras van CON IVA
   *
   * Es lo que de verdad entró: lo que se cobró y lo que se depositará. El
   * desglose fiscal —base e IVA trasladado— se enseña debajo, que es donde le
   * sirve al contador. Mezclar las dos lecturas en una sola cifra es lo que hace
   * que el número de la pantalla no cuadre con el del banco.
   *
   * ## Las jornadas, no los días naturales
   *
   * Un viernes que cierra a la una de la madrugada es viernes. Cortar a
   * medianoche partía el servicio en dos: el viernes parecía flojo y el sábado
   * amanecía con ventas fantasma.
   */
  import {
    CERO,
    FORMAS_PAGO,
    cuentasCerradasEn,
    reporteContable,
    sumar,
    type Centavos,
    type Rango,
  } from "@motrest/dominio";
  import { egresos } from "../../egresos.svelte";
  import { fiscal } from "../../fiscal.svelte";
  import { diasDeHistorial, ordenesPurgables } from "@motrest/dominio";
  import { local, MESES_RETENCION, type MesesRetencion } from "../../local.svelte";
  import { arranque } from "../../persistencia/arranque.svelte";
  import { tesoreria } from "../../tesoreria.svelte";
  import { mxn } from "../../formato";
  import { pos } from "../../pos.svelte";

  /** Cuántas jornadas se listan de un tirón. Dos semanas caben sin desplazar. */
  const VENTANA = 14;

  /** Cuántas jornadas hacia atrás está mirando (0 = hoy). */
  let desplazamiento = $state(0);

  const DIA_MS = 86_400_000;

  /** Las jornadas del bloque que se está mirando, de la más reciente a la más vieja. */
  const jornadas = $derived.by(() => {
    const lista: { rango: Rango; etiqueta: string; esHoy: boolean }[] = [];
    const hoy = local.jornadaActual;
    for (let i = 0; i < VENTANA; i++) {
      const atras = desplazamiento * VENTANA + i;
      const rango = local.jornada(hoy.desde + 1000 - atras * DIA_MS);
      lista.push({
        rango,
        etiqueta: new Date(rango.desde).toLocaleDateString("es-MX", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }),
        esHoy: rango.desde === hoy.desde,
      });
    }
    return lista;
  });

  /** Qué formas de pago son «efectivo» según el catálogo del dominio. */
  const formasEfectivo = new Set(FORMAS_PAGO.filter((f) => f.efectivo).map((f) => f.valor));
  const formasTarjeta = new Set<string>(["tarjeta_debito", "tarjeta_credito"]);

  interface Fila {
    etiqueta: string;
    esHoy: boolean;
    rango: Rango;
    cuentas: number;
    efectivo: Centavos;
    tarjeta: Centavos;
    otros: Centavos;
    cobrado: Centavos;
    /** Venta con IVA, sin propina: es el ingreso del restaurante. */
    venta: Centavos;
    base: Centavos;
    iva: Centavos;
    propinas: Centavos;
    /**
     * true = esta jornada cae en lo que la retención ya borró del disco.
     *
     * Sin esto la jornada desaparecería de la lista —se filtran las que no
     * tienen movimiento— y un martes con veinte mil pesos de venta se leería
     * como un martes cerrado.
     */
    retirada: boolean;
  }

  /** Hasta qué fecha se retiró historial de ESTA computadora. 0 = nada. */
  const retiradoHasta = $derived(tesoreria.historialRetiradoHasta);

  const filas = $derived.by<Fila[]>(() =>
    jornadas.map(({ rango, etiqueta, esHoy }) => {
      const cuentas = cuentasCerradasEn(pos.todasLasComandas, rango);
      const reporte = reporteContable(cuentas, fiscal.registros, [], rango);

      let efectivo = CERO;
      let tarjeta = CERO;
      let otros = CERO;
      for (const renglon of reporte.por_forma_pago) {
        if (formasEfectivo.has(renglon.forma)) efectivo = sumar(efectivo, renglon.importe);
        else if (formasTarjeta.has(renglon.forma)) tarjeta = sumar(tarjeta, renglon.importe);
        else otros = sumar(otros, renglon.importe);
      }

      return {
        etiqueta,
        esHoy,
        rango,
        cuentas: reporte.cuentas,
        efectivo,
        tarjeta,
        otros,
        cobrado: sumar(efectivo, tarjeta, otros),
        venta: reporte.total,
        base: reporte.subtotal,
        iva: sumar(reporte.iva, reporte.ieps),
        propinas: reporte.propinas,
        retirada: retiradoHasta > 0 && rango.desde < retiradoHasta,
      };
    }),
  );

  /**
   * Solo se listan las jornadas con movimiento: un local cerrado no es un renglón.
   *
   * Las retiradas SÍ se listan aunque salgan en cero, y con su etiqueta. Un
   * renglón que falta se lee como «ese día no se vendió»; uno que dice
   * «historial retirado» se lee como lo que es.
   */
  const conMovimiento = $derived(filas.filter((f) => f.cuentas > 0 || f.esHoy || f.retirada));

  /** ¿El bloque que se está mirando toca lo ya retirado? */
  const bloqueIncompleto = $derived(conMovimiento.some((f) => f.retirada));

  const totales = $derived.by(() => ({
    efectivo: sumar(...conMovimiento.map((f) => f.efectivo)),
    tarjeta: sumar(...conMovimiento.map((f) => f.tarjeta)),
    otros: sumar(...conMovimiento.map((f) => f.otros)),
    venta: sumar(...conMovimiento.map((f) => f.venta)),
    iva: sumar(...conMovimiento.map((f) => f.iva)),
    propinas: sumar(...conMovimiento.map((f) => f.propinas)),
  }));

  /**
   * Cuánto ocupa el historial, aproximado.
   *
   * Se estima a partir del número de eventos porque medir el tamaño real de
   * IndexedDB no es posible desde la página. Un evento de comanda ronda los
   * 400 bytes serializados; la cifra sirve para dar una idea de orden de
   * magnitud, que es lo que hace falta para decidir entre 3 meses y 2 años.
   */
  const eventosGuardados = $derived(pos.todosLosEventos.length);
  const espacioAprox = $derived(Math.max(1, Math.round((eventosGuardados * 400) / 1024 / 1024)));

  /** Cuántos días de historial hay de verdad. Dice más que un número de registros. */
  const dias = $derived(diasDeHistorial(pos.todasLasComandas));

  /**
   * Cuántas cuentas se retirarían AHORA con el ajuste elegido.
   *
   * Se enseña antes de tocar nada. Cambiar la retención borra del disco, y
   * un botón que borra sin decir cuánto es un botón que nadie se atreve a
   * pulsar — o peor, que alguien pulsa sin saber.
   */
  const porRetirar = $derived(
    ordenesPurgables(pos.todasLasComandas, local.retencionMeses).ordenes.length,
  );

  let limpiando = $state(false);
  let limpiado = $state<number | null>(null);

  async function aplicarRetencion() {
    limpiando = true;
    limpiado = null;
    try {
      const purga = await pos.purgarHistorial(local.retencionMeses);
      // El dinero de lo retirado se arrastra, o el saldo se cae por ese importe.
      await tesoreria.sumarArrastre(purga.arrastre, arranque.repositorio);
      limpiado = purga.retirados;
    } finally {
      limpiando = false;
    }
  }

  /** Cambiar el ajuste NO borra en el acto: se elige, se ve, y se aplica. */
  function elegirRetencion(meses: MesesRetencion) {
    local.fijarRetencion(meses);
    limpiado = null;
  }
</script>

<section class="tarjeta">
  <div class="cab">
    <div>
      <h2>Ventas por día</h2>
      <p class="nota">
        Lo cobrado en cada jornada y por dónde entró. Las cifras van <b>con IVA</b>:
        es lo que se cobró y lo que se deposita. El desglose fiscal va en las dos
        últimas columnas.
      </p>
    </div>
    <div class="controles">
      <button class="mini" onclick={() => (desplazamiento += 1)}>← Anteriores</button>
      <button class="mini" disabled={desplazamiento === 0} onclick={() => (desplazamiento -= 1)}>
        Recientes →
      </button>
    </div>
  </div>

  {#if bloqueIncompleto}
    <p class="aviso-retirado">
      Estas jornadas alcanzan historial que ya se retiró de esta computadora. Lo anterior al
      <b>{new Date(retiradoHasta).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}</b>
      se borró por la retención elegida abajo. No es que no se vendiera: el detalle ya no está.
      El dinero del restaurante sí sigue completo.
    </p>
  {/if}

  <div class="marco-tabla">
    <table>
      <thead>
        <tr>
          <th>Jornada</th>
          <th class="num">Cuentas</th>
          <th class="num">Efectivo</th>
          <th class="num">Tarjeta</th>
          <th class="num">Otros</th>
          <th class="num">Cobrado</th>
          <th class="num">Venta c/IVA</th>
          <th class="num">IVA</th>
          <th class="num">Propinas</th>
        </tr>
      </thead>
      <tbody>
        {#each conMovimiento as f (f.rango.desde)}
          {#if f.retirada && f.cuentas === 0}
            <!-- Sin cuentas y dentro de lo retirado: no hay nada que sumar, solo que explicar. -->
            <tr class="retirada">
              <td><b>{f.etiqueta}</b></td>
              <td class="num vacio-retirado" colspan="8">historial retirado de esta computadora</td>
            </tr>
          {:else}
          <tr class:hoy={f.esHoy}>
            <td>
              <b>{f.etiqueta}</b>
              {#if f.esHoy}<small class="marca-hoy">en curso</small>{/if}
              {#if f.retirada}<small class="marca-parcial">parcial</small>{/if}
            </td>
            <td class="num">{f.cuentas}</td>
            <td class="num">{f.efectivo > 0 ? mxn(f.efectivo) : "—"}</td>
            <td class="num">{f.tarjeta > 0 ? mxn(f.tarjeta) : "—"}</td>
            <td class="num">{f.otros > 0 ? mxn(f.otros) : "—"}</td>
            <td class="num"><b>{mxn(f.cobrado)}</b></td>
            <td class="num tenue">{mxn(f.venta)}</td>
            <td class="num tenue">{mxn(f.iva)}</td>
            <td class="num tenue">{f.propinas > 0 ? mxn(f.propinas) : "—"}</td>
          </tr>
          {/if}
        {:else}
          <tr><td colspan="9" class="vacio">No hay ventas en estas jornadas.</td></tr>
        {/each}
      </tbody>
      {#if conMovimiento.length > 0}
        <tfoot>
          <tr>
            <td colspan="2"><b>Total del bloque</b></td>
            <td class="num">{mxn(totales.efectivo)}</td>
            <td class="num">{mxn(totales.tarjeta)}</td>
            <td class="num">{mxn(totales.otros)}</td>
            <td class="num gran-total">
              {mxn(sumar(totales.efectivo, totales.tarjeta, totales.otros))}
            </td>
            <td class="num tenue">{mxn(totales.venta)}</td>
            <td class="num tenue">{mxn(totales.iva)}</td>
            <td class="num tenue">{mxn(totales.propinas)}</td>
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>

  <!--
    LA RETENCIÓN, CON SU ADVERTENCIA.

    No es una opción de configuración cualquiera: lo que se guarda vive en el
    disco de la caja del restaurante, no en una nube de MOTRAE. Quien elige dos
    años tiene que saber por qué su equipo va a ocupar más, y quien elige tres
    meses tiene que saber que ese es el mínimo con el que su contador puede
    cerrar un trimestre.
  -->
  <div class="retencion">
    <div class="cab-retencion">
      <span class="rotulo">Historial de ventas que se conserva</span>
      <div class="opciones">
        {#each MESES_RETENCION as meses (meses)}
          <button
            class="mini"
            class:on={local.retencionMeses === meses}
            onclick={() => elegirRetencion(meses as MesesRetencion)}
          >
            {meses < 12 ? `${meses} meses` : meses === 12 ? "1 año" : "2 años"}
          </button>
        {/each}
      </div>
    </div>
    <p class="aviso-disco">
      <b>Esto se guarda en el disco de esta computadora</b>, no en internet:
      cuanto más historial conserve, más espacio ocupa y más tarda un respaldo.
      Ahora mismo hay <b>{dias}</b> días de historial: {eventosGuardados.toLocaleString("es-MX")}
      registros de operación, aproximadamente <b>{espacioAprox} MB</b>. Tres meses
      es el mínimo —es lo que su contador necesita para cerrar un trimestre—; dos
      años permiten comparar temporadas completas.
    </p>

    <!--
      APLICAR ES UN ACTO APARTE, y a propósito.

      Elegir «3 meses» en un local con dos años guardados borraría veintiún
      meses de historial de un clic, sin decir cuántos. Aquí se elige, se ve
      cuántas cuentas se van, y solo entonces se aplica.
    -->
    <div class="aplicar">
      {#if porRetirar > 0}
        <span>
          Hay <b>{porRetirar.toLocaleString("es-MX")}</b>
          {porRetirar === 1 ? "cuenta más vieja" : "cuentas más viejas"} que
          {local.retencionMeses < 12
            ? `${local.retencionMeses} meses`
            : local.retencionMeses === 12
              ? "1 año"
              : "2 años"}.
        </span>
        <button class="mini" onclick={aplicarRetencion} disabled={limpiando}>
          {limpiando ? "Liberando…" : "Liberar espacio ahora"}
        </button>
      {:else}
        <span class="al-dia">No hay nada más viejo que retirar.</span>
      {/if}

      {#if limpiado !== null}
        <p class="resultado-limpieza" role="status">
          {#if limpiado > 0}
            Se retiraron <b>{limpiado.toLocaleString("es-MX")}</b> registros del disco.
          {:else}
            No se retiró nada: lo que queda todavía no está guardado en el Hub, y
            hasta que lo esté no se toca.
          {/if}
        </p>
      {/if}
    </div>
  </div>
</section>

<style>
  .aplicar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.7rem;
    padding-top: 0.7rem;
    border-top: 1px dashed var(--borde);
    font-size: 0.82rem;
    color: var(--gris);
  }
  .aplicar > span {
    flex: 1;
    min-width: 14rem;
  }
  .aplicar b {
    color: var(--pizarra);
  }
  .al-dia {
    font-style: italic;
  }
  .resultado-limpieza {
    flex-basis: 100%;
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
    background: #f2f8ef;
    border: 1px solid #57ad30;
    color: var(--pizarra);
    line-height: 1.45;
  }
  .tarjeta {
    background: var(--superficie, #fff);
    border: 1px solid var(--borde);
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .cab {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.85rem;
  }
  .cab > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .nota {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.55;
    margin-top: 0.2rem;
  }
  .controles {
    display: flex;
    gap: 0.4rem;
  }
  /* Nueve columnas no caben en una tablet: la tabla se desplaza ella sola. */
  .marco-tabla {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
    min-width: 48rem;
  }
  th,
  td {
    border-bottom: 1px solid var(--borde);
    padding: 0.45rem 0.4rem;
    text-align: left;
  }
  th {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  tr.hoy {
    background: color-mix(in srgb, var(--acento) 6%, transparent);
  }
  .marca-hoy {
    display: block;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--acento-texto);
  }
  .vacio {
    text-align: center;
    color: var(--gris);
    font-style: italic;
    padding: 1.25rem 0;
  }
  tfoot td {
    border-top: 2px solid var(--borde);
    border-bottom: none;
    padding-top: 0.6rem;
  }
  .gran-total {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--acento-texto);
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .mini:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .retencion {
    margin-top: 1.1rem;
    padding-top: 0.9rem;
    border-top: 1px dashed var(--borde);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .cab-retencion {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .rotulo {
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .opciones {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .aviso-retirado {
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--claro);
    border-left: 3px solid var(--naranja);
    border-radius: var(--r-sm);
    padding: 0.65rem 0.8rem;
    margin: 0 0 0.75rem;
  }
  tr.retirada td {
    color: var(--tenue);
  }
  .vacio-retirado {
    text-align: left;
    font-size: 0.8rem;
    font-style: italic;
  }
  .marca-parcial {
    margin-left: 0.35rem;
    font-size: 0.7rem;
    color: var(--tenue);
  }
  .aviso-disco {
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.65rem 0.8rem;
  }
</style>
