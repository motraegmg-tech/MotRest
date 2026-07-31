import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { FabricaEventos } from "../evento.js";
import {
  HORA_CORTE_POR_DEFECTO,
  conteoPorClase,
  cuentasCerradasEn,
  diaDe,
  diaOperativoDe,
  jornadaDe,
  menuEngineering,
  propinasAcumuladas,
  quincenaDe,
  resumenVentas,
  ventasPorHora,
  ventasPorMesero,
  ventasPorProducto,
} from "../inteligencia/reportes.js";

const SUC = "suc-1";
const T0 = new Date(2026, 6, 22, 14, 30).getTime(); // 22-jul-2026, 14:30 local
const HORA = 3_600_000;

function renglon(
  productoId: string,
  descripcion: string,
  precio: number,
  costo: number,
  cantidad = 1,
): RenglonComanda {
  return {
    id: uuidv7(), producto_id: productoId, descripcion, cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(costo),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

/** Cuenta cobrada: se arma por eventos para que pase por los mismos reducers. */
function cuenta(opciones: {
  mesero: string;
  renglones: RenglonComanda[];
  cerrada_ts: number;
  propina?: number;
  cerrar?: boolean;
}): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>({
    device_id: "dev-1",
    empleado_id: opciones.mesero,
    sucursal_id: SUC,
  });
  const orden_id = uuidv7();

  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, {
      orden_id, mesa_id: "mesa-1", abierta_ts: opciones.cerrada_ts - HORA,
    }),
    ...opciones.renglones.map((r) =>
      f.crear("item_agregado", orden_id, { orden_id, renglon: r }),
    ),
  ];

  if (opciones.propina) {
    eventos.push(
      f.crear("propina_registrada", orden_id, { orden_id, monto: pesos(opciones.propina) }),
    );
  }

  if (opciones.cerrar !== false) {
    const cierre = f.crear("cuenta_cerrada", orden_id, { orden_id });
    // El sello real lo pone la fábrica; en la prueba se fija.
    (cierre as { ts: number }).ts = opciones.cerrada_ts;
    eventos.push(cierre);
  }

  return proyectarComanda(eventos);
}

function jornada(): EstadoComanda[] {
  return [
    cuenta({
      mesero: "emp-lucia",
      renglones: [renglon("prod-pizza", "Pizza familiar", 249, 62, 2)],
      cerrada_ts: T0,
      propina: 50,
    }),
    cuenta({
      mesero: "emp-lucia",
      renglones: [
        renglon("prod-pizza", "Pizza familiar", 249, 62),
        renglon("prod-agua", "Agua mineral", 38, 6, 3),
      ],
      cerrada_ts: T0 + HORA,
      propina: 40,
    }),
    cuenta({
      mesero: "emp-marco",
      renglones: [renglon("prod-rib-eye", "Rib eye 350 g", 429, 180)],
      cerrada_ts: T0 + HORA,
    }),
  ];
}

// --- Rango -----------------------------------------------------------------------------

describe("qué entra al reporte", () => {
  it("solo cuentan las cuentas cobradas: una mesa en servicio aún puede cambiar", () => {
    const comandas = [
      ...jornada(),
      cuenta({
        mesero: "emp-lucia",
        renglones: [renglon("prod-pizza", "Pizza familiar", 249, 62)],
        cerrada_ts: T0,
        cerrar: false,
      }),
    ];
    expect(comandas).toHaveLength(4);
    expect(cuentasCerradasEn(comandas)).toHaveLength(3);
  });

  it("el día natural va de medianoche a medianoche, en hora local", () => {
    const dia = diaDe(T0);
    expect(new Date(dia.desde).getHours()).toBe(0);
    expect(dia.hasta - dia.desde).toBe(24 * HORA);
    expect(cuentasCerradasEn(jornada(), dia)).toHaveLength(3);
  });

  it("deja fuera lo cobrado otro día", () => {
    const ayer = diaDe(T0 - 24 * HORA);
    expect(cuentasCerradasEn(jornada(), ayer)).toHaveLength(0);
  });
});

// --- Resumen ---------------------------------------------------------------------------

describe("resumen de ventas", () => {
  const r = resumenVentas(jornada());

  it("suma cuentas y platillos servidos", () => {
    expect(r.cuentas).toBe(3);
    // 2 pizzas + 1 pizza + 3 aguas + 1 rib eye
    expect(r.platillos).toBe(7);
  });

  it("separa el subtotal del IVA: el impuesto no es ingreso del restaurante", () => {
    // Bruto: 498 + 249 + 114 + 429 = 1290
    expect(r.subtotal).toBe(pesos(1290));
    expect(r.iva).toBe(pesos(206.4));
    expect(r.total).toBe(pesos(1496.4));
  });

  it("el food cost se mide contra el subtotal, no contra el total con IVA", () => {
    // Costo: 124 + 62 + 18 + 180 = 384
    expect(r.costo).toBe(pesos(384));
    expect(r.margen).toBe(pesos(906));
    expect(r.foodCost).toBeCloseTo(384 / 1290, 6);
  });

  it("el ticket promedio reparte el total entre las cuentas cerradas", () => {
    expect(r.ticketPromedio).toBe(pesos(498.8));
  });

  it("acumula las propinas del periodo", () => {
    expect(r.propinas).toBe(pesos(90));
  });

  it("un periodo sin ventas no divide entre cero", () => {
    const vacio = resumenVentas([]);
    expect(vacio.ticketPromedio).toBe(0);
    expect(vacio.foodCost).toBe(0);
  });
});

// --- Por producto ------------------------------------------------------------------------

describe("ventas por producto", () => {
  const ventas = ventasPorProducto(jornada());

  it("agrupa el mismo producto aunque venga de cuentas distintas", () => {
    const pizza = ventas.find((v) => v.producto_id === "prod-pizza")!;
    expect(pizza.unidades).toBe(3);
    expect(pizza.importe).toBe(pesos(747));
    expect(pizza.costo).toBe(pesos(186));
    expect(pizza.margen).toBe(pesos(561));
  });

  it("ordena por importe vendido", () => {
    expect(ventas.map((v) => v.producto_id)).toEqual([
      "prod-pizza", "prod-rib-eye", "prod-agua",
    ]);
  });

  it("calcula el margen porcentual de cada uno", () => {
    const agua = ventas.find((v) => v.producto_id === "prod-agua")!;
    expect(agua.margenPct).toBeCloseTo((114 - 18) / 114, 6);
  });
});

// --- Por mesero -------------------------------------------------------------------------

describe("ventas por mesero", () => {
  const meseros = ventasPorMesero(jornada());

  it("suma las cuentas de cada quien", () => {
    const lucia = meseros.find((m) => m.mesero_id === "emp-lucia")!;
    expect(lucia.cuentas).toBe(2);
    expect(lucia.propinas).toBe(pesos(90));
  });

  it("mide la propina como fracción de lo vendido", () => {
    const marco = meseros.find((m) => m.mesero_id === "emp-marco")!;
    expect(marco.propinaPct).toBe(0);
    const lucia = meseros.find((m) => m.mesero_id === "emp-lucia")!;
    expect(lucia.propinaPct).toBeGreaterThan(0);
  });

  it("ordena por importe, de mayor a menor", () => {
    expect(meseros[0]!.mesero_id).toBe("emp-lucia");
  });
});

// --- Curva horaria -----------------------------------------------------------------------

describe("curva por hora", () => {
  const horas = ventasPorHora(jornada());

  it("agrupa por la hora del cobro", () => {
    expect(horas.map((h) => h.hora)).toEqual([14, 15]);
    expect(horas[0]!.cuentas).toBe(1);
    expect(horas[1]!.cuentas).toBe(2);
  });

  it("solo devuelve las horas con actividad", () => {
    // 24 barras vacías esconderían la forma real del servicio.
    expect(horas).toHaveLength(2);
  });
});

// --- Menu engineering ----------------------------------------------------------------------

describe("menu engineering", () => {
  it("clasifica en los cuatro cuadrantes de Kasavana-Smith", () => {
    const clasificados = menuEngineering(ventasPorProducto(jornada()));
    const clases = new Map(clasificados.map((c) => [c.producto_id, c.clase]));

    // La pizza se vende mucho (3 de 7) y deja bien: estrella.
    expect(clases.get("prod-pizza")).toBe("estrella");
    // El agua se vende (3 de 7) pero deja $32 por unidad: caballo de batalla.
    expect(clases.get("prod-agua")).toBe("caballo");
    // El rib eye deja $249 en una sola venta: rompecabezas.
    expect(clases.get("prod-rib-eye")).toBe("rompecabezas");
  });

  it("la popularidad es participación en unidades, no en dinero", () => {
    const clasificados = menuEngineering(ventasPorProducto(jornada()));
    const agua = clasificados.find((c) => c.producto_id === "prod-agua")!;
    expect(agua.popularidad).toBeCloseTo(3 / 7, 6);
  });

  it("cuenta cuántos cayeron en cada cuadrante", () => {
    const conteo = conteoPorClase(menuEngineering(ventasPorProducto(jornada())));
    expect(conteo.estrella + conteo.caballo + conteo.rompecabezas + conteo.perro).toBe(3);
  });

  it("un menú sin ventas no clasifica nada, en vez de romper", () => {
    expect(menuEngineering([])).toEqual([]);
    expect(conteoPorClase([])).toEqual({
      estrella: 0, caballo: 0, rompecabezas: 0, perro: 0,
    });
  });

  it("ignora productos con cero unidades: no tienen popularidad que medir", () => {
    const clasificados = menuEngineering([
      {
        producto_id: "p1", descripcion: "Fantasma", unidades: 0,
        importe: 0 as never, costo: 0 as never, margen: 0 as never, margenPct: 0,
      },
    ]);
    expect(clasificados).toEqual([]);
  });
});

// --- La jornada operativa ------------------------------------------------------------------

describe("jornada operativa", () => {
  /*
   * EL CASO DE RODIZIO. Un viernes de servicio termina a la una de la
   * madrugada. Esas ventas son del VIERNES para quien las hizo; cortar a
   * medianoche las manda al sábado.
   */
  it("la venta de la 1 a.m. del sábado pertenece a la jornada del viernes", () => {
    const madrugada = new Date(2026, 6, 25, 1, 30).getTime(); // sábado 1:30 a.m.
    const j = jornadaDe(madrugada);

    expect(new Date(j.desde).getDay()).toBe(5); // viernes
    expect(new Date(j.desde).getDate()).toBe(24);
    expect(new Date(j.desde).getHours()).toBe(HORA_CORTE_POR_DEFECTO);
  });

  it("una venta de la noche y otra de la madrugada caen en la misma jornada", () => {
    const antes = new Date(2026, 6, 24, 23, 40).getTime(); // viernes 23:40
    const despues = new Date(2026, 6, 25, 0, 20).getTime(); // sábado 00:20

    expect(diaOperativoDe(despues)).toBe(diaOperativoDe(antes));
  });

  it("después de la hora de corte ya es la jornada nueva", () => {
    const temprano = new Date(2026, 6, 25, 4, 59).getTime(); // aún viernes contable
    const tarde = new Date(2026, 6, 25, 5, 1).getTime(); // ya sábado contable

    expect(diaOperativoDe(temprano)).not.toBe(diaOperativoDe(tarde));
    expect(new Date(diaOperativoDe(tarde)).getDay()).toBe(6); // sábado
  });

  it("dura exactamente 24 horas", () => {
    const j = jornadaDe(new Date(2026, 6, 24, 21).getTime());
    expect(j.hasta - j.desde).toBe(24 * 3600_000);
  });

  it("la hora de corte es configurable", () => {
    const madrugada = new Date(2026, 6, 25, 3).getTime();
    // Con corte a las 5, las 3 a.m. son del día anterior…
    expect(new Date(jornadaDe(madrugada, 5).desde).getDate()).toBe(24);
    // …y con corte a medianoche, del mismo día.
    expect(new Date(jornadaDe(madrugada, 0).desde).getDate()).toBe(25);
  });

  it("con corte a medianoche se comporta como el día natural", () => {
    const ts = new Date(2026, 6, 24, 15).getTime();
    expect(jornadaDe(ts, 0)).toEqual(diaDe(ts));
  });
});

// --- Propinas acumuladas ---------------------------------------------------------------------

/*
 * Lo que el mesero mira en el panel para saber cuánto lleva. Los errores aquí
 * son de CALENDARIO, no de suma: una propina de la medianoche del viernes que
 * se va a la semana siguiente, o un 31 de enero que al sumar un mes cae en
 * marzo. Por eso las pruebas son de fechas incómodas a propósito.
 */
describe("propinas acumuladas", () => {
  const VIERNES = new Date(2026, 6, 24, 21, 0).getTime(); // vie 24-jul-2026, 21:00
  const MADRUGADA = new Date(2026, 6, 25, 0, 40).getTime(); // sáb 25 a las 00:40

  function conPropinas(): EstadoComanda[] {
    return [
      cuenta({ mesero: "emp-lucia", renglones: [renglon("p", "Pizza", 200, 60)],
        cerrada_ts: VIERNES, propina: 50 }),
      // Misma noche, ya pasada la medianoche: sigue siendo el viernes.
      cuenta({ mesero: "emp-lucia", renglones: [renglon("p", "Pizza", 200, 60)],
        cerrada_ts: MADRUGADA, propina: 30 }),
      // Otro mesero, la misma noche.
      cuenta({ mesero: "emp-beto", renglones: [renglon("p", "Pizza", 200, 60)],
        cerrada_ts: VIERNES, propina: 20 }),
      // Lunes anterior: misma quincena, otra semana.
      cuenta({ mesero: "emp-lucia", renglones: [renglon("p", "Pizza", 200, 60)],
        cerrada_ts: new Date(2026, 6, 20, 20, 0).getTime(), propina: 100 }),
    ];
  }

  it("la propina de después de medianoche cuenta en la jornada del viernes", () => {
    const a = propinasAcumuladas(conPropinas(), MADRUGADA, HORA_CORTE_POR_DEFECTO);
    // 50 + 30 de Lucía + 20 de Beto: las tres son de la misma noche.
    expect(a.dia).toBe(pesos(100));
    expect(a.cuentasDelDia).toBe(3);
  });

  it("con mesero, solo lo suyo", () => {
    const a = propinasAcumuladas(conPropinas(), MADRUGADA, HORA_CORTE_POR_DEFECTO, "emp-lucia");
    expect(a.dia).toBe(pesos(80));
    // La semana del viernes 24 arranca el lunes 20: entra la de $100.
    expect(a.semana).toBe(pesos(180));
  });

  it("la quincena del 24 va del 16 al fin de mes", () => {
    const a = propinasAcumuladas(conPropinas(), VIERNES, HORA_CORTE_POR_DEFECTO);
    expect(quincenaDe(VIERNES).desde).toBe(new Date(2026, 6, 16, 5, 0).getTime());
    expect(quincenaDe(VIERNES).hasta).toBe(new Date(2026, 7, 1, 5, 0).getTime());
    expect(a.quincena).toBe(pesos(200));
  });

  it("la primera quincena va del 1 al 16", () => {
    const dia8 = new Date(2026, 6, 8, 13, 0).getTime();
    expect(quincenaDe(dia8).desde).toBe(new Date(2026, 6, 1, 5, 0).getTime());
    expect(quincenaDe(dia8).hasta).toBe(new Date(2026, 6, 16, 5, 0).getTime());
  });

  /* Sumar un mes a un 31 de enero da un 3 de marzo si se hace en dos pasos. */
  it("la segunda quincena de enero termina el 1 de febrero, no en marzo", () => {
    const ene31 = new Date(2026, 0, 31, 22, 0).getTime();
    expect(quincenaDe(ene31).hasta).toBe(new Date(2026, 1, 1, 5, 0).getTime());
  });

  it("una cuenta todavía abierta no suma, aunque tenga propina apuntada", () => {
    const abierta = cuenta({
      mesero: "emp-lucia", renglones: [renglon("p", "Pizza", 200, 60)],
      cerrada_ts: VIERNES, propina: 500, cerrar: false,
    });
    expect(propinasAcumuladas([abierta], VIERNES).dia).toBe(pesos(0));
  });

  it("sin propinas, todo en cero y sin romperse", () => {
    const a = propinasAcumuladas([], Date.now());
    expect(a).toEqual({ dia: 0, semana: 0, quincena: 0, cuentasDelDia: 0 });
  });
});
