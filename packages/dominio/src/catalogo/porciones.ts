/**
 * Porciones — el mecanismo GENÉRICO de productos configurables.
 *
 * La pizza mitad-y-mitad de Rodizio deja de ser el centro del producto y pasa a
 * ser UN CASO de este mecanismo. El mismo esquema cubre:
 *
 *   - Mitad y mitad ....... 2 ranuras × 0.5
 *   - Tercios ............. 3 ranuras × 1/3
 *   - Pasta con salsa ..... 1 ranura × 1   (presentación de lista)
 *   - Combo 2 a elegir .... 2 ranuras × 1
 *   - Producto simple ..... sin esquema
 *
 * Regla de deslinde frente a los modificadores: una PORCIÓN parte el platillo en
 * fracciones de variedades distintas; un MODIFICADOR agrega, quita o elige sobre
 * el platillo (llega en la etapa 6).
 */
import type { ID } from "../comun/ids.js";

/** Una ranura del platillo (una mitad, un tercio, un lugar del combo). */
export interface RanuraPorcion {
  id: ID;
  /** Etiqueta que ve el usuario: "Mitad izquierda", "Tercio 1". */
  etiqueta: string;
  /** Fracción del platillo que ocupa (0.5 para mitad, 1/3 para tercio, 1 para combo). */
  fraccion: number;
  /** Productos-variedad elegibles en esta ranura. */
  opciones_producto: ID[];
  producto_por_defecto?: ID;
  obligatoria: boolean;
}

export interface EsquemaPorciones {
  ranuras: RanuraPorcion[];
  /** Sugerencia visual al configurador: círculo partido o lista de opciones. */
  presentacion: "circulo" | "lista";
}

/** Lo que el usuario eligió para una ranura. Se congela como snapshot en el renglón. */
export interface PorcionElegida {
  ranura_id: ID;
  producto_id: ID;
  fraccion: number;
}

/** Construye la selección por defecto de un esquema (la que abre el configurador). */
export function porcionesPorDefecto(esquema: EsquemaPorciones): PorcionElegida[] {
  return esquema.ranuras.map((r) => ({
    ranura_id: r.id,
    producto_id: r.producto_por_defecto ?? r.opciones_producto[0] ?? "",
    fraccion: r.fraccion,
  }));
}
