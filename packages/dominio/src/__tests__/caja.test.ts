/**
 * Caja: sesión de turno, movimientos de efectivo y corte.
 *
 * Lo que de verdad importa probar aquí es la aritmética del arqueo —que el
 * efectivo esperado salga del fondo, las ventas en efectivo y los retiros— y
 * que un turno cerrado no se pueda reabrir. Un corte que no cuadra por un error
 * de suma es una acusación de robo contra el cajero.
 */
import { describe, expect, it } from "vitest";
import { pesos, CERO } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { EventoCaja, ResumenCorte } from "../caja/eventos.js";
import {
  calcularCorte,
  diferenciaArqueo,
  proyectarCaja,
  proyectarSesiones,
  sesionAbierta,
} from "../caja/reducers.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-cajero", sucursal_id: "suc-1" };

const caja = () => new FabricaEventos<EventoCaja>(CTX);
const comanda = () => new FabricaEventos<EventoComanda>(CTX);

const STREAM = "caja:suc-1";

function abrir(sesion_id: string, fondo: number): EventoCaja {
  return caja().crear("caja_abierta", sesion_id, {
    sesion_id,
    cajero_id: "usr-cajero",
    fondo_inicial: pesos(fondo),
  });
}

// --- Apertura ----------------------------------------------------------------------------

describe("apertura del turno", () => {
  it("nace con el fondo, sin movimientos y abierta", () => {
    const estado = proyectarCaja([abrir("s1", 1500)]);
    expect(estado).toMatchObject({
      sesion_id: "s1",
      fondo_inicial: pesos(1500),
      cerrada: false,
    });
    expect(estado!.movimientos).toEqual([]);
  });
});

// --- El corte ----------------------------------------------------------------------------

describe("cálculo del corte", () => {
  function turnoConVentas(): { caja: EventoCaja; pagos: EventoComanda[] } {
    const c = comanda();
    return {
      caja: abrir("s1", 1500),
      pagos: [
        c.crear("pago_registrado", "o1", { orden_id: "o1", monto: pesos(300), forma: "efectivo" }),
        c.crear("cuenta_cerrada", "o1", { orden_id: "o1" }),
        c.crear("pago_registrado", "o2", { orden_id: "o2", monto: pesos(500), forma: "tarjeta_credito" }),
        c.crear("propina_registrada", "o2", { orden_id: "o2", monto: pesos(50) }),
        c.crear("cuenta_cerrada", "o2", { orden_id: "o2" }),
      ],
    };
  }

  it("separa las ventas por forma de pago", () => {
    const { caja: c, pagos } = turnoConVentas();
    const corte = calcularCorte(proyectarCaja([c])!, pagos);

    // Lo COBRADO por forma: es lo que entró, propina incluida.
    expect(corte.ventas).toEqual({ efectivo: pesos(300), tarjeta_credito: pesos(500) });
    /*
     * La VENTA es lo cobrado menos la propina. El cliente paga cuenta y propina
     * de un solo golpe, pero la propina es del mesero: contarla como venta infla
     * el ingreso y el contador declararía de más.
     */
    expect(corte.totalVendido).toBe(pesos(750));
    // El cajón, en cambio, sí tiene el efectivo tal cual entró.
    expect(corte.efectivoVentas).toBe(pesos(300));
    expect(corte.cuentasCerradas).toBe(2);
    expect(corte.propinas).toBe(pesos(50));
  });

  /*
   * El corazón del arqueo: solo el EFECTIVO llega al cajón. Los $500 de la
   * tarjeta no están ahí, y contarlos como esperados acusaría al cajero de un
   * faltante que no existe.
   */
  it("el efectivo esperado es fondo + ventas en efectivo, no el total", () => {
    const { caja: c, pagos } = turnoConVentas();
    const corte = calcularCorte(proyectarCaja([c])!, pagos);
    // 1500 de fondo + 300 en efectivo = 1800. La tarjeta no cuenta.
    expect(corte.efectivoEsperado).toBe(pesos(1800));
  });

  it("un retiro baja el efectivo esperado; un ingreso lo sube", () => {
    const c = caja();
    const eventos = [
      abrir("s1", 1500),
      c.crear("movimiento_efectivo", "s1", {
        sesion_id: "s1", motivo: "retiro", monto: pesos(-400), concepto: "A la caja fuerte",
      }),
      c.crear("movimiento_efectivo", "s1", {
        sesion_id: "s1", motivo: "ingreso", monto: pesos(100), concepto: "Cambio del banco",
      }),
    ];
    const corte = calcularCorte(proyectarCaja(eventos)!, []);
    // 1500 − 400 + 100 = 1200
    expect(corte.efectivoEsperado).toBe(pesos(1200));
  });
});

// --- El arqueo ---------------------------------------------------------------------------

describe("diferencia del arqueo", () => {
  const corteBase = (esperado: number) =>
    ({
      ventas: {}, totalVendido: CERO, efectivoVentas: CERO, fondoInicial: CERO,
      movimientos: CERO, efectivoEsperado: pesos(esperado), propinas: CERO, cuentasCerradas: 0,
    }) as const;

  it("cuadra cuando lo declarado iguala lo esperado", () => {
    expect(diferenciaArqueo(corteBase(1800), pesos(1800))).toBe(CERO);
  });

  it("es negativa cuando falta dinero", () => {
    expect(diferenciaArqueo(corteBase(1800), pesos(1750))).toBe(pesos(-50));
  });

  it("es positiva cuando sobra", () => {
    expect(diferenciaArqueo(corteBase(1800), pesos(1820))).toBe(pesos(20));
  });
});

// --- Cierre e historial ------------------------------------------------------------------

describe("cierre del turno", () => {
  const resumen: ResumenCorte = {
    sesion_id: "s1", cajero_id: "usr-cajero", abierta_ts: 1, cerrada_ts: 2,
    fondo_inicial: pesos(1500), total_vendido: pesos(800), efectivo_esperado: pesos(1800),
    declarado: pesos(1800), diferencia: CERO, propinas: pesos(50), cuentas_cerradas: 2,
  };

  it("guarda las cifras selladas y marca cerrada", () => {
    const c = caja();
    const estado = proyectarCaja([
      abrir("s1", 1500),
      c.crear("arqueo_registrado", "s1", { sesion_id: "s1", declarado: pesos(1800) }),
      c.crear("caja_cerrada", "s1", { sesion_id: "s1", diferencia: CERO, resumen, sello: "ABCD-1234" }),
    ]);

    expect(estado!.cerrada).toBe(true);
    expect(estado!.sello).toBe("ABCD-1234");
    expect(estado!.resumen).toEqual(resumen);
  });

  /*
   * Un turno cerrado no se reabre. Si una resincronización reenvía el cierre,
   * el segundo no puede pisar el sello del primero: sería dos verdades sobre el
   * mismo cajón.
   */
  it("reaplicar el cierre no pisa lo ya sellado", () => {
    const c = caja();
    const otro: ResumenCorte = { ...resumen, declarado: pesos(9999), diferencia: pesos(8199) };
    const estado = proyectarCaja([
      abrir("s1", 1500),
      c.crear("caja_cerrada", "s1", { sesion_id: "s1", diferencia: CERO, resumen, sello: "ABCD-1234" }),
      c.crear("caja_cerrada", "s1", { sesion_id: "s1", diferencia: pesos(8199), resumen: otro, sello: "FFFF-0000" }),
    ]);

    expect(estado!.sello).toBe("ABCD-1234");
    expect(estado!.declarado).toBe(pesos(1800));
  });
});

describe("historial de sesiones", () => {
  it("reconstruye cada turno por separado, del más reciente al más antiguo", () => {
    const c = caja();
    const eventos: EventoCaja[] = [
      { ...abrir("s1", 1000), ts: 100 },
      c.crear("caja_cerrada", "s1", {
        sesion_id: "s1", diferencia: CERO,
        resumen: { sesion_id: "s1", cajero_id: "usr-cajero", abierta_ts: 100, cerrada_ts: 150,
          fondo_inicial: pesos(1000), total_vendido: CERO, efectivo_esperado: pesos(1000),
          declarado: pesos(1000), diferencia: CERO, propinas: CERO, cuentas_cerradas: 0 },
        sello: "AAAA",
      }),
      { ...abrir("s2", 2000), ts: 200 },
    ];

    const sesiones = proyectarSesiones(eventos);
    expect(sesiones.map((s) => s.sesion_id)).toEqual(["s2", "s1"]);
    expect(sesiones[0]!.cerrada).toBe(false);
    expect(sesiones[1]!.cerrada).toBe(true);
  });

  it("sesionAbierta devuelve la que sigue abierta, o nada si todas cerraron", () => {
    const abierto = [{ ...abrir("s2", 2000), ts: 200 }];
    expect(sesionAbierta(abierto)?.sesion_id).toBe("s2");

    const c = caja();
    const cerrado: EventoCaja[] = [
      abrir("s1", 1000),
      c.crear("caja_cerrada", "s1", {
        sesion_id: "s1", diferencia: CERO,
        resumen: { sesion_id: "s1", cajero_id: "usr-cajero", abierta_ts: 1, cerrada_ts: 2,
          fondo_inicial: pesos(1000), total_vendido: CERO, efectivo_esperado: pesos(1000),
          declarado: pesos(1000), diferencia: CERO, propinas: CERO, cuentas_cerradas: 0 },
        sello: "AAAA",
      }),
    ];
    expect(sesionAbierta(cerrado)).toBeUndefined();
  });
});
