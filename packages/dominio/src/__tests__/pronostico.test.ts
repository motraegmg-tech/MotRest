/**
 * Pronóstico de demanda (C3): aprender el patrón del local y proyectarlo.
 *
 * Lo que importa probar: que el viernes y el martes NO se promedian juntos, que
 * la confianza crece con las semanas observadas, que el pico de hora sale del
 * dato real, y que un día sin historia se proyecta en cero sin reventar.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { FabricaEventos } from "../evento.js";
import { pronosticoDemanda } from "../inteligencia/pronostico.js";

const HORA = 3600_000;

function renglon(precio: number, cantidad = 1): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "prod-pizza", descripcion: "Pizza", cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(60),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

function cuenta(cerrada_ts: number, precio: number, cantidad = 1): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>({ device_id: "d1", empleado_id: "e1", sucursal_id: "s1" });
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: cerrada_ts - HORA }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon(precio, cantidad) }),
  ];
  const cierre = f.crear("cuenta_cerrada", orden_id, { orden_id });
  (cierre as { ts: number }).ts = cerrada_ts;
  eventos.push(cierre);
  return proyectarComanda(eventos);
}

/** 8 pm de una fecha dada, en hora local (como bucketea el dominio). */
const viernes = [
  new Date(2026, 0, 2, 20).getTime(), // vie 02-ene-2026
  new Date(2026, 0, 9, 20).getTime(), // vie 09
  new Date(2026, 0, 16, 20).getTime(), // vie 16
];
const lunes = [
  new Date(2026, 0, 5, 13).getTime(), // lun 05
  new Date(2026, 0, 12, 13).getTime(), // lun 12
];

function historia(): EstadoComanda[] {
  const cuentas: EstadoComanda[] = [];
  // Cada viernes: 3 cuentas grandes a las 8 pm.
  for (const v of viernes) {
    cuentas.push(cuenta(v, 249, 2), cuenta(v, 249, 2), cuenta(v + HORA, 180));
  }
  // Cada lunes: 1 cuenta chica a la 1 pm.
  for (const l of lunes) {
    cuentas.push(cuenta(l, 120));
  }
  return cuentas;
}

describe("patrón semanal", () => {
  it("no mezcla el viernes con el lunes", () => {
    const { patron } = pronosticoDemanda(historia());
    const vie = patron.find((p) => p.dia_semana === 5)!;
    const lun = patron.find((p) => p.dia_semana === 1)!;

    expect(vie.cuentas_prom).toBe(3);
    expect(lun.cuentas_prom).toBe(1);
    expect(vie.venta_prom).toBeGreaterThan(lun.venta_prom);
  });

  it("la confianza crece con las semanas vistas", () => {
    const { patron } = pronosticoDemanda(historia());
    // 3 viernes observados -> alta; 2 lunes -> media.
    expect(patron.find((p) => p.dia_semana === 5)!.confianza).toBe("alta");
    expect(patron.find((p) => p.dia_semana === 1)!.confianza).toBe("media");
  });

  it("el pico de hora sale del dato real", () => {
    const { patron } = pronosticoDemanda(historia());
    // El viernes concentra la venta a las 20 h (dos cuentas grandes vs. una a las 21).
    expect(patron.find((p) => p.dia_semana === 5)!.hora_pico).toBe(20);
    expect(patron.find((p) => p.dia_semana === 1)!.hora_pico).toBe(13);
  });
});

describe("proyección", () => {
  it("proyecta el próximo viernes con el promedio de los viernes", () => {
    // Parada un lunes (19-ene-2026): el viernes cae en el índice 4.
    const ahora = new Date(2026, 0, 19, 9).getTime();
    const { proximos } = pronosticoDemanda(historia(), { ahora, dias: 7 });

    const vie = proximos.find((p) => p.dia_semana === 5)!;
    expect(vie.cuentas_esperadas).toBe(3);
    expect(vie.confianza).toBe("alta");
    expect(new Date(vie.fecha).getDate()).toBe(23); // vie 23-ene
  });

  it("un día sin historia se proyecta en cero, sin reventar", () => {
    const ahora = new Date(2026, 0, 19, 9).getTime();
    const { proximos } = pronosticoDemanda(historia(), { ahora, dias: 7 });
    // El miércoles nunca se observó.
    const mie = proximos.find((p) => p.dia_semana === 3)!;
    expect(mie.cuentas_esperadas).toBe(0);
    expect(mie.venta_esperada).toBe(pesos(0));
    expect(mie.confianza).toBe("baja");
  });

  it("cuenta los días observados y sabe si aún no hay una semana", () => {
    const r = pronosticoDemanda(historia());
    expect(r.dias_observados).toBe(5); // 3 viernes + 2 lunes
    expect(r.listo).toBe(false); // faltan días para una semana completa
  });

  it("sin historia, no pronostica nada pero responde", () => {
    const r = pronosticoDemanda([], { ahora: new Date(2026, 0, 19).getTime(), dias: 3 });
    expect(r.patron).toEqual([]);
    expect(r.proximos).toHaveLength(3);
    expect(r.proximos.every((p) => p.cuentas_esperadas === 0)).toBe(true);
  });
});

// --- El servicio que cruza la medianoche ---------------------------------------------------

describe("la jornada, no el día natural", () => {
  /*
   * El caso de Rodizio: el viernes se sirve hasta la una de la madrugada.
   * Agrupando por día natural, esas cuentas caerían en sábado y el pronóstico
   * aprendería un patrón falso —viernes flojo, sábado con pico de madrugada—.
   */
  function nocheDeViernes(): EstadoComanda[] {
    return [
      cuenta(new Date(2026, 0, 2, 22).getTime(), 249, 2), // viernes 10 pm
      cuenta(new Date(2026, 0, 3, 0, 30).getTime(), 249, 2), // sábado 00:30
      cuenta(new Date(2026, 0, 3, 1, 15).getTime(), 180), // sábado 01:15
    ];
  }

  it("las tres cuentas cuentan como UN viernes", () => {
    const { patron } = pronosticoDemanda(nocheDeViernes());

    expect(patron).toHaveLength(1);
    const vie = patron[0]!;
    expect(vie.dia_semana).toBe(5); // viernes
    expect(vie.cuentas_prom).toBe(3);
    expect(vie.servicios).toBe(1); // una sola jornada, no dos
  });

  it("no le inventa al sábado un pico de madrugada", () => {
    const { patron } = pronosticoDemanda(nocheDeViernes());
    expect(patron.find((p) => p.dia_semana === 6)).toBeUndefined();
  });

  it("con corte a medianoche vuelve a partirse en dos, como antes", () => {
    const { patron } = pronosticoDemanda(nocheDeViernes(), { horaCorte: 0 });
    expect(patron.map((p) => p.dia_semana).sort()).toEqual([5, 6]);
  });
});
