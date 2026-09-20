<script lang="ts">
  import {
    CERO,
    FORMAS_PAGO_MANUALES,
    desglosarConTasas,
    importeRenglon,
    pesos,
    problemaConsumoSocio,
    repartir,
    restar,
    sumar,
    totalesComanda,
    type Centavos,
    type EstadoComanda,
    type FormaPago,
    type RenglonComanda,
  } from "@motrest/dominio";
  import DialogoFactura from "./DialogoFactura.svelte";
  import { hora, mxn } from "./formato";
  import Icono from "./Icono.svelte";
  import { plano } from "./plano.svelte";
  import { pos } from "./pos.svelte";
  import { sesion } from "./sesion/sesion.svelte";
  import { socios } from "./socios.svelte";
  import { revelar, subirAlPrincipio } from "./subir";
  import { vistaMesa } from "./vista-mesa.svelte";

  let facturando = $state(false);

  const etiquetaEstado: Record<string, string> = {
    enviado: "en cocina",
    en_marcha: "preparando",
    listo: "listo",
    entregado: "entregado",
  };

  /*
   * EL PASO ES DE LA MESA, NO DE LA PANTALLA.
   *
   * Esto vivía en variables del componente, así que era una sola cosa para todo
   * el salón: dejar la mesa 1 a medio cobrar y tocar la mesa 4 abría el cobro de
   * una mesa que no había pedido nada, y volver a la cuenta desde ahí borraba lo
   * avanzado en la primera. Ver `vista-mesa.svelte.ts`.
   */
  const paso = $derived(vistaMesa.de(pos.mesaActiva));
  const fijar = (cambios: Parameters<typeof vistaMesa.fijar>[1]) =>
    vistaMesa.fijar(pos.mesaActiva, cambios);

  /*
   * CAMBIAR DE PANEL Y SUBIR. La cuenta tiene su propio scroll: con una mesa
   * larga, «Cobrar» se pulsa al pie y el panel de cobro empieza arriba, así que
   * se aterrizaba a media pantalla sin ver el título ni las formas de pago.
   *
   * Aparte de `fijar` y no dentro: el `$effect` que devuelve a la cuenta cuando
   * se pierde un permiso también llama a `fijar`, y ahí la pantalla no debe
   * moverse sola.
   */
  let cuentaEl = $state<HTMLElement | null>(null);
  function irA(cambios: Parameters<typeof vistaMesa.fijar>[1]) {
    fijar(cambios);
    subirAlPrincipio(cuentaEl);
  }

  /**
   * Lo que paga el comensal por un renglón: el precio con SU impuesto dentro.
   *
   * La carta de Rodizio no incluye IVA, así que el importe de línea es la base.
   * Enseñar esa cifra en el panel obliga al comensal —y al mesero— a sumar
   * renglones que no le dan el total. Aquí se muestra ya con el impuesto, igual
   * que en la cuenta impresa.
   */
  function conImpuesto(renglon: RenglonComanda): Centavos {
    return desglosarConTasas(importeRenglon(renglon), renglon.impuesto).total;
  }

  /*
   * LA PROPINA TECLEADA A MANO.
   *
   * Aquí estaba el defecto que hacía que solo funcionaran los porcentajes: el
   * campo era `type="number"` con `bind:value`, y Svelte convierte el valor de
   * un input numérico a NÚMERO. La comprobación `propinaLibre.trim()` reventaba
   * con «trim is not a function» en el primer dígito, el error moría dentro del
   * manejador y `fijarPropina` no llegaba a llamarse nunca. Ahora el campo es de
   * texto y el valor se normaliza a mano.
   */
  let temporizadorPropina: ReturnType<typeof setTimeout> | undefined;

  function propinaTecleada(texto: string) {
    fijar({ propinaLibre: texto });
    /*
     * Se espera a que deje de teclear. Aplicarlo en cada pulsación escribiría
     * tres eventos de propina para un «100», y cada evento viaja a todas las
     * terminales del local.
     */
    clearTimeout(temporizadorPropina);
    const mesa = pos.mesaActiva;
    temporizadorPropina = setTimeout(() => aplicarPropinaLibre(mesa), 350);
  }

  /**
   * Deja la propina EXACTAMENTE en lo tecleado; no lo acumula: quien corrige un
   * 150 mal escrito por 100 espera 100, no 250.
   */
  function aplicarPropinaLibre(mesaId: string = pos.mesaActiva) {
    clearTimeout(temporizadorPropina);
    // Si mientras se escribía se cambió de mesa, esta propina ya no es de la
    // mesa que está en pantalla y aplicarla se la pondría a la equivocada.
    if (mesaId !== pos.mesaActiva) return;

    const texto = vistaMesa.de(mesaId).propinaLibre.trim().replace(",", ".");
    if (texto === "") return;
    const monto = Number(texto);
    if (!Number.isFinite(monto) || monto < 0) return;
    pos.fijarPropina(pesos(monto));
  }

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

  /** ¿Este perfil puede confirmar que el platillo llegó a la mesa? */
  const puedeEntregar = $derived(sesion.puedeVer("pos.item.entregar"));

  /*
   * QUIÉN VE EL DINERO.
   *
   * El cobro y todo lo que cuelga de él —propina, descuentos, cortesías, el
   * consumo de socio— dejan de aparecerle a quien no puede hacerlo. Antes se
   * mostraban a todo el mundo y el permiso se comprobaba al pulsar: el mesero
   * veía «Cobrar», lo tocaba, y le salía un teclado pidiendo la firma de un
   * superior. Enseñar una puerta cerrada no protege nada y sí invita a probarla;
   * además llenaba la barra de botones que ese perfil no iba a usar nunca.
   *
   * Se pregunta por PERMISO y no por rol: la matriz ya dice quién cobra
   * —dirección, gerencia y cajero— y así un perfil que Gonzalo cree mañana con
   * acceso a la caja hereda los botones sin tocar este archivo.
   *
   * `puedeOperar` es el atajo correcto y no `puedeVer`: devuelve falso tanto
   * para quien no tiene el permiso como para quien solo podría hacerlo CON
   * autorización de un superior. Justo esos dos son los que no deben verlo.
   */
  const puedeCobrar = $derived(sesion.puedeOperar("pos.cobro.registrar"));
  const puedeDescontar = $derived(sesion.puedeOperar("pos.descuento.aplicar"));
  const puedeCortesia = $derived(sesion.puedeOperar("pos.cortesia.otorgar"));
  const puedeSocio = $derived(sesion.puedeOperar("pos.socio.consumir"));
  const puedeFacturar = $derived(sesion.puedeOperar("fin.factura.emitir"));

  /**
   * Si no queda ni un grupo, la barra entera sobra: sin esto quedaba vacía.
   *
   * `puedeCobrar` YA NO CUENTA aquí. Estaba porque la barra llevaba el grupo de
   * la propina, que era lo único suyo; al quitarlo —la propina se decide en el
   * paso de cobro, que es cuando el comensal dice cuánto deja— dejarlo habría
   * hecho aparecer una barra vacía al cajero que solo cobra y no descuenta.
   */
  const hayExtras = $derived(
    puedeFacturar ||
      puedeDescontar ||
      puedeCortesia ||
      (puedeSocio && socios.activos.length > 0),
  );

  /*
   * La caja cambia de manos veinte veces por turno con el conmutador rápido. Si
   * el cajero deja abierto el panel de cobro y entra un mesero, ese panel
   * seguiría en pantalla con el importe puesto: la vista es del componente, no
   * de la sesión. Al perder el permiso se vuelve a la cuenta.
   */
  $effect(() => {
    if (paso.vista === "cobro" && !puedeCobrar) fijar({ vista: "cuenta" });
    else if (paso.vista === "socio" && !puedeSocio) fijar({ vista: "cuenta" });
  });

  async function entregar(renglonId: string) {
    const ordenId = pos.comanda?.orden_id;
    if (!ordenId) return;
    await pos.marcarEntregado(ordenId, renglonId);
  }

  const t = $derived(pos.totales);
  const promos = $derived(pos.promociones?.descuentos ?? []);
  const recibidoCentavos = $derived(pesos(Number(paso.recibido) || 0));
  const cambio = $derived(
    t && recibidoCentavos > t.saldo ? restar(recibidoCentavos, t.saldo) : CERO,
  );

  /** En un cobro mixto, lo que entra al cajón. Nunca más que el saldo. */
  const enEfectivo = $derived(
    t ? (Math.min(pesos(Number(paso.efectivoMixto) || 0), t.saldo) as Centavos) : CERO,
  );
  /** Y lo que se cubre con la terminal. */
  const conTarjeta = $derived(t ? restar(t.saldo, enEfectivo) : CERO);

  async function cobrarAhora() {
    if (!t) return;
    // Lo tecleado en el campo de propina puede estar todavía esperando en el
    // temporizador. Se aplica ANTES de leer el saldo o se cobraría sin ella.
    aplicarPropinaLibre();

    const saldo = pos.totales?.saldo ?? t.saldo;
    const mesa = pos.mesaActiva;

    if (paso.forma === "mixto") {
      await pos.cobrarMixto(
        enEfectivo,
        paso.formaTarjeta,
        saldo,
        recibidoCentavos > 0 ? recibidoCentavos : undefined,
      );
    } else {
      const esEfectivo = paso.forma === "efectivo";
      await pos.cobrar(
        paso.forma,
        saldo,
        esEfectivo && recibidoCentavos > 0 ? recibidoCentavos : undefined,
      );
    }

    // Cobrada y liberada: la mesa vuelve al principio para la siguiente sentada.
    // Si quedó saldo, se conserva la forma de pago elegida y solo se limpia lo
    // que ya se usó.
    if (pos.comandaDeMesa(mesa)?.cerrada !== false) vistaMesa.reiniciar(mesa);
    else vistaMesa.fijar(mesa, { vista: "cuenta", recibido: "", efectivoMixto: "" });

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

  // --- Propina que el comensal decide después de pagar -----------------------------
  let propinaPosterior = $state("");
  let formaPropinaPosterior = $state<FormaPago>("efectivo");

  function resolverPropinaPosterior(sinPropina = false) {
    const monto = sinPropina
      ? CERO
      : pesos(Number(propinaPosterior.trim().replace(",", ".")) || 0);
    if (!sinPropina && monto <= 0) return;
    if (!pos.resolverPropinaPosterior(monto, sinPropina ? undefined : formaPropinaPosterior)) return;
    propinaPosterior = "";
    formaPropinaPosterior = "efectivo";
  }

  async function dividir() {
    aplicarPropinaLibre();
    const mesa = pos.mesaActiva;
    // Repartir la cuenta es siempre en una sola forma de pago; el mixto no
    // aplica y se cae a efectivo, que es lo que ocurre en la mesa.
    await pos.dividirEnPartes(paso.partes, paso.forma === "mixto" ? "efectivo" : paso.forma);
    vistaMesa.reiniciar(mesa);
  }

  async function traspasar(mesaId: string) {
    if (!paso.renglonATraspasar) return;
    await pos.traspasarRenglon(paso.renglonATraspasar, mesaId);
    fijar({ renglonATraspasar: null, vista: "cuenta" });
  }

  // --- Cortesía por socio ------------------------------------------------------
  /*
   * El socio consume contra la bolsa que tiene pactada al mes. Se registra como
   * un COBRO con forma «socio», no como una cortesía de la casa: la venta
   * ocurrió y tiene que seguir contando completa en finanzas y en inteligencia.
   * Lo único distinto es que el dinero no entra al cajón.
   */
  // --- Cortesía: QUÉ se regala -------------------------------------------------
  /*
   * Pedido de Gonzalo (sep-2026): el botón regalaba la cuenta entera o nada.
   * Ahora abre una ventana donde se marca toda la cuenta —como antes— o solo
   * algunos productos, y de un renglón de varias piezas, cuántas. Es lo que
   * permite llevar el control de qué se puede regalar y qué no: la bitácora
   * dice «1 de 3 Cerveza», no «cuenta completa».
   */
  const MOTIVOS_CORTESIA = [
    "Cortesía de la casa",
    "Cumpleaños",
    "Tardó la cocina",
    "Error del servicio",
  ];

  const cortesiasPuestas = $derived(pos.comanda?.cortesias ?? []);
  const cortesiaToda = $derived(cortesiasPuestas.some((c) => !c.renglon_id));
  const productosRegalados = $derived(cortesiasPuestas.filter((c) => c.renglon_id).length);

  /** Piezas de este renglón que ya van regaladas en la cuenta. */
  function piezasRegaladas(renglon: RenglonComanda): number {
    if (cortesiaToda) return renglon.cantidad;
    const puesta = cortesiasPuestas.find((c) => c.renglon_id === renglon.id);
    if (!puesta) return 0;
    return Math.min(puesta.cantidad ?? renglon.cantidad, renglon.cantidad);
  }

  let regalando = $state(false);
  let regalarToda = $state(false);
  /** renglon_id → piezas marcadas en la ventana (0 = no se regala). */
  let piezasRegalo = $state<Record<string, number>>({});
  let motivoCortesia = $state(MOTIVOS_CORTESIA[0]!);

  /** Abre la ventana con lo que YA está regalado marcado: se edita, no se empieza de cero. */
  function abrirCortesia() {
    regalarToda = cortesiaToda;
    const actuales: Record<string, number> = {};
    if (!cortesiaToda) {
      for (const r of pos.renglones) {
        const n = piezasRegaladas(r);
        if (n > 0) actuales[r.id] = n;
      }
    }
    piezasRegalo = actuales;
    motivoCortesia = cortesiasPuestas[0]?.motivo ?? MOTIVOS_CORTESIA[0]!;
    regalando = true;
  }

  function alternarToda() {
    regalarToda = !regalarToda;
    if (regalarToda) piezasRegalo = {};
  }

  /** Marcar un renglón lo regala entero; las piezas se ajustan después. */
  function alternarRenglonRegalo(r: RenglonComanda) {
    const n = piezasRegalo[r.id] ?? 0;
    piezasRegalo = { ...piezasRegalo, [r.id]: n > 0 ? 0 : r.cantidad };
    regalarToda = false;
  }

  function cambiarPiezasRegalo(r: RenglonComanda, delta: number) {
    const n = Math.max(0, Math.min(r.cantidad, (piezasRegalo[r.id] ?? 0) + delta));
    piezasRegalo = { ...piezasRegalo, [r.id]: n };
  }

  const seleccionRegalo = $derived(
    Object.entries(piezasRegalo)
      .filter(([, n]) => n > 0)
      .map(([renglon_id, cantidad]) => ({ renglon_id, cantidad })),
  );

  /*
   * Lo que va a pasar, antes de que pase: se proyecta la cuenta con la
   * selección puesta y se leen sus totales, igual que la previa del descuento
   * específico. Es la cifra exacta que se cobrará, no una regla de tres.
   */
  const previaCortesia = $derived.by(() => {
    const comanda = pos.comanda;
    if (!comanda) return null;
    const cortesias = regalarToda
      ? [{ motivo: motivoCortesia }]
      : seleccionRegalo.map((s) => ({ ...s, motivo: motivoCortesia }));
    const t2 = totalesComanda({ ...comanda, cortesias });
    return { regalo: t2.cortesias, queda: t2.total };
  });

  const nadaMarcado = $derived(!regalarToda && seleccionRegalo.length === 0);

  async function aplicarCortesia() {
    const ok = await pos.fijarCortesias(
      regalarToda ? { toda: true } : { toda: false, renglones: seleccionRegalo },
      motivoCortesia.trim() || MOTIVOS_CORTESIA[0]!,
    );
    if (ok) regalando = false;
  }

  const socioElegido = $derived(
    paso.socioElegido ? (socios.de(paso.socioElegido) ?? null) : null,
  );
  const bolsaSocio = $derived(socioElegido ? socios.bolsa(socioElegido) : null);
  /** Lo tecleado; vacío = todo el saldo de la cuenta, que es el caso normal. */
  const cargoSocio = $derived(
    paso.montoSocio.trim() === ""
      ? (Math.min(t?.saldo ?? 0, bolsaSocio?.disponible ?? 0) as Centavos)
      : pesos(Number(paso.montoSocio.replace(",", ".")) || 0),
  );
  const problemaSocio = $derived(
    socioElegido && bolsaSocio
      ? problemaConsumoSocio(socioElegido, cargoSocio, bolsaSocio)
      : null,
  );

  function abrirSocio() {
    // Se propone el único socio si solo hay uno: en un local con un socio,
    // elegirlo de una lista de uno es un toque de más en cada cuenta.
    const unico = socios.activos.length === 1 ? socios.activos[0]!.socio_id : null;
    irA({ vista: "socio", socioElegido: paso.socioElegido ?? unico, montoSocio: "" });
  }

  async function cargarASocio() {
    if (!socioElegido || problemaSocio) return;
    const mesa = pos.mesaActiva;
    const ok = await pos.cobrarASocio(socioElegido.socio_id, cargoSocio, socioElegido.nombre);
    if (!ok) return;

    if (pos.comandaDeMesa(mesa)?.cerrada !== false) vistaMesa.reiniciar(mesa);
    else vistaMesa.fijar(mesa, { vista: "cuenta", socioElegido: null, montoSocio: "" });
  }

  // --- Descuentos -------------------------------------------------------------
  /*
   * Los escalones que se pulsan sin pensar. Son fracciones y no enteros porque
   * es lo que espera el evento `descuento_aplicado` con `modo: "porcentaje"`:
   * un 0..1, nunca un 0..100.
   */
  const DESCUENTOS_RAPIDOS = [0.05, 0.1, 0.15, 0.2, 0.25];
  const MOTIVO_ESPECIFICO = "Descuento específico";

  /** 0.05 → "5%", 0.125 → "12.5%". Sin decimales de más ni de menos. */
  function porcentajeLegible(fraccion: number): string {
    return `${Number((fraccion * 100).toFixed(2))}%`;
  }

  /*
   * LA VENTANITA DEL DESCUENTO A LA MEDIDA.
   *
   * Los cinco escalones cubren el día normal, pero la mesa pide lo que pide:
   * «quítale 150 por la espera» o «hazle el 12 %». Sin esto, quien cobraba
   * tenía que elegir el escalón más cercano y prometerle al comensal una cifra
   * que el ticket luego no decía.
   *
   * Se ofrecen las DOS unidades —porcentaje y pesos— porque las dos se usan en
   * la mesa y ninguna se puede adivinar desde aquí; el porcentaje va por
   * defecto, que es como se pide nueve de cada diez veces.
   *
   * Vive en el componente y no en `vistaMesa` porque es un diálogo modal: con
   * el velo puesto no se puede cambiar de mesa por debajo, así que no se repite
   * aquí el defecto de la vista de cobro que sí era de la mesa.
   */
  let descontando = $state(false);
  let modoDescuento = $state<"porcentaje" | "monto">("porcentaje");
  let valorDescuento = $state("");
  let motivoDescuento = $state(MOTIVO_ESPECIFICO);

  /*
   * Texto y no `type="number"`, por lo mismo que la propina tecleada (ver el
   * comentario de `propinaTecleada`): con un input numérico Svelte convierte el
   * valor a número y cualquier comprobación de cadena revienta en el primer
   * dígito. Se normaliza a mano la coma decimal, que es la que se teclea aquí.
   */
  const valorDescuentoNumero = $derived(Number(valorDescuento.trim().replace(",", ".")));

  /** Qué le pasa a lo tecleado, si es que le pasa algo. */
  const problemaDescuento = $derived.by(() => {
    if (valorDescuento.trim() === "") return null;
    if (!Number.isFinite(valorDescuentoNumero) || valorDescuentoNumero <= 0) {
      return "Escribe una cantidad mayor que cero";
    }
    if (modoDescuento === "porcentaje" && valorDescuentoNumero > 100) {
      return "El descuento no puede pasar del 100 %";
    }
    if (modoDescuento === "monto" && t && pesos(valorDescuentoNumero) > t.total) {
      return `El descuento no puede pasar del total de la cuenta (${mxn(t.total)})`;
    }
    return null;
  });

  /** Se valida ANTES de pulsar: el botón se apaga, no se regaña después. */
  const descuentoValido = $derived(
    valorDescuento.trim() !== "" && problemaDescuento === null && !!t && t.total > 0,
  );

  /*
   * LA VISTA PREVIA LA CALCULA EL DOMINIO, no esta pantalla.
   *
   * Cuánto rebaja de verdad un descuento no es una regla de tres: se aplica
   * sobre la base ANTES del impuesto, se prorratea entre los renglones que
   * siguen vivos —cada uno con su tasa— y solo después se vuelve a sumar el
   * IVA. Calcularlo aquí a ojo daría una cifra parecida y distinta de la que el
   * comensal acabaría pagando, que es exactamente lo que no se puede hacer con
   * dinero. Así que se proyecta la comanda con el descuento dentro y se lee el
   * total que sale: la misma función que cobra, `totalesComanda`. Es una
   * proyección de mentira sobre una copia; no se emite ningún evento hasta que
   * alguien confirma.
   */
  const previaDescuento = $derived.by(() => {
    const comanda = pos.comanda;
    if (!comanda || !t || !descuentoValido) return null;

    const simulada: EstadoComanda = {
      ...comanda,
      descuentos: [
        ...comanda.descuentos,
        {
          id: "previa",
          alcance: "cuenta",
          modo: modoDescuento,
          valor:
            modoDescuento === "porcentaje"
              ? valorDescuentoNumero / 100
              : pesos(valorDescuentoNumero),
          motivo: motivoDescuento,
        },
      ],
    };
    const conDescuento = totalesComanda(simulada);
    return { rebaja: restar(t.total, conDescuento.total), queda: conDescuento.total };
  });

  function abrirDescuento() {
    modoDescuento = "porcentaje";
    valorDescuento = "";
    motivoDescuento = MOTIVO_ESPECIFICO;
    descontando = true;
  }

  async function aplicarDescuentoEspecifico() {
    if (!descuentoValido) return;

    /*
     * Se copia lo tecleado y se cierra la ventanita ANTES de pedir permiso: lo
     * que viene puede ser el teclado de PIN de un superior, y dejarlo saliendo
     * por detrás del velo de este diálogo lo volvería intocable.
     */
    const modo = modoDescuento;
    const numero = valorDescuentoNumero;
    const motivo = motivoDescuento.trim() || MOTIVO_ESPECIFICO;
    descontando = false;

    if (modo === "porcentaje") await pos.aplicarDescuento(numero / 100, motivo);
    else await pos.aplicarDescuentoMonto(pesos(numero), motivo);
  }
</script>

<aside class="cuenta" bind:this={cuentaEl}>
  <!--
    ¿DEJÓ PROPINA? — la pregunta que espera, sin bloquear el software.

    Era una ventana modal centrada con velo: hasta que alguien la contestaba, la
    caja entera quedaba muerta. Y la respuesta no depende del restaurante, sino
    del comensal, que está terminando de decidir con la terminal en la mano. Se
    paraba el local para esperar a una persona.

    Ahora vive aquí, dentro de la cuenta, y se queda puesta hasta que alguien la
    toque: mientras tanto se puede seguir comandando, cobrando otra mesa o
    mirando el inventario. Es lo mismo que hace la propia mesa —esperar—, pero
    sin secuestrar la pantalla.

    Sigue siendo solo para quien cobra: es el último paso de un cobro, y a un
    mesero le aparecería una cuenta que él no cobró y que no puede resolver.
  -->
  {#if pos.propinaPendiente && puedeCobrar}
    <section class="propina-espera" aria-label="Propina pendiente">
      <div class="cabecera-espera">
        <h3>¿Dejó propina?</h3>
        <span class="chip-espera">
          Mesa {plano.nombreMesa(pos.propinaPendiente.mesa_id)}
        </span>
      </div>
      <p class="pista-espera">
        La mesa ya quedó liberada y <b>puedes seguir trabajando</b>. El ticket
        interno se imprime cuando registres la propina o confirmes que no dejó.
      </p>
      <div class="campos-espera">
        <label>
          <span>Monto</span>
          <input
            type="text"
            inputmode="decimal"
            bind:value={propinaPosterior}
            placeholder="0.00"
            aria-label="Monto de propina posterior"
          />
        </label>
        <label>
          <span>Se pagó con</span>
          <select bind:value={formaPropinaPosterior}>
            {#each FORMAS_PAGO_MANUALES as forma (forma.valor)}
              <option value={forma.valor}>{forma.etiqueta}</option>
            {/each}
          </select>
        </label>
      </div>
      <button class="registrar-espera" onclick={() => resolverPropinaPosterior(false)}>
        Registrar propina e imprimir
      </button>
      <!--
        «No dejó propina» dentro de su recuadro naranja: es la otra mitad de la
        decisión, no un enlace de descarte. Cuando iba como texto suelto se
        buscaba durante varios segundos con el comensal delante.
      -->
      <button class="sin-propina" onclick={() => resolverPropinaPosterior(true)}>
        No dejó propina
      </button>
    </section>
  {/if}

  {#if pos.comanda && pos.comandaAbierta && t}
    <div class="ch">
      <h2>Mesa {pos.nombreMesaActiva}</h2>
      <!--
        A NOMBRE DE QUIÉN VA LA CUENTA. De cualquier cuenta, no solo de un
        pedido para llevar.

        Nació para el mostrador —sin nombre, cocina prepara y nadie sabe de
        quién es la bolsa— y por eso el rótulo decía «+ Nombre», que en una mesa
        no significa nada. Pero una mesa también tiene dueño: la familia que
        reservó, el cliente de todos los jueves, el que pidió que le separaran
        la cuenta. Puesto el nombre, sale en la mesa del plano, en la comanda de
        cocina y en el papel que se entrega.
      -->
      {#if pos.comanda.a_nombre_de}
        <button class="chip nombre" onclick={abrirNombre} title="Cambiar el nombre del cliente">
          <Icono nombre="clientes" tam={14} />
          {pos.comanda.a_nombre_de}
        </button>
      {:else}
        <button
          class="chip poner-nombre"
          onclick={abrirNombre}
          title="A nombre de quién va esta cuenta"
        >
          <Icono nombre="clientes" tam={14} />
          Cliente
        </button>
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

    <!--
      La vista de la cuenta es también la RED: si alguien se queda sin el
      permiso con el panel de cobro abierto —el conmutador rápido de la caja
      pasa veinte veces por turno—, cae aquí en vez de dejar el hueco en blanco
      del fotograma que tarda el efecto en devolverlo.
    -->
    {#if paso.vista === "cuenta" || (paso.vista === "cobro" && !puedeCobrar) || (paso.vista === "socio" && !puedeSocio)}
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
                <!--
                  «LISTO» PARPADEA, Y SOLO ESE.

                  Es el único estado que le pide algo al mesero: hay un plato
                  bajo la lámpara enfriándose. El resto son informativos y se
                  quedan quietos — si todo se moviera, nada llamaría la atención.
                -->
                <em class="est-r" class:avisa={renglon.estado === "listo"}>
                  {etiquetaEstado[renglon.estado]}
                </em>
              {/if}
              {#if piezasRegaladas(renglon) > 0}
                {@const regaladas = piezasRegaladas(renglon)}
                <em class="est-r regalo">
                  Cortesía{regaladas < renglon.cantidad ? ` · ${regaladas} de ${renglon.cantidad}` : ""}
                </em>
              {/if}
            </span>
            <span class="p">{mxn(conImpuesto(renglon))}</span>
            <span class="acciones">
              <!--
                Marcar la entrega desde el salón. Quien lleva el plato a la mesa
                es quien sabe que llegó: hasta ahora esto solo existía en el
                tablero de cocina, donde lo pulsaba quien lo deja en el pase.
              -->
              <!--
                CUATRO GLIFOS DE 20px SEPARADOS POR 1.6px, Y EL CUARTO CANCELA.
                Eso era esto. Cuatro caracteres sueltos —✔ ✎ ⇄ ×— cuya única
                explicación vivía en un `title`, que en una tableta no aparece
                nunca. Errar el tercero y dar en el cuarto cancelaba un platillo
                que el comensal ya se estaba comiendo.

                Ahora son iconos con nombre, cada uno con su superficie de
                toque, y el que cancela sale del grupo con un separador delante:
                lo que destruye no se pega a lo que no.
              -->
              {#if puedeEntregar && renglon.estado !== "entregado" && renglon.estado !== "capturado"}
                <button
                  class="mini glifo entregar"
                  class:urge={renglon.estado === "listo"}
                  title="Marcar como entregado en la mesa"
                  aria-label="Marcar {renglon.descripcion} como entregado"
                  onclick={() => entregar(renglon.id)}
                ><Icono nombre="guardar" tam={16} /></button>
              {/if}
              <button
                class="mini glifo"
                class:activa={renglon.notas}
                title="Indicaciones para cocina"
                aria-label="Indicaciones para {renglon.descripcion}"
                onclick={() => abrirIndicaciones(renglon.id, renglon.notas ?? "")}
              ><Icono nombre="editar" tam={16} /></button>
              <button
                class="mini glifo"
                title="Traspasar a otra mesa"
                aria-label="Traspasar {renglon.descripcion}"
                onclick={() => irA({ renglonATraspasar: renglon.id, vista: "traspaso" })}
              ><Icono nombre="traspasar" tam={16} /></button>
              <span class="aparta"></span>
              <button
                class="mini glifo x"
                title="Cancelar renglón"
                aria-label="Cancelar {renglon.descripcion}"
                onclick={() => pos.cancelar(renglon.id)}
              ><Icono nombre="cancelar-renglon" tam={16} /></button>
            </span>
          </div>
        {/each}
      </div>

      <!--
        Las promociones se ofrecen, no se cobran solas. Que alguien de la casa
        confirme es lo que evita descubrir en el corte que una promoción mal
        configurada estuvo regalando producto toda la noche.

        Se ofrecen SIEMPRE que haya platillos elegibles sin cubrir, aunque esa
        misma promoción ya se haya aplicado antes en esta cuenta: la mesa que
        pide una segunda ronda de pizzas tiene su 2×1 igual que la primera.
      -->
      {#each promos as promo (promo.promocion_id)}
        <button class="promo" onclick={() => pos.aplicarPromocion(promo)}>
          <span class="etiqueta">Promoción</span>
          <span class="nombre">{promo.nombre}</span>
          <span class="importe">−{mxn(promo.importe)}</span>
          <span class="cta">Aplicar</span>
        </button>
      {/each}

      <!--
        LAS QUE YA ESTÁN PUESTAS, cada una con su botón de quitar.

        Una por aplicación y no una por promoción: si el 2×1 se aplicó en las dos
        rondas, aparecen las dos y se retira la que sobra. Sin esta lista, poner
        la promoción equivocada obligaba a cancelar la cuenta entera.
      -->
      {#each pos.promocionesAplicadas as puesta (puesta.id)}
        <div class="promo-puesta">
          <span class="etiqueta">Aplicada</span>
          <span class="nombre">{puesta.nombre}</span>
          <span class="importe">−{mxn(puesta.importe)}</span>
          <button
            class="quitar-promo"
            onclick={() => pos.retirarPromocion(puesta.id)}
            aria-label="Quitar {puesta.nombre}"
          >
            Quitar
          </button>
        </div>
      {/each}

      <!--
        LOS DESCUENTOS PUESTOS A MANO, cada uno con su «Quitar».

        Faltaba, y era el mismo agujero que tenían las promociones antes de la
        lista de arriba: un 25 % pulsado por error —o un «quítale 300» en la
        mesa equivocada— no se podía deshacer más que cancelando la cuenta
        entera y recapturándola con el comensal delante.

        El de monto fijo enseña sus pesos porque el importe ES el valor del
        evento. El de porcentaje enseña el porcentaje: lo que rebaja en pesos se
        prorratea entre los renglones al calcular los totales y no existe como
        cifra suelta, y junto al dinero del restaurante es mejor no pintar
        ninguna que pintar una aproximada.
      -->
      {#each pos.descuentosManuales as puesto (puesto.id)}
        <div class="promo-puesta">
          <span class="etiqueta">Descuento</span>
          <span class="nombre">{puesto.motivo}</span>
          <span class="importe">
            {#if puesto.importe !== null}
              −{mxn(puesto.importe)}
            {:else}
              −{porcentajeLegible(puesto.valor)}
            {/if}
          </span>
          <button
            class="quitar-promo"
            onclick={() => pos.retirarDescuento(puesto.id)}
            aria-label="Quitar el descuento {puesto.motivo}"
          >
            Quitar
          </button>
        </div>
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

      <!--
        La barra del dinero. Cada grupo aparece solo si quien está dentro puede
        hacerlo, y la barra entera desaparece si no queda ninguno: al mesero le
        sobra la fila completa.
      -->
      {#if hayExtras}
        <div class="extras" class:oculto={!pos.hayCuenta}>
          {#if puedeFacturar}
            <span class="grupo">
              Factura
              <button class="mini" onclick={() => (facturando = true)}>Emitir CFDI</button>
            </span>
          {/if}
          <!--
            DESCUENTOS, en el hueco que dejó la propina.

            Aquí vivían los porcentajes de propina, y sobraban: en cuanto se
            pulsa «Cobrar» aparece el módulo de propina completo —porcentajes,
            campo libre y el resumen de lo que se va a cobrar—, que es además
            cuando el comensal dice cuánto deja. Tener las dos cosas hacía que se
            fijara propina en la cuenta antes de tiempo y que luego nadie supiera
            cuál de las dos cifras mandaba.

            Lo que sí hacía falta a un toque es lo contrario: rebajar. El
            escalón suelto de −10 % que estaba pegado a la cortesía se queda
            corto todos los días, así que la fila entera es de descuentos y el
            último abre la ventanita para el caso que no es ninguno de estos
            cinco.
          -->
          {#if puedeDescontar}
            <span class="grupo">
              Descuentos
              {#each DESCUENTOS_RAPIDOS as fraccion (fraccion)}
                <button
                  class="mini"
                  onclick={() =>
                    pos.aplicarDescuento(fraccion, `Descuento de ${porcentajeLegible(fraccion)}`)}
                >
                  {porcentajeLegible(fraccion)}
                </button>
              {/each}
              <button class="mini" onclick={abrirDescuento}>Descuento específico</button>
            </span>
          {/if}
          <!--
            La cortesía se queda sola en su grupo, sin rótulo: el botón se
            nombra a sí mismo y el grupo de al lado ya dice «Descuentos», que es
            lo que antes se confundía con el −10 % que colgaba de aquí.
          -->
          {#if puedeCortesia}
            <span class="grupo">
              <!--
                Abre «¿Qué se regala?». Se queda ENCENDIDO mientras haya algo
                regalado, y dice qué: así se ve de lejos que la mesa tiene
                cortesía. Para quitarla se abre la misma ventana y se desmarca;
                antes era un interruptor porque solo había una cosa que quitar.
              -->
              <button
                class="mini"
                class:on={cortesiasPuestas.length > 0}
                aria-pressed={cortesiasPuestas.length > 0}
                onclick={abrirCortesia}
              >
                {#if cortesiaToda}
                  Cortesía ✓ · toda la cuenta
                {:else if productosRegalados > 0}
                  Cortesía ✓ · {productosRegalados}
                  {productosRegalados === 1 ? "producto" : "productos"}
                {:else}
                  Cortesía
                {/if}
              </button>
            </span>
          {/if}
          <!--
            Cortesía por socio: se cobra contra la bolsa mensual del socio. La
            venta NO se toca —el socio consumió— y por eso sigue completa en
            finanzas y en inteligencia; lo que cambia es de dónde salió el dinero.
          -->
          {#if puedeSocio && socios.activos.length > 0}
            <span class="grupo">
              Socios
              <button class="mini" onclick={abrirSocio}>Cortesía por socio</button>
            </span>
          {/if}
        </div>
      {/if}

      <div class="btns">
        <!--
          ICONO **MÁS** PALABRA, SIEMPRE, en todo lo que mueve dinero. El icono
          acelera el reconocimiento cuando la fila espera; la palabra evita el
          error caro. Ninguno de estos cuatro va nunca desnudo.
        -->
        <button
          class="b1"
          disabled={pos.pendientes.length === 0}
          onclick={() => pos.enviarACocina()}
        >
          {#if pos.pendientes.length === 0}
            <Icono nombre="guardar" tam={19} />
            Todo enviado a cocina
          {:else}
            <Icono nombre="enviar-cocina" tam={19} />
            Enviar a cocina ({pos.pendientes.length})
          {/if}
        </button>
        <!--
          La cuenta va ANTES del cobro, que es el orden real de una mesa: el
          comensal ve lo que debe, y luego se le cobra. Sale con el IVA dentro
          de cada renglón para que la suma cuadre a ojo.
        -->
        <button
          class="b2"
          disabled={!pos.hayCuenta}
          onclick={() => pos.imprimirPrecuenta()}
        >
          <Icono nombre="imprimir" tam={17} />
          Imprimir cuenta
        </button>
        <!--
          El cobro solo para quien cobra. El mesero se queda con lo suyo —abrir,
          capturar, enviar a cocina e imprimir la cuenta—, que es hasta donde
          llega su trabajo: el dinero se toca en la caja.
        -->
        {#if puedeCobrar}
          <button
            class="b2 cobrar"
            disabled={!pos.hayCuenta}
            onclick={() => irA({ vista: "cobro" })}
          >
            <Icono nombre="cobrar" tam={17} />
            Cobrar {mxn(t.saldo)}
          </button>
        {/if}
        <!--
          LIBERAR LA MESA, aquí y no solo en el plano.

          Es donde hace falta: quien acaba de mirar lo que pidió la mesa y ve que
          está vacía o que se sentaron en otra es quien quiere soltarla, y tener
          que volver al plano para eso es un viaje de ida y vuelta a media
          atención. `puedeLiberarMesa` ya impide soltarla si hay algo cobrado o
          enviado a cocina, así que el botón solo aparece cuando de verdad se
          puede: no hace falta preguntar «¿seguro?» a algo que no destruye nada.
        -->
        {#if pos.puedeLiberarMesa}
          <button class="b2 liberar" onclick={() => pos.liberarMesa()}>
            <Icono nombre="liberar-mesa" tam={17} />
            Liberar mesa
          </button>
        {/if}
      </div>
    {:else if paso.vista === "cobro"}
      <div class="panel-cobro">
        <p class="titulo-panel">Cobrar {mxn(t.saldo)}</p>

        <div class="formas">
          {#each FORMAS_PAGO_MANUALES as forma (forma.valor)}
            <button
              class="mini"
              class:on={paso.forma === forma.valor}
              onclick={() => fijar({ forma: forma.valor })}
            >
              {forma.etiqueta}
            </button>
          {/each}
          <!--
            La mesa junta lo que trae suelto y el resto lo pasa con plástico.
            No es una forma de pago nueva: al registrarlo se asientan DOS pagos,
            uno de cada forma, para que el corte siga sabiendo cuánto entró al
            cajón y las finanzas cuánto se depositará por terminal.
          -->
          <button
            class="mini"
            class:on={paso.forma === "mixto"}
            onclick={() => fijar({ forma: "mixto" })}
          >
            Tarjeta y efectivo
          </button>
        </div>

        <!--
          La propina se decide AQUÍ, al cobrar, porque es cuando el comensal
          dice cuánto deja. Los porcentajes cubren el caso rápido; el campo
          libre existe porque la propina real casi nunca es un porcentaje
          redondo: se redondea la cuenta, se deja lo que sobra del efectivo o
          se da una cifra cerrada.
        -->
        <div class="propinas">
          <span class="etiqueta-propina">Propina</span>
          <div class="opciones-propina">
            {#each [0.1, 0.15, 0.2] as pct (pct)}
              <button
                class="mini"
                class:on={t.propina > 0 && t.propina === Math.round(t.total * pct)}
                onclick={() => { pos.propinaPorcentaje(pct); fijar({ propinaLibre: "" }); }}
              >
                {Math.round(pct * 100)}%
              </button>
            {/each}
            <!--
              Texto y no `type="number"`: con un input numérico Svelte convierte
              el valor a número, y la comprobación que había aquí reventaba en el
              primer dígito. Era la razón de que solo se guardaran las propinas
              puestas por porcentaje.
            -->
            <input
              class="monto-propina"
              type="text"
              inputmode="decimal"
              value={paso.propinaLibre}
              oninput={(e) => propinaTecleada(e.currentTarget.value)}
              onchange={() => aplicarPropinaLibre()}
              placeholder="Otra"
              aria-label="Propina en pesos"
            />
            {#if t.propina > 0}
              <button
                class="mini quitar"
                onclick={() => { pos.propinaPorcentaje(0); fijar({ propinaLibre: "" }); }}
              >
                Quitar
              </button>
            {/if}
          </div>
          {#if t.propina > 0}
            <p class="resumen-propina">
              Propina <b>{mxn(t.propina)}</b> · total a cobrar <b>{mxn(sumar(t.total, t.propina))}</b>
            </p>
          {/if}
        </div>

        {#if paso.forma === "mixto"}
          <div class="mixto">
            <label class="campo">
              <span>Cuánto pagan en efectivo</span>
              <input
                type="text"
                inputmode="decimal"
                value={paso.efectivoMixto}
                oninput={(e) => fijar({ efectivoMixto: e.currentTarget.value })}
                placeholder="0.00"
              />
            </label>
            <label class="campo">
              <span>El resto, con</span>
              <select
                value={paso.formaTarjeta}
                onchange={(e) => fijar({ formaTarjeta: e.currentTarget.value as FormaPago })}
              >
                {#each FORMAS_PAGO_MANUALES.filter((f) => !f.efectivo) as forma (forma.valor)}
                  <option value={forma.valor}>{forma.etiqueta}</option>
                {/each}
              </select>
            </label>
            <p class="reparto">
              Efectivo <b>{mxn(enEfectivo)}</b> · tarjeta <b>{mxn(conTarjeta)}</b>
            </p>
          </div>
        {/if}

        <!--
          SOLO EN EFECTIVO PURO.

          En un cobro mixto salían dos campos de efectivo seguidos —«cuánto
          pagan en efectivo» y «efectivo que entregó»— y el cajero no tenía cómo
          saber cuál era cuál a media noche de viernes. No hacen falta los dos:
          en un mixto el comensal dice cuánto pone en efectivo y el resto va con
          tarjeta, así que esa cantidad es exacta y no hay cambio que devolver.
          El campo de arriba, dentro del recuadro del mixto, ya lo cubre.
        -->
        {#if paso.forma === "efectivo"}
          <label class="campo">
            <span>Recibido</span>
            <input
              type="text"
              inputmode="decimal"
              value={paso.recibido}
              oninput={(e) => fijar({ recibido: e.currentTarget.value })}
              placeholder="0.00"
            />
          </label>
          {#if cambio > 0}
            <p class="cambio">Cambio: <b>{mxn(cambio)}</b></p>
          {/if}
        {/if}

        <button class="b1" onclick={cobrarAhora}>Registrar pago</button>

        <div class="dividir">
          <span>Dividir en</span>
          <button class="mini" onclick={() => fijar({ partes: Math.max(2, paso.partes - 1) })}>−</button>
          <b>{paso.partes}</b>
          <button class="mini" onclick={() => fijar({ partes: Math.min(20, paso.partes + 1) })}>+</button>
          <span class="cada">{mxn(repartir(sumar(t.total, t.propina), paso.partes)[0] ?? CERO)} c/u</span>
          <button class="mini" onclick={dividir}>Dividir y cobrar</button>
        </div>

        <button class="volver" onclick={() => irA({ vista: "cuenta" })}>← Volver a la cuenta</button>
      </div>
    {:else if paso.vista === "socio"}
      <!--
        CORTESÍA POR SOCIO.

        El socio consume contra la bolsa que tiene pactada al mes. Se registra
        como cobro y no como cortesía de la casa: el consumo ocurrió y la venta
        tiene que seguir contando completa en finanzas y en inteligencia. Lo
        único que cambia es que el dinero no entra al cajón.
      -->
      <div class="panel-cobro">
        <p class="titulo-panel">Cortesía por socio</p>

        <div class="socios-lista">
          {#each socios.activos as socio (socio.socio_id)}
            {@const bolsa = socios.bolsa(socio)}
            <button
              class="socio"
              class:on={paso.socioElegido === socio.socio_id}
              class:agotado={bolsa.disponible <= 0}
              onclick={() => fijar({ socioElegido: socio.socio_id })}
            >
              <span class="nom">{socio.nombre}</span>
              <span class="bolsa">
                {#if bolsa.tope <= 0}
                  Sin bolsa pactada
                {:else}
                  Le quedan <b>{mxn(bolsa.disponible)}</b> de {mxn(bolsa.tope)} este mes
                {/if}
              </span>
            </button>
          {/each}
        </div>

        {#if socioElegido && bolsaSocio}
          <label class="campo">
            <span>Cuánto se le carga</span>
            <input
              type="text"
              inputmode="decimal"
              value={paso.montoSocio}
              oninput={(e) => fijar({ montoSocio: e.currentTarget.value })}
              placeholder={mxn(Math.min(t.saldo, bolsaSocio.disponible) as Centavos)}
            />
          </label>
          <p class="ayuda-socio">
            En blanco se carga todo lo que se pueda de esta cuenta.
            {#if bolsaSocio.credito > 0}
              De su tope, <b>{mxn(bolsaSocio.credito)}</b> es crédito a liquidar a
              fin de mes.
            {/if}
          </p>
          {#if problemaSocio}
            <p class="error-socio" role="alert">{problemaSocio}</p>
          {/if}
          <button class="b1" disabled={!!problemaSocio} onclick={cargarASocio}>
            Cargar {mxn(cargoSocio)} a {socioElegido.nombre}
          </button>
        {:else}
          <p class="ayuda-socio">Elige de quién es el consumo.</p>
        {/if}

        <button class="volver" onclick={() => irA({ vista: "cuenta" })}>
          ← Volver a la cuenta
        </button>
      </div>
    {:else}
      <div class="panel-cobro">
        <p class="titulo-panel">Traspasar a la mesa…</p>
        <div class="mesas-destino">
          {#each plano.todasLasMesas.filter((m) => m.id !== pos.mesaActiva) as mesa (mesa.id)}
            <button class="mini" onclick={() => traspasar(mesa.id)}>{mesa.nombre}</button>
          {/each}
        </div>
        <button class="volver" onclick={() => fijar({ renglonATraspasar: null, vista: "cuenta" })}>
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
    <div class="toast" role="status">
      <span>{pos.mensaje}</span>
      {#if pos.deshacer}
        <button class="deshacer" onclick={() => pos.deshacer?.hacer()}>
          {pos.deshacer.etiqueta}
        </button>
      {/if}
    </div>
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

<!--
  Descuento a la medida, cuando ninguno de los cinco escalones sirve.

  Mismo armazón que las otras dos ventanitas de esta pantalla (`.velo-op` +
  `.op`) y los mismos controles que el panel de cortesía por socio: quien cobra
  ya sabe leerlos, y un diálogo de dinero no es el sitio para estrenar un
  lenguaje visual propio.
-->
{#if descontando}
  <div class="velo-op" role="presentation" onclick={() => (descontando = false)}></div>
  <div class="op" role="dialog" aria-modal="true" aria-label="Descuento específico">
    <h3>Descuento específico</h3>
    <p class="pista-nombre">
      Se rebaja de la cuenta completa de la mesa {pos.nombreMesaActiva}. Queda en
      la bitácora con tu motivo y con quién lo autorizó.
    </p>

    <div class="modo-descuento">
      <button
        class="mini"
        class:on={modoDescuento === "porcentaje"}
        aria-pressed={modoDescuento === "porcentaje"}
        onclick={() => (modoDescuento = "porcentaje")}
      >
        Porcentaje (%)
      </button>
      <button
        class="mini"
        class:on={modoDescuento === "monto"}
        aria-pressed={modoDescuento === "monto"}
        onclick={() => (modoDescuento = "monto")}
      >
        Monto ($)
      </button>
    </div>

    <div class="campos-descuento">
      <label class="campo">
        <span>{modoDescuento === "porcentaje" ? "Cuánto por ciento" : "Cuántos pesos"}</span>
        <!--
          Texto con teclado decimal, nunca `type="number"`: es el defecto que
          tuvo el campo de propina de esta misma pantalla durante meses.
        -->
        <input
          type="text"
          inputmode="decimal"
          bind:value={valorDescuento}
          placeholder={modoDescuento === "porcentaje" ? "12.5" : "150.00"}
        />
      </label>
      <label class="campo">
        <span>Motivo (sale en la bitácora)</span>
        <input type="text" bind:value={motivoDescuento} placeholder={MOTIVO_ESPECIFICO} />
      </label>
    </div>

    <!--
      Lo que va a pasar, antes de que pase. La cifra sale de proyectar la
      comanda con el descuento puesto, así que es exactamente la que se va a
      cobrar: ni una aproximación ni una regla de tres.
    -->
    {#if previaDescuento}
      <p class="previa-descuento">
        Se rebajan <b>{mxn(previaDescuento.rebaja)}</b> · la cuenta quedaría en
        <b>{mxn(previaDescuento.queda)}</b>
      </p>
    {:else if problemaDescuento}
      <p class="error-descuento" role="alert">{problemaDescuento}</p>
    {:else}
      <p class="ayuda-descuento">Escribe cuánto se le rebaja a esta cuenta.</p>
    {/if}

    <button class="b1" disabled={!descuentoValido} onclick={aplicarDescuentoEspecifico}>
      Aplicar descuento
    </button>
    <button class="saltar" onclick={() => (descontando = false)}>Cancelar</button>
  </div>
{/if}

<!--
  «¿QUÉ SE REGALA?» — la cortesía por producto.

  Mismo armazón que el descuento específico (`.velo-op` + `.op`, la previa y
  el botón grande): es otro diálogo de dinero de la misma pantalla y se lee
  igual. Lo propio es la lista de renglones, con casilla y, en los de varias
  piezas, cuántas se regalan.
-->
{#if regalando}
  <div class="velo-op" role="presentation" onclick={() => (regalando = false)}></div>
  <div class="op op-cortesia" role="dialog" aria-modal="true" aria-label="¿Qué se regala?">
    <h3>¿Qué se regala?</h3>
    <p class="pista-nombre">
      Mesa {pos.nombreMesaActiva}. Queda en la bitácora qué se regaló, el motivo
      y quién lo autorizó.
    </p>

    <button class="regalo-fila toda" class:on={regalarToda} aria-pressed={regalarToda} onclick={alternarToda}>
      <span class="casilla" aria-hidden="true">{regalarToda ? "✓" : ""}</span>
      <span class="que">Toda la cuenta</span>
    </button>

    <p class="o-bien">o solo algunos productos</p>
    <ul class="regalos">
      {#each pos.renglones as r (r.id)}
        {@const n = regalarToda ? r.cantidad : (piezasRegalo[r.id] ?? 0)}
        <li>
          <button
            class="regalo-fila"
            class:on={n > 0}
            aria-pressed={n > 0}
            disabled={regalarToda}
            onclick={() => alternarRenglonRegalo(r)}
          >
            <span class="casilla" aria-hidden="true">{n > 0 ? "✓" : ""}</span>
            <span class="que">{r.cantidad > 1 ? `${r.cantidad}× ` : ""}{r.descripcion}</span>
            <span class="cuanto">{mxn(conImpuesto(r))}</span>
          </button>
          <!--
            Solo en los renglones de varias piezas: tres cervezas son un renglón,
            y «regálale una» es el caso de todos los días.
          -->
          {#if r.cantidad > 1 && n > 0 && !regalarToda}
            <div class="piezas" use:revelar>
              <span>Se regalan</span>
              <button onclick={() => cambiarPiezasRegalo(r, -1)} aria-label="Regalar una pieza menos">−</button>
              <b>{n} de {r.cantidad}</b>
              <button
                onclick={() => cambiarPiezasRegalo(r, 1)}
                disabled={n >= r.cantidad}
                aria-label="Regalar una pieza más"
              >+</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="motivos">
      {#each MOTIVOS_CORTESIA as motivo (motivo)}
        <button
          class="mini"
          class:on={motivoCortesia === motivo}
          aria-pressed={motivoCortesia === motivo}
          onclick={() => (motivoCortesia = motivo)}
        >
          {motivo}
        </button>
      {/each}
    </div>
    <label class="campo motivo-cortesia">
      <span>Motivo (sale en la bitácora)</span>
      <input type="text" bind:value={motivoCortesia} placeholder={MOTIVOS_CORTESIA[0]} />
    </label>

    {#if previaCortesia && previaCortesia.regalo > 0}
      <p class="previa-descuento">
        Se regalan <b>{mxn(previaCortesia.regalo)}</b> · la cuenta quedaría en
        <b>{mxn(previaCortesia.queda)}</b>
      </p>
    {:else}
      <p class="ayuda-descuento">
        {cortesiasPuestas.length > 0
          ? "Sin nada marcado, se retira la cortesía y la cuenta vuelve a cobrarse completa."
          : "Marca lo que se regala."}
      </p>
    {/if}

    <button
      class="b1"
      disabled={nadaMarcado && cortesiasPuestas.length === 0}
      onclick={aplicarCortesia}
    >
      {nadaMarcado ? "Quitar la cortesía" : "Aplicar cortesía"}
    </button>
    <button class="saltar" onclick={() => (regalando = false)}>Cancelar</button>
  </div>
{/if}

<style>
  /* --- ¿Qué se regala? --- */
  .op-cortesia {
    /* Una cuenta de doce renglones no cabe en la ventanita del descuento. */
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    display: flex;
    flex-direction: column;
  }
  .regalos {
    list-style: none;
    margin: 0 0 0.7rem;
    padding: 0;
    overflow-y: auto;
    min-height: 3rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .regalo-fila {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    background: #fff;
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    cursor: pointer;
  }
  .regalo-fila.on {
    border-color: var(--acento);
    background: var(--claro);
  }
  .regalo-fila:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .regalo-fila.toda {
    font-weight: 700;
  }
  .casilla {
    flex: none;
    width: 1.3rem;
    height: 1.3rem;
    border: 1.5px solid var(--borde);
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--sobre-acento);
  }
  .regalo-fila.on .casilla {
    background: var(--acento);
    border-color: var(--acento);
  }
  .regalo-fila .que {
    flex: 1;
  }
  .regalo-fila .cuanto {
    font-variant-numeric: tabular-nums;
    color: var(--gris);
  }
  .o-bien {
    margin: 0.55rem 0 0.4rem;
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .piezas {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.45rem;
    padding: 0.3rem 0.4rem 0.1rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .piezas button {
    width: 2rem;
    height: 2rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: #fff;
    font-size: 1rem;
    font-weight: 700;
  }
  .piezas button:disabled {
    opacity: 0.4;
  }
  .piezas b {
    color: var(--pizarra);
    font-variant-numeric: tabular-nums;
    min-width: 3.5rem;
    text-align: center;
  }
  .motivos {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }
  .motivo-cortesia {
    text-align: left;
    margin-bottom: 0.7rem;
  }
  /* La marca en el renglón: la misma píldora de estado, en tono de regalo. */
  .est-r.regalo {
    margin-left: 0.3rem;
    color: #7a3d0c;
    background: #fdeee2;
  }

  .cuenta {
    position: relative;
    background: #fff;
    border-left: 1px solid var(--borde);
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    overflow-y: auto;
  }
  /*
   * LA PROPINA QUE ESPERA. Vive dentro de la cuenta y no encima de todo, así que
   * tiene que llamar la atención sin secuestrarla: borde naranja y un fondo
   * cálido bastan para que no se pase por alto entre dos comandas.
   */
  .propina-espera {
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    background: var(--claro);
    padding: 0.85rem 0.9rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    flex: none;
  }
  .cabecera-espera {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .cabecera-espera h3 {
    font-family: var(--font-titulo);
    font-size: 1rem;
    font-weight: 700;
  }
  .chip-espera {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--acento-texto);
  }
  .pista-espera {
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--pizarra);
  }
  .campos-espera {
    display: flex;
    gap: 0.5rem;
  }
  .campos-espera label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .campos-espera span {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos-espera input,
  .campos-espera select {
    padding: 0.5rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  .campos-espera input:focus,
  .campos-espera select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .registrar-espera {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    font-size: 0.92rem;
  }
  /*
   * «No dejó propina» EN SU PROPIO RECUADRO NARANJA TENUE.
   *
   * Es la mitad de la decisión y no un descarte: la mitad de las mesas no dejan
   * propina. Como texto suelto se buscaba durante varios segundos con el
   * comensal delante. En naranja tenue —no sólido— queda claro que es la
   * alternativa, no la acción principal.
   */
  .sin-propina {
    border: 1.5px solid rgba(242, 133, 58, 0.55);
    background: rgba(242, 133, 58, 0.12);
    color: #a2521c;
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .sin-propina:hover {
    background: rgba(242, 133, 58, 0.22);
    border-color: var(--acento);
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
    color: var(--acento-texto);
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
    color: var(--acento-texto);
  }
  .cant b {
    font-family: var(--font-titulo);
    color: var(--acento-texto);
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
    color: var(--acento-texto);
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.08rem 0.4rem;
  }
  /*
   * «LISTO» LATE; LOS DEMÁS ESTADOS NO.
   *
   * El mesero mira este panel de reojo, entre mesa y mesa. Un platillo listo es
   * lo único que le pide algo —recogerlo antes de que se enfríe—, así que es lo
   * único que se mueve: si parpadeara todo, no destacaría nada. La animación es
   * un halo suave y lento a propósito; un destello rápido en una pantalla que se
   * tiene delante ocho horas cansa y se acaba ignorando.
   */
  .est-r.avisa {
    color: var(--sobre-acento);
    background: var(--acento);
    animation: latido-listo 1.6s ease-in-out infinite;
  }
  @keyframes latido-listo {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--acento) 55%, transparent);
    }
    55% {
      box-shadow: 0 0 0 0.28rem color-mix(in srgb, var(--acento) 0%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .est-r.avisa {
      animation: none;
    }
  }
  .acciones .mini.entregar:hover {
    color: var(--acento-texto);
  }
  /* Cuando el platillo ya está listo, el visto bueno se enciende: es el gesto
     que toca hacer en ese momento. */
  .acciones .mini.entregar.urge {
    color: var(--acento-texto);
    font-weight: 800;
  }
  .item .p {
    font-weight: 600;
    white-space: nowrap;
  }
  .acciones {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
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
    color: var(--acento-texto);
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  /*
   * SUPERFICIE DE TOQUE DE VERDAD.
   *
   * 2rem = 32px. No llega a los 44 de la norma —una fila de renglón no da para
   * tanto sin volverse una lista de tres platillos por pantalla—, pero es un
   * 60% más de blanco que los ~20px de antes, y sobre todo ahora están
   * SEPARADOS: 0.3rem entre ellos y el doble antes del que cancela.
   */
  .acciones .mini.glifo {
    border: none;
    color: var(--gris);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    min-height: 2rem;
    padding: 0;
    border-radius: var(--r-sm);
  }
  .acciones .mini.glifo:hover {
    background: var(--borde-2, rgba(20, 24, 26, 0.06));
    color: var(--pizarra);
  }
  /*
   * El separador antes de «cancelar». Es un hueco, no una raya: basta con que
   * el dedo tenga que viajar para llegar ahí.
   */
  .aparta {
    width: 0.4rem;
    flex: none;
  }
  /*
   * EL ROJO YA NO ESPERA AL MOUSE.
   *
   * Estaba en `:hover`, y en la tableta del salón —que es donde se usa— no hay
   * hover: el único aviso de que ese botón cancela un platillo no aparecía
   * jamás. Ahora se ve siempre.
   */
  .acciones .glifo.x {
    color: var(--peligro);
  }
  .acciones .glifo.x:hover {
    background: rgba(194, 46, 33, 0.12);
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
    color: var(--acento-texto);
    font-weight: 700;
  }
  .promo .nombre {
    flex: 1;
    color: var(--pizarra);
  }
  .promo .importe {
    font-weight: 700;
    color: var(--acento-texto);
  }
  .promo .cta {
    font-size: 0.72rem;
    color: var(--gris);
  }
  /*
   * La aplicada se distingue de la ofrecida: borde sólido en vez de punteado.
   * El punteado dice «esto se puede tomar»; el sólido, «esto ya está puesto».
   * Con el mismo aspecto, el mesero volvía a pulsar la que ya había aplicado.
   */
  .promo-puesta {
    margin-top: 0.7rem;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--acento);
    border-radius: 10px;
    background: color-mix(in srgb, var(--acento) 12%, transparent);
    font-size: 0.88rem;
  }
  .promo-puesta .etiqueta {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--acento-texto);
    font-weight: 700;
  }
  .promo-puesta .nombre {
    flex: 1;
    color: var(--pizarra);
  }
  .promo-puesta .importe {
    font-weight: 700;
    color: var(--acento-texto);
  }
  .quitar-promo {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    background: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
    cursor: pointer;
  }
  .quitar-promo:hover {
    color: var(--peligro);
    border-color: var(--peligro);
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
    color: var(--acento-texto);
  }
  .tot .saldo {
    font-weight: 700;
    color: var(--acento-texto);
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
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-lg);
    padding: 0.85rem;
    min-height: var(--toque);
    font-family: var(--font-titulo);
    font-size: var(--t-md);
    font-weight: 600;
  }
  .b1:disabled {
    background: #eef1ed;
    color: #6b8f57;
    cursor: default;
  }
  .b2 {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border: 2px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem;
    min-height: var(--toque);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--pizarra);
  }
  /*
   * El borde se queda en el naranja de marca —ahí es un objeto gráfico y a
   * 3.4:1 contra el blanco cumple—, pero el rótulo pasa a `--acento-texto`:
   * como TEXTO, el naranja de marca da 2.56:1, y este botón dice cuánto se va
   * a cobrar.
   */
  .b2.cobrar {
    border-color: var(--acento);
    color: var(--acento-texto);
  }
  /*
   * Discreto: liberar es la salida de un error, no una acción del servicio.
   * Con el mismo peso que «Cobrar» acabaría pulsándose por inercia.
   */
  .b2.liberar {
    border-style: dashed;
    color: var(--gris);
    font-weight: 500;
  }
  .b2.cobrar:hover {
    background: var(--acento);
    color: var(--sobre-acento);
  }
  .propinas {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--fondo);
  }
  .etiqueta-propina {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
  }
  .opciones-propina {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  /* Estrecho: cabe una cifra de propina, no un importe de cuenta. */
  .monto-propina {
    width: 5.5rem;
    padding: 0.35rem 0.5rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.86rem;
    font-family: var(--font-cuerpo);
  }
  .opciones-propina .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: var(--sobre-acento);
  }
  .opciones-propina .mini.quitar {
    color: var(--peligro);
  }
  .resumen-propina {
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .resumen-propina b {
    color: var(--acento-texto);
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
  /* El reparto entre cajón y terminal, a la vista antes de registrar nada. */
  .mixto {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    background: var(--fondo);
  }
  .mixto select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.95rem;
    font-family: var(--font-cuerpo);
    background: #fff;
  }
  .reparto {
    font-size: 0.82rem;
    color: var(--pizarra);
  }
  .reparto b {
    color: var(--acento-texto);
  }
  .cambio {
    font-size: 0.95rem;
    color: var(--acento-texto);
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
    color: var(--acento-texto);
    font-weight: 600;
  }
  .volver {
    font-size: 0.82rem;
    color: var(--gris);
    text-decoration: underline;
    align-self: flex-start;
  }

  /* --- Cortesía por socio --- */
  .socios-lista {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .socio {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.5rem 0.7rem;
    background: #fff;
    text-align: left;
  }
  .socio:hover {
    border-color: var(--acento);
  }
  .socio.on {
    border-color: var(--acento);
    background: var(--claro);
  }
  /*
   * El que ya gastó su bolsa se atenúa pero NO se esconde: quien cobra tiene
   * que poder ver que ese socio existe y que se le acabó, o va a pensar que el
   * sistema lo perdió.
   */
  .socio.agotado {
    opacity: 0.55;
  }
  .socio .nom {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--pizarra);
  }
  .socio .bolsa {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .socio .bolsa b {
    color: var(--acento-texto);
  }
  .ayuda-socio {
    font-size: 0.78rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .error-socio {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--peligro);
    line-height: 1.4;
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
    z-index: var(--z-aviso);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: var(--negro);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 0.75rem 0.6rem 1rem;
    font-size: var(--t-sm);
    text-align: center;
    box-shadow: var(--sombra-lg);
  }
  /*
   * Alto de toque completo: este botón se pulsa con prisa, con el comensal
   * delante y con ocho segundos de plazo. Es el peor momento para fallar el
   * dedo.
   */
  .toast .deshacer {
    flex: none;
    min-height: var(--toque);
    padding: 0 0.9rem;
    border: 1.5px solid rgba(255, 255, 255, 0.35);
    border-radius: var(--r-sm);
    color: #fff;
    font: inherit;
    font-weight: 700;
    white-space: nowrap;
  }
  .toast .deshacer:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: #fff;
  }

  /* --- Indicaciones para cocina --- */

  .indicacion {
    display: block;
    color: var(--acento-texto);
    font-weight: 600;
  }
  .acciones .mini.activa {
    color: var(--acento-texto);
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
    color: var(--sobre-acento);
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
  /*
   * `.campo-modal` se retiró con la ventana de propina: era el único diálogo que
   * pedía monto y forma de pago. Ahora esos campos viven dentro de la cuenta
   * (`.campos-espera`), que no bloquea el resto del software.
   */
  .saltar {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .chip.nombre {
    background: var(--acento);
    color: var(--sobre-acento);
    border: none;
    font-weight: 700;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /*
   * MISMO TRATAMIENTO QUE `.boton-agregar` (base.css), el de «+ Insumo»,
   * «+ Ingrediente» y «+ Área»: era un punteado gris en una fila donde todos los
   * demás chips son ETIQUETAS y no botones, así que no se leía como algo que se
   * pudiera pulsar.
   *
   * Se escribe aquí en vez de usar la utilidad porque `.chip` ya declara borde,
   * fondo y color, y con la clase de ámbito de Svelte gana por especificidad a
   * cualquier regla global. Excluir el chip de `.chip` habría dejado la regla a
   * la par de `.chip.gray` y `.chip.cocina` —y por delante en la cascada—,
   * despintando los chips que sí son etiquetas.
   */
  .chip.poner-nombre {
    border: 1.5px solid var(--acento);
    background: var(--blanco);
    color: var(--acento-texto);
    font-weight: 600;
    box-shadow: 0 2px 6px rgba(242, 133, 58, 0.28);
  }
  .chip.poner-nombre:hover {
    background: var(--claro);
    box-shadow: 0 3px 10px rgba(242, 133, 58, 0.38);
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
    color: var(--acento-texto);
  }
  .acciones-cobrada {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }

  /* --- Descuento específico --- */
  /*
   * Casi todo es prestado: el armazón de las otras ventanitas (`.velo-op`,
   * `.op`, `.pista-nombre`, `.saltar`) y los controles del panel de socio
   * (`.campo`, `.mini`, `.b1` — que además ya trae el estado apagado del botón
   * cuando lo tecleado no vale). Lo propio es solo esto.
   */
  .modo-descuento {
    display: flex;
    justify-content: center;
    gap: 0.35rem;
    margin-bottom: 0.7rem;
  }
  /* Los rótulos de los campos se leen a la izquierda; `.op` centra su texto. */
  .campos-descuento {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    text-align: left;
    margin-bottom: 0.7rem;
  }
  .previa-descuento {
    font-size: 0.85rem;
    color: var(--pizarra);
    line-height: 1.45;
    margin-bottom: 0.7rem;
  }
  .previa-descuento b {
    color: var(--acento-texto);
  }
  .error-descuento {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--peligro);
    line-height: 1.4;
    margin-bottom: 0.7rem;
  }
  .ayuda-descuento {
    font-size: 0.8rem;
    color: var(--gris);
    margin-bottom: 0.7rem;
  }
</style>
