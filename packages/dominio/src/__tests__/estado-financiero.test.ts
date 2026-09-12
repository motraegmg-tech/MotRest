/**
 * El estado financiero del mes, armado desde los hechos.
 *
 * Lo que se prueba aquí es la separación que más dinero le cuesta a un
 * restaurante y que el informe tiene que dejar clarísima: **el resultado y el
 * dinero no son el mismo número**. Comprar cien kilos de queso no empeora la
 * utilidad —es inventario— pero sí baja la caja. Un informe que los mezclara
 * llevaría a cerrar un mes bueno creyendo que fue malo.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { EventoCaja } from "../caja/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { uuidv7 } from "../comun/ids.js";
import { proyectarSesiones as sesionesDe } from "../caja/reducers.js";
import { proyectarEgresos, type EventoEgreso } from "../finanzas/egresos.js";
import { armarEstadoFinanciero } from "../finanzas/estado-financiero.js";
import type { EventoTesoreria } from "../finanzas/tesoreria.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-gerente", sucursal_id: "suc-1" };
const fComanda = () => new FabricaEventos<EventoComanda>(CTX);
const fCaja = () => new FabricaEventos<EventoCaja>(CTX);
const fEgreso = () => new FabricaEventos<EventoEgreso>(CTX);
const fTesoreria = () => new FabricaEventos<EventoTesoreria>(CTX);

const SEPTIEMBRE = {
  desde: new Date("2026-09-01T06:00:00Z").getTime(),
  hasta: new Date("2026-10-01T06:00:00Z").getTime(),
};

/**
 * Una cuenta cobrada, con su platillo y su forma de pago.
 *
 * El platillo NO es decorado: `reporteContable` suma los renglones —lo que se
 * vendio— y no los pagos, asi que una cuenta sin platillos vale cero por mas
 * que se haya cobrado. Son dos lecturas distintas del mismo hecho y las dos
 * hacen falta: la venta sale de la carta, el dinero sale del cobro.
 */
function cuenta(id: string, precio: number, forma: "efectivo" | "tarjeta_credito") {
  const eventos: EventoComanda[] = [
    fComanda().crear("orden_creada", id, {
      orden_id: id,
      mesa_id: "m1",
      abierta_ts: SEPTIEMBRE.desde + 86_400_000,
    }),
    fComanda().crear("item_agregado", id, {
      orden_id: id,
      renglon: {
        id: uuidv7(),
        producto_id: "p1",
        descripcion: "Pizza",
        cantidad: 1,
        precio_unitario: pesos(precio),
        costo_unitario: pesos(precio * 0.3),
        impuesto: snapshotTasas(IVA_16),
        estado: "entregado",
      },
    }),
  ];
  // Se cobra el TOTAL con IVA, que es lo que de verdad entra a la caja.
  const total = totalesComanda(proyectarComanda(eventos)).total;
  eventos.push(
    fComanda().crear("pago_registrado", id, { orden_id: id, monto: total, forma }),
    fComanda().crear("cuenta_cerrada", id, { orden_id: id }),
  );
  return proyectarComanda(eventos);
}

describe("estado financiero del mes", () => {
  const comandas = [cuenta("ord-1", 1_000, "efectivo"), cuenta("ord-2", 600, "tarjeta_credito")];

  /*
   * Dos gastos que se comportan de forma opuesta a propósito: la compra de
   * insumos NO resta a la utilidad pero sí a la caja; la luz resta a las dos.
   */
  const egresos = proyectarEgresos([
    fEgreso().crear("egreso_registrado", "finanzas:suc-1", {
      egreso_id: "eg-queso",
      categoria: "insumos",
      concepto: "Quesos del mes",
      monto: pesos(800),
      forma_pago: "efectivo",
    }),
    fEgreso().crear("egreso_registrado", "finanzas:suc-1", {
      egreso_id: "eg-luz",
      categoria: "servicios",
      concepto: "Luz",
      monto: pesos(300),
      forma_pago: "transferencia",
    }),
  ]);

  const fuentes = {
    local: "Rodizio",
    comandas,
    egresos,
    cfdis: [],
    sesiones: [],
    tesoreria: [] as EventoTesoreria[],
  };

  const estado = armarEstadoFinanciero(fuentes, SEPTIEMBRE, SEPTIEMBRE.hasta);

  it("recoge la venta y cómo se cobró", () => {
    expect(estado.ventas.cuentas).toBe(2);
    // Los precios de carta son 1 000 y 600; se cobra con el IVA encima.
    expect(estado.ventas.subtotal).toBe(pesos(1_600));
    expect(estado.ventas.iva).toBe(pesos(256));
    expect(estado.ventas.total).toBe(pesos(1_856));
    expect(estado.ventas.por_forma_pago).toHaveLength(2);
  });

  it("desglosa los gastos por categoría, con sus renglones dentro", () => {
    expect(estado.total_gastos).toBe(pesos(1_100));
    const insumos = estado.gastos.find((g) => g.categoria === "insumos");
    expect(insumos?.renglones).toHaveLength(1);
    expect(insumos?.afectaResultado).toBe(false);
  });

  it("la compra de insumos NO resta a la utilidad", () => {
    // Solo la luz baja el resultado. Restar también el queso pondría en pérdida
    // cualquier mes de surtido, que es el error clásico.
    expect(estado.resultado.egresos_operativos).toBe(pesos(300));
    expect(estado.resultado.compras).toBe(pesos(800));
  });

  it("pero SÍ baja el dinero: los mil cien salieron de la caja", () => {
    expect(estado.flujo.salidas).toBe(pesos(1_100));
    // Entra lo COBRADO, con IVA: es lo que de verdad llega al cajón y al banco.
    expect(estado.flujo.entradas).toBe(pesos(1_856));
    expect(estado.flujo.neto).toBe(pesos(756));
  });

  it("separa el efectivo del banco al cerrar el mes", () => {
    // Efectivo: 1 160 cobrados − 800 del queso. Banco: 696 − 300 de la luz.
    // El queso se pagó en efectivo y la luz por transferencia: cada gasto baja
    // SU cuenta, y ahí está la razón de llevar dos saldos y no uno.
    expect(estado.flujo.final.efectivo).toBe(pesos(360));
    expect(estado.flujo.final.banco).toBe(pesos(396));
  });

  it("cada movimiento trae su saldo arrastrado", () => {
    expect(estado.flujo.movimientos.length).toBe(4);
    for (const m of estado.flujo.movimientos) {
      expect(typeof m.saldo).toBe("number");
    }
  });

  it("un mes sin nada no revienta y devuelve ceros", () => {
    const vacio = armarEstadoFinanciero(
      { local: "Rodizio", comandas: [], egresos: [], cfdis: [], sesiones: [], tesoreria: [] },
      SEPTIEMBRE,
      SEPTIEMBRE.hasta,
    );
    expect(vacio.total_gastos).toBe(CERO);
    expect(vacio.ventas.cuentas).toBe(0);
    expect(vacio.gastos).toHaveLength(0);
    expect(vacio.cortes.turnos).toBe(0);
  });
});

describe("el gasto a crédito en el informe", () => {
  it("cuenta como gasto del mes pero no como salida de dinero", () => {
    const egresos = proyectarEgresos([
      fEgreso().crear("egreso_registrado", "finanzas:suc-1", {
        egreso_id: "eg-deuda",
        categoria: "insumos",
        concepto: "Pedido a crédito",
        monto: pesos(2_000),
        forma_pago: "transferencia",
        pagado: false,
      }),
    ]);

    const estado = armarEstadoFinanciero(
      { local: "Rodizio", comandas: [], egresos, cfdis: [], sesiones: [], tesoreria: [] },
      SEPTIEMBRE,
      SEPTIEMBRE.hasta,
    );

    // El gasto está en el desglose del mes…
    expect(estado.total_gastos).toBe(pesos(2_000));
    // …pero el dinero sigue en el banco, y el informe lo dice como deuda.
    expect(estado.flujo.salidas).toBe(CERO);
    expect(estado.por_pagar).toBe(pesos(2_000));
    expect(estado.documentos_por_pagar).toBe(1);
  });
});

describe("los cortes del mes en el informe", () => {
  it("resume los turnos cerrados y su diferencia", () => {
    const eventos = [
      fCaja().crear("caja_abierta", "s1", {
        sesion_id: "s1",
        cajero_id: "usr-cajero",
        fondo_inicial: pesos(1_000),
      }),
      fCaja().crear("arqueo_registrado", "s1", { sesion_id: "s1", declarado: pesos(950) }),
      fCaja().crear("caja_cerrada", "s1", {
        sesion_id: "s1",
        diferencia: pesos(-50),
        resumen: {
          sesion_id: "s1",
          cajero_id: "usr-cajero",
          abierta_ts: SEPTIEMBRE.desde + 3_600_000,
          cerrada_ts: SEPTIEMBRE.desde + 40_000_000,
          fondo_inicial: pesos(1_000),
          total_vendido: CERO,
          efectivo_esperado: pesos(1_000),
          declarado: pesos(950),
          diferencia: pesos(-50),
          propinas: CERO,
          cuentas_cerradas: 0,
        },
        sello: "abc",
      }),
    ];

    const estado = armarEstadoFinanciero(
      {
        local: "Rodizio",
        comandas: [],
        egresos: [],
        cfdis: [],
        sesiones: sesionesDe(eventos),
        tesoreria: [],
      },
      SEPTIEMBRE,
      SEPTIEMBRE.hasta,
    );

    expect(estado.cortes.turnos).toBe(1);
    expect(estado.cortes.turnos_abiertos).toBe(0);
    expect(estado.cortes.diferencia).toBe(pesos(-50));
  });

  describe("un mes al que le retiraron historial", () => {
    /*
     * El informe es el papel que acaba en manos de un contador. Si la
     * retención ya borró las cuentas del período, sale con números pequeños
     * —no con un error—, y eso se firma y se entrega sin sospechar nada.
     *
     * Se comprueban las dos mitades del arreglo: que el papel lo DIGA, y que
     * el dinero al cierre NO se desplome por haber borrado ventas viejas.
     */
    const conArrastre = (hasta: number) =>
      armarEstadoFinanciero(
        {
          local: "Rodizio",
          comandas: [],
          egresos: [],
          cfdis: [],
          sesiones: [],
          tesoreria: [],
          arrastre: { efectivo: pesos(20_000), banco: pesos(30_000), hasta },
        },
        SEPTIEMBRE,
        SEPTIEMBRE.hasta,
      );

    it("se marca como incompleto y dice hasta cuándo", () => {
      const estado = conArrastre(SEPTIEMBRE.desde + 5 * 86_400_000);
      expect(estado.periodo_incompleto).toBe(true);
      expect(estado.historial_retirado_hasta).toBe(SEPTIEMBRE.desde + 5 * 86_400_000);
    });

    it("el dinero al cierre NO se desploma: el arrastre lo sostiene", () => {
      // Sin esto el papel diría que el restaurante tiene $0 y alguien lo creería.
      const estado = conArrastre(SEPTIEMBRE.desde + 5 * 86_400_000);
      expect(estado.flujo.final.total).toBe(pesos(50_000));
      expect(estado.flujo.final.efectivo).toBe(pesos(20_000));
    });

    it("un mes POSTERIOR a lo retirado está completo", () => {
      /*
       * Es lo que evita que el aviso salga para siempre. Retirado hasta marzo,
       * el informe de septiembre tiene todas sus cuentas: avisar ahí enseñaría
       * a ignorar el aviso justo antes del mes en que sí importa.
       */
      const estado = conArrastre(SEPTIEMBRE.desde - 90 * 86_400_000);
      expect(estado.periodo_incompleto).toBe(false);
      // Pero el dinero sigue contando lo retirado: el saldo es del restaurante, no del mes.
      expect(estado.flujo.final.total).toBe(pesos(50_000));
    });

    it("sin purga alguna, ni aviso ni fecha", () => {
      const estado = armarEstadoFinanciero(
        { local: "Rodizio", comandas: [], egresos: [], cfdis: [], sesiones: [], tesoreria: [] },
        SEPTIEMBRE,
        SEPTIEMBRE.hasta,
      );
      expect(estado.periodo_incompleto).toBe(false);
      expect(estado.historial_retirado_hasta).toBe(0);
    });
  });
});
