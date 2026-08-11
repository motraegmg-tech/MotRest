<script lang="ts">
  /**
   * El dinero de un restaurante: lo que pagó y lo que MOTRAE le ha ahorrado.
   *
   * DOS COSAS QUE SE PARECEN Y NO SON LA MISMA. Arriba, la suscripción: lo que
   * entra cada mes por usar MotRest. Abajo, el cobro por resultado: la parte del
   * ahorro medido que se lleva MOTRAE. El modelo comercial de la empresa son las
   * dos juntas —y la segunda no tenía dónde vivir, así que en la práctica no se
   * facturaba—.
   *
   * UN AHORRO SIN VERIFICAR NO SE COBRA, y por eso son dos pasos y no uno. Un
   * número que el restaurantero no ha reconocido no es dinero por cobrar: es una
   * conversación pendiente, y cobrarla por sorpresa es cómo se pierde un cliente
   * ancla.
   */
  import { central } from "../lib/central.svelte";
  import { dinero, fecha } from "../lib/formato";
  import {
    comisionDeResultado,
    pesos,
    aPesos,
    type ClienteMotRest,
    type MetodoDePago,
  } from "@motrest/dominio";

  const { cliente }: { cliente: ClienteMotRest } = $props();

  let montoPago = $state(0);
  let metodoPago = $state<MetodoDePago>("transferencia");
  let notaPago = $state("");
  let errorPago = $state("");

  let concepto = $state("");
  let ahorro = $state(0);
  let comision = $state(15);
  let errorResultado = $state("");

  let aviso = $state("");

  const pagos = $derived([...(cliente.pagos ?? [])].sort((a, b) => b.ts - a.ts));
  const resultados = $derived([...(cliente.resultados ?? [])].sort((a, b) => b.ts - a.ts));
  const totalPagado = $derived(central.totalPagadoPor(cliente));

  const METODOS: { valor: MetodoDePago; texto: string }[] = [
    { valor: "transferencia", texto: "Transferencia" },
    { valor: "efectivo", texto: "Efectivo" },
    { valor: "tarjeta", texto: "Tarjeta" },
    { valor: "otro", texto: "Otro" },
  ];

  /* La cuota vigente es lo que se cobra el 99 % de las veces: se propone sola. */
  $effect(() => {
    if (montoPago === 0) montoPago = aPesos(cliente.cuota);
  });

  function anotarPago(evento: Event) {
    evento.preventDefault();
    errorPago = "";
    const r = central.registrarPago(cliente.id, {
      monto: pesos(montoPago),
      metodo: metodoPago,
      nota: notaPago,
    });
    if (!r.ok) {
      errorPago = r.error;
      return;
    }
    notaPago = "";
    montoPago = aPesos(cliente.cuota);
    aviso = `Cobro de ${dinero(r.pago.monto)} anotado.`;
  }

  function anotarResultado(evento: Event) {
    evento.preventDefault();
    errorResultado = "";
    const r = central.registrarResultado(cliente.id, {
      concepto,
      ahorro: pesos(ahorro),
      comision_pct: comision,
    });
    if (!r.ok) {
      errorResultado = r.error;
      return;
    }
    concepto = "";
    ahorro = 0;
    aviso = "Ahorro anotado. Falta acordarlo con el local para poder cobrarlo.";
  }

  function cobrar(resultadoId: string) {
    const r = central.cobrarResultado(cliente.id, resultadoId);
    aviso = r.ok ? `Comisión de ${dinero(r.pago.monto)} cobrada.` : r.error;
  }

  async function copiarMensajeDeCobro() {
    const texto = central.mensajeDeCobroDe(cliente, dinero);
    try {
      await navigator.clipboard.writeText(texto);
      aviso = "Mensaje de cobro copiado. Péguelo en WhatsApp o en el correo.";
    } catch {
      aviso = texto;
    }
  }
</script>

<section class="cobros">
  <div class="titulo">
    <h3>Cobros</h3>
    <button class="mensaje" onclick={copiarMensajeDeCobro}>Copiar mensaje de cobro</button>
  </div>

  {#if aviso}
    <p class="aviso-cobros">{aviso}</p>
  {/if}

  <div class="totales">
    <div>
      <span>Pagado en total</span>
      <b>{dinero(totalPagado)}</b>
      <em>desde el {fecha(cliente.alta_ts)}</em>
    </div>
    <div>
      <span>Último cobro</span>
      <b>{pagos[0] ? dinero(pagos[0].monto) : "—"}</b>
      <em>{pagos[0] ? fecha(pagos[0].ts) : "Nunca se ha anotado uno"}</em>
    </div>
  </div>

  <form class="anotar" onsubmit={anotarPago}>
    <label>
      Cobro recibido
      <input type="number" bind:value={montoPago} min="0" step="50" />
    </label>
    <label>
      Cómo pagó
      <select bind:value={metodoPago}>
        {#each METODOS as m (m.valor)}
          <option value={m.valor}>{m.texto}</option>
        {/each}
      </select>
    </label>
    <label class="ancha">
      Nota <em>(opcional)</em>
      <input bind:value={notaPago} placeholder="Folio, quién pagó…" />
    </label>
    <button type="submit" class="primario">Anotar cobro</button>
  </form>
  {#if errorPago}<p class="error-cobros">{errorPago}</p>{/if}

  {#if pagos.length > 0}
    <ul class="lista">
      {#each pagos as p (p.id)}
        <li>
          <b>{dinero(p.monto)}</b>
          <span class="cuando">{fecha(p.ts)}</span>
          <span class="como">{METODOS.find((m) => m.valor === p.metodo)?.texto ?? p.metodo}</span>
          {#if p.nota}<span class="nota-pago">{p.nota}</span>{/if}
          <button class="quitar" onclick={() => central.borrarPago(cliente.id, p.id)}>
            Borrar
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <h3 class="segundo">Cobro por resultado</h3>
  <p class="explica">
    La parte variable del modelo MOTRAE: se mide lo que el restaurante dejó de
    perder y se cobra una parte. <b>Solo se cobra lo verificado</b> — un ahorro
    que el local no reconoce es una discusión, no una factura.
  </p>

  <form class="anotar resultado" onsubmit={anotarResultado}>
    <label class="ancha">
      Qué se midió
      <input bind:value={concepto} placeholder="Merma de masa: de 12 % a 4 % en un mes" />
    </label>
    <label>
      Ahorro medido
      <input type="number" bind:value={ahorro} min="0" step="100" />
    </label>
    <label>
      Comisión %
      <input type="number" bind:value={comision} min="1" max="100" step="1" />
    </label>
    <button type="submit">Anotar ahorro</button>
  </form>
  {#if errorResultado}<p class="error-cobros">{errorResultado}</p>{/if}

  {#if resultados.length === 0}
    <p class="ninguno-cobros">Todavía no hay ningún ahorro medido en este local.</p>
  {:else}
    <ul class="lista">
      {#each resultados as r (r.id)}
        <li class="fila-resultado">
          <span class="concepto">{r.concepto}</span>
          <span class="cuando">{fecha(r.ts)}</span>
          <span class="ahorro">
            Ahorro {dinero(r.ahorro)} · comisión <b>{dinero(comisionDeResultado(r))}</b>
          </span>
          {#if r.cobrado}
            <span class="sello cobrado">Cobrada</span>
          {:else if r.verificado}
            <button class="primario chico" onclick={() => cobrar(r.id)}>Cobrar comisión</button>
          {:else}
            <button class="chico" onclick={() => central.verificarResultado(cliente.id, r.id)}>
              Marcar verificado
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .cobros {
    margin-top: 1.8rem;
    padding-top: 1.2rem;
    border-top: 1px solid var(--borde);
  }
  .titulo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 0 0 0.7rem;
  }
  h3.segundo {
    margin-top: 1.8rem;
  }
  .mensaje {
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .mensaje:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .aviso-cobros {
    font-size: 0.82rem;
    line-height: 1.5;
    background: var(--claro);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.75rem;
    margin: 0 0 0.8rem;
    color: var(--pizarra);
  }
  .totales {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.6rem;
    margin-bottom: 0.9rem;
  }
  .totales > div {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 0.85rem;
  }
  .totales span {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
    margin-bottom: 0.15rem;
  }
  .totales b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    color: var(--pizarra);
  }
  .totales em {
    font-style: normal;
    font-size: 0.73rem;
    color: var(--gris);
  }
  .anotar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    align-items: end;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
  }
  .anotar label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .anotar label.ancha {
    grid-column: span 2;
  }
  .anotar label em {
    font-style: normal;
    font-weight: 400;
    color: var(--gris);
  }
  input,
  select {
    font: inherit;
    font-size: 0.86rem;
    font-weight: 400;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  .anotar button {
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento) !important;
    color: var(--blanco);
  }
  .chico {
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
    margin-left: auto;
  }
  .explica {
    font-size: 0.82rem;
    line-height: 1.6;
    color: var(--gris);
    margin: 0 0 0.7rem;
  }
  .lista {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .lista li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.7rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.82rem;
    color: var(--pizarra);
  }
  .cuando,
  .como,
  .nota-pago,
  .ahorro {
    font-size: 0.77rem;
    color: var(--gris);
  }
  .concepto {
    font-weight: 600;
  }
  .fila-resultado {
    flex-wrap: wrap;
  }
  .quitar {
    margin-left: auto;
    font: inherit;
    font-size: 0.73rem;
    border: none;
    background: none;
    color: var(--gris);
    cursor: pointer;
  }
  .quitar:hover {
    color: var(--peligro);
  }
  .sello {
    margin-left: auto;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.5rem;
    border-radius: var(--r-pill);
  }
  .sello.cobrado {
    background: var(--claro);
    color: var(--gris);
  }
  .error-cobros {
    font-size: 0.8rem;
    color: var(--peligro);
    margin: 0 0 0.7rem;
  }
  .ninguno-cobros {
    font-size: 0.82rem;
    color: var(--gris);
    margin: 0;
  }
</style>
