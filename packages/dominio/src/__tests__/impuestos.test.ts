import { describe, expect, it } from "vitest";
import { pesos, sumar } from "../comun/dinero.js";
import {
  EXENTO,
  IVA_16,
  calcularImpuesto,
  desglosarConTasas,
  snapshotTasas,
  type PerfilImpuesto,
} from "../comun/impuestos.js";

describe("IVA visible en el formulario de producto", () => {
  it("el ejemplo de Gonzalo: precio 100 → IVA 16 → total 116", () => {
    const d = calcularImpuesto(pesos(100), IVA_16);
    expect(d.base).toBe(pesos(100));
    expect(d.iva).toBe(pesos(16));
    expect(d.total).toBe(pesos(116));
  });

  it("calcula el IVA de un precio con centavos", () => {
    const d = calcularImpuesto(pesos(249), IVA_16);
    expect(d.iva).toBe(pesos(39.84));
    expect(d.total).toBe(pesos(288.84));
  });

  it("un producto exento no genera impuesto", () => {
    const d = calcularImpuesto(pesos(100), EXENTO);
    expect(d.iva).toBe(0);
    expect(d.total).toBe(pesos(100));
  });
});

describe("precio con IVA incluido", () => {
  const incluido: PerfilImpuesto = { ...IVA_16, id: "imp-inc", incluido_en_precio: true };

  it("extrae el impuesto contenido en el precio", () => {
    const d = calcularImpuesto(pesos(116), incluido);
    expect(d.base).toBe(pesos(100));
    expect(d.iva).toBe(pesos(16));
    expect(d.total).toBe(pesos(116));
  });

  it("base + iva + ieps SIEMPRE cuadra con el precio, sin perder centavos", () => {
    for (const monto of [116, 100, 99.99, 45, 38.5, 0.03, 1234.57]) {
      const precio = pesos(monto);
      const d = calcularImpuesto(precio, incluido);
      expect(sumar(d.base, d.iva, d.ieps)).toBe(precio);
      expect(d.total).toBe(precio);
    }
  });
});

describe("IEPS", () => {
  const conIeps: PerfilImpuesto = {
    id: "imp-ieps",
    nombre: "IVA 16 % + IEPS 8 %",
    tasa_iva: 0.16,
    tasa_ieps: 0.08,
    incluido_en_precio: false,
  };

  it("suma IEPS además del IVA", () => {
    const d = calcularImpuesto(pesos(100), conIeps);
    expect(d.iva).toBe(pesos(16));
    expect(d.ieps).toBe(pesos(8));
    expect(d.total).toBe(pesos(124));
  });
});

describe("snapshot de tasas en el renglón", () => {
  it("desglosar con el snapshot da lo mismo que con el perfil", () => {
    const snap = snapshotTasas(IVA_16);
    expect(desglosarConTasas(pesos(100), snap)).toEqual(calcularImpuesto(pesos(100), IVA_16));
  });
});
