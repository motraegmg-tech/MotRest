/**
 * Lealtad y monedero.
 *
 * Lo que importa probar es la separación: los PUNTOS los regala la casa y no
 * son dinero; el MONEDERO es dinero del cliente que el restaurante ya cobró y
 * es un pasivo del negocio. Revolverlos hace imposible responder "¿cuánto le
 * debo a mis clientes?", que es lo primero que pregunta el contador.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import {
  pasivoConClientes,
  proyectarSaldos,
  puntosPorConsumo,
  saldoDe,
  streamLealtad,
  usoPosible,
  valorDePuntos,
  type EventoLealtad,
} from "../clientes/lealtad.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const STREAM = streamLealtad("suc-1");
const CLIENTE = "cli-1";
const f = () => new FabricaEventos<EventoLealtad>(CTX);

describe("cuántos puntos da un consumo", () => {
  /*
   * Sobre el SUBTOTAL, no sobre el total: el IVA se recauda para el SAT y no es
   * ingreso del restaurante. Premiar sobre el total sería regalar puntos por el
   * impuesto de otro.
   */
  it("se calculan sobre el subtotal, un punto por peso", () => {
    expect(puntosPorConsumo(pesos(529))).toBe(529);
  });

  it("no reparte fracciones de punto", () => {
    expect(puntosPorConsumo(pesos(99.99))).toBe(99);
  });

  it("cien puntos valen un peso", () => {
    expect(valorDePuntos(100)).toBe(pesos(1));
  });
});

describe("el saldo de un cliente", () => {
  it("acumula y descuenta puntos", () => {
    const saldos = proyectarSaldos([
      f().crear("puntos_acumulados", STREAM, {
        cliente_id: CLIENTE, orden_id: "o1", puntos: 500, base: pesos(500),
      }),
      f().crear("puntos_canjeados", STREAM, {
        cliente_id: CLIENTE, orden_id: "o2", puntos: 200, valor: pesos(2),
      }),
    ]);
    expect(saldoDe(saldos, CLIENTE).puntos).toBe(300);
  });

  /*
   * Dos terminales canjeando a la vez sin haberse sincronizado pueden mandar
   * más canje que saldo. Se descuenta hasta cero: un saldo negativo de puntos
   * es un número imposible que nadie sabría interpretar después.
   */
  it("los puntos nunca quedan en negativo", () => {
    const saldos = proyectarSaldos([
      f().crear("puntos_acumulados", STREAM, {
        cliente_id: CLIENTE, orden_id: "o1", puntos: 100, base: pesos(100),
      }),
      f().crear("puntos_canjeados", STREAM, {
        cliente_id: CLIENTE, orden_id: "o2", puntos: 400, valor: pesos(4),
      }),
    ]);
    expect(saldoDe(saldos, CLIENTE).puntos).toBe(0);
  });

  it("un ajuste queda registrado con su motivo", () => {
    const saldos = proyectarSaldos([
      f().crear("puntos_ajustados", STREAM, {
        cliente_id: CLIENTE, puntos: 250, motivo: "Disculpa por la espera",
      }),
    ]);
    expect(saldoDe(saldos, CLIENTE).puntos).toBe(250);
  });

  it("el monedero abona y carga en centavos exactos", () => {
    const saldos = proyectarSaldos([
      f().crear("monedero_abonado", STREAM, {
        cliente_id: CLIENTE, monto: pesos(500), motivo: "compra",
        concepto: "Tarjeta de regalo", folio_regalo: "REG-001",
      }),
      f().crear("monedero_cargado", STREAM, {
        cliente_id: CLIENTE, monto: pesos(129.5), orden_id: "o3",
      }),
    ]);
    expect(saldoDe(saldos, CLIENTE).monedero).toBe(pesos(370.5));
  });

  it("el monedero tampoco queda en negativo", () => {
    const saldos = proyectarSaldos([
      f().crear("monedero_abonado", STREAM, {
        cliente_id: CLIENTE, monto: pesos(100), motivo: "cortesia", concepto: "x",
      }),
      f().crear("monedero_cargado", STREAM, {
        cliente_id: CLIENTE, monto: pesos(300), orden_id: "o4",
      }),
    ]);
    expect(saldoDe(saldos, CLIENTE).monedero).toBe(CERO);
  });

  it("un cliente sin movimientos tiene todo en cero", () => {
    expect(saldoDe([], "cli-nuevo")).toEqual({
      cliente_id: "cli-nuevo", puntos: 0, monedero: CERO,
    });
  });
});

/* La pregunta del contador: cuánto dinero de clientes tiene el negocio adentro. */
describe("lo que el restaurante le debe a sus clientes", () => {
  it("suma los monederos, no los puntos", () => {
    const saldos = proyectarSaldos([
      f().crear("monedero_abonado", STREAM, {
        cliente_id: "cli-1", monto: pesos(500), motivo: "compra", concepto: "Gift card",
      }),
      f().crear("monedero_abonado", STREAM, {
        cliente_id: "cli-2", monto: pesos(250), motivo: "devolucion", concepto: "Pizza fría",
      }),
      // Los puntos no son dinero: no entran al pasivo.
      f().crear("puntos_acumulados", STREAM, {
        cliente_id: "cli-1", orden_id: "o1", puntos: 9999, base: pesos(9999),
      }),
    ]);
    expect(pasivoConClientes(saldos)).toBe(pesos(750));
  });
});

describe("qué puede usar en esta cuenta", () => {
  const saldo = { cliente_id: CLIENTE, puntos: 1000, monedero: pesos(200) };

  it("ofrece puntos y monedero sin pasarse del total", () => {
    // 1000 puntos valen $10; la cuenta es de $500.
    const uso = usoPosible(saldo, pesos(500));
    expect(uso.valor_puntos).toBe(pesos(10));
    expect(uso.monedero).toBe(pesos(200));
  });

  /*
   * EL CANDADO. Un canje que deje la cuenta en negativo convierte una promoción
   * de lealtad en una devolución de dinero que nadie autorizó.
   */
  it("nunca ofrece más de lo que vale la cuenta", () => {
    const rico = { cliente_id: CLIENTE, puntos: 100_000, monedero: pesos(5000) };
    const uso = usoPosible(rico, pesos(120));
    expect(uso.valor_puntos).toBe(pesos(120));
    expect(uso.monedero).toBe(CERO);
  });

  it("el monedero cubre lo que los puntos no alcanzan", () => {
    const uso = usoPosible(saldo, pesos(150));
    expect(uso.valor_puntos).toBe(pesos(10));
    expect(uso.monedero).toBe(pesos(140));
  });

  it("sin saldo no ofrece nada", () => {
    const uso = usoPosible({ cliente_id: CLIENTE, puntos: 0, monedero: CERO }, pesos(300));
    expect(uso.valor_puntos).toBe(CERO);
    expect(uso.monedero).toBe(CERO);
  });
});
