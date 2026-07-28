<script lang="ts">
  import {
    CERO,
    FORMAS_PAGO,
    importeRenglon,
    pesos,
    repartir,
    restar,
    sumar,
    MOTIVOS_OPINION,
    type Calificacion,
    type FormaPago,
    type MotivoOpinion,
  } from "@motrest/dominio";
  import DialogoFactura from "./DialogoFactura.svelte";
  import { hora, mxn } from "./formato";
  import { opiniones } from "./opiniones.svelte";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";

  let facturando = $state(false);

  const etiquetaEstado: Record<string, string> = {
    enviado: "en cocina",
    en_marcha: "preparando",
    listo: "listo",
    entregado: "entregado",
  };

  type Vista = "cuenta" | "cobro" | "traspaso";
  let vista = $state<Vista>("cuenta");
  let formaPago = $state<FormaPago>("efectivo");
  let recibido = $state("");
  let partes = $state(2);
  let renglonATraspasar = $state<string | null>(null);

  /*
   * Indicaciones para cocina, editables DESPUÉS de capturar el platillo.
   *
   * El comensal casi nunca lo dice todo de una vez: pide la hamburguesa y,
   * cuando el mesero ya la marcó, añade que la quiere sin tomate. Sin esto
   * habría que cancelar el renglón y recapturarlo, lo que además ensucia el
   * reporte de cancelaciones.
   */
  let editandoIndicaciones = $state<string | null>(null);
  let textoIndicaciones = $state("");

  /*
   * Las más frecuentes, a un toque. Teclear en una tablet con el comensal
   * enfrente es lento, y lo lento se termina por no hacer.
   */
  const INDICACIONES_RAPIDAS = [
    "Sin cebolla",
    "Sin tomate",
    "Sin queso",
    "Sin picante",
    "Bien cocido",
    "Término medio",
    "Para compartir",
    "Sin gluten",
    "ALERGIA",
  ];

  function abrirIndicaciones(renglonId: string, actuales: string) {
    editandoIndicaciones = renglonId;
    textoIndicaciones = actuales;
  }

  function agregarRapida(texto: string) {
    const partes = textoIndicaciones
      .split("·")
      .map((p) => p.trim())
      .filter(Boolean);
    // Tocar dos veces la misma quita, para poder corregir sin borrar a mano.
    textoIndicaciones = (
      partes.includes(texto) ? partes.filter((p) => p !== texto) : [...partes, texto]
    ).join(" · ");
  }

  async function guardarIndicaciones() {
    if (!editandoIndicaciones) return;
    await pos.cambiarNotas(editandoIndicaciones, textoIndicaciones);
    editandoIndicaciones = null;
    textoIndicaciones = "";
  }

  const renglonEnEdicion = $derived(
    pos.renglones.find((r) => r.id === editandoIndicaciones) ?? null,
  );
  /** Ya está en cocina: cambiarlo ahora obliga a avisar, y conviene decirlo. */
  const yaEnCocina = $derived(
    renglonEnEdicion !== null &&
      renglonEnEdicion.estado !== "capturado" &&
      renglonEnEdicion.estado !== "cancelado",
  );

  const t = $derived(pos.totales);
  const promos = $derived(pos.promociones?.descuentos ?? []);
  const recibidoCentavos = $derived(pesos(Number(recibido) || 0));
  const cambio = $derived(
    t && recibidoCentavos > t.saldo ? restar(recibidoCentavos, t.saldo) : CERO,
  );

  async function cobrarAhora() {
    if (!t) return;
    const ordenId = pos.comanda?.orden_id;
    const esEfectivo = formaPago === "efectivo";
    await pos.cobrar(formaPago, t.saldo, esEfectivo && recibidoCentavos > 0 ? recibidoCentavos : undefined);
    recibido = "";
    vista = "cuenta";

    /*
     * Al cerrar la cuenta es el ÚNICO momento en que hay una conversación con
     * la mesa. Se pregunta aquí o no se pregunta nunca; una encuesta por correo
     * al día siguiente la contesta el 2 %.
     */
    if (ordenId && pos.comanda?.cerrada && !opiniones.yaOpinada(ordenId)) {
      opinandoOrden = ordenId;
    }
  }

  // --- Reabrir una cuenta cobrada por error ---
  let reabriendo = $state(false);
  let motivoReapertura = $state("");

  async function confirmarReapertura() {
    const ok = await pos.reabrirCuenta(motivoReapertura);
    if (ok) {
      reabriendo = false;
      motivoReapertura = "";
    }
  }

  // --- A nombre de quién (pedidos para llevar) ---
  let poniendoNombre = $state(false);
  let nombrePedido = $state("");
  let telefonoPedido = $state("");

  function abrirNombre() {
    nombrePedido = pos.comanda?.a_nombre_de ?? "";
    telefonoPedido = pos.comanda?.telefono ?? "";
    poniendoNombre = true;
  }

  async function guardarNombre() {
    await pos.identificar(nombrePedido, telefonoPedido);
    poniendoNombre = false;
  }

  // --- Voz del cliente: cómo estuvo todo ---
  let opinandoOrden = $state<string | null>(null);
  let motivosElegidos = $state<MotivoOpinion[]>([]);
  let comentarioOpinion = $state("");
  let calificacionElegida = $state<Calificacion | null>(null);

  function cerrarOpinion() {
    opinandoOrden = null;
    motivosElegidos = [];
    comentarioOpinion = "";
    calificacionElegida = null;
  }

  function calificar(c: Calificacion) {
    calificacionElegida = c;
    // «Bien» se guarda de una vez: alargarlo haría que se dejara de preguntar.
    if (c === "bien") guardarOpinion();
  }

  function alternarMotivo(m: MotivoOpinion) {
    motivosElegidos = motivosElegidos.includes(m)
      ? motivosElegidos.filter((x) => x !== m)
      : [...motivosElegidos, m];
  }

  function guardarOpinion() {
    if (!opinandoOrden || !calificacionElegida) return;
    opiniones.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    opiniones.registrar({
      ordenId: opinandoOrden,
      calificacion: calificacionElegida,
      motivos: motivosElegidos,
      comentario: comentarioOpinion,
    });
    cerrarOpinion();
  }

  async function dividir() {
    await pos.dividirEnPartes(partes, formaPago);
    vista = "cuenta";
  }

  async function traspasar(mesaId: string) {
    if (!renglonATraspasar) return;
    await pos.traspasarRenglon(renglonATraspasar, mesaId);
    renglonATraspasar = null;
    vista = "cuenta";
  }
</script>

<aside class="cuenta">
  {#if pos.comanda && pos.comandaAbierta && t}
    <div class="ch">
      <h2>Mesa {pos.nombreMesaActiva}</h2>
      <!--
        A nombre de quién. Es lo que convierte una mesa cualquiera en un pedido
        PARA LLEVAR: sin un nombre, cocina prepara y nadie sabe de quién es la
        bolsa del mostrador.
      -->
      {#if pos.comanda.a_nombre_de}
        <button class="chip nombre" onclick={abrirNombre} title="Cambiar el nombre">
          {pos.comanda.a_nombre_de}
        </button>
      {:else}
        <button class="chip poner-nombre" onclick={abrirNombre}>+ Nombre</button>
      {/if}
      {#if pos.enviadaACocina}
        <span class="chip cocina">En cocina</span>
      {:else}
        <span class="chip gray">Abierta</span>
      {/if}
    </div>
    <div class="sub">
      {sesion.nombreDe(pos.comanda.mesero_id)} · abierta {hora(pos.comanda.abierta_ts)}
    </div>

    {#if vista === "cuenta"}
      <div class="items">
        {#if pos.renglones.length === 0}
          <p class="sin-consumo">
            Mesa en servicio, sin consumo todavía. Toma el pedido para empezar la cuenta.
          </p>
        {/if}
        {#each pos.renglones as renglon (renglon.id)}
          <div class="item">
            <span class="cant">
              <button onclick={() => pos.cambiarCantidad(renglon.id, -1)} aria-label="Menos">−</button>
              <b>{renglon.cantidad}</b>
              <button onclick={() => pos.cambiarCantidad(renglon.id, 1)} aria-label="Más">+</button>
            </span>
            <span class="n">
              {renglon.descripcion}
              {#if renglon.detalle}<small>{renglon.detalle}</small>{/if}
              {#if renglon.notas}
                <small class="indicacion">⚠ {renglon.notas}</small>
              {/if}
              {#if etiquetaEstado[renglon.estado]}
                <em class="est-r">{etiquetaEstado[renglon.estado]}</em>
              {/if}
            </span>
            <span class="p">{mxn(importeRenglon(renglon))}</span>
            <span class="acciones">
              <button
                class="mini"
                class:activa={renglon.notas}
                title="Indicaciones para cocina"
                aria-label="Indicaciones para {renglon.descripcion}"
                onclick={() => abrirIndicaciones(renglon.id, renglon.notas ?? "")}
              >✎</button>
              <button
                class="mini"
                title="Traspasar a otra mesa"
                aria-label="Traspasar {renglon.descripcion}"
                onclick={() => { renglonATraspasar = renglon.id; vista = "traspaso"; }}
              >⇄</button>
              <button
                class="mini x"
                title="Cancelar renglón"
                aria-label="Cancelar {renglon.descripcion}"
                onclick={() => pos.cancelar(renglon.id)}
              >×</button>
            </span>
          </div>
        {/each}
      </div>

      <!--
        Las promociones se ofrecen, no se cobran solas. Que alguien de la casa
        confirme es lo que evita descubrir en el corte que una promoción mal
        configurada estuvo regalando producto toda la noche.
      -->
      {#each promos as promo (promo.promocion_id)}
        <button class="promo" onclick={() => pos.aplicarPromocion(promo)}>
          <span class="etiqueta">Promoción</span>
          <span class="nombre">{promo.nombre}</span>
          <span class="importe">−{mxn(promo.importe)}</span>
          <span class="cta">Aplicar</span>
        </button>
      {/each}

      <div class="tot">
        {#if t.descuentos > 0 || t.cortesias > 0}
          <div><span>Bruto</span><span>{mxn(t.bruto)}</span></div>
          {#if t.descuentos > 0}
            <div class="rebaja"><span>Descuentos</span><span>−{mxn(t.descuentos)}</span></div>
          {/if}
          {#if t.cortesias > 0}
            <div class="rebaja"><span>Cortesías</span><span>−{mxn(t.cortesias)}</span></div>
          {/if}
        {/if}
        <div><span>Subtotal</span><span>{mxn(t.subtotal)}</span></div>
        <div><span>IVA (16%)</span><span>{mxn(t.iva)}</span></div>
        {#if t.ieps > 0}<div><span>IEPS</span><span>{mxn(t.ieps)}</span></div>{/if}
        {#if t.propina > 0}
          <div class="propina"><span>Propina</span><span>{mxn(t.propina)}</span></div>
        {/if}
        <div class="gt"><span>Total</span><span>{mxn(sumar(t.total, t.propina))}</span></div>
        {#if t.pagado > 0}
          <div><span>Pagado</span><span>{mxn(t.pagado)}</span></div>
          <div class="saldo"><span>Saldo</span><span>{mxn(t.saldo)}</span></div>
        {/if}
      </div>

      <div class="extras" class:oculto={!pos.hayCuenta}>
        {#if sesion.puedeOperar("fin.factura.emitir")}
          <span class="grupo">
            Factura
            <button class="mini" onclick={() => (facturando = true)}>Emitir CFDI</button>
          </span>
        {/if}
        <span class="grupo">
          Propina
          {#each [0.1, 0.15, 0.2] as pct (pct)}
            <button class="mini" onclick={() => pos.propinaPorcentaje(pct)}>
              {Math.round(pct * 100)}%
            </button>
          {/each}
          {#if t.propina > 0}
            <button class="mini" onclick={() => pos.propinaPorcentaje(0)}>Quitar</button>
          {/if}
        </span>
        <span class="grupo">
          <button class="mini" onclick={() => pos.aplicarDescuento(0.1, "Descuento de cortesía")}>
            −10%
          </button>
          <button class="mini" onclick={() => pos.otorgarCortesia(undefined, "Cortesía de la casa")}>
            Cortesía
          </button>
        </span>
      </div>

      <div class="btns">
        <button
          class="b1"
          disabled={pos.pendientes.length === 0}
          onclick={() => pos.enviarACocina()}
        >
          {pos.pendientes.length === 0
            ? "✓ Todo enviado a cocina"
            : `Enviar a cocina (${pos.pendientes.length})`}
        </button>
        <button
          class="b2 cobrar"
          disabled={!pos.hayCuenta}
          onclick={() => (vista = "cobro")}
        >
          Cobrar {mxn(t.saldo)}
        </button>
      </div>
    {:else if vista === "cobro"}
      <div class="panel-cobro">
        <p class="titulo-panel">Cobrar {mxn(t.saldo)}</p>

        <div class="formas">
          {#each FORMAS_PAGO as forma (forma.valor)}
            <button
              class="mini"
              class:on={formaPago === forma.valor}
              onclick={() => (formaPago = forma.valor)}
            >
              {forma.etiqueta}
            </button>
          {/each}
        </div>

        {#if formaPago === "efectivo"}
          <label class="campo">
            <span>Recibido</span>
            <input type="number" inputmode="decimal" bind:value={recibido} placeholder="0.00" />
          </label>
          {#if cambio > 0}
            <p class="cambio">Cambio: <b>{mxn(cambio)}</b></p>
          {/if}
        {/if}

        <button class="b1" onclick={cobrarAhora}>Registrar pago</button>

        <div class="dividir">
          <span>Dividir en</span>
          <button class="mini" onclick={() => (partes = Math.max(2, partes - 1))}>−</button>
          <b>{partes}</b>
          <button class="mini" onclick={() => (partes = Math.min(20, partes + 1))}>+</button>
          <span class="cada">{mxn(repartir(sumar(t.total, t.propina), partes)[0] ?? CERO)} c/u</span>
          <button class="mini" onclick={dividir}>Dividir y cobrar</button>
        </div>

        <button class="volver" onclick={() => (vista = "cuenta")}>← Volver a la cuenta</button>
      </div>
    {:else}
      <div class="panel-cobro">
        <p class="titulo-panel">Traspasar a la mesa…</p>
        <div class="mesas-destino">
          {#each plano.todasLasMesas.filter((m) => m.id !== pos.mesaActiva) as mesa (mesa.id)}
            <button class="mini" onclick={() => traspasar(mesa.id)}>{mesa.nombre}</button>
          {/each}
        </div>
        <button class="volver" onclick={() => { renglonATraspasar = null; vista = "cuenta"; }}>
          ← Cancelar
        </button>
      </div>
    {/if}
  {:else}
    <div class="vacia">
      <div class="mesa-num">Mesa {pos.nombreMesaActiva}</div>
      <p class="titulo-vacio">Sin cuenta abierta</p>
      <p class="hint">Toca una mesa del salón o agrega un producto de la carta.</p>

      <!--
        Reabrir lo último que se cobró en esta mesa. Pasa a diario: se cobró de
        más, el cliente quiere agregar un postre, o se cobró la mesa
        equivocada. Sin esta salida hay que cobrar otra vez y el corte se
        descuadra.
      -->
      {#if pos.ultimaCobrada}
        <div class="acciones-cobrada">
          <!-- El cliente pide otra copia todos los días. -->
          <button class="reabrir" onclick={() => pos.reimprimirTicket()}>
            Reimprimir el ticket
          </button>
          <button class="reabrir" onclick={() => (reabriendo = true)}>
            Reabrir la última cuenta cobrada
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if pos.mensaje}
    <div class="toast" role="status">{pos.mensaje}</div>
  {/if}
</aside>

{#if facturando && pos.comanda}
  <DialogoFactura comanda={pos.comanda} onCerrar={() => (facturando = false)} />
{/if}

<!-- Indicaciones para cocina -->
{#if renglonEnEdicion}
  <div
    class="velo"
    role="button"
    tabindex="-1"
    onclick={() => (editandoIndicaciones = null)}
    onkeydown={(e) => e.key === "Escape" && (editandoIndicaciones = null)}
  >
    <div
      class="dialogo"
      role="dialog"
      aria-label="Indicaciones para cocina"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <h3>Indicaciones para cocina</h3>
      <p class="que">{renglonEnEdicion.cantidad}× {renglonEnEdicion.descripcion}</p>

      {#if yaEnCocina}
        <p class="ojo" role="alert">
          Este platillo ya está en cocina. El cambio aparecerá marcado en el
          tablero hasta que alguien allá lo dé por visto.
        </p>
      {/if}

      <div class="rapidas">
        {#each INDICACIONES_RAPIDAS as texto (texto)}
          <button
            type="button"
            class="chip"
            class:puesta={textoIndicaciones.includes(texto)}
            onclick={() => agregarRapida(texto)}
          >
            {texto}
          </button>
        {/each}
      </div>

      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        bind:value={textoIndicaciones}
        rows="3"
        autofocus
        placeholder="Escribe lo que cocina necesita saber: alergias, término, cambios…"
      ></textarea>

      <div class="botones">
        <button class="secundario" onclick={() => (editandoIndicaciones = null)}>Cancelar</button>
        <button class="principal" onclick={guardarIndicaciones}>
          {yaEnCocina ? "Avisar a cocina" : "Guardar"}
        </button>
      </div>
    </div>
  </div>
{/if}


<!--
  Cómo estuvo todo. Aparece al cobrar, que es cuando hay alguien enfrente.

  Se puede saltar sin penalización: una encuesta obligatoria se contesta al
  azar con tal de seguir, y ese dato es peor que no tener ninguno.
-->
{#if opinandoOrden}
  <div class="velo-op" role="presentation" onclick={cerrarOpinion}></div>
  <div class="op" role="dialog" aria-modal="true" aria-label="Opinión del comensal">
    <h3>¿Cómo estuvo todo?</h3>

    <div class="caras">
      <button class="cara bien" class:on={calificacionElegida === "bien"} onclick={() => calificar("bien")}>
        Bien
      </button>
      <button class="cara regular" class:on={calificacionElegida === "regular"} onclick={() => calificar("regular")}>
        Regular
      </button>
      <button class="cara mal" class:on={calificacionElegida === "mal"} onclick={() => calificar("mal")}>
        Mal
      </button>
    </div>

    {#if calificacionElegida && calificacionElegida !== "bien"}
      <p class="que-paso">¿Qué falló?</p>
      <div class="motivos">
        {#each MOTIVOS_OPINION as m (m.valor)}
          <button
            class="motivo"
            class:on={motivosElegidos.includes(m.valor)}
            onclick={() => alternarMotivo(m.valor)}
          >
            {m.etiqueta}
          </button>
        {/each}
      </div>
      <input class="comentario" bind:value={comentarioOpinion} placeholder="Qué dijo, en sus palabras (opcional)" />
      <button class="guardar-op" onclick={guardarOpinion}>Guardar</button>
    {/if}

    <button class="saltar" onclick={cerrarOpinion}>No preguntar</button>
  </div>
{/if}


<!-- Reabrir una cuenta cobrada por error -->
{#if reabriendo}
  <div class="velo-op" role="presentation" onclick={() => (reabriendo = false)}></div>
  <div class="op" role="dialog" aria-modal="true" aria-label="Reabrir cuenta">
    <h3>Reabrir la cuenta cobrada</h3>
    <p class="pista-nombre">
      Los pagos ya registrados <b>no se borran</b>: siguen a la vista para
      devolverlos si corresponde. Queda en la bitácora con tu motivo y quién lo
      autorizó.
    </p>
    <input
      class="comentario"
      bind:value={motivoReapertura}
      placeholder="Se cobró de más, agregan un postre, mesa equivocada…"
    />
    <button class="guardar-op" onclick={confirmarReapertura}>Reabrir</button>
    <button class="saltar" onclick={() => (reabriendo = false)}>Cancelar</button>
  </div>
{/if}

<!-- A nombre de quién va el pedido -->
{#if poniendoNombre}
  <div class="velo-op" role="presentation" onclick={() => (poniendoNombre = false)}></div>
  <div class="op" role="dialog" aria-modal="true" aria-label="Nombre del pedido">
    <h3>¿A nombre de quién?</h3>
    <p class="pista-nombre">
      Para los pedidos que se llevan. Sale impreso en grande en la comanda de
      cocina, que es lo que permite entregar la bolsa correcta.
    </p>
    <input class="comentario" bind:value={nombrePedido} placeholder="Nombre de quien recoge" />
    <input class="comentario" bind:value={telefonoPedido} placeholder="Teléfono (opcional)" />
    <button class="guardar-op" onclick={guardarNombre}>Guardar</button>
    <button class="saltar" onclick={() => (poniendoNombre = false)}>Cancelar</button>
  </div>
{/if}

<style>
  .cuenta {
    position: relative;
    background: #fff;
    border-left: 1px solid var(--borde);
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    overflow-y: auto;
  }
  .ch {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.3rem;
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-pill);
    padding: 0.22rem 0.65rem;
    font-size: 0.76rem;
    font-weight: 600;
  }
  .chip.gray {
    background: #eef1ed;
    color: var(--gris);
  }
  .chip.cocina {
    background: var(--claro);
    color: var(--acento);
  }
  .sub {
    font-size: 0.82rem;
    color: var(--gris);
    margin-bottom: 0.85rem;
  }
  .items {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.92rem;
  }
  .cant {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex: none;
  }
  .cant button {
    width: 1.15rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--gris);
    line-height: 1;
  }
  .cant button:hover {
    color: var(--acento);
  }
  .cant b {
    font-family: var(--font-titulo);
    color: var(--acento);
    min-width: 1.1rem;
    text-align: center;
  }
  .item .n {
    flex: 1;
    min-width: 0;
  }
  .item .n small {
    display: block;
    color: var(--gris);
    font-size: 0.74rem;
    margin-top: 0.1rem;
  }
  .est-r {
    display: inline-block;
    margin-top: 0.2rem;
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--acento);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.08rem 0.4rem;
  }
  .item .p {
    font-weight: 600;
    white-space: nowrap;
  }
  .acciones {
    display: inline-flex;
    gap: 0.1rem;
    flex: none;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.22rem 0.5rem;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .acciones .mini {
    border: none;
    color: var(--gris);
    padding: 0.15rem 0.3rem;
  }
  .acciones .x:hover {
    color: var(--peligro);
  }
  .promo {
    margin-top: 0.7rem;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px dashed var(--acento);
    border-radius: 10px;
    background: color-mix(in srgb, var(--acento) 8%, transparent);
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  .promo:hover {
    background: color-mix(in srgb, var(--acento) 16%, transparent);
  }
  .promo .etiqueta {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--acento);
    font-weight: 700;
  }
  .promo .nombre {
    flex: 1;
    color: var(--pizarra);
  }
  .promo .importe {
    font-weight: 700;
    color: var(--acento);
  }
  .promo .cta {
    font-size: 0.72rem;
    color: var(--gris);
  }
  .tot {
    margin-top: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  .tot > div {
    display: flex;
    justify-content: space-between;
    color: var(--gris);
  }
  .tot .rebaja {
    color: var(--peligro);
  }
  .tot .propina {
    color: var(--acento);
  }
  .tot .saldo {
    font-weight: 700;
    color: var(--acento);
  }
  .tot .gt {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--pizarra);
    border-top: 2px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.2rem;
  }
  .extras {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .extras.oculto {
    display: none;
  }
  .sin-consumo {
    padding: 1.25rem 0;
    font-size: 0.86rem;
    color: var(--gris);
    font-style: italic;
    line-height: 1.5;
  }
  .grupo {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .btns {
    margin-top: auto;
    padding-top: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .b1 {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-lg);
    padding: 0.85rem;
    text-align: center;
    font-family: var(--font-titulo);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .b1:disabled {
    background: #eef1ed;
    color: #6b8f57;
    cursor: default;
  }
  .b2 {
    border: 2px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem;
    text-align: center;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .b2.cobrar {
    border-color: var(--acento);
    color: var(--acento);
  }
  .b2.cobrar:hover {
    background: var(--acento);
    color: #fff;
  }
  .panel-cobro {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.5rem;
  }
  .titulo-panel {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .formas,
  .mesas-destino {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .campo {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--gris);
  }
  .campo input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 1rem;
    font-family: var(--font-cuerpo);
  }
  .campo input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .cambio {
    font-size: 0.95rem;
    color: var(--acento);
  }
  .cambio b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .dividir {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
    color: var(--gris);
    border-top: 1px solid var(--borde);
    padding-top: 0.75rem;
  }
  .dividir b {
    font-family: var(--font-titulo);
    color: var(--pizarra);
  }
  .cada {
    color: var(--acento);
    font-weight: 600;
  }
  .volver {
    font-size: 0.82rem;
    color: var(--gris);
    text-decoration: underline;
    align-self: flex-start;
  }
  .vacia {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--gris);
    gap: 0.5rem;
  }
  .mesa-num {
    font-family: var(--font-titulo);
    font-size: 2rem;
    font-weight: 700;
    color: var(--borde);
  }
  .titulo-vacio {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .hint {
    font-size: 0.88rem;
    max-width: 16rem;
  }
  .toast {
    position: absolute;
    left: 1.25rem;
    right: 1.25rem;
    bottom: 1.25rem;
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    font-size: 0.88rem;
    text-align: center;
    box-shadow: var(--sombra-lg);
  }

  /* --- Indicaciones para cocina --- */

  .indicacion {
    display: block;
    color: var(--acento);
    font-weight: 600;
  }
  .acciones .mini.activa {
    color: var(--acento);
  }

  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 40;
  }
  .dialogo {
    background: #fff;
    border-radius: var(--r-md);
    padding: 1.25rem;
    width: min(30rem, 100%);
    box-shadow: var(--sombra-lg);
    max-height: 90vh;
    overflow-y: auto;
  }
  .dialogo h3 {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .que {
    color: var(--gris);
    font-size: 0.9rem;
    margin-top: 0.15rem;
  }
  .ojo {
    margin-top: 0.9rem;
    padding: 0.6rem 0.8rem;
    border-radius: var(--r-sm);
    background: var(--claro);
    border: 1px solid var(--acento);
    color: var(--pizarra);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .rapidas {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 1rem 0 0.75rem;
  }
  .chip {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 600;
    background: #fff;
    color: var(--pizarra);
    cursor: pointer;
  }
  .chip.puesta {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .dialogo textarea {
    width: 100%;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.6rem 0.7rem;
    font: inherit;
    font-size: 0.95rem;
    resize: vertical;
  }
  .dialogo textarea:focus {
    outline: none;
    border-color: var(--acento);
  }
  .dialogo .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .velo-op {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.5);
    z-index: 40;
  }
  .op {
    position: fixed;
    z-index: 41;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(26rem, calc(100vw - 2rem));
    background: #fff;
    border-radius: var(--r-xl);
    padding: 1.2rem;
    box-shadow: var(--sombra-lg);
    text-align: center;
  }
  .op h3 {
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 0.85rem;
  }
  .caras {
    display: flex;
    gap: 0.5rem;
  }
  .cara {
    flex: 1;
    padding: 0.85rem 0.3rem;
    border-radius: var(--r-md);
    border: 2px solid var(--borde);
    background: #fff;
    font-weight: 700;
    font-size: 0.92rem;
  }
  .cara.bien.on, .cara.bien:hover { border-color: #57ad30; color: #3f6b2c; }
  .cara.regular.on, .cara.regular:hover { border-color: var(--acento-2); color: var(--acento-2); }
  .cara.mal.on, .cara.mal:hover { border-color: var(--peligro); color: var(--peligro); }
  .que-paso {
    margin-top: 0.9rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gris);
  }
  .motivos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: center;
    margin-top: 0.5rem;
  }
  .motivo {
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1.5px solid var(--borde);
    background: #fff;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .motivo.on {
    border-color: var(--acento);
    background: #fffaf5;
    color: var(--acento);
  }
  .comentario {
    width: 100%;
    margin-top: 0.7rem;
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.85rem;
  }
  .guardar-op {
    width: 100%;
    margin-top: 0.7rem;
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.65rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .saltar {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .chip.nombre {
    background: var(--acento);
    color: #fff;
    border: none;
    font-weight: 700;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip.poner-nombre {
    background: transparent;
    border: 1.5px dashed var(--borde);
    color: var(--gris);
    font-weight: 600;
  }
  .chip.poner-nombre:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .pista-nombre {
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.45;
    margin-bottom: 0.6rem;
  }
  .reabrir {
    margin-top: 1.2rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .reabrir:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .acciones-cobrada {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }
</style>
