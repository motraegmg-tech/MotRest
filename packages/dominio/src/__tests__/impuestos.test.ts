import { describe, expect, it } from "vitest";
import { pesos, sumar } from "../comun/dinero.js";
import {
  EXENTO,
  IVA_16,
  calcularImpuesto,
  desglosarConTasas,
  perfilDelProducto,
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

/*
 * EL PRECIO DE CARTA, QUE ES LO QUE PIDIÓ GONZALO.
 *
 * «Si quiero poner un platillo a 100 pesos, que no tenga que teclear 86 y pico
 * para que con el IVA dé 100.» Lo que hay que probar no es la fórmula: es que
 * **lo que paga el comensal sea exactamente la cifra tecleada**, al centavo, en
 * todo el rango de precios de una carta.
 *
 * Y ESE ES EL MOTIVO DE GUARDAR EL TOTAL Y NO LA BASE. Con el impuesto por
 * fuera hay cifras inalcanzables: ninguna base entera en centavos da un total de
 * 7.00, 99.00 ni 128.00 con IVA del 16 % —276 de los 2000 primeros precios
 * redondos—. Al revés siempre cuadra, porque el residuo del redondeo se absorbe
 * en el IVA.
 */
describe("precio de carta con impuesto incluido", () => {
  const cartaConIva = perfilDelProducto(IVA_16, true);

  it("el caso de Gonzalo: se teclea 100 y el comensal paga 100", () => {
    const d = calcularImpuesto(pesos(100), cartaConIva);
    expect(d.total).toBe(pesos(100));
    expect(d.base).toBe(pesos(86.21));
    expect(sumar(d.base, d.iva, d.ieps)).toBe(pesos(100));
  });

  it("cuadra al centavo en TODO el rango de precios de una carta", () => {
    // De $1.00 a $2000.00, de peso en peso: cualquier fallo sería un precio de
    // carta que el restaurantero no puede teclear.
    for (let peso = 1; peso <= 2000; peso++) {
      const deseado = pesos(peso);
      expect(calcularImpuesto(deseado, cartaConIva).total).toBe(deseado);
    }
  });

  /*
   * Los tres que el enfoque anterior NO podía alcanzar. Se dejan por nombre
   * para que se vea de qué se está protegiendo esta prueba.
   */
  it("acierta los precios que despejando la base eran imposibles", () => {
    for (const peso of [7, 99, 104, 128]) {
      expect(calcularImpuesto(pesos(peso), cartaConIva).total).toBe(pesos(peso));
    }
  });

  it("con IVA e IEPS a la vez sigue cuadrando", () => {
    const conIeps: PerfilImpuesto = {
      id: "imp-mixto",
      nombre: "IVA 16 % + IEPS 8 %",
      tasa_iva: 0.16,
      tasa_ieps: 0.08,
      incluido_en_precio: true,
    };
    for (const importe of [pesos(50), pesos(124), pesos(333.33)]) {
      expect(calcularImpuesto(importe, conIeps).total).toBe(importe);
    }
  });

  it("un producto sin bandera se sigue leyendo como siempre: el precio es la base", () => {
    expect(perfilDelProducto(IVA_16, undefined)).toBe(IVA_16);
    expect(calcularImpuesto(pesos(100), IVA_16).total).toBe(pesos(116));
  });

  it("marcar como incluido un perfil que ya lo era no clona nada", () => {
    const incluido: PerfilImpuesto = { ...IVA_16, incluido_en_precio: true };
    expect(perfilDelProducto(incluido, true)).toBe(incluido);
  });

  it("un exento paga lo mismo lo declare como lo declare", () => {
    expect(calcularImpuesto(pesos(100), perfilDelProducto(EXENTO, true)).total).toBe(pesos(100));
  });
});
