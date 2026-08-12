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
  import { menu } from "../../menu.svelte";
  import { hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";
  import { local } from "../../local.svelte";

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

  /** Identidad estable de una encontrada: el dispositivo, o la dirección. */
  function claveDe(d: ImpresoraDetectada): string {
    return d.origen === "usb" ? `usb:${d.dispositivo}` : `red:${d.host}:${d.puerto}`;
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

    <div class="ficha">
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
      <label class="ancho">
        Invitación a dejar reseña <em>(va sobre el código QR)</em>
        <input
          value={local.textosTicket.invitacion_opinion}
          oninput={(e) => local.fijarTextosTicket({ invitacion_opinion: e.currentTarget.value })}
        />
      </label>
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
    </div>
    <p class="ayuda">
      Debajo de todo siempre sale <b>MotRest by Motrae</b>. Eso no se cambia: es
      la firma de quién hizo el software, no un mensaje del restaurante.
    </p>
  </section>

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
                <span class="icono" aria-hidden="true">{d.origen === "usb" ? "🔌" : "📶"}</span>
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
  {:else}
    <p class="nota aviso">
      Esta terminal <b>no puede imprimir en papel</b>: solo la caja —el equipo
      donde corre MotRest— habla con las impresoras. Aquí los trabajos se
      generan y se previsualizan, y quedan marcados como «sin papel».
    </p>
  {/if}

  {#each impresion.impresoras as imp (imp.id)}
    <section class="tarjeta" class:inactiva={!imp.activa}>
      <div class="cab">
        <b>{imp.nombre}</b>
        <span class="tipo">{imp.conexion} · {imp.ancho} col</span>
        <span class="sp"></span>
        {#if puedeEditar}
          <button onclick={() => impresion.prueba(imp.id)}>Página de prueba</button>
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
          {:else}
            <p class="pendiente">
              La conexión Bluetooth todavía no está implementada: los trabajos se
              previsualizan pero no salen en papel. Usa red o USB.
            </p>
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
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 64rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
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
    color: var(--acento);
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
    color: var(--acento);
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
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .tarjeta.inactiva {
    opacity: 0.55;
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
    color: var(--acento);
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
    color: #fff;
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
    color: var(--acento);
  }
  .trabajo.simulado .err {
    color: var(--acento);
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
    color: #fff;
    padding: 0.45rem 1rem;
  }
  .principal:hover:not(:disabled) {
    color: #fff;
  }

  .ficha {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
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
  .ficha input {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 400;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
  }
</style>
