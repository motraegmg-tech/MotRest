/**
 * Costeo de productos, en centavos exactos.
 *
 * Modo simple (ADR-16): el costo sale del campo `costo` que capturó el
 * administrador. Para productos configurables, el costo es la suma ponderada del
 * costo de cada variedad por su fracción — el mismo mecanismo que resolvía la
 * pizza mitad-y-mitad, ahora genérico.
 *
 * Todo aquí es función pura y determinista: funciona 100 % offline.
 */
import { CERO, porFraccion, sumar, type Centavos } from "../comun/dinero.js";
import type { PorcionElegida } from "../catalogo/porciones.js";
import { productoDe, type CatalogoIndex, type Producto } from "../catalogo/productos.js";

/** Costo de un conjunto de porciones = Σ (fracción × costo de la variedad). */
export function costearPorciones(
  porciones: readonly PorcionElegida[],
  cat: CatalogoIndex,
): Centavos {
  return sumar(
    ...porciones.map((p) => porFraccion(productoDe(cat, p.producto_id).costo, p.fraccion)),
  );
}

/**
 * Costo unitario de un producto:
 * - Configurable con porciones elegidas → suma ponderada de las variedades.
 * - Simple → su costo capturado.
 */
export function costearProducto(
  producto: Producto,
  cat: CatalogoIndex,
  porciones?: readonly PorcionElegida[],
): Centavos {
  if (porciones && porciones.length > 0) {
    return costearPorciones(porciones, cat);
  }
  return producto.costo;
}

/**
 * Precio unitario de un producto configurable.
 * Por ahora manda el precio del producto contenedor (p. ej. "Pizza familiar"),
 * independientemente de las variedades elegidas.
 */
export function precioProducto(producto: Producto): Centavos {
  return producto.precio;
}

/** Margen bruto como fracción (0..1): (precio − costo) / precio. */
export function margen(precio: Centavos, costo: Centavos): number {
  if (precio <= 0) return 0;
  return (precio - costo) / precio;
}

/** Food cost como fracción (0..1): costo / precio. Complemento del margen. */
export function foodCost(precio: Centavos, costo: Centavos): number {
  if (precio <= 0) return 0;
  return costo / precio;
}

export { CERO };
