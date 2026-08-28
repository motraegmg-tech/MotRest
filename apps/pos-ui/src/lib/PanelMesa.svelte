<script lang="ts">
  /**
   * Estado de la mesa seleccionada y sus acciones.
   *
   * Es lo que ve el mesero antes de tomar la comanda: si la mesa está libre,
   * la pone en servicio; si ya hay comensales, abre el pedido. El catálogo solo
   * aparece cuando de verdad se va a ordenar.
   */
  import {
    MAX_MESAS_UNIDAS,
    capacidadDe,
    desglosarConTasas,
    importeRenglon,
    nombreDia,
    type Centavos,
    type RenglonComanda,
  } from "@motrest/dominio";
  import { asignaciones } from "./asignaciones.svelte";
  import { hora, mxn } from "./formato";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { rutas } from "./nav/rutas.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  interface Props {
    onPedido: () => void;
  }
  let { onPedido }: Props = $props();

  const estado = $derived(pos.estadoMesa(pos.mesaActiva));
  const area = $derived(plano.areaDeMesa(pos.mesaActiva));
  const duplicada = $derived(pos.mesasDuplicadas.includes(pos.mesaActiva));
  const t = $derived(pos.totales);

  /** Lo que paga el comensal por el renglón: precio con su impuesto dentro. */
  function conImpuesto(renglon: RenglonComanda): Centavos {
    return desglosarConTasas(importeRenglon(renglon), renglon.impuesto).total;
  }

  // --- Quién atiende esta mesa hoy ---------------------------------------------

  const hoy = $derived(asignaciones.hoy);
  const asignados = $derived(asignaciones.meserosDe(pos.mesaActiva, hoy));
  const soyDeEstaMesa = $derived(
    !!sesion.usuarioActual && asignados.includes(sesion.usuarioActual.id),
  );
  /** Solo quien administra personal tiene por qué ver el camino a la tabla. */
  const puedeEditarRol = $derived(sesion.puedeVer("rrhh.empleado.editar"));

  // --- Juntar mesas -------------------------------------------------------------

  /*
   * LLEGARON DIEZ Y LA MESA ES DE CUATRO.
   *
   * Hasta la 1.3.4 esto se resolvía abriendo dos cuentas y cobrando dos veces al
   * mismo grupo, o cargándolo todo a una mesa y dejando la otra «libre» con
   * gente sentada. Ahora es UNA cuenta que ocupa varias mesas: la cocina recibe
   * una comanda, el ticket sale uno, y al cobrar se sueltan todas juntas.
   */
  let juntando = $state(false);
  let elegidas = $state<string[]>([]);

  /** Candidatas: libres, de la misma área y que no sean la de aquí. */
  const juntables = $derived(
    plano.mesas.filter((m) => m.id !== pos.mesaActiva && pos.estadoMesa(m.id) === "libre"),
  );

  const capacidadJunta = $derived(
    plano.capacidadMesa(pos.mesaActiva) +
      elegidas.reduce((suma, id) => suma + plano.capacidadMesa(id), 0),
  );

  /** Cuántas más se pueden marcar sin pasarse del tope de mesas por cuenta. */
  const quedanPorMarcar = $derived(MAX_MESAS_UNIDAS - 1 - elegidas.length);

  function alternar(mesaId: string) {
    elegidas = elegidas.includes(mesaId)
      ? elegidas.filter((id) => id !== mesaId)
      : quedanPorMarcar > 0
        ? [...elegidas, mesaId]
        : elegidas;
  }

  function cancelarJuntar() {
    juntando = false;
    elegidas = [];
  }

  async function confirmarJuntar() {
    await pos.juntarMesas(elegidas);
    cancelarJuntar();
  }
</script>

<section class="panel">
  <div class="cabecera">
    <div class="identidad">
      <!-- «Mesas» en plural cuando la cuenta ocupa varias: es una sola cuenta,
           pero el mesero tiene que ver de un vistazo que atiende dos muebles. -->
      <span class="rotulo">{pos.mesasDeLaCuentaActiva.length > 1 ? "Mesas" : "Mesa"}</span>
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
      {#if juntando}
        <p class="mensaje">¿Con qué mesas se junta?</p>
        <p class="ayuda">
          Se abrirá <b>una sola cuenta</b> para todas: un ticket, una comanda a
          cocina y un cobro. Al cerrarla se liberan juntas.
        </p>

        {#if juntables.length === 0}
          <p class="ayuda">No hay ninguna otra mesa libre en {area?.nombre ?? "esta área"}.</p>
        {:else}
          <div class="juntables">
            {#each juntables as m (m.id)}
              {@const marcada = elegidas.includes(m.id)}
              <button
                class="juntable"
                class:on={marcada}
                disabled={!marcada && quedanPorMarcar === 0}
                onclick={() => alternar(m.id)}
              >
                <b>{m.nombre}</b>
                <small>{capacidadDe(m)} pers.</small>
              </button>
            {/each}
          </div>

          <p class="capacidad">
            {#if elegidas.length === 0}
              Marca al menos una mesa. Se pueden juntar hasta {MAX_MESAS_UNIDAS}.
            {:else}
              Mesa {pos.nombreMesaActiva} + {elegidas.length}
              {elegidas.length === 1 ? "mesa" : "mesas"} ·
              <b>{capacidadJunta} comensales</b>
            {/if}
          </p>
        {/if}

        <div class="dos-botones">
          <button class="secundario" onclick={cancelarJuntar}>Cancelar</button>
          <button class="principal" disabled={elegidas.length === 0} onclick={confirmarJuntar}>
            Juntar y poner en servicio
          </button>
        </div>
      {:else}
        <p class="mensaje">Esta mesa está libre.</p>
        <p class="ayuda">
          Cuando lleguen los comensales, ponla en servicio para abrir su cuenta.
          Caben <b>{plano.capacidadMesa(pos.mesaActiva)}</b>.
        </p>
        <button class="principal" onclick={() => pos.ponerEnServicio()}>
          Llegaron comensales · poner en servicio
        </button>
        {#if juntables.length > 0}
          <button class="secundario" onclick={() => (juntando = true)}>
            Son más de {plano.capacidadMesa(pos.mesaActiva)} · juntar mesas
          </button>
        {/if}
      {/if}
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
              <span class="p">{mxn(conImpuesto(renglon))}</span>
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
      <!--
        Se abrió la mesa y nadie pidió nada: los comensales se cambiaron de
        lugar o se fueron. Solo aparece mientras la cuenta está vacía — con
        consumo lo que corresponde es cancelar los renglones o cobrar, y esos
        dos caminos sí dejan rastro de qué pasó con el producto.
      -->
      {#if pos.puedeLiberarMesa}
        <button class="liberar" onclick={() => pos.liberarMesa()}>
          Poner libre la mesa
        </button>
        <p class="recordatorio tenue">
          Se cierra sin cobrar y no cuenta como venta. Deja de estar disponible
          en cuanto se capture el primer platillo.
        </p>
      {/if}
      {#if pos.pendientes.length > 0}
        <p class="recordatorio">
          {pos.pendientes.length}
          {pos.pendientes.length === 1 ? "platillo pendiente" : "platillos pendientes"} de
          enviar · usa <b>Enviar a cocina</b> en la cuenta
        </p>
      {/if}
    </div>
  {/if}

  <!--
    QUIÉN ATIENDE ESTA MESA HOY.
    Va al pie del panel y no arriba: durante el servicio lo que se mira primero
    es el consumo. Esto se consulta cuando hay una duda —de quién es la mesa,
    a quién se le avisa cuando cocina termina—, y para eso basta con que esté.
  -->
  <div class="rol">
    <span class="rotulo-rol">Atiende · {nombreDia(hoy)}</span>
    {#if asignados.length === 0}
      <span class="sin-rol">Sin asignar · la atiende quien la abra</span>
    {:else}
      <span class="quienes">
        {#each asignados as meseroId (meseroId)}
          <span class="mesero" class:yo={meseroId === sesion.usuarioActual?.id}>
            {sesion.nombreDe(meseroId)}
          </span>
        {/each}
      </span>
    {/if}
    {#if soyDeEstaMesa}<span class="tuya">Es tuya</span>{/if}
    {#if puedeEditarRol}
      <button class="editar-rol" onclick={() => rutas.ir("personal", "mesas")}>
        Cambiar rol de mesas
      </button>
    {/if}
  </div>
</section>

<style>
  /* --- Quién atiende la mesa --- */
  /*
   * Sin `margin-top: auto`: `.acciones` ya lo lleva, y dos márgenes automáticos
   * hermanos se reparten el hueco libre, abriendo un vacío entre los dos.
   */
  .rol {
    margin-top: 1.1rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--borde);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .rotulo-rol {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .quienes {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .mesero {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.12rem 0.6rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .mesero.yo {
    border-color: var(--acento);
    color: var(--acento);
  }
  .sin-rol {
    font-style: italic;
  }
  .tuya {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-pill);
    padding: 0.12rem 0.6rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .editar-rol {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .editar-rol:hover {
    color: var(--acento);
  }
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
  .principal:disabled {
    background: var(--borde);
    color: var(--gris);
    box-shadow: none;
    cursor: not-allowed;
  }

  /* --- Juntar mesas ------------------------------------------------------- */

  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--blanco);
    padding: 0.6rem 1.1rem;
    font-family: var(--font-titulo);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--gris);
    cursor: pointer;
  }
  .secundario:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .dos-botones {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .juntables {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    max-width: 26rem;
  }
  .juntable {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    min-width: 3.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--blanco);
    padding: 0.45rem 0.6rem;
    cursor: pointer;
  }
  .juntable b {
    font-family: var(--font-titulo);
    font-size: 1rem;
    color: var(--pizarra);
  }
  .juntable small {
    font-size: 0.66rem;
    color: var(--gris);
  }
  .juntable.on {
    border-color: var(--acento);
    background: var(--claro);
  }
  .juntable.on b {
    color: var(--acento);
  }
  .juntable:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .capacidad {
    font-size: 0.88rem;
    color: var(--gris);
  }
  .capacidad b {
    color: var(--acento);
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
  .recordatorio.tenue {
    font-size: 0.76rem;
  }
  /*
   * Discreto a propósito: liberar una mesa es la salida de un error, no una
   * acción del servicio. Con el mismo peso visual que «Tomar pedido» invitaría
   * a pulsarlo por costumbre.
   */
  .liberar {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 0.7rem 1.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .liberar:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
</style>
