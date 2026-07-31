<script lang="ts">
  /**
   * Estado de la mesa seleccionada y sus acciones.
   *
   * Es lo que ve el mesero antes de tomar la comanda: si la mesa está libre,
   * la pone en servicio; si ya hay comensales, abre el pedido. El catálogo solo
   * aparece cuando de verdad se va a ordenar.
   */
  import { importeRenglon } from "@motrest/dominio";
  import { hora, mxn } from "./formato";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  interface Props {
    onPedido: () => void;
  }
  let { onPedido }: Props = $props();

  const estado = $derived(pos.estadoMesa(pos.mesaActiva));
  const area = $derived(plano.areaDeMesa(pos.mesaActiva));
  const duplicada = $derived(pos.mesasDuplicadas.includes(pos.mesaActiva));
  const t = $derived(pos.totales);
</script>

<section class="panel">
  <div class="cabecera">
    <div class="identidad">
      <span class="rotulo">Mesa</span>
      <span class="numero">{pos.nombreMesaActiva}</span>
      {#if area}<span class="area">{area.nombre}</span>{/if}
    </div>
    <span class="estado {estado}">
      {#if estado === "libre"}Libre
      {:else if estado === "cuenta"}En cocina
      {:else}En servicio{/if}
    </span>
  </div>

  <!--
    Dos terminales pusieron esta mesa en servicio antes de sincronizar, así que
    quedaron dos cuentas abiertas. Se avisa ANTES de cobrar: descubrirlo después
    significa que a alguien se le cobró de menos y ya se fue.
  -->
  {#if duplicada}
    <p class="duplicada" role="alert">
      <b>Esta mesa tiene dos cuentas abiertas.</b>
      Se abrió desde dos terminales a la vez. Revisa las dos y traspasa los
      platillos a una sola antes de cobrar.
    </p>
  {/if}

  {#if estado === "libre"}
    <div class="centro">
      <p class="mensaje">Esta mesa está libre.</p>
      <p class="ayuda">Cuando lleguen los comensales, ponla en servicio para abrir su cuenta.</p>
      <button class="principal" onclick={() => pos.ponerEnServicio()}>
        Llegaron comensales · poner en servicio
      </button>
    </div>
  {:else if pos.comanda}
    <div class="resumen">
      <p class="abierta">
        Abierta {hora(pos.comanda.abierta_ts)} · {sesion.nombreDe(pos.comanda.mesero_id)}
      </p>

      {#if pos.renglones.length === 0}
        <p class="ayuda">Todavía no se ha ordenado nada.</p>
      {:else}
        <ul class="consumo">
          {#each pos.renglones as renglon (renglon.id)}
            <li>
              <span class="q">{renglon.cantidad}×</span>
              <span class="n">{renglon.descripcion}</span>
              <span class="p">{mxn(importeRenglon(renglon))}</span>
            </li>
          {/each}
        </ul>
        {#if t}
          <p class="total">Consumo actual <b>{mxn(t.total)}</b></p>
        {/if}
      {/if}
    </div>

    <!--
      Aquí solo se captura. Enviar a cocina vive en la cuenta, que es donde se
      ven los platillos que van a salir: mandar a ciegas es como se pierden
      comandas.
    -->
    <div class="acciones">
      <button class="principal" onclick={onPedido}>
        {pos.renglones.length === 0 ? "Tomar pedido" : "Agregar al pedido"}
      </button>
      {#if pos.pendientes.length > 0}
        <p class="recordatorio">
          {pos.pendientes.length}
          {pos.pendientes.length === 1 ? "platillo pendiente" : "platillos pendientes"} de
          enviar · usa <b>Enviar a cocina</b> en la cuenta
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .duplicada {
    margin: 0.75rem 0 0;
    padding: 0.6rem 0.8rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--peligro);
    background: color-mix(in srgb, var(--peligro) 8%, transparent);
    color: var(--pizarra);
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .cabecera {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--borde);
  }
  .identidad {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .rotulo {
    font-size: 0.9rem;
    color: var(--gris);
  }
  .numero {
    font-family: var(--font-titulo);
    font-size: 2.2rem;
    font-weight: 700;
    line-height: 1;
  }
  .area {
    font-size: 0.82rem;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.65rem;
  }
  .estado {
    font-size: 0.8rem;
    font-weight: 700;
    border-radius: var(--r-pill);
    padding: 0.3rem 0.8rem;
    white-space: nowrap;
  }
  .estado.libre {
    background: #eef1ed;
    color: var(--gris);
  }
  .estado.ocupada {
    background: #fdeae8;
    color: var(--peligro);
  }
  .estado.cuenta {
    background: var(--claro);
    color: var(--acento);
  }
  .centro {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    text-align: center;
  }
  .mensaje {
    font-family: var(--font-titulo);
    font-size: 1.25rem;
    font-weight: 600;
  }
  .ayuda {
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 24rem;
  }
  .resumen {
    padding-top: 1rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .abierta {
    font-size: 0.85rem;
    color: var(--gris);
    margin-bottom: 0.85rem;
  }
  .consumo {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .consumo li {
    display: flex;
    gap: 0.6rem;
    font-size: 0.92rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .consumo .q {
    font-weight: 700;
    color: var(--acento);
    min-width: 1.8rem;
  }
  .consumo .n {
    flex: 1;
  }
  .consumo .p {
    font-weight: 600;
  }
  .total {
    margin-top: 0.85rem;
    display: flex;
    justify-content: space-between;
    font-size: 0.95rem;
    color: var(--gris);
  }
  .total b {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    color: var(--pizarra);
  }
  .acciones {
    margin-top: auto;
    padding-top: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 1rem 1.5rem;
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    font-weight: 600;
    box-shadow: var(--sombra-md);
    transition: filter 0.12s ease;
  }
  .principal:hover {
    filter: brightness(1.05);
  }
  .recordatorio {
    font-size: 0.82rem;
    color: var(--gris);
    text-align: center;
    line-height: 1.5;
  }
  .recordatorio b {
    color: var(--acento);
  }
</style>
