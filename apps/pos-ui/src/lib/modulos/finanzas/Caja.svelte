<script lang="ts">
  /**
   * Corte de caja (M1) — apertura del turno, movimientos de efectivo y arqueo
   * sellado.
   *
   * El arqueo compara el efectivo que DEBERÍA haber en el cajón (fondo + ventas
   * en efectivo ± retiros) contra lo que el cajero contó. La diferencia se sella
   * e imprime: un corte sin sello es una hoja que cualquiera puede rehacer.
   */
  import { pesos, sumar, turnoOlvidado, type MotivoMovimientoCaja } from "@motrest/dominio";
  import { caja } from "../../caja.svelte";
  import { impresion } from "../../impresion.svelte";
  import { mxn, hora } from "../../formato";
  import VerMas from "../../listas/VerMas.svelte";
  import { Paginado } from "../../listas/listas.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { sync } from "../../sync.svelte";

  /*
   * EL TURNO QUE NADIE CERRÓ.
   *
   * En Rodizio la caja no se cierra nunca: hay dos aperturas y CERO cierres en
   * la base del Hub. Y no es olvido —esa fue la primera hipótesis y era falsa—:
   * el `caja_cerrada` sale a nombre de `sistema`, que no está en el padrón, y
   * el Hub lo rechaza por permisos una y otra vez. El cajero cierra, la pantalla
   * dice que cerró, y el corte nunca llega a existir.
   *
   * Este aviso NO arregla ese defecto, que sigue abierto y es de otro sitio. Lo
   * que hace es que deje de ser invisible: mientras el turno siga abierto, las
   * cifras de abajo son la suma de varias jornadas revueltas y el esperado no se
   * puede cuadrar contra ningún cajón de una sola noche. Hasta ahora nada en la
   * pantalla lo decía.
   *
   * `ahora` avanza solo para que el aviso aparezca sin recargar la pantalla.
   * Cada diez minutos basta: lo que se vigila son horas.
   */
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 600_000);
    return () => clearInterval(t);
  });

  const olvidado = $derived(turnoOlvidado(caja.sesiones, ahora));

  /**
   * Lo que el Hub rechazó en esta sesión.
   *
   * Aparece aquí porque el rechazo que importaba era justo el del corte, y
   * porque esta es la pantalla donde alguien va a notar que algo no cuadra.
   * Antes no se enseñaba en ninguna parte: la terminal daba el turno por
   * cerrado, el Hub no lo tenía, y las dos cosas convivían meses.
   */
  const rechazados = $derived(sync.rechazados);

  const puedeAbrir = $derived(sesion.puedeOperar("caja.sesion.abrir"));
  const puedeMover = $derived(sesion.puedeOperar("caja.retiro.registrar"));
  const puedeSellar = $derived(sesion.puedeOperar("caja.corte.sellar"));
  const puedeVerArqueos = $derived(sesion.puedeVer("caja.arqueo.ver"));

  const activa = $derived(caja.activa);
  const corte = $derived(caja.corteEnVivo);
  const cerradas = $derived(caja.sesiones.filter((s) => s.cerrada));

  /*
   * «VER MÁS» EN LOS CORTES ANTERIORES (1.5.6, pedido de Gonzalo). Uno o dos
   * cortes por día, todos pintados: al cabo de un año, trescientos renglones
   * entre el corte en vivo y lo que Finanzas tiene debajo. Se ven los 10 más
   * recientes. Solo cuentan los que tienen resumen, que son los que la tabla
   * pinta: contar los demás haría que «Ver más» prometiera renglones que no
   * aparecen.
   */
  const cortesAnteriores = $derived(cerradas.filter((s) => s.resumen));
  const pagCortes = new Paginado();

  let error = $state("");

  // --- Abrir turno ---
  let fondoTexto = $state("");

  function abrir() {
    error = "";
    const usuario = sesion.usuarioActual;
    if (!usuario) { error = "Inicia sesión para abrir la caja"; return; }
    const r = caja.abrir(usuario.id, pesos(Number(fondoTexto) || 0));
    if (!r.ok) { error = r.error ?? ""; return; }
    fondoTexto = "";
  }

  // --- Movimiento de efectivo ---
  let movAbierto = $state(false);
  let movMotivo = $state<MotivoMovimientoCaja>("retiro");
  let movMonto = $state("");
  let movConcepto = $state("");

  function registrarMovimiento() {
    error = "";
    const r = caja.movimiento(
      movMotivo,
      pesos(Number(movMonto) || 0),
      movConcepto,
      sesion.usuarioActual?.id,
    );
    if (!r.ok) { error = r.error ?? ""; return; }
    movMonto = "";
    movConcepto = "";
    movAbierto = false;
  }

  // --- Cierre / arqueo ---
  let cerrando = $state(false);
  let declaradoTexto = $state("");

  /** Propina que NO llegó en efectivo: el local se la debe al mesero. */
  const propinaEnPlastico = $derived(
    sumar(
      ...Object.entries(corte?.propinasPorForma ?? {})
        .filter(([forma]) => forma !== "efectivo")
        .map(([, monto]) => monto ?? pesos(0)),
    ),
  );

  const declarado = $derived(pesos(Number(declaradoTexto) || 0));
  const diferenciaPrevia = $derived(
    corte ? (declarado - corte.efectivoEsperado) : 0,
  );

  async function cerrar() {
    error = "";
    const nombre = sesion.usuarioActual?.nombre ?? "Cajero";
    const r = await caja.cerrar(declarado, nombre, sesion.usuarioActual?.id);
    if (!r.ok) { error = r.error ?? ""; return; }
    cerrando = false;
    declaradoTexto = "";
  }

  function etiquetaDif(dif: number): string {
    return dif === 0 ? "Cuadra" : dif > 0 ? "Sobrante" : "Faltante";
  }
</script>

<section class="tarjeta">
  <div class="cabecera-tarjeta">
    <h2>Corte de caja</h2>
    {#if activa}
      <span class="turno">Turno abierto · {hora(activa.abierta_ts)}</span>
    {/if}
  </div>

  <!--
    EL HUB RECHAZÓ ALGO. Va antes que cualquier cifra, y en rojo: significa
    que esta terminal y el Hub NO dicen lo mismo, y todo lo que se lea abajo
    puede ser cierto aquí y no existir en la caja del local.
  -->
  {#each rechazados as r (r.evento_id)}
    <div class="rechazado" role="alert">
      <b>El Hub no aceptó un movimiento de caja.</b>
      <p>{r.motivo}</p>
      <p class="que-hacer">
        Quedó guardado en esta terminal pero NO en el Hub del local, así que
        no lo ven las demás cajas ni sale en los reportes. Vuelve a hacerlo con
        la sesión iniciada; si se repite, avisa a MOTRAE con este texto.
      </p>
    </div>
  {/each}

  {#if !activa}
    <p class="nota">
      No hay ningún turno abierto. Abre la caja con el efectivo del fondo para
      empezar a cobrar y poder cerrar el corte al final.
    </p>
    {#if puedeAbrir}
      <div class="fila">
        <label>
          <span>Fondo inicial</span>
          <input bind:value={fondoTexto} inputmode="decimal" placeholder="0.00" />
        </label>
        <button class="principal" onclick={abrir}>Abrir caja</button>
      </div>
    {:else}
      <p class="nota">Tu perfil no puede abrir la caja.</p>
    {/if}
  {:else if corte}
    <!--
      EL AVISO DEL TURNO OLVIDADO. Va arriba del todo y no en una esquina: si el
      turno lleva días abierto, ninguna de las cifras de abajo significa lo que
      parece — son la suma de varias jornadas revueltas.
    -->
    {#if olvidado}
      <div class="olvidado" role="alert">
        <b>Este turno lleva {olvidado.horas} horas abierto.</b>
        <p>
          Se abrió el {new Date(olvidado.sesion.abierta_ts).toLocaleDateString("es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })} a las {hora(olvidado.sesion.abierta_ts)} y nadie lo ha cerrado. Todo lo
          cobrado desde entonces está sumado aquí, así que estas cifras son de
          varios días juntos y el efectivo esperado ya no se puede cuadrar contra
          <b>ningún</b> cajón de una sola noche.
        </p>
        <p>
          Ciérrelo con lo que haya ahora en la caja y abra uno nuevo: a partir de
          ahí los cortes vuelven a cuadrar día por día.
        </p>
      </div>
    {/if}

    <!-- Corte en vivo del turno abierto -->
    <!--
      Se muestra lo COBRADO por forma —lo que de verdad entró por cada canal— y
      abajo, desglosado, cuánto de eso fue venta y cuánto propina. Quien cierra
      la caja puede sumar los renglones con el dedo y ver que cuadran; un
      "total vendido" que no coincide con la suma de arriba destruye la
      confianza en los tres números a la vez.
    -->
    <div class="cifras">
      <div><span>Fondo inicial</span><b>{mxn(corte.fondoInicial)}</b></div>
      {#each Object.entries(corte.cobrado) as [forma, monto] (forma)}
        <div><span>Cobrado · {forma}</span><b>{mxn(monto ?? pesos(0))}</b></div>
      {/each}
      {#if corte.movimientos !== 0}
        <div>
          <span>Entradas y retiros</span>
          <b class:resta={corte.movimientos < 0}>{mxn(corte.movimientos)}</b>
        </div>
      {/if}
      <!--
        Las devoluciones se enseñan con su propio renglón y no escondidas dentro
        del «cobrado». Quien cuenta el cajón va a encontrar menos dinero del que
        dicen las ventas del día, y esta línea es la que se lo explica antes de
        que empiece a buscar un faltante que no existe.
      -->
      {#if corte.devoluciones > 0}
        <div>
          <span>
            Devuelto por {corte.ventasCanceladas}
            {corte.ventasCanceladas === 1 ? "venta cancelada" : "ventas canceladas"}
          </span>
          <b class="resta">−{mxn(corte.devoluciones)}</b>
        </div>
      {/if}
      <!--
        LOS GASTOS PAGADOS DEL CAJÓN.

        Es el renglón que faltaba. Antes un gasto registrado en Finanzas no
        tocaba el corte, así que pagar el gas con el dinero de la caja aparecía
        como un faltante al cerrar: el cajero contaba bien y el sistema le decía
        que le faltaban ochocientos pesos. Se enseña desglosado porque quien
        cuadra la caja necesita poder señalar de dónde salió cada peso que no
        está en el cajón.
      -->
      {#if corte.gastosEfectivo > 0}
        <div>
          <span>
            Gastos pagados en efectivo ({corte.gastos.length})
          </span>
          <b class="resta">−{mxn(corte.gastosEfectivo)}</b>
        </div>
      {/if}
      <div class="destacado">
        <span>Efectivo esperado en el cajón</span>
        <b>{mxn(corte.efectivoEsperado)}</b>
      </div>
    </div>

    {#if corte.gastos.length > 0}
      <ul class="gastos-turno">
        {#each corte.gastos as g (g.ts)}
          <li>
            <span>{hora(g.ts)} · {g.concepto}</span>
            <b>−{mxn(g.monto)}</b>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="cifras desglose">
      <div><span>De eso, venta del restaurante</span><b>{mxn(corte.totalVendido)}</b></div>
      {#if corte.propinas > 0}
        <div><span>De eso, propina del personal</span><b>{mxn(corte.propinas)}</b></div>
        {#if propinaEnPlastico > 0}
          <!--
            La propina que llegó con tarjeta no está en el cajón como propina:
            entró revuelta con la venta y el restaurante se la debe al mesero en
            efectivo. Es de las diferencias que más se discuten al cerrar.
          -->
          <div class="aviso">
            <span>Propina cobrada con tarjeta o transferencia</span>
            <b>{mxn(propinaEnPlastico)}</b>
          </div>
        {/if}
      {/if}
    </div>

    <p class="nota">
      {corte.cuentasCerradas} cuentas cerradas. Solo el <b>efectivo</b> llega al
      cajón: las tarjetas y transferencias no se cuentan en el arqueo.
      {#if propinaEnPlastico > 0}
        Los {mxn(propinaEnPlastico)} de propina con tarjeta salen del efectivo al
        pagarle al personal.
      {/if}
    </p>

    <div class="acciones">
      {#if puedeMover}
        <button class="secundario" onclick={() => (movAbierto = !movAbierto)}>
          {movAbierto ? "Cancelar movimiento" : "Retiro o ingreso"}
        </button>
      {/if}
      {#if puedeSellar}
        <button class="principal" onclick={() => (cerrando = !cerrando)}>
          {cerrando ? "Cancelar cierre" : "Cerrar turno y sellar corte"}
        </button>
      {/if}
    </div>

    {#if movAbierto && puedeMover}
      <div class="panel">
        <!--
          EL AVISO DE LA DOBLE RESTA.

          Ahora que el gasto SÍ baja el efectivo esperado, registrar además un
          retiro por el mismo pago lo descuenta dos veces y el corte marca un
          faltante que no existe. Antes el retiro a mano era la única forma de
          que el cajón cuadrara; hoy es justo lo que lo descuadra, y quien lleva
          años haciéndolo así no tiene por qué adivinarlo.
        -->
        <p class="nota aviso-doble">
          <b>¿Es un gasto?</b> No lo registres aquí: captúralo en
          <b>Registrar un gasto</b> y el cajón lo descuenta solo. Hacer las dos
          cosas resta el dinero dos veces. Este panel es para lo que NO es un
          gasto: llevar dinero a la caja fuerte o traer cambio del banco.
        </p>
        <div class="fila">
          <label>
            <span>Tipo</span>
            <select bind:value={movMotivo}>
              <option value="retiro">Retiro (sale del cajón)</option>
              <option value="ingreso">Ingreso (entra al cajón)</option>
            </select>
          </label>
          <label>
            <span>Monto</span>
            <input bind:value={movMonto} inputmode="decimal" placeholder="0.00" />
          </label>
          <label class="ancho">
            <span>Concepto</span>
            <input bind:value={movConcepto} placeholder="A la caja fuerte, cambio del banco…" />
          </label>
        </div>
        <div class="botones">
          <button class="principal" onclick={registrarMovimiento}>Registrar movimiento</button>
        </div>
      </div>
    {/if}

    {#if cerrando && puedeSellar}
      <div class="panel">
        <h3>Arqueo</h3>
        <p class="nota">
          Cuenta el efectivo del cajón y captúralo. El corte se sella con esta
          cifra: una vez cerrado, no se reabre.
        </p>
        <div class="fila">
          <label>
            <span>Efectivo contado</span>
            <input bind:value={declaradoTexto} inputmode="decimal" placeholder="0.00" />
          </label>
          <div class="dif {etiquetaDif(diferenciaPrevia).toLowerCase()}">
            <span>{etiquetaDif(diferenciaPrevia)}</span>
            <b>{mxn(Math.abs(diferenciaPrevia) as typeof declarado)}</b>
          </div>
        </div>
        <div class="botones">
          <button class="principal" onclick={cerrar}>Sellar e imprimir corte</button>
        </div>
      </div>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

{#if puedeVerArqueos && cerradas.length > 0}
  <section class="tarjeta">
    <h2>Cortes anteriores</h2>
    <table>
      <thead>
        <tr>
          <th>Cierre</th><th>Cajero</th><th class="num">Vendido</th>
          <th class="num">Esperado</th><th class="num">Diferencia</th><th>Sello</th>
        </tr>
      </thead>
      <tbody>
        {#each pagCortes.de(cortesAnteriores) as s (s.sesion_id)}
          {#if s.resumen}
            <tr>
              <td>{s.cerrada_ts ? hora(s.cerrada_ts) : "—"}</td>
              <td>{s.cajero_id}</td>
              <td class="num">{mxn(s.resumen.total_vendido)}</td>
              <td class="num">{mxn(s.resumen.efectivo_esperado)}</td>
              <td class="num" class:alerta={s.resumen.diferencia !== 0}>
                {mxn(s.resumen.diferencia)}
              </td>
              <td class="sello">{s.sello}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
    <VerMas pag={pagCortes} lista={cortesAnteriores} />
  </section>
{/if}

<!-- Vista previa del corte impreso (hace de papel si no hay impresora) -->
{#if impresion.vistaPrevia}
  <div class="velo" role="presentation" onclick={() => impresion.cerrarVista()}></div>
  <div class="previa" role="dialog" aria-label="Vista previa del corte">
    <header>
      <b>{impresion.vistaPrevia.titulo}</b>
      <button class="cerrar" onclick={() => impresion.cerrarVista()} aria-label="Cerrar">✕</button>
    </header>
    <pre>{impresion.vistaPrevia.texto}</pre>
  </div>
{/if}

<style>
  /* El Hub rechazó un evento: la terminal y el Hub no dicen lo mismo. */
  .rechazado {
    background: #fdf2f0;
    border: 1.5px solid #e0392b;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    margin-bottom: 0.9rem;
    font-size: 0.86rem;
    line-height: 1.55;
  }
  .rechazado b {
    color: #8a2018;
  }
  .rechazado p {
    margin-top: 0.3rem;
    color: var(--pizarra);
  }
  .rechazado .que-hacer {
    font-size: 0.8rem;
    color: var(--gris);
  }
  .aviso-doble {
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.7rem;
    line-height: 1.5;
  }
  .aviso-doble b {
    color: var(--acento-texto);
  }
  /* El turno que se quedó abierto de un día anterior. */
  .olvidado {
    background: #fdf2f0;
    border: 1.5px solid #e0392b;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    margin-bottom: 0.9rem;
    font-size: 0.86rem;
    line-height: 1.55;
  }
  .olvidado b {
    color: #8a2018;
  }
  .olvidado p {
    margin-top: 0.35rem;
    color: var(--pizarra);
  }
  /* Los gastos que salieron del cajón, uno por uno. */
  .gastos-turno {
    list-style: none;
    margin: 0.35rem 0 0.6rem;
    padding: 0.5rem 0.7rem;
    background: #faf9f8;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .gastos-turno li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .gastos-turno b {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
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
  h3 {
    font-size: 0.95rem;
    font-weight: 650;
    margin-bottom: 0.3rem;
  }
  .turno {
    font-size: 0.8rem;
    font-weight: 600;
    color: #3f6b2c;
    background: #eef7e8;
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
  }
  .cifras {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cifras div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  .cifras span {
    font-size: 0.88rem;
    color: var(--gris);
  }
  .cifras b {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }
  .resta {
    color: var(--peligro);
  }
  /* El desglose de lo cobrado: qué fue venta y qué fue propina. */
  .desglose {
    margin-top: 0.75rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-sm);
    background: var(--fondo);
  }
  .desglose .aviso span,
  .desglose .aviso b {
    color: var(--acento-texto);
  }
  .destacado {
    border-top: 1.5px solid var(--borde);
    padding-top: 0.6rem;
    margin-top: 0.3rem;
  }
  .destacado b {
    font-size: 1.3rem;
    font-family: var(--font-titulo);
    color: var(--acento-texto);
  }
  .nota {
    margin-top: 0.8rem;
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .fila {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
    margin-top: 0.9rem;
  }
  .fila label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .fila label.ancho {
    flex-basis: 100%;
  }
  label span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
    background: #fff;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .acciones {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .panel {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--borde);
  }
  .dif {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    min-width: 8rem;
    padding: 0.3rem 0.8rem;
    border-radius: 8px;
    background: var(--fondo);
  }
  .dif span {
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .dif b {
    font-variant-numeric: tabular-nums;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .dif.cuadra {
    background: #eef7e8;
  }
  .dif.cuadra b {
    color: #3f6b2c;
  }
  .dif.faltante b,
  .dif.sobrante b {
    color: var(--peligro);
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1.5px solid var(--borde);
    background: #fff;
    color: inherit;
    padding: 0.6rem 1.1rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .secundario {
    color: var(--pizarra);
  }
  .error {
    margin-top: 0.8rem;
    color: var(--peligro);
    font-size: 0.86rem;
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num {
    text-align: right;
  }
  td {
    padding: 0.5rem 0.5rem 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .alerta {
    color: var(--peligro);
    font-weight: 700;
  }
  .sello {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    letter-spacing: 0.02em;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .previa {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-lg, 12px);
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
    box-shadow: var(--sombra-lg, 0 20px 60px rgba(0, 0, 0, 0.3));
    overflow: hidden;
  }
  .previa header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.1rem;
    border-bottom: 1px solid var(--borde);
  }
  .cerrar {
    border: none;
    font-size: 1.1rem;
    color: var(--gris);
    padding: 0.2rem 0.5rem;
  }
  .previa pre {
    margin: 0;
    padding: 1rem 1.2rem;
    overflow: auto;
    font-size: 0.78rem;
    line-height: 1.45;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    white-space: pre;
    color: var(--pizarra);
  }
</style>
