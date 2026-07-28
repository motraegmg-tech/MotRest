/**
 * Motor de promociones.
 *
 * Lo que más importa probar es lo que evita regalar producto sin querer: que el
 * 2×1 regale el MÁS BARATO, que dos promociones no se apilen sobre el mismo
 * platillo, y que una franja que cruza la medianoche funcione —porque un «happy
 * hour de 22 a 2» es exactamente lo que pide un restaurante de noche—.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import {
  aplicarPromociones,
  describirPromocion,
  estaVigente,
  promocionesPendientes,
  type Promocion,
} from "../catalogo/promociones.js";

function renglon(productoId: string, precio: number, cantidad = 1): RenglonComanda {
  return {
    id: uuidv7(), producto_id: productoId, descripcion: productoId, cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(60),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

const CATEGORIA: Record<string, string> = { pizza: "cat-pizzas", refresco: "cat-bebidas" };
const categoriaDe = (id: string) => CATEGORIA[id];

const BASE: Omit<Promocion, "id" | "nombre" | "tipo"> = {
  productos: [], categorias: ["cat-pizzas"], vigencia: {}, activa: true,
};

const DOS_POR_UNO: Promocion = {
  ...BASE, id: "p1", nombre: "Martes de 2x1", tipo: "nxm", lleva: 2, paga: 1,
};

// --- El 2x1 ------------------------------------------------------------------------------------

describe("2x1", () => {
  /*
   * REGALA LA MÁS BARATA. Regalar la más cara convierte una promoción en
   * pérdida, y es lo que ningún restaurante hace.
   */
  it("regala la más barata, no la más cara", () => {
    const r = aplicarPromociones(
      [renglon("pizza", 300), renglon("pizza", 200)],
      [DOS_POR_UNO],
      categoriaDe,
      Date.now(),
    );
    expect(r.total).toBe(pesos(200));
  });

  it("con tres pizzas solo hay un grupo completo", () => {
    const r = aplicarPromociones(
      [renglon("pizza", 300), renglon("pizza", 250), renglon("pizza", 200)],
      [DOS_POR_UNO],
      categoriaDe,
      Date.now(),
    );
    // Un solo par: se regala la de 200. La tercera se paga.
    expect(r.total).toBe(pesos(200));
  });

  it("cuatro pizzas dan dos grupos", () => {
    const r = aplicarPromociones(
      [renglon("pizza", 300, 4)],
      [DOS_POR_UNO],
      categoriaDe,
      Date.now(),
    );
    expect(r.total).toBe(pesos(600));
  });

  it("una sola pizza no alcanza", () => {
    const r = aplicarPromociones([renglon("pizza", 300)], [DOS_POR_UNO], categoriaDe, Date.now());
    expect(r.total).toBe(pesos(0));
    expect(r.descuentos).toEqual([]);
  });

  it("no toca lo que está fuera de la categoría", () => {
    const r = aplicarPromociones(
      [renglon("pizza", 300), renglon("refresco", 40)],
      [DOS_POR_UNO],
      categoriaDe,
      Date.now(),
    );
    expect(r.total).toBe(pesos(0));
  });
});

// --- Vigencia ----------------------------------------------------------------------------------

describe("cuándo aplica", () => {
  const soloMartes: Promocion = { ...DOS_POR_UNO, vigencia: { dias: [2] } };

  it("respeta el día de la semana", () => {
    expect(estaVigente(soloMartes, new Date(2026, 6, 21, 20).getTime())).toBe(true);
    expect(estaVigente(soloMartes, new Date(2026, 6, 22, 20).getTime())).toBe(false);
  });

  it("respeta la franja horaria", () => {
    const happy: Promocion = { ...DOS_POR_UNO, vigencia: { desde_hora: 18, hasta_hora: 20 } };
    expect(estaVigente(happy, new Date(2026, 6, 21, 19).getTime())).toBe(true);
    expect(estaVigente(happy, new Date(2026, 6, 21, 20).getTime())).toBe(false);
    expect(estaVigente(happy, new Date(2026, 6, 21, 17).getTime())).toBe(false);
  });

  /* Un «de 22 a 2» es lo que de verdad pide un restaurante de noche. */
  it("una franja que cruza la medianoche funciona", () => {
    const nocturna: Promocion = { ...DOS_POR_UNO, vigencia: { desde_hora: 22, hasta_hora: 2 } };
    expect(estaVigente(nocturna, new Date(2026, 6, 21, 23).getTime())).toBe(true);
    expect(estaVigente(nocturna, new Date(2026, 6, 22, 1).getTime())).toBe(true);
    expect(estaVigente(nocturna, new Date(2026, 6, 22, 5).getTime())).toBe(false);
  });

  it("una promoción apagada no aplica nunca", () => {
    expect(estaVigente({ ...DOS_POR_UNO, activa: false }, Date.now())).toBe(false);
  });
});

// --- Que no se apilen --------------------------------------------------------------------------

describe("dos promociones sobre lo mismo", () => {
  const veinte: Promocion = {
    ...BASE, id: "p2", nombre: "20 por ciento en pizzas", tipo: "porcentaje", fraccion: 0.2,
  };

  /*
   * EL CANDADO. Si se apilaran, dos pizzas de $300 darían $300 de 2x1 MÁS $120
   * de porcentaje: se regalaría producto que nadie decidió regalar.
   */
  it("un renglón recibe una sola promoción, la mejor para el cliente", () => {
    const r = aplicarPromociones(
      [renglon("pizza", 300), renglon("pizza", 300)],
      [DOS_POR_UNO, veinte],
      categoriaDe,
      Date.now(),
    );
    // El 2x1 regala $300; el 20 % daría $120. Gana el 2x1, y solo él.
    expect(r.descuentos).toHaveLength(1);
    expect(r.descuentos[0]!.nombre).toBe("Martes de 2x1");
    expect(r.total).toBe(pesos(300));
  });

  it("el resultado no depende del orden en que se dieron de alta", () => {
    const cuenta = [renglon("pizza", 300), renglon("pizza", 300)];
    const a = aplicarPromociones(cuenta, [DOS_POR_UNO, veinte], categoriaDe, Date.now());
    const b = aplicarPromociones(cuenta, [veinte, DOS_POR_UNO], categoriaDe, Date.now());
    expect(a.total).toBe(b.total);
  });

  it("dos promociones sobre cosas distintas sí conviven", () => {
    const bebidas: Promocion = {
      ...BASE, id: "p3", nombre: "Refrescos a mitad", tipo: "porcentaje",
      categorias: ["cat-bebidas"], fraccion: 0.5,
    };
    const r = aplicarPromociones(
      [renglon("pizza", 300), renglon("pizza", 300), renglon("refresco", 40)],
      [DOS_POR_UNO, bebidas],
      categoriaDe,
      Date.now(),
    );
    expect(r.descuentos).toHaveLength(2);
    expect(r.total).toBe(pesos(320)); // 300 del 2x1 + 20 del refresco
  });
});

// --- Otros tipos -------------------------------------------------------------------------------

describe("porcentaje y precio fijo", () => {
  it("el porcentaje descuenta sobre lo que aplica", () => {
    const promo: Promocion = {
      ...BASE, id: "p4", nombre: "20 por ciento", tipo: "porcentaje", fraccion: 0.2,
    };
    const r = aplicarPromociones([renglon("pizza", 300, 2)], [promo], categoriaDe, Date.now());
    expect(r.total).toBe(pesos(120));
  });

  it("el precio fijo descuenta la diferencia", () => {
    const promo: Promocion = {
      ...BASE, id: "p5", nombre: "Pizza a 199", tipo: "precio_fijo", precio: pesos(199),
    };
    const r = aplicarPromociones([renglon("pizza", 300, 2)], [promo], categoriaDe, Date.now());
    expect(r.total).toBe(pesos(202)); // (300 − 199) × 2
  });

  /* Un «especial» más caro que la carta no puede subir el precio. */
  it("un precio fijo más caro que el de carta no aplica", () => {
    const promo: Promocion = {
      ...BASE, id: "p6", nombre: "Especial caro", tipo: "precio_fijo", precio: pesos(400),
    };
    const r = aplicarPromociones([renglon("pizza", 300)], [promo], categoriaDe, Date.now());
    expect(r.total).toBe(pesos(0));
  });

  it("un renglón cancelado no entra en ninguna promoción", () => {
    const cancelado = { ...renglon("pizza", 300), estado: "cancelado" as const };
    const r = aplicarPromociones(
      [renglon("pizza", 300), cancelado],
      [DOS_POR_UNO],
      categoriaDe,
      Date.now(),
    );
    expect(r.total).toBe(pesos(0));
  });
});

// --- Lo que ya se aplicó --------------------------------------------------------------------

describe("una cuenta que crece después de aplicar la promoción", () => {
  it("no vuelve a regalar lo que ya se regaló", () => {
    const primeras = [renglon("pizza", 300), renglon("pizza", 200)];
    const inicial = aplicarPromociones(primeras, [DOS_POR_UNO], categoriaDe, Date.now());
    expect(inicial.total).toBe(pesos(200));

    const registrado = {
      promocion_id: DOS_POR_UNO.id,
      renglones_cubiertos: inicial.descuentos[0]!.renglones,
    };

    // Llegan dos pizzas más a la misma mesa.
    const conNuevas = [...primeras, renglon("pizza", 280), renglon("pizza", 260)];
    const pendiente = promocionesPendientes(
      conNuevas, [DOS_POR_UNO], [registrado], categoriaDe, Date.now(),
    );

    // La promoción ya se usó en esta cuenta: no se ofrece de nuevo.
    expect(pendiente.total).toBe(pesos(0));
  });

  it("otra promoción distinta sí puede aplicar a los renglones libres", () => {
    const mitad: Promocion = {
      ...BASE, id: "p9", nombre: "Mitad en bebidas", tipo: "porcentaje",
      categorias: ["cat-bebidas"], fraccion: 0.5,
    };
    const cubierta = renglon("pizza", 300);
    const refresco = renglon("refresco", 40);
    const pendiente = promocionesPendientes(
      [cubierta, refresco],
      [DOS_POR_UNO, mitad],
      [{ promocion_id: DOS_POR_UNO.id, renglones_cubiertos: [cubierta.id] }],
      categoriaDe,
      Date.now(),
    );
    expect(pendiente.total).toBe(pesos(20));
  });
});

describe("cómo se lee", () => {
  it("se describe en el idioma de la carta", () => {
    expect(describirPromocion(DOS_POR_UNO)).toBe("2×1");
    expect(describirPromocion({ ...DOS_POR_UNO, tipo: "porcentaje", fraccion: 0.2 })).toBe("−20 %");
  });
});
