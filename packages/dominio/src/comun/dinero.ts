/**
 * Dinero exacto, en centavos enteros.
 *
 * Decisión de Gonzalo: "sin redondeos". Trabajar en centavos enteros es
 * precisamente lo que lo garantiza — los decimales flotantes acumulan error
 * (0.1 + 0.2 !== 0.3 en cualquier computadora), los enteros no fallan nunca.
 *
 * El único caso donde una división no da exacta (repartir $100 entre 3) se
 * resuelve con `repartir()`, que distribuye los centavos sobrantes de modo que
 * la suma SIEMPRE cuadre al total: no se pierde ni se inventa dinero.
 *
 * ADR-12.
 */

/** Monto en centavos MXN. Siempre entero. El tipo marcado evita mezclarlo con pesos. */
export type Centavos = number & { readonly __centavos: unique symbol };

export const CERO = 0 as Centavos;

/** Construye un monto desde pesos: `pesos(249.5)` → 24950 centavos. */
export function pesos(monto: number): Centavos {
  return Math.round(monto * 100) as Centavos;
}

/** Construye un monto desde un entero de centavos ya calculado. */
export function deCentavos(n: number): Centavos {
  if (!Number.isInteger(n)) {
    throw new Error(`Los centavos deben ser enteros, se recibió: ${n}`);
  }
  return n as Centavos;
}

/** Convierte a pesos para mostrar o formatear. */
export function aPesos(monto: Centavos): number {
  return monto / 100;
}

export function sumar(...montos: Centavos[]): Centavos {
  return montos.reduce((a, b) => a + b, 0) as Centavos;
}

export function restar(a: Centavos, b: Centavos): Centavos {
  return (a - b) as Centavos;
}

/** Multiplica por una cantidad entera (p. ej. 3 unidades del mismo platillo). */
export function porCantidad(monto: Centavos, cantidad: number): Centavos {
  return (monto * cantidad) as Centavos;
}

/**
 * Multiplica por una fracción (tasa de impuesto, fracción de porción).
 * Redondea al centavo más cercano: es el único punto donde el redondeo es
 * inevitable, porque medio centavo no existe.
 */
export function porFraccion(monto: Centavos, fraccion: number): Centavos {
  return Math.round(monto * fraccion) as Centavos;
}

/**
 * Reparte un total entre N partes SIN perder ni inventar centavos.
 * Los centavos sobrantes se asignan a las primeras partes, de modo que
 * `sumar(...repartir(t, n)) === t` siempre.
 *
 * Ejemplo: repartir(10000, 3) → [3334, 3333, 3333] (suma exacta 10000).
 */
export function repartir(total: Centavos, partes: number): Centavos[] {
  if (!Number.isInteger(partes) || partes <= 0) {
    throw new Error(`El número de partes debe ser un entero positivo, se recibió: ${partes}`);
  }
  const base = Math.trunc(total / partes);
  const sobrante = total - base * partes;
  const signo = sobrante >= 0 ? 1 : -1;
  const restantes = Math.abs(sobrante);

  return Array.from({ length: partes }, (_, i) =>
    (base + (i < restantes ? signo : 0)) as Centavos,
  );
}
