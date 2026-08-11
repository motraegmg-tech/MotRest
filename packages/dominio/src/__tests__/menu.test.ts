import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { IVA_16 } from "../comun/impuestos.js";
import {
  agregarCategoria,
  agregarEstacion,
  agregarInsumo,
  agregarProducto,
  bloquean,
  cambiarDisponibilidad,
  editarEstacion,
  editarInsumo,
  editarProducto,
  eliminarCategoria,
  eliminarEstacion,
  eliminarInsumo,
  eliminarProducto,
  guardarReceta,
  productosEnCategoria,
  productosEnEstacion,
  recetaNueva,
  recetasConInsumo,
  sanearIdsDeProductos,
  validarCategoria,
  validarEstacion,
  validarInsumo,
  validarProducto,
  type BorradorEstacion,
  type BorradorInsumo,
  type BorradorProducto,
  type MenuLocal,
} from "../catalogo/menu.js";
import { indexar } from "../catalogo/productos.js";
import type { Receta } from "../catalogo/recetas.js";
import {
  SIN_PERMISOS_MENU,
  menuPorCategoria,
  resumenMenu,
  vistaProducto,
  type PermisosMenu,
} from "../catalogo/visibilidad.js";

const TODO: PermisosMenu = {
  verCostos: true,
  verRecetas: true,
  editarProductos: true,
  editarPrecios: true,
  editarRecetas: true,
};

/** Un mesero: ve la carta y las recetas, nunca los costos. */
const MESERO: PermisosMenu = {
  ...SIN_PERMISOS_MENU,
  verRecetas: true,
};

const recetaPizza: Receta = {
  id: "rec-margherita",
  nombre: "Margherita",
  ingredientes: [
    { id: "masa", nombre: "Masa madre", costo: pesos(12), insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
    { id: "mozz", nombre: "Mozzarella", costo: pesos(18), insumo_id: "ins-mozz", cantidad: 100, unidad: "g" },
    { id: "albahaca", nombre: "Albahaca", costo: pesos(3) },
  ],
};

function menuBase(): MenuLocal {
  return {
    version: 1,
    updated_at: 1_700_000_000_000,
    categorias: [
      { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
      { id: "cat-bebidas", nombre: "Bebidas", orden: 2 },
    ],
    productos: [
      {
        id: "prod-margherita", nombre: "Margherita", categoria_id: "cat-pizzas",
        costo: pesos(45), precio: pesos(189), impuesto_id: IVA_16.id,
        receta_id: "rec-margherita", estacion_id: "est-horno",
        disponible: true, orden: 1,
      },
      {
        id: "prod-agua", nombre: "Agua natural", categoria_id: "cat-bebidas",
        costo: pesos(4), precio: pesos(35), impuesto_id: IVA_16.id,
        disponible: true, orden: 1,
      },
    ],
    recetas: [recetaPizza],
    impuestos: [IVA_16],
    grupos: [],
    insumos: [
      { id: "ins-masa", nombre: "Masa madre", unidad_base: "g", costo_unitario: pesos(0.06), stock_minimo: 5000 },
      { id: "ins-mozz", nombre: "Mozzarella", unidad_base: "g", costo_unitario: pesos(0.18), stock_minimo: 3000 },
      { id: "ins-libre", nombre: "Orégano", unidad_base: "g", costo_unitario: pesos(0.4), stock_minimo: 100 },
    ],
    estaciones: [
      { id: "est-horno", nombre: "Horno", orden: 1, minutos_objetivo: 12, minutos_limite: 18 },
      { id: "est-barra", nombre: "Barra", orden: 2, minutos_objetivo: 3, minutos_limite: 6 },
    ],
  };
}

const borrador = (extra: Partial<BorradorProducto> = {}): BorradorProducto => ({
  nombre: "Lasaña de la casa",
  categoria_id: "cat-pizzas",
  costo: pesos(38),
  precio: pesos(165),
  impuesto_id: IVA_16.id,
  disponible: true,
  ...extra,
});

// --- Visibilidad por perfil ---------------------------------------------------------

describe("el costo no viaja a quien no puede verlo", () => {
  const menu = menuBase();
  const cat = indexar(menu);
  const producto = menu.productos[0]!;

  it("un perfil alto ve costo, margen y food cost", () => {
    const v = vistaProducto(producto, cat, TODO);
    expect(v.costo).toBe(pesos(45));
    expect(v.margen).toBe(pesos(144));
    expect(v.food_cost).toBeCloseTo(45 / 189, 6);
  });

  it("un mesero NO recibe el campo de costo, ni vacío ni en cero", () => {
    const v = vistaProducto(producto, cat, MESERO);
    expect(v.costo).toBeUndefined();
    expect(v.margen).toBeUndefined();
    expect(v.food_cost).toBeUndefined();
    // Lo que no está en el objeto no puede filtrarse a la pantalla por descuido.
    expect(Object.keys(v)).not.toContain("costo");
  });

  it("el mesero sí ve la receta: es lo que contesta una pregunta por alergias", () => {
    const v = vistaProducto(producto, cat, MESERO);
    expect(v.receta?.ingredientes.map((i) => i.nombre)).toEqual([
      "Masa madre", "Mozzarella", "Albahaca",
    ]);
  });

  it("pero la receta que ve el mesero viene sin costos", () => {
    const v = vistaProducto(producto, cat, MESERO);
    expect(v.receta?.costo_total).toBeUndefined();
    for (const ingrediente of v.receta!.ingredientes) {
      expect(ingrediente.costo, ingrediente.nombre).toBeUndefined();
    }
  });

  it("el chef ve la misma receta CON costos", () => {
    const v = vistaProducto(producto, cat, TODO);
    expect(v.receta?.costo_total).toBe(pesos(33));
    expect(v.receta?.ingredientes[0]!.costo).toBe(pesos(12));
  });

  it("sin permiso de recetas, la receta no viaja pero se sabe que existe", () => {
    const v = vistaProducto(producto, cat, SIN_PERMISOS_MENU);
    expect(v.receta).toBeUndefined();
    expect(v.tiene_receta).toBe(true);
  });

  it("las cantidades y el vínculo con el almacén sí viajan: no son secretos", () => {
    const v = vistaProducto(producto, cat, MESERO);
    const masa = v.receta!.ingredientes[0]!;
    expect(masa.cantidad).toBe(200);
    expect(masa.unidad).toBe("g");
    expect(v.receta!.vinculados).toBe(2);
  });

  it("el precio y su IVA los ve cualquiera: son la carta", () => {
    const v = vistaProducto(producto, cat, SIN_PERMISOS_MENU);
    expect(v.precio).toBe(pesos(189));
    expect(v.impuesto.iva).toBe(pesos(30.24));
    expect(v.impuesto.total).toBe(pesos(219.24));
  });

  it("el recuadro de IVA del ejemplo de Gonzalo: 100 → 16 → 116", () => {
    const menuCien = menuBase();
    menuCien.productos[1] = { ...menuCien.productos[1]!, precio: pesos(100) };
    const v = vistaProducto(menuCien.productos[1]!, indexar(menuCien), TODO);
    expect(v.impuesto.base).toBe(pesos(100));
    expect(v.impuesto.iva).toBe(pesos(16));
    expect(v.impuesto.total).toBe(pesos(116));
  });
});

describe("resumen del menú", () => {
  const cat = indexar(menuBase());

  it("cuenta productos y recetas para cualquiera", () => {
    const r = resumenMenu(cat, MESERO);
    expect(r.productos).toBe(2);
    expect(r.disponibles).toBe(2);
    expect(r.conReceta).toBe(1);
  });

  it("el food cost promedio solo aparece con permiso de costos", () => {
    expect(resumenMenu(cat, MESERO).foodCostPromedio).toBeUndefined();
    // Ponderado por precio: (45+4) / (189+35).
    expect(resumenMenu(cat, TODO).foodCostPromedio).toBeCloseTo(49 / 224, 6);
    expect(resumenMenu(cat, TODO).margenTotal).toBe(pesos(175));
  });

  it("agrupa la carta por categoría y omite las vacías", () => {
    const grupos = menuPorCategoria(cat, MESERO);
    expect(grupos.map((g) => g.categoria.nombre)).toEqual(["Pizzas", "Bebidas"]);
    expect(grupos[0]!.productos).toHaveLength(1);
  });
});

// --- Validación -----------------------------------------------------------------------

describe("validación de productos", () => {
  const menu = menuBase();

  it("acepta un producto bien capturado", () => {
    expect(validarProducto(borrador(), menu)).toEqual([]);
  });

  it("exige nombre, precio positivo y costo no negativo", () => {
    const p = validarProducto(
      borrador({ nombre: "A", precio: pesos(0), costo: -100 as never }),
      menu,
    );
    expect(p.map((x) => x.campo).sort()).toEqual(["costo", "nombre", "precio"]);
    expect(bloquean(p)).toBe(true);
  });

  it("rechaza un nombre repetido en la misma categoría, sin importar acentos", () => {
    const p = validarProducto(borrador({ nombre: "margaritA" }), menu);
    expect(p).toEqual([]);
    const q = validarProducto(borrador({ nombre: "  MARGHERITA " }), menu);
    expect(bloquean(q)).toBe(true);
  });

  it("el mismo nombre en otra categoría sí se permite", () => {
    const p = validarProducto(
      borrador({ nombre: "Margherita", categoria_id: "cat-bebidas" }),
      menu,
    );
    expect(p).toEqual([]);
  });

  it("al editar, su propio nombre no cuenta como repetido", () => {
    const p = validarProducto(
      borrador({ nombre: "Margherita" }),
      menu,
      "prod-margherita",
    );
    expect(p).toEqual([]);
  });

  it("vender por debajo del costo advierte, pero NO bloquea", () => {
    const p = validarProducto(borrador({ costo: pesos(200), precio: pesos(165) }), menu);
    expect(p).toHaveLength(1);
    expect(p[0]!.gravedad).toBe("advertencia");
    expect(bloquean(p)).toBe(false);
  });

  it("avisa cuando el food cost pasa del 45 %", () => {
    const p = validarProducto(borrador({ costo: pesos(100), precio: pesos(165) }), menu);
    expect(p[0]!.gravedad).toBe("advertencia");
    expect(p[0]!.mensaje).toContain("45");
  });

  it("exige una categoría y un impuesto que existan", () => {
    const p = validarProducto(
      borrador({ categoria_id: "cat-fantasma", impuesto_id: "imp-fantasma" }),
      menu,
    );
    expect(p.map((x) => x.campo).sort()).toEqual(["categoria_id", "impuesto_id"]);
  });
});

// --- Edición ---------------------------------------------------------------------------

describe("edición del menú", () => {
  it("agregar sube la versión y coloca el producto al final de su categoría", () => {
    const menu = menuBase();
    const siguiente = agregarProducto(menu, borrador());
    expect(siguiente.version).toBe(2);
    expect(siguiente.productos).toHaveLength(3);
    const nuevo = siguiente.productos.at(-1)!;
    expect(nuevo.nombre).toBe("Lasaña de la casa");
    expect(nuevo.orden).toBe(2);
    // El menú anterior no se toca: la edición es inmutable.
    expect(menu.productos).toHaveLength(2);
  });

  it("editar reemplaza los campos capturados", () => {
    const menu = editarProducto(
      menuBase(),
      "prod-margherita",
      borrador({ nombre: "Margherita clásica", precio: pesos(199) }),
    );
    const p = menu.productos.find((x) => x.id === "prod-margherita")!;
    expect(p.nombre).toBe("Margherita clásica");
    expect(p.precio).toBe(pesos(199));
    // La receta enlazada sobrevive a la edición del producto.
    expect(p.receta_id).toBe("rec-margherita");
  });

  it("quitar la estación saca al platillo del ruteo, no lo deja en la vieja", () => {
    const menu = editarProducto(menuBase(), "prod-margherita", borrador({ estacion_id: undefined }));
    expect(menu.productos.find((p) => p.id === "prod-margherita")!.estacion_id).toBeUndefined();
  });

  it("eliminar un producto conserva su receta: puede estar compartida", () => {
    const menu = eliminarProducto(menuBase(), "prod-margherita");
    expect(menu.productos).toHaveLength(1);
    expect(menu.recetas).toHaveLength(1);
  });

  it("agotar un platillo lo deja fuera de la carta sin borrarlo", () => {
    const menu = cambiarDisponibilidad(menuBase(), "prod-agua", false);
    const p = menu.productos.find((x) => x.id === "prod-agua")!;
    expect(p.disponible).toBe(false);
    expect(menuPorCategoria(indexar(menu), MESERO).map((g) => g.categoria.nombre))
      .toEqual(["Pizzas", "Bebidas"]);
  });
});

/*
 * Regresión de la carta de Rodizio (ago-2026): 39 platillos capturados, 31
 * visibles. Los ids se recortaban a los 8 primeros caracteres del UUIDv7 —la
 * parte alta del milisegundo—, así que todo lo dado de alta dentro del mismo
 * minuto salía con el mismo id y se pisaba al indexar el catálogo.
 */
describe("ids únicos en el catálogo", () => {
  it("dos altas seguidas NO comparten id, aunque caigan en el mismo instante", () => {
    let menu = menuBase();
    for (let i = 0; i < 50; i++) {
      menu = agregarProducto(menu, borrador({ nombre: `Platillo ${i}` }));
    }
    const ids = new Set(menu.productos.map((p) => p.id));
    expect(ids.size).toBe(menu.productos.length);
    // Y ninguno se pierde al indexar, que es donde se notaba el defecto.
    expect(indexar(menu).productos.size).toBe(menu.productos.length);
  });

  it("recetas e ingredientes nuevos tampoco chocan entre sí", () => {
    const recetas = new Set(Array.from({ length: 50 }, () => recetaNueva("Pizza").id));
    expect(recetas.size).toBe(50);
  });

  it("sanear devuelve a la carta los platillos que quedaron con id ajeno", () => {
    const menu = menuBase();
    const [margherita, agua] = [menu.productos[0]!, menu.productos[1]!];
    // Tal cual quedó guardado: el tercero llegó con el id del segundo.
    const roto: MenuLocal = {
      ...menu,
      productos: [margherita, agua, { ...agua, nombre: "Agua mineral", orden: 2 }],
    };
    expect(indexar(roto).productos.size).toBe(2); // el defecto

    const { menu: sano, reparados } = sanearIdsDeProductos(roto);
    expect(reparados).toBe(1);
    expect(indexar(sano).productos.size).toBe(3);
    expect(sano.productos.map((p) => p.nombre)).toEqual([
      "Margherita",
      "Agua natural",
      "Agua mineral",
    ]);
    // El primero conserva su id: las cuentas y tickets ya emitidos lo apuntan.
    expect(sano.productos[1]!.id).toBe("prod-agua");
    expect(sano.productos[2]!.id).not.toBe("prod-agua");
    // Sube la versión para que la carta reparada se replique a las demás.
    expect(sano.version).toBe(roto.version + 1);
  });

  it("un menú sano se devuelve intacto, sin gastar una versión de más", () => {
    const menu = menuBase();
    const { menu: sano, reparados } = sanearIdsDeProductos(menu);
    expect(reparados).toBe(0);
    expect(sano).toBe(menu);
  });
});

describe("categorías", () => {
  it("rechaza una categoría repetida", () => {
    expect(bloquean(validarCategoria("pizzas", menuBase()))).toBe(true);
    expect(validarCategoria("Postres", menuBase())).toEqual([]);
  });

  it("agrega una categoría al final", () => {
    const menu = agregarCategoria(menuBase(), "Postres");
    expect(menu.categorias.at(-1)!.nombre).toBe("Postres");
    expect(menu.categorias.at(-1)!.orden).toBe(3);
  });

  it("no borra una categoría con productos: dejaría huérfanos", () => {
    const menu = menuBase();
    expect(productosEnCategoria(menu, "cat-pizzas")).toBe(1);
    expect(eliminarCategoria(menu, "cat-pizzas")).toBe(menu);
  });

  it("sí borra una categoría vacía", () => {
    const menu = agregarCategoria(menuBase(), "Postres");
    const vacia = menu.categorias.at(-1)!.id;
    expect(eliminarCategoria(menu, vacia).categorias).toHaveLength(2);
  });
});

describe("recetas del menú", () => {
  it("guardar una receta la enlaza al producto", () => {
    const menu = menuBase();
    const receta = recetaNueva("Agua de jamaica");
    receta.ingredientes.push({
      id: "ing-1", nombre: "Flor de jamaica", costo: pesos(3),
      insumo_id: "ins-jamaica", cantidad: 20, unidad: "g",
    });

    const siguiente = guardarReceta(menu, "prod-agua", receta);
    expect(siguiente.productos.find((p) => p.id === "prod-agua")!.receta_id).toBe(receta.id);
    expect(siguiente.recetas).toHaveLength(2);
  });

  it("una receta sin ingredientes desenlaza y vuelve al costeo simple (ADR-16)", () => {
    const menu = guardarReceta(menuBase(), "prod-margherita", {
      ...recetaPizza,
      ingredientes: [],
    });
    expect(menu.productos.find((p) => p.id === "prod-margherita")!.receta_id).toBeUndefined();
    expect(menu.recetas).toHaveLength(0);
  });

  it("volver a guardar la misma receta la reemplaza, no la duplica", () => {
    const menu = guardarReceta(menuBase(), "prod-margherita", {
      ...recetaPizza,
      nombre: "Margherita DOP",
    });
    expect(menu.recetas).toHaveLength(1);
    expect(menu.recetas[0]!.nombre).toBe("Margherita DOP");
  });
});

// --- Insumos ---------------------------------------------------------------------------

const insumo = (extra: Partial<BorradorInsumo> = {}): BorradorInsumo => ({
  nombre: "Albahaca fresca",
  unidad_base: "g",
  costo_unitario: pesos(0.26),
  stock_minimo: 200,
  ...extra,
});

describe("insumos del almacén", () => {
  it("acepta un insumo bien capturado", () => {
    expect(validarInsumo(insumo(), menuBase())).toEqual([]);
  });

  it("rechaza nombre repetido y costo negativo", () => {
    const p = validarInsumo(
      insumo({ nombre: "mozzarella", costo_unitario: -5 as never }),
      menuBase(),
    );
    expect(p.map((x) => x.campo).sort()).toEqual(["costo_unitario", "nombre"]);
  });

  it("un mínimo en cero advierte: nunca entraría a la lista de reposición", () => {
    const p = validarInsumo(insumo({ stock_minimo: 0 }), menuBase());
    expect(p).toHaveLength(1);
    expect(p[0]!.gravedad).toBe("advertencia");
    expect(bloquean(p)).toBe(false);
  });

  it("agregar sube la versión y conserva el resto del catálogo", () => {
    const menu = agregarInsumo(menuBase(), insumo());
    expect(menu.version).toBe(2);
    expect(menu.insumos).toHaveLength(4);
    expect(menu.productos).toHaveLength(2);
  });

  it("editar NO cambia la unidad base: convertiría gramos en kilos", () => {
    const menu = editarInsumo(
      menuBase(),
      "ins-masa",
      insumo({ nombre: "Masa madre 00", unidad_base: "kg" }),
    );
    const masa = menu.insumos.find((i) => i.id === "ins-masa")!;
    expect(masa.nombre).toBe("Masa madre 00");
    expect(masa.unidad_base).toBe("g");
  });

  it("no se puede dar de baja un insumo que alguna receta usa", () => {
    const menu = menuBase();
    expect(recetasConInsumo(menu, "ins-masa")).toHaveLength(1);
    expect(eliminarInsumo(menu, "ins-masa")).toBe(menu);
  });

  it("sí se da de baja uno que nadie usa", () => {
    const menu = eliminarInsumo(menuBase(), "ins-libre");
    expect(menu.insumos).toHaveLength(2);
  });
});

// --- Estaciones -------------------------------------------------------------------------

const estacion = (extra: Partial<BorradorEstacion> = {}): BorradorEstacion => ({
  nombre: "Parrilla",
  minutos_objetivo: 14,
  minutos_limite: 20,
  ...extra,
});

describe("estaciones de cocina", () => {
  it("acepta una estación bien capturada", () => {
    expect(validarEstacion(estacion(), menuBase())).toEqual([]);
  });

  it("exige que el límite sea mayor que el objetivo", () => {
    // Si no, el semáforo saltaría de verde a rojo sin pasar por ámbar.
    const p = validarEstacion(estacion({ minutos_objetivo: 10, minutos_limite: 10 }), menuBase());
    expect(p[0]!.campo).toBe("minutos_limite");
    expect(bloquean(p)).toBe(true);
  });

  it("rechaza nombre repetido", () => {
    expect(bloquean(validarEstacion(estacion({ nombre: "horno" }), menuBase()))).toBe(true);
  });

  it("editar conserva el orden en el tablero", () => {
    const menu = editarEstacion(menuBase(), "est-barra", estacion({ nombre: "Barra fría" }));
    const barra = menu.estaciones.find((e) => e.id === "est-barra")!;
    expect(barra.nombre).toBe("Barra fría");
    expect(barra.orden).toBe(2);
  });

  it("eliminar una estación DESRUTEA sus productos en vez de dejarlos huérfanos", () => {
    const menu = menuBase();
    expect(productosEnEstacion(menu, "est-horno")).toBe(1);

    const siguiente = eliminarEstacion(menu, "est-horno");
    expect(siguiente.estaciones).toHaveLength(1);
    // El producto sigue vendiéndose; solo deja de rutearse.
    const pizza = siguiente.productos.find((p) => p.id === "prod-margherita")!;
    expect(pizza.estacion_id).toBeUndefined();
    expect(pizza.disponible).toBe(true);
  });
});
