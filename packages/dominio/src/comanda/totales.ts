/**
 * Totales de la cuenta, en centavos exactos.
 *
 * El impuesto se desglosa RENGLÓN POR RENGLÓN con el snapshot de tasas que cada
 * uno congeló: en una misma cuenta puede haber alimentos al 16 %, productos al
 * 0 % y bebidas con IEPS. Sumar todo y aplicar una sola tasa daría mal.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import { renglonesActivos, type EstadoComanda } from "./reducers.js";
import { costoRenglon, importeRenglon } from "./renglon.js";

export interface TotalesComanda {
  /** Suma de importes de línea, antes de impuestos. */
  subtotal: Centavos;
  iva: Centavos;
  ieps: Centavos;
  /** Lo que se cobra al comensal. */
  total: Centavos;
  /** Costo de los insumos/platillos. */
  costo: Centavos;
  /** Margen bruto como fracción (0..1). */
  margen: number;
  propina: Centavos;
  pagado: Centavos;
  /** Lo que falta por cobrar (total − pagado). */
  saldo: Centavos;
}

export function totalesComanda(estado: EstadoComanda): TotalesComanda {
  const activos = renglonesActivos(estado);

  let subtotal = CERO;
  let iva = CERO;
  let ieps = CERO;
  let costo = CERO;

  for (const r of activos) {
    const importe = importeRenglon(r);
    const desglose = desglosarConTasas(importe, r.impuesto);
    subtotal = sumar(subtotal, desglose.base);
    iva = sumar(iva, desglose.iva);
    ieps = sumar(ieps, desglose.ieps);
    costo = sumar(costo, costoRenglon(r));
  }

  const total = sumar(subtotal, iva, ieps);
  const propina = sumar(...estado.pagos.map((p) => p.propina));
  const pagado = sumar(...estado.pagos.map((p) => p.monto));

  return {
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
    saldo: restar(total, pagado),
  };
}
