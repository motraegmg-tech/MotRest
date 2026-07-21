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
  grupos: ReadonlyMap<ID, import("./modificadores.js").GrupoModificadores>;
}

export interface CatalogoPlano {
  productos: readonly Producto[];
  categorias: readonly Categoria[];
  recetas?: readonly import("./recetas.js").Receta[];
  impuestos: readonly import("../comun/impuestos.js").PerfilImpuesto[];
  grupos?: readonly import("./modificadores.js").GrupoModificadores[];
}

export function indexar(plano: CatalogoPlano): CatalogoIndex {
  return {
    productos: new Map(plano.productos.map((p) => [p.id, p])),
    categorias: new Map(plano.categorias.map((c) => [c.id, c])),
    recetas: new Map((plano.recetas ?? []).map((r) => [r.id, r])),
    impuestos: new Map(plano.impuestos.map((i) => [i.id, i])),
    grupos: new Map((plano.grupos ?? []).map((g) => [g.id, g])),
  };
}

/** Grupos de modificadores de un producto, en su orden de presentación. */
export function gruposDe(
  cat: CatalogoIndex,
  producto: Producto,
): import("./modificadores.js").GrupoModificadores[] {
  return (producto.grupos_modificadores ?? [])
    .map((id) => cat.grupos.get(id))
    .filter((g): g is import("./modificadores.js").GrupoModificadores => g !== undefined)
    .sort((a, b) => a.orden - b.orden);
}

/** Productos de una categoría, ordenados. */
export function productosDeCategoria(cat: CatalogoIndex, categoriaId: ID): Producto[] {
  return [...cat.productos.values()]
    .filter((p) => p.categoria_id === categoriaId && p.disponible)
    .sort((a, b) => a.orden - b.orden);
}

/** Búsqueda por nombre, sin distinguir acentos ni mayúsculas. */
export function buscarProductos(cat: CatalogoIndex, texto: string): Producto[] {
  const normalizar = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const aguja = normalizar(texto.trim());
  if (aguja.length === 0) return [];

  return [...cat.productos.values()]
    .filter((p) => p.disponible && normalizar(p.nombre).includes(aguja))
    .sort((a, b) => a.orden - b.orden);
}

/** Busca un producto o lanza con un mensaje útil. */
export function productoDe(cat: CatalogoIndex, id: ID): Producto {
  const p = cat.productos.get(id);
  if (!p) throw new Error(`Producto no encontrado en el catálogo: ${id}`);
  return p;
}
