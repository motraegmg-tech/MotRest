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
import { idCorto, idCortoLibre } from "../comun/ids.js";
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
  /**
   * Las categorías de insumo que el local declaró.
   *
   * Opcional por la misma razón que las promociones: los menús ya guardados en
   * los locales que están operando no lo traen, y sus categorías se deducen de
   * lo escrito en cada insumo (`categoriasDeInsumoEnUso`). En cuanto alguien
   * abre la pantalla y toca algo, quedan declaradas.
   */
  categorias_insumo?: string[];
}

/** Lo que captura el formulario de alta o edición. */
export interface BorradorProducto {
  nombre: string;
  categoria_id: ID;
  /** En centavos: la interfaz convierte de pesos antes de llegar aquí. */
  costo: Centavos;
  precio: Centavos;
  impuesto_id: ID;
  /**
   * true = `precio` es lo que paga el comensal, con el impuesto dentro.
   *
   * Es lo que captura hoy el formulario: el restaurantero teclea la cifra
   * cerrada de su carta y el desglose lo hace el software. Ver
   * `Producto.precio_incluye_impuesto` para por qué esto vive en el producto.
   */
  precio_incluye_impuesto?: boolean;
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

  /*
   * $0 SÍ SE PERMITE (pedido de Gonzalo, sep-2026): la guarnición que va
   * incluida, el pan de la casa, el refill. Antes se exigía un precio mayor a
   * cero y el restaurante inventaba un «$0.01» para poder capturarlos, que
   * ensuciaba el ticket y la factura. Lo que no tiene sentido es un precio
   * negativo: eso es un descuento, y tiene su propio camino.
   *
   * Va con ADVERTENCIA y no en silencio: un $0 puesto por error regalaría el
   * platillo en cada venta sin que nadie lo notara hasta el corte.
   */
  if (!Number.isInteger(borrador.precio) || borrador.precio < 0) {
    problemas.push({
      campo: "precio",
      mensaje: "El precio no puede ser negativo",
      gravedad: "error",
    });
  } else if (borrador.precio === 0) {
    problemas.push({
      campo: "precio",
      mensaje:
        borrador.costo > 0
          ? "Precio $0: se servirá sin cobrar, y cada uno cuesta sus insumos. No aparece en la factura."
          : "Precio $0: se servirá sin cobrar. No aparece en la factura.",
      gravedad: "advertencia",
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

/**
 * Devuelve el menú con un id propio para cada platillo, y cuántos hubo que
 * reparar.
 *
 * Los ids del catálogo se recortaban a 8 caracteres del UUIDv7, que son solo la
 * parte alta del milisegundo: todas las altas de un mismo minuto salían con el
 * MISMO id (ver `idCorto`). Como el catálogo se indexa en un Map por id, el
 * segundo platillo pisaba al primero — seguía guardado en el archivo, y contado
 * en el resumen, pero no aparecía en la carta ni se podía buscar ni editar.
 *
 * La PRIMERA aparición conserva su id: las cuentas levantadas y los tickets ya
 * emitidos apuntan a él y no deben cambiar de significado. Las siguientes, que
 * hoy son inalcanzables y por tanto no las referencia nadie, reciben uno nuevo.
 */
export function sanearIdsDeProductos(menu: MenuLocal): {
  menu: MenuLocal;
  reparados: number;
} {
  const usados = new Set<ID>();
  let reparados = 0;

  const productos = menu.productos.map((p) => {
    if (!usados.has(p.id)) {
      usados.add(p.id);
      return p;
    }
    const id = idCortoLibre("prod", usados);
    usados.add(id);
    reparados += 1;
    return { ...p, id };
  });

  if (reparados === 0) return { menu, reparados: 0 };
  return { menu: conVersion(menu, { productos }), reparados };
}

export function agregarProducto(menu: MenuLocal, borrador: BorradorProducto): MenuLocal {
  const nuevo: Producto = {
    id: idCortoLibre("prod", new Set(menu.productos.map((p) => p.id))),
    nombre: borrador.nombre.trim(),
    categoria_id: borrador.categoria_id,
    costo: borrador.costo,
    precio: borrador.precio,
    impuesto_id: borrador.impuesto_id,
    ...(borrador.precio_incluye_impuesto ? { precio_incluye_impuesto: true } : {}),
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
            // Va explícito en los dos sentidos: si el formulario deja de marcar
            // que el precio incluye impuesto, el producto tiene que volver a
            // interpretarse como base, no quedarse con la bandera anterior.
            precio_incluye_impuesto: borrador.precio_incluye_impuesto ? true : undefined,
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
    id: idCorto("cat"),
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

/**
 * Cambia el color con que se distingue una categoría en el POS.
 *
 * `undefined` la devuelve al color neutro. Es lo único de la categoría que no
 * afecta a ningún cálculo, y por eso va aparte del renombrado.
 */
export function recolorearCategoria(
  menu: MenuLocal,
  categoriaId: ID,
  color: string | undefined,
): MenuLocal {
  return conVersion(menu, {
    categorias: menu.categorias.map((c) =>
      c.id === categoriaId ? { ...c, ...(color ? { color } : { color: undefined }) } : c,
    ),
  });
}

/**
 * Marca —o desmarca— una categoría como DE REVENTA.
 *
 * Va aparte del renombrado y del color por la misma razón que el color: no
 * cambia nada de lo ya capturado. Lo único que hace es que el alta del
 * siguiente producto de esa categoría proponga crearle su propio insumo y
 * vincularlo 1:1. Los productos que ya estaban dentro no se tocan — convertir
 * treinta platillos en silencio, creando treinta insumos que nadie pidió, sería
 * exactamente el tipo de sorpresa que nadie quiere encontrarse en su almacén.
 */
export function marcarCategoriaDeReventa(
  menu: MenuLocal,
  categoriaId: ID,
  reventa: boolean,
): MenuLocal {
  return conVersion(menu, {
    categorias: menu.categorias.map((c) =>
      c.id === categoriaId ? { ...c, reventa: reventa || undefined } : c,
    ),
  });
}

/**
 * Sube o baja una categoría en la carta.
 *
 * El orden importa de verdad: es el de las pestañas del POS, y quien atiende
 * quiere las bebidas donde siempre. Se reasignan TODOS los `orden` de corrido
 * en vez de intercambiar dos números, porque un catálogo importado o venido de
 * otra terminal puede traer huecos o repetidos, y con ellos el intercambio no
 * mueve nada.
 */
export function moverCategoria(
  menu: MenuLocal,
  categoriaId: ID,
  direccion: "sube" | "baja",
): MenuLocal {
  const ordenadas = [...menu.categorias].sort((a, b) => a.orden - b.orden);
  const i = ordenadas.findIndex((c) => c.id === categoriaId);
  if (i < 0) return menu;

  const destino = direccion === "sube" ? i - 1 : i + 1;
  if (destino < 0 || destino >= ordenadas.length) return menu;

  const [movida] = ordenadas.splice(i, 1);
  ordenadas.splice(destino, 0, movida!);

  return conVersion(menu, {
    categorias: ordenadas.map((c, n) => ({ ...c, orden: n + 1 })),
  });
}

// --- Ordenar la carta entera (1.5.6) -----------------------------------------------------
//
// Pedido de Gonzalo: un botón de «Ordenar» en cada lista. En casi todas solo
// cambia la vista de quien la mira; en la carta NO, por decisión suya: el orden
// que se elige ahí es el que ven los meseros en la caja. Por eso esto vive en el
// dominio y reescribe el `orden` guardado, igual que las flechas de
// `moverCategoria`: sube la versión, y el cambio viaja al Hub y a las demás
// terminales por el mismo camino que cualquier otro cambio de la carta.
//
// Con las flechas solas, poner doce categorías de la A a la Z eran decenas de
// clics, y cada clic una versión nueva de la carta viajando por la red.

/**
 * La lista en el orden pedido: primero los ids que se dan, en ese orden; luego
 * los que no venían, en el orden que ya tenían.
 *
 * Lo segundo no es un caso raro. Entre que se abre la confirmación y se pulsa
 * «Sí», otra terminal puede haber dado de alta una categoría: esa no se pierde
 * ni se va al principio, se queda al final como cualquier alta nueva. Un id
 * repetido o que ya no existe se ignora.
 */
function enElOrdenPedido<T extends { id: ID; orden: number }>(
  lista: readonly T[],
  idsEnOrden: readonly ID[],
): T[] {
  const porId = new Map(lista.map((x) => [x.id, x]));
  const puestos = new Set<ID>();
  const resultado: T[] = [];

  for (const id of idsEnOrden) {
    const x = porId.get(id);
    if (!x || puestos.has(id)) continue;
    puestos.add(id);
    resultado.push(x);
  }
  const resto = [...lista]
    .filter((x) => !puestos.has(x.id))
    .sort((a, b) => a.orden - b.orden);
  return [...resultado, ...resto];
}

/** ¿Las dos listas enseñan lo mismo, en el mismo orden? */
function mismoOrden<T extends { id: ID; orden: number }>(
  actual: readonly T[],
  nuevo: readonly T[],
): boolean {
  const antes = [...actual].sort((a, b) => a.orden - b.orden);
  return antes.every((x, i) => x.id === nuevo[i]?.id);
}

/**
 * Pone las categorías de la carta en el orden dado. Es el de las pestañas del
 * POS en todas las terminales.
 *
 * Se reasignan TODOS los `orden` de corrido, como en `moverCategoria` y por lo
 * mismo: una carta importada o venida de otra terminal puede traer huecos o
 * repetidos. Si el orden pedido es el que ya había, el menú vuelve tal cual:
 * una versión nueva que no cambia nada solo haría viajar la carta entera por
 * la red a todas las terminales, para nada.
 */
export function reordenarCategorias(menu: MenuLocal, idsEnOrden: readonly ID[]): MenuLocal {
  const ordenadas = enElOrdenPedido(menu.categorias, idsEnOrden);
  if (mismoOrden(menu.categorias, ordenadas)) return menu;

  return conVersion(menu, {
    categorias: ordenadas.map((c, n) => ({ ...c, orden: n + 1 })),
  });
}

/**
 * Pone los platillos de UNA categoría en el orden dado: el orden en que el
 * mesero los encuentra al abrir esa pestaña en la caja.
 *
 * El `orden` de un producto cuenta dentro de su categoría (ver
 * `siguienteOrden`), así que solo se reescriben los de esa categoría; los de
 * las demás no se tocan, ni siquiera se copian.
 */
export function reordenarProductos(
  menu: MenuLocal,
  categoriaId: ID,
  idsEnOrden: readonly ID[],
): MenuLocal {
  const deLaCategoria = menu.productos.filter((p) => p.categoria_id === categoriaId);
  const ordenados = enElOrdenPedido(deLaCategoria, idsEnOrden);
  if (mismoOrden(deLaCategoria, ordenados)) return menu;

  const lugar = new Map(ordenados.map((p, n) => [p.id, n + 1]));
  return conVersion(menu, {
    productos: menu.productos.map((p) => {
      const orden = p.categoria_id === categoriaId ? lugar.get(p.id) : undefined;
      return orden === undefined ? p : { ...p, orden };
    }),
  });
}

// --- Categorías de insumos -------------------------------------------------------------
//
// La categoría del insumo era TEXTO LIBRE en su ficha. Funcionaba para
// escribirla y no para nada más: no había dónde ver los insumos de «Lácteos»,
// ni forma de renombrarla, y dos capturas distintas —«Lacteos» y «lácteos»—
// eran dos categorías para el sistema y una sola para el almacenista.
//
// Sigue guardándose como texto en el insumo, a propósito: convertirla en un id
// obligaría a migrar todos los insumos ya capturados en los locales que están
// operando. Lo que se agrega es el CATÁLOGO de las que existen, para poder
// listarlas, renombrarlas en bloque y borrarlas.

/** Las categorías de insumo declaradas por el local. */
export function categoriasDeInsumo(menu: MenuLocal): string[] {
  return [...(menu.categorias_insumo ?? [])].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Todas las categorías que se usan: las declaradas MÁS las que ya estaban
 * escritas a mano en algún insumo.
 *
 * Sin esta unión, abrir la pantalla en un local que ya tenía insumos capturados
 * mostraría el catálogo vacío mientras la despensa está llena de categorías.
 */
export function categoriasDeInsumoEnUso(menu: MenuLocal): string[] {
  const vistas = new Set(menu.categorias_insumo ?? []);
  for (const i of menu.insumos) {
    const nombre = i.categoria?.trim();
    if (nombre) vistas.add(nombre);
  }
  return [...vistas].sort((a, b) => a.localeCompare(b, "es"));
}

export function insumosEnCategoria(menu: MenuLocal, categoria: string): Insumo[] {
  const buscada = normalizar(categoria);
  return menu.insumos.filter((i) => normalizar(i.categoria ?? "") === buscada);
}

export function validarCategoriaInsumo(
  nombre: string,
  menu: MenuLocal,
  anterior?: string,
): ProblemaMenu[] {
  const limpio = nombre.trim();
  if (limpio.length < 2) {
    return [{ campo: "nombre", mensaje: "La categoría necesita un nombre", gravedad: "error" }];
  }
  const repetida = categoriasDeInsumoEnUso(menu).some(
    (c) => normalizar(c) !== normalizar(anterior ?? "") && normalizar(c) === normalizar(limpio),
  );
  if (repetida) {
    return [{ campo: "nombre", mensaje: `Ya existe "${limpio}"`, gravedad: "error" }];
  }
  return [];
}

export function agregarCategoriaInsumo(menu: MenuLocal, nombre: string): MenuLocal {
  const limpio = nombre.trim();
  const actuales = menu.categorias_insumo ?? [];
  if (actuales.some((c) => normalizar(c) === normalizar(limpio))) return menu;
  return conVersion(menu, { categorias_insumo: [...actuales, limpio] });
}

/**
 * Renombra la categoría Y la reescribe en cada insumo que la llevaba.
 *
 * Las dos cosas juntas, siempre. Cambiar solo el catálogo dejaría los insumos
 * apuntando a un nombre que ya no existe, que es exactamente el desorden que
 * esta pantalla viene a arreglar.
 */
export function renombrarCategoriaInsumo(
  menu: MenuLocal,
  anterior: string,
  nuevo: string,
): MenuLocal {
  const limpio = nuevo.trim();
  const buscada = normalizar(anterior);

  const catalogo = (menu.categorias_insumo ?? []).map((c) =>
    normalizar(c) === buscada ? limpio : c,
  );
  if (!catalogo.some((c) => normalizar(c) === normalizar(limpio))) catalogo.push(limpio);

  return conVersion(menu, {
    categorias_insumo: catalogo,
    insumos: menu.insumos.map((i) =>
      normalizar(i.categoria ?? "") === buscada ? { ...i, categoria: limpio } : i,
    ),
  });
}

/**
 * Borra una categoría de insumos.
 *
 * Solo si está vacía. Un insumo cuya categoría desaparece no se rompe —el campo
 * es texto— pero queda colgando de un nombre que ya no está en ninguna lista, y
 * el almacenista no volvería a encontrarlo por ahí.
 */
export function eliminarCategoriaInsumo(menu: MenuLocal, categoria: string): MenuLocal {
  if (insumosEnCategoria(menu, categoria).length > 0) return menu;
  const buscada = normalizar(categoria);
  return conVersion(menu, {
    categorias_insumo: (menu.categorias_insumo ?? []).filter(
      (c) => normalizar(c) !== buscada,
    ),
  });
}

/** Mueve todos los insumos de una categoría a otra, para poder vaciar la vieja. */
export function moverInsumosDeCategoria(
  menu: MenuLocal,
  desde: string,
  hacia: string,
): MenuLocal {
  const origen = normalizar(desde);
  const destino = hacia.trim();
  return conVersion(menu, {
    insumos: menu.insumos.map((i) =>
      normalizar(i.categoria ?? "") === origen ? { ...i, categoria: destino } : i,
    ),
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
    id: idCorto("rec"),
    nombre: nombreProducto,
    ingredientes: [],
  };
}

/** Ingrediente en blanco, con costo cero hasta que se capture. */
export function ingredienteNuevo(): Receta["ingredientes"][number] {
  return { id: idCorto("ing"), nombre: "", costo: CERO };
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
    id: idCorto("ins"),
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
    id: idCorto("est"),
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
