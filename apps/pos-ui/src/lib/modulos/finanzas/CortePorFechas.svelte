<!--
  Volver a sacar el corte de un día pasado, o el de varios días juntos.

  POR QUÉ EXISTE. El corte solo se podía imprimir en el instante de cerrar el
  turno. Si el papel se atascó, si nadie lo recogió, o si el dueño quiere el
  corte del viernes un lunes por la mañana, no había forma de volver a sacarlo:
  las cifras estaban en el registro y no había pantalla que las pidiera.

  Se ve en pantalla ANTES de imprimir. Un corte se pide para leerlo, y gastar
  papel para descubrir que el rango estaba mal es justo lo que no se quiere a las
  once de la noche.
-->
<script lang="ts">
  import { caja } from "../../caja.svelte";
  import { impresion } from "../../impresion.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { mxn } from "../../formato";
  import {
    FORMAS_PAGO,
    restar,
    type Centavos,
    type CortePeriodo,
  } from "@motrest/dominio";

  /** «tarjeta_debito» no es texto para una pantalla: es una clave. */
  function etiquetaForma(clave: string): string {
    return FORMAS_PAGO.find((f) => f.valor === clave)?.etiqueta ?? clave;
  }

  const puedeVer = $derived(sesion.puedeVer("caja.arqueo.ver"));

  const DIA = 86_400_000;

  /**
   * El día natural que contiene `ts`, de 00:00 a 00:00 del siguiente.
   *
   * Se calcula con el reloj LOCAL del restaurante y no en UTC: en México eso
   * son seis horas de diferencia, y un corte «del martes» calculado en UTC se
   * llevaría las ventas de la noche del lunes.
   */
  function inicioDelDia(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function aTextoFecha(ts: number): string {
    const d = new Date(ts);
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function deTextoFecha(texto: string): number {
    const [a, m, d] = texto.split("-").map(Number);
    // Con el constructor por partes, no `new Date("2026-08-19")`: esa forma la
    // interpreta el navegador como UTC y el corte saldría corrido un día.
    return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
  }

  let desdeTexto = $state(aTextoFecha(Date.now()));
  let hastaTexto = $state(aTextoFecha(Date.now()));

  const desde = $derived(deTextoFecha(desdeTexto));
  // El límite superior es EXCLUSIVO: para incluir el día elegido entero hay que
  // llegar hasta las 00:00 del siguiente.
  const hasta = $derived(deTextoFecha(hastaTexto) + DIA);
  const rangoValido = $derived(hasta > desde);

  const vista = $derived<CortePeriodo | null>(
    puedeVer && rangoValido ? caja.cortePorRango(desde, hasta) : null,
  );

  const dias = $derived(Math.round((hasta - desde) / DIA));

  function atajo(diasAtras: number, cuantos: number) {
    const fin = inicioDelDia(Date.now()) - diasAtras * DIA;
    desdeTexto = aTextoFecha(fin - (cuantos - 1) * DIA);
    hastaTexto = aTextoFecha(fin);
  }

  function nombreDe(cajeroId: string): string {
    return sesion.usuarios.find((u) => u.id === cajeroId)?.nombre ?? "—";
  }

  let ultimo = $state("");

  function imprimir() {
    if (!rangoValido) return;
    caja.imprimirRango(desde, hasta, sesion.usuarioActual?.nombre ?? "—", nombreDe);
    ultimo = dias === 1
      ? `Corte del ${desdeTexto} enviado a la impresora de caja.`
      : `Corte de ${dias} días enviado a la impresora de caja.`;
  }
</script>

{#if puedeVer}
  <section class="tarjeta">
    <div class="cabecera-tarjeta">
      <h2>Corte por fechas</h2>
      <p class="sub">
        Vuelve a sacar el corte de un día pasado, o junta varios en un solo papel.
      </p>
    </div>

    <div class="atajos">
      <button class="mini" onclick={() => atajo(0, 1)}>Hoy</button>
      <button class="mini" onclick={() => atajo(1, 1)}>Ayer</button>
      <button class="mini" onclick={() => atajo(2, 1)}>Hace 2 días</button>
      <button class="mini" onclick={() => atajo(0, 3)}>Últimos 3 días</button>
      <button class="mini" onclick={() => atajo(0, 7)}>Últimos 7 días</button>
    </div>

    <div class="rango">
      <label>
        <span>Desde</span>
        <input type="date" bind:value={desdeTexto} max={hastaTexto} />
      </label>
      <label>
        <span>Hasta</span>
        <input type="date" bind:value={hastaTexto} min={desdeTexto} />
      </label>
    </div>

    {#if !rangoValido}
      <p class="aviso-error">La fecha «hasta» no puede ser anterior a «desde».</p>
    {:else if vista}
      {#if vista.turnos.length === 0}
        <p class="vacio">
          No hubo turnos de caja en {dias === 1 ? "ese día" : `esos ${dias} días`}.
        </p>
      {:else}
        {#if vista.turnos_abiertos > 0}
          <p class="aviso-provisional">
            <b>Informe provisional.</b>
            {vista.turnos_abiertos === 1
              ? "Hay un turno sin cerrar dentro del rango: sus cifras todavía cambian."
              : `Hay ${vista.turnos_abiertos} turnos sin cerrar dentro del rango: sus cifras todavía cambian.`}
          </p>
        {/if}

        <div class="cifras">
          <div class="grupo">
            <h3>Ingresos</h3>
            {#each Object.entries(vista.cobrado_por_forma) as [forma, monto] (forma)}
              {#if (monto ?? 0) > 0}
                <div class="renglon"><span>{etiquetaForma(forma)}</span><b>{mxn(monto)}</b></div>
              {/if}
            {/each}
            <div class="renglon total">
              <span>Total recibido</span><b>{mxn(vista.total_cobrado)}</b>
            </div>
            {#if vista.propinas > 0}
              <div class="renglon menor">
                <span>menos propinas</span><b>−{mxn(vista.propinas)}</b>
              </div>
            {/if}
            <div class="renglon destacado">
              <span>Venta del negocio</span><b>{mxn(vista.total_vendido)}</b>
            </div>
          </div>

          <div class="grupo">
            <h3>Efectivo</h3>
            <div class="renglon"><span>Fondos iniciales</span><b>{mxn(vista.fondo_inicial)}</b></div>
            <div class="renglon"><span>Recibido en efectivo</span><b>{mxn(vista.efectivo_ventas)}</b></div>
            {#if vista.movimientos.length > 0}
              <div class="renglon">
                <span>Entradas y retiros</span><b>{mxn(vista.total_movimientos)}</b>
              </div>
            {/if}
            <div class="renglon total">
              <span>Esperado en cajón</span><b>{mxn(vista.efectivo_esperado)}</b>
            </div>
            <div class="renglon"><span>Declarado</span><b>{mxn(vista.declarado)}</b></div>
            <div class="renglon" class:mal={vista.diferencia !== 0}>
              <span>
                {vista.diferencia === 0
                  ? "Cuadra"
                  : vista.diferencia > 0
                    ? "Sobrante"
                    : "Faltante"}
              </span>
              <b>{mxn(Math.abs(vista.diferencia) as Centavos)}</b>
            </div>
          </div>

          <div class="grupo">
            <h3>Operación</h3>
            <div class="renglon"><span>Transacciones</span><b>{vista.cuentas_cerradas}</b></div>
            <div class="renglon"><span>Turnos</span><b>{vista.turnos.length}</b></div>
            {#if vista.gastos.length > 0}
              {#each vista.gastos as gasto (gasto.categoria)}
                <div class="renglon"><span>{gasto.nombre}</span><b>−{mxn(gasto.monto)}</b></div>
              {/each}
              <div class="renglon total">
                <span>Total gastos</span><b>−{mxn(vista.total_gastos)}</b>
              </div>
              <div class="renglon destacado">
                <span>Venta menos gastos</span>
                <b>{mxn(restar(vista.total_vendido, vista.total_gastos))}</b>
              </div>
            {:else}
              <p class="nota">Sin gastos registrados en el rango.</p>
            {/if}
          </div>
        </div>

        <div class="pie">
          <button class="principal" onclick={imprimir}>
            Imprimir corte {dias === 1 ? "del día" : `de ${dias} días`}
          </button>
          {#if ultimo}<span class="ok">{ultimo}</span>{/if}
        </div>

        <!--
          Fuera de la caja no hay impresora: la vista previa hace de papel. Se
          dice, en vez de dejar creer que ya salió.
        -->
        {#if impresion.vistaPrevia}
          <details class="previa">
            <summary>Ver el papel ({impresion.vistaPrevia.titulo})</summary>
            <pre>{impresion.vistaPrevia.texto}</pre>
          </details>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .atajos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.8rem;
  }
  .rango {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-bottom: 1rem;
  }
  .rango label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .rango span {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .cifras {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1.2rem;
  }
  .grupo h3 {
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    margin: 0 0 0.4rem;
  }
  .renglon {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.22rem 0;
    font-size: 0.9rem;
  }
  .renglon.menor {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .renglon.total {
    border-top: 1px solid var(--linea, #e3e3e3);
    font-weight: 600;
  }
  .renglon.destacado {
    border-top: 2px solid var(--linea, #e3e3e3);
    font-size: 1rem;
    font-weight: 700;
  }
  .renglon.mal b {
    color: #b3261e;
  }
  .nota,
  .vacio {
    font-size: 0.84rem;
    color: var(--gris);
  }
  .aviso-provisional {
    font-size: 0.84rem;
    background: #fff6e5;
    border-left: 3px solid #f2853a;
    padding: 0.5rem 0.75rem;
    border-radius: var(--r-chico, 6px);
  }
  .pie {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .ok {
    font-size: 0.82rem;
    color: #3f5c31;
  }
  .previa {
    margin-top: 0.8rem;
  }
  .previa pre {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    white-space: pre;
    overflow-x: auto;
    background: #fafafa;
    padding: 0.75rem;
    border-radius: var(--r-chico, 6px);
  }
</style>
