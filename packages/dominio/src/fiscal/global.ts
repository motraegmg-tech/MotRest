/**
 * La factura global del mes: lo que se vendió y nadie facturó a su nombre.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * En un restaurante casi nadie pide factura, pero el SAT quiere un CFDI por
 * TODO lo vendido. Lo que no se facturó a un cliente se ampara con una factura a
 * PÚBLICO EN GENERAL que junta los tickets del periodo, uno por concepto. Hoy
 * eso lo hace el contador a mano a fin de mes, con un reporte que le mandan por
 * WhatsApp: justo la parte del trabajo que más se equivoca y más se atrasa.
 *
 * LO QUE DECIDIÓ GONZALO (19-sep-2026)
 *
 * Mensual y automática. El comensal puede pedir factura de su ticket hasta que
 * termina el mes; a las 06:00 del día 1 del mes siguiente el Hub junta lo que
 * quedó y lo timbra solo. Las seis horas de margen son para el servicio que
 * cierra de madrugada el último día.
 *
 * Aquí vive lo que NO depende de FacturAPI ni del Hub: qué meses tocan, qué
 * tickets entran, cómo se parte cada ticket en conceptos, y la regla que la caja
 * necesita para no facturar dos veces la misma venta. El envío está en
 * `apps/hub/src/fiscal/factura-global.ts`.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import type { FormaPago } from "../comanda/eventos.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";
import { cobradoPorRenglon, formaPagoSat } from "./comprobante.js";
import type { EstadoCfdi, EventoFiscal, RegistroCfdi } from "./eventos.js";

/** La hora del día 1 a la que el mes anterior se da por cerrado. */
export const HORA_DE_CIERRE_GLOBAL = 6;

/** Clave del SAT para los conceptos de una global: «Venta», unidad «Actividad». */
export const CLAVE_PRODSERV_GLOBAL = "01010101";
export const CLAVE_UNIDAD_GLOBAL = "ACT";
export const DESCRIPCION_GLOBAL = "Venta";

// --- El periodo ---------------------------------------------------------------------------

/** El mes de un instante, en la hora del local: «AAAA-MM». */
export function periodoDe(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodoValido(periodo: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo);
}

/**
 * Dónde empieza y acaba un mes, y cuándo se da por cerrado.
 *
 * `vence` es el momento a partir del cual la global de ese mes se puede
 * emitir y, a la vez, en el que un ticket del mes deja de poder facturarse a
 * nombre de alguien: las dos cosas pasan juntas a propósito. Si no, habría un
 * rato en el que el mismo ticket podría acabar en los dos documentos.
 */
export function limitesDelPeriodo(periodo: string): { desde: number; hasta: number; vence: number } {
  const [anio, mes] = periodo.split("-").map(Number) as [number, number];
  return {
    desde: new Date(anio, mes - 1, 1).getTime(),
    hasta: new Date(anio, mes, 1).getTime(),
    vence: new Date(anio, mes, 1, HORA_DE_CIERRE_GLOBAL).getTime(),
  };
}

/** El mes siguiente (o anterior, con `delta` negativo) de un periodo. */
export function periodoMas(periodo: string, delta: number): string {
  const [anio, mes] = periodo.split("-").map(Number) as [number, number];
  return periodoDe(new Date(anio, mes - 1 + delta, 1).getTime());
}

/**
 * Los meses ya cerrados que esperan su global, del más viejo al más nuevo.
 *
 * `desde_ts` es cuándo el local empezó a facturar con FacturAPI en ese modo.
 * SOLO cuentan los meses que cerraron DESPUÉS: un local que opera desde julio y
 * conectó FacturAPI en septiembre ya resolvió julio y agosto por su cuenta —con
 * su contador, a mano— y emitirles ahora una global sería timbrar dos veces las
 * mismas ventas, y fuera de plazo.
 */
export function periodosPorEmitir(opciones: {
  ahora: number;
  desde_ts: number;
  emitidos: ReadonlySet<string>;
}): string[] {
  const { ahora, desde_ts, emitidos } = opciones;
  const pendientes: string[] = [];

  // Se arranca un mes antes del de la configuración: si se configuró el día 1
  // a las 3 de la mañana, el mes anterior todavía no había cerrado y le toca.
  let periodo = periodoMas(periodoDe(desde_ts), -1);
  for (let vueltas = 0; vueltas < 600; vueltas++) {
    const { vence } = limitesDelPeriodo(periodo);
    if (vence > ahora) break;
    if (vence > desde_ts && !emitidos.has(periodo)) pendientes.push(periodo);
    periodo = periodoMas(periodo, 1);
  }
  return pendientes;
}

/**
 * ¿Este ticket ya no se puede facturar a nombre de alguien?
 *
 * Pasa cuando su mes cerró: a partir de ahí pertenece a la global. Es la regla
 * que la caja consulta ANTES de dejar pedir la factura, para decirlo en claro
 * en vez de dejar que el SAT lo rechace o, peor, que la venta salga en dos
 * documentos.
 */
export function ticketPasaALaGlobal(cerrada_ts: number, ahora: number): boolean {
  return ahora >= limitesDelPeriodo(periodoDe(cerrada_ts)).vence;
}

// --- Lo ya emitido ------------------------------------------------------------------------

export interface FacturaGlobalRegistrada {
  periodo: string;
  parte: number;
  uuid: string;
  externo_id: string;
  ordenes: ID[];
  total: Centavos;
  fecha_timbrado?: string;
  modo: "pruebas" | "produccion";
  ts: number;
}

/** Las globales que constan en el registro, en el orden en que se emitieron. */
export function facturasGlobales(
  eventos: readonly { tipo: string }[],
): FacturaGlobalRegistrada[] {
  const globales: FacturaGlobalRegistrada[] = [];
  const vistos = new Set<string>();
  for (const crudo of eventos) {
    if (crudo.tipo !== "factura_global_emitida") continue;
    const ev = crudo as Extract<EventoFiscal, { tipo: "factura_global_emitida" }>;
    // Un mismo hecho repetido (dos Hubs, un respaldo restaurado) no es otra global.
    const clave = `${ev.modo}|${ev.periodo}|${ev.parte}|${ev.uuid}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    globales.push({
      periodo: ev.periodo,
      parte: ev.parte,
      uuid: ev.uuid,
      externo_id: ev.externo_id,
      ordenes: [...ev.ordenes],
      total: ev.total,
      fecha_timbrado: ev.fecha_timbrado,
      modo: ev.modo,
      ts: ev.ts,
    });
  }
  return globales;
}

/**
 * ¿Esta cuenta ya entró en una factura global de verdad?
 *
 * Es lo que la caja pregunta antes de facturar un ticket a nombre de alguien:
 * si ya está en la global, el SAT exige cancelar esa global (motivo 04) antes
 * de emitir la individual, y eso no es algo que deba pasar por un clic en la
 * caja. Se contesta con la global, para poder decir cuál.
 *
 * Las globales de PRUEBAS no cuentan: no existen ante el SAT, y bloquear por
 * ellas dejaría sin facturar a un comensal por un ensayo.
 */
export function ordenEnFacturaGlobal(
  eventos: readonly { tipo: string }[],
  ordenId: ID,
): FacturaGlobalRegistrada | null {
  for (const global of facturasGlobales(eventos)) {
    if (global.modo === "produccion" && global.ordenes.includes(ordenId)) return global;
  }
  return null;
}

// --- Qué entra ----------------------------------------------------------------------------

/**
 * En qué estados un CFDI individual ampara ya la venta.
 *
 * `rechazado` no: el SAT nunca lo vio. `cancelado` tampoco: dejó de valer. Los
 * demás sí, incluido el que sigue en cola —`generado`—, porque va a salir y la
 * venta no puede ir además en la global.
 */
const AMPARAN: ReadonlySet<EstadoCfdi> = new Set<EstadoCfdi>([
  "generado",
  "timbrado",
  "cancelacion_solicitada",
  "cancelacion_rechazada",
]);

/** Lo que se imprime en la global como número de ticket (NoIdentificacion). */
export function folioDeTicket(ordenId: ID): string {
  return ordenId.slice(-8).toUpperCase();
}

/** Una línea de la global: lo cobrado de un ticket a una misma tasa. */
export interface ConceptoGlobal {
  orden_id: ID;
  folio: string;
  tasa_iva: number;
  tasa_ieps: number;
  /** Lo cobrado, con impuestos: la suma de estos es el total del ticket. */
  total: Centavos;
  base: Centavos;
  iva: Centavos;
  ieps: Centavos;
}

export interface TicketGlobal {
  orden_id: ID;
  folio: string;
  cerrada_ts: number;
  total: Centavos;
  conceptos: ConceptoGlobal[];
  pagos: { forma: FormaPago; monto: Centavos }[];
}

/**
 * Los conceptos de un ticket en la global.
 *
 * «Un concepto por ticket» es la regla del SAT, con un matiz que no se puede
 * saltar: un concepto tiene UNA tasa. Un ticket con pizza al 16 % y un refresco
 * con IEPS lleva dos líneas con el mismo número de ticket. Lo regalado no entra
 * —no se cobró—, y el reparto de cortesías y descuentos es el del CFDI
 * individual (`cobradoPorRenglon`), así que lo que suma la global es lo que
 * sumaron los tickets, al centavo.
 */
export function conceptosDeTicket(estado: EstadoComanda): ConceptoGlobal[] {
  const porTasa = new Map<string, ConceptoGlobal>();
  const folio = folioDeTicket(estado.orden_id);

  for (const { renglon, cobrado } of cobradoPorRenglon(estado)) {
    if (cobrado <= 0) continue;
    const desglose = desglosarConTasas(cobrado, renglon.impuesto);
    const clave = `${renglon.impuesto.tasa_iva}|${renglon.impuesto.tasa_ieps}`;
    const previo = porTasa.get(clave);
    if (previo) {
      previo.total = sumar(previo.total, desglose.total);
      previo.base = sumar(previo.base, desglose.base);
      previo.iva = sumar(previo.iva, desglose.iva);
      previo.ieps = sumar(previo.ieps, desglose.ieps);
    } else {
      porTasa.set(clave, {
        orden_id: estado.orden_id,
        folio,
        tasa_iva: renglon.impuesto.tasa_iva,
        tasa_ieps: renglon.impuesto.tasa_ieps,
        total: desglose.total,
        base: desglose.base,
        iva: desglose.iva,
        ieps: desglose.ieps,
      });
    }
  }
  return [...porTasa.values()];
}

/**
 * Los tickets de un mes que van a la global.
 *
 * Entran las cuentas COBRADAS del mes —por la hora del cobro, que es la que
 * cuenta como venta— que no estén anuladas ni canceladas, que tengan algo que
 * facturar (una cortesía completa o una cuenta de puros productos de $0 no
 * puede ser concepto) y que no tengan ya un CFDI individual que las ampare ni
 * estén en otra global del mismo modo.
 */
export function ticketsParaGlobal(opciones: {
  comandas: readonly EstadoComanda[];
  cfdis: readonly RegistroCfdi[];
  /** Solo las del mismo modo que la que se va a emitir. */
  globales: readonly FacturaGlobalRegistrada[];
  periodo: string;
}): TicketGlobal[] {
  const { desde, hasta } = limitesDelPeriodo(opciones.periodo);

  const amparadas = new Set<ID>();
  for (const r of opciones.cfdis) if (AMPARAN.has(r.estado)) amparadas.add(r.orden_id);
  for (const g of opciones.globales) for (const o of g.ordenes) amparadas.add(o);

  const tickets: TicketGlobal[] = [];
  const vistas = new Set<ID>();
  for (const c of opciones.comandas) {
    if (!c.cerrada || c.anulada || c.cancelada || c.cerrada_ts === undefined) continue;
    if (c.cerrada_ts < desde || c.cerrada_ts >= hasta) continue;
    if (amparadas.has(c.orden_id) || vistas.has(c.orden_id)) continue;

    const conceptos = conceptosDeTicket(c);
    const total = sumar(...conceptos.map((x) => x.total));
    if (conceptos.length === 0 || total <= 0) continue;

    vistas.add(c.orden_id);
    tickets.push({
      orden_id: c.orden_id,
      folio: folioDeTicket(c.orden_id),
      cerrada_ts: c.cerrada_ts,
      total,
      conceptos,
      pagos: c.pagos.map((p) => ({ forma: p.forma, monto: p.monto })),
    });
  }
  return tickets.sort((a, b) => a.cerrada_ts - b.cerrada_ts);
}

/**
 * La forma de pago de la global: la de mayor importe en el mes.
 *
 * El CFDI lleva una sola. Se descartan las que el SAT llama «por definir»
 * (agregadores y consumo de socio): con método PUE esa clave no se acepta, y
 * dejar que una plataforma de reparto decida la forma de pago de todo el mes
 * sería declarar un cobro que no es el del local. Sin ninguna otra, efectivo.
 */
export function formaPagoDeLaGlobal(tickets: readonly TicketGlobal[]): string {
  const porClave = new Map<string, number>();
  for (const t of tickets) {
    for (const p of t.pagos) {
      const clave = formaPagoSat(p.forma);
      if (clave === "99") continue;
      porClave.set(clave, (porClave.get(clave) ?? 0) + p.monto);
    }
  }
  let mayor = "01";
  let maximo = -1;
  for (const [clave, monto] of porClave) {
    if (monto > maximo) {
      maximo = monto;
      mayor = clave;
    }
  }
  return mayor;
}

/**
 * Parte los tickets en facturas de hasta `maximo` conceptos.
 *
 * FacturAPI admite 5 000 por factura. Un ticket no se parte entre dos: sus
 * líneas van juntas, para que el número de ticket aparezca en un solo
 * documento.
 */
export function partirEnFacturas(
  tickets: readonly TicketGlobal[],
  maximo = 4_500,
): TicketGlobal[][] {
  const partes: TicketGlobal[][] = [];
  let actual: TicketGlobal[] = [];
  let conceptos = 0;
  for (const t of tickets) {
    if (actual.length > 0 && conceptos + t.conceptos.length > maximo) {
      partes.push(actual);
      actual = [];
      conceptos = 0;
    }
    actual.push(t);
    conceptos += t.conceptos.length;
  }
  if (actual.length > 0) partes.push(actual);
  return partes;
}

/** Lo que suman unos tickets, con impuestos. */
export function totalDeTickets(tickets: readonly TicketGlobal[]): Centavos {
  return tickets.reduce((n, t) => sumar(n, t.total), CERO);
}

/**
 * Lo vendido que ya quedó en una global de verdad, sobre unas cuentas.
 *
 * Se mide por cuenta y no por periodo: el reporte del contador puede pedir un
 * rango cualquiera, y lo que importa es qué de ESAS ventas ya está amparado.
 */
export function vendidoEnGlobales(
  comandas: readonly EstadoComanda[],
  globales: readonly FacturaGlobalRegistrada[],
): Centavos {
  const enGlobal = new Set<ID>();
  for (const g of globales) {
    if (g.modo !== "produccion") continue;
    for (const o of g.ordenes) enGlobal.add(o);
  }
  let total = CERO;
  for (const c of comandas) {
    if (enGlobal.has(c.orden_id)) total = sumar(total, totalesComanda(c).total);
  }
  return total;
}
