/**
 * Facturar desde la caja con la factura global mensual (1.5.5, FacturAPI).
 *
 * Una venta no puede ir en dos comprobantes. Con la global, el ticket de un mes
 * ya cerrado —o que ya entró en una global de verdad— no se factura a nombre de
 * nadie desde la caja: habría que cancelar la global ante el SAT. Y el correo
 * del cliente viaja en el comprobante para que FacturAPI le mande su factura.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  FabricaEventos,
  pesos,
  proyectarComanda,
  snapshotTasas,
  IVA_16,
  uuidv7,
  type EventoComanda,
  type EventoFiscal,
} from "@motrest/dominio";
import { fiscal } from "../fiscal.svelte";

const CTX = { device_id: "dev-prueba", empleado_id: "usr-gonzalo", sucursal_id: "suc-1" };

/** Una cuenta cobrada de 100 pesos, cerrada en el momento indicado. */
function cuentaCerrada(cerrada_ts: number) {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: cerrada_ts - 3_600_000 }),
    f.crear("item_agregado", orden_id, {
      orden_id,
      renglon: {
        id: uuidv7(),
        producto_id: "p1",
        descripcion: "Pizza",
        cantidad: 1,
        precio_unitario: pesos(100),
        costo_unitario: pesos(30),
        impuesto: snapshotTasas(IVA_16),
        estado: "entregado",
      },
    }),
  ];
  const estado = proyectarComanda(eventos);
  return { ...estado, cerrada: true, cerrada_ts };
}

const RECEPTOR = {
  rfc: "GODE561231GR8",
  nombre: "JUAN PEREZ LOPEZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
};

beforeEach(() => {
  fiscal.emisor = {
    rfc: "RPA200101AB1",
    nombre: "RODIZIO PIZZAS",
    regimen_fiscal: "601",
    codigo_postal: "44100",
  };
});

describe("la regla de la factura global en la caja", () => {
  it("un ticket de este mes se factura, y lleva el correo del cliente", () => {
    const cuenta = cuentaCerrada(Date.now() - 60_000);
    const r = fiscal.facturar(cuenta, RECEPTOR, { correo: " ana@correo.mx ", conGlobal: true });
    expect(r.ok).toBe(true);
    expect(r.registro?.orden_id).toBe(cuenta.orden_id);
    // Limpio: FacturAPI se la manda a esta dirección.
    expect(r.registro?.correo_receptor).toBe("ana@correo.mx");
  });

  it("un ticket de un mes ya cerrado no se factura a nombre de nadie", () => {
    const hace40dias = Date.now() - 40 * 86_400_000;
    const r = fiscal.facturar(cuentaCerrada(hace40dias), RECEPTOR, { conGlobal: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/factura global/);
  });

  it("sin factura global (sin FacturAPI) no se bloquea por el mes", () => {
    const hace40dias = Date.now() - 40 * 86_400_000;
    const r = fiscal.facturar(cuentaCerrada(hace40dias), RECEPTOR, { conGlobal: false });
    expect(r.error ?? "").not.toMatch(/factura global/);
  });

  it("un ticket que ya entró en una global de producción se bloquea y dice cuál", () => {
    const cuenta = cuentaCerrada(Date.now() - 60_000);
    const f = new FabricaEventos<EventoFiscal>(CTX);
    fiscal.integrar([
      f.crear("factura_global_emitida", "fiscal-suc-1", {
        periodo: "2026-08",
        parte: 1,
        uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        externo_id: "fapi-1",
        ordenes: [cuenta.orden_id],
        total: pesos(116),
        modo: "produccion",
      }),
    ]);
    const r = fiscal.facturar(cuenta, RECEPTOR, { conGlobal: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/agosto de 2026/);
  });

  it("una global de PRUEBAS no bloquea: no existe ante el SAT", () => {
    const cuenta = cuentaCerrada(Date.now() - 60_000);
    const f = new FabricaEventos<EventoFiscal>(CTX);
    fiscal.integrar([
      f.crear("factura_global_emitida", "fiscal-suc-1", {
        periodo: "2026-08",
        parte: 1,
        uuid: "11111111-2222-3333-4444-555555555555",
        externo_id: "fapi-prueba",
        ordenes: [cuenta.orden_id],
        total: pesos(116),
        modo: "pruebas",
      }),
    ]);
    const r = fiscal.facturar(cuenta, RECEPTOR, { conGlobal: true });
    expect(r.ok).toBe(true);
  });
});
