/**
 * Compras: proveedores, órdenes y recepción.
 *
 * Lo que más importa probar aquí son las decisiones que evitan errores caros de
 * operación: pedir solo el faltante (no el mínimo entero), descontar lo que ya
 * viene en camino, y cerrar una orden cuando llegó lo pedido aunque no cuadre
 * al gramo.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { Insumo } from "../inventario/insumos.js";
import type { EventoCompra } from "../compras/eventos.js";
import {
  movimientosDeRecepcion,
  ordenesAbiertas,
  pendienteDe,
  proyectarOrdenes,
  proyectarProveedores,
  sugerirCompra,
  totalOrden,
} from "../compras/reducers.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-compras", sucursal_id: "suc-1" };
const STREAM = "compras:suc-1";

const fabrica = () => new FabricaEventos<EventoCompra>(CTX);

const QUESO: Insumo = {
  id: "ins-queso",
  nombre: "Queso mozzarella",
  unidad_base: "kg",
  costo_unitario: pesos(120),
  stock_minimo: 10,
};
const HARINA: Insumo = {
  id: "ins-harina",
  nombre: "Harina",
  unidad_base: "kg",
  costo_unitario: pesos(25),
  stock_minimo: 50,
};

// --- Proveedores -------------------------------------------------------------------------

describe("proveedores", () => {
  it("se dan de alta y se editan", () => {
    const f = fabrica();
    const proveedores = proyectarProveedores([
      f.crear("proveedor_registrado", STREAM, { proveedor_id: "p1", nombre: "Lácteos del Norte" }),
      f.crear("proveedor_actualizado", STREAM, {
        proveedor_id: "p1",
        cambios: { telefono: "33-1234-5678" },
      }),
    ]);

    expect(proveedores[0]).toMatchObject({
      nombre: "Lácteos del Norte",
      telefono: "33-1234-5678",
      activo: true,
    });
  });

  /*
   * Se da de baja, no se borra: sus órdenes pasadas apuntan a él, y un
   * proveedor sin nombre volvería ilegible el historial de compras.
   */
  it("desactivar lo conserva en el historial", () => {
    const f = fabrica();
    const proveedores = proyectarProveedores([
      f.crear("proveedor_registrado", STREAM, { proveedor_id: "p1", nombre: "Lácteos" }),
      f.crear("proveedor_desactivado", STREAM, { proveedor_id: "p1", motivo: "Subió mucho" }),
    ]);

    expect(proveedores).toHaveLength(1);
    expect(proveedores[0]!.activo).toBe(false);
  });

  it("reaplicar el alta no duplica ni pisa lo editado", () => {
    const f = fabrica();
    const alta = f.crear("proveedor_registrado", STREAM, { proveedor_id: "p1", nombre: "Lácteos" });
    const proveedores = proyectarProveedores([
      alta,
      f.crear("proveedor_actualizado", STREAM, { proveedor_id: "p1", cambios: { rfc: "AAA010101AAA" } }),
      alta,
    ]);

    expect(proveedores).toHaveLength(1);
    expect(proveedores[0]!.rfc).toBe("AAA010101AAA");
  });
});

// --- Sugerencia de compra ----------------------------------------------------------------

describe("qué pedir", () => {
  /*
   * Se pide el FALTANTE, no el mínimo. Con 3 kg y un mínimo de 10 se piden 7:
   * pedir 10 encima de los 3 que ya hay es cómo se llena una cámara de producto
   * que caduca.
   */
  it("pide solo lo que falta para llegar al mínimo", () => {
    const sugerencias = sugerirCompra([{ insumo: QUESO, cantidad: 3, faltante: 7 }]);

    expect(sugerencias[0]).toMatchObject({
      insumo_id: "ins-queso",
      cantidad: 7,
      existencia: 3,
      stock_minimo: 10,
    });
  });

  /*
   * Y descuenta lo que ya viene en camino. Sin esto, cada revisión generaría
   * otra orden del mismo faltante hasta acumular cuatro entregas iguales.
   */
  it("descuenta lo que ya está pedido y no ha llegado", () => {
    const f = fabrica();
    const ordenes = proyectarOrdenes([
      f.crear("orden_compra_creada", STREAM, {
        orden_id: "oc1",
        proveedor_id: "p1",
        lineas: [{ insumo_id: "ins-queso", cantidad: 5, costo_unitario: pesos(120) }],
      }),
    ]);

    const sugerencias = sugerirCompra([{ insumo: QUESO, cantidad: 3, faltante: 7 }], ordenes);

    // Faltan 7, ya vienen 5: solo hay que pedir 2.
    expect(sugerencias[0]!.cantidad).toBe(2);
  });

  it("si lo pedido ya cubre el faltante, no sugiere nada", () => {
    const f = fabrica();
    const ordenes = proyectarOrdenes([
      f.crear("orden_compra_creada", STREAM, {
        orden_id: "oc1",
        proveedor_id: "p1",
        lineas: [{ insumo_id: "ins-queso", cantidad: 20, costo_unitario: pesos(120) }],
      }),
    ]);

    expect(sugerirCompra([{ insumo: QUESO, cantidad: 3, faltante: 7 }], ordenes)).toHaveLength(0);
  });
});

// --- Órdenes y recepción -----------------------------------------------------------------

describe("orden de compra", () => {
  function conOrden(): EventoCompra[] {
    const f = fabrica();
    return [
      f.crear("proveedor_registrado", STREAM, { proveedor_id: "p1", nombre: "Lácteos" }),
      f.crear("orden_compra_creada", STREAM, {
        orden_id: "oc1",
        proveedor_id: "p1",
        lineas: [
          { insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) },
          { insumo_id: "ins-harina", cantidad: 50, costo_unitario: pesos(25) },
        ],
      }),
    ];
  }

  it("nace abierta y con su total estimado", () => {
    const [orden] = proyectarOrdenes(conOrden());
    expect(orden!.estado).toBe("abierta");
    // 10 × 120 + 50 × 25 = 1200 + 1250 = 2450
    expect(totalOrden(orden!.lineas)).toBe(pesos(2450));
  });

  it("pedir NO mueve el almacén", () => {
    const [orden] = proyectarOrdenes(conOrden());
    expect(orden!.recibido).toEqual({});
    expect(orden!.costo_recibido).toBe(pesos(0));
  });

  it("una entrega parcial la deja a medias y dice qué falta", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [{ insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) }],
      }),
    ]);

    expect(orden!.estado).toBe("parcial");
    expect(pendienteDe(orden!)).toEqual([{ insumo_id: "ins-harina", cantidad: 50 }]);
  });

  it("dos entregas la completan", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [{ insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) }],
      }),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [{ insumo_id: "ins-harina", cantidad: 50, costo_unitario: pesos(25) }],
      }),
    ]);

    expect(orden!.estado).toBe("recibida");
    expect(pendienteDe(orden!)).toEqual([]);
    expect(orden!.costo_recibido).toBe(pesos(2450));
  });

  /*
   * Recibir de MÁS cierra la línea. Exigir exactitud dejaría órdenes abiertas
   * para siempre por doscientos gramos de diferencia.
   */
  it("recibir de más también la cierra", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [
          { insumo_id: "ins-queso", cantidad: 10.2, costo_unitario: pesos(120) },
          { insumo_id: "ins-harina", cantidad: 50, costo_unitario: pesos(25) },
        ],
      }),
    ]);

    expect(orden!.estado).toBe("recibida");
  });

  it("el costo recibido usa el precio REAL, no el pactado", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        // El queso subió: llegó a 140, no a 120.
        recibidas: [{ insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(140) }],
      }),
    ]);

    expect(orden!.costo_recibido).toBe(pesos(1400));
  });

  it("una orden cancelada ya no recibe mercancía", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_cancelada", STREAM, { orden_id: "oc1", motivo: "El proveedor no surtió" }),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [{ insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) }],
      }),
    ]);

    expect(orden!.estado).toBe("cancelada");
    expect(orden!.recibido).toEqual({});
  });

  /*
   * Una orden ya recibida NO se cancela: la mercancía está en el almacén y
   * cancelarla dejaría el inventario con una entrada sin respaldo.
   */
  it("una orden ya recibida no se puede cancelar", () => {
    const f = fabrica();
    const [orden] = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc1",
        recibidas: [
          { insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) },
          { insumo_id: "ins-harina", cantidad: 50, costo_unitario: pesos(25) },
        ],
      }),
      f.crear("orden_compra_cancelada", STREAM, { orden_id: "oc1", motivo: "ya no" }),
    ]);

    expect(orden!.estado).toBe("recibida");
  });

  it("lista las que siguen esperando mercancía", () => {
    const f = fabrica();
    const ordenes = proyectarOrdenes([
      ...conOrden(),
      f.crear("orden_compra_creada", STREAM, {
        orden_id: "oc2",
        proveedor_id: "p1",
        lineas: [{ insumo_id: "ins-harina", cantidad: 10, costo_unitario: pesos(25) }],
      }),
      f.crear("orden_compra_recibida", STREAM, {
        orden_id: "oc2",
        recibidas: [{ insumo_id: "ins-harina", cantidad: 10, costo_unitario: pesos(25) }],
      }),
    ]);

    expect(ordenesAbiertas(ordenes).map((o) => o.orden_id)).toEqual(["oc1"]);
  });
});

// --- Recepción → almacén ------------------------------------------------------------------

describe("la recepción alimenta el almacén", () => {
  it("produce una entrada por cada línea recibida, con su referencia", () => {
    const movimientos = movimientosDeRecepcion("oc1", [
      { insumo_id: "ins-queso", cantidad: 10, costo_unitario: pesos(120) },
      { insumo_id: "ins-harina", cantidad: 50, costo_unitario: pesos(25), nota: "Vino húmeda" },
    ]);

    expect(movimientos).toEqual([
      { insumo_id: "ins-queso", delta: 10, referencia: "oc1", nota: undefined },
      { insumo_id: "ins-harina", delta: 50, referencia: "oc1", nota: "Vino húmeda" },
    ]);
  });

  it("una línea que no llegó no mueve nada", () => {
    const movimientos = movimientosDeRecepcion("oc1", [
      { insumo_id: "ins-queso", cantidad: 0, costo_unitario: pesos(120) },
    ]);
    expect(movimientos).toHaveLength(0);
  });
});
