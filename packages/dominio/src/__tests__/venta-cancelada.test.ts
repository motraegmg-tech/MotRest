/**
 * Cancelar una venta ya cobrada.
 *
 * La prueba de referencia reproduce **lo que le pasó de verdad a la mesa 8 de
 * Rodizio el 15 de agosto de 2026**: se cobraron $433 en efectivo, se cerró la
 * cuenta, alguien la reabrió porque estaba «mal cobrada» y canceló los cinco
 * renglones. La cuenta quedó en total $0 con $433 pagados —saldo −$433— y la
 * mesa ocupada, porque nadie volvió a cerrarla y no existía forma de hacerlo.
 *
 * Lo que se prueba aquí es que ese estado ahora tiene salida y que la salida no
 * deja rastro contable suelto: la mesa se libera, el saldo vuelve a cero, la
 * venta desaparece de los reportes y el efectivo sale del cajón EL DÍA que se
 * devuelve, no el día que se cobró.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import type { EventoCaja } from "../caja/eventos.js";
import { calcularCorte, proyectarCaja } from "../caja/reducers.js";
import { cuentasCerradasEn } from "../inteligencia/reportes.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "dev-caja", empleado_id: "usr-gonzalo", sucursal_id: "suc-rodizio-centro" };

/** Precio con IVA incluido, como la carta de Rodizio. */
function renglon(precio: number, descripcion: string): RenglonComanda {
  return {
    id: uuidv7(),
    producto_id: "p1",
    descripcion,
    cantidad: 1,
    precio_unitario: pesos(precio),
    costo_unitario: CERO,
    impuesto: { ...snapshotTasas(IVA_16), incluido: true },
    estado: "capturado",
  };
}

/**
 * La mesa 8: tres refrescos de $45 y dos platos de $149 → $433 exactos.
 * Se cobra en efectivo con $450 y se cierra.
 */
function mesaOcho() {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const renglones = [
    renglon(45, "Sprite"),
    renglon(45, "Sprite"),
    renglon(45, "Coca"),
    renglon(149, "Pizza"),
    renglon(149, "Pasta"),
  ];

  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-3", abierta_ts: Date.now() }),
    ...renglones.map((r) => f.crear("item_agregado", orden_id, { orden_id, renglon: r })),
    f.crear("pago_registrado", orden_id, {
      orden_id, monto: pesos(433), forma: "efectivo", recibido: pesos(450),
    }),
    f.crear("cuenta_cerrada", orden_id, { orden_id }),
  ];

  return { f, orden_id, renglones, eventos };
}

/** Lo que hizo el cajero: reabrir y cancelar los cinco renglones. */
function mesaOchoRota() {
  const { f, orden_id, renglones, eventos } = mesaOcho();
  return {
    f,
    orden_id,
    eventos: [
      ...eventos,
      f.crear("cuenta_reabierta", orden_id, { orden_id, motivo: "mal cobrado" }),
      ...renglones.map((r) =>
        f.crear("item_cancelado", orden_id, { orden_id, renglon_id: r.id }),
      ),
    ],
  };
}

describe("la avería de la mesa 8", () => {
  it("deja saldo negativo y la mesa ocupada si no se puede cancelar la venta", () => {
    const estado = proyectarComanda(mesaOchoRota().eventos);
    const t = totalesComanda(estado);

    expect(t.total).toBe(CERO);
    expect(t.pagado).toBe(pesos(433));
    expect(t.saldo).toBe(pesos(-433));
    // Y lo peor: la sentada sigue abierta, así que la mesa no se puede dar.
    expect(estado.cerrada).toBe(false);
  });
});

describe("cancelar la venta", () => {
  it("libera la mesa y deja el saldo en cero", () => {
    const { f, orden_id, eventos } = mesaOchoRota();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("venta_cancelada", orden_id, {
        orden_id,
        motivo: "Se cobró la mesa equivocada",
        devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);

    expect(estado.cerrada).toBe(true);
    expect(estado.cancelada).toBe(true);
    expect(totalesComanda(estado).saldo).toBe(CERO);
    expect(totalesComanda(estado).devuelto).toBe(pesos(433));
  });

  it("no borra el cobro: el pago sigue en la cuenta", () => {
    const { f, orden_id, eventos } = mesaOcho();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("venta_cancelada", orden_id, {
        orden_id,
        motivo: "El cliente se arrepintió",
        devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);

    expect(estado.pagos).toHaveLength(1);
    expect(estado.pagos[0]!.monto).toBe(pesos(433));
    expect(estado.motivo_cancelacion).toBe("El cliente se arrepintió");
  });

  it("conserva la hora del cobro y sella aparte la de la cancelación", () => {
    const { f, orden_id, eventos } = mesaOcho();
    const cerrada = proyectarComanda(eventos).cerrada_ts;

    const estado = proyectarComanda([
      ...eventos,
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Cargo duplicado", devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);

    expect(estado.cerrada_ts).toBe(cerrada);
    expect(estado.cancelada_ts).toBeGreaterThanOrEqual(cerrada!);
  });

  it("saca la venta de los reportes", () => {
    const { f, orden_id, eventos } = mesaOcho();
    const cobrada = proyectarComanda(eventos);
    expect(cuentasCerradasEn([cobrada])).toHaveLength(1);

    const cancelada = proyectarComanda([
      ...eventos,
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Se cobró de más", devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);
    expect(cuentasCerradasEn([cancelada])).toHaveLength(0);
  });

  /*
   * Una cortesía total cierra con $0 y sin ningún pago. Cancelarla no devuelve
   * dinero, pero sí tiene que sacar la cuenta del reporte y liberar la mesa.
   */
  it("funciona sin devoluciones cuando no hubo cobro", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const estado = proyectarComanda([
      f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-3", abierta_ts: Date.now() }),
      f.crear("item_agregado", orden_id, { orden_id, renglon: renglon(45, "Sprite") }),
      f.crear("cortesia_otorgada", orden_id, { orden_id, motivo: "Cortesía de la casa" }),
      f.crear("cuenta_cerrada", orden_id, { orden_id }),
      f.crear("venta_cancelada", orden_id, { orden_id, motivo: "Se registró mal", devoluciones: [] }),
    ]);

    expect(estado.cancelada).toBe(true);
    expect(totalesComanda(estado).devuelto).toBe(CERO);
    expect(cuentasCerradasEn([estado])).toHaveLength(0);
  });
});

// --- El corte de caja -----------------------------------------------------------------

const cajaF = () => new FabricaEventos<EventoCaja>(CTX);

function turno(fondo: number): EventoCaja {
  return cajaF().crear("caja_abierta", "s1", {
    sesion_id: "s1", cajero_id: "usr-gonzalo", fondo_inicial: pesos(fondo),
  });
}

describe("el corte, cuando se cancela una venta", () => {
  it("cobro y cancelación en el mismo turno se anulan entre sí", () => {
    const { f, orden_id, eventos } = mesaOcho();
    const corte = calcularCorte(proyectarCaja([turno(1000)])!, [
      ...eventos,
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Cobrada por error", devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);

    expect(corte.efectivoVentas).toBe(CERO);
    expect(corte.totalCobrado).toBe(CERO);
    expect(corte.efectivoEsperado).toBe(pesos(1000));
    expect(corte.cuentasCerradas).toBe(0);
    expect(corte.devoluciones).toBe(pesos(433));
    expect(corte.ventasCanceladas).toBe(1);
  });

  /*
   * EL CASO QUE IMPORTA. El cobro fue anteayer y el corte de aquel turno ya se
   * selló; la devolución se paga hoy, del cajón de hoy. Si el efectivo esperado
   * no bajara, esta noche el arqueo acusaría al cajero de un faltante de $433.
   */
  it("una venta cobrada en otro turno baja el efectivo esperado de HOY", () => {
    const { f, orden_id } = mesaOcho();
    const corte = calcularCorte(proyectarCaja([turno(1000)])!, [
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Se devolvió al día siguiente",
        devoluciones: [{ forma: "efectivo", monto: pesos(433) }],
      }),
    ]);

    expect(corte.efectivoEsperado).toBe(pesos(567));
    expect(corte.devoluciones).toBe(pesos(433));
  });

  it("lo devuelto por tarjeta no toca el cajón, pero sí lo cobrado", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const corte = calcularCorte(proyectarCaja([turno(1000)])!, [
      f.crear("pago_registrado", orden_id, {
        orden_id, monto: pesos(500), forma: "tarjeta_credito",
      }),
      f.crear("cuenta_cerrada", orden_id, { orden_id }),
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Cargo duplicado",
        devoluciones: [{ forma: "tarjeta_credito", monto: pesos(500) }],
      }),
    ]);

    expect(corte.efectivoEsperado).toBe(pesos(1000));
    expect(corte.totalCobrado).toBe(CERO);
    expect(corte.cobrado.tarjeta_credito).toBe(CERO);
  });

  /*
   * La propina viaja DENTRO del pago —el comensal paga cuenta y propina de un
   * golpe—, así que devolver el pago la devuelve también. Dejarla contada haría
   * que el turno pretendiera repartirle al mesero una propina que ya se
   * regresó.
   */
  it("la propina de una venta cancelada deja de contarse", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const corte = calcularCorte(proyectarCaja([turno(1000)])!, [
      f.crear("propina_registrada", orden_id, { orden_id, monto: pesos(50) }),
      f.crear("pago_registrado", orden_id, { orden_id, monto: pesos(550), forma: "efectivo" }),
      f.crear("cuenta_cerrada", orden_id, { orden_id }),
      f.crear("venta_cancelada", orden_id, {
        orden_id, motivo: "Mesa equivocada",
        devoluciones: [{ forma: "efectivo", monto: pesos(550) }],
      }),
    ]);

    expect(corte.propinas).toBe(CERO);
    expect(corte.efectivoEsperado).toBe(pesos(1000));
  });
});
