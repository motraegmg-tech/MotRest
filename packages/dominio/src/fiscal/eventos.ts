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
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { Comprobante } from "./comprobante.js";

export type EstadoCfdi = "generado" | "timbrado" | "rechazado" | "cancelado";

export type EventoFiscal =
  | (EventoBase & {
      tipo: "cfdi_generado";
      cfdi_id: ID;
      orden_id: ID;
      serie: string;
      folio: string;
      comprobante: Comprobante;
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
    })
  | (EventoBase & {
      tipo: "cfdi_rechazado";
      cfdi_id: ID;
      /** Código de error del PAC o del SAT. */
      codigo: string;
      motivo: string;
    })
  | (EventoBase & {
      tipo: "cfdi_cancelado";
      cfdi_id: ID;
      motivo: string;
      autorizador_id?: ID;
    });

export type TipoEventoFiscal = EventoFiscal["tipo"];

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
  /** Último error del PAC, si lo hubo. */
  error?: string;
  intentos: number;
  generado_ts: number;
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

    case "cfdi_cancelado":
      return registros.map((r) =>
        r.cfdi_id === ev.cfdi_id ? { ...r, estado: "cancelado" as const } : r,
      );

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
    case "cancelado":
      return "Cancelado";
  }
}
