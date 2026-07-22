/**
 * Qué parte del menú ve cada perfil.
 *
 * DECISIÓN DE GONZALO: todos pueden ver de qué está hecho un platillo, pero
 * **solo los perfiles altos ven los costos**. Un mesero tiene que poder contestar
 * qué lleva un plato cuando le preguntan por una alergia; no tiene por qué saber
 * lo que le cuesta a la casa.
 *
 * La regla se aplica CONSTRUYENDO la vista, no escondiendo campos en la pantalla:
 * si el costo no se puede ver, el objeto que llega a la interfaz sencillamente no
 * lo trae. Un `{#if}` olvidado deja el dato en el DOM; esto no puede.
 *
 * Cuando llegue el Hub (etapa 10) el servidor aplicará la misma función antes de
 * responder, y el cliente dejará de ver siquiera el campo por la red.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { calcularImpuesto, type DesgloseImpuesto } from "../comun/impuestos.js";
import type { CatalogoIndex, Categoria, Producto } from "./productos.js";
import { costoReceta, type Ingrediente, type Receta } from "./recetas.js";

/** Lo que el usuario en turno tiene permitido ver o hacer sobre el menú. */
export interface PermisosMenu {
  /** `fin.costo.ver` — costos, márgenes y food cost. */
  verCostos: boolean;
  /** `cocina.receta.ver` — de qué está hecho el platillo. */
  verRecetas: boolean;
  /** `cat.producto.editar` — alta y edición de productos. */
  editarProductos: boolean;
  /** `cat.precio.editar` — cambiar precios de carta. */
  editarPrecios: boolean;
  /** `cocina.receta.editar` — modificar la receta y sus insumos. */
  editarRecetas: boolean;
}

/** Nadie ve nada: punto de partida seguro si falta el contexto de sesión. */
export const SIN_PERMISOS_MENU: PermisosMenu = {
  verCostos: false,
  verRecetas: false,
  editarProductos: false,
  editarPrecios: false,
  editarRecetas: false,
};

export interface IngredienteVisible {
  id: ID;
  nombre: string;
  cantidad?: number;
  unidad?: string;
  insumo_id?: ID;
  /** Presente solo si el usuario puede ver costos. */
  costo?: Centavos;
}

export interface RecetaVisible {
  id: ID;
  nombre: string;
  ingredientes: IngredienteVisible[];
  /** Presente solo si el usuario puede ver costos. */
  costo_total?: Centavos;
  /** Cuántos ingredientes descuentan existencias del almacén. */
  vinculados: number;
}

export interface ProductoVisible {
  id: ID;
  nombre: string;
  categoria_id: ID;
  categoria: string;
  precio: Centavos;
  /** Desglose del precio: es el recuadro de IVA en vivo que pidió Gonzalo. */
  impuesto: DesgloseImpuesto;
  impuesto_id: ID;
  estacion_id?: ID;
  disponible: boolean;
  orden: number;
  /** true = el producto es configurable (mitad-y-mitad, combos). */
  configurable: boolean;

  /** Presentes solo si el usuario puede ver costos. */
  costo?: Centavos;
  margen?: Centavos;
  /** Costo sobre precio, como fracción: 0.28 = 28 % de food cost. */
  food_cost?: number;

  /** Presente solo si el usuario puede ver recetas Y el producto tiene una. */
  receta?: RecetaVisible;
  /** true = el producto tiene receta, aunque quien mira no pueda verla. */
  tiene_receta: boolean;
}

function recetaVisible(receta: Receta, permisos: PermisosMenu): RecetaVisible {
  const ingredientes: IngredienteVisible[] = receta.ingredientes.map((i: Ingrediente) => {
    const base: IngredienteVisible = { id: i.id, nombre: i.nombre };
    if (i.cantidad !== undefined) base.cantidad = i.cantidad;
    if (i.unidad !== undefined) base.unidad = i.unidad;
    if (i.insumo_id !== undefined) base.insumo_id = i.insumo_id;
    if (permisos.verCostos) base.costo = i.costo;
    return base;
  });

  const visible: RecetaVisible = {
    id: receta.id,
    nombre: receta.nombre,
    ingredientes,
    vinculados: receta.ingredientes.filter((i) => i.insumo_id !== undefined).length,
  };
  if (permisos.verCostos) visible.costo_total = costoReceta(receta);
  return visible;
}

/**
 * Arma la vista de un producto para quien lo está mirando.
 *
 * El IVA siempre viaja: el precio de carta y su impuesto no son secretos, y el
 * formulario los necesita para el recuadro en vivo. El costo y el margen solo
 * viajan con `verCostos`.
 */
export function vistaProducto(
  producto: Producto,
  cat: CatalogoIndex,
  permisos: PermisosMenu,
): ProductoVisible {
  const perfil = cat.impuestos.get(producto.impuesto_id);
  const categoria = cat.categorias.get(producto.categoria_id);
  const receta = producto.receta_id ? cat.recetas.get(producto.receta_id) : undefined;

  const visible: ProductoVisible = {
    id: producto.id,
    nombre: producto.nombre,
    categoria_id: producto.categoria_id,
    categoria: categoria?.nombre ?? "Sin categoría",
    precio: producto.precio,
    impuesto: perfil
      ? calcularImpuesto(producto.precio, perfil)
      : { base: producto.precio, iva: CERO, ieps: CERO, total: producto.precio },
    impuesto_id: producto.impuesto_id,
    estacion_id: producto.estacion_id,
    disponible: producto.disponible,
    orden: producto.orden,
    configurable: producto.esquema_porciones !== undefined,
    tiene_receta: receta !== undefined,
  };

  if (permisos.verCostos) {
    visible.costo = producto.costo;
    visible.margen = restar(producto.precio, producto.costo);
    visible.food_cost = producto.precio > 0 ? producto.costo / producto.precio : 0;
  }

  if (permisos.verRecetas && receta) {
    visible.receta = recetaVisible(receta, permisos);
  }

  return visible;
}

/** El menú completo que le corresponde ver a este perfil, ordenado por carta. */
export function vistaMenu(
  cat: CatalogoIndex,
  permisos: PermisosMenu,
): ProductoVisible[] {
  return [...cat.productos.values()]
    .sort((a, b) => a.orden - b.orden)
    .map((p) => vistaProducto(p, cat, permisos));
}

export interface CategoriaConProductos {
  categoria: Categoria;
  productos: ProductoVisible[];
}

/** El menú agrupado por categoría, como se presenta en la carta. */
export function menuPorCategoria(
  cat: CatalogoIndex,
  permisos: PermisosMenu,
): CategoriaConProductos[] {
  const vistos = vistaMenu(cat, permisos);
  return [...cat.categorias.values()]
    .sort((a, b) => a.orden - b.orden)
    .map((categoria) => ({
      categoria,
      productos: vistos.filter((p) => p.categoria_id === categoria.id),
    }))
    .filter((g) => g.productos.length > 0);
}

export interface ResumenMenu {
  productos: number;
  disponibles: number;
  conReceta: number;
  /** Presente solo si el usuario puede ver costos. */
  foodCostPromedio?: number;
  /** Presente solo si el usuario puede ver costos. */
  margenTotal?: Centavos;
}

/**
 * Resumen del menú. El promedio de food cost se pondera por precio: un promedio
 * simple dejaría que un refresco pesara lo mismo que un corte, y el número
 * dejaría de servir para decidir nada.
 */
export function resumenMenu(
  cat: CatalogoIndex,
  permisos: PermisosMenu,
): ResumenMenu {
  const productos = [...cat.productos.values()];
  const resumen: ResumenMenu = {
    productos: productos.length,
    disponibles: productos.filter((p) => p.disponible).length,
    conReceta: productos.filter((p) => p.receta_id !== undefined).length,
  };

  if (permisos.verCostos && productos.length > 0) {
    const precio = sumar(...productos.map((p) => p.precio));
    const costo = sumar(...productos.map((p) => p.costo));
    resumen.foodCostPromedio = precio > 0 ? costo / precio : 0;
    resumen.margenTotal = restar(precio, costo);
  }

  return resumen;
}
