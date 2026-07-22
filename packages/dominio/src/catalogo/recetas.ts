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
import { sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

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
