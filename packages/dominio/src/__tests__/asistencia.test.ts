import { describe, expect, it } from "vitest";
import { FabricaEventos } from "../evento.js";
import {
  checadasDe,
  estaDentro,
  formatearJornada,
  resumenAsistencia,
  siguienteChecada,
  streamAsistencia,
  turnosDe,
  type EventoAsistencia,
  type TipoChecada,
} from "../personal/asistencia.js";

const CTX = { device_id: "dev-1", empleado_id: "emp-lucia", sucursal_id: "suc-1" };
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const T0 = new Date(2026, 6, 22, 9, 0).getTime(); // 22-jul-2026, 9:00

function checar(
  f: FabricaEventos<EventoAsistencia>,
  trabajador: string,
  tipo: TipoChecada,
  momento: number,
  extra: { autorizador_id?: string; motivo?: string } = {},
): EventoAsistencia {
  return f.crear("checada_registrada", streamAsistencia(trabajador), {
    trabajador_id: trabajador,
    checada: tipo,
    momento,
    ...extra,
  });
}

function fabrica() {
  return new FabricaEventos<EventoAsistencia>(CTX);
}

/** Jornada completa: 9:00 entra, 14:00-14:30 come, 17:00 sale. */
function jornadaCompleta(): EventoAsistencia[] {
  const f = fabrica();
  return [
    checar(f, "emp-lucia", "entrada", T0),
    checar(f, "emp-lucia", "inicio_descanso", T0 + 5 * HORA),
    checar(f, "emp-lucia", "fin_descanso", T0 + 5 * HORA + 30 * MINUTO),
    checar(f, "emp-lucia", "salida", T0 + 8 * HORA),
  ];
}

describe("qué toca checar", () => {
  it("quien no ha checado nada, entra", () => {
    expect(siguienteChecada([])).toBe("entrada");
  });

  it("después de entrar, toca salir", () => {
    const c = checadasDe([checar(fabrica(), "emp-lucia", "entrada", T0)]);
    expect(siguienteChecada(c)).toBe("salida");
    expect(estaDentro(c)).toBe(true);
  });

  it("en descanso, toca regresar", () => {
    const f = fabrica();
    const c = checadasDe([
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-lucia", "inicio_descanso", T0 + HORA),
    ]);
    expect(siguienteChecada(c)).toBe("fin_descanso");
    // De descanso no cuenta como estar trabajando.
    expect(estaDentro(c)).toBe(false);
  });

  it("después de salir, el siguiente ciclo vuelve a empezar", () => {
    const c = checadasDe(jornadaCompleta());
    expect(siguienteChecada(c)).toBe("entrada");
    expect(estaDentro(c)).toBe(false);
  });
});

describe("turnos", () => {
  it("descuenta el descanso de las horas trabajadas", () => {
    const turnos = turnosDe(checadasDe(jornadaCompleta()), T0 + 9 * HORA);
    expect(turnos).toHaveLength(1);
    expect(turnos[0]!.descanso).toBe(30);
    // 8 h de presencia − 30 min de comida = 7 h 30 min.
    expect(turnos[0]!.minutos).toBe(450);
    expect(turnos[0]!.abierto).toBe(false);
  });

  it("un turno sin salida sigue corriendo hasta ahora, y queda marcado", () => {
    const c = checadasDe([checar(fabrica(), "emp-lucia", "entrada", T0)]);
    const turnos = turnosDe(c, T0 + 3 * HORA);
    expect(turnos[0]!.abierto).toBe(true);
    expect(turnos[0]!.minutos).toBe(180);
  });

  it("un descanso sin cerrar se corta con la salida, no se pierde", () => {
    const f = fabrica();
    const c = checadasDe([
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-lucia", "inicio_descanso", T0 + 4 * HORA),
      checar(f, "emp-lucia", "salida", T0 + 5 * HORA),
    ]);
    const turnos = turnosDe(c, T0 + 6 * HORA);
    expect(turnos[0]!.descanso).toBe(60);
    expect(turnos[0]!.minutos).toBe(240);
  });

  it("entrar dos veces sin salir cierra el turno anterior como abierto", () => {
    const f = fabrica();
    const c = checadasDe([
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-lucia", "entrada", T0 + 24 * HORA),
    ]);
    const turnos = turnosDe(c, T0 + 26 * HORA);
    expect(turnos).toHaveLength(2);
    expect(turnos[0]!.abierto).toBe(true);
    expect(turnos[1]!.abierto).toBe(true);
  });

  it("dos jornadas seguidas dan dos turnos cerrados", () => {
    const f = fabrica();
    const c = checadasDe([
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-lucia", "salida", T0 + 8 * HORA),
      checar(f, "emp-lucia", "entrada", T0 + 24 * HORA),
      checar(f, "emp-lucia", "salida", T0 + 32 * HORA),
    ]);
    const turnos = turnosDe(c, T0 + 33 * HORA);
    expect(turnos).toHaveLength(2);
    expect(turnos.every((t) => !t.abierto)).toBe(true);
    expect(turnos.reduce((n, t) => n + t.minutos, 0)).toBe(960);
  });

  it("sin checadas no hay turnos", () => {
    expect(turnosDe([], T0)).toEqual([]);
  });
});

describe("corrección de checadas", () => {
  it("una corrección NO edita el hecho: agrega otro con su autorizador", () => {
    const f = fabrica();
    const eventos = [
      checar(f, "emp-lucia", "entrada", T0),
      // Olvidó checar la salida; el gerente la registra al día siguiente.
      checar(f, "emp-lucia", "salida", T0 + 8 * HORA, {
        autorizador_id: "emp-marco",
        motivo: "Olvidó checar salida",
      }),
    ];

    const checadas = checadasDe(eventos);
    expect(checadas).toHaveLength(2);
    expect(checadas[0]!.corregida).toBe(false);
    expect(checadas[1]!.corregida).toBe(true);
    expect(checadas[1]!.autorizador_id).toBe("emp-marco");
  });

  it("se ordena por el momento efectivo, no por cuándo se capturó", () => {
    const f = fabrica();
    // La salida se captura DESPUÉS pero con un momento ANTERIOR a otra marca.
    const eventos = [
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-lucia", "entrada", T0 + 24 * HORA),
      checar(f, "emp-lucia", "salida", T0 + 8 * HORA, { autorizador_id: "emp-marco" }),
    ];
    const momentos = checadasDe(eventos).map((c) => c.momento);
    expect(momentos).toEqual([T0, T0 + 8 * HORA, T0 + 24 * HORA]);

    // Con el orden correcto, el primer turno queda bien cerrado.
    const turnos = turnosDe(checadasDe(eventos), T0 + 25 * HORA);
    expect(turnos[0]!.abierto).toBe(false);
    expect(turnos[0]!.minutos).toBe(480);
  });
});

describe("el checador compartido no confunde a quién pertenece la jornada", () => {
  /**
   * Regresión. El sobre del evento trae `empleado_id` = quien lo emitió, y la
   * fábrica lo aplica DESPUÉS de los datos. Si la checada guardara su dueño con
   * ese mismo nombre, el sobre lo pisaría y en una tablet de entrada —una sola
   * sesión abierta— todas las checadas del turno se le cargarían a esa persona.
   */
  it("la checada es del trabajador, aunque la emita el dispositivo de otro", () => {
    const f = new FabricaEventos<EventoAsistencia>({
      ...CTX,
      empleado_id: "emp-recepcion", // la tablet de la entrada
    });
    const eventos = [
      checar(f, "emp-lucia", "entrada", T0),
      checar(f, "emp-marco", "entrada", T0 + 5 * MINUTO),
    ];

    expect(checadasDe(eventos, "emp-lucia")).toHaveLength(1);
    expect(checadasDe(eventos, "emp-marco")).toHaveLength(1);
    // Y queda registrado desde qué sesión se capturó.
    expect(checadasDe(eventos, "emp-lucia")[0]!.capturada_por).toBe("emp-recepcion");
  });

  it("una corrección distingue al trabajador de quien la captura", () => {
    const f = new FabricaEventos<EventoAsistencia>({ ...CTX, empleado_id: "emp-marco" });
    const [correccion] = checadasDe([
      checar(f, "emp-lucia", "salida", T0 + 8 * HORA, {
        autorizador_id: "emp-marco",
        motivo: "Olvidó checar salida",
      }),
    ]);

    expect(correccion!.trabajador_id).toBe("emp-lucia");
    expect(correccion!.capturada_por).toBe("emp-marco");
    expect(correccion!.corregida).toBe(true);
  });
});

describe("resumen por empleado", () => {
  it("separa a cada quien de los demás", () => {
    const f = fabrica();
    const eventos = [
      ...jornadaCompleta(),
      checar(f, "emp-marco", "entrada", T0 + HORA),
    ];

    const lucia = resumenAsistencia(eventos, "emp-lucia", T0 + 9 * HORA);
    expect(lucia.turnos).toBe(1);
    expect(lucia.minutos).toBe(450);
    expect(lucia.dentro).toBe(false);
    expect(lucia.turnoAbierto).toBe(false);

    const marco = resumenAsistencia(eventos, "emp-marco", T0 + 9 * HORA);
    expect(marco.turnos).toBe(1);
    expect(marco.dentro).toBe(true);
    expect(marco.turnoAbierto).toBe(true);
  });

  it("quien no ha checado nunca queda en ceros, sin romper", () => {
    const r = resumenAsistencia([], "emp-nuevo", T0);
    expect(r.turnos).toBe(0);
    expect(r.minutos).toBe(0);
    expect(r.dentro).toBe(false);
    expect(r.ultima).toBeUndefined();
  });
});

describe("formato de jornada", () => {
  it("se lee como se dice una jornada", () => {
    expect(formatearJornada(45)).toBe("45 min");
    expect(formatearJornada(60)).toBe("1 h");
    expect(formatearJornada(455)).toBe("7 h 35 min");
  });
});
