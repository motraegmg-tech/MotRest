/**
 * Reservas y lista de espera.
 *
 * Lo que hay que probar es lo que le cuesta clientes a un restaurante: que un
 * choque de mesas se avise ANTES de anotarlo, que una reserva que ya comió no
 * se pueda cancelar, y que la espera que se promete en la puerta salga de
 * cuánto dura de verdad una mesa en ESTE local — no de un número inventado que
 * después se incumple.
 */
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../comun/ids.js";
import { FabricaEventos } from "../evento.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import {
  DURACION_RESERVA_MIN,
  choquesDeMesa,
  esperaEstimada,
  proyectarReservas,
  reservasEnPuerta,
  reservasVigentes,
  rotacionObservada,
  type EventoReserva,
} from "../clientes/reservas.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const STREAM = "reservas:suc-1";
const MIN = 60_000;

/** Viernes 24-jul-2026, 21:00 — la hora pico de Rodizio. */
const VIERNES_21 = new Date(2026, 6, 24, 21, 0).getTime();

const f = () => new FabricaEventos<EventoReserva>(CTX);

function apartar(opciones: {
  id?: string;
  nombre?: string;
  personas?: number;
  para_ts?: number;
  mesa_id?: string;
  duracion_min?: number;
}): EventoReserva {
  return f().crear("reserva_creada", STREAM, {
    reserva_id: opciones.id ?? uuidv7(),
    nombre: opciones.nombre ?? "Familia Ramírez",
    personas: opciones.personas ?? 4,
    para_ts: opciones.para_ts ?? VIERNES_21,
    mesa_id: opciones.mesa_id,
    duracion_min: opciones.duracion_min,
  });
}

// --- El ciclo de una reserva -------------------------------------------------------------

describe("el ciclo de una reserva", () => {
  it("nace apartada y con la duración por defecto", () => {
    const [r] = proyectarReservas([apartar({ mesa_id: "mesa-5" })]);
    expect(r!.estado).toBe("apartada");
    expect(r!.duracion_min).toBe(DURACION_RESERVA_MIN);
  });

  it("al sentarse guarda la mesa y la hora real", () => {
    const id = uuidv7();
    const sentar = f().crear("reserva_sentada", STREAM, { reserva_id: id, mesa_id: "mesa-9" });
    const [r] = proyectarReservas([apartar({ id, mesa_id: "mesa-5" }), sentar]);

    expect(r!.estado).toBe("sentada");
    // Se quedaron en otra mesa: manda la de verdad, no la que se apartó.
    expect(r!.mesa_id).toBe("mesa-9");
    expect(r!.sentada_ts).toBeGreaterThan(0);
  });

  /*
   * Distinguir "avisó" de "no llegó" es el dato caro: con el segundo se decide
   * a quién se le vuelve a apartar mesa un viernes.
   */
  it("cancelar y no llegar son cosas distintas", () => {
    const a = uuidv7();
    const b = uuidv7();
    const reservas = proyectarReservas([
      apartar({ id: a, para_ts: VIERNES_21 }),
      apartar({ id: b, para_ts: VIERNES_21 + 30 * MIN }),
      f().crear("reserva_cancelada", STREAM, { reserva_id: a, motivo: "Les surgió algo" }),
      f().crear("reserva_no_llego", STREAM, { reserva_id: b }),
    ]);

    expect(reservas.find((r) => r.id === a)!.estado).toBe("cancelada");
    expect(reservas.find((r) => r.id === a)!.motivo_cancelacion).toBe("Les surgió algo");
    expect(reservas.find((r) => r.id === b)!.estado).toBe("no_llego");
    expect(reservasVigentes(reservas)).toEqual([]);
  });

  it("una reserva que ya comió no se puede cancelar", () => {
    const id = uuidv7();
    const [r] = proyectarReservas([
      apartar({ id }),
      f().crear("reserva_sentada", STREAM, { reserva_id: id, mesa_id: "mesa-5" }),
      f().crear("reserva_cancelada", STREAM, { reserva_id: id, motivo: "error de dedo" }),
    ]);
    expect(r!.estado).toBe("sentada");
  });

  /* Una resincronización puede reenviar la creación: no debe resucitar nada. */
  it("reenviar la creación no revive una cancelada", () => {
    const id = uuidv7();
    const creacion = apartar({ id });
    const [r] = proyectarReservas([
      creacion,
      f().crear("reserva_cancelada", STREAM, { reserva_id: id, motivo: "x" }),
      creacion,
    ]);
    expect(r!.estado).toBe("cancelada");
  });

  it("un evento de una reserva que no existe se ignora", () => {
    const huerfano = f().crear("reserva_sentada", STREAM, {
      reserva_id: uuidv7(), mesa_id: "mesa-1",
    });
    expect(proyectarReservas([huerfano])).toEqual([]);
  });
});

// --- Choques ------------------------------------------------------------------------------

describe("dos reservas en la misma mesa", () => {
  const reservas = () =>
    proyectarReservas([apartar({ mesa_id: "mesa-5", para_ts: VIERNES_21, duracion_min: 90 })]);

  it("avisa cuando la franja se encima", () => {
    // 22:00 cae dentro de los 90 min que arrancaron a las 21:00.
    const c = choquesDeMesa(reservas(), "mesa-5", VIERNES_21 + 60 * MIN);
    expect(c).toHaveLength(1);
    expect(c[0]!.minutos_encimados).toBe(30);
  });

  it("no avisa si la mesa se libera justo antes", () => {
    // 22:30 es exactamente cuando termina la anterior.
    expect(choquesDeMesa(reservas(), "mesa-5", VIERNES_21 + 90 * MIN)).toEqual([]);
  });

  it("otra mesa a la misma hora no choca", () => {
    expect(choquesDeMesa(reservas(), "mesa-7", VIERNES_21)).toEqual([]);
  });

  /* Al EDITAR una reserva, esa misma no puede chocar consigo misma. */
  it("una reserva no choca consigo misma al reprogramarla", () => {
    const id = uuidv7();
    const rs = proyectarReservas([apartar({ id, mesa_id: "mesa-5", para_ts: VIERNES_21 })]);
    expect(choquesDeMesa(rs, "mesa-5", VIERNES_21, 90, id)).toEqual([]);
  });

  it("una reserva cancelada deja de estorbar", () => {
    const id = uuidv7();
    const rs = proyectarReservas([
      apartar({ id, mesa_id: "mesa-5", para_ts: VIERNES_21 }),
      f().crear("reserva_cancelada", STREAM, { reserva_id: id, motivo: "avisaron" }),
    ]);
    expect(choquesDeMesa(rs, "mesa-5", VIERNES_21)).toEqual([]);
  });
});

// --- La puerta ----------------------------------------------------------------------------

describe("quién está por llegar y quién se retrasó", () => {
  it("separa las que ya deberían estar aquí", () => {
    const rs = proyectarReservas([
      apartar({ nombre: "Puntual", para_ts: VIERNES_21 }),
      apartar({ nombre: "Tarde", para_ts: VIERNES_21 - 40 * MIN }),
    ]);

    const { esperando, retrasadas } = reservasEnPuerta(rs, VIERNES_21, 15);
    expect(esperando.map((r) => r.nombre)).toEqual(["Puntual"]);
    expect(retrasadas.map((r) => r.nombre)).toEqual(["Tarde"]);
  });

  /*
   * Nadie se marca como plantado solo. Liberar una mesa es decisión de quien
   * está en la puerta: el reloj no sabe que vienen llegando.
   */
  it("una retrasada sigue apartada hasta que alguien decida", () => {
    const rs = proyectarReservas([apartar({ para_ts: VIERNES_21 - 60 * MIN })]);
    expect(reservasEnPuerta(rs, VIERNES_21).retrasadas[0]!.estado).toBe("apartada");
  });
});

// --- Cuánto dura de verdad una mesa --------------------------------------------------------

function sentada(minutos: number): EstadoComanda {
  return {
    orden_id: uuidv7(), mesa_id: "mesa-1", mesero_id: "usr-lucia",
    abierta_ts: VIERNES_21, cerrada: true, cerrada_ts: VIERNES_21 + minutos * MIN,
    renglones: [], pagos: [], descuentos: [], cortesias: [], propina: 0 as never,
  };
}

describe("la rotación real del local", () => {
  it("sin histórico suficiente lo dice, en vez de inventar", () => {
    const r = rotacionObservada([sentada(60), sentada(70)]);
    expect(r.confiable).toBe(false);
    expect(r.minutos_mediana).toBe(DURACION_RESERVA_MIN);
    expect(r.muestras).toBe(2);
  });

  /*
   * LA MEDIANA, NO EL PROMEDIO. Una mesa que se quedó cuatro horas celebrando
   * un cumpleaños arrastra el promedio y haría prometer esperas absurdas.
   */
  it("una sobremesa larguísima no contamina la estimación", () => {
    const normales = Array.from({ length: 14 }, () => sentada(60));
    const conFiesta = [...normales, sentada(300)];

    expect(rotacionObservada(conFiesta).minutos_mediana).toBe(60);
  });

  it("descarta las que no son sentadas de verdad", () => {
    // Abiertas por error y cerradas enseguida, y una que quedó abierta días.
    const basura = [...Array.from({ length: 12 }, () => sentada(75)), sentada(1), sentada(60 * 20)];
    const r = rotacionObservada(basura);
    expect(r.muestras).toBe(12);
    expect(r.minutos_mediana).toBe(75);
  });

  it("una cuenta abierta todavía no mide nada", () => {
    const abierta = { ...sentada(60), cerrada: false, cerrada_ts: undefined };
    expect(rotacionObservada([abierta]).muestras).toBe(0);
  });
});

// --- La espera que se promete en la puerta -------------------------------------------------

describe("cuánto tiene que esperar quien llega sin reserva", () => {
  const rotacion = { minutos_mediana: 90, muestras: 40, confiable: true };

  it("con mesa libre, pasan de inmediato", () => {
    const e = esperaEstimada({
      ocupadasDesde: [VIERNES_21], mesasLibres: 2, delante: 0, rotacion, ahora: VIERNES_21,
    });
    expect(e.minutos).toBe(0);
  });

  /* La mesa que lleva más rato es la primera en soltarse. */
  it("estima con la mesa que lleva más tiempo ocupada", () => {
    const e = esperaEstimada({
      ocupadasDesde: [VIERNES_21 - 70 * MIN, VIERNES_21 - 10 * MIN],
      mesasLibres: 0, delante: 0, rotacion, ahora: VIERNES_21,
    });
    // A la de 70 min le faltan 20 de los 90 de rotación.
    expect(e.minutos).toBe(20);
  });

  it("quien está formado detrás espera la siguiente mesa", () => {
    const e = esperaEstimada({
      ocupadasDesde: [VIERNES_21 - 70 * MIN, VIERNES_21 - 50 * MIN],
      mesasLibres: 0, delante: 1, rotacion, ahora: VIERNES_21,
    });
    // El primero se lleva la de 20; a este le toca la de 40.
    expect(e.minutos).toBe(40);
  });

  /* Aunque la mesa ya se pasó de la rotación, hay que cobrar y limpiar. */
  it("nunca promete menos de cinco minutos", () => {
    const e = esperaEstimada({
      ocupadasDesde: [VIERNES_21 - 300 * MIN], mesasLibres: 0, delante: 0,
      rotacion, ahora: VIERNES_21,
    });
    expect(e.minutos).toBe(5);
  });

  it("sin histórico, la cifra se marca como no confiable", () => {
    const e = esperaEstimada({
      ocupadasDesde: [VIERNES_21], mesasLibres: 0, delante: 0,
      rotacion: { minutos_mediana: 90, muestras: 3, confiable: false }, ahora: VIERNES_21,
    });
    expect(e.confiable).toBe(false);
  });
});
