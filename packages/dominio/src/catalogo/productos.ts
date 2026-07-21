/**
 * Catálogo de productos — modo simple.
 *
 * DECISIÓN DE GONZALO (ADR-16): al dar de alta un alimento o bebida, el
 * administrador captura DOS cifras: el **costo final** del platillo y el
 * **precio** al que se ofrece al comensal. Nada de capturar ingrediente por
 * ingrediente.
 *
 * `receta_id` es OPCIONAL y solo para quien quiera control a nivel insumo.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EsquemaPorciones } from "./porciones.js";

export interface Categoria {
  id: ID;
  nombre: string;
  orden: number;
  color?: string;
}

export interface Producto {
  id: ID;
  nombre: string;
  categoria_id: ID;

  /** Costo final del platillo, capturado por el administrador. */
  costo: Centavos;
  /** Precio de carta ofrecido al comensal. */
  precio: Centavos;
  /** Perfil de impuesto: alimenta el recuadro de IVA del formulario. */
  impuesto_id: ID;

  /** OPCIONAL: receta con insumos, solo si el restaurante quiere ese detalle. */
  receta_id?: ID;
  /** OPCIONAL: producto configurable (mitad-y-mitad, tercios, combos). */
  esquema_porciones?: EsquemaPorciones;
  /** OPCIONAL: grupos de modificadores aplicables (etapa 6). */
  grupos_modificadores?: ID[];

  /** Estación de cocina a la que se rutea (KDS e impresión). */
  estacion_id?: ID;
  disponible: boolean;
  orden: number;
}

/** Índice del catálogo: acceso por id, sin recorrer arreglos. */
export interface CatalogoIndex {
  productos: ReadonlyMap<ID, Producto>;
  categorias: ReadonlyMap<ID, Categoria>;
  recetas: ReadonlyMap<ID, import("./recetas.js").Receta>;
  impuestos: ReadonlyMap<ID, import("../comun/impuestos.js").PerfilImpuesto>;
}

export interface CatalogoPlano {
  productos: readonly Producto[];
  categorias: readonly Categoria[];
  recetas?: readonly import("./recetas.js").Receta[];
  impuestos: readonly import("../comun/impuestos.js").PerfilImpuesto[];
}

export function indexar(plano: CatalogoPlano): CatalogoIndex {
  return {
    productos: new Map(plano.productos.map((p) => [p.id, p])),
    categorias: new Map(plano.categorias.map((c) => [c.id, c])),
    recetas: new Map((plano.recetas ?? []).map((r) => [r.id, r])),
    impuestos: new Map(plano.impuestos.map((i) => [i.id, i])),
  };
}

/** Busca un producto o lanza con un mensaje útil. */
export function productoDe(cat: CatalogoIndex, id: ID): Producto {
  const p = cat.productos.get(id);
  if (!p) throw new Error(`Producto no encontrado en el catálogo: ${id}`);
  return p;
}
