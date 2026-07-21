/**
 * Totales de la cuenta, en centavos exactos.
 *
 * El impuesto se desglosa RENGLÓN POR RENGLÓN con el snapshot de tasas que cada
 * uno congeló: en una misma cuenta puede haber alimentos al 16 %, productos al
 * 0 % y bebidas con IEPS. Sumar todo y aplicar una sola tasa daría mal.
 *
 * Descuentos y cortesías reducen la base ANTES de calcular el impuesto, que es
 * como se factura en México: no se cobra IVA sobre lo que no se cobró.
 */
import { CERO, porFraccion, restar, sumar, type Centavos } from "../comun/dinero.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import type { ID } from "../comun/ids.js";
import { renglonesActivos, type Descuento, type EstadoComanda } from "./reducers.js";
import { costoRenglon, importeRenglon, type RenglonComanda } from "./renglon.js";

export interface TotalesComanda {
  /** Suma de importes de línea, antes de impuestos y de rebajas. */
  bruto: Centavos;
  /** Lo rebajado por descuentos. */
  descuentos: Centavos;
  /** Lo regalado como cortesía. */
  cortesias: Centavos;
  /** Base gravable: bruto − descuentos − cortesías. */
  subtotal: Centavos;
  iva: Centavos;
  ieps: Centavos;
  /** Lo que se cobra al comensal, sin propina. */
  total: Centavos;
  /** Costo de los insumos/platillos (las cortesías también cuestan). */
  costo: Centavos;
  /** Margen bruto como fracción (0..1), sobre el subtotal. */
  margen: number;
  propina: Centavos;
  pagado: Centavos;
  /** Lo que falta por cobrar (total + propina − pagado). */
  saldo: Centavos;
  /** Cambio a devolver cuando se recibió más efectivo del debido. */
  cambio: Centavos;
}

/** Renglones que quedaron cubiertos por una cortesía. */
function idsEnCortesia(estado: EstadoComanda): Set<ID> {
  const ids = new Set<ID>();
  for (const cortesia of estado.cortesias) {
    if (cortesia.renglon_id) ids.add(cortesia.renglon_id);
  }
  return ids;
}

/** Aplica un descuento a un importe. */
function rebajaDe(descuento: Descuento, base: Centavos): Centavos {
  return descuento.modo === "porcentaje"
    ? porFraccion(base, descuento.valor)
    : (Math.min(descuento.valor, base) as Centavos);
}

export function totalesComanda(estado: EstadoComanda): TotalesComanda {
  const activos = renglonesActivos(estado);
  const enCortesia = idsEnCortesia(estado);
  const cortesiaTotal = estado.cortesias.some((c) => !c.renglon_id);

  // Descuentos por renglón, para restarlos antes del impuesto.
  const rebajaPorRenglon = new Map<ID, Centavos>();
  for (const descuento of estado.descuentos) {
    if (descuento.alcance !== "renglon" || !descuento.renglon_id) continue;
    const renglon = activos.find((r) => r.id === descuento.renglon_id);
    if (!renglon) continue;
    const previa = rebajaPorRenglon.get(renglon.id) ?? CERO;
    const base = restar(importeRenglon(renglon), previa);
    rebajaPorRenglon.set(renglon.id, sumar(previa, rebajaDe(descuento, base)));
  }

  let bruto = CERO;
  let cortesias = CERO;
  let descuentos = CERO;
  let costo = CERO;

  /** Base de cada renglón ya rebajada, para prorratear el impuesto. */
  const bases: { renglon: RenglonComanda; base: Centavos }[] = [];

  for (const renglon of activos) {
    const importe = importeRenglon(renglon);
    bruto = sumar(bruto, importe);
    costo = sumar(costo, costoRenglon(renglon));

    if (cortesiaTotal || enCortesia.has(renglon.id)) {
      cortesias = sumar(cortesias, importe);
      bases.push({ renglon, base: CERO });
      continue;
    }

    const rebaja = rebajaPorRenglon.get(renglon.id) ?? CERO;
    descuentos = sumar(descuentos, rebaja);
    bases.push({ renglon, base: restar(importe, rebaja) });
  }

  // Descuentos sobre el total de la cuenta: se prorratean entre los renglones
  // que aún tienen base, para que el impuesto quede correcto en cada tasa.
  const descuentosDeCuenta = estado.descuentos.filter((d) => d.alcance === "cuenta");
  if (descuentosDeCuenta.length > 0) {
    for (const descuento of descuentosDeCuenta) {
      const baseTotal = bases.reduce((acc, b) => sumar(acc, b.base), CERO);
      if (baseTotal <= 0) break;
      const rebaja = rebajaDe(descuento, baseTotal);
      descuentos = sumar(descuentos, rebaja);

      let repartido = CERO;
      bases.forEach((b, i) => {
        if (b.base <= 0) return;
        const esUltimo = i === bases.length - 1;
        // El último absorbe el residuo para que la suma cuadre al centavo.
        const parte = esUltimo
          ? restar(rebaja, repartido)
          : (Math.round((rebaja * b.base) / baseTotal) as Centavos);
        const aplicada = Math.min(parte, b.base) as Centavos;
        b.base = restar(b.base, aplicada);
        repartido = sumar(repartido, aplicada);
      });
    }
  }

  let subtotal = CERO;
  let iva = CERO;
  let ieps = CERO;

  for (const { renglon, base } of bases) {
    if (base <= 0) continue;
    const desglose = desglosarConTasas(base, renglon.impuesto);
    subtotal = sumar(subtotal, desglose.base);
    iva = sumar(iva, desglose.iva);
    ieps = sumar(ieps, desglose.ieps);
  }

  const total = sumar(subtotal, iva, ieps);
  const propina = estado.propina;
  const pagado = sumar(...estado.pagos.map((p) => p.monto));
  const aCobrar = sumar(total, propina);

  const recibido = sumar(...estado.pagos.map((p) => p.recibido ?? p.monto));
  const cambio = recibido > aCobrar ? restar(recibido, aCobrar) : CERO;

  return {
    bruto,
    descuentos,
    cortesias,
    subtotal,
    iva,
    ieps,
    total,
    costo,
    // El margen se calcula sobre el SUBTOTAL (ingreso real), no sobre el total:
    // el IVA se recauda para el SAT, no es ingreso del restaurante.
    margen: subtotal > 0 ? (subtotal - costo) / subtotal : 0,
    propina,
    pagado,
    saldo: restar(aCobrar, pagado),
    cambio,
  };
}
