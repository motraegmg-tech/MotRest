/**
 * Egresos y resultado del período.
 *
 * La prueba que más importa aquí no es una suma: es que **una compra de insumos
 * NO se reste al margen**. El costo de lo vendido ya viene de las recetas, y
 * restarlo otra vez haría que un martes de compra grande apareciera como un día
 * en pérdida cuando fue un día bueno.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import {
  CATEGORIAS_EGRESO,
  calcularResultado,
  categoriaDe,
  egresosEn,
  proyectarEgresos,
  resultadoVacio,
  type CategoriaEgreso,
  type EventoEgreso,
} from "../finanzas/egresos.js";
import { diaDe } from "../inteligencia/reportes.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-gerente", sucursal_id: "suc-1" };
const HOY = new Date(2026, 6, 23, 14, 0).getTime();

function fabrica() {
  return new FabricaEventos<EventoEgreso>(CTX);
}

/** Un egreso con su sello de tiempo fijado, para poder filtrar por día. */
function egreso(
  f: FabricaEventos<EventoEgreso>,
  id: string,
  categoria: CategoriaEgreso,
  monto: number,
  ts = HOY,
): EventoEgreso {
  const ev = f.crear("egreso_registrado", "finanzas:suc-1", {
    egreso_id: id,
    categoria,
    concepto: `Concepto ${id}`,
    monto: pesos(monto),
    forma_pago: "efectivo",
  });
  (ev as { ts: number }).ts = ts;
  return ev;
}

// --- El catálogo -------------------------------------------------------------------------

describe("categorías de egreso", () => {
  it("solo la compra de insumos NO afecta el resultado", () => {
    const queNoAfectan = CATEGORIAS_EGRESO.filter((c) => !c.afectaResultado);
    expect(queNoAfectan.map((c) => c.id)).toEqual(["insumos"]);
  });

  it("una categoría desconocida cae en 'otros' en vez de romper", () => {
    expect(categoriaDe("inventada" as CategoriaEgreso).id).toBe("otros");
  });
});

// --- El registro -------------------------------------------------------------------------

describe("registrar egresos", () => {
  it("guarda quién lo capturó y cuánto", () => {
    const f = fabrica();
    const [r] = proyectarEgresos([egreso(f, "e1", "nomina", 3000)]);

    expect(r).toMatchObject({
      egreso_id: "e1",
      categoria: "nomina",
      monto: pesos(3000),
      empleado_id: "usr-gerente",
      anulado: false,
    });
  });

  it("reaplicar el mismo evento no duplica la salida de dinero", () => {
    const f = fabrica();
    const ev = egreso(f, "e1", "renta", 15000);
    expect(proyectarEgresos([ev, ev, ev])).toHaveLength(1);
  });

  /*
   * Un egreso mal capturado se ANULA, no se borra: borrar una salida de dinero
   * es justo lo que haría alguien encubriendo un faltante.
   */
  it("anular deja constancia y saca el monto de las cuentas", () => {
    const f = fabrica();
    const eventos = [
      egreso(f, "e1", "otros", 500),
      f.crear("egreso_anulado", "finanzas:suc-1", { egreso_id: "e1", motivo: "Capturado dos veces" }),
    ];
    const [r] = proyectarEgresos(eventos);

    expect(r!.anulado).toBe(true);
    expect(r!.motivo_anulacion).toBe("Capturado dos veces");
    // Sigue en el registro —la bitácora no se borra— pero ya no se cuenta.
    expect(egresosEn(proyectarEgresos(eventos), diaDe(HOY))).toHaveLength(0);
  });

  it("filtra por período: lo de ayer no cuenta hoy", () => {
    const f = fabrica();
    const ayer = HOY - 24 * 3600_000;
    const registros = proyectarEgresos([
      egreso(f, "e1", "servicios", 800, HOY),
      egreso(f, "e2", "servicios", 900, ayer),
    ]);

    expect(egresosEn(registros, diaDe(HOY)).map((e) => e.egreso_id)).toEqual(["e1"]);
  });
});

// --- El resultado: la trampa del doble conteo --------------------------------------------

describe("resultado del período", () => {
  /** Un día con 10 000 de venta sin IVA y 3 000 de costo de lo vendido. */
  const ventas = { subtotal: pesos(10000), costo: pesos(3000) };

  it("margen bruto es ingreso menos costo de lo vendido", () => {
    const r = calcularResultado(ventas, []);
    expect(r.margen_bruto).toBe(pesos(7000));
    expect(r.resultado).toBe(pesos(7000));
    expect(r.food_cost).toBeCloseTo(0.3);
  });

  it("los gastos operativos sí se restan", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "nomina", 2000),
      egreso(f, "e2", "renta", 1000),
    ]);
    const r = calcularResultado(ventas, egresos);

    expect(r.egresos_operativos).toBe(pesos(3000));
    expect(r.resultado).toBe(pesos(4000));
  });

  /*
   * ESTA es la prueba que justifica el módulo. Comprar 5 000 de queso NO
   * empeora el resultado del día: es inventario, y su costo llegará cuando se
   * venda. Si se restara, un día de compra grande aparecería en pérdida.
   */
  it("una compra de insumos NO se resta al resultado", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([egreso(f, "e1", "insumos", 5000)]);
    const r = calcularResultado(ventas, egresos);

    expect(r.compras).toBe(pesos(5000));
    expect(r.egresos_operativos).toBe(pesos(0));
    // El resultado no se movió: sigue siendo el margen bruto.
    expect(r.resultado).toBe(pesos(7000));
  });

  it("pero la compra sí aparece como salida de efectivo", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "insumos", 5000),
      egreso(f, "e2", "nomina", 2000),
    ]);
    const r = calcularResultado(ventas, egresos);

    // Del cajón salieron 7 000, aunque solo 2 000 pesen en el resultado.
    expect(r.salida_total).toBe(pesos(7000));
    expect(r.resultado).toBe(pesos(5000));
  });

  it("un día en pérdida se ve como pérdida", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([egreso(f, "e1", "nomina", 9000)]);
    const r = calcularResultado(ventas, egresos);

    expect(r.resultado).toBe(pesos(-2000));
  });

  it("desglosa por categoría y omite las que no tuvieron movimiento", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "nomina", 2000),
      egreso(f, "e2", "nomina", 500),
      egreso(f, "e3", "servicios", 800),
    ]);
    const r = calcularResultado(ventas, egresos);

    expect(r.por_categoria).toHaveLength(2);
    expect(r.por_categoria.find((c) => c.categoria === "nomina")!.monto).toBe(pesos(2500));
    expect(r.por_categoria.some((c) => c.categoria === "renta")).toBe(false);
  });

  it("sin ventas ni egresos no divide entre cero", () => {
    const vacio = resultadoVacio();
    expect(vacio.food_cost).toBe(0);
    expect(calcularResultado({ subtotal: pesos(0), costo: pesos(0) }, []).food_cost).toBe(0);
  });
});
