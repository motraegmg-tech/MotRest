/**
 * Voz del cliente (C4).
 *
 * Lo que de verdad importa probar es el CRUCE: que la espera medida se compare
 * con lo que opinó la mesa, y —sobre todo— que NO se invente una conclusión
 * cuando falta uno de los dos grupos. Un tablero que dramatiza con dos datos
 * pierde la confianza y ya no se vuelve a mirar.
 */
import { describe, expect, it } from "vitest";
import { FabricaEventos } from "../evento.js";
import type { EventoOpinion, Opinion } from "../clientes/opinion.js";
import {
  efectoDeLaEspera,
  esperasDeCuentas,
  opinionesPorMesero,
  proyectarOpiniones,
  resumirOpiniones,
} from "../clientes/opinion.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const STREAM = "opiniones:suc-1";
const fabrica = () => new FabricaEventos<EventoOpinion>(CTX);

function opinion(
  opinion_id: string,
  orden_id: string,
  calificacion: "bien" | "regular" | "mal",
  motivos: ("comida" | "servicio" | "tiempo" | "precio" | "limpieza")[] = [],
): EventoOpinion {
  return fabrica().crear("opinion_registrada", STREAM, {
    opinion_id,
    orden_id,
    calificacion,
    motivos,
  });
}

describe("captura", () => {
  it("proyecta lo capturado, de lo más reciente a lo más viejo", () => {
    const o = proyectarOpiniones([
      opinion("op1", "o1", "bien"),
      opinion("op2", "o2", "mal", ["tiempo"]),
    ]);
    expect(o).toHaveLength(2);
    expect(o[0]!.opinion_id).toBe("op2");
  });

  it("reaplicar la misma no la duplica", () => {
    const una = opinion("op1", "o1", "bien");
    expect(proyectarOpiniones([una, una])).toHaveLength(1);
  });
});

describe("resumen", () => {
  const muestra = proyectarOpiniones([
    opinion("op1", "o1", "bien"),
    opinion("op2", "o2", "bien"),
    opinion("op3", "o3", "regular", ["tiempo"]),
    opinion("op4", "o4", "mal", ["tiempo", "comida"]),
  ]);

  it("cuenta cada calificación y calcula el índice", () => {
    const r = resumirOpiniones(muestra);
    expect(r).toMatchObject({ total: 4, bien: 2, regular: 1, mal: 1 });
    // (100 + 100 + 50 + 0) / 4
    expect(r.indice).toBe(63);
  });

  it("ordena las quejas por lo que más se repite", () => {
    const r = resumirOpiniones(muestra);
    expect(r.quejas[0]).toEqual({ motivo: "tiempo", veces: 2 });
  });

  it("sin opiniones el índice es null, no cero", () => {
    // Cero significaría "todos calificaron mal", que es una mentira distinta.
    expect(resumirOpiniones([]).indice).toBeNull();
  });
});

// --- El cruce ------------------------------------------------------------------------------

describe("efecto de la espera", () => {
  const opiniones: Opinion[] = proyectarOpiniones([
    opinion("op1", "rapida-1", "bien"),
    opinion("op2", "rapida-2", "bien"),
    opinion("op3", "lenta-1", "mal", ["tiempo"]),
    opinion("op4", "lenta-2", "regular", ["tiempo"]),
  ]);
  const esperas = [
    { orden_id: "rapida-1", minutos: 12 },
    { orden_id: "rapida-2", minutos: 18 },
    { orden_id: "lenta-1", minutos: 41 },
    { orden_id: "lenta-2", minutos: 33 },
  ];

  it("parte por el umbral y mide la caída", () => {
    const e = efectoDeLaEspera(opiniones, esperas, 25);
    expect(e.rapidas.total).toBe(2);
    expect(e.lentas.total).toBe(2);
    expect(e.rapidas.indice).toBe(100);
    expect(e.lentas.indice).toBe(25);
    expect(e.caida).toBe(75);
  });

  /*
   * EL CANDADO. Con un solo grupo, comparar daría una cifra dramática y sin
   * sentido. Se dice que no se puede concluir, en vez de inventar.
   */
  it("sin los dos grupos no concluye nada", () => {
    const soloRapidas = efectoDeLaEspera(opiniones.slice(0, 2), esperas, 25);
    expect(soloRapidas.caida).toBeNull();
  });

  it("una cuenta sin dato de espera no se clasifica a la fuerza", () => {
    const e = efectoDeLaEspera(opiniones, esperas.slice(0, 3), 25);
    expect(e.rapidas.total + e.lentas.total).toBe(3);
  });
});

describe("espera real de cada cuenta", () => {
  it("va del primer envío a cocina a la última entrega", () => {
    const t0 = new Date(2026, 6, 24, 20).getTime();
    const esperas = esperasDeCuentas([
      {
        orden_id: "o1",
        renglones: [
          { enviado_ts: t0, entregado_ts: t0 + 15 * 60_000 },
          { enviado_ts: t0 + 60_000, entregado_ts: t0 + 22 * 60_000 },
        ],
      },
    ]);
    expect(esperas).toEqual([{ orden_id: "o1", minutos: 22 }]);
  });

  it("una cuenta sin entregar no inventa un tiempo", () => {
    const t0 = Date.now();
    const esperas = esperasDeCuentas([
      { orden_id: "o1", renglones: [{ enviado_ts: t0 }] },
    ]);
    expect(esperas).toEqual([]);
  });
});

describe("por mesero", () => {
  it("agrupa y ordena del mejor calificado al peor", () => {
    const opiniones = proyectarOpiniones([
      opinion("op1", "o1", "bien"),
      opinion("op2", "o2", "mal", ["servicio"]),
    ]);
    const meseros: Record<string, string> = { o1: "usr-lucia", o2: "usr-marco" };

    const r = opinionesPorMesero(opiniones, (id) => meseros[id]);
    expect(r.map((x) => x.mesero_id)).toEqual(["usr-lucia", "usr-marco"]);
    expect(r[0]!.resumen.indice).toBe(100);
  });
});
