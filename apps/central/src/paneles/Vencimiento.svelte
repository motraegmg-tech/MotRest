<script lang="ts">
  /**
   * Emitir una licencia hasta una fecha elegida a mano.
   *
   * NO EDITA UN CAMPO: FIRMA UNA LICENCIA NUEVA. El vencimiento vive dentro del
   * documento que firma MOTRAE, así que no se puede «cambiar la fecha» de la
   * licencia que ya está en el restaurante — se emite otra y se pega encima. La
   * pantalla lo dice con todas las letras porque la diferencia importa: hasta que
   * el archivo llegue al local, ahí sigue valiendo la fecha vieja.
   *
   * Para qué sirve: lo que se negocia por teléfono. «Te doy hasta el viernes»,
   * «alineamos tu cobro al día 1», o corregir un vencimiento que se torció. Antes
   * la única fecha posible era «un mes más», y cualquier acuerdo distinto se
   * quedaba en un apunte que no llegaba al sistema.
   */
  import { untrack } from "svelte";
  import { central, type EntregaLicencia } from "../lib/central.svelte";
  import { fecha, plazo } from "../lib/formato";
  import { siguienteVencimiento, type ClienteMotRest } from "@motrest/dominio";

  const {
    cliente,
    onCerrar,
    onEmitida,
  }: {
    cliente: ClienteMotRest;
    onCerrar: () => void;
    onEmitida: (
      licencia: string,
      vence_ts: number,
      entrega: EntregaLicencia,
      motivo?: string,
    ) => void;
  } = $props();

  const DIA = 86_400_000;

  /**
   * El día que saldría al renovar normal: el punto de partida razonable.
   *
   * Se calcula una sola vez al abrir, no en vivo: si siguiera a la ficha, un
   * pulso o una edición mientras se elige la fecha movería el campo por debajo.
   */
  const propuesta = untrack(() =>
    siguienteVencimiento(cliente.licencia?.vence_ts ?? null, cliente.plan, central.ahora),
  );

  /**
   * `<input type="date">` habla en `YYYY-MM-DD` de hora LOCAL.
   *
   * `toISOString()` daría UTC y en México eso adelanta el día seis horas: elegir
   * el 31 acabaría emitiendo el 1. Se compone a mano con las partes locales.
   */
  function aCampo(ts: number): string {
    const d = new Date(ts);
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  /** Vence al FINAL del día elegido: nadie compra «hasta el viernes a las 00:00». */
  function delCampo(texto: string): number {
    const [anio, mes, dia] = texto.split("-").map(Number);
    return new Date(anio ?? 0, (mes ?? 1) - 1, dia ?? 1, 23, 59, 59).getTime();
  }

  let campo = $state(aCampo(propuesta));
  let error = $state("");
  let emitiendo = $state(false);

  const elegido = $derived(delCampo(campo));
  const dias = $derived(Math.round((elegido - central.ahora) / DIA));
  /* Lo que gana o pierde frente a la fecha que tiene hoy. */
  const diferencia = $derived(
    cliente.licencia ? Math.round((elegido - cliente.licencia.vence_ts) / DIA) : null,
  );

  function sumarDias(n: number) {
    const base = cliente.licencia?.vence_ts ?? central.ahora;
    campo = aCampo(base + n * DIA);
  }

  function finDeMes(mesesAdelante: number) {
    const d = new Date(central.ahora);
    /* Día 0 del mes siguiente = último día del mes actual. */
    campo = aCampo(new Date(d.getFullYear(), d.getMonth() + mesesAdelante + 1, 0).getTime());
  }

  async function emitir(evento: Event) {
    evento.preventDefault();
    if (emitiendo) return;
    emitiendo = true;
    error = "";

    try {
      const r = await central.emitir(cliente.id, { vence_ts: elegido });
      if (!r.ok) {
        error = r.error;
        return;
      }
      onEmitida(JSON.stringify(r.licencia, null, 2), r.licencia.vence_ts, r.entrega, r.motivoEntrega);
    } finally {
      emitiendo = false;
    }
  }
</script>

<div class="fondo" role="dialog" aria-modal="true" aria-labelledby="vencimiento-titulo">
  <form class="tarjeta" onsubmit={emitir}>
    <h2 id="vencimiento-titulo">Vencimiento de {cliente.nombre}</h2>

    <p class="actual">
      {#if cliente.licencia}
        Hoy vence el <b>{fecha(cliente.licencia.vence_ts)}</b>
        <em>({plazo(Math.round((cliente.licencia.vence_ts - central.ahora) / DIA))})</em>
      {:else}
        Este local todavía no tiene ninguna licencia emitida.
      {/if}
    </p>

    <label>
      Que venza el
      <input type="date" bind:value={campo} min={aCampo(central.ahora + DIA)} required />
    </label>

    <div class="atajos">
      <button type="button" onclick={() => sumarDias(7)}>+7 días</button>
      <button type="button" onclick={() => sumarDias(15)}>+15 días</button>
      <button type="button" onclick={() => sumarDias(30)}>+30 días</button>
      <button type="button" onclick={() => finDeMes(0)}>Fin de este mes</button>
      <button type="button" onclick={() => finDeMes(1)}>Fin del que viene</button>
      <button type="button" onclick={() => (campo = aCampo(propuesta))}>Lo normal</button>
    </div>

    <p class="resultado">
      Quedará vigente <b>{plazo(dias)}</b>, hasta el {fecha(elegido)}.
      {#if diferencia !== null && diferencia !== 0}
        <span class="diferencia" class:regala={diferencia > 0}>
          {diferencia > 0 ? `${diferencia} días más` : `${-diferencia} días menos`}
          que su fecha actual.
        </span>
      {/if}
    </p>

    <!--
      El aviso no es de cortesía: mientras el archivo no se pegue en la caja, en
      el restaurante sigue valiendo la fecha vieja. Es el error que hace pensar
      que «ya lo renové» cuando el local se bloquea el lunes.
    -->
    <p class="nota">
      Se firma una licencia nueva y <b>se le manda sola al restaurante</b>. Si el
      local está apagado, la recoge en cuanto encienda. Solo si la nube no
      responde habrá que pegar el archivo a mano.
    </p>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="botones">
      <button type="button" class="cancelar" onclick={onCerrar} disabled={emitiendo}>Cancelar</button>
      <button type="submit" class="primario" disabled={emitiendo}>
        {emitiendo ? "Firmando…" : "Emitir con esta fecha"}
      </button>
    </div>
  </form>
</div>

<style>
  .fondo {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(20, 24, 26, 0.5);
    overflow-y: auto;
  }
  .tarjeta {
    width: min(30rem, 100%);
    background: var(--blanco);
    border-radius: var(--r-lg);
    padding: 1.5rem;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h2 {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    margin: 0;
    color: var(--pizarra);
  }
  .actual {
    margin: 0;
    font-size: 0.84rem;
    color: var(--gris);
  }
  .actual b {
    color: var(--pizarra);
  }
  .actual em {
    font-style: normal;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  input {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    background: var(--blanco);
    color: var(--pizarra);
  }
  input:focus {
    outline: 2px solid var(--acento);
    outline-offset: -1px;
  }
  .atajos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .atajos button {
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .atajos button:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .resultado {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.55;
    color: var(--pizarra);
  }
  .diferencia {
    display: block;
    font-size: 0.79rem;
    color: var(--peligro);
  }
  .diferencia.regala {
    color: var(--gris);
  }
  .nota {
    font-size: 0.77rem;
    line-height: 1.55;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
    margin: 0;
  }
  .error {
    font-size: 0.82rem;
    color: var(--peligro);
    margin: 0;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.3rem;
  }
  .botones button {
    font: inherit;
    font-size: 0.86rem;
    font-weight: 600;
    padding: 0.55rem 1.1rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--borde);
    background: var(--blanco);
    color: var(--pizarra);
    cursor: pointer;
  }
  .primario {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--blanco);
  }
  .cancelar {
    border: none;
    color: var(--gris);
  }
</style>
