<script lang="ts">
  /**
   * M4 · Compras: proveedores, qué pedir y recepción de mercancía.
   *
   * Cierra el circuito del almacén. El inventario ya sabía lo que SALE —consumo
   * por receta, mermas—; lo que entraba se cargaba a mano. Aquí se pide y, al
   * recibir, la entrada al almacén se genera sola con la orden como referencia.
   *
   * Pedir NO mueve el almacén: pedir no es tener. El almacén se mueve al
   * recibir, y solo por lo que de verdad llegó.
   */
  import {
    aPesos,
    deCentavos,
    etiquetaEstadoOrden,
    formatearCantidad,
    pendienteDe,
    totalOrden,
    type Centavos,
    type ID,
    type LineaCompra,
    type LineaRecibida,
    claveDeConcepto,
    leerFacturaProveedor,
    proponerRecepcion,
    type FacturaProveedor,
    type OrdenCompra,
    type Proveedor,
    type Unidad,
  } from "@motrest/dominio";
  import SelectorInsumo from "../SelectorInsumo.svelte";
  import { compras } from "../compras.svelte";
  import { fiscal } from "../fiscal.svelte";
  import { hora, mxn } from "../formato";
  import { inventario } from "../inventario.svelte";
  import Ordenar from "../listas/Ordenar.svelte";
  import VerMas from "../listas/VerMas.svelte";
  import {
    Paginado,
    ordenRecordado,
    ordenar,
    ordenesComunes,
    type OpcionOrden,
  } from "../listas/listas.svelte";
  import { sesion } from "../sesion/sesion.svelte";
  import { subirAlPrincipio } from "../subir";

  /*
   * «VER MÁS» Y «ORDENAR» (1.5.6, pedido de Gonzalo).
   *
   * Las órdenes de compra crecen sin techo —una o dos por semana, cada una con
   * sus renglones—, y todas se pintaban de golpe: en un local con un año
   * encima, la orden que llegó hoy quedaba arriba de una pared de cien tarjetas.
   * Ahora se ven 10 y el resto a petición, y se pueden ordenar por fecha, por
   * proveedor o por importe.
   *
   * Los proveedores se ordenan por nombre o por cuándo se dieron de alta. No
   * guardan fecha, pero su lista sale en el orden en que se registraron, y ese
   * es el de siempre: la pantalla no se abre cambiada. Todo esto es solo la
   * VISTA de esta terminal; ni una orden ni un proveedor cambian.
   */
  const opcionesOrdenes: OpcionOrden<OrdenCompra>[] = [
    ...ordenesComunes<OrdenCompra>({
      nombre: (o) => compras.nombreProveedor(o.proveedor_id),
      fecha: (o) => o.creada_ts,
    }).map((o) =>
      // Aquí el nombre es el del PROVEEDOR: que el botón lo diga.
      o.id === "az"
        ? { ...o, etiqueta: "Proveedor, de la A a la Z" }
        : o.id === "za"
          ? { ...o, etiqueta: "Proveedor, de la Z a la A" }
          : o,
    ),
    {
      id: "importe",
      etiqueta: "Mayor importe primero",
      comparar: (a, b) => totalOrden(b.lineas) - totalOrden(a.lineas),
    },
  ];
  let ordenOrdenes = $state(ordenRecordado("compras.ordenes", "recientes"));
  const ordenesVistas = $derived(
    ordenar(compras.ordenes, opcionesOrdenes.find((o) => o.id === ordenOrdenes)),
  );
  const pagOrdenes = new Paginado();

  const lugarDeAlta = $derived(new Map(compras.proveedores.map((p, i) => [p.proveedor_id, i])));
  const opcionesProveedores = ordenesComunes<Proveedor>({
    nombre: (p) => p.nombre,
    fecha: (p) => lugarDeAlta.get(p.proveedor_id),
  });
  let ordenProveedores = $state(ordenRecordado("compras.proveedores", "antiguos"));
  const proveedoresVistos = $derived(
    ordenar(compras.proveedores, opcionesProveedores.find((o) => o.id === ordenProveedores)),
  );

  type Vista = "reponer" | "ordenes" | "proveedores" | "factura";
  let vista = $state<Vista>("reponer");

  // --- Ingesta de la factura XML del proveedor (F2) ---------------------------------

  let facturaLeida = $state<FacturaProveedor | null>(null);
  let errorFactura = $state("");

  /**
   * Lee el XML que se suelta en la pantalla.
   *
   * No registra nada: propone. Un proveedor factura lo que despachó, no siempre
   * lo que llegó, así que alguien tiene que cotejarlo contra la mercancía.
   */
  async function abrirFactura(archivo: File | null | undefined) {
    if (!archivo) return;
    errorFactura = "";
    facturaLeida = null;

    const r = leerFacturaProveedor(await archivo.text(), fiscal.emisor.rfc || undefined);
    if (!r.ok) {
      errorFactura = r.detalle ?? "No se pudo leer la factura";
      return;
    }
    facturaLeida = r.factura!;
  }

  /*
   * Se propone con lo YA APRENDIDO. La primera factura de un proveedor se
   * enseña concepto por concepto; de la segunda en adelante entra sola.
   */
  const propuesta = $derived(
    facturaLeida ? proponerRecepcion(facturaLeida, compras.equivalencias) : [],
  );
  const porMapear = $derived(propuesta.filter((p) => p.requiere_mapeo).length);

  // Qué concepto se está enseñando, y con qué insumo y factor.
  let ensenando = $state<number | null>(null);
  let insumoElegido = $state("");
  let factorTexto = $state("1");

  function abrirEnsenanza(i: number) {
    ensenando = i;
    /*
     * Se abre SIN insumo puesto, a propósito.
     *
     * Antes venía cargado con el primero de la despensa. Aquí no se captura un
     * dato cualquiera: se le está enseñando al sistema que tal concepto del
     * proveedor ES tal insumo, y esa equivalencia se recuerda para todas las
     * facturas que vengan detrás. Precargado bastaba con no tocar el campo para
     * dejar grabada una equivalencia falsa para siempre; ahora hay que elegir, y
     * `aprenderEquivalencia` ya rechaza el vacío con su propio aviso.
     */
    insumoElegido = "";
    factorTexto = "1";
    errorFactura = "";
  }

  function guardarEquivalencia() {
    if (ensenando === null || !facturaLeida) return;
    const r = compras.aprenderEquivalencia({
      emisorRfc: facturaLeida.emisor_rfc,
      claveProveedor: claveDeConcepto(propuesta[ensenando]!.concepto),
      insumoId: insumoElegido,
      factor: Number(factorTexto),
    });
    if (!r.ok) {
      // El motivo sale encima de la tabla de conceptos, no junto a este botón.
      errorFactura = r.error ?? "";
      subirAlPrincipio(raiz);
      return;
    }
    ensenando = null;
  }

  /**
   * Registra la recepción con lo que la factura ya sabe mapear.
   *
   * Se crea la orden y se recibe en el mismo acto: la mercancía YA llegó —viene
   * facturada—, así que separarlos sería una ficción.
   */
  function recibirDesdeFactura() {
    if (!facturaLeida) return;
    // Salga bien o mal, la respuesta se escribe arriba: el error encima de la
    // tabla de conceptos, y el aviso en la pantalla de órdenes.
    subirAlPrincipio(raiz);
    const lineas = propuesta
      .filter((p) => !p.requiere_mapeo && p.cantidad_base !== null)
      .map((p) => ({
        insumo_id: p.insumo_id!,
        cantidad: p.cantidad_base!,
        costo_unitario: p.costo_unitario!,
      }));

    if (lineas.length === 0) {
      errorFactura = "Todavía no hay ningún renglón que se pueda recibir";
      return;
    }

    const orden = compras.crearOrden(proveedorId, lineas, `Factura ${facturaLeida.folio ?? ""}`);
    if (!orden.ok) {
      errorFactura = orden.error;
      return;
    }
    const r = compras.recibir(orden.id!, lineas, {
      folioProveedor: `${facturaLeida.serie ?? ""}${facturaLeida.folio ?? ""}`,
      nota: `Capturada del XML · ${facturaLeida.emisor_nombre}`,
    });
    if (!r.ok) {
      errorFactura = r.error ?? "";
      return;
    }
    aviso = "Recepción capturada de la factura: ya entró al almacén.";
    facturaLeida = null;
    vista = "ordenes";
  }
  let error = $state("");
  let aviso = $state("");

  /*
   * EL AVISO Y EL ERROR SE ESCRIBEN ARRIBA; LOS BOTONES QUE LOS PROVOCAN, NO.
   *
   * «Generar orden» está al pie de la lista de lo que hay que reponer, y
   * «Recibir y pagar» dentro de una orden a media pantalla. Lo que contestan
   * —«Orden generada», «el gasto ya bajó el dinero del restaurante», o por qué
   * no se pudo— salía encima de todo, fuera de cuadro: quien recibía la
   * mercancía no se enteraba de que el dinero ya se había movido, que es
   * justo lo que esos avisos existen para decir. Ver `subir.ts`.
   */
  let raiz = $state<HTMLDivElement | null>(null);

  const puedeProveedores = $derived(sesion.puedeOperar("compras.proveedor.editar"));
  const puedeOrdenar = $derived(sesion.puedeOperar("compras.orden.generar"));
  const puedeRecibir = $derived(sesion.puedeOperar("compras.recepcion.registrar"));

  // Quien opera queda atribuido tanto en la compra como en el movimiento de almacén.
  $effect(() => {
    const usuario = sesion.usuarioActual;
    if (usuario) compras.actuarComo(usuario.id);
  });

  function limpiarMensajes() {
    error = "";
    aviso = "";
  }

  function dia(ts: number): string {
    return new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  }

  // --- Nueva orden desde "por reponer" ------------------------------------------------

  let proveedorId = $state("");
  /** Cantidad a pedir por insumo, en texto: el usuario puede corregir la sugerencia. */
  let aPedir = $state<Record<string, string>>({});
  let notaOrden = $state("");

  const sugerencias = $derived(compras.sugerencias);

  /** Lo que se va a pedir: la sugerencia, salvo que se haya escrito otra cantidad. */
  const lineasNuevas = $derived.by((): LineaCompra[] =>
    sugerencias
      .map((s) => {
        const texto = aPedir[s.insumo_id];
        const cantidad = texto === undefined || texto.trim() === "" ? s.cantidad : Number(texto);
        return { insumo_id: s.insumo_id, cantidad, costo_unitario: s.costo_unitario };
      })
      .filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0),
  );

  const totalNueva = $derived(totalOrden(lineasNuevas));

  function generarOrden() {
    limpiarMensajes();
    // Salga bien o mal, la respuesta se escribe arriba.
    subirAlPrincipio(raiz);
    const r = compras.crearOrden(proveedorId, lineasNuevas, notaOrden.trim() || undefined);
    if (!r.ok) {
      error = r.error;
      return;
    }
    aPedir = {};
    notaOrden = "";
    aviso = "Orden generada. El almacén no se mueve hasta que llegue la mercancía.";
    vista = "ordenes";
  }

  // --- Recepción -----------------------------------------------------------------------

  let recibiendo = $state<ID | null>(null);
  /** Por insumo: cuánto llegó y a qué costo real (en pesos, como lo lee el capturista). */
  let llegado = $state<Record<string, string>>({});
  let costoReal = $state<Record<string, string>>({});
  let folioProveedor = $state("");
  let notaRecepcion = $state("");

  /*
   * CÓMO SE PAGÓ LA ENTREGA.
   *
   * Recibir mercancía movía el almacén y nada más: entraban cien kilos de queso
   * y el sistema seguía creyendo que el restaurante tenía el mismo dinero. Ahora
   * la recepción genera su gasto, y aquí se dice cuándo sale ese dinero.
   *
   * Decisión de Gonzalo: se PREGUNTA, no se asume. Un restaurante le paga al
   * proveedor el viernes aunque la entrega llegue el lunes, y dar por pagado
   * todo lo que entra dejaría el saldo mal toda la semana.
   */
  let pagoRecepcion = $state(true);
  let formaRecepcion = $state("efectivo");
  let venceRecepcion = $state("");

  function abrirRecepcion(orden: OrdenCompra) {
    limpiarMensajes();
    recibiendo = orden.orden_id;
    folioProveedor = "";
    notaRecepcion = "";
    pagoRecepcion = true;
    formaRecepcion = "efectivo";
    venceRecepcion = "";
    // Se precarga lo que falta y el costo pactado: lo normal es que llegue eso.
    const cantidades: Record<string, string> = {};
    const costos: Record<string, string> = {};
    for (const p of pendienteDe(orden)) {
      cantidades[p.insumo_id] = String(p.cantidad);
      const linea = orden.lineas.find((l) => l.insumo_id === p.insumo_id);
      costos[p.insumo_id] = linea ? aPesos(linea.costo_unitario).toFixed(2) : "0";
    }
    llegado = cantidades;
    costoReal = costos;
  }

  function confirmarRecepcion(orden: OrdenCompra) {
    limpiarMensajes();
    subirAlPrincipio(raiz);
    const recibidas: LineaRecibida[] = pendienteDe(orden)
      .map((p) => ({
        insumo_id: p.insumo_id,
        cantidad: Number(llegado[p.insumo_id] ?? 0),
        costo_unitario: deCentavos(Math.round(Number(costoReal[p.insumo_id] ?? 0) * 100)),
      }))
      .filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0);

    const r = compras.recibir(orden.orden_id, recibidas, {
      folioProveedor,
      nota: notaRecepcion,
      pagado: pagoRecepcion,
      formaPago: formaRecepcion,
      venceTs:
        !pagoRecepcion && venceRecepcion
          ? new Date(`${venceRecepcion}T12:00`).getTime()
          : undefined,
    });
    if (!r.ok) {
      error = r.error ?? "No se pudo registrar la recepción";
      return;
    }
    recibiendo = null;
    // Se dice lo que pasó con el DINERO, no solo con el almacén: es la mitad
    // que hasta ahora no ocurría, y quien recibe tiene que saber que ocurrió.
    aviso = pagoRecepcion
      ? "Mercancía recibida: entró al almacén y el gasto ya bajó el dinero del restaurante."
      : "Mercancía recibida: entró al almacén y quedó como cuenta por pagar en Finanzas.";
  }

  function cancelar(orden: OrdenCompra) {
    limpiarMensajes();
    const motivo = prompt("¿Por qué se cancela la orden?");
    if (motivo === null) return;
    const r = compras.cancelarOrden(orden.orden_id, motivo);
    if (!r.ok) {
      error = r.error ?? "No se pudo cancelar";
      subirAlPrincipio(raiz);
    }
  }

  /** Importe estimado de la recepción que se está capturando. */
  function importeRecepcion(orden: OrdenCompra): Centavos {
    return pendienteDe(orden).reduce((total, p) => {
      const cantidad = Number(llegado[p.insumo_id] ?? 0);
      const costo = Number(costoReal[p.insumo_id] ?? 0) * 100;
      if (!Number.isFinite(cantidad) || !Number.isFinite(costo)) return total;
      return deCentavos(total + Math.round(cantidad * costo));
    }, deCentavos(0));
  }

  // --- Proveedores ---------------------------------------------------------------------

  let nombre = $state("");
  let rfc = $state("");
  let contacto = $state("");
  let telefono = $state("");

  function altaProveedor() {
    limpiarMensajes();
    const r = compras.registrarProveedor({ nombre, rfc, contacto, telefono });
    if (!r.ok) {
      error = r.error;
      return;
    }
    // El recién dado de alta queda listo para la siguiente orden.
    proveedorId = r.id;
    nombre = "";
    rfc = "";
    contacto = "";
    telefono = "";
    aviso = "Proveedor dado de alta.";
  }

  function nombreInsumo(id: ID): string {
    return inventario.insumo(id)?.nombre ?? id;
  }

  /** La unidad base del insumo. "pz" es el respaldo: se cuenta, no se pesa. */
  function unidad(id: ID): Unidad {
    return inventario.insumo(id)?.unidad_base ?? "pz";
  }
</script>

<div class="seccion" bind:this={raiz}>
  <div class="encabezado">
    <div>
      <h1>Compras</h1>
      <p class="sub">
        Pedir no es tener: una orden no mueve el almacén. Las existencias suben
        cuando se registra lo que <b>de verdad llegó</b>.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={vista === "reponer"} onclick={() => { vista = "reponer"; limpiarMensajes(); }}>
        Por reponer
      </button>
      <button class:on={vista === "ordenes"} onclick={() => { vista = "ordenes"; limpiarMensajes(); }}>
        Órdenes
      </button>
      <button class:on={vista === "proveedores"} onclick={() => { vista = "proveedores"; limpiarMensajes(); }}>
        Proveedores
      </button>
      <button class:on={vista === "factura"} onclick={() => { vista = "factura"; limpiarMensajes(); }}>
        Factura XML
      </button>
    </div>
  </div>

  <div class="indicadores">
    <div class="dato">
      <span class="etiqueta">Por reponer</span>
      <b>{sugerencias.length}</b>
    </div>
    <div class="dato">
      <span class="etiqueta">Órdenes en camino</span>
      <b>{compras.abiertas.length}</b>
    </div>
    <div class="dato">
      <span class="etiqueta">Proveedores activos</span>
      <b>{compras.proveedoresActivos().length}</b>
    </div>
  </div>

  {#if aviso}<p class="ok" role="status">{aviso}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if vista === "reponer"}
    <section class="tarjeta">
      <h2>Qué conviene pedir hoy</h2>
      <p class="pista">
        Se pide <b>lo que falta</b> para llegar al mínimo, no el mínimo entero: con
        3&nbsp;kg y un mínimo de 10 se piden 7. Y se descuenta lo que ya viene en
        camino, para no acumular cuatro entregas del mismo faltante.
      </p>

      {#if sugerencias.length === 0}
        <p class="vacio">
          Nada por reponer: todo está por encima de su mínimo o ya viene en camino.
        </p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Hay</th>
              <th>Mínimo</th>
              <th>Pedir</th>
              <th>Costo</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {#each sugerencias as s (s.insumo_id)}
              {@const texto = aPedir[s.insumo_id] ?? String(s.cantidad)}
              {@const cant = Number(texto)}
              <tr>
                <td><b>{s.nombre}</b></td>
                <td class="num alerta">{formatearCantidad(s.existencia, unidad(s.insumo_id))}</td>
                <td class="num tenue">{formatearCantidad(s.stock_minimo, unidad(s.insumo_id))}</td>
                <td class="num">
                  <input
                    class="celda"
                    type="number"
                    inputmode="decimal"
                    value={texto}
                    oninput={(e) => (aPedir = { ...aPedir, [s.insumo_id]: e.currentTarget.value })}
                  />
                </td>
                <td class="num tenue">{mxn(s.costo_unitario)}</td>
                <td class="num">
                  {Number.isFinite(cant) ? mxn(deCentavos(Math.round(cant * s.costo_unitario))) : "—"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if puedeOrdenar}
          <div class="cierre">
            <div class="campos">
              <label>
                <span>Proveedor</span>
                <select bind:value={proveedorId}>
                  <option value="">Elige un proveedor…</option>
                  {#each compras.proveedoresActivos() as p (p.proveedor_id)}
                    <option value={p.proveedor_id}>{p.nombre}</option>
                  {/each}
                </select>
              </label>
              <label class="ancho">
                <span>Nota para el proveedor</span>
                <input bind:value={notaOrden} placeholder="Entregar antes del viernes…" />
              </label>
            </div>
            {#if compras.proveedoresActivos().length === 0}
              <p class="pista">
                Todavía no hay proveedores. Da de alta uno en la pestaña
                <b>Proveedores</b> para poder generar la orden.
              </p>
            {/if}
            <div class="botones">
              <span class="total">Total estimado <b>{mxn(totalNueva)}</b></span>
              <button class="principal" onclick={generarOrden}>Generar orden</button>
            </div>
          </div>
        {/if}
      {/if}
    </section>
  {:else if vista === "ordenes"}
    <section class="tarjeta">
      <div class="cab-lista">
        <h2>Órdenes de compra</h2>
        {#if compras.ordenes.length > 1}
          <Ordenar
            opciones={opcionesOrdenes}
            bind:valor={ordenOrdenes}
            recordar="compras.ordenes"
            onCambiar={() => pagOrdenes.reiniciar()}
          />
        {/if}
      </div>
      {#if compras.ordenes.length === 0}
        <p class="vacio">Sin órdenes todavía.</p>
      {:else}
        <div class="ordenes">
          {#each pagOrdenes.de(ordenesVistas) as orden (orden.orden_id)}
            {@const falta = pendienteDe(orden)}
            <article class="orden {orden.estado}">
              <header>
                <div>
                  <b>{compras.nombreProveedor(orden.proveedor_id)}</b>
                  <small>{dia(orden.creada_ts)} · {hora(orden.creada_ts)}</small>
                </div>
                <span class="estado {orden.estado}">{etiquetaEstadoOrden(orden.estado)}</span>
              </header>

              <ul class="lineas">
                {#each orden.lineas as linea (linea.insumo_id)}
                  {@const recibido = orden.recibido[linea.insumo_id] ?? 0}
                  <li>
                    <span class="ins">{nombreInsumo(linea.insumo_id)}</span>
                    <span class="cant">
                      {formatearCantidad(linea.cantidad, unidad(linea.insumo_id))}
                      {#if recibido > 0}
                        <em>llegó {formatearCantidad(recibido, unidad(linea.insumo_id))}</em>
                      {/if}
                    </span>
                    <span class="imp">{mxn(deCentavos(Math.round(linea.cantidad * linea.costo_unitario)))}</span>
                  </li>
                {/each}
              </ul>

              <footer>
                <span class="tenue">
                  {#if orden.estado === "cancelada"}
                    {orden.motivo_cancelacion}
                  {:else if orden.costo_recibido > 0}
                    Recibido {mxn(orden.costo_recibido)} de {mxn(totalOrden(orden.lineas))}
                  {:else}
                    Estimado {mxn(totalOrden(orden.lineas))}
                  {/if}
                </span>
                <div class="acciones">
                  {#if falta.length > 0 && puedeRecibir}
                    <button class="chico principal" onclick={() => abrirRecepcion(orden)}>
                      Recibir
                    </button>
                  {/if}
                  {#if orden.estado !== "recibida" && orden.estado !== "cancelada" && puedeOrdenar}
                    <button class="chico secundario" onclick={() => cancelar(orden)}>Cancelar</button>
                  {/if}
                </div>
              </footer>

              {#if recibiendo === orden.orden_id}
                <div class="recepcion">
                  <h3>Qué llegó</h3>
                  <p class="pista">
                    Captura lo que <b>de verdad</b> llegó y a qué precio. Recibir de
                    más cierra la línea; recibir de menos la deja abierta para la
                    siguiente entrega.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Insumo</th>
                        <th>Faltaba</th>
                        <th>Llegó</th>
                        <th>Costo real</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each falta as p (p.insumo_id)}
                        <tr>
                          <td><b>{nombreInsumo(p.insumo_id)}</b></td>
                          <td class="num tenue">{formatearCantidad(p.cantidad, unidad(p.insumo_id))}</td>
                          <td class="num">
                            <input
                              class="celda"
                              type="number"
                              inputmode="decimal"
                              value={llegado[p.insumo_id] ?? ""}
                              oninput={(e) =>
                                (llegado = { ...llegado, [p.insumo_id]: e.currentTarget.value })}
                            />
                          </td>
                          <td class="num">
                            <input
                              class="celda"
                              type="number"
                              inputmode="decimal"
                              value={costoReal[p.insumo_id] ?? ""}
                              oninput={(e) =>
                                (costoReal = { ...costoReal, [p.insumo_id]: e.currentTarget.value })}
                            />
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  <div class="campos">
                    <label>
                      <span>Folio de la remisión o factura</span>
                      <input bind:value={folioProveedor} placeholder="A-1234" />
                    </label>
                    <label class="ancho">
                      <span>Nota</span>
                      <input bind:value={notaRecepcion} placeholder="Faltaron 2 kg, vino más caro…" />
                    </label>
                  </div>

                  <!--
                    EL DINERO. Recibir mercancía ya no es solo un movimiento de
                    almacén: genera su gasto y baja el saldo del restaurante. Lo
                    único que hay que decidir aquí es CUÁNDO sale.
                  -->
                  <div class="pago-entrega">
                    <div class="opciones-pago">
                      <button
                        class="opcion"
                        class:on={pagoRecepcion}
                        onclick={() => (pagoRecepcion = true)}
                      >
                        Se paga ahora
                      </button>
                      <button
                        class="opcion"
                        class:on={!pagoRecepcion}
                        onclick={() => (pagoRecepcion = false)}
                      >
                        Queda a crédito
                      </button>
                    </div>

                    {#if pagoRecepcion}
                      <label>
                        <span>¿Con qué se paga?</span>
                        <select bind:value={formaRecepcion}>
                          <option value="efectivo">Efectivo</option>
                          <option value="transferencia">Transferencia</option>
                          <option value="tarjeta_debito">Tarjeta</option>
                        </select>
                      </label>
                      <p class="pista-pago">
                        {formaRecepcion === "efectivo"
                          ? "Sale del cajón, y el corte de este turno lo va a descontar."
                          : "Sale del banco: el efectivo del cajón no se toca."}
                      </p>
                    {:else}
                      <label>
                        <span>¿Cuándo se paga?</span>
                        <input type="date" bind:value={venceRecepcion} />
                      </label>
                      <p class="pista-pago">
                        El gasto cuenta desde hoy, pero el dinero no se mueve hasta
                        liquidarlo. Queda en <b>Finanzas → Cuentas por pagar</b>.
                      </p>
                    {/if}
                  </div>

                  <div class="botones">
                    <span class="total">Importe <b>{mxn(importeRecepcion(orden))}</b></span>
                    <button class="secundario" onclick={() => (recibiendo = null)}>Cancelar</button>
                    <button class="principal" onclick={() => confirmarRecepcion(orden)}>
                      {pagoRecepcion ? "Recibir y pagar" : "Recibir a crédito"}
                    </button>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>
        <VerMas pag={pagOrdenes} lista={ordenesVistas} />
      {/if}
    </section>
  {:else if vista === "factura"}
    <!--
      Ingesta de la factura XML del proveedor (F2).

      Leer NO es dar por bueno: se propone lo capturado para que alguien lo
      coteje contra la mercancía. Un proveedor factura lo que despachó, no
      siempre lo que llegó.
    -->
    <section class="tarjeta">
      <h2>Factura del proveedor</h2>
      <p class="pista">
        Arrastra aquí el <b>XML</b> que te manda el proveedor y se lee solo:
        quién factura, su folio y sus renglones. Nada se registra hasta que lo
        revises: la factura dice lo que <b>despacharon</b>, no siempre lo que
        llegó.
      </p>

      <label class="soltar">
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          onchange={(e) => abrirFactura(e.currentTarget.files?.[0])}
        />
        <span>Elegir el archivo XML…</span>
      </label>

      {#if errorFactura}<p class="error" role="alert">{errorFactura}</p>{/if}

      {#if facturaLeida}
        <div class="cab-factura">
          <div>
            <b>{facturaLeida.emisor_nombre}</b>
            <small>{facturaLeida.emisor_rfc}</small>
          </div>
          <div class="num">
            <span class="etiqueta">
              {facturaLeida.serie ?? ""}{facturaLeida.folio ? `-${facturaLeida.folio}` : ""}
            </span>
            <b>{mxn(facturaLeida.total)}</b>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Concepto del proveedor</th>
              <th class="num">Cantidad</th>
              <th class="num">Importe</th>
              <th>A qué insumo</th>
            </tr>
          </thead>
          <tbody>
            {#each propuesta as p, i (i)}
              <tr>
                <td>
                  <b>{p.concepto.descripcion}</b>
                  {#if p.concepto.clave}<small>{p.concepto.clave}</small>{/if}
                </td>
                <td class="num">{p.concepto.cantidad} {p.concepto.unidad ?? ""}</td>
                <td class="num">{mxn(p.concepto.importe)}</td>
                <td>
                  {#if p.requiere_mapeo}
                    <button class="por-mapear" onclick={() => abrirEnsenanza(i)}>
                      Enseñar cuál es
                    </button>
                  {:else}
                    {nombreInsumo(p.insumo_id!)} ·
                    {formatearCantidad(p.cantidad_base!, unidad(p.insumo_id!))}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <!-- Enseñar a qué insumo corresponde un concepto. Se aprende una vez. -->
        {#if ensenando !== null}
          <div class="ensenanza">
            <p class="pista">
              <b>{propuesta[ensenando]!.concepto.descripcion}</b> — ¿qué es en el
              almacén, y cuántas unidades base trae cada
              {propuesta[ensenando]!.concepto.unidad ?? "unidad"} del proveedor?
            </p>
            <div class="campos">
              <!--
                Primero la categoría y luego el insumo. Es el renglón donde peor
                sale equivocarse: la equivalencia se aprende una vez y a partir
                de ahí cada factura de ese proveedor entra sola, así que un
                insumo mal señalado aquí sigue metiendo mercancía en el cajón
                que no era meses después. Va en un `<div>` y no en un `<label>`
                porque el selector es un botón y los botones no son rotulables
                por `<label>`: el rótulo visible se queda, y el lector de
                pantalla lo recibe por `rotulo`.
              -->
              <div class="campo">
                <span>Insumo del almacén</span>
                <SelectorInsumo
                  valor={insumoElegido}
                  onElegir={(id) => (insumoElegido = id)}
                  rotulo="Insumo del almacén"
                />
              </div>
              <label>
                <span>Unidades base por unidad del proveedor</span>
                <input type="number" inputmode="decimal" bind:value={factorTexto} />
              </label>
            </div>
            <p class="pista">
              Ejemplo: si te factura una <b>bolsa de 5 kg</b> y tu almacén lleva
              gramos, el factor es <b>5000</b>. Es el número que evita que entren
              5 gramos en vez de 5 kilos.
            </p>
            <div class="botones">
              <button class="secundario" onclick={() => (ensenando = null)}>Cancelar</button>
              <button class="principal" onclick={guardarEquivalencia}>Guardar y recordar</button>
            </div>
          </div>
        {/if}

        <div class="botones">
          <span class="total">
            {#if porMapear > 0}
              {porMapear} {porMapear === 1 ? "renglón" : "renglones"} sin enseñar
            {:else}
              Todos los renglones reconocidos
            {/if}
          </span>
          {#if puedeRecibir}
            <label class="prov-factura">
              <span>Proveedor</span>
              <select bind:value={proveedorId}>
                <option value="">Elige…</option>
                {#each compras.proveedoresActivos() as p (p.proveedor_id)}
                  <option value={p.proveedor_id}>{p.nombre}</option>
                {/each}
              </select>
            </label>
            <button class="principal" onclick={recibirDesdeFactura}>
              Recibir lo reconocido
            </button>
          {/if}
        </div>

        {#if porMapear > 0}
          <p class="pista">
            Lo que falte por enseñar <b>no se recibe</b>: adivinar el insumo
            metería cantidades equivocadas al inventario y contaminaría el costeo
            y el centinela de mermas. Se enseña una vez y la próxima factura de
            este proveedor entra sola.
          </p>
        {/if}
      {/if}
    </section>
  {:else}
    {#if puedeProveedores}
      <section class="tarjeta">
        <h2>Alta de proveedor</h2>
        <div class="campos">
          <label>
            <span>Nombre</span>
            <input bind:value={nombre} placeholder="Lácteos del Norte" />
          </label>
          <label>
            <span>RFC</span>
            <input bind:value={rfc} placeholder="Opcional" />
          </label>
          <label>
            <span>Contacto</span>
            <input bind:value={contacto} placeholder="Opcional" />
          </label>
          <label>
            <span>Teléfono</span>
            <input bind:value={telefono} placeholder="Opcional" />
          </label>
        </div>
        <div class="botones">
          <button class="principal" onclick={altaProveedor}>Dar de alta</button>
        </div>
      </section>
    {/if}

    <section class="tarjeta">
      <div class="cab-lista">
        <h2>Proveedores</h2>
        {#if compras.proveedores.length > 1}
          <Ordenar
            opciones={opcionesProveedores}
            bind:valor={ordenProveedores}
            recordar="compras.proveedores"
          />
        {/if}
      </div>
      {#if compras.proveedores.length === 0}
        <p class="vacio">Sin proveedores todavía.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>RFC</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each proveedoresVistos as p (p.proveedor_id)}
              <tr class:baja={!p.activo}>
                <td>
                  <b>{p.nombre}</b>
                  {#if !p.activo}<small>Dado de baja</small>{/if}
                </td>
                <td class="num tenue">{p.rfc ?? "—"}</td>
                <td class="num tenue">{p.contacto ?? "—"}</td>
                <td class="num tenue">{p.telefono ?? "—"}</td>
                <td class="num">
                  {#if p.activo && puedeProveedores}
                    <button
                      class="chico secundario"
                      onclick={() => compras.desactivarProveedor(p.proveedor_id)}
                    >
                      Dar de baja
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="pista">
          Un proveedor se da de baja, no se borra: sus órdenes pasadas apuntan a él
          y sin nombre el historial de compras quedaría ilegible.
        </p>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* --- Cómo se paga la entrega --- */
  .pago-entrega {
    margin-top: 0.8rem;
    padding: 0.75rem 0.85rem;
    background: #faf9f8;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .opciones-pago {
    display: flex;
    gap: 0.4rem;
  }
  .opcion {
    border: 1.5px solid var(--borde);
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .opcion.on {
    border-color: var(--acento);
    color: var(--acento-texto);
    background: #fff7f0;
  }
  .pago-entrega label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 14rem;
  }
  .pago-entrega label span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .pago-entrega select,
  .pago-entrega input {
    padding: 0.5rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: 8px;
    font: inherit;
    background: #fff;
  }
  .pista-pago {
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--gris);
  }
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 70rem;
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
    max-width: 38rem;
  }
  .pestanas button {
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
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
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  /* El título de la lista y su botón de «Ordenar», en la misma línea. */
  .cab-lista {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.85rem;
  }
  .cab-lista h2 {
    margin-bottom: 0;
  }
  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
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
  th:not(:first-child) {
    text-align: right;
  }
  td {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  .alerta {
    color: var(--peligro);
    font-weight: 700;
  }
  tr.baja b {
    color: var(--gris);
  }
  .celda {
    width: 6rem;
    padding: 0.35rem 0.5rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.88rem;
    font-family: var(--font-cuerpo);
    text-align: right;
  }
  .celda:focus {
    outline: none;
    border-color: var(--acento);
  }
  .cierre {
    margin-top: 1rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--borde);
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  /*
   * `.campo` es un `<label>` que dejó de poder serlo: el selector de insumo es
   * un botón, y un `<label>` no rotula botones. Comparte estilo para que la
   * fila del formulario se siga leyendo como una sola.
   */
  .campos label,
  .campos .campo {
    flex: 1;
    min-width: 11rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
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
    background: #fff;
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    margin-top: 0.6rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .error {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--peligro);
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
  }
  .ok {
    font-size: 0.88rem;
    font-weight: 600;
    color: #3f6b2c;
    background: #eef7e8;
    border: 1px solid #b6d9a0;
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: flex-end;
    margin-top: 0.85rem;
    flex-wrap: wrap;
  }
  .total {
    margin-right: auto;
    font-size: 0.86rem;
    color: var(--gris);
  }
  .total b {
    font-family: var(--font-titulo);
    font-size: 1.1rem;
    color: var(--pizarra);
    margin-left: 0.35rem;
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.65rem 1.2rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .chico {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
  }
  .ordenes {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .orden {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.8rem 0.95rem;
  }
  .orden.cancelada {
    opacity: 0.65;
  }
  .orden.recibida {
    border-color: #b6d9a0;
  }
  .orden header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .orden header small {
    display: block;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .estado {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: var(--fondo);
    color: var(--gris);
    white-space: nowrap;
  }
  .estado.abierta,
  .estado.parcial {
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .estado.recibida {
    background: #eef7e8;
    color: #3f6b2c;
  }
  .lineas {
    margin: 0.6rem 0 0.5rem;
    list-style: none;
    font-size: 0.86rem;
  }
  .lineas li {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.28rem 0;
    border-bottom: 1px solid var(--borde);
  }
  .lineas .ins {
    flex: 1;
    font-weight: 600;
  }
  .lineas .cant {
    color: var(--gris);
    white-space: nowrap;
  }
  .lineas em {
    font-style: normal;
    color: #3f6b2c;
    font-weight: 600;
    margin-left: 0.4rem;
  }
  .lineas .imp {
    min-width: 5.5rem;
    text-align: right;
    white-space: nowrap;
  }
  .orden footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.82rem;
    flex-wrap: wrap;
  }
  .acciones {
    display: flex;
    gap: 0.4rem;
  }
  .recepcion {
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px dashed var(--borde);
  }
  /*
   * Contorno naranja y sombra, como el resto de los botones de «agregar»
   * (`.boton-agregar` en base.css). Era un punteado gris que se leía como el
   * borde de un hueco vacío en vez de como algo que se puede pulsar.
   *
   * El PUNTEADO se conserva, y es lo único que no se unifica: esta caja además
   * recibe el XML arrastrado desde el explorador, y el borde discontinuo es la
   * señal universal de «suéltalo aquí». Un borde continuo diría «púlsame» y
   * escondería la mitad de lo que sabe hacer.
   */
  .soltar {
    display: block;
    margin: 0.9rem 0;
    padding: 1.1rem;
    border: 2px dashed var(--acento);
    border-radius: var(--r-md);
    background: var(--blanco);
    box-shadow: 0 2px 6px rgba(242, 133, 58, 0.28);
    text-align: center;
    cursor: pointer;
    color: var(--acento-texto);
    font-size: 0.88rem;
    font-weight: 600;
  }
  .soltar:hover {
    background: var(--claro);
    box-shadow: 0 3px 10px rgba(242, 133, 58, 0.38);
  }
  .soltar input {
    display: block;
    margin: 0 auto;
    font: inherit;
  }
  .soltar span {
    display: block;
    margin-top: 0.5rem;
  }
  .cab-factura {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 0.95rem;
    margin-bottom: 0.85rem;
  }
  .cab-factura small {
    display: block;
    font-size: 0.76rem;
    color: var(--gris);
  }
  .cab-factura .num b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.15rem;
  }
  .por-mapear {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--acento-2);
    background: #fff5ec;
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
  }
  .ensenanza {
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
    margin-top: 0.85rem;
    background: #fffaf5;
  }
  .prov-factura {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .prov-factura span {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
  }
  .prov-factura select {
    padding: 0.5rem 0.65rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  button.por-mapear {
    border: 1.5px dashed var(--acento-2);
    cursor: pointer;
  }
  button.por-mapear:hover {
    background: var(--acento-2);
    color: #fff;
  }
</style>
