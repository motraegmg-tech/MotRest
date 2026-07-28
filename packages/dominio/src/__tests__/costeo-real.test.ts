/**
 * Costeo ideal contra real.
 *
 * La pregunta que responde: de lo que se vendió, ¿cuánto insumo DEBIÓ salir del
 * almacén y cuánto salió? La diferencia es el consumo que nadie declaró — lo
 * que un restaurantero llama «se me está yendo el producto».
 *
 * Lo que más importa probar es el LÍMITE: que no dé por buena una varianza
 * calculada sobre media carta. Un food cost «bajo control» que ignora la mitad
 * de los productos no vale nada.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { indexar, type Producto } from "../catalogo/productos.js";
import type { Receta } from "../catalogo/recetas.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { FabricaEventos } from "../evento.js";
import type { EventoInventario } from "../inventario/eventos.js";
import type { Insumo } from "../inventario/insumos.js";
import { costeoIdealReal, explicarVarianza, seDesvia } from "../inventario/costeo-real.js";

const CTX = { device_id: "d1", empleado_id: "e1", sucursal_id: "s1" };

const MASA: Insumo = {
  id: "ins-masa", nombre: "Masa", unidad_base: "g",
  costo_unitario: pesos(0.05), stock_minimo: 5000,
};
const INSUMOS = [MASA];

/** Una pizza con receta: 200 g de masa cada una. */
const RECETA: Receta = {
  id: "rec-pizza", nombre: "Pizza",
  ingredientes: [
    { id: "i1", nombre: "Masa", costo: pesos(10), insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
  ],
};

const PIZZA: Producto = {
  id: "prod-pizza", nombre: "Pizza", categoria_id: "c1",
  costo: pesos(60), precio: pesos(249), impuesto_id: IVA_16.id,
  receta_id: "rec-pizza", disponible: true, orden: 1,
};
/** Una bebida en modo simple: sin receta, no se puede medir su consumo. */
const REFRESCO: Producto = {
  id: "prod-refresco", nombre: "Refresco", categoria_id: "c1",
  costo: pesos(8), precio: pesos(40), impuesto_id: IVA_16.id,
  disponible: true, orden: 2,
};

const CATALOGO = indexar({
  productos: [PIZZA, REFRESCO],
  categorias: [{ id: "c1", nombre: "Todo", orden: 1 }],
  recetas: [RECETA],
  impuestos: [IVA_16],
  grupos: [],
});

/** Una cuenta con N unidades de un producto. */
function venta(productoId: string, cantidad: number): EstadoComanda {
  const f = () => new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  return proyectarComanda([
    f().crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: Date.now() }),
    f().crear("item_agregado", orden_id, {
      orden_id,
      renglon: {
        id: uuidv7(), producto_id: productoId, descripcion: productoId, cantidad,
        precio_unitario: pesos(249), costo_unitario: pesos(60),
        impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
  ]);
}

/** Lo que el almacén registró como consumido por receta. */
function consumo(gramos: number): EventoInventario {
  return new FabricaEventos<EventoInventario>(CTX).crear(
    "movimiento_inventario",
    "insumo:ins-masa",
    { insumo_id: "ins-masa", delta: -gramos, unidad: "g", motivo: "consumo_receta" },
  );
}

describe("la varianza", () => {
  /* 40 pizzas × 200 g = 8 000 g ideales. Salieron 9 500: kilo y medio de más. */
  it("mide lo que salió de más contra lo que la receta pide", () => {
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(9500)], CATALOGO, INSUMOS);
    const masa = r.insumos[0]!;

    expect(masa.ideal).toBe(8000);
    expect(masa.real).toBe(9500);
    expect(masa.varianza).toBe(1500);
    expect(masa.tasa).toBeCloseTo(0.1875, 3);
  });

  it("pone la desviación en dinero", () => {
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(9500)], CATALOGO, INSUMOS);
    // 1 500 g × 5 centavos = $75
    expect(r.insumos[0]!.costo_varianza).toBe(pesos(75));
    expect(r.desviacion).toBe(pesos(75));
  });

  it("cuando cuadra, la desviación es cero", () => {
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(8000)], CATALOGO, INSUMOS);
    expect(r.insumos[0]!.varianza).toBe(0);
    expect(r.desviacion).toBe(pesos(0));
  });

  /* Salir de MENOS también es una señal: suele ser receta mal capturada. */
  it("una varianza negativa se explica distinto", () => {
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(6000)], CATALOGO, INSUMOS);
    const masa = r.insumos[0]!;

    expect(masa.varianza).toBe(-2000);
    expect(explicarVarianza(masa)).toMatch(/mal capturada|no se esté registrando/i);
  });

  it("solo señala lo que se desvía de verdad", () => {
    // 2 % de diferencia: ruido de operación, no un problema.
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(8160)], CATALOGO, INSUMOS);
    expect(seDesvia(r.insumos[0]!)).toBe(false);
    expect(explicarVarianza(r.insumos[0]!)).toMatch(/normal/i);
  });
});

// --- El límite del cálculo --------------------------------------------------------------------

describe("lo que no se puede medir", () => {
  /*
   * EL CANDADO. Un producto sin receta no dice qué consume. Contarlo como si
   * cuadrara daría un food cost «bajo control» que ignora media carta.
   */
  it("cuenta los productos vendidos que no tienen receta", () => {
    const r = costeoIdealReal(
      [venta("prod-pizza", 10), venta("prod-refresco", 30)],
      [consumo(2000)],
      CATALOGO,
      INSUMOS,
    );
    expect(r.productos_sin_receta).toBe(1);
  });

  it("un refresco sin receta no aparece como insumo desviado", () => {
    const r = costeoIdealReal([venta("prod-refresco", 30)], [], CATALOGO, INSUMOS);
    expect(r.insumos).toEqual([]);
    expect(r.sin_datos).toBe(true);
  });

  it("sin ventas no inventa una comparación", () => {
    const r = costeoIdealReal([], [], CATALOGO, INSUMOS);
    expect(r.sin_datos).toBe(true);
    expect(r.desviacion).toBe(pesos(0));
  });

  /* Solo cuenta el consumo por receta: una merma declarada no es varianza. */
  it("las mermas registradas no cuentan como consumo real", () => {
    const merma = new FabricaEventos<EventoInventario>(CTX).crear(
      "movimiento_inventario", "insumo:ins-masa",
      { insumo_id: "ins-masa", delta: -3000, unidad: "g", motivo: "merma" },
    );
    const r = costeoIdealReal([venta("prod-pizza", 40)], [consumo(8000), merma], CATALOGO, INSUMOS);

    // La merma ya la vigila el centinela; aquí solo se mide lo que salió a cocina.
    expect(r.insumos[0]!.real).toBe(8000);
    expect(r.desviacion).toBe(pesos(0));
  });
});
