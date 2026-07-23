/**
 * Cancelación de un CFDI: las reglas del SAT y el ciclo solicitud → desenlace.
 *
 * Lo que se prueba es sobre todo lo que el SAT rechaza si se hace mal: cancelar
 * algo que nunca se timbró, un motivo fuera del catálogo, y la regla del motivo
 * 01 (exige el UUID que sustituye; los demás no lo llevan).
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import type { Comprobante } from "../fiscal/comprobante.js";
import {
  aplicarEventoFiscal,
  colaDeCancelacion,
  problemaCancelacion,
  proyectarCfdis,
  type EventoFiscal,
  type RegistroCfdi,
} from "../fiscal/eventos.js";
import { motivoRequiereSustitucion, MOTIVOS_CANCELACION } from "../fiscal/claves.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };
const UUID = "A1B2C3D4-1111-2222-3333-444455556666";
const SUSTITUTO = "B2C3D4E5-2222-3333-4444-555566667777";

function comprobante(): Comprobante {
  return { total: pesos(580), serie: "A", folio: "1", orden_id: "ord-1" } as Comprobante;
}

/** Un registro ya timbrado, listo para cancelarse. */
function timbrado(): RegistroCfdi {
  const f = new FabricaEventos<EventoFiscal>(CTX);
  const eventos: EventoFiscal[] = [
    f.crear("cfdi_generado", "fiscal:suc-1", {
      cfdi_id: "c1", orden_id: "ord-1", serie: "A", folio: "1", comprobante: comprobante(),
    }),
    f.crear("cfdi_timbrado", "fiscal:suc-1", {
      cfdi_id: "c1", uuid: UUID, fecha_timbrado: "2026-07-23T20:00:00", pac: "PAC",
    }),
  ];
  return proyectarCfdis(eventos)[0]!;
}

// --- El catálogo del SAT -----------------------------------------------------------------

describe("motivos de cancelación", () => {
  it("son exactamente los cuatro del SAT", () => {
    expect(MOTIVOS_CANCELACION.map((m) => m.clave)).toEqual(["01", "02", "03", "04"]);
  });

  it("solo el 01 exige comprobante de sustitución", () => {
    expect(motivoRequiereSustitucion("01")).toBe(true);
    for (const otro of ["02", "03", "04"]) {
      expect(motivoRequiereSustitucion(otro)).toBe(false);
    }
  });
});

// --- Qué se puede cancelar ---------------------------------------------------------------

describe("reglas de cancelación", () => {
  it("un comprobante timbrado con motivo válido se puede cancelar", () => {
    expect(problemaCancelacion(timbrado(), "02")).toBeNull();
  });

  it("no se cancela lo que nunca llegó al SAT", () => {
    const soloGenerado = { ...timbrado(), estado: "generado" as const };
    expect(problemaCancelacion(soloGenerado, "02")).toMatch(/ya timbrado/);
  });

  it("no se cancela dos veces", () => {
    const yaCancelado = { ...timbrado(), estado: "cancelado" as const };
    expect(problemaCancelacion(yaCancelado, "02")).toMatch(/ya está cancelado/);
  });

  it("no se pide otra cancelación si ya hay una en trámite", () => {
    const enTramite = { ...timbrado(), estado: "cancelacion_solicitada" as const };
    expect(problemaCancelacion(enTramite, "02")).toMatch(/en trámite/);
  });

  it("rechaza un motivo que no está en el catálogo", () => {
    expect(problemaCancelacion(timbrado(), "99")).toMatch(/motivo.*válido/i);
  });
});

// --- La regla del motivo 01 --------------------------------------------------------------

describe("motivo 01: con sustitución", () => {
  it("exige el UUID del comprobante que sustituye", () => {
    expect(problemaCancelacion(timbrado(), "01")).toMatch(/sustituye/);
  });

  it("con el UUID de sustitución bien formado, procede", () => {
    expect(problemaCancelacion(timbrado(), "01", SUSTITUTO)).toBeNull();
  });

  it("rechaza un UUID de sustitución con forma inválida", () => {
    expect(problemaCancelacion(timbrado(), "01", "no-es-uuid")).toMatch(/forma de UUID/);
  });

  /*
   * El error inverso, y también costoso: poner sustitución en un motivo que no
   * la lleva. El SAT lo rechaza igual.
   */
  it("los otros motivos NO admiten sustitución", () => {
    expect(problemaCancelacion(timbrado(), "03", SUSTITUTO)).toMatch(/NO lleva/);
  });
});

// --- El ciclo de vida --------------------------------------------------------------------

describe("ciclo solicitud → desenlace", () => {
  const f = new FabricaEventos<EventoFiscal>(CTX);

  it("solicitar deja el registro en trámite, sin cancelarlo aún", () => {
    let r = timbrado();
    r = aplicarEventoFiscal([r], f.crear("cfdi_cancelacion_solicitada", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "02",
    }))[0]!;

    expect(r.estado).toBe("cancelacion_solicitada");
    expect(r.motivo_cancelacion).toBe("02");
  });

  it("el SAT confirma: queda cancelado con su fecha", () => {
    const solicitado = aplicarEventoFiscal([timbrado()], f.crear("cfdi_cancelacion_solicitada", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "02",
    }));
    const r = aplicarEventoFiscal(solicitado, f.crear("cfdi_cancelado", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "02", fecha_cancelacion: "2026-07-23T21:00:00",
    }))[0]!;

    expect(r.estado).toBe("cancelado");
    expect(r.fecha_cancelacion).toBe("2026-07-23T21:00:00");
  });

  /*
   * Un rechazo del SAT NO es un cancelado: la factura sigue vigente y hay que
   * poder reintentar. Vuelve a "timbrado" con el motivo del rechazo anotado.
   */
  it("un rechazo del SAT deja la factura vigente y reintentar posible", () => {
    const solicitado = aplicarEventoFiscal([timbrado()], f.crear("cfdi_cancelacion_solicitada", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "03",
    }));
    const r = aplicarEventoFiscal(solicitado, f.crear("cfdi_cancelacion_rechazada", "fiscal:suc-1", {
      cfdi_id: "c1", codigo: "708", motivo: "El receptor no aceptó la cancelación",
    }))[0]!;

    expect(r.estado).toBe("timbrado");
    expect(r.error).toContain("708");
    // Y como sigue timbrado, se puede volver a intentar cancelar.
    expect(problemaCancelacion(r, "02")).toBeNull();
  });
});

// --- La cola de cancelación --------------------------------------------------------------

describe("cola de cancelación", () => {
  it("lista solo lo que se pidió cancelar y aún no se resolvió", () => {
    const f = new FabricaEventos<EventoFiscal>(CTX);
    const registros = aplicarEventoFiscal([timbrado()], f.crear("cfdi_cancelacion_solicitada", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "02",
    }));
    expect(colaDeCancelacion(registros)).toHaveLength(1);

    const cancelados = aplicarEventoFiscal(registros, f.crear("cfdi_cancelado", "fiscal:suc-1", {
      cfdi_id: "c1", motivo: "02",
    }));
    expect(colaDeCancelacion(cancelados)).toHaveLength(0);
  });
});
