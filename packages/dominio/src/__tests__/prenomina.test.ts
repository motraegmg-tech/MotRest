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
import type {
  EventoPrenomina,
  JornadaTrabajador,
  SueldoSemanal,
} from "../personal/prenomina.js";
import type { DiaSemana } from "../personal/asignaciones.js";
import { semanaDe } from "../inteligencia/reportes.js";
import {
  calcularPrenomina,
  diasProgramados,
  sueldoSemanal,
  sueldosVigentes,
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

// --- Sueldo diario y faltas -----------------------------------------------------------------

/*
 * EL MODO QUE PIDIÓ GONZALO: sueldo pactado por día, y la falta se descuenta.
 *
 * Lo delicado aquí no es multiplicar: es NO descontar de más. Un día sin sueldo
 * pactado es descanso, y un día que todavía no ha llegado no es una falta. Las
 * dos cosas, mal resueltas, se traducen en dinero que alguien no cobra.
 */
describe("sueldo diario", () => {
  const LUN = 1;
  const MAR = 2;
  const MIE = 3;
  const SEMANA_COMPLETA: DiaSemana[] = [0, 1, 2, 3, 4, 5, 6];

  /** Lucía gana $400 de lunes a miércoles; jueves a domingo descansa. */
  const sueldos = new Map<string, SueldoSemanal>([
    ["t1", { 1: pesos(400), 2: pesos(400), 3: pesos(400) }],
  ]);

  const conDias = (dias: DiaSemana[], minutos = 480): JornadaTrabajador => ({
    ...jornada("t1", "Lucía", minutos),
    dias_asistidos: dias,
  });

  const calcular = (
    j: JornadaTrabajador,
    transcurridos: DiaSemana[] = SEMANA_COMPLETA,
  ) =>
    calcularPrenomina([j], new Map(), {
      modoSueldo: "por_dia",
      sueldos,
      diasTranscurridos: transcurridos,
    });

  it("una semana completa se paga entera", () => {
    const r = calcular(conDias([LUN, MAR, MIE])).renglones[0]!;
    expect(r.sueldo_programado).toBe(pesos(1200));
    expect(r.faltas).toEqual([]);
    expect(r.descuento_faltas).toBe(CERO);
    expect(r.sueldo).toBe(pesos(1200));
  });

  it("faltar un día programado descuenta EXACTAMENTE ese día", () => {
    const p = calcular(conDias([LUN, MIE]));
    const r = p.renglones[0]!;
    expect(r.faltas).toEqual([MAR]);
    expect(r.descuento_faltas).toBe(pesos(400));
    expect(r.sueldo).toBe(pesos(800));
    expect(p.faltas).toBe(1);
    expect(p.total_descuentos).toBe(pesos(400));
  });

  it("no venir en su día de descanso NO es una falta", () => {
    // Jueves a domingo no están pactados: no aparecen ni como programados.
    const r = calcular(conDias([LUN, MAR, MIE])).renglones[0]!;
    expect(r.dias_programados).toEqual([LUN, MAR, MIE]);
    expect(r.faltas).toEqual([]);
  });

  /*
   * El error más caro de este cálculo. Abrir la prenómina un martes contaba
   * como falta el miércoles que todavía no llega, y esa era la cifra que
   * acababa pagándose de menos.
   */
  it("un día que todavía no ha llegado no cuenta como falta", () => {
    const r = calcular(conDias([LUN, MAR]), [LUN, MAR]).renglones[0]!;
    expect(r.dias_programados).toEqual([LUN, MAR]);
    expect(r.faltas).toEqual([]);
    expect(r.sueldo).toBe(pesos(800));
  });

  it("sin saber qué días asistió, no se descuenta nada: no se cobra lo que no se puede probar", () => {
    const r = calcularPrenomina([jornada("t1", "Lucía", 480)], new Map(), {
      modoSueldo: "por_dia",
      sueldos,
    }).renglones[0]!;
    expect(r.faltas).toEqual([]);
    expect(r.sueldo).toBe(pesos(1200));
  });

  it("quien no vino ningún día sigue apareciendo, con su semana descontada", () => {
    const r = calcular(conDias([], 0)).renglones[0]!;
    expect(r.faltas).toEqual([LUN, MAR, MIE]);
    expect(r.sueldo).toBe(CERO);
    expect(r.descuento_faltas).toBe(pesos(1200));
  });

  it("sin sueldo capturado sale en cero y se señala, igual que sin tarifa", () => {
    const p = calcularPrenomina([conDias([LUN])], new Map(), {
      modoSueldo: "por_dia",
      sueldos: new Map(),
      diasTranscurridos: SEMANA_COMPLETA,
    });
    expect(p.renglones[0]!.sueldo).toBe(CERO);
    expect(p.renglones[0]!.sinTarifa).toBe(true);
    expect(p.sin_tarifa).toBe(1);
  });

  it("las propinas se suman igual que en el modo por hora", () => {
    const j = { ...conDias([LUN, MAR, MIE]), propinasPropias: pesos(250) };
    const r = calcular(j).renglones[0]!;
    expect(r.total).toBe(pesos(1450));
  });

  it("el modo por hora no gana campos de sueldo diario ni descuenta faltas", () => {
    const p = calcularPrenomina([conDias([LUN])], new Map([["t1", pesos(50)]]));
    expect(p.modo_sueldo).toBe("por_hora");
    expect(p.renglones[0]!.faltas).toEqual([]);
    expect(p.renglones[0]!.sueldo).toBe(pesos(400));
    expect(p.total_descuentos).toBe(CERO);
  });
});

describe("condiciones vigentes", () => {
  it("el último sueldo asignado es el que manda", () => {
    const f = fabrica();
    const sueldos = sueldosVigentes([
      f.crear("sueldo_diario_asignado", STREAM, {
        trabajador_id: "t1",
        sueldo_por_dia: { 1: pesos(300) },
      }),
      f.crear("sueldo_diario_asignado", STREAM, {
        trabajador_id: "t1",
        sueldo_por_dia: { 1: pesos(400), 2: pesos(400) },
        nota: "Aumento",
      }),
    ]);
    expect(sueldos.get("t1")).toEqual({ 1: pesos(400), 2: pesos(400) });
  });

  it("los dos tipos de evento conviven sin pisarse", () => {
    const f = fabrica();
    const eventos = [
      f.crear("tarifa_asignada", STREAM, { trabajador_id: "t1", tarifa_hora: pesos(50) }),
      f.crear("sueldo_diario_asignado", STREAM, {
        trabajador_id: "t1",
        sueldo_por_dia: { 5: pesos(600) },
      }),
    ];
    expect(tarifasVigentes(eventos).get("t1")).toBe(pesos(50));
    expect(sueldoSemanal(sueldosVigentes(eventos).get("t1") ?? {})).toBe(pesos(600));
  });

  it("los días programados son los que tienen sueldo, no los siete", () => {
    expect(diasProgramados({ 1: pesos(400), 5: pesos(600) })).toEqual([1, 5]);
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
