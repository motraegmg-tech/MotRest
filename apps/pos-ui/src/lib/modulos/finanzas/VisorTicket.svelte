<script lang="ts">
  /**
   * El ticket de un cobro, en pantalla.
   *
   * ## Qué resuelve
   *
   * Pedido de Gonzalo: poder ver el ticket de una cuenta concreta. Las listas
   * de Finanzas decían cuánto y con qué se pagó, pero no QUÉ se vendió; para
   * atender una reclamación había que adivinar o volver al salón, donde la mesa
   * ya está ocupada por otros.
   *
   * ## Por qué es un componente y no está escrito en cada pantalla
   *
   * Se abre desde dos sitios —la venta del día y los tickets cobrados— y va a
   * abrirse desde más. Dos copias del mismo visor son dos sitios donde arreglar
   * el mismo defecto, y el día que una se quede atrás el restaurante verá dos
   * tickets distintos del mismo cobro.
   *
   * ## Se dibuja con la plantilla de la impresora
   *
   * No es una reconstrucción parecida: es `precuenta()`, la misma función que
   * compone los bytes que salen por el rollo. Lo que se ve aquí es literalmente
   * el papel que se entregó, y por eso va en monoespaciada y con su ancho.
   *
   * ## Mirar NO es reimprimir
   *
   * La reimpresión queda en la bitácora porque es un vector de fraude conocido
   * —se cobra, se entrega el papel, se reimprime y se vuelve a cobrar con él—.
   * Anotarla cada vez que alguien echa un vistazo la dejaría sin servir para
   * detectar nada, así que ver no registra: el botón de reimprimir, sí.
   */
  import { etiquetaFormaPago, mesasDeComanda, totalesComanda } from "@motrest/dominio";
  import { precuenta } from "@motrest/impresion";
  import { hora, mxn } from "../../formato";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  interface Props {
    ordenId: string;
    onCerrar: () => void;
    /** Si se pasa, aparece el botón para corregir con qué se cobró. */
    onCambiarCobro?: (ordenId: string) => void;
  }

  let { ordenId, onCerrar, onCambiarCobro }: Props = $props();

  const comanda = $derived(pos.todasLasComandas.find((c) => c.orden_id === ordenId));

  /** El papel, tal cual. Vacío si la cuenta ya no está —la pudo retirar la retención—. */
  const papel = $derived.by(() => {
    const datos = pos.datosDelTicket(ordenId);
    return datos ? precuenta(datos).aTexto() : "";
  });

  const formas = $derived(
    comanda
      ? [...new Set(comanda.pagos.map((p) => etiquetaFormaPago(p.forma)))].join(" + ") || "—"
      : "—",
  );

  const corregido = $derived(comanda?.pagos.some((p) => p.forma_original) ?? false);
  const puedeCorregir = $derived(sesion.puedeVer("pos.cuenta.reabrir"));

  async function reimprimir() {
    await pos.reimprimirTicketDe(ordenId);
  }
</script>

<div class="velo" role="presentation" onclick={onCerrar}></div>
<div class="visor" role="dialog" aria-modal="true" aria-label="Ticket del cobro">
  {#if comanda}
    {@const t = totalesComanda(comanda)}
    <header>
      <div>
        <h2>Ticket {comanda.orden_id.slice(-8).toUpperCase()}</h2>
        <p class="quien">
          {plano.etiquetaMesas(mesasDeComanda(comanda))} ·
          {hora(comanda.cerrada_ts ?? comanda.abierta_ts)} ·
          atendió {sesion.nombreDe(comanda.mesero_id)}
        </p>
      </div>
      <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
    </header>

    <pre class="papel">{papel}</pre>

    <footer>
      <span class="pie-formas">
        {mxn(t.total)} en <b>{formas}</b>
        {#if corregido}<small class="corregido">corregido</small>{/if}
      </span>
      <!--
        Corregir desde aquí mismo: es donde se descubre el error, con el ticket
        delante. Obligar a cerrar y buscar el renglón en la tabla es el paso que
        hace que nadie lo corrija.
      -->
      {#if onCambiarCobro && puedeCorregir && !comanda.cancelada && comanda.pagos.length > 0}
        <button class="mini" onclick={() => onCambiarCobro?.(ordenId)}>
          Cambiar forma de cobro
        </button>
      {/if}
      <button class="mini" onclick={reimprimir}>Reimprimir</button>
    </footer>

    <p class="nota-visor">
      Mirar el ticket no cuenta como reimpresión. <b>Reimprimir</b> sí saca papel
      y queda anotado, porque un ticket duplicado se puede usar para cobrar dos
      veces.
    </p>
  {:else}
    <header>
      <div><h2>Ticket</h2></div>
      <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
    </header>
    <!--
      Puede pasar de verdad: la retención retira del disco las cuentas más
      viejas que el plazo elegido. Decirlo es mejor que enseñar un papel vacío.
    -->
    <p class="nota-visor">
      Esta cuenta ya no está guardada en esta computadora. El historial se
      conserva el tiempo que se haya elegido en <b>Ventas por día</b>.
    </p>
  {/if}
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .visor {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    background: #fff;
    border-radius: 14px;
    box-shadow: var(--sombra-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 1.2rem 0.7rem;
    border-bottom: 1px solid var(--borde);
  }
  header > div {
    flex: 1;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .quien {
    margin-top: 0.15rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .cerrar {
    font-size: 1.5rem;
    line-height: 1;
    color: var(--gris);
    background: none;
    border: none;
  }
  /*
   * El papel, tal cual sale del rollo: monoespaciada y con su ancho. Pintado
   * con la tipografía de la pantalla dejaría de reconocerse como el ticket que
   * el comensal tuvo en la mano.
   */
  .papel {
    margin: 0;
    padding: 1rem 1.2rem;
    overflow: auto;
    flex: 1;
    white-space: pre;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--pizarra);
    background: #fdfcfb;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.7rem 1.2rem 0.4rem;
    border-top: 1px solid var(--borde);
  }
  .pie-formas {
    flex: 1;
    min-width: 9rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .pie-formas b {
    color: var(--pizarra);
  }
  .corregido {
    display: block;
    font-size: 0.7rem;
    font-style: italic;
    color: var(--acento-texto);
  }
  .nota-visor {
    padding: 0.4rem 1.2rem 1rem;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--gris);
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    padding: 0.35rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    flex: none;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
</style>
