/**
 * Eventos fiscales y cola de timbrado.
 *
 * TRD (A.7.8): el ticket sale al momento aunque el timbrado espere conexión.
 * Por eso el comprobante se GENERA y se guarda de inmediato, y el timbrado es
 * un paso posterior que puede fallar y reintentarse sin bloquear la venta.
 *
 * Estados: generado → (enviado) → timbrado | rechazado
 *                                → cancelado
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { Comprobante } from "./comprobante.js";
import { MOTIVOS_CANCELACION, motivoRequiereSustitucion } from "./claves.js";

export type EstadoCfdi =
  | "generado"
  | "timbrado"
  | "rechazado"
  | "cancelacion_solicitada"
  | "cancelado"
  | "cancelacion_rechazada";

export type EventoFiscal =
  | (EventoBase & {
      tipo: "cfdi_generado";
      cfdi_id: ID;
      orden_id: ID;
      serie: string;
      folio: string;
      comprobante: Comprobante;
      /**
       * A dónde mandarle la factura al comensal, si la pidió por correo.
       *
       * Con FacturAPI el envío lo hace FacturAPI misma (PDF y XML, desde su
       * servidor): no gasta el Gmail del restaurante ni depende de que el Hub
       * tenga el correo configurado. Opcional porque no todo comensal lo da, y
       * por compatibilidad con los eventos anteriores a la 1.5.5.
       */
      correo_receptor?: string;
    })
  | (EventoBase & {
      tipo: "cfdi_timbrado";
      cfdi_id: ID;
      /** UUID fiscal que asigna el SAT. */
      uuid: string;
      /** Fecha de timbrado que devuelve el PAC. */
      fecha_timbrado: string;
      pac: string;
      /**
       * Sellos del Timbre Fiscal Digital.
       *
       * Van en el evento —y no solo en la cola del Hub— porque la caja los
       * necesita para imprimir la representación con su QR de verificación. Son
       * opcionales por compatibilidad con eventos anteriores a esta columna.
       */
      sello_cfd?: string;
      sello_sat?: string;
      no_certificado_sat?: string;
      /**
       * Lo que dice el XML timbrado, cuando lo selló otro.
       *
       * Con FacturAPI el sello del emisor lo pone FacturAPI con el CSD de su
       * panel, así que el número de certificado no está en el comprobante que
       * armó la caja, y el total lo recalcula FacturAPI con seis decimales. La
       * representación impresa y su QR tienen que usar ESTOS dos valores: el
       * verificador del SAT coteja el total contra el del XML, y un centavo de
       * diferencia basta para que diga que la factura no existe.
       */
      no_certificado_emisor?: string;
      total_timbrado?: Centavos;
    })
  | (EventoBase & {
      tipo: "cfdi_rechazado";
      cfdi_id: ID;
      /** Código de error del PAC o del SAT. */
      codigo: string;
      motivo: string;
    })
  | (EventoBase & {
      /**
       * Se PIDE cancelar. Es la solicitud local, antes de que el SAT responda —
       * igual que `cfdi_generado` es la solicitud de timbrado, no el timbre.
       */
      tipo: "cfdi_cancelacion_solicitada";
      cfdi_id: ID;
      /** Código del catálogo c_MotivoCancelacion (01–04). */
      motivo: string;
      /** UUID del comprobante que lo sustituye. Obligatorio solo con motivo 01. */
      uuid_sustitucion?: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /** El SAT confirmó la cancelación. Es el desenlace, no la petición. */
      tipo: "cfdi_cancelado";
      cfdi_id: ID;
      motivo: string;
      fecha_cancelacion?: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /**
       * El SAT/PAC rechazó la cancelación. La factura SIGUE vigente.
       *
       * Pasa, por ejemplo, si el receptor no acepta la cancelación dentro del
       * plazo, o si el motivo no aplica. No es lo mismo que "no se pudo enviar":
       * esto es un no del SAT, no un problema de red.
       */
      tipo: "cfdi_cancelacion_rechazada";
      cfdi_id: ID;
      codigo: string;
      motivo: string;
    })
  | (EventoBase & {
      /**
       * El Hub emitió la factura global de un mes: las cuentas cobradas que
       * nadie facturó a su nombre, a PÚBLICO EN GENERAL.
       *
       * Queda en el registro —no solo en la base del Hub— por dos razones. La
       * caja tiene que poder negarse a facturar a nombre de alguien un ticket
       * que ya entró aquí (regla del SAT: habría que cancelar la global), y el
       * reporte del contador tiene que descontarlo de la «venta sin facturar».
       * Las dos cosas se leen de este hecho, sin preguntarle nada al Hub.
       *
       * Un mes grande puede ir en varias partes (FacturAPI admite hasta 5 000
       * conceptos por factura): cada parte es un evento, con su `parte`.
       */
      tipo: "factura_global_emitida";
      /** El mes que ampara, «AAAA-MM». */
      periodo: string;
      parte: number;
      uuid: string;
      /** El id de la factura en FacturAPI: con él se descarga o se cancela. */
      externo_id: string;
      /** Las cuentas que incluye, por `orden_id`. */
      ordenes: ID[];
      /** Lo que suman esas cuentas, con impuestos. */
      total: Centavos;
      fecha_timbrado?: string;
      /**
       * `pruebas` = timbrada con la llave de pruebas: sin validez ante el SAT.
       * No bloquea nada ni cuenta como facturado; existe para ensayar el ciclo.
       */
      modo: "pruebas" | "produccion";
      /**
       * Quién la disparó: el barrido del Hub o una persona desde la caja.
       *
       * Desde la 1.5.6 el local elige su tipo de facturación, así que una misma
       * base puede tener globales de las dos procedencias. Sin este campo, el
       * historial de la pantalla y el reporte del contador no podrían distinguir
       * «la emitió el sistema a las 06:00» de «la emitió el dueño eligiendo qué
       * entraba», que ante una aclaración del SAT es justo lo que se pregunta.
       *
       * Opcional por compatibilidad: las globales emitidas por la 1.5.5 no lo
       * traen, y todas ellas fueron automáticas.
       */
      origen?: "automatica" | "manual";
      /**
       * La persona que autorizó la emisión manual.
       *
       * Una factura global ampara ventas reales ante el SAT y deja fuera a las
       * demás. Que quede escrito quién decidió ese corte no es burocracia: es lo
       * único que permite responder «¿quién dejó fuera estas 40 cuentas?» meses
       * después. En las automáticas no hay nadie detrás y va vacío.
       */
      autorizador_id?: ID;
    });

export type TipoEventoFiscal = EventoFiscal["tipo"];

/**
 * Los tipos fiscales, enumerados, para quien tenga que filtrarlos.
 *
 * Existe porque la terminal los filtraba con una lista escrita a mano, y las
 * listas escritas a mano se quedan cortas: un `cfdi_timbrado` que el Hub
 * publicaba «para que la caja lo vea» llegaba, se guardaba y no se pintaba,
 * porque el filtro del reparto ni siquiera tenía rama fiscal. Al derivarla de
 * aquí, el día que se añada un tipo nuevo el compilador obliga a ponerlo — el
 * `satisfies` de abajo es lo que lo garantiza, no la buena memoria de nadie.
 */
export const TIPOS_EVENTO_FISCAL = [
  "cfdi_generado",
  "cfdi_timbrado",
  "cfdi_rechazado",
  "cfdi_cancelacion_solicitada",
  "cfdi_cancelado",
  "cfdi_cancelacion_rechazada",
  "factura_global_emitida",
] as const satisfies readonly TipoEventoFiscal[];

/*
 * Y al revés: que no falte ninguno.
 *
 * `satisfies` comprueba que lo de arriba sean tipos VÁLIDOS, pero no que estén
 * TODOS — que es justo la mitad que falló. Esta línea no compila si algún tipo
 * fiscal se queda fuera de la lista.
 */
type FaltaAlgunTipoFiscal = Exclude<TipoEventoFiscal, (typeof TIPOS_EVENTO_FISCAL)[number]>;
const _todosLosTiposFiscalesEstan: FaltaAlgunTipoFiscal extends never ? true : never = true;
void _todosLosTiposFiscalesEstan;

/** Comprobante con su estado, tal como lo ve el módulo de finanzas. */
export interface RegistroCfdi {
  cfdi_id: ID;
  orden_id: ID;
  serie: string;
  folio: string;
  comprobante: Comprobante;
  estado: EstadoCfdi;
  uuid?: string;
  fecha_timbrado?: string;
  pac?: string;
  /** Sellos del timbre, para imprimir la representación con su QR. */
  sello_cfd?: string;
  sello_sat?: string;
  no_certificado_sat?: string;
  /** Del XML timbrado, cuando lo selló FacturAPI. Ver `cfdi_timbrado`. */
  no_certificado_emisor?: string;
  total_timbrado?: Centavos;
  /** A dónde se mandó la factura, si el comensal dio su correo. */
  correo_receptor?: string;
  /** Último error del PAC, si lo hubo. */
  error?: string;
  intentos: number;
  generado_ts: number;
  /** Datos de la cancelación, cuando se solicitó o se canceló. */
  motivo_cancelacion?: string;
  uuid_sustitucion?: string;
  fecha_cancelacion?: string;
}

export function aplicarEventoFiscal(
  registros: readonly RegistroCfdi[],
  ev: EventoFiscal,
): RegistroCfdi[] {
  switch (ev.tipo) {
    case "cfdi_generado": {
      if (registros.some((r) => r.cfdi_id === ev.cfdi_id)) return [...registros];
      return [
        ...registros,
        {
          cfdi_id: ev.cfdi_id,
          orden_id: ev.orden_id,
          serie: ev.serie,
          folio: ev.folio,
          comprobante: ev.comprobante,
          estado: "generado",
          intentos: 0,
          generado_ts: ev.ts,
          ...(ev.correo_receptor ? { correo_receptor: ev.correo_receptor } : {}),
        },
      ];
    }

    case "cfdi_timbrado":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id
          ? {
              ...r,
              estado: "timbrado" as const,
              uuid: ev.uuid,
              fecha_timbrado: ev.fecha_timbrado,
              pac: ev.pac,
              sello_cfd: ev.sello_cfd,
              sello_sat: ev.sello_sat,
              no_certificado_sat: ev.no_certificado_sat,
              ...(ev.no_certificado_emisor
                ? { no_certificado_emisor: ev.no_certificado_emisor }
                : {}),
              ...(ev.total_timbrado !== undefined ? { total_timbrado: ev.total_timbrado } : {}),
              error: undefined,
            }
          : r,
      );

    case "cfdi_rechazado":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id
          ? {
              ...r,
              estado: "rechazado" as const,
              error: `${ev.codigo}: ${ev.motivo}`,
              intentos: r.intentos + 1,
            }
          : r,
      );

    case "cfdi_cancelacion_solicitada":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id
          ? {
              ...r,
              estado: "cancelacion_solicitada" as const,
              motivo_cancelacion: ev.motivo,
              uuid_sustitucion: ev.uuid_sustitucion,
              error: undefined,
            }
          : r,
      );

    case "cfdi_cancelado":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id
          ? {
              ...r,
              estado: "cancelado" as const,
              motivo_cancelacion: ev.motivo,
              fecha_cancelacion: ev.fecha_cancelacion,
              error: undefined,
            }
          : r,
      );

    case "cfdi_cancelacion_rechazada":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id
          ? {
              // Vuelve a "timbrado": la factura sigue vigente y se puede
              // reintentar la cancelación con otro motivo.
              ...r,
              estado: "timbrado" as const,
              error: `Cancelación rechazada · ${ev.codigo}: ${ev.motivo}`,
            }
          : r,
      );

    /*
     * La global no toca los comprobantes individuales: es otro documento, con
     * su propia lectura (`facturasGlobales` en `global.ts`). Pasa por aquí solo
     * para que esta proyección siga siendo exhaustiva.
     */
    case "factura_global_emitida":
      return [...registros];

    default: {
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

export function proyectarCfdis(eventos: readonly EventoFiscal[]): RegistroCfdi[] {
  let registros: RegistroCfdi[] = [];
  for (const ev of eventos) registros = aplicarEventoFiscal(registros, ev);
  return registros;
}

/**
 * Cola de timbrado: comprobantes pendientes de mandar al PAC.
 * Los rechazados vuelven a la cola hasta agotar los reintentos.
 */
export const MAX_REINTENTOS_TIMBRADO = 5;

export function colaDeTimbrado(registros: readonly RegistroCfdi[]): RegistroCfdi[] {
  return registros
    .filter(
      (r) =>
        r.estado === "generado" ||
        (r.estado === "rechazado" && r.intentos < MAX_REINTENTOS_TIMBRADO),
    )
    .sort((a, b) => a.generado_ts - b.generado_ts);
}

/** Comprobantes que ya no se reintentarán solos: necesitan intervención. */
export function requierenAtencion(registros: readonly RegistroCfdi[]): RegistroCfdi[] {
  return registros.filter(
    (r) => r.estado === "rechazado" && r.intentos >= MAX_REINTENTOS_TIMBRADO,
  );
}

/** Stream al que van los eventos fiscales de una sucursal. */
export function streamFiscal(sucursal_id: ID): ID {
  return `fiscal:${sucursal_id}`;
}

export function etiquetaEstadoCfdi(estado: EstadoCfdi): string {
  switch (estado) {
    case "generado":
      return "Pendiente de timbrar";
    case "timbrado":
      return "Timbrado";
    case "rechazado":
      return "Rechazado";
    case "cancelacion_solicitada":
      return "Cancelación en trámite";
    case "cancelado":
      return "Cancelado";
    case "cancelacion_rechazada":
      return "Cancelación rechazada";
  }
}

/**
 * ¿Se puede cancelar este comprobante con este motivo? Devuelve el problema en
 * palabras, o `null` si procede.
 *
 * Concentra las reglas del SAT que, de romperse, hacen que la cancelación se
 * rechace horas después: solo se cancela lo que llegó al SAT (timbrado), el
 * motivo tiene que ser del catálogo, y el `01` —y solo el `01`— exige el UUID
 * del comprobante que sustituye.
 */
export function problemaCancelacion(
  registro: RegistroCfdi,
  motivo: string,
  uuidSustitucion?: string,
): string | null {
  if (registro.estado === "cancelado") return "Este comprobante ya está cancelado.";
  if (registro.estado === "cancelacion_solicitada") {
    return "Ya hay una cancelación en trámite para este comprobante.";
  }
  if (registro.estado !== "timbrado") {
    return "Solo se puede cancelar un comprobante ya timbrado ante el SAT.";
  }

  if (!MOTIVOS_CANCELACION.some((m) => m.clave === motivo)) {
    return "Elige un motivo de cancelación válido del catálogo del SAT.";
  }

  const sustitucion = uuidSustitucion?.trim() ?? "";
  if (motivoRequiereSustitucion(motivo)) {
    if (!sustitucion) {
      return "El motivo 01 exige el folio fiscal (UUID) del comprobante que lo sustituye.";
    }
    if (!/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(sustitucion)) {
      return "El folio fiscal de sustitución no tiene forma de UUID.";
    }
  } else if (sustitucion) {
    return "Este motivo NO lleva comprobante de sustitución; solo el 01 lo usa.";
  }

  return null;
}

/** Cancelaciones pedidas que el Hub todavía no ha mandado al SAT. */
export function colaDeCancelacion(registros: readonly RegistroCfdi[]): RegistroCfdi[] {
  return registros
    .filter((r) => r.estado === "cancelacion_solicitada")
    .sort((a, b) => a.generado_ts - b.generado_ts);
}
