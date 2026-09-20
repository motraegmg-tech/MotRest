/**
 * El CFDI tiene que decir lo mismo que el ticket.
 *
 * Con la cortesía por renglón y por piezas —«regálale una de las tres
 * cervezas»— el prorrateo parejo que se hacía antes repartía el regalo entre
 * todos los platillos: el total cuadraba, pero cada concepto mentía un poco. Y
 * con los productos de $0 aparecía un concepto con valor unitario cero, que el
 * SAT rechaza en un comprobante de ingreso. Aquí se fija lo que el comensal y el
 * contador van a comparar: renglón por renglón y al centavo.
 */
import { describe, expect, it } from "vitest";
import { pesos, sumar } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas, type TasasSnapshot } from "../comun/impuestos.js";
import { indexar, type CatalogoIndex } from "../catalogo/productos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";
import { construirComprobante, type Comprobante } from "../fiscal/comprobante.js";
import { validarComprobante } from "../fiscal/validacion.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };

const cat: CatalogoIndex = indexar({
  productos: [],
  categorias: [{ id: "c1", nombre: "Todo", orden: 1 }],
  impuestos: [IVA_16],
});

const EMISOR = {
  rfc: "MOT210101AB1",
  nombre: "RODIZIO SA DE CV",
  regimen_fiscal: "601",
  codigo_postal: "44100",
};
const RECEPTOR = {
  rfc: "GODE561231GR8",
  nombre: "JUAN PEREZ LOPEZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
};

/** IVA dentro del precio de carta: como captura Rodizio desde agosto de 2026. */
const IVA_INCLUIDO: TasasSnapshot = { tasa_iva: 0.16, tasa_ieps: 0, incluido: true };

function renglon(
  nombre: string,
  precio: number,
  cantidad: number,
  impuesto: TasasSnapshot = snapshotTasas(IVA_16),
): RenglonComanda {
  return {
    id: uuidv7(),
    producto_id: `p-${nombre}`,
    descripcion: nombre,
    cantidad,
    precio_unitario: pesos(precio),
    costo_unitario: pesos(1),
    impuesto,
    estado: "entregado",
  };
}

/** Arma una cuenta y deja que cada prueba le añada lo que necesite. */
function cuenta(
  renglones: RenglonComanda[],
  extra: (f: FabricaEventos<EventoComanda>, orden_id: string) => EventoComanda[] = () => [],
) {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: 1 }),
    ...renglones.map((r) => f.crear("item_agregado", orden_id, { orden_id, renglon: r })),
    ...extra(f, orden_id),
  ];
  return proyectarComanda(eventos);
}

function cfdiDe(estado: ReturnType<typeof cuenta>): Comprobante {
  return construirComprobante(estado, cat, {
    serie: "A",
    folio: "1",
    emisor: EMISOR,
    receptor: RECEPTOR,
  });
}

/** Las reglas de cuadre que el SAT revisa y que el ticket también tiene que cumplir. */
function cuadra(cfdi: Comprobante): void {
  expect(sumar(...cfdi.conceptos.map((c) => c.importe))).toBe(cfdi.subtotal);
  expect(sumar(...cfdi.conceptos.map((c) => c.descuento))).toBe(cfdi.descuento);
  expect(cfdi.subtotal - cfdi.descuento + cfdi.total_impuestos_trasladados).toBe(cfdi.total);
  for (const c of cfdi.conceptos) {
    expect(c.descuento).toBeGreaterThanOrEqual(0);
    expect(c.descuento).toBeLessThanOrEqual(c.importe);
    expect(c.valor_unitario).toBeGreaterThan(0);
    for (const t of c.traslados) {
      // Importe − Descuento es exactamente la base gravada, sin un centavo de más.
      expect(t.base).toBe(c.importe - c.descuento);
      expect(t.base).toBeGreaterThan(0);
    }
  }
}

describe("la cortesía cae en su renglón", () => {
  it("tres cervezas, una regalada, y un 10 % de cuenta: cuadra con el ticket", () => {
    const pizza = renglon("Pizza", 249, 1);
    const cerveza = renglon("Cerveza", 45, 3);
    const estado = cuenta([pizza, cerveza], (f, orden_id) => [
      f.crear("cortesia_otorgada", orden_id, {
        orden_id,
        renglon_id: cerveza.id,
        cantidad: 1,
        motivo: "Cliente frecuente",
      }),
      f.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "cuenta",
        modo: "porcentaje",
        valor: 0.1,
        motivo: "Promo",
      }),
    ]);

    const cfdi = cfdiDe(estado);
    const ticket = totalesComanda(estado);

    expect(cfdi.total).toBe(ticket.total);
    expect(validarComprobante(cfdi)).toEqual([]);
    cuadra(cfdi);

    const [cPizza, cCerveza] = cfdi.conceptos;
    // La pizza solo lleva su parte del 10 %: 249 − 24.90 = 224.10.
    expect(cPizza!.importe).toBe(pesos(249));
    expect(cPizza!.descuento).toBe(pesos(24.9));
    // La cerveza, la pieza regalada (45) más el 10 % de las dos que se cobran (9).
    expect(cCerveza!.importe).toBe(pesos(135));
    expect(cCerveza!.descuento).toBe(pesos(54));
    expect(cCerveza!.cantidad).toBe(3);
  });

  it("con el IVA dentro del precio también cuadra al centavo", () => {
    const pizza = renglon("Pizza", 249, 1, IVA_INCLUIDO);
    const cerveza = renglon("Cerveza", 49, 3, IVA_INCLUIDO);
    const refresco = renglon("Refresco", 37, 2, IVA_INCLUIDO);
    const estado = cuenta([pizza, cerveza, refresco], (f, orden_id) => [
      f.crear("cortesia_otorgada", orden_id, {
        orden_id,
        renglon_id: cerveza.id,
        cantidad: 1,
        motivo: "Cumpleaños",
      }),
      f.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "renglon",
        renglon_id: refresco.id,
        modo: "monto",
        valor: pesos(7),
        motivo: "Ajuste",
      }),
      f.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "cuenta",
        modo: "porcentaje",
        valor: 0.15,
        motivo: "Promo",
      }),
    ]);

    const cfdi = cfdiDe(estado);
    expect(cfdi.total).toBe(totalesComanda(estado).total);
    expect(validarComprobante(cfdi)).toEqual([]);
    cuadra(cfdi);
  });

  it("un descuento de renglón no toca a los demás conceptos", () => {
    const pizza = renglon("Pizza", 249, 1);
    const limonada = renglon("Limonada", 45, 2);
    const estado = cuenta([pizza, limonada], (f, orden_id) => [
      f.crear("descuento_aplicado", orden_id, {
        orden_id,
        alcance: "renglon",
        renglon_id: limonada.id,
        modo: "porcentaje",
        valor: 0.5,
        motivo: "2x1",
      }),
    ]);

    const cfdi = cfdiDe(estado);
    expect(cfdi.conceptos[0]!.descuento).toBe(0);
    expect(cfdi.conceptos[1]!.descuento).toBe(pesos(45));
    expect(cfdi.total).toBe(totalesComanda(estado).total);
    cuadra(cfdi);
  });

  it("un renglón regalado entero se queda, con descuento igual al importe y sin traslado", () => {
    const pizza = renglon("Pizza", 249, 1);
    const postre = renglon("Postre", 85, 1);
    const estado = cuenta([pizza, postre], (f, orden_id) => [
      f.crear("cortesia_otorgada", orden_id, {
        orden_id,
        renglon_id: postre.id,
        motivo: "Cortesía de la casa",
      }),
    ]);

    const cfdi = cfdiDe(estado);
    const cPostre = cfdi.conceptos.find((c) => c.descripcion === "Postre")!;
    expect(cPostre.importe).toBe(pesos(85));
    expect(cPostre.descuento).toBe(pesos(85));
    // Una base de cero no se puede declarar: sale como «no objeto de impuesto».
    expect(cPostre.traslados).toEqual([]);
    expect(cPostre.objeto_imp).toBe("01");
    expect(cfdi.total).toBe(totalesComanda(estado).total);
    expect(validarComprobante(cfdi)).toEqual([]);
    cuadra(cfdi);
  });

  /*
   * Un barrido de cuentas «feas» —precios con IVA dentro que no despejan
   * redondo, cantidades impares, varias rebajas a la vez— contra el ticket. Es
   * donde un doble redondeo aparece como un centavo de diferencia.
   */
  it("en un barrido de cuentas raras el total nunca se aparta del ticket", () => {
    const precios = [7, 19.9, 33.5, 99, 128, 249, 17.35];
    for (let i = 0; i < precios.length; i++) {
      for (const cantidad of [1, 2, 3, 7]) {
        const a = renglon("A", precios[i]!, cantidad, IVA_INCLUIDO);
        const b = renglon("B", precios[(i + 3) % precios.length]!, 3, IVA_INCLUIDO);
        const c = renglon("C", precios[(i + 5) % precios.length]!, 1);
        const estado = cuenta([a, b, c], (f, orden_id) => [
          f.crear("cortesia_otorgada", orden_id, {
            orden_id,
            renglon_id: b.id,
            cantidad: 1,
            motivo: "x",
          }),
          f.crear("descuento_aplicado", orden_id, {
            orden_id,
            alcance: "renglon",
            renglon_id: a.id,
            modo: "porcentaje",
            valor: 0.07,
            motivo: "x",
          }),
          f.crear("descuento_aplicado", orden_id, {
            orden_id,
            alcance: "cuenta",
            modo: "porcentaje",
            valor: 0.13,
            motivo: "x",
          }),
        ]);
        const cfdi = cfdiDe(estado);
        expect(cfdi.total).toBe(totalesComanda(estado).total);
        cuadra(cfdi);
      }
    }
  });
});

describe("productos de $0", () => {
  it("no entran como concepto: el SAT exige valor unitario mayor que cero", () => {
    const pizza = renglon("Pizza", 249, 1);
    const salsa = renglon("Salsa extra", 0, 2);
    const cfdi = cfdiDe(cuenta([pizza, salsa]));

    expect(cfdi.conceptos.map((c) => c.descripcion)).toEqual(["Pizza"]);
    expect(validarComprobante(cfdi)).toEqual([]);
    cuadra(cfdi);
  });

  it("una cuenta de puros productos de $0 dice que no hay nada que facturar", () => {
    const cfdi = cfdiDe(cuenta([renglon("Pan de la casa", 0, 1)]));
    expect(cfdi.conceptos).toEqual([]);
    const problemas = validarComprobante(cfdi);
    expect(problemas.some((p) => /No hay nada que facturar/.test(p.mensaje))).toBe(true);
  });

  it("una cortesía de la cuenta completa tampoco se factura, y lo dice en claro", () => {
    const estado = cuenta([renglon("Pizza", 249, 1)], (f, orden_id) => [
      f.crear("cortesia_otorgada", orden_id, { orden_id, motivo: "Invita la casa" }),
    ]);
    const cfdi = cfdiDe(estado);
    expect(cfdi.total).toBe(0);
    const problemas = validarComprobante(cfdi);
    expect(problemas.find((p) => p.campo === "totales")?.mensaje).toMatch(/No hay nada que facturar/);
  });
});
