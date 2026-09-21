<script lang="ts">
  /**
   * M7 · Clientes: la ficha del comensal.
   *
   * En F1 es básica a propósito —lealtad, reservas y CRM 360° son F3—, pero
   * resuelve dos fricciones reales: facturar sin volver a dictar el RFC, y tener
   * a dónde mandar un domicilio. Los datos fiscales que se capturan aquí son los
   * mismos que pide el CFDI, así que prellenan el diálogo de factura tal cual.
   */
  import { untrack } from "svelte";
  import {
    REGIMENES_FISCALES,
    USOS_CFDI,
    correoPlausible,
    definicionCorreo,
    problemaRfc,
    type Cliente,
    type DatosCliente,
    type DatosReceptor,
    type Domicilio,
    type ID,
    type Reserva,
    type TipoCorreo,
  } from "@motrest/dominio";
  import { clientes } from "../clientes.svelte";
  import { borrador } from "./clientes/borrador-de-reserva.svelte";
  import { correo as correos, type SolicitudCorreo } from "../correo.svelte";
  import {
    cuandoDeReserva,
    datosDelCorreo,
    esDeReserva,
    opcionesDeCorreo,
    reservaProximaDe,
  } from "../correos-del-comensal";
  import EnvioCorreo from "../EnvioCorreo.svelte";
  import Ordenar from "../listas/Ordenar.svelte";
  import VerMas from "../listas/VerMas.svelte";
  import { Paginado, ordenRecordado, ordenar, ordenesComunes } from "../listas/listas.svelte";
  import { rutas } from "../nav/rutas.svelte";
  import { reservas } from "../reservas.svelte";
  import { sesion } from "../sesion/sesion.svelte";
  import { subirAlPrincipio } from "../subir";

  const puedeEditar = $derived(sesion.puedeOperar("crm.cliente.editar"));

  let termino = $state("");

  /*
   * «ORDENAR» Y «VER MÁS» EN LAS FICHAS (1.5.6, pedido de Gonzalo).
   *
   * Las fichas crecen con cada comensal que deja su RFC o su domicilio, y se
   * pintaban todas: con trescientas, llegar al final de la página era un viaje.
   * Ahora se ven 10 y el resto a petición —el buscador sigue siendo el camino
   * corto para dar con alguien—, y se pueden ordenar por nombre o por cuándo se
   * dio de alta la ficha. El orden de siempre, de la A a la Z, es el de
   * entrada. Cambia solo la vista de esta terminal.
   */
  const opcionesFichas = ordenesComunes<Cliente>({
    nombre: (c) => c.nombre,
    fecha: (c) => c.registrado_ts,
  });
  let ordenFichas = $state(ordenRecordado("clientes.fichas", "az"));
  const lista = $derived(
    ordenar(clientes.buscar(termino), opcionesFichas.find((o) => o.id === ordenFichas)),
  );
  const pagFichas = new Paginado();

  let error = $state("");

  // --- Formulario (alta o edición) ---
  let editando = $state<Cliente | null>(null);
  let creando = $state(false);
  let conFiscal = $state(false);
  let conDomicilio = $state(false);

  let nombre = $state("");
  let telefono = $state("");
  let correo = $state("");
  let notas = $state("");
  /** «Acepta recibir promociones por correo». Sin esto no le llega ni un cupón. */
  let aceptaPromos = $state(false);
  let fiscal = $state<DatosReceptor>({
    rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03",
  });
  let dom = $state<Domicilio>({ calle: "", numero: "", colonia: "", codigo_postal: "", ciudad: "", referencias: "" });

  const abierto = $derived(creando || editando !== null);

  function nuevo() {
    editando = null;
    creando = true;
    conFiscal = false;
    conDomicilio = false;
    nombre = ""; telefono = ""; correo = ""; notas = "";
    aceptaPromos = false;
    fiscal = { rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03" };
    dom = { calle: "", numero: "", colonia: "", codigo_postal: "", ciudad: "", referencias: "" };
    error = "";
  }

  function abrirEdicion(c: Cliente) {
    creando = false;
    editando = c;
    conFiscal = !!c.fiscal;
    conDomicilio = !!c.domicilio;
    nombre = c.nombre;
    telefono = c.telefono ?? "";
    correo = c.correo ?? "";
    notas = c.notas ?? "";
    aceptaPromos = !!c.acepta_promociones;
    fiscal = c.fiscal
      ? { ...c.fiscal }
      : { rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03" };
    dom = {
      calle: c.domicilio?.calle ?? "",
      numero: c.domicilio?.numero ?? "",
      colonia: c.domicilio?.colonia ?? "",
      codigo_postal: c.domicilio?.codigo_postal ?? "",
      ciudad: c.domicilio?.ciudad ?? "",
      referencias: c.domicilio?.referencias ?? "",
    };
    error = "";
  }

  function cerrar() {
    creando = false;
    editando = null;
    error = "";
  }

  // --- El viaje desde Reservas, y la vuelta ---

  /*
   * «+ NUEVO CLIENTE» EN RESERVAS TRAE HASTA AQUÍ, Y ESTO DEVUELVE ALLÁ.
   *
   * Gonzalo lo pidió con estas palabras: «que al darle clic en nuevo cliente,
   * automáticamente los lleve a la ventana de agregar comensal que está en el
   * módulo de ficha del comensal, y que al darle guardar, automáticamente los
   * regrese al módulo de reservas y espera, a donde ya estaban anteriormente».
   *
   * El viaje se hace con la RUTA —`#/clientes/clientes?nuevo=1&volver=reservas`—
   * y no con un diálogo flotante sobre Reservas, para que el alta sea la de
   * verdad: la misma que pide el domicilio, los datos fiscales y el permiso de
   * publicidad. Un alta recortada «para la puerta» es como se acaba con fichas
   * de dos calidades distintas.
   *
   * Lo tecleado en la reserva no viaja por la ruta sino por el borrador del
   * módulo (`borrador-de-reserva.svelte.ts`), que sobrevive al cambio de
   * pantalla.
   */
  let volviendoAReservas = $state(false);

  function atenderLaRuta(params: Record<string, string>) {
    if (params.nuevo === "1" && puedeEditar) {
      nuevo();
      volviendoAReservas = params.volver === "reservas";
      /*
       * Si alguien recargó la aplicación con esta dirección en la barra, el
       * borrador está recién nacido y nadie está esperando una ficha. La ruta
       * dice de dónde se venía, así que se repara la intención en vez de
       * guardar el cliente y dejarlo colgado en una pantalla que ya no sabe
       * para qué lo pidió.
       */
      if (volviendoAReservas && borrador.esperandoFicha === null) borrador.pedirFicha("reserva");
      const tecleado = borrador.loTecleado();
      nombre = tecleado.nombre;
      telefono = tecleado.telefono;
      correo = tecleado.correo;
      return;
    }

    /* El camino contrario: un nombre de Reservas que lleva a su ficha. */
    const c = params.ficha ? clientes.porId(params.ficha) : undefined;
    if (!c) return;
    if (puedeEditar) abrirEdicion(c);
    /* Quien solo consulta no abre el editor: se le deja la ficha a la vista. */
    else termino = c.nombre;
  }

  /*
   * Solo la RUTA dispara esto. Lo de dentro va en `untrack` a propósito: lee la
   * lista de clientes y el permiso, y sin eso el efecto volvería a correr cada
   * vez que se guardara una ficha —reabriendo el editor encima de lo que se
   * estuviera escribiendo—.
   */
  $effect(() => {
    const params = rutas.actual.params;
    untrack(() => atenderLaRuta(params));
  });

  /** Cerrar el alta a la que se llegó desde Reservas devuelve a Reservas. */
  function cerrarOVolver() {
    if (!volviendoAReservas) {
      cerrar();
      return;
    }
    /* Se cancela el viaje, no el borrador: lo tecleado en la reserva sigue ahí. */
    volviendoAReservas = false;
    borrador.cancelarViaje();
    cerrar();
    rutas.ir("clientes", "reservas");
  }

  /**
   * Apartar mesa para este comensal: la reserva nace ligada a su ficha.
   *
   * Es la otra mitad de lo que pidió Gonzalo. Antes solo se podía ir de la
   * reserva a la ficha; desde su ficha —donde se ve que viene cada quince días
   * y que gasta lo que gasta— no había manera de apartarle mesa.
   */
  function apartarMesaPara(c: Cliente) {
    borrador.apartarPara({
      cliente_id: c.cliente_id,
      nombre: c.nombre,
      telefono: c.telefono,
      correo: c.correo,
    });
    cerrar();
    rutas.ir("clientes", "reservas");
  }

  /** Cómo quedó una reserva, en palabras de la puerta. */
  function comoQuedoLaReserva(r: Reserva): { texto: string; tono: "bien" | "mal" | "espera" } {
    if (r.estado === "sentada") return { texto: "Vino", tono: "bien" };
    if (r.estado === "apartada") return { texto: "Mesa apartada", tono: "espera" };
    if (r.estado === "solicitada") return { texto: "Pidió mesa, falta confirmar", tono: "espera" };
    if (r.estado === "no_llego") return { texto: "No llegó", tono: "mal" };
    return { texto: `Cancelada: ${r.motivo_cancelacion ?? "sin motivo"}`, tono: "mal" };
  }

  function armar(): DatosCliente | null {
    error = "";
    if (nombre.trim().length < 2) { error = "Escribe el nombre del cliente"; return null; }

    let datosFiscal: DatosReceptor | undefined;
    if (conFiscal) {
      const malRfc = problemaRfc(fiscal.rfc);
      if (malRfc) { error = malRfc; return null; }
      if (fiscal.nombre.trim().length < 3) { error = "La razón social debe coincidir con la constancia"; return null; }
      if (!/^\d{5}$/.test(fiscal.codigo_postal.trim())) { error = "El código postal fiscal debe tener cinco dígitos"; return null; }
      datosFiscal = {
        ...fiscal,
        rfc: fiscal.rfc.trim().toUpperCase(),
        nombre: fiscal.nombre.trim(),
        codigo_postal: fiscal.codigo_postal.trim(),
      };
    }

    let domicilio: Domicilio | undefined;
    if (conDomicilio) {
      if (dom.calle.trim().length < 3) { error = "Escribe al menos la calle del domicilio"; return null; }
      domicilio = Object.fromEntries(
        Object.entries(dom).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""),
      ) as unknown as Domicilio;
    }

    /*
     * EL PERMISO LLEVA SU FECHA. Ante una queja, «sí aceptó» sin fecha no
     * demuestra nada. La fecha es la de cuando se MARCÓ: guardar la ficha otra
     * vez por un cambio de teléfono no la mueve, porque el comensal no volvió a
     * aceptar nada ese día.
     *
     * Al desmarcar se manda `false` explícito y no se omite el campo: un campo
     * ausente no cambia nada al fusionar la ficha, y la baja de un comensal que
     * respondió BAJA no puede depender de eso.
     */
    const yaAceptaba = !!editando?.acepta_promociones && !!editando.acepta_promociones_ts;
    const promociones: Pick<DatosCliente, "acepta_promociones" | "acepta_promociones_ts"> =
      aceptaPromos
        ? {
            acepta_promociones: true,
            acepta_promociones_ts: yaAceptaba ? editando!.acepta_promociones_ts : Date.now(),
          }
        : { acepta_promociones: false };

    return {
      nombre: nombre.trim(),
      telefono,
      correo,
      notas,
      fiscal: datosFiscal,
      domicilio,
      ...promociones,
    };
  }

  function guardar() {
    const datos = armar();
    if (!datos) return;
    const r = editando
      ? clientes.actualizar(editando.cliente_id, {
          ...datos,
          // Si se apagó la sección, se manda undefined para limpiarla.
          fiscal: conFiscal ? datos.fiscal : undefined,
          domicilio: conDomicilio ? datos.domicilio : undefined,
        })
      : clientes.registrar(datos);
    if (!r.ok) { error = r.error ?? "No se pudo guardar"; return; }

    /*
     * La ficha recién creada vuelve al formulario de Reservas que la pidió, con
     * el cliente ya puesto y sin que se haya perdido lo que se llevaba tecleado.
     */
    if (!editando && volviendoAReservas && r.id) {
      borrador.recibirFicha({
        cliente_id: r.id,
        nombre: datos.nombre,
        telefono: datos.telefono,
        correo: datos.correo,
      });
      volviendoAReservas = false;
      cerrar();
      rutas.ir("clientes", "reservas");
      return;
    }

    cerrar();
  }

  function darDeBaja(c: Cliente) {
    const motivo = prompt(`¿Dar de baja a ${c.nombre}? Se conserva su historial. Motivo (opcional):`);
    if (motivo === null) return;
    clientes.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    clientes.desactivar(c.cliente_id, motivo || undefined);
  }

  function domicilioTexto(d: Domicilio): string {
    return [d.calle && `${d.calle}${d.numero ? " " + d.numero : ""}`, d.colonia, d.ciudad]
      .filter(Boolean)
      .join(", ");
  }

  $effect(() => {
    const u = sesion.usuarioActual;
    if (u) {
      clientes.actuarComo(u.id);
      correos.actuarComo(u.id);
    }
  });

  // --- Correos al comensal ---

  /*
   * El reloj de esta pantalla: decide qué reserva es «próxima» y cuándo una
   * petición lleva demasiado sin respuesta. Cada 15 s basta; nadie mira esto
   * con cronómetro.
   */
  let ahora = $state(Date.now());
  $effect(() => {
    const reloj = setInterval(() => (ahora = Date.now()), 15_000);
    return () => clearInterval(reloj);
  });

  /** A quién se le está mandando. Se guarda el id: la ficha puede cambiar mientras. */
  let paraId = $state<ID | null>(null);
  let elegido = $state<TipoCorreo | null>(null);

  const destinatario = $derived(
    paraId ? clientes.clientes.find((c) => c.cliente_id === paraId) : undefined,
  );
  const reservaProxima = $derived(
    destinatario ? reservaProximaDe(destinatario, reservas.reservas, ahora) : undefined,
  );
  const recordatorioPrevio = $derived(
    reservaProxima && destinatario
      ? correos.recordatorioDe(cuandoDeReserva(reservaProxima.para_ts), [
          destinatario.correo,
          reservaProxima.correo,
        ])
      : undefined,
  );
  const opciones = $derived(
    destinatario
      ? opcionesDeCorreo(correos.config, {
          correo: destinatario.correo,
          aceptaPromociones: !!destinatario.acepta_promociones,
          reserva: reservaProxima,
          recordatorioPedido: !!recordatorioPrevio && recordatorioPrevio.estado !== "rechazado",
          ahora,
        })
      : [],
  );
  const datosElegido = $derived(
    elegido && destinatario
      ? datosDelCorreo(elegido, { nombre: destinatario.nombre, reserva: reservaProxima })
      : {},
  );

  function abrirCorreo(c: Cliente) {
    paraId = c.cliente_id;
    elegido = null;
  }

  /*
   * EL CORREO ELEGIDO SE ABRE DESDE ARRIBA DEL DIÁLOGO.
   *
   * La lista de los seis correos, más los últimos enviados, no cabe entera en
   * la pantalla de la caja, y los dos que piden escribir un mensaje —el cupón y
   * «te extrañamos»— son justo los últimos. Al elegir uno, su vista previa
   * sustituía a la lista pero el diálogo se quedaba desplazado: se aterrizaba a
   * media vista previa, con el campo del mensaje —que es obligatorio— fuera de
   * cuadro. Y al volver a la lista desde el pie de la vista previa, lo mismo al
   * revés. Ver `subir.ts`.
   */
  let panelCorreo = $state<HTMLDivElement | null>(null);

  function elegirCorreo(tipo: TipoCorreo | null) {
    elegido = tipo;
    subirAlPrincipio(panelCorreo);
  }

  function cerrarCorreo() {
    paraId = null;
    elegido = null;
  }

  function irAConfigurar() {
    cerrarCorreo();
    rutas.ir("clientes", "correos");
  }

  function fecha(ts: number): string {
    return new Date(ts).toLocaleString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function etiquetaCorreo(tipo: TipoCorreo): string {
    // Con la configuración: los correos que creó el restaurante tienen su
    // propio nombre, y uno ya borrado se dice así en vez de enseñar su id.
    return definicionCorreo(tipo, correos.config)?.etiqueta ?? tipo;
  }

  /**
   * Cómo quedó, en palabras. «Pendiente» a secas no le dice nada a nadie; que
   * el Hub no ha contestado en un minuto, sí: es la diferencia entre «ya se
   * mandó» y «creo que se mandó».
   */
  function comoQuedo(s: SolicitudCorreo): { texto: string; tono: "bien" | "mal" | "espera" } {
    if (s.estado === "enviado") return { texto: "Enviado", tono: "bien" };
    if (s.estado === "rechazado") {
      return { texto: `No se mandó: ${s.motivo ?? "el Hub no dijo por qué"}`, tono: "mal" };
    }
    return ahora - s.pedido_ts > 60_000
      ? { texto: "El Hub todavía no lo ha visto", tono: "espera" }
      : { texto: "Enviando…", tono: "espera" };
  }
</script>

<!--
  Los últimos correos de un comensal y cómo acabaron. Se enseña en su ficha y
  en el panel de mandar, para que nadie mande dos veces lo que ya salió.
-->
{#snippet ultimosCorreos(clienteId: ID)}
  {@const suyos = correos.ultimosDe(clienteId).slice(0, 5)}
  <div class="ultimos">
    <h3>Últimos correos</h3>
    {#if suyos.length === 0}
      <p class="vacio">Todavía no se le ha mandado ninguno.</p>
    {:else}
      <ul>
        {#each suyos as s (s.solicitud_id)}
          {@const quedo = comoQuedo(s)}
          <li>
            <span class="que">{etiquetaCorreo(s.clase_correo)}</span>
            <span class="cuando">{fecha(s.pedido_ts)}</span>
            <span class="quedo {quedo.tono}">{quedo.texto}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<!--
  SUS RESERVAS, EN SU FICHA.
  Desde la 1.5.6 una reserva apartada en la caja queda ligada a la ficha, así
  que aquí se puede ver de una vez quién viene, quién vino y quién dejó la mesa
  puesta. Y se aparta mesa desde aquí mismo: es el camino contrario del que ya
  existía, y el que faltaba.
-->
{#snippet susReservas(c: Cliente)}
  {@const suyas = reservas.deCliente(c.cliente_id, c.telefono)}
  <div class="ultimos">
    <h3>Sus reservas</h3>
    {#if suyas.length === 0}
      <p class="vacio">Todavía no ha apartado mesa.</p>
    {:else}
      <ul>
        {#each suyas.slice(0, 5) as r (r.id)}
          {@const quedo = comoQuedoLaReserva(r)}
          <li>
            <span class="que">{fecha(r.para_ts)}</span>
            <span class="cuando">
              {r.personas}
              {r.personas === 1 ? "persona" : "personas"}
            </span>
            <span class="quedo {quedo.tono}">{quedo.texto}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <button class="mini apartar" onclick={() => apartarMesaPara(c)}>Apartar mesa</button>
  </div>
{/snippet}

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Clientes</h1>
      <p class="sub">
        La ficha del comensal. Sus datos fiscales prellenan la factura y su
        domicilio sirve para las entregas. Se da de baja, no se borra.
      </p>
    </div>
    {#if puedeEditar}
      <button class="principal" onclick={nuevo}>Nuevo cliente</button>
    {/if}
  </div>

  <div class="indicadores">
    <div class="dato"><span class="etiqueta">Clientes</span><b>{clientes.activos.length}</b></div>
    <div class="dato"><span class="etiqueta">Con datos fiscales</span><b>{clientes.conFiscal.length}</b></div>
  </div>

  <div class="buscador">
    <!-- Otra búsqueda es otra lista: vuelve a los 10 primeros. -->
    <input
      bind:value={termino}
      oninput={() => pagFichas.reiniciar()}
      placeholder="Buscar por nombre, teléfono o RFC…"
    />
    {#if clientes.clientes.length > 1}
      <Ordenar
        opciones={opcionesFichas}
        bind:valor={ordenFichas}
        recordar="clientes.fichas"
        onCambiar={() => pagFichas.reiniciar()}
      />
    {/if}
  </div>

  <section class="tarjeta">
    {#if lista.length === 0}
      <p class="vacio">
        {termino ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes registrados."}
      </p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Nombre</th><th>Contacto</th><th>RFC</th><th>Domicilio</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each pagFichas.de(lista) as c (c.cliente_id)}
            <tr>
              <td><b>{c.nombre}</b>{#if c.notas}<small>{c.notas}</small>{/if}</td>
              <td class="tenue">
                {c.telefono ?? "—"}
                {#if c.correo}<small>{c.correo}</small>{/if}
                {#if c.acepta_promociones}<small class="acepta">Acepta promociones</small>{/if}
              </td>
              <td class="tenue">
                {#if c.fiscal}<span class="badge">{c.fiscal.rfc}</span>{:else}—{/if}
              </td>
              <td class="tenue">{c.domicilio ? domicilioTexto(c.domicilio) : "—"}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <!--
                    Solo con un correo que se pueda intentar. Sin él no hay nada
                    que mandar, y el botón solo llevaría a seis motivos iguales.
                  -->
                  {#if correoPlausible(c.correo)}
                    <button class="mini correo" onclick={() => abrirCorreo(c)}>Mandar correo</button>
                  {/if}
                  <!-- Se aparta mesa desde la ficha, y la reserva nace ligada. -->
                  <button class="mini" onclick={() => apartarMesaPara(c)}>Apartar mesa</button>
                  <button class="mini" onclick={() => abrirEdicion(c)}>Editar</button>
                  <button class="mini" onclick={() => darDeBaja(c)}>Baja</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <VerMas pag={pagFichas} {lista} />
    {/if}
  </section>
</div>

{#if abierto && puedeEditar}
  <div class="velo" role="presentation" onclick={cerrarOVolver}></div>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Ficha del cliente">
    <header>
      <h2>{editando ? "Editar cliente" : "Nuevo cliente"}</h2>
      <button class="cerrar" onclick={cerrarOVolver} aria-label="Cerrar">×</button>
    </header>

    {#if volviendoAReservas}
      <!-- Se dice a dónde lleva el botón ANTES de pulsarlo: quien está en la
           puerta con el cliente al teléfono no puede permitirse averiguarlo. -->
      <p class="alerta">
        Al guardar vuelves a <b>Reservas y espera</b>, con este cliente puesto y
        sin perder lo que ya llevabas escrito.
      </p>
    {/if}

    <div class="campos">
      <label class="ancho">
        <span>Nombre o contacto</span>
        <input bind:value={nombre} placeholder="José Pérez" />
      </label>
      <label><span>Teléfono</span><input bind:value={telefono} placeholder="33-1122-3344" /></label>
      <label><span>Correo</span><input bind:value={correo} placeholder="jose@correo.mx" /></label>
      <label class="ancho">
        <span>Notas (alergias, preferencias)</span>
        <input bind:value={notas} placeholder="Sin cebolla, alérgico a la nuez" />
      </label>
    </div>

    <!--
      EL PERMISO PARA LA PUBLICIDAD. Sin esta marca no le llega ni un cupón ni
      un «hace mucho que no viene»: lo exige la ley de datos personales, y es lo
      que protege la cuenta del restaurante de acabar en spam.
    -->
    <label class="switch">
      <input type="checkbox" bind:checked={aceptaPromos} />
      <span>Acepta recibir promociones por correo</span>
    </label>
    <div class="promos">
      {#if aceptaPromos && editando?.acepta_promociones && editando.acepta_promociones_ts}
        <p class="desde">
          Lo aceptó el {new Date(editando.acepta_promociones_ts).toLocaleDateString("es-MX", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}.
        </p>
      {:else if aceptaPromos}
        <p class="desde">Se guardará con la fecha de hoy.</p>
      {/if}
      <p class="ayuda">
        Márcala solo si el comensal lo pidió o lo aceptó. Cada promoción le dice
        que responda BAJA para no recibir más; esa respuesta llega al correo del
        restaurante, y entonces hay que desmarcarla aquí.
      </p>
    </div>

    {#if editando}
      {@render ultimosCorreos(editando.cliente_id)}
      {@render susReservas(editando)}
    {/if}

    <label class="switch">
      <input type="checkbox" bind:checked={conFiscal} />
      <span>Datos fiscales (para facturar)</span>
    </label>
    {#if conFiscal}
      <div class="campos sub-seccion">
        <label><span>RFC</span><input bind:value={fiscal.rfc} placeholder="GODE561231GR8" maxlength="13" /></label>
        <label class="ancho">
          <span>Razón social (exacta, como en la constancia)</span>
          <input bind:value={fiscal.nombre} placeholder="JOSE PEREZ LOPEZ" />
        </label>
        <label><span>Código postal</span><input bind:value={fiscal.codigo_postal} placeholder="44650" maxlength="5" /></label>
        <label>
          <span>Régimen fiscal</span>
          <select bind:value={fiscal.regimen_fiscal}>
            {#each REGIMENES_FISCALES as r (r.clave)}<option value={r.clave}>{r.clave} · {r.descripcion}</option>{/each}
          </select>
        </label>
        <label class="ancho">
          <span>Uso del CFDI</span>
          <select bind:value={fiscal.uso_cfdi}>
            {#each USOS_CFDI as u (u.clave)}<option value={u.clave}>{u.clave} · {u.descripcion}</option>{/each}
          </select>
        </label>
      </div>
    {/if}

    <label class="switch">
      <input type="checkbox" bind:checked={conDomicilio} />
      <span>Domicilio (para entregas)</span>
    </label>
    {#if conDomicilio}
      <div class="campos sub-seccion">
        <label class="ancho"><span>Calle y número</span>
          <div class="par">
            <input bind:value={dom.calle} placeholder="Av. Juárez" />
            <input class="corto" bind:value={dom.numero} placeholder="123" />
          </div>
        </label>
        <label><span>Colonia</span><input bind:value={dom.colonia} placeholder="Centro" /></label>
        <label><span>Ciudad</span><input bind:value={dom.ciudad} placeholder="Guadalajara" /></label>
        <label><span>Código postal</span><input bind:value={dom.codigo_postal} placeholder="44100" maxlength="5" /></label>
        <label class="ancho"><span>Referencias</span><input bind:value={dom.referencias} placeholder="Portón verde, entre Morelos y Hidalgo" /></label>
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={cerrarOVolver}>
        {volviendoAReservas ? "Volver sin guardar" : "Cancelar"}
      </button>
      <button class="principal" onclick={guardar}>Guardar</button>
    </div>
  </div>
{/if}

{#if destinatario && puedeEditar}
  <div class="velo" role="presentation" onclick={cerrarCorreo}></div>
  <div
    class="panel ancho"
    role="dialog"
    aria-modal="true"
    aria-label="Mandar un correo"
    bind:this={panelCorreo}
  >
    <header>
      <h2>
        {elegido ? etiquetaCorreo(elegido) : `Mandar un correo a ${destinatario.nombre}`}
      </h2>
      <button class="cerrar" onclick={cerrarCorreo} aria-label="Cerrar">×</button>
    </header>
    <p class="destino">Para <b>{destinatario.nombre}</b> · {destinatario.correo}</p>

    {#if elegido}
      <!--
        La vista previa con SUS datos: su nombre, su reserva. Es exactamente lo
        que le va a llegar.
      -->
      <EnvioCorreo
        tipo={elegido}
        para={destinatario.correo ?? ""}
        nombre={destinatario.nombre}
        datos={datosElegido}
        clienteId={destinatario.cliente_id}
        aceptaMarketing={!!destinatario.acepta_promociones}
        onvolver={() => elegirCorreo(null)}
        oncerrar={cerrarCorreo}
      />
    {:else}
      {#if !correos.listo}
        <p class="alerta" role="alert">
          El restaurante todavía no dice desde qué cuenta salen los correos.
          <button class="enlace" onclick={irAConfigurar}>Configurarlo en Correos al comensal</button>
        </p>
      {/if}

      <!--
        LOS SEIS, SIEMPRE. Los que no se pueden mandar se enseñan apagados y con
        su motivo, nunca escondidos: un restaurantero que no entiende por qué no
        puede mandar algo llama a soporte.
      -->
      <ul class="opciones">
        {#each opciones as o (o.def.tipo)}
          <li>
            <button class="opcion" disabled={!o.puede} onclick={() => elegirCorreo(o.def.tipo)}>
              <span class="nombre-correo">
                {o.def.etiqueta}
                {#if o.def.clase === "marketing"}<span class="chip">Publicidad</span>{/if}
              </span>
              {#if o.puede}
                <span class="explica">{o.def.descripcion}</span>
                {#if esDeReserva(o.def.tipo) && reservaProxima}
                  <span class="explica">
                    Su reserva: {cuandoDeReserva(reservaProxima.para_ts)} · {reservaProxima.personas}
                    {reservaProxima.personas === 1 ? "persona" : "personas"}
                  </span>
                {/if}
              {:else}
                <span class="motivo">{o.razon}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      {@render ultimosCorreos(destinatario.cliente_id)}
    {/if}
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
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 40rem;
  }
  /* Color y canto de tarjeta, pero SIN sombra: van varios en fila y alguno
     cae dentro de una tarjeta — dos sombras anidadas se ven sucias. */
  .dato {
    flex: 1;
    min-width: 10rem;
    background: var(--superficie);
    border: 1px solid var(--borde-tarjeta);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
  }
  .etiqueta {
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .dato b {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    margin-top: 0.2rem;
  }
  /* El buscador y el botón de «Ordenar», en una línea; en una tableta angosta
     el botón baja debajo. */
  .buscador {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .buscador input {
    flex: 1 1 16rem;
    padding: 0.65rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    font: inherit;
    background: #fff;
  }
  .buscador input:focus {
    outline: none;
    border-color: var(--acento);
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  td {
    padding: 0.55rem 0.6rem 0.55rem 0;
    border-bottom: 1px solid var(--borde);
    vertical-align: top;
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .badge {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.78rem;
    background: var(--fondo);
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    color: var(--pizarra);
  }
  .acciones {
    display: flex;
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    flex: none;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-weight: 600;
    color: var(--pizarra);
  }
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
    width: min(38rem, calc(100vw - 2rem));
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
  .par {
    display: flex;
    gap: 0.5rem;
  }
  .par .corto {
    max-width: 6rem;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--pizarra);
    cursor: pointer;
  }
  .switch input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--acento);
  }
  .sub-seccion {
    margin-top: 0.6rem;
    padding: 0.85rem;
    background: var(--fondo);
    border-radius: var(--r-md);
  }
  .error {
    margin-top: 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.1rem;
  }

  /* --- Correos al comensal --- */
  td small.acepta {
    color: var(--exito-texto);
    font-weight: 600;
  }
  .mini.correo {
    border-color: var(--acento);
    color: var(--acento-texto);
    white-space: nowrap;
  }
  .promos {
    margin: 0.35rem 0 0 1.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .desde {
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--exito-texto);
  }
  .ayuda {
    font-size: var(--t-xs);
    color: var(--gris);
    line-height: 1.5;
  }
  .ultimos {
    margin-top: 1.1rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--borde);
  }
  .ultimos h3 {
    font-size: var(--t-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    margin-bottom: 0.45rem;
  }
  .ultimos ul {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .ultimos li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.7rem;
    font-size: var(--t-sm);
    align-items: baseline;
  }
  .ultimos .que {
    font-weight: 600;
    color: var(--pizarra);
  }
  .ultimos .cuando {
    color: var(--gris);
  }
  /* «Apartar mesa» desde la ficha, al pie de sus reservas. */
  .mini.apartar {
    margin-top: 0.6rem;
    min-height: var(--toque);
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  .quedo {
    font-weight: 600;
  }
  .quedo.bien {
    color: var(--exito-texto);
  }
  .quedo.mal {
    color: var(--peligro);
  }
  .quedo.espera {
    color: var(--acento-texto);
  }
  .panel.ancho {
    width: min(44rem, calc(100vw - 2rem));
  }
  .destino {
    margin: -0.4rem 0 0.9rem;
    font-size: var(--t-sm);
    color: var(--gris);
    overflow-wrap: anywhere;
  }
  .destino b {
    color: var(--pizarra);
  }
  .alerta {
    margin-bottom: 0.8rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--acento);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 7%, transparent);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--pizarra);
  }
  .enlace {
    color: var(--acento-texto);
    font-weight: 600;
    text-decoration: underline;
  }
  .opciones {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .opcion {
    width: 100%;
    min-height: var(--toque);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding: 0.65rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--blanco);
    text-align: left;
  }
  .opcion:hover:not(:disabled) {
    border-color: var(--acento);
    box-shadow: var(--sombra-tarjeta-viva);
  }
  /*
   * Apagado pero LEGIBLE: el motivo es lo más importante del renglón, así que
   * no se atenúa con opacidad, que lo dejaría por debajo del contraste mínimo.
   */
  .opcion:disabled {
    background: var(--fondo);
    cursor: not-allowed;
  }
  .nombre-correo {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--pizarra);
  }
  .opcion:disabled .nombre-correo {
    color: var(--gris);
  }
  .chip {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0.05rem 0.45rem;
    border-radius: var(--r-pill);
    background: var(--claro);
    color: var(--acento-texto);
    font-size: var(--t-xs);
    font-weight: 600;
  }
  .explica {
    font-size: var(--t-sm);
    color: var(--gris);
    line-height: 1.45;
  }
  .motivo {
    font-size: var(--t-sm);
    color: var(--pizarra);
    line-height: 1.45;
  }
</style>
