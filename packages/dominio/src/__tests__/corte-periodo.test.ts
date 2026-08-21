/**
 * El corte de varios turnos: un día pasado, o los últimos tres.
 *
 * Lo que importa probar es que SUMA y no recalcula —el corte del período y el
 * del turno tienen que decir lo mismo— y que un turno todavía abierto no
 * envenene el arqueo. Un corte que inventa un faltante de miles de pesos es una
 * acusación de robo contra el cajero.
 */
import { describe, expect, it } from "vitest";
import { pesos, sumar, CERO, type Centavos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { EventoCaja } from "../caja/eventos.js";
import { calcularCorte, proyectarCaja, type EstadoCaja } from "../caja/reducers.js";
import {
  consolidarCortes,
  folioDeSesion,
  turnoEnRango,
  type TurnoDelPeriodo,
} from "../caja/corte-periodo.js";
import type { RegistroEgreso } from "../finanzas/egresos.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-cajero", sucursal_id: "suc-1" };
const caja = () => new FabricaEventos<EventoCaja>(CTX);
const comanda = () => new FabricaEventos<EventoComanda>(CTX);

const DIA = 86_400_000;

/** Un turno completo: abre con fondo, cobra en efectivo y transferencia, cierra. */
function turno(
  id: string,
  fondo: number,
  efectivo: number,
  transferencia: number,
  opciones: { declarado?: number; ts?: number; cerrar?: boolean } = {},
): TurnoDelPeriodo {
  const cerrar = opciones.cerrar ?? true;
  const eventos: EventoCaja[] = [
    { ...caja().crear("caja_abierta", id, { sesion_id: id, cajero_id: "usr-cajero", fondo_inicial: pesos(fondo) }), ts: opciones.ts ?? Date.now() },
  ];

  const pagos: EventoComanda[] = [];
  if (efectivo > 0) {
    pagos.push(comanda().crear("pago_registrado", `ord-${id}-1`, {
      orden_id: `ord-${id}-1`, forma: "efectivo", monto: pesos(efectivo),
    }) as EventoComanda);
    pagos.push(comanda().crear("cuenta_cerrada", `ord-${id}-1`, { orden_id: `ord-${id}-1` }) as EventoComanda);
  }
  if (transferencia > 0) {
    pagos.push(comanda().crear("pago_registrado", `ord-${id}-2`, {
      orden_id: `ord-${id}-2`, forma: "transferencia", monto: pesos(transferencia),
    }) as EventoComanda);
    pagos.push(comanda().crear("cuenta_cerrada", `ord-${id}-2`, { orden_id: `ord-${id}-2` }) as EventoComanda);
  }

  if (cerrar) {
    const declarado = pesos(opciones.declarado ?? fondo + efectivo);
    eventos.push({ ...caja().crear("arqueo_registrado", id, { sesion_id: id, declarado }), ts: (opciones.ts ?? Date.now()) + 1 });
  }

  const sesion = proyectarCaja(eventos) as EstadoCaja;
  const corte = calcularCorte(sesion, pagos);

  if (cerrar) {
    const declarado = pesos(opciones.declarado ?? fondo + efectivo);
    const diferencia = (declarado - corte.efectivoEsperado) as Centavos;
    return {
      sesion: { ...sesion, cerrada: true, cerrada_ts: (opciones.ts ?? Date.now()) + 2, declarado, diferencia },
      corte,
    };
  }
  return { sesion, corte };
}

const SIN_GASTOS: RegistroEgreso[] = [];
const RANGO = { desde: 0, hasta: Number.MAX_SAFE_INTEGER };

describe("suma de turnos", () => {
  it("un solo turno da exactamente lo que dio su propio corte", () => {
    const t = turno("s1", 1500, 3000, 500);
    const p = consolidarCortes([t], SIN_GASTOS, RANGO);

    expect(p.fondo_inicial).toBe(pesos(1500));
    expect(p.total_vendido).toBe(t.corte.totalVendido);
    expect(p.efectivo_esperado).toBe(t.corte.efectivoEsperado);
    expect(p.cuentas_cerradas).toBe(t.corte.cuentasCerradas);
  });

  it("dos turnos suman fondos, ventas y transacciones", () => {
    const a = turno("s1", 1000, 2000, 300);
    const b = turno("s2", 1500, 4000, 700);
    const p = consolidarCortes([a, b], SIN_GASTOS, RANGO);

    expect(p.fondo_inicial).toBe(pesos(2500));
    expect(p.total_vendido).toBe(sumar(a.corte.totalVendido, b.corte.totalVendido));
    expect(p.cuentas_cerradas).toBe(a.corte.cuentasCerradas + b.corte.cuentasCerradas);
    expect(p.turnos).toHaveLength(2);
  });

  it("separa lo que entró por efectivo de lo que entró por transferencia", () => {
    const p = consolidarCortes([turno("s1", 0, 2000, 800)], SIN_GASTOS, RANGO);
    expect(p.cobrado_por_forma.efectivo).toBe(pesos(2000));
    expect(p.cobrado_por_forma.transferencia).toBe(pesos(800));
  });

  it("acumula la misma forma de pago a través de varios turnos", () => {
    const p = consolidarCortes(
      [turno("s1", 0, 1000, 0), turno("s2", 0, 2500, 0)],
      SIN_GASTOS,
      RANGO,
    );
    expect(p.cobrado_por_forma.efectivo).toBe(pesos(3500));
  });

  it("sin turnos, todo en cero y sin inventar nada", () => {
    const p = consolidarCortes([], SIN_GASTOS, RANGO);
    expect(p.total_vendido).toBe(CERO);
    expect(p.fondo_inicial).toBe(CERO);
    expect(p.cuentas_cerradas).toBe(0);
    expect(p.turnos).toEqual([]);
    expect(p.diferencia).toBe(CERO);
  });
});

describe("el turno todavía abierto", () => {
  /*
   * LA PRUEBA QUE PROTEGE AL CAJERO.
   *
   * Un turno abierto no tiene declarado. Si se contara como cero, todo el
   * efectivo del turno en curso saldría como faltante y el papel acusaría de un
   * robo que no existe.
   */
  it("no aporta al arqueo ni inventa un faltante", () => {
    const cerrado = turno("s1", 1000, 2000, 0, { declarado: 3000 });
    const abierto = turno("s2", 1000, 5000, 0, { cerrar: false });
    const p = consolidarCortes([cerrado, abierto], SIN_GASTOS, RANGO);

    // Solo el turno cerrado declaró.
    expect(p.declarado).toBe(pesos(3000));
    expect(p.diferencia).toBe(CERO);
    expect(p.turnos_abiertos).toBe(1);
  });

  it("pero su venta sí cuenta: es dinero que entró", () => {
    const abierto = turno("s2", 0, 5000, 0, { cerrar: false });
    const p = consolidarCortes([abierto], SIN_GASTOS, RANGO);
    expect(p.cobrado_por_forma.efectivo).toBe(pesos(5000));
    expect(p.turnos_abiertos).toBe(1);
  });
});

describe("gastos y movimientos", () => {
  it("agrupa los gastos por categoría y los suma", () => {
    const egresos = [
      { id: "e1", categoria: "nomina", nombre: "", monto: pesos(1200), ts: 1, anulado: false },
      { id: "e2", categoria: "nomina", nombre: "", monto: pesos(800), ts: 2, anulado: false },
      { id: "e3", categoria: "renta", nombre: "", monto: pesos(5000), ts: 3, anulado: false },
    ] as unknown as RegistroEgreso[];

    const p = consolidarCortes([turno("s1", 0, 100, 0)], egresos, RANGO);
    const nomina = p.gastos.find((g) => g.categoria === "nomina");

    expect(nomina?.monto).toBe(pesos(2000));
    expect(p.total_gastos).toBe(pesos(7000));
  });

  it("una categoría sin gasto no aparece en el papel", () => {
    const p = consolidarCortes([turno("s1", 0, 100, 0)], SIN_GASTOS, RANGO);
    expect(p.gastos).toEqual([]);
    expect(p.total_gastos).toBe(CERO);
  });
});

describe("qué turno entra en el rango", () => {
  const ayer = Date.now() - DIA;

  it("se decide por la apertura, no por el cierre", () => {
    // Un turno que abre el viernes 20:00 y cierra el sábado 02:00 es del viernes.
    const sesion = {
      abierta_ts: ayer,
      cerrada_ts: ayer + 6 * 3_600_000,
    } as EstadoCaja;

    expect(turnoEnRango(sesion, ayer - 1000, ayer + 1000)).toBe(true);
    // El rango del día siguiente NO lo reclama, aunque cerrara dentro.
    expect(turnoEnRango(sesion, ayer + 2000, ayer + DIA)).toBe(false);
  });

  it("el límite superior es exclusivo: un turno no cae en dos días", () => {
    const sesion = { abierta_ts: 1000 } as EstadoCaja;
    expect(turnoEnRango(sesion, 0, 1000)).toBe(false);
    expect(turnoEnRango(sesion, 1000, 2000)).toBe(true);
  });
});

describe("el folio", () => {
  it("es el mismo que imprime el corte del turno", () => {
    // Ocho caracteres en mayúscula: lo que `cerrar()` pone en el papel.
    expect(folioDeSesion("019ff411-e6aa-7aac-bb99-c701f36a479f")).toBe("019FF411");
  });
});
