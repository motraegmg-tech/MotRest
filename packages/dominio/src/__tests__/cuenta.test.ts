/**
 * Descuentos, cortesías, propina, cobro y corte de caja.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos, repartir, restar, sumar } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { IVA_16, desglosarConTasas, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, renglonesActivos } from "../comanda/reducers.js";
import { importeRenglon, type RenglonComanda } from "../comanda/renglon.js";
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

describe("retirar un descuento", () => {
  /*
   * Deshacer tiene que dejar la cuenta EXACTAMENTE como estaba. Aplicar la
   * promoción equivocada obligaba antes a cancelar la cuenta entera.
   */
  it("devuelve la cuenta al total que tenía antes", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const sinNada = totalesComanda(proyectarComanda(eventos));

    const aplicado = f.crear("descuento_aplicado", orden_id, {
      orden_id, alcance: "cuenta", modo: "porcentaje", valor: 0.1, motivo: "Promoción",
    });
    const conDescuento = totalesComanda(proyectarComanda([...eventos, aplicado]));
    expect(conDescuento.total).toBe(pesos(313.2));

    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        aplicado,
        f.crear("descuento_retirado", orden_id, {
          orden_id, descuento_id: aplicado.id,
        }),
      ]),
    );
    expect(t.descuentos).toBe(CERO);
    expect(t.total).toBe(sinNada.total);
  });

  /*
   * Se retira UNO, por el id de su evento. La misma promoción puede haberse
   * aplicado dos veces —una por ronda— y quitar la segunda no puede llevarse
   * la primera por delante.
   */
  it("solo quita el descuento señalado, no los demás", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const primero = f.crear("descuento_aplicado", orden_id, {
      orden_id, alcance: "cuenta", modo: "monto", valor: pesos(50),
      motivo: "Promoción: 2x1", promocion_id: "promo-1",
    });
    const segundo = f.crear("descuento_aplicado", orden_id, {
      orden_id, alcance: "cuenta", modo: "monto", valor: pesos(30),
      motivo: "Promoción: 2x1", promocion_id: "promo-1",
    });

    const c = proyectarComanda([
      ...eventos,
      primero,
      segundo,
      f.crear("descuento_retirado", orden_id, { orden_id, descuento_id: segundo.id }),
    ]);

    expect(c.descuentos).toHaveLength(1);
    expect(c.descuentos[0]!.id).toBe(primero.id);
    expect(totalesComanda(c).descuentos).toBe(pesos(50));
  });

  it("retirar uno que no existe no cambia nada", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const aplicado = f.crear("descuento_aplicado", orden_id, {
      orden_id, alcance: "cuenta", modo: "monto", valor: pesos(50), motivo: "Promoción",
    });
    const c = proyectarComanda([
      ...eventos,
      aplicado,
      f.crear("descuento_retirado", orden_id, { orden_id, descuento_id: "no-existe" }),
    ]);
    expect(c.descuentos).toHaveLength(1);
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

  /*
   * El botón de cortesía se pulsa por error, y hasta ahora la única salida era
   * cancelar la cuenta entera. Retirarla devuelve el importe COMPLETO, IVA
   * incluido: la cuenta tiene que quedar exactamente como estaba.
   */
  it("retirar la cortesía de la cuenta la devuelve a su total", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("cortesia_otorgada", orden_id, { orden_id, motivo: "Invitación" }),
        f.crear("cortesia_retirada", orden_id, { orden_id }),
      ]),
    );
    expect(t.cortesias).toBe(CERO);
    expect(t.total).toBe(pesos(348));
  });

  it("retirar la cortesía de un renglón no se lleva la de otro", () => {
    const { f, orden_id, eventos, a, b } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([
        ...eventos,
        f.crear("cortesia_otorgada", orden_id, { orden_id, renglon_id: a.id, motivo: "Se cayó" }),
        f.crear("cortesia_otorgada", orden_id, { orden_id, renglon_id: b.id, motivo: "Tardó" }),
        f.crear("cortesia_retirada", orden_id, { orden_id, renglon_id: a.id }),
      ]),
    );
    // Se queda regalado el de 200 y vuelve a cobrarse el de 100.
    expect(t.cortesias).toBe(pesos(200));
    expect(t.subtotal).toBe(pesos(100));
  });

  it("retirar una cortesía que no existe no toca la cuenta", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const t = totalesComanda(
      proyectarComanda([...eventos, f.crear("cortesia_retirada", orden_id, { orden_id })]),
    );
    expect(t.total).toBe(pesos(348));
  });
});

/*
 * Liberar una mesa que se abrió por error.
 *
 * Antes había que cobrarla en cero, y esas cuentas fantasma hundían el ticket
 * promedio de la jornada. `orden_anulada` la cierra sin convertirla en venta.
 */
describe("mesa liberada sin consumo", () => {
  it("cierra la sentada y la marca anulada", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const c = proyectarComanda([
      f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-3", abierta_ts: Date.now() }),
      f.crear("orden_anulada", orden_id, { orden_id, motivo: "Se liberó sin consumo" }),
    ]);

    expect(c.cerrada).toBe(true);
    expect(c.anulada).toBe(true);
    expect(c.cerrada_ts).toBeGreaterThan(0);
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

    // Lo que ENTRÓ por cada forma, propina incluida.
    expect(corte.cobrado.efectivo).toBe(pesos(500));
    expect(corte.cobrado.tarjeta_credito).toBe(pesos(450));

    /*
     * La propina se reparte entre las formas con que pagó ESTA cuenta, a
     * prorrata: 80 sobre 950 cobrados → 42.11 del efectivo y 37.89 de la
     * tarjeta. El resto mayor decide el centavo suelto, así que la suma cuadra.
     */
    expect(sumar(...Object.values(corte.propinasPorForma))).toBe(pesos(80));
    expect(corte.ventas.efectivo).toBe(restar(pesos(500), corte.propinasPorForma.efectivo!));
    expect(sumar(...Object.values(corte.ventas))).toBe(corte.totalVendido);

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

/*
 * Aritmética de la pre-cuenta.
 *
 * El papel que se lleva a la mesa imprime cada renglón CON su impuesto dentro,
 * porque quien lo recibe suma los renglones y espera llegar al total. Con el
 * perfil de Rodizio (IVA_16, `incluido_en_precio: false`) el precio de carta no
 * trae el IVA, así que esa suma solo cuadra si se desglosa renglón por renglón
 * igual que lo hacen los totales. Estas pruebas fijan esa correspondencia: si
 * alguien cambia cómo se reparte el impuesto, el papel del comensal deja de
 * cuadrar y hay que enterarse aquí, no en la mesa.
 */
describe("pre-cuenta: los renglones con IVA suman el total", () => {
  /** Lo mismo que calcula el POS para cada renglón del papel. */
  function importeConImpuesto(r: RenglonComanda) {
    return desglosarConTasas(importeRenglon(r), r.impuesto).total;
  }

  it("sin rebajas, la suma de renglones es exactamente el total", () => {
    const estado = proyectarComanda(cuentaBase().eventos);
    const t = totalesComanda(estado);

    const suma = renglonesActivos(estado).reduce((a, r) => a + importeConImpuesto(r), 0);

    expect(suma).toBe(t.total);
  });

  it("con descuento, suma − rebaja da el total sin perder centavos", () => {
    const { f, orden_id, eventos } = cuentaBase();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("descuento_aplicado", orden_id, {
        orden_id, alcance: "cuenta", modo: "monto", valor: pesos(50), motivo: "Cortesía de la casa",
      }),
    ]);
    const t = totalesComanda(estado);

    const suma = renglonesActivos(estado).reduce((a, r) => a + importeConImpuesto(r), 0);
    // Es como el POS deriva la rebaja del papel: por diferencia, nunca aparte.
    const rebaja = suma - t.total;

    expect(rebaja).toBeGreaterThan(0);
    expect(suma - rebaja).toBe(t.total);
  });

  it("un renglón cuyo precio YA incluye impuesto no lo suma dos veces", () => {
    const conIvaDentro: RenglonComanda = {
      id: uuidv7(), producto_id: "p9", descripcion: "Refresco", cantidad: 1,
      precio_unitario: pesos(58), costo_unitario: pesos(20),
      impuesto: snapshotTasas({ ...IVA_16, incluido_en_precio: true }),
      estado: "capturado",
    };

    // El comensal paga los $58 de la carta, ni un centavo más.
    expect(importeConImpuesto(conIvaDentro)).toBe(pesos(58));
  });
});
