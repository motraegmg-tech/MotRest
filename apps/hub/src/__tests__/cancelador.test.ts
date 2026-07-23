/**
 * El cancelador del Hub: de la solicitud al desenlace ante el SAT.
 *
 * Contra un log real y un PAC de mentira. Lo que importa es que un desenlace
 * firme —cancelado o rechazado— vuelva UNA vez al registro del local, y que lo
 * que no se resuelve (sin PAC, red caída, en espera) se retome sin duplicar.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import { FabricaEventos, pesos, type Comprobante, type EventoFiscal } from "@motrest/dominio";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { Cancelador } from "../fiscal/cancelador.js";
import { Sellador } from "../fiscal/sellador.js";
import type { PeticionCancelacion, ResultadoCancelacion } from "../fiscal/pac.js";
import { generarCsdDePrueba, type CsdDePrueba } from "./csd-de-prueba.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const RFC = "AAA010101AAA";
const UUID = "A1B2C3D4-1111-2222-3333-444455556666";

let csd: CsdDePrueba;
let log: LogHub;
let db: TipoDb;
let carpeta: string;
let sellador: Sellador;

const fabrica = () =>
  new FabricaEventos<EventoFiscal>({ device_id: "dev-caja", empleado_id: "emp", sucursal_id: SUC });

/** Deja en el log un CFDI generado y timbrado, listo para cancelar. */
function facturaTimbrada(): void {
  const f = fabrica();
  log.ingerir([
    f.crear("cfdi_generado", `fiscal:${SUC}`, {
      cfdi_id: "c1", orden_id: "ord-1", serie: "A", folio: "1",
      comprobante: { total: pesos(580) } as Comprobante,
    }),
    f.crear("cfdi_timbrado", `fiscal:${SUC}`, {
      cfdi_id: "c1", uuid: UUID, fecha_timbrado: "2026-07-23T20:00:00", pac: "PAC",
    }),
  ]);
}

function solicitarCancelacion(motivo = "02"): void {
  log.ingerir([
    fabrica().crear("cfdi_cancelacion_solicitada", `fiscal:${SUC}`, { cfdi_id: "c1", motivo }),
  ]);
}

class PacFalso {
  readonly nombre = "PAC de prueba";
  peticiones: PeticionCancelacion[] = [];
  async timbrar() {
    return { estado: "reintentable" as const, motivo: "no aplica" };
  }
  constructor(private responder: (n: number) => ResultadoCancelacion) {}
  cancelar = async (p: PeticionCancelacion): Promise<ResultadoCancelacion> => {
    this.peticiones.push(p);
    return this.responder(this.peticiones.length);
  };
}

function eventosDe(tipo: string): EventoFiscal[] {
  return log.porTipo(tipo, 0, 100) as unknown as EventoFiscal[];
}

beforeEach(async () => {
  csd ??= await generarCsdDePrueba({ rfc: RFC });
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  carpeta = mkdtempSync(join(tmpdir(), "motrest-cancel-"));
  sellador = new Sellador(carpeta);
  sellador.instalar(csd.cer, csd.key, csd.contrasena, RFC);
});

afterEach(() => {
  log.cerrar();
  db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

describe("cancelar ante el SAT", () => {
  it("una cancelación aceptada vuelve al registro como cancelada", async () => {
    const pac = new PacFalso(() => ({ estado: "cancelado", fecha: "2026-07-23T21:00:00" }));
    const c = new Cancelador(log, sellador, db, pac);
    facturaTimbrada();
    solicitarCancelacion();

    expect(await c.procesar()).toEqual({ resueltas: 1 });
    const [cancelado] = eventosDe("cfdi_cancelado");
    expect(cancelado).toMatchObject({ cfdi_id: "c1", fecha_cancelacion: "2026-07-23T21:00:00" });
  });

  it("le pide al PAC el UUID del comprobante y su RFC emisor", async () => {
    const pac = new PacFalso(() => ({ estado: "cancelado", fecha: "x" }));
    const c = new Cancelador(log, sellador, db, pac);
    facturaTimbrada();
    solicitarCancelacion("02");
    await c.procesar();

    expect(pac.peticiones[0]).toMatchObject({ uuid: UUID, rfc_emisor: RFC, motivo: "02" });
  });

  /*
   * Un rechazo del SAT no es una cancelación: la factura sigue vigente. Vuelve
   * como `cfdi_cancelacion_rechazada` y el registro regresa a "timbrado".
   */
  it("un rechazo del SAT se publica sin cancelar la factura", async () => {
    const pac = new PacFalso(() => ({ estado: "rechazado", codigo: "708", motivo: "No aceptada" }));
    const c = new Cancelador(log, sellador, db, pac);
    facturaTimbrada();
    solicitarCancelacion("03");

    expect(await c.procesar()).toEqual({ resueltas: 1 });
    expect(eventosDe("cfdi_cancelado")).toHaveLength(0);
    expect(eventosDe("cfdi_cancelacion_rechazada")[0]).toMatchObject({ codigo: "708" });
  });

  it("procesar dos veces no publica el desenlace por duplicado", async () => {
    const pac = new PacFalso(() => ({ estado: "cancelado", fecha: "x" }));
    const c = new Cancelador(log, sellador, db, pac);
    facturaTimbrada();
    solicitarCancelacion();

    await c.procesar();
    await c.procesar();
    await c.procesar();

    expect(eventosDe("cfdi_cancelado")).toHaveLength(1);
    expect(pac.peticiones).toHaveLength(1);
  });

  /*
   * Sin PAC que cancele, la solicitud espera —no se pierde ni se da por
   * rechazada—. Cuando el PAC exista, se retoma.
   */
  it("sin PAC configurado, la solicitud queda pendiente", async () => {
    const c = new Cancelador(log, sellador, db, null);
    facturaTimbrada();
    solicitarCancelacion();

    expect(await c.procesar()).toEqual({ resueltas: 0 });
    expect(eventosDe("cfdi_cancelado")).toHaveLength(0);
    expect(eventosDe("cfdi_cancelacion_rechazada")).toHaveLength(0);
  });

  it("una que quedó en espera del receptor se retoma en el próximo ciclo", async () => {
    let aceptada = false;
    const pac = new PacFalso(() =>
      aceptada ? { estado: "cancelado", fecha: "x" } : { estado: "en_espera", motivo: "receptor" },
    );
    const c = new Cancelador(log, sellador, db, pac);
    facturaTimbrada();
    solicitarCancelacion();

    expect(await c.procesar()).toEqual({ resueltas: 0 });
    expect(eventosDe("cfdi_cancelado")).toHaveLength(0);

    aceptada = true;
    expect(await c.procesar()).toEqual({ resueltas: 1 });
    expect(eventosDe("cfdi_cancelado")).toHaveLength(1);
  });

  it("si no encuentra el timbre, lo rechaza en vez de colgarse", async () => {
    const pac = new PacFalso(() => ({ estado: "cancelado", fecha: "x" }));
    const c = new Cancelador(log, sellador, db, pac);
    // Solicitud SIN factura timbrada previa.
    solicitarCancelacion();

    await c.procesar();
    expect(eventosDe("cfdi_cancelacion_rechazada")[0]).toMatchObject({ codigo: "SIN_UUID" });
    expect(pac.peticiones).toHaveLength(0);
  });
});
