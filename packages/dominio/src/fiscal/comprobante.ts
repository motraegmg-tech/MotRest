/**
 * Comprobante Fiscal Digital por Internet (CFDI) 4.0.
 *
 * Se construye desde una cuenta cerrada y queda **listo para timbrar**: lo único
 * que falta son el Sello y el Certificado (que requieren el CSD del SAT) y el
 * Timbre Fiscal Digital, que agrega el PAC. Todo lo que depende del restaurante
 * está resuelto aquí.
 *
 * Los importes viajan en centavos dentro del dominio y se formatean a dos
 * decimales solo al serializar, que es como los espera el SAT.
 */
import { CERO, aPesos, porFraccion, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import type { CatalogoIndex } from "../catalogo/productos.js";
import type { FormaPago } from "../comanda/eventos.js";
import { renglonesActivos, type EstadoComanda } from "../comanda/reducers.js";
import { importeRenglon } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import {
  CLAVE_PRODSERV_RESTAURANTE,
  CLAVE_UNIDAD_SERVICIO,
  IMPUESTO_IEPS,
  IMPUESTO_IVA,
  OBJETO_IMPUESTO_NO,
  OBJETO_IMPUESTO_SI,
} from "./claves.js";

export interface DatosEmisor {
  rfc: string;
  /** Razón social EXACTA como está en la Constancia de Situación Fiscal. */
  nombre: string;
  regimen_fiscal: string;
  /** Código postal del domicilio fiscal: define el LugarExpedicion. */
  codigo_postal: string;
  /** Nombre comercial del local, solo para el ticket. */
  nombre_comercial?: string;
}

export interface DatosReceptor {
  rfc: string;
  nombre: string;
  regimen_fiscal: string;
  /** Domicilio fiscal del receptor. Obligatorio en CFDI 4.0. */
  codigo_postal: string;
  uso_cfdi: string;
}

export interface TrasladoConcepto {
  base: Centavos;
  impuesto: string;
  tipo_factor: "Tasa" | "Cuota" | "Exento";
  tasa_o_cuota: number;
  importe: Centavos;
}

export interface ConceptoCfdi {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: Centavos;
  importe: Centavos;
  descuento: Centavos;
  objeto_imp: string;
  traslados: TrasladoConcepto[];
}

export interface TrasladoResumen {
  base: Centavos;
  impuesto: string;
  tipo_factor: "Tasa" | "Cuota";
  tasa_o_cuota: number;
  importe: Centavos;
}

export interface Comprobante {
  version: "4.0";
  serie: string;
  folio: string;
  /** Fecha de expedición en hora local, sin zona (formato del SAT). */
  fecha: string;
  /** Clave del catálogo c_FormaPago. */
  forma_pago: string;
  /** PUE o PPD. */
  metodo_pago: string;
  /** Código postal donde se expide: el del emisor. */
  lugar_expedicion: string;
  moneda: "MXN";
  tipo_comprobante: "I";
  exportacion: "01";
  subtotal: Centavos;
  descuento: Centavos;
  total: Centavos;
  emisor: DatosEmisor;
  receptor: DatosReceptor;
  conceptos: ConceptoCfdi[];
  traslados: TrasladoResumen[];
  total_impuestos_trasladados: Centavos;
  /** Cuenta que originó el comprobante. */
  orden_id: ID;

  /**
   * Número de serie del CSD con el que se firma.
   *
   * Se rellena al sellar, no al construir el comprobante: sale del certificado
   * y hasta ese momento no se sabe cuál se usará. Forma parte de la cadena
   * original, a diferencia del Sello y del Certificado.
   */
  no_certificado?: string;
  /** Sello digital en base64. Lo pone quien tiene el CSD. */
  sello?: string;
  /** Certificado del CSD en base64. Lo pone quien sella. */
  certificado?: string;
}

/** Traduce la forma de pago interna a la clave del SAT. */
export function formaPagoSat(forma: FormaPago): string {
  switch (forma) {
    case "efectivo":
      return "01";
    case "transferencia":
      return "03";
    case "tarjeta_credito":
      return "04";
    case "tarjeta_debito":
      return "28";
    case "vale":
      return "29";
    /*
     * Lo cobró un agregador. Para el SAT es "por definir": el restaurante no
     * recibió el dinero del comensal, lo recibirá de la plataforma días después
     * y por otro importe. La clave 99 es exactamente para eso, y usar "efectivo"
     * o "tarjeta" aquí sería declarar un cobro que no ocurrió.
     */
    case "agregador":
      return "99";
  }
}

export interface OpcionesComprobante {
  serie: string;
  folio: string;
  emisor: DatosEmisor;
  receptor: DatosReceptor;
  /** Forma en que se recibió el pago; si hay varias, la de mayor monto. */
  forma_pago?: FormaPago;
  /** Momento de expedición. Por omisión, el reloj del dispositivo. */
  fecha?: Date;
}

/** Formato de fecha que exige el SAT: AAAA-MM-DDThh:mm:ss, hora local. */
export function fechaSat(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}` +
    `T${p(fecha.getHours())}:${p(fecha.getMinutes())}:${p(fecha.getSeconds())}`
  );
}

/** La forma de pago con mayor monto de la cuenta. */
function formaPredominante(estado: EstadoComanda): FormaPago {
  if (estado.pagos.length === 0) return "efectivo";
  const porForma = new Map<FormaPago, number>();
  for (const pago of estado.pagos) {
    porForma.set(pago.forma, (porForma.get(pago.forma) ?? 0) + pago.monto);
  }
  let mayor: FormaPago = "efectivo";
  let maximo = -1;
  for (const [forma, monto] of porForma) {
    if (monto > maximo) {
      maximo = monto;
      mayor = forma;
    }
  }
  return mayor;
}

/**
 * Construye el CFDI a partir de la cuenta.
 *
 * Los descuentos de la cuenta se prorratean entre los conceptos, porque el SAT
 * exige el descuento a nivel concepto y que la suma cuadre con el del
 * comprobante.
 */
export function construirComprobante(
  estado: EstadoComanda,
  catalogo: CatalogoIndex,
  opciones: OpcionesComprobante,
): Comprobante {
  const activos = renglonesActivos(estado);
  const totales = totalesComanda(estado);

  // Proporción de rebaja global (descuentos + cortesías) sobre el bruto.
  const rebajaTotal = sumar(totales.descuentos, totales.cortesias);
  const fraccionRebaja = totales.bruto > 0 ? rebajaTotal / totales.bruto : 0;

  const conceptos: ConceptoCfdi[] = [];
  let descuentoRepartido = CERO;

  activos.forEach((renglon, indice) => {
    const producto = catalogo.productos.get(renglon.producto_id);
    const importeBruto = importeRenglon(renglon);

    // El último concepto absorbe el residuo para que la suma cuadre al centavo.
    const esUltimo = indice === activos.length - 1;
    const descuento = esUltimo
      ? restar(rebajaTotal, descuentoRepartido)
      : porFraccion(importeBruto, fraccionRebaja);
    descuentoRepartido = sumar(descuentoRepartido, descuento);

    const baseConImpuesto = restar(importeBruto, descuento);
    const desglose = desglosarConTasas(baseConImpuesto, renglon.impuesto);

    const traslados: TrasladoConcepto[] = [];
    if (renglon.impuesto.tasa_iva > 0) {
      traslados.push({
        base: desglose.base,
        impuesto: IMPUESTO_IVA,
        tipo_factor: "Tasa",
        tasa_o_cuota: renglon.impuesto.tasa_iva,
        importe: desglose.iva,
      });
    }
    if (renglon.impuesto.tasa_ieps > 0) {
      traslados.push({
        base: desglose.base,
        impuesto: IMPUESTO_IEPS,
        tipo_factor: "Tasa",
        tasa_o_cuota: renglon.impuesto.tasa_ieps,
        importe: desglose.ieps,
      });
    }

    // El valor unitario va sin impuesto: se deriva del bruto sin la rebaja.
    const brutoSinImpuesto = desglosarConTasas(importeBruto, renglon.impuesto).base;
    const valorUnitario = (renglon.cantidad > 0
      ? Math.round(brutoSinImpuesto / renglon.cantidad)
      : 0) as Centavos;

    conceptos.push({
      clave_prod_serv: producto?.clave_prod_serv ?? CLAVE_PRODSERV_RESTAURANTE,
      cantidad: renglon.cantidad,
      clave_unidad: CLAVE_UNIDAD_SERVICIO,
      descripcion: renglon.detalle
        ? `${renglon.descripcion} (${renglon.detalle})`
        : renglon.descripcion,
      valor_unitario: valorUnitario,
      importe: brutoSinImpuesto,
      descuento: desglosarConTasas(descuento, renglon.impuesto).base,
      objeto_imp: traslados.length > 0 ? OBJETO_IMPUESTO_SI : OBJETO_IMPUESTO_NO,
      traslados,
    });
  });

  // Resumen de impuestos, agrupado por impuesto y tasa.
  const agrupados = new Map<string, TrasladoResumen>();
  for (const concepto of conceptos) {
    for (const t of concepto.traslados) {
      const clave = `${t.impuesto}:${t.tasa_o_cuota}`;
      const previo = agrupados.get(clave);
      if (previo) {
        previo.base = sumar(previo.base, t.base);
        previo.importe = sumar(previo.importe, t.importe);
      } else {
        agrupados.set(clave, {
          base: t.base,
          impuesto: t.impuesto,
          tipo_factor: "Tasa",
          tasa_o_cuota: t.tasa_o_cuota,
          importe: t.importe,
        });
      }
    }
  }
  const traslados = [...agrupados.values()];
  const totalTrasladados = sumar(...traslados.map((t) => t.importe));

  const subtotal = sumar(...conceptos.map((c) => c.importe));
  const descuento = sumar(...conceptos.map((c) => c.descuento));

  return {
    version: "4.0",
    serie: opciones.serie,
    folio: opciones.folio,
    fecha: fechaSat(opciones.fecha ?? new Date()),
    forma_pago: formaPagoSat(opciones.forma_pago ?? formaPredominante(estado)),
    metodo_pago: "PUE",
    lugar_expedicion: opciones.emisor.codigo_postal,
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal,
    descuento,
    total: sumar(restar(subtotal, descuento), totalTrasladados),
    emisor: opciones.emisor,
    receptor: opciones.receptor,
    conceptos,
    traslados,
    total_impuestos_trasladados: totalTrasladados,
    orden_id: estado.orden_id,
  };
}

/** Formatea un monto para el XML: dos decimales, punto como separador. */
export function importeSat(monto: Centavos): string {
  return aPesos(monto).toFixed(2);
}

/** Formatea una tasa: seis decimales, como exige el SAT. */
export function tasaSat(tasa: number): string {
  return tasa.toFixed(6);
}
