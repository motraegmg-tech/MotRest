/**
 * Recetas — CAPA OPCIONAL.
 *
 * DECISIÓN DE GONZALO (ADR-16): el costeo normal NO se captura ingrediente por
 * ingrediente. El administrador escribe el costo final del platillo y su precio
 * (ver `catalogo/productos.ts`).
 *
 * Las recetas existen solo para los restaurantes que quieran control a nivel
 * insumo en los platillos que les importen. Eso es lo que habilita inventario
 * por ingrediente, control de mermas y el Centinela (C5) — la base del cobro
 * por ahorro verificado. Un producto sin receta funciona perfectamente.
 *
 * El modelo completo de insumos con unidades y subrecetas llega en la etapa 8
 * (M3 Inventario); aquí queda la forma mínima que ya usa la UI.
 */
import { deCentavos, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { convertir, type Insumo } from "../inventario/insumos.js";

export interface Ingrediente {
  id: ID;
  nombre: string;
  /** Costo del insumo por la cantidad que consume la receta. */
  costo: Centavos;

  /**
   * Vínculo OPCIONAL con el almacén. Solo los ingredientes que lo declaran
   * descuentan existencias al enviar el platillo a cocina; los demás se
   * quedan como puro desglose de costo.
   */
  insumo_id?: ID;
  cantidad?: number;
  unidad?: import("../inventario/insumos.js").Unidad;
}

export interface Receta {
  id: ID;
  nombre: string;
  ingredientes: Ingrediente[];
}

/** Costo teórico de una receta = suma de sus insumos. */
export function costoReceta(receta: Receta): Centavos {
  return sumar(...receta.ingredientes.map((i) => i.costo));
}

/**
 * Lo que cuesta el gramaje de un ingrediente, según lo que costó comprar ese
 * insumo.
 *
 * ES LA MITAD QUE FALTABA DEL VÍNCULO CON EL ALMACÉN. Un ingrediente ya podía
 * declarar «200 g de queso mozzarella» y descontarlos del inventario al enviar
 * el platillo, pero su COSTO se tecleaba a mano al lado. Las dos cifras vivían
 * separadas, así que subir el precio del queso en el almacén no cambiaba el
 * costo de ninguna pizza: el food cost seguía diciendo lo de hace seis meses,
 * que es justo el número que sirve para decidir precios.
 *
 * Devuelve `null` —y no cero— cuando no se puede calcular: falta el insumo,
 * falta el gramaje, o las unidades no son convertibles entre sí (gramos contra
 * mililitros exige una densidad que el software no puede inventar). Quien llama
 * debe conservar entonces el costo tecleado en vez de ponerlo en cero, porque un
 * cero silencioso convierte un platillo caro en uno que parece regalado.
 */
export function costoDesdeInsumo(
  ingrediente: Pick<Ingrediente, "cantidad" | "unidad">,
  insumo: Insumo | undefined,
): Centavos | null {
  if (!insumo || ingrediente.cantidad === undefined || ingrediente.unidad === undefined) {
    return null;
  }
  if (!Number.isFinite(ingrediente.cantidad) || ingrediente.cantidad < 0) return null;

  const enUnidadBase = convertir(ingrediente.cantidad, ingrediente.unidad, insumo.unidad_base);
  if (enUnidadBase === null) return null;

  return deCentavos(Math.round(enUnidadBase * insumo.costo_unitario));
}
