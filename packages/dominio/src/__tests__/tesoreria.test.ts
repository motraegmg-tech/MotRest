/**
 * El dinero del restaurante: los dos saldos y de dónde salen.
 *
 * Lo que hay que probar aquí es lo que Gonzalo señaló como roto: **que un gasto
 * baje el dinero**. Y su gemelo, que es peor si falla: que no lo baje dos veces.
 * Un saldo equivocado se convierte en una acusación contra quien cuenta el
 * cajón, así que cada renglón de esta suite responde a un error concreto que se
 * puede cometer.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { EventoCaja } from "../caja/eventos.js";
import { calcularCorte, proyectarCaja, proyectarSesiones } from "../caja/reducers.js";
import { proyectarComanda } from "../comanda/reducers.js";
import {
  aplicarEventoEgreso,
  cuentasPorPagar,
  deudaPorProveedor,
  egresosEn,
  egresosPagadosEn,
  proyectarEgresos,
  totalPorPagar,
  vencidas,
  type EventoEgreso,
  type RegistroEgreso,
} from "../finanzas/egresos.js";
import {
  arquear,
  cambioDisponible,
  cuentaDeFormaPago,
  esPagoEnEfectivo,
  movimientosDeTesoreria,
  saldosDe,
  totalDelConteo,
  type EventoTesoreria,
} from "../finanzas/tesoreria.js";
import { conSaldoArrastrado, flujoDeDinero, resumenDeFlujo, saldosDelRestaurante } from "../finanzas/flujo.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-gerente", sucursal_id: "suc-1" };

const fCaja = () => new FabricaEventos<EventoCaja>(CTX);
const fComanda = () => new FabricaEventos<EventoComanda>(CTX);
const fEgreso = () => new FabricaEventos<EventoEgreso>(CTX);
const fTesoreria = () => new FabricaEventos<EventoTesoreria>(CTX);

const DIA = 86_400_000;
const LUNES = new Date("2026-09-07T12:00:00Z").getTime();

/** Un gasto ya pagado, con la forma de pago que se le indique. */
function gasto(
  concepto: string,
  monto: number,
  forma: string,
  extra: Partial<Extract<EventoEgreso, { tipo: "egreso_registrado" }>> = {},
): RegistroEgreso {
  const ev = fEgreso().crear("egreso_registrado", "finanzas:suc-1", {
    egreso_id: `eg-${concepto}`,
    categoria: "servicios",
    concepto,
    monto: pesos(monto),
    forma_pago: forma,
    ...extra,
  });
  return aplicarEventoEgreso([], ev)[0]!;
}

// --- A qué cuenta va cada peso -----------------------------------------------------------

describe("efectivo o banco", () => {
  it("manda el efectivo al cajón y todo lo demás al banco", () => {
    expect(cuentaDeFormaPago("efectivo")).toBe("efectivo");
    expect(cuentaDeFormaPago("tarjeta_credito")).toBe("banco");
    expect(cuentaDeFormaPago("transferencia")).toBe("banco");
    expect(cuentaDeFormaPago("agregador")).toBe("banco");
  });

  it("no inventa una cuenta para una forma que no conoce: la trata como banco", () => {
    // Un dato viejo o de otra terminal no puede acabar sumando al cajón por
    // error: el cajón solo crece con lo que de verdad es efectivo.
    expect(cuentaDeFormaPago("criptomoneda")).toBe("banco");
    expect(esPagoEnEfectivo("criptomoneda")).toBe(false);
  });
});

// --- El agujero que se vino a tapar ------------------------------------------------------

describe("el gasto en efectivo baja lo que debe haber en el cajón", () => {
  const eventos: EventoCaja[] = [
    fCaja().crear("caja_abierta", "s1", {
      sesion_id: "s1",
      cajero_id: "usr-cajero",
      fondo_inicial: pesos(1500),
    }),
  ];

  const pagoEnEfectivo = fComanda().crear("pago_registrado", "ord-1", {
    orden_id: "ord-1",
    monto: pesos(800),
    forma: "efectivo",
  });

  it("resta el gasto pagado en efectivo", () => {
    const corte = calcularCorte(proyectarCaja(eventos)!, [pagoEnEfectivo], [
      gasto("Gas", 300, "efectivo"),
    ]);
    // 1500 de fondo + 800 de venta − 300 del gas
    expect(corte.efectivoEsperado).toBe(pesos(2000));
    expect(corte.gastosEfectivo).toBe(pesos(300));
    expect(corte.gastos).toHaveLength(1);
  });

  it("NO resta el gasto pagado por transferencia: ese salió del banco", () => {
    const corte = calcularCorte(proyectarCaja(eventos)!, [pagoEnEfectivo], [
      gasto("Renta", 20_000, "transferencia"),
    ]);
    expect(corte.efectivoEsperado).toBe(pesos(2300));
    expect(corte.gastosEfectivo).toBe(CERO);
  });

  it("ignora el gasto anulado: se capturó por error y no salió dinero", () => {
    const anulado = { ...gasto("Doble captura", 500, "efectivo"), anulado: true };
    const corte = calcularCorte(proyectarCaja(eventos)!, [pagoEnEfectivo], [anulado]);
    expect(corte.efectivoEsperado).toBe(pesos(2300));
  });

  it("sin gastos se comporta igual que antes", () => {
    // La firma cambió con un parámetro opcional: las llamadas viejas siguen
    // dando exactamente el mismo número.
    expect(calcularCorte(proyectarCaja(eventos)!, [pagoEnEfectivo]).efectivoEsperado).toBe(
      pesos(2300),
    );
  });
});

// --- Los dos saldos ----------------------------------------------------------------------

describe("saldos del restaurante", () => {
  const comandas = [proyectarComanda([
    fComanda().crear("orden_creada", "ord-1", {
      orden_id: "ord-1",
      mesa_id: "m1",
      abierta_ts: LUNES,
    }),
    fComanda().crear("pago_registrado", "ord-1", {
      orden_id: "ord-1",
      monto: pesos(600),
      forma: "efectivo",
    }),
    fComanda().crear("pago_registrado", "ord-1", {
      orden_id: "ord-1",
      monto: pesos(400),
      forma: "tarjeta_credito",
    }),
    fComanda().crear("cuenta_cerrada", "ord-1", { orden_id: "ord-1" }),
  ])];

  it("reparte cada cobro a su cuenta, sin mezclarlos", () => {
    const saldos = saldosDelRestaurante({
      comandas,
      egresos: [],
      sesiones: [],
      tesoreria: [],
    });
    expect(saldos.efectivo).toBe(pesos(600));
    expect(saldos.banco).toBe(pesos(400));
    expect(saldos.total).toBe(pesos(1000));
  });

  it("el gasto en efectivo baja el cajón y no toca el banco", () => {
    const saldos = saldosDelRestaurante({
      comandas,
      egresos: [gasto("Gas", 250, "efectivo")],
      sesiones: [],
      tesoreria: [],
    });
    expect(saldos.efectivo).toBe(pesos(350));
    expect(saldos.banco).toBe(pesos(400));
  });

  it("el gasto A CRÉDITO no baja nada hasta que se paga", () => {
    const aCredito = gasto("Queso", 5_000, "transferencia", { pagado: false });
    const antes = saldosDelRestaurante({
      comandas,
      egresos: [aCredito],
      sesiones: [],
      tesoreria: [],
    });
    // La deuda existe, pero el dinero sigue ahí: es la diferencia entre deber y
    // haber pagado, y confundirlas descuadra el saldo toda la semana.
    expect(antes.banco).toBe(pesos(400));
    expect(totalPorPagar([aCredito])).toBe(pesos(5_000));

    const liquidado = proyectarEgresos([
      fEgreso().crear("egreso_registrado", "finanzas:suc-1", {
        egreso_id: "eg-queso",
        categoria: "insumos",
        concepto: "Queso",
        monto: pesos(5_000),
        forma_pago: "transferencia",
        pagado: false,
      }),
      fEgreso().crear("egreso_pagado", "finanzas:suc-1", {
        egreso_id: "eg-queso",
        forma_pago: "transferencia",
      }),
    ]);
    const despues = saldosDelRestaurante({
      comandas,
      egresos: liquidado,
      sesiones: [],
      tesoreria: [],
    });
    expect(despues.banco).toBe(pesos(-4_600));
    expect(totalPorPagar(liquidado)).toBe(CERO);
  });

  it("el fondo del turno NO es dinero nuevo", () => {
    const sesiones = proyectarSesiones([
      fCaja().crear("caja_abierta", "s1", {
        sesion_id: "s1",
        cajero_id: "usr-cajero",
        fondo_inicial: pesos(2_000),
      }),
    ]);
    const saldos = saldosDelRestaurante({ comandas, egresos: [], sesiones, tesoreria: [] });
    // Si el fondo sumara, cada apertura de caja inventaría dos mil pesos.
    expect(saldos.efectivo).toBe(pesos(600));
  });
});

// --- Traspasos y ajustes ------------------------------------------------------------------

describe("depósitos y ajustes justificados", () => {
  it("el depósito mueve el dinero de sitio sin cambiar el total", () => {
    const traspaso = fTesoreria().crear("traspaso_registrado", "tesoreria:suc-1", {
      traspaso_id: "tr-1",
      desde: "efectivo",
      hacia: "banco",
      monto: pesos(10_000),
      referencia: "ficha 4471",
    });
    const saldos = saldosDe(movimientosDeTesoreria([traspaso]));
    expect(saldos.efectivo).toBe(pesos(-10_000));
    expect(saldos.banco).toBe(pesos(10_000));
    expect(saldos.total).toBe(CERO);
  });

  it("el ajuste deja su justificación en el renglón", () => {
    const ajuste = fTesoreria().crear("saldo_ajustado", "tesoreria:suc-1", {
      ajuste_id: "aj-1",
      cuenta: "efectivo",
      clase: "saldo_inicial",
      delta: pesos(15_000),
      justificacion: "Con lo que arrancamos MotRest el 1 de septiembre",
    });
    const [renglon] = movimientosDeTesoreria([ajuste]);
    expect(renglon?.monto).toBe(pesos(15_000));
    expect(renglon?.justificacion).toContain("arrancamos");
    expect(renglon?.origen).toBe("ajuste");
  });
});

// --- Cuentas por pagar ---------------------------------------------------------------------

describe("cuentas por pagar", () => {
  const deudas = [
    gasto("Verdura", 1_200, "efectivo", { pagado: false, vence_ts: LUNES + 3 * DIA, proveedor: "La Central" }),
    gasto("Queso", 8_000, "transferencia", { pagado: false, vence_ts: LUNES - DIA, proveedor: "Lácteos SA" }),
    gasto("Luz", 3_000, "transferencia"),
  ];

  it("solo lista lo que se debe, y lo que vence antes primero", () => {
    const pendientes = cuentasPorPagar(deudas);
    expect(pendientes).toHaveLength(2);
    expect(pendientes[0]?.concepto).toBe("Queso");
    expect(totalPorPagar(deudas)).toBe(pesos(9_200));
  });

  it("señala lo vencido", () => {
    expect(vencidas(deudas, LUNES).map((d) => d.concepto)).toEqual(["Queso"]);
  });

  it("agrupa por proveedor, de mayor deuda a menor", () => {
    const porProveedor = deudaPorProveedor(deudas);
    expect(porProveedor[0]).toMatchObject({ proveedor: "Lácteos SA", monto: pesos(8_000) });
    expect(porProveedor[1]).toMatchObject({ proveedor: "La Central", documentos: 1 });
  });
});

// --- Devengado contra pagado ----------------------------------------------------------------

describe("cuándo se gastó y cuándo salió el dinero", () => {
  const mes = { desde: LUNES, hasta: LUNES + 30 * DIA };

  it("separa la fecha del gasto de la fecha del pago", () => {
    const aCredito = gasto("Queso de agosto", 5_000, "transferencia", { pagado: false });
    // Se incurrió dentro del mes…
    expect(egresosEn([aCredito], mes)).toHaveLength(1);
    // …pero el dinero todavía no ha salido, así que no está en los pagados.
    expect(egresosPagadosEn([aCredito], mes)).toHaveLength(0);
  });
});

// --- Arqueo y conteo -------------------------------------------------------------------------

describe("arqueo del efectivo", () => {
  it("dice cuánto falta, con signo", () => {
    const a = arquear(pesos(5_000), pesos(4_850));
    expect(a.diferencia).toBe(pesos(-150));
    expect(a.cuadra).toBe(false);
  });

  it("cuadra cuando lo contado iguala lo esperado", () => {
    expect(arquear(pesos(5_000), pesos(5_000)).cuadra).toBe(true);
  });
});

describe("conteo por denominaciones", () => {
  it("suma billetes y monedas", () => {
    const conteo = { "$500": 4, "$100": 7, "$50": 3, "$10": 12, "50¢": 6 };
    // 2000 + 700 + 150 + 120 + 3
    expect(totalDelConteo(conteo)).toBe(pesos(2_973));
  });

  it("distingue el billete de $20 de la moneda de $20", () => {
    expect(totalDelConteo({ "$20": 2, "$20 (moneda)": 3 })).toBe(pesos(100));
  });

  it("avisa del cambio disponible sin contar los billetes grandes", () => {
    // Doce mil pesos en billetes de mil no sirven para dar cambio.
    expect(cambioDisponible({ "$1,000": 12 })).toBe(CERO);
    expect(cambioDisponible({ "$50": 10, "$20": 5 })).toBe(pesos(600));
  });
});

// --- El estado de cuenta ------------------------------------------------------------------------

describe("saldo arrastrado", () => {
  it("lleva cada cuenta por su lado", () => {
    const movimientos = flujoDeDinero({
      comandas: [],
      egresos: [gasto("Gas", 300, "efectivo")],
      sesiones: [],
      tesoreria: [
        fTesoreria().crear("saldo_ajustado", "tesoreria:suc-1", {
          ajuste_id: "aj-0",
          cuenta: "efectivo",
          clase: "saldo_inicial",
          delta: pesos(1_000),
          justificacion: "Arranque",
        }),
      ],
    });
    const conSaldo = conSaldoArrastrado(movimientos, { efectivo: CERO, banco: CERO, total: CERO });
    expect(conSaldo.at(-1)?.saldo).toBe(pesos(700));
  });

  it("el saldo inicial del período recoge TODA la historia anterior", () => {
    const antes = LUNES - 10 * DIA;
    const viejo = {
      ...gasto("Compra vieja", 400, "efectivo"),
      ts: antes,
      pagado_ts: antes,
    };
    const resumen = resumenDeFlujo(
      { comandas: [], egresos: [viejo], sesiones: [], tesoreria: [] },
      { desde: LUNES, hasta: LUNES + DIA },
    );
    // Decir que el mes empieza en cero cuando ya se debía sería ficción.
    expect(resumen.inicial.efectivo).toBe(pesos(-400));
    expect(resumen.final.efectivo).toBe(pesos(-400));
  });
});

// --- Corregir la forma de cobro ---------------------------------------------------------------

describe("corrección de la forma de cobro", () => {
  const base: EventoComanda[] = [
    fComanda().crear("orden_creada", "ord-9", {
      orden_id: "ord-9",
      mesa_id: "m3",
      abierta_ts: LUNES,
    }),
  ];
  const pago = fComanda().crear("pago_registrado", "ord-9", {
    orden_id: "ord-9",
    monto: pesos(433),
    forma: "efectivo",
  });
  const cierre = fComanda().crear("cuenta_cerrada", "ord-9", { orden_id: "ord-9" });

  const correccion = fComanda().crear("pago_corregido", "ord-9", {
    orden_id: "ord-9",
    pago_id: pago.id,
    forma_anterior: "efectivo",
    forma: "tarjeta_credito",
    motivo: "El cliente pagó con tarjeta y se tecleó efectivo",
    autorizador_id: "usr-gerente",
  });

  it("mueve el dinero de una cuenta a la otra, sin cambiar el total", () => {
    const antes = saldosDelRestaurante({
      comandas: [proyectarComanda([...base, pago, cierre])],
      egresos: [], sesiones: [], tesoreria: [],
    });
    expect(antes.efectivo).toBe(pesos(433));
    expect(antes.banco).toBe(CERO);

    const despues = saldosDelRestaurante({
      comandas: [proyectarComanda([...base, pago, cierre, correccion])],
      egresos: [], sesiones: [], tesoreria: [],
    });
    // El dinero es el mismo: lo que cambia es por dónde entró.
    expect(despues.efectivo).toBe(CERO);
    expect(despues.banco).toBe(pesos(433));
    expect(despues.total).toBe(antes.total);
  });

  it("deja constancia de con qué se había apuntado", () => {
    const comanda = proyectarComanda([...base, pago, cierre, correccion]);
    expect(comanda.pagos[0]).toMatchObject({
      forma: "tarjeta_credito",
      forma_original: "efectivo",
      corregido_por: "usr-gerente",
    });
    expect(comanda.pagos[0]?.motivo_correccion).toContain("tarjeta");
  });

  it("corregir dos veces conserva la forma con la que se cobró de verdad", () => {
    const segunda = fComanda().crear("pago_corregido", "ord-9", {
      orden_id: "ord-9",
      pago_id: pago.id,
      forma_anterior: "tarjeta_credito",
      forma: "transferencia",
      motivo: "Tampoco era tarjeta: fue transferencia",
    });
    const comanda = proyectarComanda([...base, pago, cierre, correccion, segunda]);
    expect(comanda.pagos[0]?.forma).toBe("transferencia");
    expect(comanda.pagos[0]?.forma_original).toBe("efectivo");
  });

  it("el corte del turno cuadra con la forma corregida", () => {
    const sesion = proyectarCaja([
      fCaja().crear("caja_abierta", "s9", {
        sesion_id: "s9",
        cajero_id: "usr-cajero",
        fondo_inicial: pesos(1000),
      }),
    ])!;
    // Sin la corrección el cajero buscaría 433 pesos que nunca estuvieron ahí.
    const corte = calcularCorte(sesion, [pago, cierre, correccion]);
    expect(corte.efectivoEsperado).toBe(pesos(1000));
    expect(corte.cobrado.tarjeta_credito).toBe(pesos(433));
    expect(corte.cobrado.efectivo ?? CERO).toBe(CERO);
  });
});
