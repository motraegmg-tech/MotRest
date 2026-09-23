/**
 * La global diaria y los correos guardados (1.5.7, pedido de Gonzalo).
 *
 * Un periodo diario es «AAAA-MM-DD». Lo que importa: que sus límites sean los de
 * ese día —y no se le cuelen cuentas del siguiente—, que el calendario cruce bien
 * de un mes a otro, y que un catálogo mal formado no invente una periodicidad ni
 * meta un texto cualquiera como correo.
 */
import { describe, expect, it } from "vitest";
import {
  MAXIMO_CORREOS_FACTURA,
  esPeriodoDiario,
  leerConfiguracionFacturacion,
  leerCorreosDeFactura,
  limitesDelPeriodo,
  periodoDiarioDe,
  periodoEnPalabras,
  periodoGlobalValido,
  periodoMas,
  periodosPorEmitir,
} from "../fiscal/global.js";

describe("el periodo de un día", () => {
  it("se reconoce, y un día que no existe no", () => {
    expect(esPeriodoDiario("2026-09-23")).toBe(true);
    expect(esPeriodoDiario("2026-02-30")).toBe(false);
    expect(esPeriodoDiario("2026-09")).toBe(false);
    expect(periodoGlobalValido("2026-09")).toBe(true);
    expect(periodoGlobalValido("2026-09-23")).toBe(true);
    expect(periodoGlobalValido("septiembre")).toBe(false);
  });

  it("va de la medianoche a la medianoche, y cierra a las 6:00 del día siguiente", () => {
    const { desde, hasta, vence } = limitesDelPeriodo("2026-09-23");
    expect(desde).toBe(new Date(2026, 8, 23).getTime());
    expect(hasta).toBe(new Date(2026, 8, 24).getTime());
    expect(vence).toBe(new Date(2026, 8, 24, 6).getTime());
  });

  it("el mes sigue igual que antes", () => {
    expect(limitesDelPeriodo("2026-09").hasta).toBe(new Date(2026, 9, 1).getTime());
  });

  it("el día siguiente cruza de mes y de año", () => {
    expect(periodoMas("2026-09-30", 1)).toBe("2026-10-01");
    expect(periodoMas("2026-12-31", 1)).toBe("2027-01-01");
    expect(periodoMas("2026-03-01", -1)).toBe("2026-02-28");
    expect(periodoMas("2026-09", 1)).toBe("2026-10");
  });

  it("se nombra para la bitácora", () => {
    expect(periodoDiarioDe(new Date(2026, 8, 5, 22).getTime())).toBe("2026-09-05");
    expect(periodoEnPalabras("2026-09-05")).toBe("el día 2026-09-05");
    expect(periodoEnPalabras("2026-09")).toBe("el mes 2026-09");
  });
});

describe("los días que esperan su global", () => {
  it("son los cerrados desde la configuración, y el de hoy todavía no", () => {
    const pendientes = periodosPorEmitir({
      ahora: new Date(2026, 8, 13, 7).getTime(),
      desde_ts: new Date(2026, 8, 11).getTime(),
      emitidos: new Set(["2026-09-11"]),
      periodicidad: "diaria",
    });
    expect(pendientes).toEqual(["2026-09-10", "2026-09-12"]);
  });

  it("sin decir nada, sigue siendo mensual", () => {
    const pendientes = periodosPorEmitir({
      ahora: new Date(2026, 9, 1, 7).getTime(),
      desde_ts: new Date(2026, 8, 10).getTime(),
      emitidos: new Set(),
    });
    expect(pendientes).toEqual(["2026-09"]);
  });
});

describe("la periodicidad y los correos en el catálogo", () => {
  it("solo «diaria» cambia algo: lo demás es mensual", () => {
    expect(leerConfiguracionFacturacion({ modo_global: "manual", periodicidad_global: "diaria" }).periodicidad_global).toBe("diaria");
    expect(leerConfiguracionFacturacion({ modo_global: "manual", periodicidad_global: "semanal" }).periodicidad_global).toBeUndefined();
  });

  it("los correos llegan limpios: minúsculas, sin repetidos, sin basura, con tope", () => {
    expect(leerCorreosDeFactura(["Conta@Ejemplo.com", "conta@ejemplo.com", "no es correo", 42, "a@b.mx"])).toEqual([
      "conta@ejemplo.com",
      "a@b.mx",
    ]);
    const muchos = Array.from({ length: 15 }, (_, i) => `c${i}@ejemplo.com`);
    expect(leerCorreosDeFactura(muchos)).toHaveLength(MAXIMO_CORREOS_FACTURA);
    expect(leerCorreosDeFactura("a@b.mx")).toEqual([]);
  });

  it("viajan en la configuración, y una lista vacía no deja el campo", () => {
    expect(leerConfiguracionFacturacion({ modo_global: "manual", correos_factura: ["x@y.mx"] }).correos_factura).toEqual(["x@y.mx"]);
    expect(leerConfiguracionFacturacion({ modo_global: "manual", correos_factura: ["nada"] })).not.toHaveProperty("correos_factura");
  });
});
