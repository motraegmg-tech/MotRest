/**
 * Perfiles de impuesto por producto (México): IVA y, opcionalmente, IEPS.
 *
 * Alimenta el recuadro de IVA en vivo del formulario de producto (pedido de
 * Gonzalo): al capturar precio $100.00 con perfil de 16 %, muestra IVA $16.00
 * y total $116.00.
 *
 * `incluido_en_precio` cubre el caso —muy común en cartas mexicanas— de que el
 * precio mostrado al comensal YA traiga el impuesto dentro.
 */
import { CERO, deCentavos, porFraccion, restar, sumar, type Centavos } from "./dinero.js";
import type { ID } from "./ids.js";

export interface PerfilImpuesto {
  id: ID;
  nombre: string;
  /** Tasa de IVA como fracción: 0.16 para 16 %, 0 para exento. */
  tasa_iva: number;
  /** Tasa de IEPS como fracción (bebidas saborizadas, alcohol). */
  tasa_ieps?: number;
  /** true = el precio de carta ya trae los impuestos dentro. */
  incluido_en_precio: boolean;
  /** Clave del SAT del producto/servicio (se usa al facturar, etapa 7). */
  clave_sat?: string;
}

export interface DesgloseImpuesto {
  /** Importe sin impuestos (base gravable). */
  base: Centavos;
  iva: Centavos;
  ieps: Centavos;
  /** Lo que efectivamente paga el comensal. */
  total: Centavos;
}

/**
 * Desglosa un precio según su perfil de impuesto.
 *
 * - Precio SIN impuesto incluido: base = precio, se agregan IVA e IEPS encima.
 *   `calcularImpuesto(10000, {tasa_iva: .16})` → base 10000, iva 1600, total 11600.
 * - Precio CON impuesto incluido: se extrae el impuesto contenido, de modo que
 *   `base + iva + ieps === precio` exactamente (el residuo va al IVA para que cuadre).
 */
export function calcularImpuesto(precio: Centavos, perfil: PerfilImpuesto): DesgloseImpuesto {
  const tasaIva = perfil.tasa_iva;
  const tasaIeps = perfil.tasa_ieps ?? 0;

  if (!perfil.incluido_en_precio) {
    const ieps = porFraccion(precio, tasaIeps);
    const iva = porFraccion(precio, tasaIva);
    return { base: precio, iva, ieps, total: sumar(precio, iva, ieps) };
  }

  // Precio con impuestos dentro: se despeja la base y el residuo se ajusta en el
  // IVA, garantizando base + iva + ieps === precio (sin perder centavos).
  const divisor = 1 + tasaIva + tasaIeps;
  const base = deCentavos(Math.round(precio / divisor));
  const ieps = porFraccion(base, tasaIeps);
  const iva = restar(precio, sumar(base, ieps));

  return { base, iva, ieps, total: precio };
}

/**
 * El perfil con el que hay que leer el precio de UN producto concreto.
 *
 * Un producto puede declarar que su precio ya trae el impuesto dentro
 * (`precio_incluye_impuesto`), aunque el perfil compartido de la carta diga lo
 * contrario. Es lo que permite capturar precios cerrados —100 pesos son 100
 * pesos— sin reinterpretar de golpe toda la carta ya capturada.
 *
 * POR QUÉ GUARDAR EL TOTAL SALE MEJOR QUE DESPEJAR LA BASE. Con el impuesto por
 * fuera hay cifras inalcanzables: no existe ninguna base entera en centavos cuyo
 * IVA del 16 % sume exactamente 99.00, 128.00 ni 7.00 —el 14 % de los precios
 * redondos hasta 2000 pesos—. Guardando el total, la base se despeja al revés y
 * el residuo del redondeo se absorbe en el IVA, así que el importe cuadra
 * siempre y el comensal paga la cifra de la carta.
 */
export function perfilDelProducto(
  perfil: PerfilImpuesto,
  precioIncluyeImpuesto: boolean | undefined,
): PerfilImpuesto {
  if (precioIncluyeImpuesto === undefined) return perfil;
  if (perfil.incluido_en_precio === precioIncluyeImpuesto) return perfil;
  return { ...perfil, incluido_en_precio: precioIncluyeImpuesto };
}

/** Perfil sin impuestos, útil como valor por defecto. */
export const EXENTO: PerfilImpuesto = {
  id: "imp-exento",
  nombre: "Exento",
  tasa_iva: 0,
  incluido_en_precio: false,
};

/** IVA 16 % agregado sobre el precio de carta (el caso que describió Gonzalo). */
export const IVA_16: PerfilImpuesto = {
  id: "imp-iva16",
  nombre: "IVA 16 %",
  tasa_iva: 0.16,
  incluido_en_precio: false,
};

/** Snapshot de las tasas que se congela en cada renglón de la comanda. */
export interface TasasSnapshot {
  tasa_iva: number;
  tasa_ieps: number;
  incluido: boolean;
}

export function snapshotTasas(perfil: PerfilImpuesto): TasasSnapshot {
  return {
    tasa_iva: perfil.tasa_iva,
    tasa_ieps: perfil.tasa_ieps ?? 0,
    incluido: perfil.incluido_en_precio,
  };
}

/** Igual que `calcularImpuesto`, pero sobre el snapshot guardado en el renglón. */
export function desglosarConTasas(importe: Centavos, tasas: TasasSnapshot): DesgloseImpuesto {
  return calcularImpuesto(importe, {
    id: "snapshot",
    nombre: "snapshot",
    tasa_iva: tasas.tasa_iva,
    tasa_ieps: tasas.tasa_ieps,
    incluido_en_precio: tasas.incluido,
  });
}

export const SIN_IMPUESTO: DesgloseImpuesto = {
  base: CERO,
  iva: CERO,
  ieps: CERO,
  total: CERO,
};
