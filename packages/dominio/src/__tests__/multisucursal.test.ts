/**
 * Varios locales bajo una misma dirección.
 *
 * Lo que hay que probar no es la suma: es lo que pasa cuando FALTA un local. Un
 * consolidado que suma lo que tiene y lo presenta como el total del grupo es
 * peor que un hueco visible — con el hueco se pregunta, con el número falso se
 * decide.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import {
  compararSucursales,
  consolidar,
  reporteVacio,
  saludDelGrupo,
  type ReporteDeSucursal,
  type Sucursal,
} from "../organizacion/multisucursal.js";

const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = new Date(2026, 6, 24, 5, 0).getTime();
const HORA = 3_600_000;

const SUCURSALES: Sucursal[] = [
  { id: "suc-centro", nombre: "Rodizio Centro", activa: true },
  { id: "suc-zapopan", nombre: "Rodizio Zapopan", activa: true },
  { id: "suc-cerrada", nombre: "Rodizio Andares", activa: false },
];

function reporte(opciones: {
  sucursal: string;
  ventas: number;
  cuentas: number;
  costo?: number;
  dia?: number;
  reportado_ts?: number;
  diferencia?: number;
}): ReporteDeSucursal {
  return {
    sucursal_id: opciones.sucursal,
    dia: opciones.dia ?? DIA,
    reportado_ts: opciones.reportado_ts ?? AHORA,
    ventas: pesos(opciones.ventas),
    cuentas: opciones.cuentas,
    propinas: pesos(opciones.ventas * 0.1),
    costo: pesos(opciones.costo ?? opciones.ventas * 0.3),
    descuentos: CERO,
    efectivo_esperado: pesos(opciones.ventas * 0.6),
    diferencia_arqueo: opciones.diferencia === undefined ? undefined : pesos(opciones.diferencia),
  };
}

// --- Lo que falta -------------------------------------------------------------------------

describe("cuando un local no reportó", () => {
  /*
   * EL CANDADO. Un local que vendió $40 000 y no reportó no es un local que
   * vendió cero. Presentar el total del grupo sin decirlo hace que el dueño
   * decida con un número que no existe.
   */
  it("lo dice, en vez de sumar lo que tiene y llamarlo el total", () => {
    const c = consolidar(SUCURSALES, [reporte({ sucursal: "suc-centro", ventas: 50_000, cuentas: 200 })], DIA);

    expect(c.completo).toBe(false);
    expect(c.sin_reportar).toEqual([{ sucursal_id: "suc-zapopan", nombre: "Rodizio Zapopan" }]);
    // Se suma lo que hay, pero acompañado del hueco.
    expect(c.ventas).toBe(pesos(50_000));
  });

  it("con todos, el total sí es el total", () => {
    const c = consolidar(
      SUCURSALES,
      [
        reporte({ sucursal: "suc-centro", ventas: 50_000, cuentas: 200 }),
        reporte({ sucursal: "suc-zapopan", ventas: 30_000, cuentas: 150 }),
      ],
      DIA,
    );

    expect(c.completo).toBe(true);
    expect(c.sin_reportar).toEqual([]);
    expect(c.ventas).toBe(pesos(80_000));
    expect(c.cuentas).toBe(350);
  });

  /* Un local cerrado no es un local que falta. */
  it("las sucursales inactivas no cuentan como faltantes", () => {
    const c = consolidar(
      SUCURSALES,
      [
        reporte({ sucursal: "suc-centro", ventas: 10_000, cuentas: 50 }),
        reporte({ sucursal: "suc-zapopan", ventas: 10_000, cuentas: 50 }),
      ],
      DIA,
    );
    expect(c.completo).toBe(true);
  });

  /*
   * Un local que reintentó tras una caída manda el reporte dos veces. Sumarlos
   * duplicaría la venta del grupo.
   */
  it("un local que reportó dos veces no cuenta doble", () => {
    const c = consolidar(
      SUCURSALES,
      [
        reporte({ sucursal: "suc-centro", ventas: 50_000, cuentas: 200, reportado_ts: AHORA - HORA }),
        reporte({ sucursal: "suc-centro", ventas: 52_000, cuentas: 210, reportado_ts: AHORA }),
        reporte({ sucursal: "suc-zapopan", ventas: 30_000, cuentas: 150 }),
      ],
      DIA,
    );

    expect(c.renglones).toHaveLength(2);
    // Manda el más reciente.
    expect(c.ventas).toBe(pesos(82_000));
  });

  it("un reporte de otro día no se cuela", () => {
    const c = consolidar(
      SUCURSALES,
      [reporte({ sucursal: "suc-centro", ventas: 99_000, cuentas: 400, dia: DIA - 86_400_000 })],
      DIA,
    );
    expect(c.ventas).toBe(CERO);
    expect(c.sin_reportar).toHaveLength(2);
  });

  it("un grupo sin ningún reporte no divide entre cero", () => {
    const c = consolidar(SUCURSALES, [], DIA);
    expect(c.ticket_promedio).toBe(0);
    expect(c.margen).toBe(0);
  });
});

// --- Qué local tiene un problema -----------------------------------------------------------

describe("cómo está cada local ahora", () => {
  /*
   * La pregunta de un dueño con varios restaurantes por la mañana no es "cuánto
   * vendimos": es CUÁL DE MIS LOCALES TIENE UN PROBLEMA.
   */
  it("señala al que lleva sin dar señales", () => {
    const salud = saludDelGrupo(
      SUCURSALES,
      [
        reporte({ sucursal: "suc-centro", ventas: 10_000, cuentas: 50, reportado_ts: AHORA - HORA }),
        reporte({ sucursal: "suc-zapopan", ventas: 8_000, cuentas: 40, reportado_ts: AHORA - 50 * HORA }),
      ],
      AHORA,
    );

    expect(salud[0]!.estado).toBe("sin_señal");
    expect(salud[0]!.nombre).toBe("Rodizio Zapopan");
    expect(salud[1]!.estado).toBe("al_dia");
  });

  it("un local que nunca reportó también sale señalado", () => {
    const salud = saludDelGrupo(SUCURSALES, [], AHORA);
    expect(salud.every((s) => s.estado === "sin_señal")).toBe(true);
    // La cerrada no aparece: no se espera nada de ella.
    expect(salud).toHaveLength(2);
  });

  /* Las diferencias de arqueo juntas: una sola se explica, tres seguidas no. */
  it("trae la diferencia del último arqueo de cada uno", () => {
    const salud = saludDelGrupo(
      SUCURSALES,
      [reporte({ sucursal: "suc-centro", ventas: 10_000, cuentas: 50, diferencia: -350 })],
      AHORA,
    );
    const centro = salud.find((s) => s.sucursal_id === "suc-centro")!;
    expect(centro.ultima_diferencia).toBe(pesos(-350));
  });
});

// --- Comparar locales ----------------------------------------------------------------------

describe("cómo va cada local contra los demás", () => {
  /*
   * Se compara ticket promedio y margen, no solo venta. Un local en una plaza
   * chica que vende la mitad pero con mejor margen lo está haciendo mejor que
   * uno grande que factura mucho y no deja nada.
   */
  it("saca participación, ticket y margen de cada uno", () => {
    const c = consolidar(
      SUCURSALES,
      [
        reporte({ sucursal: "suc-centro", ventas: 60_000, cuentas: 300, costo: 24_000 }),
        reporte({ sucursal: "suc-zapopan", ventas: 40_000, cuentas: 100, costo: 12_000 }),
      ],
      DIA,
    );
    const comp = compararSucursales(c);

    const centro = comp.find((x) => x.sucursal_id === "suc-centro")!;
    const zapopan = comp.find((x) => x.sucursal_id === "suc-zapopan")!;

    expect(centro.participacion).toBeCloseTo(0.6, 3);

    // Zapopan vende menos y opera mejor: ticket más alto y mejor margen.
    expect(zapopan.ticket_promedio).toBeGreaterThan(centro.ticket_promedio);
    expect(zapopan.margen).toBeGreaterThan(centro.margen);
  });

  it("un local que abrió y no vendió no rompe nada", () => {
    const c = consolidar(
      SUCURSALES,
      [
        reporteVacio("suc-centro", DIA),
        reporte({ sucursal: "suc-zapopan", ventas: 10_000, cuentas: 50 }),
      ],
      DIA,
    );
    const centro = compararSucursales(c).find((x) => x.sucursal_id === "suc-centro")!;
    expect(centro.ticket_promedio).toBe(0);
    expect(centro.participacion).toBe(0);
  });
});
