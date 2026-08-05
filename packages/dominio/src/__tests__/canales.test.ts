/**
 * Canales de venta: el salón y lo que entra por Rappi, Uber Eats o DiDi.
 *
 * Lo que hay que probar es lo que hoy descuadra los números del restaurante:
 * que una venta de agregador NO sea efectivo en el cajón, que la comisión se
 * calcule sobre lo que de verdad cobran las plataformas, y que el histórico
 * conserve la comisión que se pactó entonces y no la de hoy.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { FabricaEventos } from "../evento.js";
import { calcularCorte, proyectarCaja } from "../caja/reducers.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { EventoCaja } from "../caja/eventos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { formaPagoSat } from "../fiscal/comprobante.js";
import {
  CANALES,
  comisionDe,
  configuracionPorDefecto,
  esAgregador,
  netoDeAgregador,
  porCobrarDeAgregadores,
  ventasPorCanal,
  type CanalVenta,
  type ConfiguracionCanal,
} from "../ventas/canales.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = 86_400_000;

const CONFIG: ConfiguracionCanal[] = [
  { canal: "rappi", activo: true, comision: 0.3, dias_deposito: 7 },
  { canal: "uber_eats", activo: true, comision: 0.25, dias_deposito: 14 },
];

function renglon(precio: number): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p1", descripcion: "Pizza", cantidad: 1,
    precio_unitario: pesos(precio), costo_unitario: pesos(60),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

function venta(opciones: {
  canal?: CanalVenta;
  precio: number;
  cerrada_ts?: number;
  comision?: number;
  cerrar?: boolean;
}): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden, {
      orden_id: orden,
      mesa_id: "mostrador",
      abierta_ts: AHORA - 3_600_000,
      canal: opciones.canal,
      comision_canal: opciones.comision,
    }),
    f.crear("item_agregado", orden, { orden_id: orden, renglon: renglon(opciones.precio) }),
  ];

  if (opciones.cerrar !== false) {
    const cierre = f.crear("cuenta_cerrada", orden, { orden_id: orden });
    (cierre as { ts: number }).ts = opciones.cerrada_ts ?? AHORA;
    eventos.push(cierre);
  }
  return proyectarComanda(eventos);
}

describe("el catálogo de canales", () => {
  it("distingue lo que cobra un tercero de lo que cobra el local", () => {
    expect(esAgregador("rappi")).toBe(true);
    expect(esAgregador("uber_eats")).toBe(true);
    expect(esAgregador("didi")).toBe(true);
    expect(esAgregador("salon")).toBe(false);
    expect(esAgregador("domicilio_propio")).toBe(false);
    expect(esAgregador(undefined)).toBe(false);
  });

  it("la configuración de fábrica trae los agregadores apagados", () => {
    const config = configuracionPorDefecto();
    expect(config.every((c) => !c.activo)).toBe(true);
    expect(config).toHaveLength(CANALES.filter((c) => c.esAgregador).length);
  });
});

// --- La comisión --------------------------------------------------------------------------

describe("lo que se lleva la plataforma", () => {
  /*
   * Sobre el TOTAL CON IVA, que es sobre lo que la cobran. Calcularla sobre el
   * subtotal daría un número más bonito y equivocado, y el restaurante
   * descubriría la diferencia al conciliar el depósito.
   */
  it("se calcula sobre el total, no sobre el subtotal", () => {
    expect(comisionDe(pesos(300), 0.3)).toBe(pesos(90));
    expect(netoDeAgregador(pesos(300), 0.3)).toBe(pesos(210));
  });

  it("la comisión más el neto siempre dan el total", () => {
    for (const [total, tasa] of [[299.99, 0.28], [1, 0.3], [1234.56, 0.255]] as const) {
      const t = pesos(total);
      expect(comisionDe(t, tasa) + netoDeAgregador(t, tasa)).toBe(t);
    }
  });

  it("una comisión absurda no rompe la cuenta", () => {
    expect(netoDeAgregador(pesos(100), -1)).toBe(pesos(100));
    expect(netoDeAgregador(pesos(100), 5)).toBe(CERO);
  });
});

// --- El cajón -----------------------------------------------------------------------------

describe("una venta de agregador NO es efectivo", () => {
  /*
   * EL CANDADO. Capturar un pedido de Rappi como si fuera efectivo hace que el
   * cajero aparezca con un sobrante enorme que no existe — y que le pidan
   * explicaciones por dinero que nunca pasó por sus manos.
   */
  it("no entra al efectivo esperado del cajón", () => {
    const c = new FabricaEventos<EventoComanda>(CTX);
    const caja = new FabricaEventos<EventoCaja>(CTX);
    const apertura = caja.crear("caja_abierta", "s1", {
      sesion_id: "s1", cajero_id: "usr-lucia", fondo_inicial: pesos(1000),
    });

    const corte = calcularCorte(proyectarCaja([apertura])!, [
      c.crear("pago_registrado", "o1", { orden_id: "o1", monto: pesos(200), forma: "efectivo" }),
      c.crear("pago_registrado", "o2", { orden_id: "o2", monto: pesos(500), forma: "agregador" }),
    ]);

    // Fondo 1000 + 200 en efectivo. Los 500 de la app no están en el cajón.
    expect(corte.efectivoEsperado).toBe(pesos(1200));
    // Pero SÍ son venta del día.
    expect(corte.totalVendido).toBe(pesos(700));
    expect(corte.cobrado.agregador).toBe(pesos(500));
  });

  /*
   * Para el SAT es "por definir": el restaurante no recibió el dinero del
   * comensal. Declararlo como efectivo o tarjeta sería declarar un cobro que no
   * ocurrió.
   */
  it("al SAT se le declara como por definir", () => {
    expect(formaPagoSat("agregador")).toBe("99");
    expect(formaPagoSat("efectivo")).toBe("01");
  });
});

// --- El reporte que hoy no existe ----------------------------------------------------------

describe("cuánto entró por cada canal", () => {
  it("separa el bruto, la comisión y lo que queda", () => {
    const resumen = ventasPorCanal(
      [
        venta({ canal: "rappi", precio: 300 }),
        venta({ canal: "rappi", precio: 200 }),
        venta({ precio: 400 }), // salón
      ],
      CONFIG,
    );

    const rappi = resumen.find((r) => r.canal === "rappi")!;
    expect(rappi.cuentas).toBe(2);
    expect(rappi.comision).toBeGreaterThan(0);
    expect(rappi.neto).toBe(rappi.bruto - rappi.comision);

    // El salón no paga comisión a nadie.
    const salon = resumen.find((r) => r.canal === "salon")!;
    expect(salon.comision).toBe(CERO);
    expect(salon.neto).toBe(salon.bruto);
  });

  /*
   * Cuando el restaurante renegocie su comisión, el histórico tiene que seguir
   * contando lo que de verdad le cobraron entonces. Si no, el reporte del mes
   * pasado cambia solo el día que se firma un contrato nuevo.
   */
  it("respeta la comisión que se pactó cuando se vendió", () => {
    const vieja = venta({ canal: "rappi", precio: 100, comision: 0.1 });
    const resumen = ventasPorCanal([vieja], CONFIG); // la config de hoy dice 30 %

    // $100 + IVA = $116, y el 10 % pactado entonces son $11.60. Con el 30 % de
    // hoy habrían salido $34.80: el reporte del mes pasado no puede cambiar
    // porque se firmó un contrato nuevo.
    expect(resumen[0]!.comision).toBe(pesos(11.6));
  });

  it("una cuenta abierta todavía no cuenta como venta", () => {
    const resumen = ventasPorCanal([venta({ canal: "rappi", precio: 300, cerrar: false })], CONFIG);
    expect(resumen).toEqual([]);
  });

  it("sin canal, se cuenta como salón", () => {
    const resumen = ventasPorCanal([venta({ precio: 100 })], CONFIG);
    expect(resumen[0]!.canal).toBe("salon");
  });
});

// --- Lo que las plataformas deben ----------------------------------------------------------

describe("cuánto le deben los agregadores al restaurante", () => {
  it("suma lo no depositado, ya sin comisión", () => {
    const deuda = porCobrarDeAgregadores(
      [
        venta({ canal: "rappi", precio: 300, cerrada_ts: AHORA - DIA }),
        venta({ canal: "uber_eats", precio: 200, cerrada_ts: AHORA - DIA }),
        venta({ precio: 500 }), // salón: no lo debe nadie
      ],
      CONFIG,
      AHORA,
    );

    expect(deuda.map((d) => d.canal).sort()).toEqual(["rappi", "uber_eats"]);
    const rappi = deuda.find((d) => d.canal === "rappi")!;
    expect(rappi.neto).toBe(netoDeAgregador(pesos(348), 0.3));
  });

  /*
   * Las plataformas depositan con retraso y con descuentos que nadie revisa,
   * porque no hay contra qué compararlos. Marcar lo vencido es ese contra-qué.
   */
  it("marca lo que ya debió haber llegado", () => {
    const deuda = porCobrarDeAgregadores(
      [
        venta({ canal: "rappi", precio: 300, cerrada_ts: AHORA - 20 * DIA }), // vencido
        venta({ canal: "rappi", precio: 300, cerrada_ts: AHORA - 2 * DIA }), // al corriente
      ],
      CONFIG,
      AHORA,
    );

    const rappi = deuda[0]!;
    expect(rappi.cuentas).toBe(2);
    expect(rappi.vencido).toBeGreaterThan(0);
    expect(rappi.vencido).toBeLessThan(rappi.neto);
  });

  it("cada plataforma tiene su propio plazo", () => {
    // A los 10 días, Rappi (7) ya venció y Uber (14) no.
    const deuda = porCobrarDeAgregadores(
      [
        venta({ canal: "rappi", precio: 100, cerrada_ts: AHORA - 10 * DIA }),
        venta({ canal: "uber_eats", precio: 100, cerrada_ts: AHORA - 10 * DIA }),
      ],
      CONFIG,
      AHORA,
    );

    expect(deuda.find((d) => d.canal === "rappi")!.vencido).toBeGreaterThan(0);
    expect(deuda.find((d) => d.canal === "uber_eats")!.vencido).toBe(CERO);
  });

  it("lo ya conciliado deja de deberse", () => {
    const conciliada = { ...venta({ canal: "rappi", precio: 300 }), depositado: true };
    expect(porCobrarDeAgregadores([conciliada], CONFIG, AHORA)).toEqual([]);
  });
});
