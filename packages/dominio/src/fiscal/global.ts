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
import { consumoDeSocio } from "../comanda/totales.js";
import { totalesComanda } from "../comanda/totales.js";
import { cobradoPorRenglon, formaPagoSat, type DatosEmisor } from "./comprobante.js";
import type { EstadoCfdi, EventoFiscal, RegistroCfdi } from "./eventos.js";

/** La hora del día 1 a la que el mes anterior se da por cerrado. */
export const HORA_DE_CIERRE_GLOBAL = 6;

/** Clave del SAT para los conceptos de una global: «Venta», unidad «Actividad». */
export const CLAVE_PRODSERV_GLOBAL = "01010101";
export const CLAVE_UNIDAD_GLOBAL = "ACT";
export const DESCRIPCION_GLOBAL = "Venta";

// --- Quién manda sobre la global (1.5.6) --------------------------------------------------

/**
 * Cómo se emite la global en este local.
 *
 * - `manual`: **por defecto**. Nadie timbra nada sin que una persona mire el mes,
 *   elija qué cuentas entran y lo autorice. El Hub sigue avisando cuando el mes
 *   cierra y cuando corren las 72 horas del SAT, pero no emite por su cuenta.
 * - `automatica`: lo de la 1.5.5. A las 06:00 del día 1 el Hub junta todo lo no
 *   facturado del mes anterior y lo timbra solo.
 *
 * EL PORQUÉ. Hasta la 1.5.5 solo existía lo segundo, y eso convertía al Hub en
 * quien decide qué declara el restaurante ante el SAT. Gonzalo lo dio vuelta en
 * la 1.5.6: «el restaurantero elige y es dueño de su tipo de facturación». Por
 * eso el valor por omisión es `manual`: un local que se actualiza sin tocar nada
 * deja de emitir solo, que es el comportamiento del que nadie se arrepiente —lo
 * contrario, timbrar sin que nadie lo pidiera, no se puede deshacer sin cancelar
 * ante el SAT.
 */
export type ModoFacturacionGlobal = "manual" | "automatica";

/**
 * Cada cuánto se ampara lo vendido (1.5.7, pedido de Gonzalo).
 *
 * `mensual` es lo de siempre. `diaria` es para el local que prefiere cerrar cada
 * día con su propia global: el SAT la admite (periodicidad «01 Diario») y le da
 * al restaurantero un control día por día. Un periodo diario se escribe
 * «AAAA-MM-DD»; uno mensual, «AAAA-MM». El formato del periodo es lo que dice de
 * qué tipo es, así que el registro, las llaves de idempotencia y el historial no
 * necesitan otro campo.
 */
export type PeriodicidadGlobal = "mensual" | "diaria";

/** Cuántos correos guardados se admiten. Más no caben en un selector. */
export const MAXIMO_CORREOS_FACTURA = 10;

/**
 * Clave del catálogo donde viaja esta decisión, al estilo de `correo_config`.
 *
 * Es un catálogo y no un evento porque no es un hecho del negocio: es un ajuste
 * del local que se sobrescribe, y a nadie le importa el historial de cuándo se
 * cambió de modo. Se publica desde la caja, el Hub lo aplica al recibirlo y
 * Central lo ve.
 */
export const CLAVE_FACTURACION_CONFIG = "facturacion_config";

/** Lo que viaja dentro de ese catálogo. */
export interface ConfiguracionFacturacion {
  modo_global: ModoFacturacionGlobal;
  version: number;
  updated_at: number;
  /**
   * Los datos fiscales del restaurante (1.5.6).
   *
   * Hasta la 1.5.5 vivían solo en el almacén de CADA tableta: el Hub nunca los
   * tuvo, y una tableta nueva tenía que volver a capturarlos. Viajan aquí porque
   * el Hub ahora emite por su cuenta —las autofacturas del portal— y el
   * comprobante los lleva. No son secretos: van impresos en cada factura.
   */
  emisor?: DatosEmisor;
  /** Mensual por omisión. Ver `PeriodicidadGlobal`. */
  periodicidad_global?: PeriodicidadGlobal;
  /**
   * Desde cuándo rige la periodicidad actual. En automático, el barrido diario
   * empieza en el mes de este cambio: no se pone a emitir globales diarias de
   * meses que ya se ampararon con la mensual.
   */
  periodicidad_desde?: number;
  /**
   * Los correos guardados para mandar las facturas globales (1.5.7). Viajan en
   * el catálogo para que cualquier caja del local los ofrezca.
   */
  correos_factura?: string[];
}

/** El punto de partida de un local que nunca tocó el ajuste: nadie emite solo. */
export function configuracionFacturacionVacia(): ConfiguracionFacturacion {
  return { modo_global: "manual", version: 0, updated_at: 0 };
}

/**
 * Interpreta lo que llegó en el catálogo, sin fiarse de la forma.
 *
 * Por el canal puede llegar un objeto de una versión anterior, de una terminal a
 * medio actualizar o directamente basura. Un `modo_global` que no se reconozca
 * NO se toma por bueno ni se inventa: se vuelve a `manual`, porque equivocarse
 * hacia «no emitas nada» solo cuesta un clic, y equivocarse hacia «emite todo»
 * cuesta una cancelación ante el SAT.
 */
export function leerConfiguracionFacturacion(datos: unknown): ConfiguracionFacturacion {
  const vacia = configuracionFacturacionVacia();
  if (!datos || typeof datos !== "object") return vacia;
  const crudo = datos as Partial<ConfiguracionFacturacion>;
  const emisor = leerEmisor(crudo.emisor);
  const correos = leerCorreosDeFactura(crudo.correos_factura);
  return {
    modo_global: crudo.modo_global === "automatica" ? "automatica" : "manual",
    version: Number.isSafeInteger(crudo.version) && crudo.version! >= 0 ? crudo.version! : 0,
    updated_at: Number.isSafeInteger(crudo.updated_at) && crudo.updated_at! >= 0 ? crudo.updated_at! : 0,
    ...(emisor ? { emisor } : {}),
    // Lo que no se reconozca es mensual: es el comportamiento de siempre.
    ...(crudo.periodicidad_global === "diaria" ? { periodicidad_global: "diaria" as const } : {}),
    ...(Number.isSafeInteger(crudo.periodicidad_desde) && crudo.periodicidad_desde! > 0
      ? { periodicidad_desde: crudo.periodicidad_desde! }
      : {}),
    ...(correos.length > 0 ? { correos_factura: correos } : {}),
  };
}

/** ¿Tiene forma de correo? No se promete que exista: eso lo dice el buzón. */
export function correoDeFacturaValido(correo: string): boolean {
  return correo.length <= 200 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(correo);
}

/**
 * Los correos, limpios: en minúsculas, sin repetidos, con forma de correo y a lo
 * más `MAXIMO_CORREOS_FACTURA`. Es lo mismo para lo que llega por el catálogo y
 * para lo que pide la caja al emitir: el Hub no manda la factura a un texto que
 * no es un correo.
 */
export function leerCorreosDeFactura(dato: unknown): string[] {
  if (!Array.isArray(dato)) return [];
  const limpios: string[] = [];
  for (const c of dato) {
    if (typeof c !== "string") continue;
    const correo = c.trim().toLowerCase();
    if (!correoDeFacturaValido(correo) || limpios.includes(correo)) continue;
    limpios.push(correo);
    if (limpios.length === MAXIMO_CORREOS_FACTURA) break;
  }
  return limpios;
}

/**
 * Los datos del emisor, solo si tienen forma de datos del emisor. No se
 * validan contra el SAT aquí —eso lo hace `validarComprobante` al facturar—:
 * solo se descarta lo que no es texto o es desmedido, para que un catálogo mal
 * formado no acabe dentro de un comprobante.
 */
function leerEmisor(dato: unknown): DatosEmisor | undefined {
  if (!dato || typeof dato !== "object") return undefined;
  const d = dato as Record<string, unknown>;
  const texto = (v: unknown, tope: number) => (typeof v === "string" && v.length <= tope ? v : null);
  const rfc = texto(d.rfc, 13);
  const nombre = texto(d.nombre, 300);
  const regimen = texto(d.regimen_fiscal, 3);
  const cp = texto(d.codigo_postal, 5);
  if (rfc === null || nombre === null || regimen === null || cp === null) return undefined;
  const comercial = texto(d.nombre_comercial, 120);
  return {
    rfc,
    nombre,
    regimen_fiscal: regimen,
    codigo_postal: cp,
    ...(comercial ? { nombre_comercial: comercial } : {}),
  };
}

// --- El periodo ---------------------------------------------------------------------------

/** El mes de un instante, en la hora del local: «AAAA-MM». */
export function periodoDe(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodoValido(periodo: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo);
}

/** El día de un instante, en la hora del local: «AAAA-MM-DD». */
export function periodoDiarioDe(ts: number): string {
  const d = new Date(ts);
  return `${periodoDe(ts)}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ¿Es un periodo de un día, y ese día existe? («2026-02-30» no.) */
export function esPeriodoDiario(periodo: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(periodo)) return false;
  const [anio, mes, dia] = periodo.split("-").map(Number) as [number, number, number];
  return new Date(anio, mes - 1, dia).getDate() === dia;
}

/** Un periodo de global válido, mensual o diario. */
export function periodoGlobalValido(periodo: string): boolean {
  return periodoValido(periodo) || esPeriodoDiario(periodo);
}

/** El periodo de un instante según la periodicidad del local. */
export function periodoSegun(periodicidad: PeriodicidadGlobal, ts: number): string {
  return periodicidad === "diaria" ? periodoDiarioDe(ts) : periodoDe(ts);
}

/** «el mes 2026-09» o «el día 2026-09-23», para frases de bitácora y avisos. */
export function periodoEnPalabras(periodo: string): string {
  return esPeriodoDiario(periodo) ? `el día ${periodo}` : `el mes ${periodo}`;
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
  if (esPeriodoDiario(periodo)) {
    // Un día cierra a las 06:00 del siguiente, por la misma razón que el mes:
    // el servicio que cierra de madrugada todavía es de ese día.
    const [anio, mes, dia] = periodo.split("-").map(Number) as [number, number, number];
    return {
      desde: new Date(anio, mes - 1, dia).getTime(),
      hasta: new Date(anio, mes - 1, dia + 1).getTime(),
      vence: new Date(anio, mes - 1, dia + 1, HORA_DE_CIERRE_GLOBAL).getTime(),
    };
  }
  const [anio, mes] = periodo.split("-").map(Number) as [number, number];
  return {
    desde: new Date(anio, mes - 1, 1).getTime(),
    hasta: new Date(anio, mes, 1).getTime(),
    vence: new Date(anio, mes, 1, HORA_DE_CIERRE_GLOBAL).getTime(),
  };
}

/** El periodo siguiente (o anterior, con `delta` negativo): mes o día, según el que llegue. */
export function periodoMas(periodo: string, delta: number): string {
  if (esPeriodoDiario(periodo)) {
    const [anio, mes, dia] = periodo.split("-").map(Number) as [number, number, number];
    return periodoDiarioDe(new Date(anio, mes - 1, dia + delta).getTime());
  }
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
  /** Mensual si no se dice: es lo de antes de la 1.5.7. */
  periodicidad?: PeriodicidadGlobal;
}): string[] {
  const { ahora, desde_ts, emitidos } = opciones;
  const pendientes: string[] = [];

  // Se arranca un periodo antes del de la configuración: si se configuró el día 1
  // a las 3 de la mañana, el mes anterior todavía no había cerrado y le toca.
  let periodo = periodoMas(periodoSegun(opciones.periodicidad ?? "mensual", desde_ts), -1);
  // El tope alcanza para años de días; solo existe para que un reloj absurdo no cuelgue el Hub.
  for (let vueltas = 0; vueltas < 5_000; vueltas++) {
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
  /** Barrido del Hub o decisión de una persona. Sin él, automática (1.5.5). */
  origen?: ModoFacturacionGlobal;
  /** Quién la autorizó, cuando la emitió una persona. */
  autorizador_id?: ID;
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
      /*
       * Sin `origen` la global es de la 1.5.5, y en la 1.5.5 TODAS salían del
       * barrido del Hub. Rellenarlo aquí evita que cada pantalla que lo lea
       * tenga que acordarse de ese detalle histórico.
       */
      origen: ev.origen ?? "automatica",
      ...(ev.autorizador_id ? { autorizador_id: ev.autorizador_id } : {}),
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

/** ¿Este CFDI ya ampara su venta? Ver `AMPARAN`. */
export function cfdiAmpara(estado: EstadoCfdi): boolean {
  return AMPARAN.has(estado);
}

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

    /*
     * EL CONSUMO DE SOCIO NO VA EN LA GLOBAL (1.5.6). No fue una venta al
     * público: lo cubrió la bolsa que ese socio tiene pactada con el negocio.
     * Meterlo declararía ante el SAT un ingreso que nunca entró.
     */
    if (consumoDeSocio(c) > 0) continue;

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

// --- La selección del restaurantero (1.5.6) -----------------------------------------------

/** Por qué una cuenta elegida en la caja no pudo entrar en la global. */
export type MotivoDescarte =
  | "desconocida"
  | "sin_cobrar"
  | "otro_periodo"
  | "ya_facturada"
  | "en_global"
  | "consumo_socio"
  | "sin_importe";

export interface CuentaDescartada {
  orden_id: ID;
  motivo: MotivoDescarte;
}

export interface SeleccionParaGlobal {
  /** Lo que sí entra, en el orden en que se cobró. */
  tickets: TicketGlobal[];
  /** Lo que se cayó del filtro, con su razón. */
  descartadas: CuentaDescartada[];
}

/**
 * Filtra las cuentas que eligió el restaurantero para su global manual.
 *
 * ## POR QUÉ SE VUELVE A FILTRAR LO QUE YA ELIGIÓ UNA PERSONA
 *
 * La pantalla de la caja ya enseña el estado de cada cuenta, así que en el caso
 * normal aquí no se cae ninguna. Pero entre que la pantalla pintó la lista y que
 * el dedo tocó «Emitir» pueden pasar minutos, y en esos minutos otra terminal
 * pudo facturar un ticket a nombre del comensal. Emitir la global con ese ticket
 * dentro declararía la misma venta dos veces ante el SAT, y deshacerlo exige
 * cancelar la global entera (motivo 04) y volver a empezar. El filtro es barato;
 * la cancelación no.
 *
 * Y la razón dura: lo que llega por el canal lo manda una tableta, y una tableta
 * puede estar manipulada o simplemente ir atrasada. El Hub no da por buena una
 * lista de órdenes porque venga «de dentro».
 *
 * ## LO QUE SE DESCARTA
 *
 * Lo mismo que `ticketsParaGlobal` decide por su cuenta, dicho una por una para
 * poder contarlo en pantalla: cuentas que no existen en este registro, sin
 * cobrar (abiertas, anuladas o canceladas), de otro mes, ya amparadas por un
 * CFDI vigente o por otra global, consumo de socio —que desde la 1.5.6 no es
 * venta— y las que no tienen un peso que facturar.
 */
export function ticketsElegidosParaGlobal(opciones: {
  seleccion: readonly ID[];
  /** Las cuentas que el Hub pudo reconstruir de su registro. */
  comandas: readonly EstadoComanda[];
  cfdis: readonly RegistroCfdi[];
  /** Solo las del mismo modo que la que se va a emitir. */
  globales: readonly FacturaGlobalRegistrada[];
  periodo: string;
}): SeleccionParaGlobal {
  const { desde, hasta } = limitesDelPeriodo(opciones.periodo);

  const amparadas = new Set<ID>();
  for (const r of opciones.cfdis) if (AMPARAN.has(r.estado)) amparadas.add(r.orden_id);
  const enGlobal = new Set<ID>();
  for (const g of opciones.globales) for (const o of g.ordenes) enGlobal.add(o);

  const porOrden = new Map<ID, EstadoComanda>();
  for (const c of opciones.comandas) porOrden.set(c.orden_id, c);

  const tickets: TicketGlobal[] = [];
  const descartadas: CuentaDescartada[] = [];
  // La misma cuenta marcada dos veces en la pantalla no es un error que haya que
  // contarle a nadie: es la misma cuenta.
  const vistas = new Set<ID>();

  for (const orden of opciones.seleccion) {
    if (vistas.has(orden)) continue;
    vistas.add(orden);

    const cuenta = porOrden.get(orden);
    if (!cuenta) {
      descartadas.push({ orden_id: orden, motivo: "desconocida" });
      continue;
    }
    if (!cuenta.cerrada || cuenta.anulada || cuenta.cancelada || cuenta.cerrada_ts === undefined) {
      descartadas.push({ orden_id: orden, motivo: "sin_cobrar" });
      continue;
    }
    if (cuenta.cerrada_ts < desde || cuenta.cerrada_ts >= hasta) {
      descartadas.push({ orden_id: orden, motivo: "otro_periodo" });
      continue;
    }
    if (amparadas.has(orden)) {
      descartadas.push({ orden_id: orden, motivo: "ya_facturada" });
      continue;
    }
    if (enGlobal.has(orden)) {
      descartadas.push({ orden_id: orden, motivo: "en_global" });
      continue;
    }
    if (consumoDeSocio(cuenta) > 0) {
      descartadas.push({ orden_id: orden, motivo: "consumo_socio" });
      continue;
    }

    const conceptos = conceptosDeTicket(cuenta);
    const total = sumar(...conceptos.map((x) => x.total));
    if (conceptos.length === 0 || total <= 0) {
      descartadas.push({ orden_id: orden, motivo: "sin_importe" });
      continue;
    }

    tickets.push({
      orden_id: orden,
      folio: folioDeTicket(orden),
      cerrada_ts: cuenta.cerrada_ts,
      total,
      conceptos,
      pagos: cuenta.pagos.map((p) => ({ forma: p.forma, monto: p.monto })),
    });
  }

  return { tickets: tickets.sort((a, b) => a.cerrada_ts - b.cerrada_ts), descartadas };
}

/**
 * El motivo, en palabras que se puedan leer en la caja o en la bitácora.
 *
 * Son frases que van DETRÁS de un número («3 de otro mes»), así que ninguna
 * lleva verbo conjugado: con «ya tiene factura» habría que escribir dos
 * versiones y acertar con la concordancia, y esa es la clase de detalle que
 * acaba enseñándole «1 cuentas» a un restaurantero.
 */
export function motivoDescarteEnPalabras(motivo: MotivoDescarte): string {
  switch (motivo) {
    case "desconocida":
      return "sin rastro en el registro de este local";
    case "sin_cobrar":
      return "sin cobrar (abiertas, anuladas o canceladas)";
    case "otro_periodo":
      return "de otro periodo";
    case "ya_facturada":
      return "con factura a nombre del cliente";
    case "en_global":
      return "ya en otra factura global";
    case "consumo_socio":
      return "de consumo de socio (no es una venta)";
    case "sin_importe":
      return "sin importe que facturar";
  }
}

/**
 * «2 con factura a nombre del cliente, 1 de otro mes».
 *
 * Se agrupa por motivo y no se enumeran las órdenes: quien lee esto en la caja
 * necesita entender qué pasó, no una lista de identificadores.
 */
export function resumenDeDescartes(descartadas: readonly CuentaDescartada[]): string {
  const cuenta = new Map<MotivoDescarte, number>();
  for (const d of descartadas) cuenta.set(d.motivo, (cuenta.get(d.motivo) ?? 0) + 1);
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, n]) => `${n} ${motivoDescarteEnPalabras(motivo)}`)
    .join(", ");
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
