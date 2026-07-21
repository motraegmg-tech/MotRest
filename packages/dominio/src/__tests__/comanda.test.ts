import { describe, expect, it } from "vitest";
import { pesos, type Centavos } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { IVA_16, snapshotTasas, type PerfilImpuesto } from "../comun/impuestos.js";
import { indexar, type CatalogoIndex, type Producto } from "../catalogo/productos.js";
import type { PorcionElegida } from "../catalogo/porciones.js";
import { costearPorciones, costearProducto, margen } from "../costeo/costeo.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import {
  aplicarEvento,
  proyectarComanda,
  renglonesActivos,
  renglonesPendientes,
  tieneEnviados,
} from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";

// --- Catálogo de prueba: costo y precio FINALES (ADR-16, sin ingredientes) -----

const impuestos: PerfilImpuesto[] = [IVA_16];

const productos: Producto[] = [
  // Variedades que ocupan las ranuras de la pizza. Su precio lo pone el contenedor.
  { id: "var-margherita", nombre: "Margherita", categoria_id: "cat-pizzas",
    costo: pesos(42.2), precio: pesos(0), impuesto_id: IVA_16.id, disponible: true, orden: 1 },
  { id: "var-pepperoni", nombre: "Pepperoni", categoria_id: "cat-pizzas",
    costo: pesos(49.2), precio: pesos(0), impuesto_id: IVA_16.id, disponible: true, orden: 2 },

  // Producto configurable: dos ranuras de media pizza cada una.
  { id: "prod-pizza-fam", nombre: "Pizza familiar mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(249), impuesto_id: IVA_16.id, disponible: true, orden: 3,
    esquema_porciones: {
      presentacion: "circulo",
      ranuras: [
        { id: "izq", etiqueta: "Mitad izquierda", fraccion: 0.5, obligatoria: true,
          opciones_producto: ["var-margherita", "var-pepperoni"], producto_por_defecto: "var-margherita" },
        { id: "der", etiqueta: "Mitad derecha", fraccion: 0.5, obligatoria: true,
          opciones_producto: ["var-margherita", "var-pepperoni"], producto_por_defecto: "var-pepperoni" },
      ],
    },
  },

  // Productos simples: costo final capturado por el administrador.
  { id: "prod-pasta-pesto", nombre: "Pasta al pesto", categoria_id: "cat-pastas",
    costo: pesos(34), precio: pesos(139), impuesto_id: IVA_16.id, disponible: true, orden: 4 },
  { id: "prod-limonada", nombre: "Limonada de la casa", categoria_id: "cat-bebidas",
    costo: pesos(0), precio: pesos(45), impuesto_id: IVA_16.id, disponible: true, orden: 5 },
  { id: "prod-agua", nombre: "Agua mineral", categoria_id: "cat-bebidas",
    costo: pesos(0), precio: pesos(38), impuesto_id: IVA_16.id, disponible: true, orden: 6 },
];

const cat: CatalogoIndex = indexar({
  productos,
  categorias: [
    { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
    { id: "cat-pastas", nombre: "Pastas", orden: 2 },
    { id: "cat-bebidas", nombre: "Bebidas", orden: 3 },
  ],
  impuestos,
});

const MITADES: PorcionElegida[] = [
  { ranura_id: "izq", producto_id: "var-margherita", fraccion: 0.5 },
  { ranura_id: "der", producto_id: "var-pepperoni", fraccion: 0.5 },
];

const CTX = { device_id: "dev-caja-01", empleado_id: "emp-lucia", sucursal_id: "suc-centro" };

function renglon(productoId: ID, cantidad: number, porciones?: PorcionElegida[]): RenglonComanda {
  const p = cat.productos.get(productoId)!;
  return {
    id: uuidv7(),
    producto_id: p.id,
    descripcion: p.nombre,
    cantidad,
    precio_unitario: p.precio,
    costo_unitario: costearProducto(p, cat, porciones),
    impuesto: snapshotTasas(IVA_16),
    porciones,
    estado: "capturado",
  };
}

/** Reconstruye la comanda de la mesa 12 vía eventos. Devuelve el log y su orden_id. */
function comandaMesa12(): { eventos: EventoComanda[]; orden_id: ID } {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-12", abierta_ts: Date.now() }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-pizza-fam", 1, MITADES) }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-pasta-pesto", 1) }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-limonada", 2) }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-agua", 1) }),
  ];
  return { eventos, orden_id };
}

// --- Costeo por porciones (mitad-y-mitad como caso genérico) -------------------

describe("costeo por porciones", () => {
  it("cada mitad cuesta la fracción del costo de su variedad", () => {
    expect(costearPorciones([MITADES[0]!], cat)).toBe(pesos(21.1));
    expect(costearPorciones([MITADES[1]!], cat)).toBe(pesos(24.6));
  });

  it("el costo del platillo es la suma de las dos mitades", () => {
    expect(costearPorciones(MITADES, cat)).toBe(pesos(45.7));
  });

  it("un producto simple usa su costo capturado, sin porciones", () => {
    expect(costearProducto(cat.productos.get("prod-pasta-pesto")!, cat)).toBe(pesos(34));
  });

  it("calcula el margen sobre el precio de carta", () => {
    expect(margen(pesos(249), pesos(45.7))).toBeCloseTo(0.8165, 4);
  });

  it("lanza si una variedad no existe en el catálogo", () => {
    expect(() =>
      costearPorciones([{ ranura_id: "izq", producto_id: "var-inexistente", fraccion: 0.5 }], cat),
    ).toThrow();
  });
});

// --- Proyección y totales ------------------------------------------------------

describe("proyección de la comanda", () => {
  it("reconstruye el estado desde los eventos", () => {
    const { eventos, orden_id } = comandaMesa12();
    const estado = proyectarComanda(eventos);
    expect(estado.orden_id).toBe(orden_id);
    expect(estado.mesa_id).toBe("mesa-12");
    expect(estado.mesero_id).toBe("emp-lucia");
    expect(renglonesActivos(estado)).toHaveLength(4);
    expect(estado.cerrada).toBe(false);
  });

  it("cuadra subtotal, IVA y total (mesa 12 = $598.56)", () => {
    const t = totalesComanda(proyectarComanda(comandaMesa12().eventos));
    expect(t.subtotal).toBe(pesos(516));
    expect(t.iva).toBe(pesos(82.56));
    expect(t.total).toBe(pesos(598.56));
    expect(t.costo).toBe(pesos(79.7)); // pizza 45.70 + pasta 34.00 + bebidas 0
  });

  it("un renglón cancelado deja de sumar", () => {
    const { eventos, orden_id } = comandaMesa12();
    const agua = proyectarComanda(eventos).renglones.find((r) => r.producto_id === "prod-agua")!;
    const f = new FabricaEventos<EventoComanda>(CTX);
    const conCancelacion: EventoComanda[] = [
      ...eventos,
      f.crear("item_cancelado", orden_id, {
        orden_id, renglon_id: agua.id, autorizador_id: "emp-gerente", motivo: "cambió de opinión",
      }),
    ];
    const estado = proyectarComanda(conCancelacion);
    expect(renglonesActivos(estado)).toHaveLength(3);
    const t = totalesComanda(estado);
    expect(t.subtotal).toBe(pesos(478)); // 516 − 38
    expect(t.total).toBe(pesos(554.48));
  });

  it("el saldo refleja lo pagado", () => {
    const { eventos, orden_id } = comandaMesa12();
    const f = new FabricaEventos<EventoComanda>(CTX);
    const completo: EventoComanda[] = [
      ...eventos,
      f.crear("propina_registrada", orden_id, { orden_id, monto: pesos(60) as Centavos }),
      f.crear("pago_registrado", orden_id, {
        orden_id, monto: pesos(658.56) as Centavos, forma: "efectivo",
      }),
      f.crear("cuenta_cerrada", orden_id, { orden_id }),
    ];
    const estado = proyectarComanda(completo);
    const t = totalesComanda(estado);
    expect(estado.cerrada).toBe(true);
    // Se cobra el total más la propina: 598.56 + 60.
    expect(t.pagado).toBe(pesos(658.56));
    expect(t.propina).toBe(pesos(60));
    expect(t.saldo).toBe(0);
  });
});

// --- Estado por renglón (envío por tiempos) ------------------------------------

describe("estado por renglón", () => {
  it("los renglones nacen capturados y solo se envían los indicados", () => {
    const { eventos, orden_id } = comandaMesa12();
    const estado0 = proyectarComanda(eventos);
    expect(renglonesPendientes(estado0)).toHaveLength(4);
    expect(tieneEnviados(estado0)).toBe(false);

    const bebidas = estado0.renglones.filter((r) =>
      ["prod-limonada", "prod-agua"].includes(r.producto_id),
    );
    const f = new FabricaEventos<EventoComanda>(CTX);
    const estado1 = proyectarComanda([
      ...eventos,
      f.crear("items_enviados", orden_id, {
        orden_id, renglon_ids: bebidas.map((r) => r.id), curso: 1,
      }),
    ]);

    // Solo las bebidas salieron; la comida sigue pendiente.
    expect(renglonesPendientes(estado1)).toHaveLength(2);
    expect(tieneEnviados(estado1)).toBe(true);
    expect(estado1.renglones.filter((r) => r.estado === "enviado")).toHaveLength(2);
  });

  it("recorre el ciclo de producción de un platillo", () => {
    const { eventos, orden_id } = comandaMesa12();
    const pizza = proyectarComanda(eventos).renglones.find(
      (r) => r.producto_id === "prod-pizza-fam",
    )!;
    const f = new FabricaEventos<EventoComanda>(CTX);
    const log: EventoComanda[] = [
      ...eventos,
      f.crear("items_enviados", orden_id, { orden_id, renglon_ids: [pizza.id] }),
      f.crear("item_en_marcha", orden_id, { orden_id, renglon_id: pizza.id, estacion_id: "est-horno" }),
      f.crear("item_listo", orden_id, { orden_id, renglon_id: pizza.id }),
      f.crear("item_entregado", orden_id, { orden_id, renglon_id: pizza.id }),
    ];
    const final = proyectarComanda(log).renglones.find((r) => r.id === pizza.id)!;
    expect(final.estado).toBe("entregado");
    expect(final.estacion_id).toBe("est-horno");
  });
});

// --- Invariantes del event log -------------------------------------------------

describe("invariantes del event log", () => {
  it("cada sentada de la misma mesa genera un orden_id distinto", () => {
    // Este era el bug: "cmd-" + mesa reusaba el mismo id para siempre.
    const primera = comandaMesa12();
    const segunda = comandaMesa12();
    expect(primera.orden_id).not.toBe(segunda.orden_id);
    expect(proyectarComanda(primera.eventos).mesa_id).toBe(
      proyectarComanda(segunda.eventos).mesa_id,
    );
  });

  it("el sobre lleva empleado, sucursal, dispositivo y stream", () => {
    const { eventos, orden_id } = comandaMesa12();
    const primero = eventos[0]!;
    expect(primero.empleado_id).toBe("emp-lucia");
    expect(primero.sucursal_id).toBe("suc-centro");
    expect(primero.device_id).toBe("dev-caja-01");
    expect(primero.stream_id).toBe(orden_id);
    expect(primero.v).toBe(1);
    expect(primero.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it("el cambio rápido de usuario queda registrado en los eventos siguientes", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const antes = f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-3", abierta_ts: Date.now() });
    f.actualizarContexto({ empleado_id: "emp-gerente" });
    const despues = f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-agua", 1) });

    expect(antes.empleado_id).toBe("emp-lucia");
    expect(despues.empleado_id).toBe("emp-gerente");
  });

  it("los eventos del mismo milisegundo se desempatan con orden_local", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const lote = Array.from({ length: 50 }, () =>
      f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("prod-agua", 1) }),
    );
    // Dentro de un mismo ts, orden_local debe ser estrictamente creciente.
    for (let i = 1; i < lote.length; i++) {
      const a = lote[i - 1]!;
      const b = lote[i]!;
      if (a.ts === b.ts) expect(b.orden_local).toBeGreaterThan(a.orden_local);
    }
  });

  it("reproducir el log dos veces da exactamente el mismo estado", () => {
    const { eventos } = comandaMesa12();
    expect(proyectarComanda(eventos)).toEqual(proyectarComanda(eventos));
  });

  it("proyectar sin eventos lanza error", () => {
    expect(() => proyectarComanda([])).toThrow();
  });

  it("un evento sin orden_creada previa lanza error", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const suelto = f.crear("cuenta_cerrada", orden_id, { orden_id });
    expect(() => aplicarEvento(null, suelto)).toThrow();
  });
});
