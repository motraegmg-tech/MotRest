<script lang="ts">
  /**
   * M5 · Caja y dinero — cuánto tiene el restaurante y por qué.
   *
   * ## La pregunta que responde
   *
   * «¿Cuánto dinero debe haber?» Hasta ahora no había pantalla que la
   * contestara. El corte de caja respondía otra distinta —si el cajón del turno
   * cuadra— y los gastos se registraban en una tercera sin tocar ninguna de las
   * dos. Se podía gastar veinte mil pesos y el sistema seguía enseñando el mismo
   * dinero.
   *
   * ## Por qué son dos saldos y no uno
   *
   * Decisión de Gonzalo. El efectivo se cuenta con la mano y se compara contra
   * el cajón; el banco se coteja contra el estado de cuenta. Son dos cifras que
   * se verifican de formas distintas, y un solo número que las sumara no se
   * podría arquear nunca: nadie cuenta los billetes de una transferencia.
   *
   * ## Las tres cosas que se pueden hacer aquí
   *
   * 1. **Contar y comparar** lo que hay contra lo que debería haber.
   * 2. **Depositar** en el banco o traer cambio de allá.
   * 3. **Ajustar** el saldo, siempre con una justificación escrita.
   *
   * Y una que NO se puede: teclear el saldo. El saldo no es un campo, es la
   * suma del histórico. Corregirlo se hace agregando un renglón que explique la
   * corrección, nunca pisando la cifra — un saldo editable a secas es un saldo
   * que deja de significar nada el día que alguien lo cuadra a mano.
   */
  import {
    CLASES_AJUSTE,
    CUENTAS_TESORERIA,
    DENOMINACIONES,
    cambioDisponible,
    pesos,
    totalDelConteo,
    type ClaseAjuste,
    type ConteoDenominaciones,
    type CuentaTesoreria,
  } from "@motrest/dominio";
  import Icono from "../../Icono.svelte";
  import { hora, mxn } from "../../formato";
  import { local } from "../../local.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { tesoreria } from "../../tesoreria.svelte";

  /*
   * Quién puede QUÉ.
   *
   * Ver el dinero lo puede quien ve el corte. Moverlo —depositar, ajustar— pide
   * el permiso de sellar el corte, que es el de quien responde por la caja. No
   * se inventa un permiso nuevo: la matriz ya distingue mirar de decidir, y
   * agregar filas a esa matriz obliga a revisar todos los perfiles de todos los
   * locales que están operando.
   */
  const puedeVer = $derived(sesion.puedeVer("fin.corte.ver"));
  const puedeMover = $derived(sesion.puedeOperar("caja.corte.sellar"));

  const saldos = $derived(tesoreria.saldos);

  // --- El período que se está mirando ------------------------------------------------

  type Ventana = "hoy" | "semana" | "mes" | "todo";
  let ventana = $state<Ventana>("mes");

  const rango = $derived.by(() => {
    const ahora = Date.now();
    if (ventana === "hoy") return local.jornadaActual;
    if (ventana === "todo") return { desde: 0, hasta: ahora + 1 };

    const d = new Date();
    if (ventana === "mes") {
      return { desde: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), hasta: ahora + 1 };
    }
    return { desde: ahora - 7 * 86_400_000, hasta: ahora + 1 };
  });

  const resumen = $derived(tesoreria.resumen(rango));

  /** El histórico se lee del más reciente hacia atrás, que es como se consulta. */
  const historico = $derived([...tesoreria.historico(rango)].reverse());

  const ETIQUETA_ORIGEN: Record<string, string> = {
    venta: "Venta",
    devolucion: "Devolución",
    gasto: "Gasto",
    movimiento_caja: "Caja",
    traspaso: "Traspaso",
    ajuste: "Ajuste",
  };

  function fecha(ts: number): string {
    return new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  // --- Contar el efectivo ------------------------------------------------------------

  let contando = $state(false);
  let conteo = $state<ConteoDenominaciones>({});

  const contado = $derived(totalDelConteo(conteo));
  const cambio = $derived(cambioDisponible(conteo));
  const arqueo = $derived(tesoreria.comparar(contado, "efectivo"));

  function abrirConteo() {
    conteo = {};
    contando = true;
    errorArqueo = "";
  }

  /** El conteo se guarda como número de piezas, nunca como importe tecleado. */
  function piezas(etiqueta: string, valor: string) {
    const n = Math.max(0, Math.floor(Number(valor) || 0));
    conteo = { ...conteo, [etiqueta]: n };
  }

  let justificaArqueo = $state("");
  let errorArqueo = $state("");

  function aceptarDiferencia() {
    errorArqueo = "";
    const r = tesoreria.aceptarDiferencia(
      "efectivo",
      contado,
      justificaArqueo,
      sesion.usuarioActual?.id,
    );
    if (!r.ok) {
      errorArqueo = r.error ?? "";
      return;
    }
    contando = false;
    justificaArqueo = "";
    conteo = {};
  }

  // --- Depósito y retiro del banco -----------------------------------------------------

  let traspasando = $state<CuentaTesoreria | null>(null);
  let montoTraspaso = $state("");
  let refTraspaso = $state("");
  let errorTraspaso = $state("");

  function abrirTraspaso(desde: CuentaTesoreria) {
    traspasando = desde;
    montoTraspaso = "";
    refTraspaso = "";
    errorTraspaso = "";
  }

  function confirmarTraspaso() {
    if (!traspasando) return;
    errorTraspaso = "";
    const r = tesoreria.traspasar(traspasando, pesos(Number(montoTraspaso) || 0), {
      referencia: refTraspaso,
      empleadoId: sesion.usuarioActual?.id,
    });
    if (!r.ok) {
      errorTraspaso = r.error ?? "";
      return;
    }
    traspasando = null;
  }

  // --- Ajuste justificado ----------------------------------------------------------------

  let ajustando = $state(false);
  let ajusteCuenta = $state<CuentaTesoreria>("efectivo");
  let ajusteClase = $state<ClaseAjuste>("otro_ingreso");
  let ajusteMonto = $state("");
  let ajusteJustifica = $state("");
  let errorAjuste = $state("");

  /**
   * El signo lo decide la CLASE, no quien teclea.
   *
   * Pedir «escribe -1500» es pedir el error: el día que alguien olvide el menos,
   * una salida de mil quinientos pesos entra como ingreso y el saldo se va tres
   * mil arriba. El importe se captura siempre en positivo.
   */
  const ajusteEsSalida = $derived(ajusteClase === "otro_egreso");

  const claseElegida = $derived(CLASES_AJUSTE.find((c) => c.id === ajusteClase));

  function abrirAjuste() {
    ajustando = true;
    ajusteClase = tesoreria.tieneSaldoInicial ? "otro_ingreso" : "saldo_inicial";
    ajusteMonto = "";
    ajusteJustifica = "";
    errorAjuste = "";
  }

  function confirmarAjuste() {
    errorAjuste = "";
    const magnitud = pesos(Math.abs(Number(ajusteMonto) || 0));
    /*
     * La corrección de captura es la única que admite las dos direcciones: se
     * pudo haber registrado de más o de menos. Se resuelve con el signo que
     * traiga el número tecleado.
     */
    const delta =
      ajusteClase === "correccion"
        ? pesos(Number(ajusteMonto) || 0)
        : ((ajusteEsSalida ? -magnitud : magnitud) as typeof magnitud);

    const r = tesoreria.ajustar(
      ajusteCuenta,
      ajusteClase,
      delta,
      ajusteJustifica,
      sesion.usuarioActual?.id,
    );
    if (!r.ok) {
      errorAjuste = r.error ?? "";
      return;
    }
    ajustando = false;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Caja y dinero</h1>
      <p class="sub">
        Cuánto dinero debe haber en el restaurante, dónde está y de dónde salió
        cada peso. Todo lo que se cobra lo sube; todo lo que se gasta lo baja.
      </p>
    </div>
  </div>

  {#if !puedeVer}
    <section class="tarjeta">
      <p class="faltante">Tu perfil no puede consultar el dinero del local.</p>
    </section>
  {:else}
    <!--
      LOS DOS SALDOS, ARRIBA DEL TODO. Es la cifra por la que se entra aquí, y
      va antes que cualquier explicación: quien abre esta pantalla ya sabe qué
      viene a ver.
    -->
    <section class="saldos">
      {#each CUENTAS_TESORERIA as cuenta (cuenta.id)}
        {@const monto = cuenta.id === "efectivo" ? saldos.efectivo : saldos.banco}
        <div class="saldo" class:negativo={monto < 0}>
          <div class="rotulo">
            <Icono nombre={cuenta.id === "efectivo" ? "efectivo" : "transferencia"} tam={18} />
            <span>{cuenta.nombre}</span>
          </div>
          <b>{mxn(monto)}</b>
          <p>{cuenta.explica}</p>
          {#if puedeMover}
            <div class="acciones">
              {#if cuenta.id === "efectivo"}
                <button class="mini" onclick={abrirConteo}>Contar el efectivo</button>
                <button class="mini" onclick={() => abrirTraspaso("efectivo")}>
                  Depositar en el banco
                </button>
              {:else}
                <button class="mini" onclick={() => abrirTraspaso("banco")}>
                  Retirar del banco
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <div class="saldo total">
        <div class="rotulo"><span>Total</span></div>
        <b>{mxn(saldos.total)}</b>
        <p>
          Todo el dinero del restaurante. Se muestra, pero lo que se arquea es
          cada cuenta por separado.
        </p>
        {#if puedeMover}
          <div class="acciones">
            <button class="mini" onclick={abrirAjuste}>Ajustar con justificación</button>
          </div>
        {/if}
      </div>
    </section>

    <!--
      El aviso de arranque. Un restaurante que estrena MotRest ya tenía dinero, y
      hasta que lo declare el saldo dirá solo lo que ha pasado desde la
      instalación — que es cierto, pero no es lo que hay en la caja fuerte.
    -->
    {#if !tesoreria.tieneSaldoInicial && puedeMover}
      <div class="aviso">
        <b>Falta decir con cuánto empezaron</b>
        <p>
          El saldo de arriba cuenta solo lo que ha pasado desde que se instaló
          MotRest. Si el restaurante ya tenía dinero en el cajón o en el banco,
          declárelo una vez con «Ajustar con justificación» → «Saldo con el que
          empezamos», y a partir de ahí la cifra será la real.
        </p>
      </div>
    {/if}

    <!-- Movimiento del período -->
    <section class="tarjeta">
      <div class="cabecera-tarjeta">
        <h2>Movimiento del dinero</h2>
        <div class="ventanas">
          {#each [["hoy", "Hoy"], ["semana", "7 días"], ["mes", "Este mes"], ["todo", "Todo"]] as [clave, texto] (clave)}
            <button
              class="pestana"
              class:on={ventana === clave}
              onclick={() => (ventana = clave as Ventana)}
            >{texto}</button>
          {/each}
        </div>
      </div>

      <div class="cifras">
        <div><span>Se empezó con</span><b>{mxn(resumen.inicial.total)}</b></div>
        <div class="entra"><span>Entró</span><b>{mxn(resumen.entradas)}</b></div>
        <div class="sale"><span>Salió</span><b>{mxn(resumen.salidas)}</b></div>
        <div class="fuerte"><span>Queda</span><b>{mxn(resumen.final.total)}</b></div>
      </div>

      {#if historico.length === 0}
        <p class="faltante">No hubo movimientos de dinero en este período.</p>
      {:else}
        <div class="marco-tabla">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Origen</th>
                <th>Cuenta</th>
                <th class="num">Importe</th>
                <th class="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {#each historico as m (m.id)}
                <tr class:ajuste={m.origen === "ajuste"}>
                  <td class="tenue">{fecha(m.ts)} · {hora(m.ts)}</td>
                  <td>
                    {m.concepto}
                    <!--
                      La justificación va COMPLETA y debajo, no recortada en la
                      celda: es el dato por el que existe el ajuste. Esconderla
                      dejaría un movimiento de dinero sin explicación a la vista,
                      que es justo lo que esta pantalla viene a evitar.
                    -->
                    {#if m.justificacion}
                      <small class="porque">{m.justificacion}</small>
                    {/if}
                  </td>
                  <td class="tenue">{ETIQUETA_ORIGEN[m.origen] ?? m.origen}</td>
                  <td class="tenue">{m.cuenta === "efectivo" ? "Efectivo" : "Banco"}</td>
                  <td class="num" class:sale={m.monto < 0}>{mxn(m.monto)}</td>
                  <td class="num tenue">{mxn(m.saldo)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>

<!-- Contar el efectivo, billete por billete -->
{#if contando}
  <div class="velo" role="presentation" onclick={() => (contando = false)}></div>
  <div class="dialogo ancho" role="dialog" aria-modal="true" aria-label="Contar el efectivo">
    <h2>Contar el efectivo</h2>
    <p class="explica">
      Cuente los billetes y monedas y escriba CUÁNTAS PIEZAS hay de cada uno. La
      suma la hace el sistema: teclear un total de memoria es donde se cuelan los
      errores de arqueo.
    </p>

    <div class="denominaciones">
      {#each DENOMINACIONES as d (d.etiqueta)}
        <label>
          <span>{d.etiqueta}</span>
          <input
            inputmode="numeric"
            value={conteo[d.etiqueta] ?? ""}
            placeholder="0"
            oninput={(e) => piezas(d.etiqueta, e.currentTarget.value)}
          />
        </label>
      {/each}
    </div>

    <div class="resultado-arqueo">
      <div><span>Contado</span><b>{mxn(contado)}</b></div>
      <div><span>Debería haber</span><b>{mxn(arqueo.esperado)}</b></div>
      <div class:mal={!arqueo.cuadra}>
        <span>{arqueo.cuadra ? "Cuadra" : arqueo.diferencia > 0 ? "Sobrante" : "Faltante"}</span>
        <b>{mxn(arqueo.diferencia)}</b>
      </div>
    </div>

    <!--
      El aviso del cambio. Un cajón con doce mil pesos en billetes de mil no
      puede cobrar la primera mesa del día, y eso no se descubre hasta que pasa.
    -->
    {#if contado > 0 && cambio < 50_000}
      <p class="aviso-cambio">
        Solo hay {mxn(cambio)} en billetes chicos y monedas. Conviene conseguir
        cambio antes de abrir.
      </p>
    {/if}

    {#if !arqueo.cuadra && contado > 0}
      <label class="ancho">
        <span>¿Por qué hay diferencia?</span>
        <input
          bind:value={justificaArqueo}
          placeholder="Se pagó el gas de contado y no se capturó"
        />
        <small class="pista">
          Aceptar la diferencia deja el saldo en lo que de verdad hay, y guarda
          esta explicación en el histórico con su nombre.
        </small>
      </label>
    {/if}

    {#if errorArqueo}<p class="error" role="alert">{errorArqueo}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (contando = false)}>Cerrar</button>
      {#if !arqueo.cuadra && contado > 0}
        <button class="principal" onclick={aceptarDiferencia}>Aceptar la diferencia</button>
      {/if}
    </div>
  </div>
{/if}

<!-- Depósito o retiro del banco -->
{#if traspasando}
  <div class="velo" role="presentation" onclick={() => (traspasando = null)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Mover dinero">
    <h2>{traspasando === "efectivo" ? "Depositar en el banco" : "Retirar del banco"}</h2>
    <p class="explica">
      El dinero no se gasta ni aparece: cambia de sitio. Baja de
      {traspasando === "efectivo" ? " el efectivo y sube al banco" : " el banco y sube al efectivo"},
      y el total del restaurante queda igual.
    </p>

    <label>
      <span>Importe</span>
      <input bind:value={montoTraspaso} inputmode="decimal" placeholder="0.00" />
    </label>
    <label>
      <span>Folio de la ficha o referencia</span>
      <input bind:value={refTraspaso} placeholder="Ficha 4471" />
    </label>

    {#if errorTraspaso}<p class="error" role="alert">{errorTraspaso}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (traspasando = null)}>Cancelar</button>
      <button class="principal" onclick={confirmarTraspaso}>Registrar</button>
    </div>
  </div>
{/if}

<!-- Ajuste justificado -->
{#if ajustando}
  <div class="velo" role="presentation" onclick={() => (ajustando = false)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Ajustar el saldo">
    <h2>Ajustar el saldo</h2>
    <p class="explica">
      El saldo no se teclea: se agrega un renglón que lo mueve y explica por qué.
      Queda en el histórico con su importe, su motivo y su nombre.
    </p>

    <label>
      <span>¿Qué cuenta?</span>
      <select bind:value={ajusteCuenta}>
        {#each CUENTAS_TESORERIA as c (c.id)}
          <option value={c.id}>{c.nombre}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>¿De qué se trata?</span>
      <select bind:value={ajusteClase}>
        {#each CLASES_AJUSTE as c (c.id)}
          <option value={c.id}>{c.nombre}</option>
        {/each}
      </select>
      {#if claseElegida}<small class="pista">{claseElegida.explica}</small>{/if}
    </label>

    <label>
      <span>
        Importe
        {#if ajusteClase === "correccion"}
          (con signo: negativo para bajar el saldo)
        {:else if ajusteEsSalida}
          — baja el saldo
        {:else}
          — sube el saldo
        {/if}
      </span>
      <input bind:value={ajusteMonto} inputmode="decimal" placeholder="0.00" />
    </label>

    <label>
      <span>¿Por qué?</span>
      <input
        bind:value={ajusteJustifica}
        placeholder="Aportación del dueño para el cambio del fin de semana"
      />
    </label>

    {#if errorAjuste}<p class="error" role="alert">{errorAjuste}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (ajustando = false)}>Cancelar</button>
      <button class="principal" onclick={confirmarAjuste}>Registrar el ajuste</button>
    </div>
  </div>
{/if}

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 68rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 44rem;
  }
  .saldos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 0.85rem;
  }
  .saldo {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .saldo.total {
    background: var(--negro);
    color: #fff;
    border-color: var(--negro);
  }
  .saldo .rotulo {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .saldo.total .rotulo {
    color: rgba(255, 255, 255, 0.7);
  }
  .saldo b {
    font-family: var(--font-titulo);
    font-size: 1.65rem;
    font-weight: 700;
  }
  .saldo.negativo b {
    color: var(--peligro);
  }
  .saldo p {
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--gris);
  }
  .saldo.total p {
    color: rgba(255, 255, 255, 0.6);
  }
  .saldo .acciones {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .aviso {
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 1.1rem;
    font-size: 0.86rem;
    line-height: 1.55;
  }
  .aviso b {
    color: var(--acento-texto);
  }
  .aviso p {
    margin-top: 0.3rem;
    color: var(--pizarra);
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
  }
  .cabecera-tarjeta {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 0.85rem;
    flex-wrap: wrap;
  }
  h2 {
    flex: 1;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .ventanas {
    display: flex;
    gap: 0.3rem;
  }
  .pestana {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.75rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .pestana.on {
    border-color: var(--acento);
    color: var(--acento-texto);
    background: #fff7f0;
  }
  .cifras {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding-bottom: 0.9rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  .cifras div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .cifras span {
    font-size: 0.73rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .cifras b {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    font-weight: 700;
  }
  .cifras .entra b {
    color: #2f8f3f;
  }
  .cifras .sale b {
    color: var(--peligro);
  }
  .cifras .fuerte b {
    font-size: 1.3rem;
  }
  .marco-tabla {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--borde);
    white-space: nowrap;
  }
  td {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid #f0eeec;
    vertical-align: top;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  td.sale {
    color: var(--peligro);
  }
  .tenue {
    color: var(--gris);
    white-space: nowrap;
  }
  tr.ajuste td {
    background: #fffaf5;
  }
  .porque {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--acento-texto);
  }
  .faltante {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
  }

  /* --- Diálogos --- */
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .dialogo {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    background: #fff;
    border-radius: var(--r-md);
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: var(--sombra-lg);
  }
  .dialogo.ancho {
    width: min(38rem, calc(100vw - 2rem));
  }
  .dialogo h2 {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .explica {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .dialogo label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dialogo label > span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .dialogo input,
  .dialogo select {
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  .dialogo input:focus,
  .dialogo select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    font-size: 0.76rem;
    color: var(--gris);
    line-height: 1.4;
  }
  .denominaciones {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.5rem;
  }
  .denominaciones label {
    gap: 0.2rem;
  }
  .denominaciones span {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--gris);
  }
  .denominaciones input {
    padding: 0.45rem 0.5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .resultado-arqueo {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    padding: 0.8rem 0.9rem;
    background: #faf9f8;
    border-radius: var(--r-md);
  }
  .resultado-arqueo div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .resultado-arqueo span {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .resultado-arqueo b {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
  }
  .resultado-arqueo .mal b {
    color: var(--peligro);
  }
  .aviso-cambio {
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--acento-texto);
    background: #fffaf5;
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
    padding: 0.55rem 0.7rem;
  }
  .error {
    color: var(--peligro);
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.45;
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.3rem;
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
</style>
