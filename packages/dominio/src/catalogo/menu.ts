/**
 * El menú como CATÁLOGO editable por el restaurante.
 *
 * Hasta la etapa 8 el menú vivía escrito en el código. Aquí pasa a ser un dato
 * que el propio local da de alta: es lo que convierte a MotRest en un producto
 * configurable en vez de una demostración.
 *
 * Igual que el plano de piso (TRD §5.2), el menú NO es event sourcing: es una
 * instantánea versionada que se replicará con CRUD/LWW comparando `version` y
 * `updated_at`. La operación (comandas, pagos) sí es event log; la diferencia
 * está en que a nadie le importa el historial de cómo se llegó al precio actual,
 * pero sí le importa cada peso cobrado.
 *
 * Las cifras que un renglón necesita se congelan al capturarlo (ver
 * `comanda/renglon.ts`), así que editar el menú nunca reescribe una cuenta ya
 * levantada.
 */
import { CERO, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { uuidv7 } from "../comun/ids.js";
import type { PerfilImpuesto } from "../comun/impuestos.js";
import type { GrupoModificadores } from "./modificadores.js";
import type { Categoria, Producto } from "./productos.js";
import type { Receta } from "./recetas.js";

export interface MenuLocal {
  version: number;
  updated_at: number;
  categorias: Categoria[];
  productos: Producto[];
  recetas: Receta[];
  impuestos: PerfilImpuesto[];
  grupos: GrupoModificadores[];
}

/** Lo que captura el formulario de alta o edición. */
export interface BorradorProducto {
  nombre: string;
  categoria_id: ID;
  /** En centavos: la interfaz convierte de pesos antes de llegar aquí. */
  costo: Centavos;
  precio: Centavos;
  impuesto_id: ID;
  estacion_id?: ID;
  disponible: boolean;
  clave_prod_serv?: string;
}

export type Gravedad = "error" | "advertencia";

export interface ProblemaMenu {
  campo: string;
  mensaje: string;
  gravedad: Gravedad;
}

/** Los problemas que impiden guardar. Las advertencias no. */
export function bloquean(problemas: readonly ProblemaMenu[]): boolean {
  return problemas.some((p) => p.gravedad === "error");
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Revisa un producto antes de guardarlo.
 *
 * Vender por debajo del costo es una ADVERTENCIA, no un error: una promoción de
 * enganche o un platillo de cortesía son decisiones legítimas del negocio. El
 * software avisa; no le dice al restaurantero cómo cobrar.
 */
export function validarProducto(
  borrador: BorradorProducto,
  menu: MenuLocal,
  productoId?: ID,
): ProblemaMenu[] {
  const problemas: ProblemaMenu[] = [];
  const nombre = borrador.nombre.trim();

  if (nombre.length < 2) {
    problemas.push({
      campo: "nombre",
      mensaje: "El platillo necesita un nombre",
      gravedad: "error",
    });
  }

  const repetido = menu.productos.some(
    (p) =>
      p.id !== productoId &&
      p.categoria_id === borrador.categoria_id &&
      normalizar(p.nombre) === normalizar(nombre),
  );
  if (repetido) {
    problemas.push({
      campo: "nombre",
      mensaje: `Ya hay un "${nombre}" en esa categoría`,
      gravedad: "error",
    });
  }

  if (!menu.categorias.some((c) => c.id === borrador.categoria_id)) {
    problemas.push({
      campo: "categoria_id",
      mensaje: "Elige una categoría",
      gravedad: "error",
    });
  }

  if (!menu.impuestos.some((i) => i.id === borrador.impuesto_id)) {
    problemas.push({
      campo: "impuesto_id",
      mensaje: "Elige el impuesto que aplica",
      gravedad: "error",
    });
  }

  if (!Number.isInteger(borrador.precio) || borrador.precio <= 0) {
    problemas.push({
      campo: "precio",
      mensaje: "El precio debe ser mayor a cero",
      gravedad: "error",
    });
  }

  if (!Number.isInteger(borrador.costo) || borrador.costo < 0) {
    problemas.push({
      campo: "costo",
      mensaje: "El costo no puede ser negativo",
      gravedad: "error",
    });
  }

  if (borrador.costo > borrador.precio && borrador.precio > 0) {
    problemas.push({
      campo: "costo",
      mensaje: "El costo supera al precio: cada venta pierde dinero",
      gravedad: "advertencia",
    });
  } else if (borrador.precio > 0 && borrador.costo / borrador.precio > 0.45) {
    problemas.push({
      campo: "costo",
      mensaje: "Food cost por encima del 45 %: margen muy apretado",
      gravedad: "advertencia",
    });
  }

  return problemas;
}

/** Sube la versión y sella el cambio con el reloj del dispositivo (ADR-17). */
function conVersion(menu: MenuLocal, cambio: Partial<MenuLocal>): MenuLocal {
  return {
    ...menu,
    ...cambio,
    version: menu.version + 1,
    updated_at: Date.now(),
  };
}

/** Siguiente lugar en la carta dentro de una categoría. */
function siguienteOrden(menu: MenuLocal, categoriaId: ID): number {
  const ordenes = menu.productos
    .filter((p) => p.categoria_id === categoriaId)
    .map((p) => p.orden);
  return ordenes.length > 0 ? Math.max(...ordenes) + 1 : 1;
}

export function agregarProducto(menu: MenuLocal, borrador: BorradorProducto): MenuLocal {
  const nuevo: Producto = {
    id: `prod-${uuidv7().slice(0, 8)}`,
    nombre: borrador.nombre.trim(),
    categoria_id: borrador.categoria_id,
    costo: borrador.costo,
    precio: borrador.precio,
    impuesto_id: borrador.impuesto_id,
    disponible: borrador.disponible,
    orden: siguienteOrden(menu, borrador.categoria_id),
    ...(borrador.estacion_id ? { estacion_id: borrador.estacion_id } : {}),
    ...(borrador.clave_prod_serv ? { clave_prod_serv: borrador.clave_prod_serv } : {}),
  };
  return conVersion(menu, { productos: [...menu.productos, nuevo] });
}

export function editarProducto(
  menu: MenuLocal,
  productoId: ID,
  borrador: BorradorProducto,
): MenuLocal {
  return conVersion(menu, {
    productos: menu.productos.map((p) =>
      p.id !== productoId
        ? p
        : {
            ...p,
            nombre: borrador.nombre.trim(),
            categoria_id: borrador.categoria_id,
            costo: borrador.costo,
            precio: borrador.precio,
            impuesto_id: borrador.impuesto_id,
            disponible: borrador.disponible,
            // Un campo que se vacía debe DESAPARECER, no quedarse con el valor
            // anterior: quitarle la estación a un platillo tiene que sacarlo del
            // ruteo, no dejarlo en la estación vieja.
            ...(borrador.estacion_id
              ? { estacion_id: borrador.estacion_id }
              : { estacion_id: undefined }),
            ...(borrador.clave_prod_serv
              ? { clave_prod_serv: borrador.clave_prod_serv }
              : { clave_prod_serv: undefined }),
          },
    ),
  });
}

/**
 * Quita un producto de la carta.
 *
 * No se borra su receta: puede estar compartida con otro platillo, y una receta
 * huérfana no hace daño mientras que perder la de otro producto sí.
 */
export function eliminarProducto(menu: MenuLocal, productoId: ID): MenuLocal {
  return conVersion(menu, {
    productos: menu.productos.filter((p) => p.id !== productoId),
  });
}

export function cambiarDisponibilidad(
  menu: MenuLocal,
  productoId: ID,
  disponible: boolean,
): MenuLocal {
  return conVersion(menu, {
    productos: menu.productos.map((p) => (p.id === productoId ? { ...p, disponible } : p)),
  });
}

// --- Categorías ---------------------------------------------------------------------

export function validarCategoria(
  nombre: string,
  menu: MenuLocal,
  categoriaId?: ID,
): ProblemaMenu[] {
  const limpio = nombre.trim();
  if (limpio.length < 2) {
    return [{ campo: "nombre", mensaje: "La categoría necesita un nombre", gravedad: "error" }];
  }
  const repetida = menu.categorias.some(
    (c) => c.id !== categoriaId && normalizar(c.nombre) === normalizar(limpio),
  );
  if (repetida) {
    return [{ campo: "nombre", mensaje: `Ya existe "${limpio}"`, gravedad: "error" }];
  }
  return [];
}

export function agregarCategoria(menu: MenuLocal, nombre: string): MenuLocal {
  const nueva: Categoria = {
    id: `cat-${uuidv7().slice(0, 8)}`,
    nombre: nombre.trim(),
    orden: menu.categorias.length + 1,
  };
  return conVersion(menu, { categorias: [...menu.categorias, nueva] });
}

export function renombrarCategoria(menu: MenuLocal, categoriaId: ID, nombre: string): MenuLocal {
  return conVersion(menu, {
    categorias: menu.categorias.map((c) =>
      c.id === categoriaId ? { ...c, nombre: nombre.trim() } : c,
    ),
  });
}

/** Cuántos productos dependen de una categoría: eliminarla los dejaría huérfanos. */
export function productosEnCategoria(menu: MenuLocal, categoriaId: ID): number {
  return menu.productos.filter((p) => p.categoria_id === categoriaId).length;
}

export function eliminarCategoria(menu: MenuLocal, categoriaId: ID): MenuLocal {
  if (productosEnCategoria(menu, categoriaId) > 0) return menu;
  return conVersion(menu, {
    categorias: menu.categorias.filter((c) => c.id !== categoriaId),
  });
}

// --- Recetas -----------------------------------------------------------------------

/**
 * Guarda la receta de un producto y lo enlaza.
 *
 * Una receta sin ingredientes se interpreta como "quitarla": deja de descontar
 * insumos y el producto vuelve al costeo simple del ADR-16, que es el modo por
 * omisión del sistema.
 */
export function guardarReceta(menu: MenuLocal, productoId: ID, receta: Receta): MenuLocal {
  const producto = menu.productos.find((p) => p.id === productoId);
  if (!producto) return menu;

  if (receta.ingredientes.length === 0) {
    return conVersion(menu, {
      recetas: menu.recetas.filter((r) => r.id !== receta.id),
      productos: menu.productos.map((p) =>
        p.id === productoId ? { ...p, receta_id: undefined } : p,
      ),
    });
  }

  const existe = menu.recetas.some((r) => r.id === receta.id);
  return conVersion(menu, {
    recetas: existe
      ? menu.recetas.map((r) => (r.id === receta.id ? receta : r))
      : [...menu.recetas, receta],
    productos: menu.productos.map((p) =>
      p.id === productoId ? { ...p, receta_id: receta.id } : p,
    ),
  });
}

/** Receta vacía lista para llenarse, ya enlazada al nombre del producto. */
export function recetaNueva(nombreProducto: string): Receta {
  return {
    id: `rec-${uuidv7().slice(0, 8)}`,
    nombre: nombreProducto,
    ingredientes: [],
  };
}

/** Ingrediente en blanco, con costo cero hasta que se capture. */
export function ingredienteNuevo(): Receta["ingredientes"][number] {
  return { id: `ing-${uuidv7().slice(0, 8)}`, nombre: "", costo: CERO };
}
