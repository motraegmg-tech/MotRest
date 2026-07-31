/**
 * Prenómina: horas por tarifa, más propinas.
 *
 * Lo que más importa probar es el dinero: que el fondo de propinas se reparta
 * SIN perder ni inventar centavos (una diferencia de un peso el día de la raya
 * enciende una discusión), y que un turno sin cerrar se señale en vez de
 * pagarse en silencio.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos, sumar } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoPrenomina, JornadaTrabajador } from "../personal/prenomina.js";
import { semanaDe } from "../inteligencia/reportes.js";
import {
  calcularPrenomina,
  tarifasVigentes,
} from "../personal/prenomina.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-jefe", sucursal_id: "suc-1" };
const STREAM = "prenomina:suc-1";
const fabrica = () => new FabricaEventos<EventoPrenomina>(CTX);

function jornada(
  id: string,
  nombre: string,
  minutos: number,
  propinas = CERO,
  turnoAbierto = false,
): JornadaTrabajador {
  return { trabajador_id: id, nombre, minutos, turnoAbierto, propinasPropias: propinas };
}

// --- Tarifas ------------------------------------------------------------------------------

describe("tarifas", () => {
  it("la última asignada es la vigente", () => {
    const f = fabrica();
    const tarifas = tarifasVigentes([
      f.crear("tarifa_asignada", STREAM, { trabajador_id: "t1", tarifa_hora: pesos(50) }),
      f.crear("tarifa_asignada", STREAM, { trabajador_id: "t1", tarifa_hora: pesos(60), nota: "Aumento" }),
      f.crear("tarifa_asignada", STREAM, { trabajador_id: "t2", tarifa_hora: pesos(45) }),
    ]);

    expect(tarifas.get("t1")).toBe(pesos(60));
    expect(tarifas.get("t2")).toBe(pesos(45));
  });
});

// --- Sueldo -------------------------------------------------------------------------------

describe("sueldo por horas", () => {
  const tarifas = new Map([["t1", pesos(50)]]);

  it("paga las horas trabajadas a su tarifa", () => {
    // 8 h exactas a $50 = $400
    const p = calcularPrenomina([jornada("t1", "Lucía", 480)], tarifas);
    expect(p.renglones[0]!.horas).toBe(8);
    expect(p.renglones[0]!.sueldo).toBe(pesos(400));
  });

  it("las fracciones de hora se pagan proporcionalmente, al centavo", () => {
    // 7 h 35 min = 455 min. 455/60 * 5000 centavos = 37916.66… -> 37917
    const p = calcularPrenomina([jornada("t1", "Lucía", 455)], tarifas);
    expect(p.renglones[0]!.sueldo).toBe(37917);
  });

  it("sin tarifa capturada el sueldo va en cero y se señala", () => {
    const p = calcularPrenomina([jornada("t9", "Nuevo", 300)], tarifas);
    expect(p.renglones[0]!.sueldo).toBe(CERO);
    expect(p.renglones[0]!.sinTarifa).toBe(true);
    expect(p.sin_tarifa).toBe(1);
  });

  /*
   * Un turno sin salida mide "hasta ahora", así que sus horas están infladas.
   * NO se corrige solo -el software no sabe a qué hora se fue esa persona-:
   * se paga lo que marca y se señala para que alguien lo revise.
   */
  it("un turno sin cerrar se señala en vez de corregirse solo", () => {
    const p = calcularPrenomina([jornada("t1", "Lucía", 900, CERO, true)], tarifas);
    expect(p.turnos_abiertos).toBe(1);
    expect(p.renglones[0]!.turnoAbierto).toBe(true);
    expect(p.renglones[0]!.sueldo).toBe(pesos(750)); // 15 h: se paga, pero avisando
  });
});

// --- Propinas -----------------------------------------------------------------------------

describe("propina directa", () => {
  it("cada quien se queda la de sus mesas", () => {
    const p = calcularPrenomina(
      [jornada("t1", "Lucía", 480, pesos(300)), jornada("t2", "Marco", 480, pesos(100))],
      new Map(),
      { modoPropina: "directo" },
    );

    expect(p.renglones.find((r) => r.trabajador_id === "t1")!.propinas).toBe(pesos(300));
    expect(p.renglones.find((r) => r.trabajador_id === "t2")!.propinas).toBe(pesos(100));
    expect(p.total_propinas).toBe(pesos(400));
  });
});

describe("fondo común por horas", () => {
  it("reparte a prorrata de las horas trabajadas", () => {
    // Fondo de $400. Lucía 8 h, Marco 4 h, Cocinero 4 h -> 8/16, 4/16, 4/16.
    const p = calcularPrenomina(
      [
        jornada("t1", "Lucía", 480, pesos(400)),
        jornada("t2", "Marco", 240),
        jornada("t3", "Cocinero", 240),
      ],
      new Map(),
      { modoPropina: "fondo_por_horas" },
    );

    expect(p.renglones.find((r) => r.trabajador_id === "t1")!.propinas).toBe(pesos(200));
    expect(p.renglones.find((r) => r.trabajador_id === "t2")!.propinas).toBe(pesos(100));
    // Cocina entra al reparto aunque no tenga mesas propias.
    expect(p.renglones.find((r) => r.trabajador_id === "t3")!.propinas).toBe(pesos(100));
  });

  it("el fondo cuadra al centavo aunque no dé exacto", () => {
    // $100 entre tres jornadas iguales: 3333.33… No se puede partir exacto.
    const p = calcularPrenomina(
      [
        jornada("t1", "A", 60, pesos(100)),
        jornada("t2", "B", 60),
        jornada("t3", "C", 60),
      ],
      new Map(),
      { modoPropina: "fondo_por_horas" },
    );

    expect(p.total_propinas).toBe(pesos(100));
    expect(sumar(...p.renglones.map((r) => r.propinas))).toBe(pesos(100));
  });

  it("si nadie registró horas, el fondo se parte en partes iguales", () => {
    const p = calcularPrenomina(
      [jornada("t1", "A", 0, pesos(90)), jornada("t2", "B", 0)],
      new Map(),
      { modoPropina: "fondo_por_horas" },
    );
    expect(p.total_propinas).toBe(pesos(90));
    expect(p.renglones.every((r) => r.propinas === pesos(45))).toBe(true);
  });
});

// --- Totales ------------------------------------------------------------------------------

describe("totales del periodo", () => {
  it("suma sueldos y propinas, y ordena por lo que se le paga a cada quien", () => {
    const tarifas = new Map([
      ["t1", pesos(50)],
      ["t2", pesos(60)],
    ]);
    const p = calcularPrenomina(
      [jornada("t1", "Lucía", 480, pesos(300)), jornada("t2", "Marco", 480, pesos(50))],
      tarifas,
      { modoPropina: "directo" },
    );

    // Lucía 400 + 300 = 700; Marco 480 + 50 = 530.
    expect(p.renglones.map((r) => r.nombre)).toEqual(["Lucía", "Marco"]);
    expect(p.total_sueldos).toBe(pesos(880));
    expect(p.total_propinas).toBe(pesos(350));
    expect(p.total).toBe(pesos(1230));
  });

  it("sin jornadas responde en ceros", () => {
    const p = calcularPrenomina([], new Map());
    expect(p.renglones).toEqual([]);
    expect(p.total).toBe(CERO);
  });
});

// --- Periodo de la raya --------------------------------------------------------------------

describe("semanaDe", () => {
  it("arranca en lunes, para no partir el fin de semana", () => {
    // Miércoles 22-jul-2026.
    const r = semanaDe(new Date(2026, 6, 22, 15).getTime());
    expect(new Date(r.desde).getDay()).toBe(1); // lunes
    expect(new Date(r.desde).getDate()).toBe(20);
    // El domingo 26 cae dentro; el lunes 27 ya no.
    expect(new Date(2026, 6, 26, 23).getTime()).toBeLessThan(r.hasta);
    expect(new Date(2026, 6, 27, 0).getTime()).toBeGreaterThanOrEqual(r.hasta);
  });

  it("un domingo pertenece a la semana que empezó el lunes anterior", () => {
    const r = semanaDe(new Date(2026, 6, 26, 21).getTime()); // domingo
    expect(new Date(r.desde).getDate()).toBe(20); // lunes 20
  });
});
