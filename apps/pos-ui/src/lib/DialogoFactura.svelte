<script lang="ts">
  /**
   * Captura de datos fiscales del comensal para emitir el CFDI.
   *
   * CFDI 4.0 exige que el nombre y el código postal coincidan EXACTAMENTE con la
   * Constancia de Situación Fiscal; si no, el SAT rechaza. Por eso se avisa aquí
   * en vez de dejar que falle al timbrar.
   *
   * DESDE LA 1.5.6, LA FICHA DEL COMENSAL MANDA (pedidos de Gonzalo):
   *  - Arriba se busca a un comensal que ya tenga ficha, por nombre o RFC, en
   *    vez de volver a dictar la constancia.
   *  - Si el comensal no tiene ficha, se le puede hacer desde aquí mismo con
   *    los datos que falten: la factura ya trae los fiscales y el correo.
   *  - El correo es OBLIGATORIO: es por donde le llega su factura.
   */
  import {
    RECEPTOR_PUBLICO_GENERAL,
    REGIMENES_FISCALES,
    USOS_CFDI,
    problemaRfc,
    type Cliente,
    type DatosReceptor,
    type Domicilio,
    type EstadoComanda,
  } from "@motrest/dominio";
  import { clientes } from "./clientes.svelte";
  import { fiscal } from "./fiscal.svelte";
  import { sesion } from "./sesion/sesion.svelte";
  import { revelar } from "./subir";
  import { sync } from "./sync.svelte";

  interface Props {
    comanda: EstadoComanda;
    onCerrar: () => void;
  }
  let { comanda, onCerrar }: Props = $props();

  let receptor = $state<DatosReceptor>({
    rfc: "",
    nombre: "",
    regimen_fiscal: "612",
    codigo_postal: "",
    uso_cfdi: "G03",
  });
  /** A dónde le manda FacturAPI su factura. Obligatorio desde la 1.5.6. */
  let correoCliente = $state("");
  /*
   * Con FacturAPI el local emite factura GLOBAL: lo que no se factura a nombre
   * de alguien queda para ella. Por eso no se ofrece «Público en general»: en
   * CFDI 4.0 esa factura sin los datos de la global la rechaza el SAT, y además
   * esa venta saldría dos veces.
   */
  const conGlobal = $derived(
    !!(sync.secretos?.facturapi.configurada ?? sync.fiscal?.facturapi?.configurada),
  );
  let error = $state("");
  let problemas = $state<string[]>([]);
  let emitido = $state<{ serie: string; folio: string; ficha?: string } | null>(null);

  /*
   * TODO EN MAYÚSCULAS, mientras se teclea (pedido de Gonzalo, sep-2026).
   *
   * El SAT compara el nombre con la Constancia de Situación Fiscal, donde
   * SIEMPRE está en mayúsculas, y rechaza el CFDI si no coincide. Corregirlo al
   * guardar no basta: quien lo teclea tiene que VER cómo va a quedar, o dicta
   * «Juan Pérez» por teléfono y jura que lo escribió bien.
   */
  function enMayusculas(e: Event & { currentTarget: HTMLInputElement }): string {
    const valor = e.currentTarget.value.toLocaleUpperCase("es-MX");
    e.currentTarget.value = valor;
    return valor;
  }

  /** Lleva el cursor al buscador en cuanto aparece: se abrió para escribir. */
  function enfocar(nodo: HTMLElement) {
    nodo.focus();
  }

  // --- Elegir a un comensal que ya tiene ficha ------------------------------------

  /*
   * El buscador y su lista corta. Antes era un desplegable con SOLO los
   * clientes que tenían RFC guardado, en el orden en que se dieron de alta: con
   * doscientas fichas nadie encontraba a nadie, y quien tenía ficha sin datos
   * fiscales ni aparecía. Ahora se busca por nombre o por RFC (y también por
   * teléfono o correo: el buscador del dominio mira los cuatro) y la lista se
   * va acotando al teclear.
   */
  const TOPE = 6;
  let buscando = $state(false);
  let termino = $state("");
  let clienteId = $state<string | null>(null);

  const encontrados = $derived(clientes.buscar(termino));
  const alaVista = $derived(encontrados.slice(0, TOPE));
  const fichaElegida = $derived(clienteId ? clientes.porId(clienteId) : undefined);

  function elegirFicha(c: Cliente) {
    clienteId = c.cliente_id;
    if (c.fiscal) {
      receptor = { ...c.fiscal };
    } else {
      // Sin constancia guardada, el nombre de la ficha es el mejor punto de
      // partida; quien factura lo corrige si la razón social es otra.
      receptor = { ...receptor, nombre: c.nombre.toLocaleUpperCase("es-MX") };
    }
    correoCliente = c.correo ?? "";
    buscando = false;
    termino = "";
    haciendoFicha = false;
  }

  function soltarFicha() {
    clienteId = null;
    buscando = true;
  }

  // --- Hacerle la ficha a quien no la tiene ---------------------------------------

  /*
   * «HACER LA FICHA DE ESTE COMENSAL» (1.5.6, pedido de Gonzalo).
   *
   * Quien pide factura es, casi siempre, alguien que va a volver. Hacerle la
   * ficha aquí, con lo que ya se tecleó, evita pedirle otra vez la constancia la
   * próxima vez y deja su correo para las reservas y las promociones. Solo se
   * piden los datos de la ficha que la factura NO trae: los fiscales y el correo
   * ya están arriba.
   *
   * Se guarda al EMITIR, no antes: una ficha creada para una factura que luego
   * no sale dejaría un comensal a medias con datos que nadie confirmó.
   */
  const puedeHacerFicha = $derived(sesion.puedeOperar("crm.cliente.editar"));
  let haciendoFicha = $state(false);
  let fichaNombre = $state("");
  let fichaTelefono = $state("");
  let fichaNotas = $state("");
  let fichaPromos = $state(false);
  let conDomicilio = $state(false);
  let dom = $state<Domicilio>({ calle: "" });

  function alternarFicha() {
    haciendoFicha = !haciendoFicha;
    // El nombre de la ficha arranca con el de la factura: casi siempre es el
    // mismo, y si es una empresa se cambia por el de quien vino.
    if (haciendoFicha && !fichaNombre.trim()) fichaNombre = receptor.nombre;
  }

  /** Un correo con la forma mínima de un correo. Lo demás lo dice el servidor. */
  function correoValido(texto: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(texto.trim());
  }

  /**
   * Guarda la ficha, o completa la que ya existía. La regla —ligar por
   * teléfono, completar sin pisar— vive en el store de clientes, con sus
   * pruebas; aquí solo se junta lo que se tecleó.
   *
   * Devuelve el nombre para el aviso de «quedó la ficha», o nada si no hubo
   * ficha nueva (completar la elegida no merece aviso: ya se sabía de quién era).
   */
  function guardarFicha(receptorFinal: DatosReceptor): string | undefined {
    if (!fichaElegida && !haciendoFicha) return undefined;
    clientes.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    const r = clientes.fichaDesdeFactura({
      cliente_id: fichaElegida?.cliente_id,
      receptor: receptorFinal,
      correo: correoCliente,
      nueva: haciendoFicha
        ? {
            nombre: fichaNombre,
            telefono: fichaTelefono.trim() || undefined,
            notas: fichaNotas.trim() || undefined,
            // La dirección se escribe como se dice —no en mayúsculas, como la
            // factura— y solo se guarda si se llenó la calle.
            domicilio: conDomicilio && dom.calle.trim() ? { ...dom } : undefined,
            acepta_promociones: fichaPromos,
            // El consentimiento lleva su fecha: es lo que se enseña si alguien
            // pregunta por qué le llegó una promoción.
            acepta_promociones_ts: fichaPromos ? Date.now() : undefined,
          }
        : undefined,
    });
    return r.como === "nueva" || r.como === "telefono" ? r.nombre : undefined;
  }

  function emitir(datos: DatosReceptor, esPublicoGeneral = false) {
    error = "";
    problemas = [];

    if (!esPublicoGeneral) {
      const malRfc = problemaRfc(datos.rfc);
      if (malRfc) {
        error = malRfc;
        return;
      }
      if (!correoValido(correoCliente)) {
        error = "Escribe el correo del cliente: es por donde le llega su factura.";
        return;
      }
      if (haciendoFicha && !fichaNombre.trim() && !datos.nombre.trim()) {
        error = "Escribe el nombre del comensal para hacer su ficha.";
        return;
      }
    }

    const receptorFinal = { ...datos, rfc: datos.rfc.trim().toUpperCase() };
    const r = fiscal.facturar(comanda, receptorFinal, {
      correo: esPublicoGeneral ? undefined : correoCliente,
      conGlobal,
    });
    if (!r.ok) {
      error = r.error ?? "No se pudo emitir el comprobante";
      problemas = (r.problemas ?? []).map((p) => p.mensaje);
      return;
    }
    const ficha = esPublicoGeneral ? undefined : guardarFicha(receptorFinal);
    emitido = { serie: r.registro!.serie, folio: r.registro!.folio, ficha };
  }
</script>

<div class="velo" role="presentation" onclick={onCerrar}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Emitir factura">
  {#if emitido}
    <div class="listo">
      <p class="folio">{emitido.serie}-{emitido.folio}</p>
      <h2>Comprobante generado</h2>
      <p class="nota">
        {#if conGlobal}
          Quedó guardado y en cola: se timbra con FacturAPI en cuanto haya conexión.
          {#if correoCliente.trim()}Le llegará por correo a <b>{correoCliente.trim()}</b>.{/if}
          Lo puedes seguir en Finanzas.
        {:else}
          Quedó guardado y en cola. Se timbrará ante el SAT en cuanto haya un PAC
          conectado; lo puedes seguir en Finanzas.
        {/if}
      </p>
      {#if emitido.ficha}
        <p class="nota ficha-ok">Y quedó la ficha de <b>{emitido.ficha}</b> en Clientes.</p>
      {/if}
      <button class="principal" onclick={onCerrar}>Cerrar</button>
    </div>
  {:else}
    <header>
      <h2>Emitir factura</h2>
      <button class="cerrar" onclick={onCerrar} aria-label="Cerrar">×</button>
    </header>

    {#if !fiscal.emisorCompleto}
      <p class="bloqueo" role="alert">
        Faltan los datos fiscales del restaurante. Complétalos en
        <b>Finanzas → Facturación</b> antes de emitir.
      </p>
    {:else}
      <!-- Primero, ¿ya tiene ficha? -->
      <div class="elegir-ficha">
        {#if fichaElegida}
          <p class="ficha-elegida">
            Factura para la ficha de <b>{fichaElegida.nombre}</b>
            {#if !fichaElegida.fiscal}<small>· sin datos fiscales todavía: se le guardan al emitir</small>{/if}
            <button class="enlace" onclick={soltarFicha}>Cambiar</button>
          </p>
        {:else if !buscando}
          <button class="buscar-ficha" onclick={() => (buscando = true)}>
            Seleccionar clientes que ya tengan Ficha de Comensal
          </button>
        {:else}
          <input
            class="buscador"
            use:enfocar
            bind:value={termino}
            placeholder="Escribe el nombre o el RFC del comensal"
            autocomplete="off"
            spellcheck="false"
            aria-label="Buscar comensal por nombre o RFC"
          />
          <ul class="resultados">
            {#each alaVista as c (c.cliente_id)}
              <li>
                <button onclick={() => elegirFicha(c)}>
                  <b>{c.nombre}</b>
                  <span>
                    {c.fiscal?.rfc ?? "Sin datos fiscales"}{c.telefono ? ` · ${c.telefono}` : ""}
                  </span>
                </button>
              </li>
            {:else}
              <li class="vacio">
                {termino.trim()
                  ? `Ningún comensal coincide con «${termino.trim()}».`
                  : "Todavía no hay comensales con ficha."}
              </li>
            {/each}
          </ul>
          {#if encontrados.length > TOPE}
            <p class="mas">Hay {encontrados.length - TOPE} más: sigue escribiendo para acotar.</p>
          {/if}
          <button
            class="enlace"
            onclick={() => {
              buscando = false;
              termino = "";
            }}
          >
            Capturar a mano
          </button>
        {/if}
      </div>

      <div class="campos">
        <label>
          <span>RFC del cliente</span>
          <input
            value={receptor.rfc}
            oninput={(e) => (receptor.rfc = enMayusculas(e))}
            placeholder="GODE561231GR8"
            maxlength="13"
            autocapitalize="characters"
            spellcheck="false"
          />
        </label>
        <label class="ancho">
          <span>Nombre o razón social (exacto, como en su constancia)</span>
          <input
            value={receptor.nombre}
            oninput={(e) => (receptor.nombre = enMayusculas(e))}
            placeholder="JUAN PEREZ LOPEZ"
            autocapitalize="characters"
            spellcheck="false"
          />
        </label>
        <label>
          <span>Código postal</span>
          <input bind:value={receptor.codigo_postal} placeholder="44650" maxlength="5" />
        </label>
        <label>
          <span>Régimen fiscal</span>
          <select bind:value={receptor.regimen_fiscal}>
            {#each REGIMENES_FISCALES as r (r.clave)}
              <option value={r.clave}>{r.clave} · {r.descripcion}</option>
            {/each}
          </select>
        </label>
        <label class="ancho">
          <span>Correo para mandarle la factura</span>
          <input
            type="email"
            bind:value={correoCliente}
            placeholder="cliente@correo.com"
            autocomplete="off"
            required
          />
        </label>
        <label class="ancho">
          <span>Uso del CFDI</span>
          <select bind:value={receptor.uso_cfdi}>
            {#each USOS_CFDI as u (u.clave)}
              <option value={u.clave}>{u.clave} · {u.descripcion}</option>
            {/each}
          </select>
        </label>
      </div>

      <p class="advertencia">
        El nombre y el código postal deben coincidir exactamente con la Constancia
        de Situación Fiscal del cliente, o el SAT rechazará el comprobante.
      </p>

      <!-- Hacerle la ficha a quien no la tiene. -->
      {#if !fichaElegida && puedeHacerFicha}
        <button class="hacer-ficha" class:on={haciendoFicha} aria-pressed={haciendoFicha} onclick={alternarFicha}>
          {haciendoFicha ? "✓ " : ""}Hacer la Ficha de este Comensal
        </button>
        {#if haciendoFicha}
          <div class="nueva-ficha" use:revelar>
            <p class="leyenda">Llene los siguientes datos para poder completar la ficha del cliente.</p>
            <div class="campos">
              <label class="ancho">
                <span>Nombre o contacto</span>
                <input bind:value={fichaNombre} placeholder="José Pérez" />
              </label>
              <label>
                <span>Teléfono</span>
                <input bind:value={fichaTelefono} inputmode="tel" placeholder="33-1122-3344" />
              </label>
              <label class="ancho">
                <span>Notas (alergias, preferencias)</span>
                <input bind:value={fichaNotas} placeholder="Sin cebolla, alérgico a la nuez" />
              </label>
            </div>
            <label class="casilla">
              <input type="checkbox" bind:checked={fichaPromos} />
              <span>Acepta recibir promociones por correo</span>
            </label>
            <label class="casilla">
              <input type="checkbox" bind:checked={conDomicilio} />
              <span>Tiene domicilio para entregas</span>
            </label>
            {#if conDomicilio}
              <div class="campos" use:revelar>
                <label class="ancho"><span>Calle</span><input bind:value={dom.calle} placeholder="Av. Juárez" /></label>
                <label><span>Número</span><input bind:value={dom.numero} placeholder="123" /></label>
                <label><span>Colonia</span><input bind:value={dom.colonia} placeholder="Centro" /></label>
                <label><span>Ciudad</span><input bind:value={dom.ciudad} placeholder="Guadalajara" /></label>
                <label><span>Código postal</span><input bind:value={dom.codigo_postal} placeholder="44100" maxlength="5" /></label>
                <label class="ancho"><span>Referencias</span><input bind:value={dom.referencias} placeholder="Portón verde, entre Morelos y Hidalgo" /></label>
              </div>
            {/if}
            <p class="advertencia">
              El RFC, la razón social y el correo se toman de la factura de arriba.
              Si ese teléfono ya tiene ficha, se completa esa en vez de duplicarla.
            </p>
          </div>
        {/if}
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#each problemas as problema (problema)}
        <p class="error">{problema}</p>
      {/each}

      {#if conGlobal}
        <p class="advertencia">
          ¿El cliente no quiere factura a su nombre? No hace falta emitir nada: su
          ticket queda para la <b>factura global</b> del mes, en Finanzas.
        </p>
      {/if}

      <div class="botones">
        {#if !conGlobal}
          <button class="secundario" onclick={() => emitir({ ...RECEPTOR_PUBLICO_GENERAL }, true)}>
            Público en general
          </button>
        {/if}
        <button class="principal" onclick={() => emitir(receptor)}>
          {haciendoFicha && !fichaElegida ? "Emitir factura y guardar ficha" : "Emitir factura"}
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 32;
  }
  .panel {
    position: fixed;
    z-index: 33;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(32rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    padding: 1.25rem 1.4rem 1.4rem;
    box-shadow: var(--sombra-lg);
  }
  header {
    display: flex;
    align-items: center;
    margin-bottom: 0.85rem;
  }
  h2 {
    flex: 1;
    font-size: 1.2rem;
    font-weight: 600;
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }

  /* --- Elegir comensal con ficha --- */
  .elegir-ficha {
    margin-bottom: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .buscar-ficha {
    width: 100%;
    padding: 0.65rem 0.8rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    background: #fff;
    color: var(--acento-texto);
    font-weight: 600;
    font-size: 0.88rem;
    text-align: left;
  }
  .buscador {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
  }
  .buscador:focus {
    outline: none;
  }
  .resultados {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .resultados li + li {
    border-top: 1px solid var(--borde);
  }
  .resultados button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.5rem 0.75rem;
    background: #fff;
    text-align: left;
    font-size: 0.86rem;
  }
  .resultados button:hover {
    background: var(--claro);
  }
  .resultados span {
    font-size: 0.74rem;
    color: var(--gris);
    font-family: ui-monospace, Consolas, monospace;
  }
  .resultados .vacio {
    padding: 0.6rem 0.75rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .mas {
    font-size: 0.75rem;
    color: var(--gris);
  }
  .enlace {
    align-self: flex-start;
    font-size: 0.8rem;
    color: var(--acento-texto);
    text-decoration: underline;
  }
  .ficha-elegida {
    padding: 0.6rem 0.8rem;
    background: var(--claro);
    border-radius: var(--r-md);
    font-size: 0.86rem;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
  }
  .ficha-elegida small {
    color: var(--gris);
  }

  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos input,
  .campos select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .advertencia {
    margin-top: 0.75rem;
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.5;
  }

  /* --- Hacer la ficha --- */
  .hacer-ficha {
    margin-top: 0.9rem;
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1.5px dashed var(--acento);
    border-radius: var(--r-md);
    background: #fff;
    color: var(--acento-texto);
    font-weight: 600;
    font-size: 0.88rem;
  }
  .hacer-ficha.on {
    border-style: solid;
    background: var(--claro);
  }
  .nueva-ficha {
    margin-top: 0.6rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .leyenda {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .casilla {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .casilla input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--acento);
  }
  .nueva-ficha .advertencia {
    margin-top: 0;
  }

  .bloqueo {
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.8rem 1rem;
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .error {
    margin-top: 0.5rem;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .listo {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 0;
  }
  .listo .folio {
    font-family: var(--font-titulo);
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--acento-texto);
  }
  .listo .nota {
    font-size: 0.86rem;
    color: var(--gris);
    max-width: 22rem;
    line-height: 1.5;
  }
  .ficha-ok b {
    color: var(--acento-texto);
  }
  .listo .principal {
    margin-top: 0.5rem;
  }
</style>
