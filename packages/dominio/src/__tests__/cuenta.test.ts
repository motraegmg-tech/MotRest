/**
 * Descuentos, cortesías, propina, cobro y corte de caja.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos, repartir, sumar } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, renglonesActivos } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import type { EventoCaja } from "../caja/eventos.js";
import { calcularCorte, diferenciaArqueo, proyectarCaja } from "../caja/reducers.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };

function renglon(precio: number, costo: number, descripcion = "Platillo"): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p1", descripcion, cantidad: 1,
    precio_unitario: pesos(precio), costo_unitario: pesos(costo),
    impuesto: snapshotTasas(IVA_16), estado: "capturado",
  };
}

/** Cuenta con dos renglones de 100 y 200 (bruto 300). */
function cuentaBase() {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const a = renglon(100, 30, "Uno");
  const b = renglon(200, 60, "Dos");
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: Date.now() }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: a }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: b }),
  ];
  return { f, orden_id, eventos, a, b };
}

describe("cuenta sin rebajas", () => {
  it("calcula bruto, IVA y total", () => {
    const t = totalesComanda(proyectarComanda(cuentaBase().eventos));
    expect(t.bruto).toBe(pesos(300));
    expect(t.subtotal).toBe(pesos(300));
    expect(t.iva).toBe(pesos(48));
    expect(t.total).toBe(pesos(348));
    expect(t.descuentos).toBe(CERO);
  });
});

describe("descuentos", () => {
  it("un descuento de cuenta rebaja la base antes del IVA", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("descuento_aplicado", orden_id, {
          orden_id, alcance: "cuenta", modo: "porcentaje", valor: 0.1, motivo: "Promoción",
        }),
      ]),
    );
    // 300 − 10 % = 270 de base; IVA 43.20; total 313.20
    expect(t.descuentos).toBe(pesos(30));
    expect(t.subtotal).toBe(pesos(270));
    expect(t.iva).toBe(pesos(43.2));
    expect(t.total).toBe(pesos(313.2));
  });

  it("un descuento por renglón solo afecta a ese renglón", () => {
    const { f, orden_id, eventos, a } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("descuento_aplicado", orden_id, {
          orden_id, alcance: "renglon", renglon_id: a.id,
          modo: "porcentaje", valor: 0.5, motivo: "Producto dañado",
        }),
      ]),
    );
    // 100 → 50; base 250; IVA 40
    expect(t.descuentos).toBe(pesos(50));
    expect(t.subtotal).toBe(pesos(250));
    expect(t.total).toBe(pesos(290));
  });

  it("un descuento de monto fijo nunca deja la base negativa", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("descuento_aplicado", orden_id, {
          orden_id, alcance: "cuenta", modo: "monto", valor: pesos(1000), motivo: "Exagerado",
        }),
      ]),
    );
    expect(t.subtotal).toBe(CERO);
    expect(t.total).toBe(CERO);
  });
});

describe("cortesías", () => {
  it("una cortesía de renglón lo saca de la base pero su costo sigue contando", () => {
    const { f, orden_id, eventos, b } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("cortesia_otorgada", orden_id, {
          orden_id, renglon_id: b.id, motivo: "Cortesía de la casa",
        }),
      ]),
    );
    expect(t.cortesias).toBe(pesos(200));
    expect(t.subtotal).toBe(pesos(100));
    expect(t.total).toBe(pesos(116));
    // El costo NO se perdona: los 90 de costo siguen ahí.
    expect(t.costo).toBe(pesos(90));
  });

  it("una cortesía de cuenta completa deja el total en cero", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("cortesia_otorgada", orden_id, { orden_id, motivo: "Invitación" }),
      ]),
    );
    expect(t.total).toBe(CERO);
    expect(t.cortesias).toBe(pesos(300));
    expect(t.costo).toBe(pesos(90));
  });
});

describe("propina y cobro", () => {
  it("la propina se suma a lo que hay que cobrar", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("propina_registrada", orden_id, { orden_id, monto: pesos(50) }),
      ]),
    );
    expect(t.propina).toBe(pesos(50));
    expect(t.total).toBe(pesos(348));
    expect(t.saldo).toBe(pesos(398));
  });

  it("un pago parcial deja saldo", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("pago_registrado", orden_id, { orden_id, monto: pesos(100), forma: "efectivo" }),
      ]),
    );
    expect(t.pagado).toBe(pesos(100));
    expect(t.saldo).toBe(pesos(248));
  });

  it("calcula el cambio cuando se recibe de más", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("pago_registrado", orden_id, {
          orden_id, monto: pesos(348), forma: "efectivo", recibido: pesos(500),
        }),
      ]),
    );
    expect(t.saldo).toBe(CERO);
    expect(t.cambio).toBe(pesos(152));
  });

  it("dividir en tres reparte sin perder centavos", () => {
    const total = pesos(348);
    const trozos = repartir(total, 3);
    expect(sumar(...trozos)).toBe(total);
    expect(trozos).toHaveLength(3);
  });
});

describe("traspaso de renglones", () => {
  it("el renglón sale de la cuenta origen", () => {
    const { f, orden_id, eventos, a } = cuentaBase();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_transferido", orden_id, {
        orden_id, renglon_id: a.id, a_orden_id: "otra-orden",
      }),
    ]);
    expect(renglonesActivos(estado)).toHaveLength(1);
    expect(totalesComanda(estado).bruto).toBe(pesos(200));
  });

  it("la cuenta destino lo recibe con su snapshot intacto", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const destino: ID = uuidv7();
    const traspasado = renglon(100, 30, "Uno");
    const estado = proyectarComanda([
      f.crear("orden_creada", destino, { orden_id: destino, mesa_id: "mesa-2", abierta_ts: 1 }),
      f.crear("item_recibido", destino, {
        orden_id: destino, renglon: traspasado, de_orden_id: "origen",
      }),
    ]);
    expect(renglonesActivos(estado)).toHaveLength(1);
    expect(totalesComanda(estado).bruto).toBe(pesos(100));
  });
});

describe("cambio de cantidad", () => {
  it("modificar la cantidad recalcula el importe", () => {
    const { f, orden_id, eventos, a } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("item_modificado", orden_id, { orden_id, renglon_id: a.id, cantidad: 3 }),
      ]),
    );
    // 100×3 + 200 = 500
    expect(t.bruto).toBe(pesos(500));
  });
});

// --- Caja ---------------------------------------------------------------------------

describe("sesión de caja y corte", () => {
  function sesionCaja() {
    const f = new FabricaEventos<EventoCaja>(CTX);
    const sesion_id = uuidv7();
    return {
      f,
      sesion_id,
      eventos: [
        f.crear("caja_abierta", sesion_id, {
          sesion_id, fondo_inicial: pesos(1000), cajero_id: "usr-1",
        }),
      ] as EventoCaja[],
    };
  }

  it("proyecta la apertura", () => {
    const { eventos } = sesionCaja();
    const caja = proyectarCaja(eventos)!;
    expect(caja.fondo_inicial).toBe(pesos(1000));
    expect(caja.cerrada).toBe(false);
  });

  it("los retiros restan del efectivo esperado", () => {
    const { f, sesion_id, eventos } = sesionCaja();
    const caja = proyectarCaja([
      ...eventos,
      f.crear("movimiento_efectivo", sesion_id, {
        sesion_id, motivo: "retiro", monto: pesos(-500), concepto: "Depósito bancario",
      }),
    ])!;
    const corte = calcularCorte(caja, []);
    expect(corte.movimientos).toBe(pesos(-500));
    expect(corte.efectivoEsperado).toBe(pesos(500));
  });

  it("agrupa las ventas por forma de pago", () => {
    const { eventos } = sesionCaja();
    const caja = proyectarCaja(eventos)!;
    const fc = new FabricaEventos<EventoComanda>(CTX);
    const orden = uuidv7();

    const corte = calcularCorte(caja, [
      fc.crear("pago_registrado", orden, { orden_id: orden, monto: pesos(300), forma: "efectivo" }),
      fc.crear("pago_registrado", orden, { orden_id: orden, monto: pesos(200), forma: "efectivo" }),
      fc.crear("pago_registrado", orden, {
        orden_id: orden, monto: pesos(450), forma: "tarjeta_credito",
      }),
      fc.crear("propina_registrada", orden, { orden_id: orden, monto: pesos(80) }),
      fc.crear("cuenta_cerrada", orden, { orden_id: orden }),
    ]);

    expect(corte.ventas.efectivo).toBe(pesos(500));
    expect(corte.ventas.tarjeta_credito).toBe(pesos(450));
    // 950 cobrados − 80 de propina. La propina es del mesero, no venta del local.
    expect(corte.totalVendido).toBe(pesos(870));
    expect(corte.propinas).toBe(pesos(80));
    expect(corte.cuentasCerradas).toBe(1);
    // Fondo 1000 + 500 en efectivo (la tarjeta no entra al cajón).
    expect(corte.efectivoEsperado).toBe(pesos(1500));
  });

  it("la diferencia del arqueo señala faltantes y sobrantes", () => {
    const { eventos } = sesionCaja();
    const corte = calcularCorte(proyectarCaja(eventos)!, []);
    expect(diferenciaArqueo(corte, pesos(950))).toBe(pesos(-50));
    expect(diferenciaArqueo(corte, pesos(1000))).toBe(CERO);
    expect(diferenciaArqueo(corte, pesos(1020))).toBe(pesos(20));
  });

  it("un evento de caja sin apertura lanza", () => {
    const f = new FabricaEventos<EventoCaja>(CTX);
    const suelto = f.crear("caja_cerrada", "s1", {
      sesion_id: "s1",
      diferencia: CERO,
      resumen: {
        sesion_id: "s1", cajero_id: "usr-1", abierta_ts: 1, cerrada_ts: 2,
        fondo_inicial: CERO, total_vendido: CERO, efectivo_esperado: CERO,
        declarado: CERO, diferencia: CERO, propinas: CERO, cuentas_cerradas: 0,
      },
      sello: "0000-0000",
    });
    expect(() => proyectarCaja([suelto])).toThrow();
  });
});
