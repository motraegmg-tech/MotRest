/**
 * El reporte que pide el contador cada mes.
 *
 * Lo que más importa probar: que NO confunda lo vendido con lo facturado —en un
 * restaurante la mayoría no pide factura— y que las propinas queden fuera del
 * ingreso, porque son del personal. Un reporte que las sume estaría inflando la
 * base gravable del restaurante.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";
import { detalleCsv, reporteContable, resumenCsv } from "../finanzas/contador.js";
import { FabricaEventos } from "../evento.js";
import type { RegistroCfdi } from "../fiscal/eventos.js";

const CTX = { device_id: "d1", empleado_id: "usr-lucia", sucursal_id: "s1" };
const RANGO = {
  desde: new Date(2026, 6, 1).getTime(),
  hasta: new Date(2026, 7, 1).getTime(),
};

function cuenta(precio: number, propina = 0, forma: "efectivo" | "tarjeta_credito" = "efectivo") {
  const f = () => new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f().crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: RANGO.desde }),
    f().crear("item_agregado", orden_id, {
      orden_id,
      renglon: {
        id: uuidv7(), producto_id: "p1", descripcion: "Pizza", cantidad: 1,
        precio_unitario: pesos(precio), costo_unitario: pesos(60),
        impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
  ];
  if (propina > 0) {
    eventos.push(f().crear("propina_registrada", orden_id, { orden_id, monto: pesos(propina) }));
  }
  // Se paga el TOTAL con IVA, que es lo que de verdad cobra la caja.
  const conIva = proyectarComanda(eventos);
  eventos.push(
    f().crear("pago_registrado", orden_id, {
      orden_id,
      monto: totalesComanda(conIva).total,
      forma,
    }),
    f().crear("cuenta_cerrada", orden_id, { orden_id }),
  );
  return proyectarComanda(eventos);
}

const VENTAS: EstadoComanda[] = [
  cuenta(249, 50),
  cuenta(180, 0, "tarjeta_credito"),
  cuenta(100),
];

describe("venta del periodo", () => {
  it("suma las cuentas cobradas", () => {
    const r = reporteContable(VENTAS, [], [], RANGO);
    expect(r.cuentas).toBe(3);
    expect(r.total).toBe(pesos(613.64));
  });

  /*
   * Las propinas son del personal, no del negocio. Sumarlas al ingreso inflaría
   * la base gravable del restaurante con dinero que no es suyo.
   */
  it("las propinas van aparte, nunca dentro del total", () => {
    const r = reporteContable(VENTAS, [], [], RANGO);
    expect(r.propinas).toBe(pesos(50));
    expect(r.total).toBe(pesos(613.64)); // sin la propina
  });

  it("desglosa cómo se cobró, de mayor a menor", () => {
    const r = reporteContable(VENTAS, [], [], RANGO);
    expect(r.por_forma_pago[0]!.forma).toBe("efectivo");
    expect(r.por_forma_pago[0]!.importe).toBe(pesos(404.84)); // (249+100) * 1.16
    expect(r.por_forma_pago.find((f) => f.forma === "tarjeta_credito")!.importe).toBe(pesos(208.8));
  });
});

// --- Lo vendido contra lo facturado ---------------------------------------------------------

describe("facturado contra vendido", () => {
  function cfdi(total: number, estado: "timbrado" | "cancelado" | "rechazado"): RegistroCfdi {
    return {
      cfdi_id: uuidv7(), serie: "AKP", folio: "1001", estado,
      generado_ts: RANGO.desde + 3600_000, intentos: 0,
      comprobante: {
        total: pesos(total), total_impuestos_trasladados: pesos(total * 0.16 / 1.16),
      },
    } as unknown as RegistroCfdi;
  }

  /* El número que el contador busca primero: la base de la factura global. */
  it("lo que NO se facturó es la base de la factura global", () => {
    const r = reporteContable(VENTAS, [cfdi(249, "timbrado")], [], RANGO);
    expect(r.cfdi_timbrados).toBe(1);
    expect(r.sin_facturar).toBe(pesos(613.64 - 249));
  });

  it("un CFDI rechazado no cuenta como facturado", () => {
    const r = reporteContable(VENTAS, [cfdi(249, "rechazado")], [], RANGO);
    expect(r.cfdi_timbrados).toBe(0);
    expect(r.sin_facturar).toBe(pesos(613.64));
  });

  it("los cancelados se cuentan aparte", () => {
    const r = reporteContable(VENTAS, [cfdi(249, "cancelado")], [], RANGO);
    expect(r.cfdi_cancelados).toBe(1);
    expect(r.cfdi_timbrados).toBe(0);
  });

  /*
   * Facturar una venta de ayer dentro de este mes no puede dar un "sin
   * facturar" negativo: seria un numero sin sentido en el reporte.
   */
  it("nunca da negativo aunque se facture más de lo vendido en el periodo", () => {
    const r = reporteContable(VENTAS, [cfdi(9999, "timbrado")], [], RANGO);
    expect(r.sin_facturar).toBe(pesos(0));
  });

  it("ignora los CFDI de otro periodo", () => {
    const viejo = { ...cfdi(249, "timbrado"), generado_ts: RANGO.desde - 86_400_000 };
    expect(reporteContable(VENTAS, [viejo], [], RANGO).cfdi_timbrados).toBe(0);
  });
});

// --- El archivo que se abre en Excel ---------------------------------------------------------

describe("exportación", () => {
  const r = reporteContable(VENTAS, [], [], RANGO);

  /*
   * Excel en español usa la coma como separador DECIMAL: con comas, "529.00"
   * se partiría en dos columnas y el reporte llegaría roto.
   */
  it("separa con punto y coma, no con coma", () => {
    const csv = resumenCsv(r);
    expect(csv).toContain(";");
    expect(csv).toContain("613.64");
  });

  /* Sin BOM, Excel muestra «Cortesias» con los acentos rotos. */
  it("lleva BOM para que Excel lea los acentos", () => {
    expect(resumenCsv(r).charCodeAt(0)).toBe(0xfeff);
    expect(detalleCsv(VENTAS).charCodeAt(0)).toBe(0xfeff);
  });

  it("el resumen trae lo que el contador busca", () => {
    const csv = resumenCsv(r);
    expect(csv).toMatch(/IVA trasladado/);
    expect(csv).toMatch(/SIN facturar/);
    expect(csv).toMatch(/PROPINAS/);
  });

  it("el detalle trae una fila por cuenta, más el encabezado", () => {
    const lineas = detalleCsv(VENTAS).split("\r\n");
    expect(lineas).toHaveLength(VENTAS.length + 1);
    expect(lineas[0]).toMatch(/^\uFEFFFecha;Folio;Mesa/);
  });

  it("marca las cuentas reabiertas, que hay que revisar", () => {
    const reabierta = { ...VENTAS[0]!, reabierta: true };
    expect(detalleCsv([reabierta])).toMatch(/SI/);
    expect(reporteContable([reabierta], [], [], RANGO).cuentas_reabiertas).toBe(1);
  });
});
