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
import { aPesos, type Centavos } from "@motrest/dominio";
import { Ticket, type Alineacion } from "./escpos.js";

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
  reimpresion?: number;
}

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

  if (datos.url_autofactura) {
    t.salto();
    t.linea("Factura tu consumo", { ...centrado, negrita: true });
    t.qr(datos.url_autofactura);
    t.linea(`Folio ${datos.folio}`, centrado);
  }

  t.salto();
  t.linea("¡Gracias por su visita!", centrado);
  t.linea(`MotRest v${VERSION_PLANTILLAS}`, centrado);
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
  t.linea(`MotRest v${VERSION_PLANTILLAS}`, centrado);

  return t.cortar();
}
