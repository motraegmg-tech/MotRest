/**
 * El reporte que pide el contador cada mes.
 *
 * En México el contador necesita, para cerrar el mes: cuánto se vendió, cuánto
 * IVA se trasladó, cómo se cobró, qué comprobantes se emitieron y qué gastos
 * hubo. Hoy eso se saca a mano de varias pantallas y se le manda por WhatsApp,
 * que es exactamente como se pierden datos y se cometen errores.
 *
 * DOS DECISIONES QUE IMPORTAN
 *
 * 1. **Se separa lo FACTURADO de lo VENDIDO.** No es lo mismo: en un
 *    restaurante la mayoría de los comensales no pide factura. El contador
 *    necesita ver los dos números y su diferencia —lo que irá a la factura
 *    global— sin tener que restarlos él.
 *
 * 2. **CSV con separador de punto y coma y BOM.** Excel en español interpreta
 *    la coma como separador decimal, así que un CSV con comas parte los
 *    importes en dos columnas. El BOM es lo que hace que Excel lea los acentos
 *    en vez de mostrar «Ma?ana». Son dos detalles feos que deciden si el
 *    archivo se abre bien o el contador tiene que pelearse con él.
 */
import { aPesos, porFraccion, restar, type Centavos } from "../comun/dinero.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { consumoDeSocio, totalesComanda } from "../comanda/totales.js";
import { etiquetaFormaPago, type FormaPago } from "../comanda/eventos.js";
import type { RegistroCfdi } from "../fiscal/eventos.js";
import { vendidoEnGlobales, type FacturaGlobalRegistrada } from "../fiscal/global.js";
import type { RegistroEgreso } from "./egresos.js";
import type { Rango } from "../inteligencia/reportes.js";

export interface RenglonFormaPago {
  forma: FormaPago;
  etiqueta: string;
  cuentas: number;
  importe: Centavos;
}

export interface ReporteContable {
  desde: number;
  hasta: number;
  /** Lo vendido, se haya facturado o no. */
  cuentas: number;
  subtotal: Centavos;
  iva: Centavos;
  ieps: Centavos;
  total: Centavos;
  /** Las propinas NO son ingreso del restaurante: son del personal. */
  propinas: Centavos;
  /**
   * Lo que cubrieron las bolsas de los socios, con impuestos.
   *
   * Tampoco es ingreso, y desde la 1.5.6 **no está dentro de `total` ni de
   * `subtotal`**: no entró un peso. Se informa aparte para poder mirar el
   * acuerdo con los socios de frente, y para que nadie lo eche de menos al
   * comparar con el corte.
   */
  consumo_socios: Centavos;
  descuentos: Centavos;
  cortesias: Centavos;
  por_forma_pago: RenglonFormaPago[];
  /** Comprobantes timbrados en el periodo. */
  cfdi_timbrados: number;
  cfdi_total: Centavos;
  cfdi_iva: Centavos;
  cfdi_cancelados: number;
  /**
   * Lo vendido que NO se facturó individualmente NI entró en una global.
   *
   * El número que el contador busca primero. Con la global automática (1.5.5)
   * debería quedar en cero una vez cerrado el mes; si no, algo se quedó fuera
   * —un mes anterior a FacturAPI, una global que no pudo timbrarse— y es
   * exactamente lo que hay que revisar.
   */
  sin_facturar: Centavos;
  /**
   * Lo vendido del periodo que ya quedó amparado por una factura global.
   *
   * Opcional solo por los reportes que se arman a mano (el PDF de prueba); el
   * que sale de `reporteContable` siempre lo trae.
   */
  global_facturado?: Centavos;
  egresos: Centavos;
  /** Cuentas que se cobraron, se reabrieron y se volvieron a cobrar. */
  cuentas_reabiertas: number;
}

/** Las propinas se separan siempre: no son ingreso del negocio. */
export function reporteContable(
  comandas: readonly EstadoComanda[],
  cfdis: readonly RegistroCfdi[],
  egresos: readonly RegistroEgreso[],
  rango: Rango,
  /**
   * Las facturas globales del registro (`facturasGlobales`). Opcional para no
   * romper a quien todavía no las pasa: sin ellas, la venta sin facturar se
   * calcula como antes.
   */
  globales: readonly FacturaGlobalRegistrada[] = [],
): ReporteContable {
  let subtotal = 0;
  let iva = 0;
  let ieps = 0;
  let total = 0;
  let propinas = 0;
  let descuentos = 0;
  let cortesias = 0;
  let consumoSocios = 0;
  let reabiertas = 0;

  const porForma = new Map<FormaPago, { cuentas: number; importe: number }>();

  for (const c of comandas) {
    const t = totalesComanda(c);

    /*
     * LO QUE CUBRIÓ UN SOCIO NO ES VENTA (1.5.6). Se descuenta en proporción,
     * igual que en `resumenVentas`, para que base e impuestos bajen juntos y el
     * desglose fiscal del día siga cuadrando. Ver `consumoDeSocio`.
     *
     * Importa también para la facturación: lo del socio no se factura a nadie
     * ni entra en la global, así que si siguiera dentro del total aparecería
     * eternamente como «venta sin facturar».
     */
    const delSocio = consumoDeSocio(c);
    const fraccion = t.total > 0 ? Math.min(delSocio / t.total, 1) : 0;
    const sinSocio = (monto: Centavos) =>
      fraccion > 0 ? restar(monto, porFraccion(monto, fraccion)) : monto;

    consumoSocios += delSocio;
    subtotal += sinSocio(t.subtotal);
    iva += sinSocio(t.iva);
    ieps += sinSocio(t.ieps);
    total += sinSocio(t.total);
    propinas += t.propina;
    descuentos += sinSocio(t.descuentos);
    cortesias += sinSocio(t.cortesias);
    if (c.reabierta) reabiertas += 1;

    for (const pago of c.pagos) {
      const previo = porForma.get(pago.forma) ?? { cuentas: 0, importe: 0 };
      porForma.set(pago.forma, {
        cuentas: previo.cuentas + 1,
        importe: previo.importe + pago.monto,
      });
    }
  }

  // Solo los CFDI del periodo, y solo los que de verdad valen: un rechazado no
  // existe para el SAT, y meterlo inflaría lo facturado.
  const delPeriodo = cfdis.filter(
    (r) => r.generado_ts >= rango.desde && r.generado_ts < rango.hasta,
  );
  const timbrados = delPeriodo.filter((r) => r.estado === "timbrado");
  const cancelados = delPeriodo.filter((r) => r.estado === "cancelado");

  const cfdiTotal = timbrados.reduce((n, r) => n + r.comprobante.total, 0);
  /*
   * Lo que ya fue a la global del mes tampoco está «sin facturar». Antes de la
   * 1.5.5 la global la hacía el contador por su cuenta y este número era
   * justamente su base; ahora la emite el Hub, y si no se descontara el reporte
   * le pediría facturar otra vez lo que ya se timbró.
   */
  const enGlobal = vendidoEnGlobales(comandas, globales);

  const cfdiIva = timbrados.reduce(
    (n, r) => n + r.comprobante.total_impuestos_trasladados,
    0,
  );

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    cuentas: comandas.length,
    subtotal: subtotal as Centavos,
    iva: iva as Centavos,
    ieps: ieps as Centavos,
    total: total as Centavos,
    propinas: propinas as Centavos,
    consumo_socios: consumoSocios as Centavos,
    descuentos: descuentos as Centavos,
    cortesias: cortesias as Centavos,
    por_forma_pago: [...porForma.entries()]
      .map(([forma, v]) => ({
        forma,
        etiqueta: etiquetaFormaPago(forma),
        cuentas: v.cuentas,
        importe: v.importe as Centavos,
      }))
      .sort((a, b) => b.importe - a.importe),
    cfdi_timbrados: timbrados.length,
    cfdi_total: cfdiTotal as Centavos,
    cfdi_iva: cfdiIva as Centavos,
    cfdi_cancelados: cancelados.length,
    // No puede ser negativo: si se facturó más de lo vendido en el periodo
    // —una factura de una venta de ayer— la diferencia no es "sin facturar".
    sin_facturar: Math.max(0, total - cfdiTotal - enGlobal) as Centavos,
    global_facturado: enGlobal,
    egresos: egresos.reduce((n, e) => n + e.monto, 0) as Centavos,
    cuentas_reabiertas: reabiertas,
  };
}

// --- Exportación --------------------------------------------------------------------------

/** Punto y coma: Excel en español parte los importes si el separador es coma. */
const SEP = ";";

function importe(c: Centavos): string {
  // Con punto decimal y sin separador de miles: es lo que Excel y cualquier
  // sistema contable leen sin ambigüedad.
  return aPesos(c).toFixed(2);
}

function fecha(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * El resumen del periodo, listo para abrir en Excel.
 *
 * Lleva BOM al principio: sin él Excel muestra «Ma?ana» en vez de «Mañana».
 */
export function resumenCsv(r: ReporteContable): string {
  const filas: string[][] = [
    ["Reporte contable"],
    ["Desde", fecha(r.desde)],
    ["Hasta", fecha(r.hasta - 1)],
    [],
    ["VENTA DEL PERIODO"],
    ["Cuentas cobradas", String(r.cuentas)],
    ["Subtotal", importe(r.subtotal)],
    ["IVA trasladado", importe(r.iva)],
    ["IEPS", importe(r.ieps)],
    ["Total cobrado", importe(r.total)],
    ["Descuentos", importe(r.descuentos)],
    ["Cortesias", importe(r.cortesias)],
    ["Consumo de socios (no es venta)", importe(r.consumo_socios)],
    [],
    ["PROPINAS (no son ingreso del negocio)", importe(r.propinas)],
    [],
    ["COMO SE COBRO"],
    ["Forma de pago", "Operaciones", "Importe"],
    ...r.por_forma_pago.map((f) => [f.etiqueta, String(f.cuentas), importe(f.importe)]),
    [],
    ["COMPROBANTES FISCALES"],
    ["CFDI timbrados", String(r.cfdi_timbrados)],
    ["Total facturado", importe(r.cfdi_total)],
    ["IVA facturado", importe(r.cfdi_iva)],
    ["CFDI cancelados", String(r.cfdi_cancelados)],
    ["Incluido en la factura global", importe(r.global_facturado ?? (0 as Centavos))],
    ["Venta SIN facturar", importe(r.sin_facturar)],
    [],
    ["EGRESOS DEL PERIODO", importe(r.egresos)],
  ];

  if (r.cuentas_reabiertas > 0) {
    filas.push([], ["Cuentas reabiertas (revisar)", String(r.cuentas_reabiertas)]);
  }

  return "﻿" + filas.map((f) => f.join(SEP)).join("\r\n");
}

/** Una fila por cuenta cobrada, para cuadrar contra el detalle. */
export function detalleCsv(comandas: readonly EstadoComanda[]): string {
  const encabezado = [
    "Fecha", "Folio", "Mesa", "Subtotal", "IVA", "IEPS", "Total", "Propina", "Reabierta",
  ];

  const filas = comandas.map((c) => {
    const t = totalesComanda(c);
    return [
      fecha(c.cerrada_ts ?? c.abierta_ts),
      c.orden_id.slice(-8).toUpperCase(),
      c.mesa_id,
      importe(t.subtotal),
      importe(t.iva),
      importe(t.ieps),
      importe(t.total),
      importe(t.propina),
      c.reabierta ? "SI" : "",
    ];
  });

  return "﻿" + [encabezado, ...filas].map((f) => f.join(SEP)).join("\r\n");
}
