/**
 * Egresos y resultado del período.
 *
 * La prueba que más importa aquí no es una suma: es que **una compra de insumos
 * NO se reste al margen**. El costo de lo vendido ya viene de las recetas, y
 * restarlo otra vez haría que un martes de compra grande apareciera como un día
 * en pérdida cuando fue un día bueno.
 */
import { describe, expect, it } from "vitest";
import { pesos, restar } from "../comun/dinero.js";
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

  /*
   * EL DESGLOSE TIENE QUE SUMAR EL TOTAL.
   *
   * Desde la 1.5.5 el «Resultado de hoy» ya no enseña «Gastos de operación
   * −$10,000» a secas: enseña de qué se compone, porque un total ciego no se
   * puede discutir con nadie ni dice qué recortar. El desglose sale de filtrar
   * `por_categoria` por `afectaResultado`, así que si alguien añade una
   * categoría y se olvida de clasificarla, la pantalla enseñaría renglones que
   * no cuadran con su propia suma — y un número que no cuadra con el de al lado
   * es lo que hace que se deje de creer la pantalla entera.
   */
  it("el desglose de gastos operativos suma exactamente el total", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "nomina", 2000),
      egreso(f, "e2", "renta", 1000),
      egreso(f, "e3", "servicios", 500),
      egreso(f, "e4", "insumos", 5000),
    ]);
    const r = calcularResultado(ventas, egresos);

    const sumaDelDesglose = r.por_categoria
      .filter((c) => c.afectaResultado)
      .reduce((total, c) => total + c.monto, 0);

    expect(sumaDelDesglose).toBe(r.egresos_operativos);
    expect(r.egresos_operativos).toBe(pesos(3500));
  });

  /* Y el desglose COMPLETO —insumos incluidos— suma lo que salió del cajón. */
  it("el desglose completo suma la salida de caja", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "nomina", 2000),
      egreso(f, "e2", "insumos", 5000),
    ]);
    const r = calcularResultado(ventas, egresos);

    const sumaTotal = r.por_categoria.reduce((total, c) => total + c.monto, 0);

    expect(sumaTotal).toBe(r.salida_total);
    expect(r.salida_total).toBe(pesos(7000));
    // Y sigue sin tocar el resultado, que es de lo que va todo este módulo.
    expect(r.resultado).toBe(pesos(5000));
  });

  /*
   * Ninguna categoría puede quedarse sin clasificar. `afectaResultado` decide si
   * un gasto resta o no, y una categoría nueva sin esa decisión tomada caería en
   * el lado que le tocara por omisión, en silencio.
   */
  it("toda categoría declara si afecta al resultado", () => {
    for (const def of CATEGORIAS_EGRESO) {
      expect(typeof def.afectaResultado).toBe("boolean");
    }
    // Y solo insumos NO afecta: es la regla entera del módulo.
    const queNoAfectan = CATEGORIAS_EGRESO.filter((c) => !c.afectaResultado);
    expect(queNoAfectan.map((c) => c.id)).toEqual(["insumos"]);
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

// --- Las dos utilidades -----------------------------------------------------------------------

/*
 * Gonzalo pidió que la compra de insumos se restara de la utilidad. Restarla a
 * la contable contaría el queso dos veces, así que se enseñan DOS utilidades.
 * Estas pruebas fijan con números la regla entera: la de efectivo resta la
 * compra y NO el costo de lo vendido, la contable al revés, y entre las dos hay
 * exactamente «compras − costo de lo vendido», ni un centavo más.
 */
describe("las dos utilidades", () => {
  /** El día de la prueba: 10 000 de venta sin IVA y 3 000 de costo de lo vendido. */
  const ventas = { subtotal: pesos(10000), costo: pesos(3000) };

  it("un día de surtido: la de efectivo resta la compra y NO el costo de lo vendido", () => {
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "insumos", 5000),
      egreso(f, "e2", "nomina", 2000),
    ]);
    const r = calcularResultado(ventas, egresos);

    // Contable: 10 000 − 3 000 de costo − 2 000 de nómina. La compra no pesa.
    expect(r.resultado).toBe(pesos(5000));
    // En efectivo: 10 000 − 2 000 de nómina − 5 000 de insumos. El costo no pesa.
    expect(r.utilidad_efectivo).toBe(pesos(3000));

    // Restar las DOS cosas —compra y costo— daría cero: el doble conteo que se evita.
    expect(restar(r.margen_bruto, r.salida_total)).toBe(pesos(0));
    expect(r.utilidad_efectivo).not.toBe(restar(r.margen_bruto, r.salida_total));

    // Y la diferencia es exactamente compras − costo de lo vendido.
    expect(restar(r.resultado, r.utilidad_efectivo)).toBe(restar(r.compras, r.costo));
    expect(restar(r.resultado, r.utilidad_efectivo)).toBe(pesos(2000));
  });

  it("un día que vende de lo que ya había en la despensa: la de efectivo queda ARRIBA", () => {
    // Sin compra, la de efectivo no carga el queso que sí se consumió.
    const f = fabrica();
    const r = calcularResultado(ventas, proyectarEgresos([egreso(f, "e1", "renta", 1000)]));

    expect(r.resultado).toBe(pesos(6000));
    expect(r.utilidad_efectivo).toBe(pesos(9000));
    // La contable queda abajo justo por el costo de lo vendido.
    expect(restar(r.utilidad_efectivo, r.resultado)).toBe(r.costo);
  });

  it("la de efectivo es la venta menos lo que dice «Salió de la caja», al centavo", () => {
    // La pantalla enseña las dos cifras una debajo de la otra: tienen que cuadrar.
    const f = fabrica();
    const egresos = proyectarEgresos([
      egreso(f, "e1", "insumos", 1234.56),
      egreso(f, "e2", "servicios", 789.01),
    ]);
    const r = calcularResultado(ventas, egresos);

    expect(r.utilidad_efectivo).toBe(restar(r.ingreso, r.salida_total));
    // 10 000 − 1 234.56 − 789.01, hecho a mano en papel.
    expect(r.utilidad_efectivo).toBe(pesos(7976.43));
  });

  it("parte de la venta SIN IVA, igual que la contable", () => {
    // `subtotal` es la venta sin IVA: el IVA es del SAT. Sin gastos ni costo,
    // las dos utilidades valen exactamente eso y nada del 16 %.
    const r = calcularResultado({ subtotal: pesos(1000), costo: pesos(0) }, []);
    expect(r.utilidad_efectivo).toBe(pesos(1000));
    expect(r.resultado).toBe(pesos(1000));
  });

  it("un día en que salió más de lo que entró se ve negativo", () => {
    const f = fabrica();
    const r = calcularResultado(ventas, proyectarEgresos([egreso(f, "e1", "insumos", 14000)]));

    expect(r.utilidad_efectivo).toBe(pesos(-4000));
    // Y la contable sigue en positivo: el queso es inventario, no pérdida.
    expect(r.resultado).toBe(pesos(7000));
  });

  it("el resultado vacío trae las dos en cero", () => {
    expect(resultadoVacio().utilidad_efectivo).toBe(pesos(0));
    expect(resultadoVacio().resultado).toBe(pesos(0));
  });

  /*
   * LO YA REGISTRADO. Gonzalo pidió que alcanzara a los gastos que los
   * restauranteros capturaron antes de esta versión. No hay nada que migrar:
   * la cifra se deriva al leer el registro de eventos. Aquí se comprueba con
   * eventos como los guardaba la versión anterior —sin `pagado`, sin
   * renglones de mercancía— y leídos del disco, es decir, JSON de vuelta.
   */
  it("los gastos capturados antes de esta versión entran solos, sin migrar", () => {
    const f = fabrica();
    const guardados = [
      egreso(f, "viejo-queso", "insumos", 4000),
      egreso(f, "viejo-luz", "servicios", 500),
      egreso(f, "viejo-anulado", "insumos", 9999),
      f.crear("egreso_anulado", "finanzas:suc-1", {
        egreso_id: "viejo-anulado",
        motivo: "Capturado dos veces",
      }),
    ];
    const delDisco = JSON.parse(JSON.stringify(guardados)) as EventoEgreso[];

    // Tal como los dejó la versión anterior: sin ninguno de los campos nuevos.
    for (const ev of delDisco) {
      expect(ev).not.toHaveProperty("pagado");
      expect(ev).not.toHaveProperty("lineas");
    }

    const r = calcularResultado(ventas, egresosEn(proyectarEgresos(delDisco), diaDe(HOY)));

    expect(r.compras).toBe(pesos(4000));
    // 10 000 − 500 de luz − 4 000 de queso. El anulado no cuenta.
    expect(r.utilidad_efectivo).toBe(pesos(5500));
    // La contable, la de siempre: 10 000 − 3 000 − 500.
    expect(r.resultado).toBe(pesos(6500));
  });
});
