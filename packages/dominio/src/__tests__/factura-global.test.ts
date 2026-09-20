/**
 * La factura global del mes, del lado del dominio.
 *
 * Lo que se fija aquí es lo que no puede fallar sin que alguien pague multa: qué
 * meses tocan (y cuáles NO, los de antes de FacturAPI), qué tickets entran (ni
 * uno ya facturado, ni uno en cero), y que la caja pueda negarse a facturar un
 * ticket que ya está en la global.
 */
import { describe, expect, it } from "vitest";
import { pesos, sumar, type Centavos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas, type TasasSnapshot } from "../comun/impuestos.js";
import type { EventoComanda, FormaPago } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";
import type { Comprobante } from "../fiscal/comprobante.js";
import type { EventoFiscal, RegistroCfdi } from "../fiscal/eventos.js";
import {
  conceptosDeTicket,
  facturasGlobales,
  formaPagoDeLaGlobal,
  limitesDelPeriodo,
  ordenEnFacturaGlobal,
  partirEnFacturas,
  periodoDe,
  periodosPorEmitir,
  ticketPasaALaGlobal,
  ticketsParaGlobal,
  type TicketGlobal,
} from "../fiscal/global.js";
import { reporteContable } from "../finanzas/contador.js";

const CTX = { device_id: "d1", empleado_id: "usr-1", sucursal_id: "s1" };
const IEPS: TasasSnapshot = { tasa_iva: 0.16, tasa_ieps: 0.08, incluido: true };

function renglon(precio: number, cantidad = 1, impuesto = snapshotTasas(IVA_16)): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p", descripcion: "Algo", cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(1), impuesto, estado: "entregado",
  };
}

/** Una cuenta cobrada a una hora dada. */
function cobrada(
  cerrada: Date,
  renglones: RenglonComanda[],
  opciones: { forma?: FormaPago; extra?: (f: FabricaEventos<EventoComanda>, o: string) => EventoComanda[] } = {},
): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: cerrada.getTime() - 3_600_000 }),
    ...renglones.map((r) => f.crear("item_agregado", orden_id, { orden_id, renglon: r })),
    ...(opciones.extra?.(f, orden_id) ?? []),
  ];
  const total = totalesComanda(proyectarComanda(eventos)).total;
  eventos.push(f.crear("pago_registrado", orden_id, { orden_id, monto: total, forma: opciones.forma ?? "efectivo" }));
  const cierre = f.crear("cuenta_cerrada", orden_id, { orden_id });
  eventos.push({ ...cierre, ts: cerrada.getTime() });
  return proyectarComanda(eventos);
}

function registro(orden_id: string, estado: RegistroCfdi["estado"]): RegistroCfdi {
  return {
    cfdi_id: uuidv7(), orden_id, serie: "A", folio: "1", comprobante: {} as Comprobante,
    estado, intentos: 0, generado_ts: 0,
  };
}

function eventoGlobal(ordenes: string[], modo: "pruebas" | "produccion", periodo = "2026-09"): EventoFiscal {
  return new FabricaEventos<EventoFiscal>(CTX).crear("factura_global_emitida", "fiscal:s1", {
    periodo, parte: 1, uuid: uuidv7(), externo_id: "inv_1", ordenes, total: pesos(100), modo,
  });
}

describe("qué meses tocan", () => {
  it("el mes se cierra a las 06:00 del día 1 siguiente", () => {
    const { desde, hasta, vence } = limitesDelPeriodo("2026-09");
    expect(new Date(desde)).toEqual(new Date(2026, 8, 1));
    expect(new Date(hasta)).toEqual(new Date(2026, 9, 1));
    expect(new Date(vence)).toEqual(new Date(2026, 9, 1, 6));
    expect(periodoDe(new Date(2026, 11, 31, 23, 59).getTime())).toBe("2026-12");
    expect(limitesDelPeriodo("2026-12").vence).toBe(new Date(2027, 0, 1, 6).getTime());
  });

  it("solo los meses que cerraron después de conectar FacturAPI", () => {
    const desde_ts = new Date(2026, 8, 19, 12).getTime(); // conectado el 19 de septiembre
    const antes = periodosPorEmitir({ ahora: new Date(2026, 9, 1, 5, 59).getTime(), desde_ts, emitidos: new Set() });
    expect(antes).toEqual([]);

    const ahora = new Date(2026, 11, 2).getTime();
    expect(periodosPorEmitir({ ahora, desde_ts, emitidos: new Set() })).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    // Agosto ya lo resolvió el contador a mano: no se toca.
    expect(periodosPorEmitir({ ahora, desde_ts, emitidos: new Set(["2026-09"]) })).toEqual([
      "2026-10",
      "2026-11",
    ]);
  });

  it("conectado el día 1 de madrugada, el mes anterior todavía le toca", () => {
    const desde_ts = new Date(2026, 9, 1, 3).getTime();
    const ahora = new Date(2026, 9, 1, 7).getTime();
    expect(periodosPorEmitir({ ahora, desde_ts, emitidos: new Set() })).toEqual(["2026-09"]);
  });

  it("un ticket deja de poder facturarse a nombre de alguien cuando su mes cierra", () => {
    const cobro = new Date(2026, 8, 30, 23, 30).getTime();
    expect(ticketPasaALaGlobal(cobro, new Date(2026, 9, 1, 5).getTime())).toBe(false);
    expect(ticketPasaALaGlobal(cobro, new Date(2026, 9, 1, 6).getTime())).toBe(true);
  });
});

describe("qué tickets entran", () => {
  const SEP = (dia: number) => new Date(2026, 8, dia, 21);

  it("las cobradas del mes que nadie facturó, y ninguna otra", () => {
    const libre = cobrada(SEP(3), [renglon(249)]);
    const timbrada = cobrada(SEP(4), [renglon(100)]);
    const enCola = cobrada(SEP(5), [renglon(100)]);
    const rechazada = cobrada(SEP(6), [renglon(120)]);
    const cancelada = cobrada(SEP(7), [renglon(130)]);
    const deOctubre = cobrada(new Date(2026, 9, 1, 1), [renglon(90)]);
    const regalada = cobrada(SEP(8), [renglon(80)], {
      extra: (f, orden_id) => [f.crear("cortesia_otorgada", orden_id, { orden_id, motivo: "Casa" })],
    });
    const sinPrecio = cobrada(SEP(9), [renglon(0)]);
    const yaEnGlobal = cobrada(SEP(10), [renglon(70)]);

    const tickets = ticketsParaGlobal({
      periodo: "2026-09",
      comandas: [libre, timbrada, enCola, rechazada, cancelada, deOctubre, regalada, sinPrecio, yaEnGlobal],
      cfdis: [
        registro(timbrada.orden_id, "timbrado"),
        registro(enCola.orden_id, "generado"),
        registro(rechazada.orden_id, "rechazado"),
        registro(cancelada.orden_id, "cancelado"),
      ],
      globales: facturasGlobales([eventoGlobal([yaEnGlobal.orden_id], "produccion")]),
    });

    // Un CFDI rechazado nunca existió ante el SAT y uno cancelado dejó de valer:
    // esas ventas SÍ van a la global.
    expect(tickets.map((t) => t.orden_id)).toEqual([
      libre.orden_id,
      rechazada.orden_id,
      cancelada.orden_id,
    ]);
    expect(tickets[0]!.total).toBe(totalesComanda(libre).total);
  });

  it("un ticket con dos tasas va en dos líneas con el mismo número, y suma lo del ticket", () => {
    const c = cobrada(SEP(3), [renglon(249, 1, { ...snapshotTasas(IVA_16), incluido: true }), renglon(37, 3, IEPS)], {
      extra: (f, orden_id) => [
        f.crear("descuento_aplicado", orden_id, {
          orden_id, alcance: "cuenta", modo: "porcentaje", valor: 0.1, motivo: "x",
        }),
      ],
    });
    const conceptos = conceptosDeTicket(c);
    expect(conceptos).toHaveLength(2);
    expect(new Set(conceptos.map((x) => x.folio)).size).toBe(1);
    expect(sumar(...conceptos.map((x) => x.total))).toBe(totalesComanda(c).total);
    for (const x of conceptos) expect(x.base + x.iva + x.ieps).toBe(x.total);
  });

  it("la forma de pago es la de mayor importe, sin las «por definir»", () => {
    const t = (forma: FormaPago, monto: number): TicketGlobal => ({
      orden_id: uuidv7(), folio: "X", cerrada_ts: 0, total: pesos(monto), conceptos: [],
      pagos: [{ forma, monto: pesos(monto) }],
    });
    expect(formaPagoDeLaGlobal([t("efectivo", 100), t("tarjeta_debito", 300), t("efectivo", 150)])).toBe("28");
    expect(formaPagoDeLaGlobal([t("agregador", 9_000), t("efectivo", 10)])).toBe("01");
    expect(formaPagoDeLaGlobal([t("socio", 50)])).toBe("01");
  });

  it("un mes enorme se parte sin separar las líneas de un ticket", () => {
    const tickets: TicketGlobal[] = Array.from({ length: 7 }, () => ({
      orden_id: uuidv7(), folio: "X", cerrada_ts: 0, total: pesos(10), pagos: [],
      conceptos: [{}, {}] as never,
    }));
    const partes = partirEnFacturas(tickets, 5);
    expect(partes.map((p) => p.length)).toEqual([2, 2, 2, 1]);
  });
});

describe("la caja no factura dos veces la misma venta", () => {
  it("una orden en la global de producción queda bloqueada, con la global que la tiene", () => {
    const eventos = [eventoGlobal(["ord-1", "ord-2"], "produccion")];
    expect(ordenEnFacturaGlobal(eventos, "ord-2")?.periodo).toBe("2026-09");
    expect(ordenEnFacturaGlobal(eventos, "ord-3")).toBeNull();
  });

  it("una global de pruebas no bloquea nada", () => {
    expect(ordenEnFacturaGlobal([eventoGlobal(["ord-1"], "pruebas")], "ord-1")).toBeNull();
  });

  it("el mismo hecho repetido no cuenta como dos globales", () => {
    const e = eventoGlobal(["ord-1"], "produccion");
    expect(facturasGlobales([e, e])).toHaveLength(1);
  });
});

describe("el reporte del contador", () => {
  it("lo que entró en la global ya no es «venta sin facturar»", () => {
    const a = cobrada(new Date(2026, 8, 3, 21), [renglon(249)]);
    const b = cobrada(new Date(2026, 8, 4, 21), [renglon(100)]);
    const rango = { desde: new Date(2026, 8, 1).getTime(), hasta: new Date(2026, 9, 1).getTime() };
    const globales = facturasGlobales([eventoGlobal([a.orden_id], "produccion")]);

    const r = reporteContable([a, b], [], [], rango, globales);
    expect(r.global_facturado).toBe(totalesComanda(a).total);
    expect(r.sin_facturar).toBe(totalesComanda(b).total);

    // Sin globales, como antes.
    expect(reporteContable([a, b], [], [], rango).sin_facturar).toBe(
      (totalesComanda(a).total + totalesComanda(b).total) as Centavos,
    );
    // Una global de pruebas no descuenta nada.
    const deEnsayo = facturasGlobales([eventoGlobal([a.orden_id], "pruebas")]);
    expect(reporteContable([a, b], [], [], rango, deEnsayo).global_facturado).toBe(0);
  });
});
