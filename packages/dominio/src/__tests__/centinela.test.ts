/**
 * Centinela de mermas (C5): dónde se fuga el dinero.
 *
 * Lo que importa probar es que NO confunde las tres cosas —consumo legítimo,
 * merma declarada y faltante de conteo—, que pone la pérdida en pesos y que no
 * manda a nadie a investigar una fuga de dos pesos.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoInventario } from "../inventario/eventos.js";
import type { Insumo } from "../inventario/insumos.js";
import { centinelaMermas, consejoMerma } from "../inventario/centinela.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-alm", sucursal_id: "suc-1" };
const f = () => new FabricaEventos<EventoInventario>(CTX);

const QUESO: Insumo = { id: "ins-queso", nombre: "Queso", unidad_base: "kg", costo_unitario: pesos(100), stock_minimo: 10 };
const MASA: Insumo = { id: "ins-masa", nombre: "Masa", unidad_base: "kg", costo_unitario: pesos(20), stock_minimo: 50 };
const PEREJIL: Insumo = { id: "ins-perejil", nombre: "Perejil", unidad_base: "kg", costo_unitario: pesos(2), stock_minimo: 2 };
const INSUMOS = [QUESO, MASA, PEREJIL];

function mov(insumo_id: string, delta: number, motivo: "consumo_receta" | "merma"): EventoInventario {
  return f().crear("movimiento_inventario", `insumo:${insumo_id}`, {
    insumo_id, delta, unidad: "kg", motivo,
  });
}

function conteo(lineas: { insumo_id: string; contado: number; esperado: number }[]): EventoInventario {
  return f().crear("conteo_registrado", "conteo:suc-1", { lineas });
}

describe("centinela de mermas", () => {
  function operacion(): EventoInventario[] {
    return [
      // Queso: se usaron 10 kg por receta ($1000), se declararon 2 kg de merma
      // ($200) y el conteo encontró 3 kg menos de lo esperado ($300 sin explicar).
      mov("ins-queso", -10, "consumo_receta"),
      mov("ins-queso", -2, "merma"),
      // Masa: mucho consumo, poca merma. Fuga menor.
      mov("ins-masa", -100, "consumo_receta"),
      mov("ins-masa", -1, "merma"),
      // Perejil: 1 kg de merma, pero a $2 el kg es calderilla.
      mov("ins-perejil", -1, "merma"),
      conteo([
        { insumo_id: "ins-queso", contado: 47, esperado: 50 },
        // La masa cuadró: no aporta faltante.
        { insumo_id: "ins-masa", contado: 30, esperado: 30 },
      ]),
    ];
  }

  it("separa merma declarada de faltante de conteo y los valoriza", () => {
    const { alertas } = centinelaMermas(operacion(), INSUMOS);
    const queso = alertas.find((a) => a.insumo_id === "ins-queso")!;

    expect(queso.costo_merma).toBe(pesos(200));
    expect(queso.costo_faltante).toBe(pesos(300));
    expect(queso.perdida).toBe(pesos(500));
    expect(queso.consumo).toBe(10);
  });

  it("ordena del que más pierde al que menos", () => {
    const { alertas } = centinelaMermas(operacion(), INSUMOS);
    expect(alertas.map((a) => a.insumo_id)).toEqual(["ins-queso", "ins-masa", "ins-perejil"]);
  });

  it("suma la pérdida total y cuenta los críticos", () => {
    const r = centinelaMermas(operacion(), INSUMOS);
    // 500 (queso) + 20 (masa) + 2 (perejil)
    expect(r.perdida_total).toBe(pesos(522));
    expect(r.costo_merma_total).toBe(pesos(222));
    expect(r.costo_faltante_total).toBe(pesos(300));
    expect(r.criticos).toBe(1); // solo el queso
  });

  it("marca alta la fuga grande, y deja en paz la calderilla", () => {
    const { alertas } = centinelaMermas(operacion(), INSUMOS);
    expect(alertas.find((a) => a.insumo_id === "ins-queso")!.severidad).toBe("alta");
    // Perejil pierde el 100% de lo que se movió, pero son 2 pesos: no se marca.
    expect(alertas.find((a) => a.insumo_id === "ins-perejil")!.severidad).toBe("ok");
  });

  it("cuando falta más de lo declarado, el consejo apunta a porciones y accesos", () => {
    const { alertas } = centinelaMermas(operacion(), INSUMOS);
    const queso = alertas.find((a) => a.insumo_id === "ins-queso")!;
    expect(consejoMerma(queso)).toMatch(/porciones|accesos/i);
  });

  it("un insumo que solo se consumió, sin merma ni faltante, no genera alerta", () => {
    const alertas = centinelaMermas([mov("ins-queso", -10, "consumo_receta")], INSUMOS).alertas;
    expect(alertas).toEqual([]);
  });

  it("sin movimientos, no hay nada que vigilar", () => {
    const r = centinelaMermas([], INSUMOS);
    expect(r.alertas).toEqual([]);
    expect(r.perdida_total).toBe(pesos(0));
  });
});
