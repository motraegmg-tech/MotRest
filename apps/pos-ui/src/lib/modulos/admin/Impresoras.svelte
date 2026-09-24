<script lang="ts">
  /**
   * M9 · Impresoras: ruteo por área, cola y vista previa.
   *
   * Imprimir nunca bloquea la venta: un trabajo que falla se reintenta y, si se
   * rinde, queda a la vista para reimprimirlo a mano. Lo que jamás se pierde es
   * el evento de venta, que ya está en el registro.
   */
  import {
    impresion,
    enLaCaja,
    type ImpresoraDetectada,
  } from "../../impresion.svelte";
  import { pesos } from "@motrest/dominio";
  import { precuenta, type AnchoPapel } from "@motrest/impresion";
  import { menu } from "../../menu.svelte";
  import { hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";
  import { licencia } from "../../licencia.svelte";
  import { local } from "../../local.svelte";
  import { autofactura } from "../../autofactura.svelte";
  import { armarQrDeFactura } from "../../portal.svelte";
  import { prepararLogo, recalcularLogo } from "../../logo-ticket";
  import { respaldo } from "../../respaldo.svelte";
  import VistaPreviaTicket from "../../VistaPreviaTicket.svelte";
  import { accesoWeb } from "../../web/acceso-web.svelte";
  import { viasDisponibles, type ViaNavegador } from "../../web/impresoras-del-dispositivo";
  import { obtenerDeviceId } from "../../presentacion";
  import { revelar } from "../../subir";

  /*
   * IMPRESORAS DE ESTE DISPOSITIVO (MotRest en la web, 1.6.0). En la web no hay
   * Hub que mande a las impresoras: si el equipo tiene una conectada por USB o
   * Bluetooth, se da de alta aquí y la usa él. Solo se ofrecen las vías que
   * este navegador tiene de verdad.
   */
  const enLaWeb = accesoWeb.restaurante !== null;
  const vias = viasDisponibles();
  const ESTE_EQUIPO = obtenerDeviceId();
  let errorDispositivo = $state("");
  /** La que se acaba de dar de alta: nace al final de la lista y hay que llevar la vista a ella. */
  let recienAgregada = $state("");
  async function agregarDelDispositivo(via: ViaNavegador) {
    errorDispositivo = "";
    const r = await impresion.agregarDelDispositivo(via);
    if (!r.ok && r.error) errorDispositivo = r.error;
    if (r.ok && r.id) recienAgregada = r.id;
  }

  let nueva = $state("");
  let manual = $state(false);

  // La lista de impresoras del sistema solo existe en la caja, y solo hace
  // falta aquí: se pide al abrir la pantalla, no en el arranque del POS.
  const esCaja = enLaCaja();
  $effect(() => {
    void impresion.cargarImpresorasSistema();
    /*
     * Al abrir se consultan las de Windows, que es instantáneo. El barrido de la
     * red NO se hace solo: tarda unos segundos y abre cientos de conexiones, así
     * que se dispara con el botón de quien lo necesita.
     */
    if (impresion.deteccion === null) void impresion.buscar(false);
  });

  const puedeEditar = $derived(sesion.puedeOperar("admin.dispositivo.aprobar"));
  const areas = $derived([
    { id: "caja", nombre: "Caja (tickets y cortes)" },
    ...menu.estaciones.map((e) => ({ id: e.id, nombre: e.nombre })),
  ]);

  function alternarArea(impresoraId: string, areaId: string) {
    const imp = impresion.impresoras.find((i) => i.id === impresoraId);
    if (!imp) return;
    const areas = imp.areas.includes(areaId)
      ? imp.areas.filter((a) => a !== areaId)
      : [...imp.areas, areaId];
    impresion.actualizar(impresoraId, { areas });
  }

  // --- Asistente de detección -------------------------------------------------------

  /**
   * Lo que se lleva elegido para CADA impresora encontrada, mientras no se
   * confirme. Se guarda por clave de la detectada y no en la lista de impresoras
   * porque hasta que alguien pulsa «Agregar» no existe nada que configurar.
   */
  let elegidas = $state<Record<string, { areas: string[]; nombre: string }>>({});

  /**
   * Identidad estable de una encontrada: el dispositivo, o la dirección.
   *
   * Las de USB y Bluetooth se distinguen por `dispositivo` —el nombre de la cola
   * o el puerto COM—. Meterlas en la rama de red daría `red:undefined:undefined`
   * para todas, y entonces las áreas que se marcan a una se marcarían a todas.
   */
  function claveDe(d: ImpresoraDetectada): string {
    return d.origen === "red"
      ? `red:${d.host}:${d.puerto}`
      : `${d.origen}:${d.dispositivo ?? d.puerto_sistema}`;
  }

  function borrador(d: ImpresoraDetectada) {
    return elegidas[claveDe(d)] ?? { areas: [], nombre: d.nombre };
  }

  function alternarAreaNueva(d: ImpresoraDetectada, areaId: string) {
    const actual = borrador(d);
    const areas = actual.areas.includes(areaId)
      ? actual.areas.filter((a) => a !== areaId)
      : [...actual.areas, areaId];
    elegidas = { ...elegidas, [claveDe(d)]: { ...actual, areas } };
  }

  function renombrarNueva(d: ImpresoraDetectada, nombre: string) {
    elegidas = { ...elegidas, [claveDe(d)]: { ...borrador(d), nombre } };
  }

  function agregarDetectada(d: ImpresoraDetectada) {
    const { areas, nombre } = borrador(d);
    impresion.adoptar(d, areas, nombre);
    // Se limpia el borrador: la ficha real ya manda a partir de aquí.
    const { [claveDe(d)]: _usado, ...resto } = elegidas;
    elegidas = resto;
  }

  /** Las de papel primero; las virtuales se agrupan aparte y colapsadas. */
  const encontradas = $derived(impresion.deteccion?.impresoras ?? []);
  const dePapel = $derived(encontradas.filter((d) => !d.virtual));
  const virtuales = $derived(encontradas.filter((d) => d.virtual));
  let verVirtuales = $state(false);
  const qrAdicionalValido = $derived(local.qrAdicionalParaTicket);

  // --- El logo del ticket ------------------------------------------------------------

  let campoLogo = $state<HTMLInputElement | null>(null);
  let logoOcupado = $state(false);
  let errorLogo = $state("");

  async function elegirLogo(evento: Event) {
    const archivo = (evento.currentTarget as HTMLInputElement).files?.[0];
    if (!archivo) return;
    errorLogo = "";
    logoOcupado = true;
    const r = await prepararLogo(archivo, local.logo?.umbral);
    logoOcupado = false;
    if (!r.ok) {
      errorLogo = r.error;
      return;
    }
    local.fijarLogo(r.logo);
    // El campo se limpia para que elegir OTRA VEZ el mismo archivo vuelva a
    // disparar el cambio: sin esto, quien reemplaza un logo por el mismo nombre
    // ve que no pasa nada.
    if (campoLogo) campoLogo.value = "";
  }

  /**
   * Recalcula el logo con otra intensidad.
   *
   * Va en `onchange` y no en `oninput`: cada recálculo redibuja la imagen dos
   * veces —una por ancho de papel— y hacerlo en cada píxel del deslizador dejaría
   * la pantalla pegada mientras se arrastra.
   */
  async function cambiarIntensidad(evento: Event) {
    const actual = local.logo;
    if (!actual) return;
    const umbral = Number((evento.currentTarget as HTMLInputElement).value);
    errorLogo = "";
    logoOcupado = true;
    const r = await recalcularLogo(actual, umbral);
    logoOcupado = false;
    if (!r.ok) {
      errorLogo = r.error;
      return;
    }
    local.fijarLogo(r.logo);
  }

  // --- La vista previa del ticket ----------------------------------------------------

  /**
   * El ancho de papel con el que se previsualiza.
   *
   * Sale de la impresora que tiene el área de caja, que es la que va a sacar
   * este papel de verdad. Sin ninguna configurada se supone 80 mm, que es lo
   * normal en una caja.
   */
  const anchoPapel = $derived<AnchoPapel>(
    impresion.impresoras.find((i) => i.activa && i.areas.includes("caja"))?.ancho ?? 42,
  );

  /**
   * Un cobro de ejemplo, con lo que de verdad lleva un ticket de Rodizio.
   *
   * Importes inventados y plausibles: la vista previa existe para ver el LOGO,
   * las frases y los códigos, no para cuadrar cuentas. Lo que no se inventa es la
   * plantilla —es `precuenta()`, la misma que compone los bytes del rollo—, así
   * que lo que se ve aquí es el papel, no una maqueta parecida.
   */
  const ticketDeMuestra = $derived.by(() => {
    const suma = pesos(486);
    return precuenta(
      {
        folio: "A1B2C3D4",
        ts: Date.now(),
        local: local.fichaParaTicket(licencia.licencia?.nombre ?? "TU RESTAURANTE"),
        textos: local.textosTicket,
        logo: local.logoParaTicket(anchoPapel) ?? undefined,
        mesa: "7",
        mesero: "Lucía",
        a_nombre_de: "Familia Ramírez",
        renglones: [
          { cantidad: 1, descripcion: "Pizza grande mitad y mitad", detalle: "Pepperoni / Hawaiana", importe: pesos(289) },
          { cantidad: 1, descripcion: "Fettuccine Alfredo", importe: pesos(145) },
          { cantidad: 2, descripcion: "Refresco 600 ml", importe: pesos(52) },
        ],
        suma,
        descuentos: pesos(0),
        cortesias: pesos(0),
        total: suma,
        propina: pesos(50),
        pagos: [{ forma: "Efectivo", monto: pesos(600) }],
        cambio: pesos(64),
        qrs: [
          // El de factura va primero, como en el cobro de verdad (`imprimirTicketCliente`).
          ...(autofactura.portal ? [armarQrDeFactura(autofactura.portal, "A1B2C3D4", "VISTAPREVIA23456")] : []),
          ...(local.qrResena
            ? [{
                leyenda: local.textosTicket.invitacion_opinion,
                url: "https://motrest.local/portal/#/c/VISTA-PREVIA",
              }]
            : []),
          ...(qrAdicionalValido ? [qrAdicionalValido] : []),
        ],
      },
      anchoPapel,
    ).aBloques();
  });
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Impresoras</h1>
      <p class="sub">
        A qué impresora va cada área. <b>Cada una imprime solo lo que se le
        marque</b>: un área sin impresora asignada no sale en papel en ningún
        lado, y eso es a propósito — apagar la de cocina tiene que dejar de
        imprimir comandas, no mandarlas todas al rollo de la caja.
      </p>
    </div>
  </div>

  <!--
    LO QUE VA IMPRESO EN EL TICKET.

    Estaba escrito dentro del código, con los datos de un restaurante concreto:
    cualquier local que instalara MotRest entregaba tickets con el nombre, la
    dirección y el RFC de otro. Va aquí, junto a las impresoras, porque es donde
    se viene cuando algo del papel no está bien.
  -->
  <section class="tarjeta">
    <h2>Lo que aparece en el ticket</h2>
    <p class="ayuda">
      Los datos de tu restaurante y las frases que lee el comensal. Los importes,
      el folio y los impuestos no se editan: eso es el comprobante.
    </p>

    <div class="editor-ticket">
    <div class="ficha">
      <!--
        EL LOGO (pedido de Gonzalo).

        Se convierte a puntos al elegirlo, no al imprimir: una térmica no tiene
        grises y la conversión necesita `canvas`, que no existe en el Hub. Lo que
        se guarda son los puntos ya calculados, uno por ancho de papel. La
        intensidad es un control y no un número fijo porque ningún umbral sirve
        para todos los logotipos. Ver `logo-ticket.ts`.
      -->
      <div class="ancho logo">
        <span class="rotulo-logo">Logo del restaurante <em>(opcional)</em></span>
        <div class="logo-fila">
          {#if local.logo}
            <img class="logo-muestra" src={local.logo.fuente} alt="Logo elegido" />
          {:else}
            <span class="logo-vacio">Sin logo</span>
          {/if}

          <div class="logo-mandos">
            <div class="logo-botones">
              <button class="conectar" disabled={logoOcupado} onclick={() => campoLogo?.click()}>
                {logoOcupado ? "Procesando…" : local.logo ? "Cambiar imagen" : "Elegir imagen"}
              </button>
              {#if local.logo}
                <button class="mini peligro" disabled={logoOcupado} onclick={() => local.fijarLogo(null)}>
                  Quitar
                </button>
              {/if}
            </div>

            {#if local.logo}
              <label class="intensidad">
                Intensidad
                <input
                  type="range"
                  min="0.3"
                  max="0.85"
                  step="0.02"
                  value={local.logo.umbral}
                  disabled={logoOcupado}
                  onchange={cambiarIntensidad}
                />
                <em>
                  Súbela si el logo sale muy claro; bájala si sale como una
                  mancha. Míralo en la vista previa.
                </em>
              </label>
            {:else}
              <p class="ayuda-logo">
                Un PNG o JPG con el logo en oscuro sobre fondo claro. Se imprime
                en blanco y negro —una térmica no tiene grises— y se reduce al
                ancho del papel.
              </p>
            {/if}
            {#if errorLogo}<p class="aviso-error">{errorLogo}</p>{/if}
          </div>
        </div>
        <input
          class="oculto"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          bind:this={campoLogo}
          onchange={elegirLogo}
        />
      </div>

      <label>
        Nombre del restaurante
        <input
          value={local.ficha.nombre}
          oninput={(e) => local.fijarFicha({ nombre: e.currentTarget.value })}
          placeholder="El de la licencia si lo dejas vacío"
        />
      </label>
      <label>
        Dirección
        <input
          value={local.ficha.direccion}
          oninput={(e) => local.fijarFicha({ direccion: e.currentTarget.value })}
          placeholder="Calle, número y colonia"
        />
      </label>
      <label>
        Teléfono
        <input
          value={local.ficha.telefono}
          oninput={(e) => local.fijarFicha({ telefono: e.currentTarget.value })}
          placeholder="55 1234 5678"
        />
      </label>
      <label>
        RFC
        <input
          value={local.ficha.rfc}
          oninput={(e) => local.fijarFicha({ rfc: e.currentTarget.value.toUpperCase() })}
          placeholder="Se imprime solo si lo pones"
        />
      </label>
      <label class="ancho">
        Mensaje bajo los datos <em>(opcional)</em>
        <input
          value={local.textosTicket.encabezado}
          oninput={(e) => local.fijarTextosTicket({ encabezado: e.currentTarget.value })}
          placeholder="Pizzas y pasta a la leña desde 1998"
        />
      </label>
      <label class="ancho interruptor">
        <input
          type="checkbox"
          checked={local.qrResena}
          onchange={(e) => local.fijarQrResena(e.currentTarget.checked)}
        />
        <span>
          Imprimir el código QR de reseña
          <em>
            {local.qrResena
              ? "Solo abre desde el wifi del restaurante."
              : "Apagado: el ticket sale sin el código."}
          </em>
        </span>
      </label>
      {#if local.qrResena}
        <label class="ancho">
          Invitación a dejar reseña <em>(va sobre el código QR)</em>
          <input
            value={local.textosTicket.invitacion_opinion}
            oninput={(e) => local.fijarTextosTicket({ invitacion_opinion: e.currentTarget.value })}
          />
        </label>
      {/if}
      <label class="ancho">
        Segundo QR <em>(opcional)</em>
        <input
          value={local.qrAdicional.leyenda}
          oninput={(e) => local.fijarQrAdicional({ leyenda: e.currentTarget.value })}
          placeholder="Danos 5 estrellas en Google Maps"
        />
      </label>
      <label class="ancho">
        Enlace del segundo QR
        <input
          type="url"
          value={local.qrAdicional.url}
          oninput={(e) => local.fijarQrAdicional({ url: e.currentTarget.value })}
          placeholder="https://maps.app.goo.gl/..."
        />
      </label>
      <!--
        CON PORTAL SE EDITA OTRO TEXTO. El de sin portal pide ir con el mesero; el
        de con portal va sobre el QR y lo invita a escanearlo. Enseñar el que no
        se imprime sería editar a ciegas.
      -->
      {#if autofactura.portal}
        <label class="ancho">
          Cómo pedir factura <em>(va arriba del QR de factura)</em>
          <textarea
            rows="2"
            value={local.textosTicket.aviso_factura_portal}
            oninput={(e) => local.fijarTextosTicket({ aviso_factura_portal: e.currentTarget.value })}
          ></textarea>
          <small>
            Tu portal de autofactura está encendido: debajo de esta frase sale el QR,
            y debajo del QR la dirección del portal y la clave con el folio.
          </small>
        </label>
      {:else}
        <label class="ancho">
          Cómo pedir factura
          <input
            value={local.textosTicket.aviso_factura}
            oninput={(e) => local.fijarTextosTicket({ aviso_factura: e.currentTarget.value })}
            placeholder="¿Necesita factura? Pídala con su mesero antes de irse."
          />
          <small>
            Sale en la pre-cuenta y en el ticket cobrado, antes de la despedida.
            Déjalo vacío para no imprimirlo.
          </small>
        </label>
      {/if}
      <label>
        Despedida
        <input
          value={local.textosTicket.agradecimiento}
          oninput={(e) => local.fijarTextosTicket({ agradecimiento: e.currentTarget.value })}
        />
      </label>
      <label>
        Última línea <em>(opcional)</em>
        <input
          value={local.textosTicket.pie}
          oninput={(e) => local.fijarTextosTicket({ pie: e.currentTarget.value })}
          placeholder="Síguenos en @turestaurante"
        />
      </label>
      {#if !qrAdicionalValido && local.qrAdicional.url.trim()}
        <p class="ancho aviso-error">
          El segundo enlace debe comenzar con http:// o https://.
        </p>
      {/if}
    </div>

    <!--
      LA VISTA PREVIA (pedido de Gonzalo).

      Se dibuja con `precuenta()`, la misma función que compone los bytes que
      salen por el rollo, y con los ajustes de esta pantalla ya aplicados. No es
      una maqueta: el texto viene de los bytes de verdad y el logo se pinta punto
      por punto como lo va a imprimir el cabezal, así que aquí se ve si el logo
      quedó como una mancha ANTES de gastar papel.
    -->
    <aside class="previa-ticket">
      <div class="cab-previa">
        <b>Vista previa</b>
        <span>{anchoPapel === 32 ? "papel de 58 mm" : "papel de 80 mm"}</span>
      </div>
      <VistaPreviaTicket bloques={ticketDeMuestra} columnas={anchoPapel} />
      <small class="pie-previa">
        Cobro de ejemplo. Los importes son inventados; el formato, el logo y las
        frases son los de verdad.
        {#if qrAdicionalValido}
          <br />Segundo QR → {qrAdicionalValido.url}
        {/if}
      </small>
    </aside>
    </div>

    {#if !local.qrResena}
      <p class="ayuda">
        El <b>QR de reseña</b> está apagado. Hoy el enlace solo abre desde el wifi
        del restaurante, así que un comensal con datos móviles vería un error en
        vez de la encuesta. Se podrá encender cuando el portal esté publicado en
        internet.
      </p>
    {/if}
    <p class="ayuda">
      Debajo de todo siempre sale <b>MotRest by Motrae</b>. Eso no se cambia: es
      la firma de quién hizo el software, no un mensaje del restaurante.
    </p>
  </section>

  <!--
    LLEVARSE EL RESTAURANTE A OTRA COMPUTADORA.

    El Hub ya guarda copias solo, pero sirven para volver atrás en ESTA máquina.
    Esto es lo otro: un archivo que se copia a una USB y se vuelca en un equipo
    nuevo el día que el actual se muera. Restaurar no está aquí sino en la
    pantalla de bienvenida — en un equipo nuevo todavía no hay usuarios y nadie
    podría entrar a buscarlo.
  -->
  {#if respaldo.disponible}
    <section class="tarjeta">
      <h2>Respaldo para cambiar de computadora</h2>
      <p class="ayuda">
        Guarda todo el restaurante —ventas, carta, plano, personal e inventario—
        en un archivo cifrado. Guárdelo en una USB o en la nube: el día que este
        equipo falle, se restaura en el nuevo desde la primera pantalla.
      </p>
      <button class="conectar" disabled={respaldo.exportando} onclick={() => respaldo.exportar()}>
        {respaldo.exportando ? "Preparando…" : "Guardar respaldo"}
      </button>
      {#if respaldo.error}
        <p class="aviso-error">{respaldo.error}</p>
      {/if}
      <p class="ayuda">
        Solo se abre con la licencia de este restaurante, así que un archivo
        perdido no le sirve a nadie. <b>Restaurarlo en otra computadora necesita
        que MOTRAE lo autorice</b>, y ese permiso caduca.
      </p>
    </section>
  {/if}

  <!--
    DETECTAR Y CONECTAR.

    Va lo primero y siempre visible, porque es lo primero que hace falta al
    montar un local y lo que se vuelve a necesitar cada vez que cambian una
    impresora. Antes había que averiguar la IP del aparato o teclear su nombre
    de Windows letra por letra: dos datos que el restaurantero no tiene, y que
    mal puestos dejan a la cocina sin comandas sin decir por qué.
  -->
  {#if puedeEditar}
    <section class="tarjeta detectar">
      <div class="cab">
        <b>Detectar y conectar</b>
        <span class="sp"></span>
        {#if esCaja}
          <button onclick={() => impresion.buscar(false)} disabled={impresion.buscando}>
            Solo las de este equipo
          </button>
          <button class="principal" onclick={() => impresion.buscar(true)} disabled={impresion.buscando}>
            {impresion.buscando ? "Buscando…" : "Buscar impresoras"}
          </button>
        {/if}
      </div>

      {#if !esCaja}
        <p class="nota aviso">
          La búsqueda se hace desde la <b>caja</b>, que es el equipo conectado a
          las impresoras. Desde esta terminal se puede ver la configuración, pero
          no detectar ni imprimir.
        </p>
      {:else}
        <p class="explica">
          Busca las que están <b>conectadas por cable</b> a este equipo y las
          <b>inalámbricas o de red</b> que respondan en la red del restaurante.
          Solo hay que elegir qué imprime cada una.
        </p>

        {#if impresion.buscando}
          <p class="buscando" role="status">
            Revisando la red del local… tarda unos segundos, no cierres la pantalla.
          </p>
        {/if}

        {#if impresion.errorBusqueda}
          <p class="error" role="alert">{impresion.errorBusqueda}</p>
        {/if}

        {#if impresion.deteccion}
          {#if impresion.deteccion.sin_red}
            <p class="nota">
              Todavía no se ha barrido la red. Pulsa <b>Buscar impresoras</b> para
              encontrar también las inalámbricas.
            </p>
          {:else}
            <p class="nota">
              Se revisaron {impresion.deteccion.redes.length === 1 ? "la red" : "las redes"}
              {impresion.deteccion.redes.map((r) => `${r}.x`).join(", ")}.
            </p>
          {/if}

          {#if dePapel.length === 0}
            <p class="vacio">
              No se encontró ninguna impresora. Comprueba que esté encendida y —si
              es de red— que esté en la misma wifi que esta caja. También puedes
              darla de alta a mano abajo.
            </p>
          {/if}

          {#each dePapel as d (claveDe(d))}
            {@const ya = impresion.yaConfigurada(d)}
            {@const b = borrador(d)}
            <article class="hallazgo" class:puesta={!!ya}>
              <div class="fila-hallazgo">
                <span class="icono" aria-hidden="true">
                  {d.origen === "usb" ? "🔌" : d.origen === "bluetooth" ? "🅱️" : "📶"}
                </span>
                <span class="quien">
                  <b>{d.nombre}</b>
                  <small>{d.detalle}</small>
                </span>
                <span class="sp"></span>
                <!--
                  Una impresora sin dar de alta en Windows no puede imprimir ni
                  una prueba: primero hay que crearle la cola. Se ofrece aquí, y
                  no en el panel de control de Windows, porque quien monta el
                  local no tiene por qué saber que existe el spooler.
                -->
                {#if d.sin_instalar}
                  <button
                    class="instalar"
                    disabled={impresion.instalando === d.puerto_sistema}
                    onclick={() => impresion.instalar(d)}
                  >
                    {impresion.instalando === d.puerto_sistema
                      ? "Dando de alta…"
                      : "Dar de alta en Windows"}
                  </button>
                {:else}
                  <button onclick={() => impresion.probarDetectada(d)}>Imprimir prueba</button>
                {/if}
                {#if ya}
                  <span class="ya">Ya configurada como «{ya.nombre}»</span>
                {/if}
              </div>

              {#if !ya && !d.sin_instalar}
                <div class="config-hallazgo">
                  <label class="nombre-hallazgo">
                    <span>Nombre en MotRest</span>
                    <input
                      value={b.nombre}
                      oninput={(e) => renombrarNueva(d, e.currentTarget.value)}
                      placeholder="Caja, Cocina, Barra…"
                    />
                  </label>

                  <div class="areas">
                    <span class="etiqueta">¿Qué imprime?</span>
                    {#each areas as area (area.id)}
                      <button
                        class="area"
                        class:on={b.areas.includes(area.id)}
                        onclick={() => alternarAreaNueva(d, area.id)}
                      >
                        {area.nombre}
                      </button>
                    {/each}
                  </div>

                  <button
                    class="principal"
                    disabled={b.areas.length === 0}
                    onclick={() => agregarDetectada(d)}
                  >
                    Conectar esta impresora
                  </button>
                  {#if b.areas.length === 0}
                    <!--
                      Sin áreas no se deja agregar. Una impresora dada de alta que
                      no imprime nada es la peor de las configuraciones: parece
                      lista y no sale un solo papel.
                    -->
                    <span class="falta">Elige al menos una cosa que imprima</span>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}

          {#if virtuales.length > 0}
            <button class="mas" onclick={() => (verVirtuales = !verVirtuales)}>
              {verVirtuales ? "Ocultar" : "Ver"} las {virtuales.length} que no imprimen
              en papel (PDF, XPS, fax)
            </button>
            {#if verVirtuales}
              {#each virtuales as d (claveDe(d))}
                <div class="fila-hallazgo tenue">
                  <span class="icono" aria-hidden="true">📄</span>
                  <span class="quien">
                    <b>{d.nombre}</b>
                    <small>{d.detalle}</small>
                  </span>
                </div>
              {/each}
            {/if}
          {/if}
        {/if}
      {/if}

      <!--
        El alta a mano se conserva plegada: cubre la impresora en otra subred, la
        que está apagada durante la búsqueda y el servidor de impresión en un
        puerto que no es el 9100.
      -->
      <button class="mas" onclick={() => (manual = !manual)}>
        {manual ? "Ocultar" : "No aparece: darla de alta a mano"}
      </button>
      {#if manual}
        <div class="alta">
          <input bind:value={nueva} placeholder="Nombre de la impresora" />
          <button
            class="principal"
            onclick={() => { impresion.agregar(nueva); nueva = ""; manual = false; }}
            disabled={nueva.trim().length < 2}
          >
            Agregar
          </button>
        </div>
      {/if}
    </section>
  {/if}

  {#if esCaja}
    <p class="nota">
      Esta es la caja: desde aquí sí sale papel. Una impresora <b>de red</b>
      necesita su dirección IP; una <b>USB</b> necesita estar instalada en
      Windows y elegirse en la lista. Las demás terminales solo previsualizan.
    </p>
  {:else if enLaWeb}
    <section class="tarjeta">
      <h2>Impresoras de este dispositivo</h2>
      <p class="nota">
        Si este equipo tiene una impresora de tickets conectada, dala de alta aquí y los tickets saldrán en
        ella. El cajón de dinero se abre con la impresora, como en la caja.
      </p>
      <div class="alta">
        {#if vias.usb}<button class="principal" onclick={() => agregarDelDispositivo("usb")}>Impresora USB</button>{/if}
        {#if vias.serial}<button onclick={() => agregarDelDispositivo("serial")}>Puerto serie o Bluetooth emparejado</button>{/if}
        {#if vias.bluetooth}<button onclick={() => agregarDelDispositivo("bluetooth")}>Impresora Bluetooth</button>{/if}
        {#if vias.sistema}<button onclick={() => agregarDelDispositivo("sistema")}>Impresora del sistema (AirPrint)</button>{/if}
      </div>
      {#if !vias.usb && !vias.serial && !vias.bluetooth}
        <p class="nota aviso">
          Este navegador solo puede imprimir con el cuadro de imprimir del sistema: en iPad y iPhone, Safari no
          deja usar impresoras USB ni Bluetooth, ni abrir el cajón. En una computadora o un Android, usa Chrome.
        </p>
      {/if}
      {#if errorDispositivo}<p class="nota aviso">{errorDispositivo}</p>{/if}
    </section>
  {:else}
    <p class="nota aviso">
      Esta terminal <b>no puede imprimir en papel</b>: solo la caja —el equipo
      donde corre MotRest— habla con las impresoras. Aquí los trabajos se
      generan y se previsualizan, y quedan marcados como «sin papel».
    </p>
  {/if}

  {#each impresion.impresoras as imp (imp.id)}
    <section class="tarjeta" class:inactiva={!imp.activa}>
      {#if imp.id === recienAgregada}<span use:revelar={imp.id}></span>{/if}
      <div class="cab">
        <b>{imp.nombre}</b>
        <span class="tipo">
          {#if imp.conexion === "dispositivo"}
            {imp.equipo === ESTE_EQUIPO ? "este dispositivo" : "otro dispositivo"} · {imp.navegador}
          {:else}
            {imp.conexion}
          {/if}
          · {imp.ancho} col
        </span>
        <span class="sp"></span>
        {#if puedeEditar}
          <button onclick={() => impresion.prueba(imp.id)}>Página de prueba</button>
          <button onclick={() => impresion.pruebaQr(imp.id)}>Probar QR</button>
          <button onclick={() => impresion.actualizar(imp.id, { activa: !imp.activa })}>
            {imp.activa ? "Desactivar" : "Activar"}
          </button>
          <button class="peligro" onclick={() => impresion.eliminar(imp.id)}>Eliminar</button>
        {/if}
      </div>

      {#if puedeEditar}
        <div class="campos">
          <label>
            <span>Nombre</span>
            <input
              value={imp.nombre}
              oninput={(e) => impresion.actualizar(imp.id, { nombre: e.currentTarget.value })}
            />
          </label>
          <label>
            <span>Conexión</span>
            <select
              value={imp.conexion}
              onchange={(e) =>
                impresion.actualizar(imp.id, { conexion: e.currentTarget.value as never })}
            >
              <option value="red">Red (9100)</option>
              <option value="usb">USB</option>
              <option value="bluetooth">Bluetooth</option>
              {#if imp.conexion === "dispositivo"}
                <option value="dispositivo">Conectada al dispositivo</option>
              {/if}
            </select>
          </label>
          {#if imp.conexion === "red"}
            <label>
              <span>Dirección</span>
              <input
                value={imp.host ?? ""}
                oninput={(e) => impresion.actualizar(imp.id, { host: e.currentTarget.value })}
                placeholder="192.168.1.60"
              />
            </label>
            <label class="angosto">
              <span>Puerto</span>
              <input
                type="number"
                value={imp.puerto ?? 9100}
                oninput={(e) => impresion.actualizar(imp.id, { puerto: Number(e.currentTarget.value) })}
              />
            </label>
          {:else if imp.conexion === "usb"}
            <!--
              El nombre tiene que coincidir letra por letra con el de Windows,
              así que se elige de una lista en vez de teclearse. Si el Hub no
              pudo dar la lista, queda el campo libre como salida.
            -->
            <label class="ancho">
              <span>Impresora de Windows</span>
              {#if impresion.impresorasSistema.length > 0}
                <select
                  value={imp.dispositivo ?? ""}
                  onchange={(e) =>
                    impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                >
                  <option value="">— Elige una —</option>
                  {#each impresion.impresorasSistema as sis (sis.nombre)}
                    <option value={sis.nombre}>
                      {sis.nombre}{sis.puerto ? ` · ${sis.puerto}` : ""}
                    </option>
                  {/each}
                </select>
              {:else}
                <input
                  value={imp.dispositivo ?? ""}
                  oninput={(e) => impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                  placeholder="BIXOLON SRP-350plus"
                />
              {/if}
            </label>
          {:else if imp.conexion === "bluetooth"}
            <!--
              Igual que en USB: se elige de una lista, porque acertar el puerto a
              ciegas no es razonable. Un equipo con varios aparatos emparejados
              tiene varios COM y todos se llaman igual en Windows; el nombre del
              aparato es lo único que distingue la impresora de unas bocinas.
              Sin búsqueda previa no hay lista, y queda el campo libre.
            -->
            <label class="ancho">
              <span>Impresora Bluetooth</span>
              {#if impresion.puertosBluetooth.length > 0}
                <select
                  value={imp.dispositivo ?? ""}
                  onchange={(e) =>
                    impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                >
                  <option value="">— Elige una —</option>
                  {#each impresion.puertosBluetooth as bt (bt.puerto)}
                    <option value={bt.puerto}>{bt.nombre} · {bt.puerto}</option>
                  {/each}
                </select>
              {:else}
                <input
                  value={imp.dispositivo ?? ""}
                  oninput={(e) => impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                  placeholder="COM4"
                />
                <small class="pista">
                  Pulsa «Detectar y conectar» arriba y aquí saldrán las impresoras
                  emparejadas, con su nombre.
                </small>
              {/if}
            </label>
          {/if}
          <label class="angosto">
            <span>Ancho</span>
            <select
              value={String(imp.ancho)}
              onchange={(e) =>
                impresion.actualizar(imp.id, { ancho: Number(e.currentTarget.value) as 32 | 42 })}
            >
              <option value="32">58 mm (32)</option>
              <option value="42">80 mm (42)</option>
            </select>
          </label>
          <label>
            <span>Modo de código QR</span>
            <select
              value={imp.modo_qr ?? "nativo"}
              onchange={(e) => impresion.actualizar(imp.id, {
                modo_qr: e.currentTarget.value as "nativo" | "imagen",
              })}
            >
              <option value="nativo">Normal de la impresora</option>
              <option value="imagen">Dibujado como imagen</option>
            </select>
          </label>
        </div>
      {/if}


      <!--
        EL CAJÓN DE EFECTIVO.

        Solo se ofrece en la impresora de caja, porque el cajón cuelga de ella:
        no está conectado a la computadora sino a la impresora, por un cable
        telefónico. Ofrecerlo en la de cocina invitaría a conectar algo que no
        existe en ese sitio.

        Se puede apagar: hay locales con impresora de caja y sin cajón, y hay
        cajones que el dueño prefiere abrir con llave.
      -->
      {#if imp.areas.includes("caja")}
        <div class="cajon">
          <label class="check-cajon">
            <input
              type="checkbox"
              checked={imp.cajon}
              disabled={!puedeEditar}
              onchange={(e) => puedeEditar && impresion.actualizar(imp.id, { cajon: e.currentTarget.checked })}
            />
            <span>Tiene un cajón de efectivo conectado</span>
          </label>
          {#if imp.cajon}
            <p class="pista-cajon">
              Se abre solo al cobrar <b>en efectivo</b>, al registrar un retiro o
              ingreso, al cerrar el turno y al devolver dinero por una venta
              cancelada. Con tarjeta o transferencia no se abre: no hay billetes
              que guardar.
            </p>
            {#if puedeEditar}
              <button class="probar-cajon" onclick={() => impresion.abrirCajon("Prueba")}>
                Probar: abrir ahora
              </button>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="areas">
        <span class="etiqueta">Imprime para:</span>
        {#each areas as area (area.id)}
          <button
            class="area"
            class:on={imp.areas.includes(area.id)}
            onclick={() => puedeEditar && alternarArea(imp.id, area.id)}
            disabled={!puedeEditar}
          >
            {area.nombre}
          </button>
        {/each}
      </div>
    </section>
  {/each}

  <!-- Cola -->
  <section class="tarjeta">
    <h2>Cola de impresión</h2>
    {#if impresion.trabajos.length === 0}
      <p class="vacio">Sin trabajos. Aparecen al enviar a cocina o al cobrar.</p>
    {:else}
      <div class="cola">
        {#each impresion.trabajos.slice(-15).reverse() as t (t.id)}
          <div class="trabajo {t.estado}" class:simulado={t.simulado}>
            <span class="h">{hora(t.creado_ts)}</span>
            <span class="doc">{t.documento}</span>
            <span class="imp">
              {impresion.impresoras.find((i) => i.id === t.impresora_id)?.nombre ?? t.impresora_id}
            </span>
            <!--
              Un trabajo simulado NO se anuncia como impreso. Decir «impreso» de
              algo que nunca salió es el peor fallo posible aquí: la cocina no
              recibe la comanda y nadie se entera hasta que reclama la mesa.
            -->
            <span class="est">{t.simulado && t.estado === "impreso" ? "sin papel" : t.estado}</span>
            {#if t.simulado && t.estado === "impreso"}
              <span class="err">Solo vista previa: esta terminal no imprime</span>
            {/if}
            {#if t.ultimo_error}<span class="err">{t.ultimo_error}</span>{/if}
            <span class="sp"></span>
            <button onclick={() => (impresion.vistaPrevia = { titulo: t.documento, texto: t.vista })}>
              Ver
            </button>
            {#if t.estado === "fallido"}
              <button onclick={() => impresion.reintentar(t.id)}>Reintentar</button>
              <button class="peligro" onclick={() => impresion.descartar(t.id)}>Descartar</button>
            {/if}
          </div>
        {/each}
      </div>
      <button class="limpiar" onclick={() => impresion.limpiar()}>Limpiar los impresos</button>
    {/if}
  </section>
</div>

<!-- Vista previa: el papel que no se gastó -->
{#if impresion.vistaPrevia}
  <div class="velo" role="presentation" onclick={() => impresion.cerrarVista()}></div>
  <div class="previa" role="dialog" aria-label="Vista previa de impresión">
    <header>
      <b>{impresion.vistaPrevia.titulo}</b>
      <button onclick={() => impresion.cerrarVista()} aria-label="Cerrar">✕</button>
    </header>
    <pre>{impresion.vistaPrevia.texto}</pre>
  </div>
{/if}

<style>
  /* --- Cajón de efectivo --- */
  .cajon {
    margin-top: 0.7rem;
    padding: 0.7rem 0.85rem;
    background: #faf9f8;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .check-cajon {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .check-cajon input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--acento);
  }
  .pista-cajon {
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--gris);
  }
  .probar-cajon {
    align-self: flex-start;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 64rem;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 36rem;
    line-height: 1.5;
  }
  .alta {
    display: flex;
    gap: 0.4rem;
    max-width: 28rem;
  }

  /* --- Detectar y conectar --- */

  .detectar {
    border-color: var(--acento);
  }
  .explica {
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.55;
  }
  .buscando {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--acento-texto);
  }
  .error {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .hallazgo {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  /* La que ya está puesta se apaga: lo que importa son las que faltan. */
  .hallazgo.puesta {
    background: var(--fondo);
  }
  .fila-hallazgo {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .fila-hallazgo.tenue {
    opacity: 0.6;
    padding: 0.35rem 0;
  }
  .icono {
    font-size: 1.15rem;
  }
  .quien {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .quien b {
    font-size: 0.95rem;
  }
  .quien small {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .pista {
    font-size: 0.76rem;
    color: var(--gris);
    margin-top: 0.3rem;
  }
  .ya {
    font-size: 0.76rem;
    font-weight: 600;
    color: #3f5c31;
    background: #eef3ea;
    border-radius: var(--r-pill);
    padding: 0.15rem 0.65rem;
  }
  .config-hallazgo {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--borde);
  }
  .nombre-hallazgo {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-width: 18rem;
  }
  .nombre-hallazgo span {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
  }
  .config-hallazgo .principal {
    align-self: flex-start;
  }
  .falta {
    font-size: 0.76rem;
    color: var(--gris);
    font-style: italic;
  }
  .mas {
    align-self: flex-start;
    border: none;
    padding: 0.2rem 0;
    font-size: 0.8rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .mas:hover {
    color: var(--acento-texto);
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.84rem;
    color: var(--gris);
    line-height: 1.55;
  }
  /* Que esta terminal no imprima es una limitación real, no una nota al pie. */
  .nota.aviso {
    background: #fdf0e6;
    border-color: var(--acento);
    color: #7a4a1e;
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  /* Se queda: apaga la tarjeta de una impresora deshabilitada. No toca fondo
     ni borde, así que no pisa nada de base.css. */
  .tarjeta.inactiva {
    opacity: 0.55;
  }
  /*
   * Los campos a la izquierda y el papel a la derecha: se escribe una frase y se
   * ve caer en el ticket sin desplazar la pantalla. En una tablet en vertical se
   * apila, con el papel debajo.
   */
  .editor-ticket {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 1100px) {
    .editor-ticket {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  /*
   * El fondo gris no es decoración: el papel es blanco y la tarjeta también, así
   * que sin él la vista previa se leía como un bloque de texto suelto en la
   * pantalla y no como un ticket.
   */
  .previa-ticket {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.9rem;
    border-radius: var(--r-md);
    background: var(--fondo);
    border: 1px solid var(--borde);
    /* Se queda a la vista mientras se recorre una lista larga de campos. */
    position: sticky;
    top: 0.5rem;
  }
  .cab-previa {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .cab-previa b {
    font-family: var(--font-titulo);
    font-size: 0.95rem;
  }
  .cab-previa span,
  .pie-previa {
    font-size: 0.72rem;
    color: var(--gris);
    line-height: 1.4;
    overflow-wrap: anywhere;
    max-width: 22rem;
  }
  /* --- El logo --------------------------------------------------------------- */
  .logo {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.8rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
  }
  .rotulo-logo {
    font-size: 0.85rem;
  }
  .rotulo-logo em {
    font-weight: 400;
    color: var(--gris);
    font-style: normal;
  }
  .logo-fila {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .logo-muestra {
    width: 8rem;
    max-height: 5rem;
    object-fit: contain;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem;
  }
  .logo-vacio {
    display: grid;
    place-items: center;
    width: 8rem;
    height: 3.5rem;
    border: 1px dashed var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.78rem;
    color: var(--gris);
  }
  .logo-mandos {
    flex: 1;
    min-width: 14rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .logo-botones {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .intensidad {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
  }
  .intensidad input {
    width: 100%;
    accent-color: var(--acento);
  }
  .intensidad em,
  .ayuda-logo {
    font-style: normal;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--gris);
  }
  .oculto {
    display: none;
  }
  .cab {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .cab b {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
  }
  .tipo {
    font-size: 0.76rem;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.6rem;
  }
  .sp {
    flex: 1;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
  }
  button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.7rem;
    font-size: 0.79rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  button:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  button.peligro:hover:not(:disabled) {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  button:disabled {
    opacity: 0.5;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .campos label {
    flex: 1;
    min-width: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .campos label.angosto {
    flex: 0 0 8rem;
  }
  /* El nombre de una impresora de Windows es largo y no debe recortarse. */
  .campos label.ancho {
    flex: 1 0 18rem;
  }
  .pendiente {
    flex: 1 0 100%;
    font-size: 0.8rem;
    color: var(--peligro);
    line-height: 1.5;
  }
  .campos span {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.45rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.86rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .areas {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .etiqueta {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
    margin-right: 0.3rem;
  }
  .area {
    border-radius: var(--r-pill);
    padding: 0.25rem 0.75rem;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .area.on:hover:not(:disabled) {
    color: #fff;
  }
  .cola {
    display: flex;
    flex-direction: column;
  }
  .trabajo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.82rem;
    flex-wrap: wrap;
  }
  .trabajo .h {
    font-family: var(--font-titulo);
    font-size: 0.76rem;
    color: var(--gris);
    width: 3rem;
  }
  .trabajo .doc {
    font-weight: 600;
    min-width: 5rem;
  }
  .trabajo .imp {
    color: var(--gris);
    min-width: 5rem;
  }
  .trabajo .est {
    font-size: 0.74rem;
    font-weight: 600;
    border-radius: var(--r-pill);
    padding: 0.05rem 0.55rem;
    background: var(--fondo);
    color: var(--gris);
  }
  .trabajo.impreso .est {
    color: #3f5c31;
  }
  /*
   * Simulado gana al verde de «impreso»: si el papel no salió, la fila no puede
   * leerse como un éxito de un vistazo.
   */
  .trabajo.simulado .est {
    background: #fdf0e6;
    color: var(--acento-texto);
  }
  .trabajo.simulado .err {
    color: var(--acento-texto);
  }
  .trabajo.fallido .est {
    background: #fdeae8;
    color: var(--peligro);
  }
  .trabajo .err {
    font-size: 0.76rem;
    color: var(--peligro);
  }
  .limpiar {
    align-self: flex-start;
    margin-top: 0.5rem;
  }
  .vacio {
    font-size: 0.86rem;
    color: var(--gris);
    font-style: italic;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.5);
    z-index: 48;
  }
  .previa {
    position: fixed;
    z-index: 49;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-lg);
    box-shadow: var(--sombra-lg);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }
  .previa header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--borde);
  }
  .previa header b {
    flex: 1;
    font-family: var(--font-titulo);
  }
  /* Monoespaciada y con el papel simulado: así se ve la alineación real. */
  .previa pre {
    overflow: auto;
    padding: 1.25rem;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre;
    background: #faf9f7;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
    padding: 0.45rem 1rem;
  }
  .principal:hover:not(:disabled) {
    color: #fff;
  }

  /*
   * 14rem y no 15: con la vista previa ocupando su columna, a los campos les
   * quedan unos 490 px y dos columnas de 15rem piden 492. Por dos píxeles, la
   * ficha entera caía a una sola columna y la pantalla se volvía el doble de
   * larga.
   */
  .ficha {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem;
    margin: 0.8rem 0;
  }
  .ficha .ancho { grid-column: 1 / -1; }
  .ficha label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .ficha em { font-weight: 400; color: var(--gris); font-style: normal; }
  /* El interruptor va en fila, no en columna como los campos de texto. */
  .ficha .interruptor {
    flex-direction: row;
    align-items: center;
    gap: 0.55rem;
    cursor: pointer;
  }
  .ficha .interruptor input {
    width: 1.05rem;
    height: 1.05rem;
    padding: 0;
    accent-color: var(--acento);
    cursor: pointer;
  }
  .ficha .interruptor em { display: block; font-size: 0.72rem; }
  .ficha input,
  .ficha textarea {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
  }
  .ficha textarea {
    resize: vertical;
    line-height: 1.4;
  }
</style>
