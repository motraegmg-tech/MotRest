/**
 * Plantillas de impresión, versionadas.
 *
 * La versión viaja en el documento porque un ticket es un comprobante: si
 * mañana cambia el formato, hay que poder saber con qué plantilla se imprimió
 * el que un comensal trae en la mano tres semanas después.
 *
 * Cada plantilla recibe DATOS YA CALCULADOS, nunca el estado crudo. Recalcular
 * un total al imprimir abriría la puerta a que el papel diga una cosa y la
 * cuenta otra — y el papel es el que se lleva el cliente.
 */
import { aPesos, type Centavos, type RepresentacionImpresa } from "@motrest/dominio";
import { Ticket, type Alineacion, type ImagenMonocroma } from "./escpos.js";

export const VERSION_PLANTILLAS = 1;

/** 32 columnas = papel de 58 mm; 42 = papel de 80 mm. */
export type AnchoPapel = 32 | 42;

const dinero = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

function mxn(monto: Centavos): string {
  return dinero.format(aPesos(monto));
}

function fechaHora(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(ts));
}

// --- Comanda de cocina --------------------------------------------------------------

export interface RenglonComanda {
  cantidad: number;
  descripcion: string;
  detalle?: string;
  notas?: string;
}

export interface DatosComanda {
  orden_id: string;
  mesa: string;
  mesero: string;
  /**
   * A nombre de quién va, para los pedidos PARA LLEVAR.
   *
   * Sin esto cocina prepara y nadie sabe de quién es la bolsa del mostrador:
   * el número de "mesa" de un pedido para llevar no le dice nada a nadie.
   */
  a_nombre_de?: string;
  estacion?: string;
  ts: number;
  renglones: RenglonComanda[];
  /** Número de reimpresión. 0 = original. */
  reimpresion?: number;
}

/**
 * Comanda para la cocina.
 *
 * Tipografía grande y sin precios: a la cocina no le importa cuánto cuesta, le
 * importa qué preparar y para qué mesa. Meter importes solo añade ruido en una
 * hoja que se lee de reojo con las manos ocupadas.
 */
export function comandaCocina(datos: DatosComanda, columnas: AnchoPapel = 42): Ticket {
  const t = new Ticket(columnas);

  if (datos.reimpresion && datos.reimpresion > 0) {
    t.linea(`** REIMPRESION #${datos.reimpresion} **`, {
      alineacion: "centro",
      negrita: true,
    });
  }

  t.linea(datos.estacion ?? "COCINA", {
    alineacion: "centro",
    negrita: true,
    doble_alto: true,
  });
  t.separador("=");

  t.linea(`MESA ${datos.mesa}`, { negrita: true, doble_alto: true, doble_ancho: true });
  /*
   * El nombre va GRANDE y justo debajo de la mesa: en un pedido para llevar es
   * el único dato que sirve para entregar la bolsa correcta, y el número de
   * "mesa" no le dice nada a nadie en el mostrador.
   */
  if (datos.a_nombre_de) {
    t.linea(datos.a_nombre_de.toUpperCase(), { negrita: true, doble_alto: true });
  }
  t.columnasDobles(datos.mesero, fechaHora(datos.ts));
  t.separador();

  for (const renglon of datos.renglones) {
    t.linea(`${renglon.cantidad}x ${renglon.descripcion}`, {
      negrita: true,
      doble_alto: true,
    });
    if (renglon.detalle) t.linea(`   ${renglon.detalle}`);
    // Las notas van resaltadas: son alergias, "sin cebolla", "bien cocido".
    // Es lo que más caro cuesta pasar por alto.
    if (renglon.notas) t.linea(`   >> ${renglon.notas}`, { negrita: true });
    t.salto();
  }

  t.separador("=");
  t.linea(datos.orden_id.slice(0, 18), { alineacion: "centro" });
  return t.cortar();
}

// --- Ticket de venta -----------------------------------------------------------------

export interface RenglonTicket {
  cantidad: number;
  descripcion: string;
  detalle?: string;
  importe: Centavos;
}

export interface PagoTicket {
  forma: string;
  monto: Centavos;
}

export interface DatosTicket {
  folio: string;
  ts: number;
  local: {
    nombre: string;
    direccion?: string;
    rfc?: string;
    telefono?: string;
  };
  mesa: string;
  mesero: string;
  renglones: RenglonTicket[];
  subtotal: Centavos;
  descuentos: Centavos;
  cortesias: Centavos;
  iva: Centavos;
  ieps: Centavos;
  total: Centavos;
  propina: Centavos;
  pagos: PagoTicket[];
  cambio: Centavos;
  /** URL de autofactura; se imprime como QR si viene. */
  url_autofactura?: string;
  /**
   * URL de la encuesta de esta cuenta; se imprime como QR si viene.
   *
   * Es el MISMO enlace firmado que la caja enseña en pantalla al cobrar. En el
   * papel llega más lejos: la pantalla solo la ve quien está pagando y dura lo
   * que dura el cobro, mientras que el ticket se lo lleva el comensal y lo mira
   * otra vez en la mesa, o al día siguiente en la bolsa del pantalón.
   */
  url_opinion?: string;
  reimpresion?: number;
  /** Textos que el restaurante puede cambiar. Ver `TextosTicket`. */
  textos?: TextosTicket;
}

/**
 * Lo que el restaurante puede escribir en su propio ticket.
 *
 * Todo lo demás del ticket son datos —importes, folio, impuestos— y no se
 * edita: cambiarlos no sería personalizar, sería falsear un comprobante. Aquí
 * solo caben las frases que le hablan al comensal.
 *
 * El pie de MOTRAE no está en esta lista a propósito: es la firma de quién hizo
 * el software, no un mensaje del restaurante.
 */
export interface TextosTicket {
  /** Debajo de los datos del local. Vacío = no se imprime. */
  encabezado?: string;
  /** Sobre el QR de facturación. */
  invitacion_factura?: string;
  /** Sobre el QR de la encuesta. */
  invitacion_opinion?: string;
  /** La despedida. */
  agradecimiento?: string;
  /** Una línea libre al final, antes de la firma. Vacío = no se imprime. */
  pie?: string;
}

/** Lo que dice el ticket si el restaurante no ha cambiado nada. */
export const TEXTOS_TICKET_POR_DEFECTO: Required<Omit<TextosTicket, "encabezado" | "pie">> & {
  encabezado: string;
  pie: string;
} = {
  encabezado: "",
  invitacion_factura: "Factura tu consumo",
  invitacion_opinion: "¿Cómo estuvo todo? Cuéntanos",
  agradecimiento: "¡Gracias por su visita!",
  pie: "",
};

/**
 * La firma de MOTRAE. NO es configurable.
 *
 * Va en cada ticket que imprime el producto: es de dónde salió el software, no
 * un mensaje del restaurante. Antes decía `MotRest v1` —la versión de la
 * plantilla— que no le dice nada a nadie y parecía un número de serie perdido.
 */
const FIRMA_MOTRAE = "MotRest by Motrae";

export function ticketVenta(datos: DatosTicket, columnas: AnchoPapel = 42): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };

  if (datos.reimpresion && datos.reimpresion > 0) {
    t.linea(`** REIMPRESION #${datos.reimpresion} **`, { ...centrado, negrita: true });
    t.salto();
  }

  t.linea(datos.local.nombre, { ...centrado, negrita: true, doble_alto: true });
  if (datos.local.direccion) t.linea(datos.local.direccion, centrado);
  if (datos.local.rfc) t.linea(`RFC: ${datos.local.rfc}`, centrado);
  if (datos.local.telefono) t.linea(`Tel: ${datos.local.telefono}`, centrado);

  // El mensaje del local va tras sus datos y antes de la línea: es su voz, no
  // parte del comprobante. Se parte por palabras para que no se corte a mitad.
  {
    const cabecera = { ...TEXTOS_TICKET_POR_DEFECTO, ...(datos.textos ?? {}) }.encabezado;
    if (cabecera) for (const l of envolverPalabras(cabecera, columnas)) t.linea(l, centrado);
  }
  t.separador("=");

  t.columnasDobles(`Folio: ${datos.folio}`, fechaHora(datos.ts));
  t.columnasDobles(`Mesa: ${datos.mesa}`, datos.mesero);
  t.separador();

  for (const renglon of datos.renglones) {
    t.columnasDobles(`${renglon.cantidad}x ${renglon.descripcion}`, mxn(renglon.importe));
    if (renglon.detalle) t.linea(`   ${renglon.detalle}`);
  }

  t.separador();
  t.columnasDobles("Subtotal", mxn(datos.subtotal));
  // Lo rebajado se imprime SIEMPRE que exista: el comensal tiene derecho a ver
  // que su descuento se aplicó, y el gerente a que quede rastro en el papel.
  if (datos.descuentos > 0) t.columnasDobles("Descuentos", `-${mxn(datos.descuentos)}`);
  if (datos.cortesias > 0) t.columnasDobles("Cortesias", `-${mxn(datos.cortesias)}`);
  if (datos.iva > 0) t.columnasDobles("IVA", mxn(datos.iva));
  if (datos.ieps > 0) t.columnasDobles("IEPS", mxn(datos.ieps));

  t.columnasDobles("TOTAL", mxn(datos.total), { negrita: true, doble_alto: true });

  if (datos.propina > 0) {
    t.columnasDobles("Propina", mxn(datos.propina));
    t.columnasDobles("Total con propina", mxn((datos.total + datos.propina) as Centavos), {
      negrita: true,
    });
  }

  t.separador();
  for (const pago of datos.pagos) {
    t.columnasDobles(pago.forma, mxn(pago.monto));
  }
  if (datos.cambio > 0) t.columnasDobles("Cambio", mxn(datos.cambio), { negrita: true });

  const txt = { ...TEXTOS_TICKET_POR_DEFECTO, ...(datos.textos ?? {}) };

  if (datos.url_autofactura) {
    t.salto();
    t.linea(txt.invitacion_factura, { ...centrado, negrita: true });
    t.qr(datos.url_autofactura);
    t.linea(`Folio ${datos.folio}`, centrado);
  }

  /*
   * El QR de la encuesta va DESPUÉS del de facturación y antes del adiós.
   *
   * Ese orden no es casual: facturar es un trámite con prisa —quien lo necesita
   * lo busca— y opinar es voluntario. Ponerlo primero le quitaría sitio a lo que
   * el comensal vino a buscar; ponerlo al final, junto al «gracias», lo deja
   * donde la vista se queda cuando ya terminó de mirar los importes.
   */
  if (datos.url_opinion) {
    t.salto();
    t.linea(txt.invitacion_opinion, { ...centrado, negrita: true });
    t.qr(datos.url_opinion);
  }

  t.salto();
  if (txt.agradecimiento) t.linea(txt.agradecimiento, centrado);
  if (txt.pie) for (const l of envolverPalabras(txt.pie, columnas)) t.linea(l, centrado);
  t.linea(FIRMA_MOTRAE, centrado);
  return t.cortar();
}

// --- Pre-cuenta ----------------------------------------------------------------------

export interface RenglonPrecuenta {
  cantidad: number;
  descripcion: string;
  detalle?: string;
  /**
   * Importe de línea **con impuesto**: lo que el comensal paga por ese renglón.
   *
   * A diferencia del ticket, aquí NO se imprime la base sin IVA. Este papel lo
   * lee alguien en la mesa que quiere sumar con el dedo y llegar al total; con
   * los renglones sin impuesto y el IVA aparte al final, esa suma nunca cuadra
   * y la conversación acaba en la caja.
   */
  importe: Centavos;
}

export interface DatosPrecuenta {
  folio: string;
  ts: number;
  local: {
    nombre: string;
    direccion?: string;
    rfc?: string;
    telefono?: string;
  };
  mesa: string;
  mesero: string;
  renglones: RenglonPrecuenta[];
  /** Suma de los renglones, con impuesto. */
  suma: Centavos;
  /** Rebajas ya expresadas con su parte de impuesto, para que el papel cuadre. */
  descuentos: Centavos;
  cortesias: Centavos;
  total: Centavos;
  propina?: Centavos;
  pagos?: PagoTicket[];
  cambio?: Centavos;
  reimpresion?: number;
  textos?: TextosTicket;
  /** Hasta dos acciones que el comensal puede escanear desde su papel. */
  qrs?: { leyenda: string; url: string; matriz?: ImagenMonocroma }[];
}

/**
 * El ticket del cliente. Se entrega al pedir la cuenta y puede reimprimirse ya
 * con los pagos asentados. Los renglones llevan el impuesto dentro para que la
 * suma que hace el comensal coincida con el total visible.
 */
export function precuenta(
  datos: DatosPrecuenta,
  columnas: AnchoPapel = 42,
  modoQr: "nativo" | "imagen" = "nativo",
): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };
  const txt = { ...TEXTOS_TICKET_POR_DEFECTO, ...(datos.textos ?? {}) };

  if (datos.reimpresion && datos.reimpresion > 0) {
    t.linea(`** REIMPRESION #${datos.reimpresion} **`, { ...centrado, negrita: true });
    t.salto();
  }

  t.linea(datos.local.nombre, { ...centrado, negrita: true, doble_alto: true });
  if (datos.local.direccion) t.linea(datos.local.direccion, centrado);
  if (datos.local.rfc) t.linea(`RFC: ${datos.local.rfc}`, centrado);
  if (datos.local.telefono) t.linea(`Tel: ${datos.local.telefono}`, centrado);
  if (txt.encabezado) {
    for (const l of envolverPalabras(txt.encabezado, columnas)) t.linea(l, centrado);
  }
  t.separador("=");

  t.columnasDobles(`Folio: ${datos.folio}`, fechaHora(datos.ts));
  t.columnasDobles(`Mesa: ${datos.mesa}`, datos.mesero);
  t.separador();

  for (const renglon of datos.renglones) {
    t.columnasDobles(`${renglon.cantidad}x ${renglon.descripcion}`, mxn(renglon.importe));
    if (renglon.detalle) t.linea(`   ${renglon.detalle}`);
  }

  t.separador();

  /*
   * La línea de suma solo aparece cuando hay algo que restar. Sin rebajas sería
   * el mismo número que el total, dos veces seguidas, y eso hace dudar de cuál
   * de los dos hay que pagar.
   */
  const hayRebajas = datos.descuentos > 0 || datos.cortesias > 0;
  if (hayRebajas) {
    t.columnasDobles("Suma", mxn(datos.suma));
    if (datos.descuentos > 0) t.columnasDobles("Descuentos", `-${mxn(datos.descuentos)}`);
    if (datos.cortesias > 0) t.columnasDobles("Cortesias", `-${mxn(datos.cortesias)}`);
  }

  t.columnasDobles("TOTAL A PAGAR", mxn(datos.total), { negrita: true, doble_alto: true });
  if ((datos.propina ?? 0) > 0) {
    t.columnasDobles("Propina", mxn(datos.propina!));
    t.columnasDobles("Total con propina", mxn((datos.total + datos.propina!) as Centavos), {
      negrita: true,
    });
  }
  t.salto();
  t.linea("Precios con IVA incluido", centrado);

  if ((datos.pagos?.length ?? 0) > 0) {
    t.separador();
    for (const pago of datos.pagos ?? []) t.columnasDobles(pago.forma, mxn(pago.monto));
    if ((datos.cambio ?? 0) > 0) {
      t.columnasDobles("Cambio", mxn(datos.cambio!), { negrita: true });
    }
  }

  for (const qr of (datos.qrs ?? []).slice(0, 2)) {
    if (!qr.url.trim()) continue;
    t.salto();
    if (qr.leyenda.trim()) t.linea(qr.leyenda.trim(), { ...centrado, negrita: true });
    if (modoQr === "imagen" && qr.matriz) t.imagenMonocroma(qr.matriz);
    else t.qr(qr.url.trim());
  }

  t.salto();
  if (txt.agradecimiento) t.linea(txt.agradecimiento, centrado);
  if (txt.pie) for (const l of envolverPalabras(txt.pie, columnas)) t.linea(l, centrado);
  t.linea(FIRMA_MOTRAE, centrado);
  return t.cortar();
}

// --- Ticket interno -----------------------------------------------------------------

export interface DatosTicketInterno {
  folio: string;
  ts: number;
  mesa: string;
  mesero: string;
  renglones: RenglonPrecuenta[];
  suma: Centavos;
  descuentos: Centavos;
  cortesias: Centavos;
  total: Centavos;
  propina: Centavos;
  pagos: PagoTicket[];
  cambio: Centavos;
}

/** Copia compacta que conserva el restaurante después de cobrar. */
export function ticketInterno(datos: DatosTicketInterno, columnas: AnchoPapel = 42): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };

  t.linea("*** TICKET INTERNO ***", { ...centrado, negrita: true });
  if (datos.total === 0 && datos.cortesias > 0) {
    t.linea("CORTESIA DE LA CASA", { ...centrado, negrita: true, doble_alto: true });
  }
  t.columnasDobles(`Folio: ${datos.folio}`, fechaHora(datos.ts));
  t.columnasDobles(`Mesa: ${datos.mesa}`, datos.mesero);
  t.separador();

  for (const renglon of datos.renglones) {
    t.columnasDobles(`${renglon.cantidad}x ${renglon.descripcion}`, mxn(renglon.importe));
    if (renglon.detalle) t.linea(`   ${renglon.detalle}`);
  }

  t.separador();
  const hayRebajas = datos.descuentos > 0 || datos.cortesias > 0;
  if (hayRebajas) {
    t.columnasDobles("Suma", mxn(datos.suma));
    if (datos.descuentos > 0) t.columnasDobles("Descuentos", `-${mxn(datos.descuentos)}`);
    if (datos.cortesias > 0) t.columnasDobles("Cortesias", `-${mxn(datos.cortesias)}`);
  }
  t.columnasDobles("TOTAL", mxn(datos.total), { negrita: true, doble_alto: true });
  if (datos.propina > 0) {
    t.columnasDobles("Propina", mxn(datos.propina));
    t.columnasDobles("Total cobrado", mxn((datos.total + datos.propina) as Centavos), {
      negrita: true,
    });
  }

  t.separador();
  if (datos.pagos.length === 0 && datos.total === 0) {
    t.linea("Sin entrada de dinero", centrado);
  } else {
    for (const pago of datos.pagos) t.columnasDobles(pago.forma, mxn(pago.monto));
  }
  if (datos.cambio > 0) t.columnasDobles("Cambio", mxn(datos.cambio), { negrita: true });
  t.salto(2);
  t.linea("Firma: __________________________", centrado);
  t.linea(FIRMA_MOTRAE, centrado);
  return t.cortar();
}

/** Hoja de diagnóstico: permite elegir visualmente el modo que sí lee la cámara. */
export function pruebaCodigosQr(
  contenido: string,
  matriz: ImagenMonocroma,
  columnas: AnchoPapel = 42,
): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };
  t.linea("PRUEBA DE CODIGOS QR", { ...centrado, negrita: true, doble_alto: true });
  t.linea("Escanea los dos con un telefono", centrado);
  t.salto();
  t.linea("1. QR NATIVO", { ...centrado, negrita: true });
  t.qr(contenido);
  t.salto();
  t.linea("2. QR DIBUJADO COMO IMAGEN", { ...centrado, negrita: true });
  t.imagenMonocroma(matriz);
  t.salto();
  t.linea("Guarda en MotRest el modo que funciono.", centrado);
  return t.cortar();
}

// --- Corte de caja -------------------------------------------------------------------

export interface DatosCorte {
  folio: string;
  local: string;
  cajero: string;
  abierta_ts: number;
  cerrada_ts: number;
  fondo_inicial: Centavos;
  ventas: { forma: string; monto: Centavos }[];
  total_vendido: Centavos;
  efectivo_ventas: Centavos;
  movimientos: Centavos;
  efectivo_esperado: Centavos;
  declarado: Centavos;
  diferencia: Centavos;
  propinas: Centavos;
  cuentas_cerradas: number;
  /** Huella que sella el corte; ver `sello.ts`. */
  sello: string;
}

/**
 * Comprobante del corte de caja.
 *
 * Lleva un SELLO al pie: una huella de las cifras del corte. Si alguien altera
 * el registro después, el sello deja de coincidir. No impide el fraude, pero lo
 * vuelve detectable — que es de lo que se trata un arqueo.
 */
export function corteCaja(datos: DatosCorte, columnas: AnchoPapel = 42): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };

  t.linea("CORTE DE CAJA", { ...centrado, negrita: true, doble_alto: true });
  t.linea(datos.local, centrado);
  t.separador("=");

  t.columnasDobles("Folio", datos.folio);
  t.columnasDobles("Cajero", datos.cajero);
  t.columnasDobles("Apertura", fechaHora(datos.abierta_ts));
  t.columnasDobles("Cierre", fechaHora(datos.cerrada_ts));
  t.columnasDobles("Cuentas cerradas", String(datos.cuentas_cerradas));
  t.separador();

  t.linea("VENTAS POR FORMA DE PAGO", { negrita: true });
  for (const venta of datos.ventas) {
    t.columnasDobles(venta.forma, mxn(venta.monto));
  }
  t.columnasDobles("Total vendido", mxn(datos.total_vendido), { negrita: true });
  t.separador();

  t.linea("EFECTIVO", { negrita: true });
  t.columnasDobles("Fondo inicial", mxn(datos.fondo_inicial));
  t.columnasDobles("Ventas en efectivo", mxn(datos.efectivo_ventas));
  if (datos.movimientos !== 0) {
    t.columnasDobles("Entradas y retiros", mxn(datos.movimientos));
  }
  t.columnasDobles("Esperado en cajon", mxn(datos.efectivo_esperado), { negrita: true });
  t.columnasDobles("Declarado", mxn(datos.declarado));

  const etiqueta =
    datos.diferencia === 0 ? "Cuadra" : datos.diferencia > 0 ? "Sobrante" : "Faltante";
  t.columnasDobles(etiqueta, mxn(Math.abs(datos.diferencia) as Centavos), {
    negrita: true,
    doble_alto: datos.diferencia !== 0,
  });

  if (datos.propinas > 0) {
    t.separador();
    t.columnasDobles("Propinas del turno", mxn(datos.propinas));
  }

  t.separador("=");
  t.linea("Sello del corte:", { alineacion: "centro" });
  t.linea(datos.sello, { alineacion: "centro" });
  t.salto();
  t.linea("Firma: ____________________");
  t.salto();
  t.linea(FIRMA_MOTRAE, centrado);

  return t.cortar();
}

// --- Representación impresa del CFDI ------------------------------------------------

/**
 * Parte una cadena larga en trozos del ancho del papel.
 *
 * Los sellos y la cadena original del SAT miden cientos de caracteres; en un
 * papel de 80 mm hay que envolverlos o se pierden por el borde derecho.
 */
function envolver(texto: string, ancho: number): string[] {
  const trozos: string[] = [];
  for (let i = 0; i < texto.length; i += ancho) trozos.push(texto.slice(i, i + ancho));
  return trozos;
}

/**
 * Envuelve un texto por palabras, para lo que se lee —no para sellos.
 *
 * Un sello se parte a lo bruto (`envolver`), pero una leyenda o una dirección
 * cortada a mitad de palabra se lee mal. Aquí se respeta el espacio.
 */
function envolverPalabras(texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(" ")) {
    if (actual.length === 0) actual = palabra;
    else if (actual.length + 1 + palabra.length <= ancho) actual += ` ${palabra}`;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/**
 * La representación impresa de un CFDI 4.0.
 *
 * Recibe el modelo YA ARMADO por el dominio (`representacionImpresa`), nunca el
 * comprobante crudo: los importes, el total en letra y la URL del QR se calculan
 * en un solo lugar, y el papel imprime exactamente lo que dice el XML.
 *
 * Si el comprobante todavía no está timbrado, sale marcado como BORRADOR y sin
 * QR: no es una factura hasta que el SAT la certifica.
 */
export function representacionCfdi(
  rep: RepresentacionImpresa,
  columnas: AnchoPapel = 42,
): Ticket {
  const t = new Ticket(columnas);
  const centrado: { alineacion: Alineacion } = { alineacion: "centro" };

  if (!rep.timbre) {
    t.linea("** BORRADOR - SIN TIMBRAR **", { ...centrado, negrita: true });
    t.salto();
  }

  t.linea(rep.emisor.nombre, { ...centrado, negrita: true, doble_alto: true });
  t.linea(`RFC ${rep.emisor.rfc}`, centrado);
  t.linea(`Regimen ${rep.emisor.regimen_fiscal}`, centrado);
  t.linea(`Lugar de expedicion: ${rep.comprobante.lugar_expedicion}`, centrado);
  t.separador("=");

  t.linea("CFDI 4.0 - Ingreso", { negrita: true });
  t.columnasDobles("Folio", rep.comprobante.serie_folio);
  t.columnasDobles("Fecha", rep.comprobante.fecha);
  t.columnasDobles("Forma pago", rep.comprobante.forma_pago);
  t.columnasDobles("Metodo pago", rep.comprobante.metodo_pago);
  t.separador();

  t.linea("RECEPTOR", { negrita: true });
  t.linea(rep.receptor.nombre);
  t.columnasDobles("RFC", rep.receptor.rfc);
  t.columnasDobles("CP", rep.receptor.codigo_postal);
  t.columnasDobles("Regimen", rep.receptor.regimen_fiscal);
  t.columnasDobles("Uso CFDI", rep.receptor.uso_cfdi);
  t.separador();

  t.linea("CONCEPTOS", { negrita: true });
  for (const c of rep.conceptos) {
    t.linea(`${c.cantidad} x ${c.descripcion}`);
    t.columnasDobles(`  ${c.clave_prod_serv} @ ${c.valor_unitario}`, c.importe);
  }
  t.separador();

  t.columnasDobles("Subtotal", rep.subtotal);
  if (rep.descuento) t.columnasDobles("Descuento", `-${rep.descuento}`);
  t.columnasDobles("Impuestos", rep.total_impuestos);
  t.columnasDobles("TOTAL", rep.total, { negrita: true, doble_alto: true });
  t.salto();
  t.linea("Importe con letra:", { negrita: true });
  t.linea(rep.total_en_letra);

  if (rep.timbre) {
    t.separador("=");
    t.linea("TIMBRE FISCAL DIGITAL", { ...centrado, negrita: true });
    t.linea("Folio fiscal (UUID):");
    t.linea(rep.timbre.uuid);
    t.columnasDobles("Timbrado", rep.timbre.fecha_timbrado);
    t.columnasDobles("No. cert. SAT", rep.timbre.no_certificado_sat);
    t.columnasDobles("No. cert. emisor", rep.timbre.no_certificado_emisor);
    t.columnasDobles("RFC del PAC", rep.timbre.rfc_pac);

    t.salto();
    t.linea("Sello digital del CFDI:");
    for (const linea of envolver(rep.timbre.sello_cfd, columnas)) t.linea(linea);
    t.linea("Sello del SAT:");
    for (const linea of envolver(rep.timbre.sello_sat, columnas)) t.linea(linea);
    t.linea("Cadena original del complemento:");
    for (const linea of envolver(rep.timbre.cadena_original, columnas)) t.linea(linea);

    t.salto();
    t.linea("Verifica esta factura:", { ...centrado, negrita: true });
    t.qr(rep.timbre.url_qr);
  }

  t.salto();
  for (const linea of envolverPalabras(rep.leyenda, columnas)) t.linea(linea, centrado);
  t.linea(FIRMA_MOTRAE, centrado);
  return t.cortar();
}
