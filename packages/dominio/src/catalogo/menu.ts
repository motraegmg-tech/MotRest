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
import type { EstacionKds } from "../cocina/estaciones.js";
import type { Insumo, Unidad } from "../inventario/insumos.js";
import { nombreDeFotoValido } from "./fotos.js";
import type { GrupoModificadores } from "./modificadores.js";
import type { Categoria, Producto } from "./productos.js";
import type { Receta } from "./recetas.js";

/**
 * Todo lo que define QUÉ sirve un restaurante y CÓMO lo produce: la carta, sus
 * recetas, los insumos con que se hacen y las estaciones donde se preparan.
 *
 * Va junto en una sola instantánea porque se referencian entre sí —un producto
 * apunta a su estación, una receta a sus insumos— y separarlos permitiría
 * guardar la mitad de un cambio.
 */
export interface MenuLocal {
  version: number;
  updated_at: number;
  categorias: Categoria[];
  productos: Producto[];
  recetas: Receta[];
  impuestos: PerfilImpuesto[];
  grupos: GrupoModificadores[];
  insumos: Insumo[];
  estaciones: EstacionKds[];
  /**
   * Promociones del local (F2). Opcional para no romper los menús ya guardados
   * en las terminales: un catálogo sin este campo simplemente no tiene ninguna.
   */
  promociones?: import("./promociones.js").Promocion[];
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
  /**
   * Nombre del archivo que devolvió el Hub al subir la imagen. Vacío o ausente
   * = el platillo no tiene foto, que es el caso normal y no un error.
   */
  foto?: string;
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

  /*
   * La foto no la teclea nadie: es lo que devolvió el Hub al recibir el archivo.
   * Se comprueba igual porque este catálogo se replica entre terminales, y una
   * referencia inventada terminaría concatenada a una ruta de disco del Hub.
   */
  if (borrador.foto !== undefined && borrador.foto !== "" && !nombreDeFotoValido(borrador.foto)) {
    problemas.push({
      campo: "foto",
      mensaje: "La referencia de la foto no es válida",
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
    ...(nombreDeFotoValido(borrador.foto) ? { foto: borrador.foto } : {}),
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
            // Quitar la foto tiene que BORRAR la referencia, no conservar la
            // anterior: si no, «quitar imagen» dejaría la vieja en pantalla y
            // el usuario no tendría manera de deshacerse de ella.
            ...(nombreDeFotoValido(borrador.foto)
              ? { foto: borrador.foto }
              : { foto: undefined }),
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

// --- Insumos del almacén -------------------------------------------------------------

export interface BorradorInsumo {
  nombre: string;
  unidad_base: Unidad;
  /** Costo de UNA unidad base, en centavos. */
  costo_unitario: Centavos;
  stock_minimo: number;
  categoria?: string;
}

export function validarInsumo(
  borrador: BorradorInsumo,
  menu: MenuLocal,
  insumoId?: ID,
): ProblemaMenu[] {
  const problemas: ProblemaMenu[] = [];
  const nombre = borrador.nombre.trim();

  if (nombre.length < 2) {
    problemas.push({ campo: "nombre", mensaje: "El insumo necesita un nombre", gravedad: "error" });
  }
  if (menu.insumos.some((i) => i.id !== insumoId && normalizar(i.nombre) === normalizar(nombre))) {
    problemas.push({ campo: "nombre", mensaje: `Ya existe "${nombre}"`, gravedad: "error" });
  }
  if (!Number.isInteger(borrador.costo_unitario) || borrador.costo_unitario < 0) {
    problemas.push({ campo: "costo_unitario", mensaje: "El costo no puede ser negativo", gravedad: "error" });
  }
  if (!Number.isFinite(borrador.stock_minimo) || borrador.stock_minimo < 0) {
    problemas.push({ campo: "stock_minimo", mensaje: "El mínimo no puede ser negativo", gravedad: "error" });
  }
  if (borrador.stock_minimo === 0) {
    problemas.push({
      campo: "stock_minimo",
      mensaje: "Sin mínimo, este insumo nunca aparecerá en la lista de reposición",
      gravedad: "advertencia",
    });
  }

  return problemas;
}

export function agregarInsumo(menu: MenuLocal, borrador: BorradorInsumo): MenuLocal {
  const nuevo: Insumo = {
    id: `ins-${uuidv7().slice(0, 8)}`,
    nombre: borrador.nombre.trim(),
    unidad_base: borrador.unidad_base,
    costo_unitario: borrador.costo_unitario,
    stock_minimo: borrador.stock_minimo,
    ...(borrador.categoria?.trim() ? { categoria: borrador.categoria.trim() } : {}),
  };
  return conVersion(menu, { insumos: [...menu.insumos, nuevo] });
}

/**
 * Edita un insumo. La UNIDAD BASE no se cambia aquí a propósito: las existencias
 * ya registradas están expresadas en ella, y cambiarla convertiría 5 000 g en
 * 5 000 kg de un plumazo. Para cambiar de unidad se da de alta otro insumo.
 */
export function editarInsumo(
  menu: MenuLocal,
  insumoId: ID,
  borrador: BorradorInsumo,
): MenuLocal {
  return conVersion(menu, {
    insumos: menu.insumos.map((i) =>
      i.id !== insumoId
        ? i
        : {
            ...i,
            nombre: borrador.nombre.trim(),
            costo_unitario: borrador.costo_unitario,
            stock_minimo: borrador.stock_minimo,
            ...(borrador.categoria?.trim()
              ? { categoria: borrador.categoria.trim() }
              : { categoria: undefined }),
          },
    ),
  });
}

/** Recetas que quedarían rotas si se borra un insumo. */
export function recetasConInsumo(menu: MenuLocal, insumoId: ID): Receta[] {
  return menu.recetas.filter((r) => r.ingredientes.some((i) => i.insumo_id === insumoId));
}

/**
 * Da de baja un insumo. Se niega si alguna receta lo usa: borrarlo dejaría
 * ingredientes apuntando al vacío y el descuento de existencias fallaría en
 * silencio justo cuando más se necesita.
 */
export function eliminarInsumo(menu: MenuLocal, insumoId: ID): MenuLocal {
  if (recetasConInsumo(menu, insumoId).length > 0) return menu;
  return conVersion(menu, { insumos: menu.insumos.filter((i) => i.id !== insumoId) });
}

// --- Estaciones de cocina --------------------------------------------------------------

export interface BorradorEstacion {
  nombre: string;
  minutos_objetivo: number;
  minutos_limite: number;
}

export function validarEstacion(
  borrador: BorradorEstacion,
  menu: MenuLocal,
  estacionId?: ID,
): ProblemaMenu[] {
  const problemas: ProblemaMenu[] = [];
  const nombre = borrador.nombre.trim();

  if (nombre.length < 2) {
    problemas.push({ campo: "nombre", mensaje: "La estación necesita un nombre", gravedad: "error" });
  }
  if (menu.estaciones.some((e) => e.id !== estacionId && normalizar(e.nombre) === normalizar(nombre))) {
    problemas.push({ campo: "nombre", mensaje: `Ya existe "${nombre}"`, gravedad: "error" });
  }
  if (!Number.isFinite(borrador.minutos_objetivo) || borrador.minutos_objetivo <= 0) {
    problemas.push({ campo: "minutos_objetivo", mensaje: "El objetivo debe ser mayor a cero", gravedad: "error" });
  }
  // Sin esta regla el semáforo nunca pasaría por ámbar: saltaría de verde a rojo.
  if (borrador.minutos_limite <= borrador.minutos_objetivo) {
    problemas.push({
      campo: "minutos_limite",
      mensaje: "El límite tiene que ser mayor que el objetivo",
      gravedad: "error",
    });
  }

  return problemas;
}

export function agregarEstacion(menu: MenuLocal, borrador: BorradorEstacion): MenuLocal {
  const nueva: EstacionKds = {
    id: `est-${uuidv7().slice(0, 8)}`,
    nombre: borrador.nombre.trim(),
    orden: menu.estaciones.length + 1,
    minutos_objetivo: Math.round(borrador.minutos_objetivo),
    minutos_limite: Math.round(borrador.minutos_limite),
  };
  return conVersion(menu, { estaciones: [...menu.estaciones, nueva] });
}

export function editarEstacion(
  menu: MenuLocal,
  estacionId: ID,
  borrador: BorradorEstacion,
): MenuLocal {
  return conVersion(menu, {
    estaciones: menu.estaciones.map((e) =>
      e.id !== estacionId
        ? e
        : {
            ...e,
            nombre: borrador.nombre.trim(),
            minutos_objetivo: Math.round(borrador.minutos_objetivo),
            minutos_limite: Math.round(borrador.minutos_limite),
          },
    ),
  });
}

/** Productos ruteados a una estación. */
export function productosEnEstacion(menu: MenuLocal, estacionId: ID): number {
  return menu.productos.filter((p) => p.estacion_id === estacionId).length;
}

/**
 * Elimina una estación y DESRUTEA sus productos.
 *
 * Dejarlos apuntando a una estación inexistente los sacaría del tablero de
 * cocina sin aviso: se seguirían enviando y nadie los vería. Es preferible que
 * caigan en "sin ruteo", donde al menos aparecen en la vista de todas.
 */
export function eliminarEstacion(menu: MenuLocal, estacionId: ID): MenuLocal {
  return conVersion(menu, {
    estaciones: menu.estaciones.filter((e) => e.id !== estacionId),
    productos: menu.productos.map((p) =>
      p.estacion_id === estacionId ? { ...p, estacion_id: undefined } : p,
    ),
  });
}
