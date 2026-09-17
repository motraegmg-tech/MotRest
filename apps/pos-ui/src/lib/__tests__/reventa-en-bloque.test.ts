/**
 * DAR DE ALTA EN BLOQUE LO QUE SE VENDE TAL CUAL.
 *
 * Una Coca-Cola se compra hecha y se vende igual, pero decírselo al sistema
 * costaba cuatro vueltas por cuatro pantallas —alta del insumo, alta del
 * producto, vincularle «1 pieza de sí mismo», cargar la existencia—. Con treinta
 * bebidas son ciento veinte vueltas, así que nadie las daba y las bebidas
 * quedaban fuera del inventario: el almacén mentía justo en lo que más se roba.
 *
 * Aquí se prueban las dos entradas en bloque —el importador de la carta (D) y el
 * alta rápida de embotellados (E)— y el camino inverso, el insumo ya capturado
 * que salta a la carta (B). Se prueban contra las funciones REALES del módulo de
 * `Catalogo.svelte`: una prueba que reescribiera el recorrido en vez de llamarlo
 * no probaría nada, porque el recorrido es justo donde hay cuatro sitios en los
 * que fallar a medias.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { interpretarCarta, pesos } from "@motrest/dominio";
import { inventario } from "../inventario.svelte";
import { menu } from "../menu.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import {
  esDeReventa,
  estaEnLaCarta,
  insumoEspejoDe,
  ponerEnLaCarta,
} from "../reventa.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";
import {
  altaRapidaDeReventa,
  importarCartaConReventa,
  problemaDelRenglon,
  renglonRapido,
  type RenglonRapido,
} from "../modulos/admin/Catalogo.svelte";

const REFRESCOS = "Refrescos de prueba";
const GUISOS = "Guisos de prueba";

const CARTA = [
  REFRESCOS,
  "Cola de prueba 600 | 45 | 18",
  "Agua de prueba 1 L | 35",
  GUISOS,
  "Sopa de prueba | 120 | 40",
].join("\n");

/** El producto de la carta que se llama así, buscado como lo ve el usuario. */
function productoPorNombre(nombre: string) {
  return menu.porCategoria
    .flatMap((g) => g.productos)
    .find((p) => p.nombre === nombre);
}

function categoriaPorNombre(nombre: string) {
  return menu.categorias.find((c) => c.nombre === nombre);
}

/** Un renglón de la tabla de captura rápida, ya lleno. */
function renglon(campos: Partial<RenglonRapido>): RenglonRapido {
  return { ...renglonRapido(), ...campos };
}

function tanda() {
  return {
    categoria_id: categoriaPorNombre(REFRESCOS)!.id,
    categoriaInsumo: REFRESCOS,
    impuesto_id: menu.impuestos[0]!.id,
  };
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("el importador de la carta aprende la reventa (D)", () => {
  it("las categorías marcadas nacen con producto, insumo y receta de una pieza", () => {
    const previa = interpretarCarta(CARTA, {
      categoriasExistentes: menu.categorias.map((c) => c.nombre),
    });
    expect(previa.categorias_detectadas.map((c) => c.nombre)).toEqual([REFRESCOS, GUISOS]);

    const r = importarCartaConReventa(previa, new Set([REFRESCOS]));

    expect(r.fallos).toEqual([]);
    expect(r.creados).toBe(3);
    expect(r.reventa).toBe(2);

    const cola = productoPorNombre("Cola de prueba 600");
    expect(cola).toBeTruthy();

    const insumo = insumoEspejoDe(cola!.id);
    expect(insumo?.nombre).toBe("Cola de prueba 600");
    expect(insumo?.unidad_base).toBe("pz");
    // El costo de la línea es lo que cuesta COMPRAR la pieza: es el del insumo.
    expect(insumo?.costo_unitario).toBe(pesos(18));
    // Y el insumo se guarda en una despensa que se llama como la categoría de
    // la carta, para que el almacén quede ordenado como está ordenada la carta.
    expect(insumo?.categoria).toBe(REFRESCOS);
  });

  it("lo que no se marcó sigue entrando como platillo normal, sin receta", () => {
    const sopa = productoPorNombre("Sopa de prueba");
    expect(sopa).toBeTruthy();
    expect(esDeReventa(sopa!.id)).toBe(false);
    expect(menu.recetaDe(sopa!.id)).toBeNull();
  });

  /*
   * Es la mitad que se olvida (propuesta C). El refresco número treinta y uno se
   * da de alta tres semanas después, a mano, y nadie se acuerda de vincularlo.
   */
  it("la categoría queda marcada, para que el siguiente refresco nazca vinculado", () => {
    expect(categoriaPorNombre(REFRESCOS)?.reventa).toBe(true);
    expect(categoriaPorNombre(GUISOS)?.reventa).toBeFalsy();
  });

  /*
   * Una línea de la carta no dice cuántas hay en el refrigerador. Sembrar un
   * número inventado sería peor que no sembrar nada: el valor del almacén
   * quedaría mintiendo sin que nadie lo hubiera tecleado.
   */
  it("la carta pegada no inventa existencias", () => {
    const insumo = insumoEspejoDe(productoPorNombre("Cola de prueba 600")!.id)!;
    expect(inventario.cantidad(insumo.id)).toBe(0);
  });

  it("una línea sin costo entra igual, con su insumo en cero y a la vista", () => {
    const agua = productoPorNombre("Agua de prueba 1 L");
    expect(insumoEspejoDe(agua!.id)?.costo_unitario).toBe(pesos(0));
  });
});

describe("el alta rápida de embotellados (E)", () => {
  it("cada renglón deja producto, insumo, receta y la existencia que hay", () => {
    const r = altaRapidaDeReventa(
      [
        renglon({ nombre: "Cerveza de prueba", costo: "22", precio: "60", existencia: "24" }),
        renglon({ nombre: "Sidral de prueba", costo: "16", precio: "42", existencia: "12" }),
      ],
      tanda(),
    );

    expect(r.altas).toBe(2);
    expect(r.fallos).toEqual([]);
    expect(r.pendientes).toEqual([]);

    const cerveza = productoPorNombre("Cerveza de prueba");
    expect(cerveza?.precio).toBe(pesos(60));

    const insumo = insumoEspejoDe(cerveza!.id)!;
    expect(insumo.costo_unitario).toBe(pesos(22));
    expect(inventario.cantidad(insumo.id)).toBe(24);
  });

  /*
   * ESTE ES EL PUNTO DE LA PANTALLA. Vaciar la tabla al terminar castigaría al
   * que se equivocó en un renglón de veinte: tendría que volver a teclear los
   * veinte, y esa sería la última vez que alguien la abre.
   */
  it("el renglón que falla no se pierde: vuelve a la tabla con su motivo", () => {
    const bueno = renglon({ nombre: "Vino de prueba", costo: "90", precio: "320", existencia: "6" });
    const sinPrecio = renglon({ nombre: "Mezcal de prueba", costo: "180", precio: "" });

    const r = altaRapidaDeReventa([bueno, sinPrecio], tanda());

    expect(r.altas).toBe(1);
    expect(r.pendientes).toEqual([sinPrecio]);
    expect(r.fallos).toEqual([{ nombre: "Mezcal de prueba", motivo: "Falta a cómo se vende" }]);
    expect(productoPorNombre("Mezcal de prueba")).toBeUndefined();
  });

  it("un renglón en blanco no es un error, es un hueco: se ignora", () => {
    expect(altaRapidaDeReventa([renglonRapido(), renglonRapido()], tanda())).toEqual({
      altas: 0,
      fallos: [],
      pendientes: [],
    });
  });

  it("costo cero se permite —hay quien no lo sabe todavía— pero se avisa", () => {
    const sinCosto = renglon({ nombre: "Agua mineral de prueba", precio: "30", existencia: "10" });
    expect(problemaDelRenglon(sinCosto)).toBeNull();

    const r = altaRapidaDeReventa([sinCosto], tanda());
    expect(r.altas).toBe(1);

    const insumo = insumoEspejoDe(productoPorNombre("Agua mineral de prueba")!.id)!;
    expect(insumo.costo_unitario).toBe(pesos(0));
    expect(inventario.cantidad(insumo.id)).toBe(10);
  });

  it("un nombre de una sola letra no entra, y lo dice", () => {
    expect(problemaDelRenglon(renglon({ nombre: "X", precio: "30" }))).toBe(
      "El nombre necesita al menos dos letras",
    );
  });
});

describe("un insumo del almacén que pasa a la carta (B, inversa)", () => {
  /*
   * Quien cargó sus refrescos como insumos para poder contarlos se encuentra con
   * que no se pueden vender. Volver a teclear los mismos treinta nombres en el
   * Menú es el momento exacto en que se abandona la tarea.
   */
  it("se pone a la venta sin duplicar el insumo ni perder lo contado", () => {
    const alta = menu.crearInsumo({
      nombre: "Jarra de prueba",
      unidad_base: "pz",
      costo_unitario: pesos(30),
      stock_minimo: 4,
      categoria: REFRESCOS,
    });
    const insumoId = alta.id!;
    inventario.registrar(insumoId, 9, "ajuste_conteo", "Conteo de la prueba");

    expect(estaEnLaCarta(insumoId)).toBe(false);

    const r = ponerEnLaCarta(insumoId, {
      categoria_id: categoriaPorNombre(REFRESCOS)!.id,
      precio: pesos(95),
      impuesto_id: menu.impuestos[0]!.id,
    });

    expect(r.ok).toBe(true);
    expect(estaEnLaCarta(insumoId)).toBe(true);
    expect(menu.insumos.filter((i) => i.nombre === "Jarra de prueba")).toHaveLength(1);
    expect(inventario.cantidad(insumoId)).toBe(9);

    const producto = productoPorNombre("Jarra de prueba")!;
    expect(insumoEspejoDe(producto.id)?.id).toBe(insumoId);
    expect(producto.precio).toBe(pesos(95));
  });

  /*
   * El botón solo sale para lo que se cuenta POR PIEZAS. Nadie pide «180 g de
   * harina», y un insumo en gramos en la carta sería un producto que descuenta
   * un gramo por venta.
   */
  it("lo que se lleva en gramos no se puede poner en la carta tal cual", () => {
    const alta = menu.crearInsumo({
      nombre: "Harina de prueba B",
      unidad_base: "g",
      costo_unitario: pesos(0.05),
      stock_minimo: 1_000,
    });

    const r = ponerEnLaCarta(alta.id!, {
      categoria_id: categoriaPorNombre(REFRESCOS)!.id,
      precio: pesos(50),
      impuesto_id: menu.impuestos[0]!.id,
    });

    expect(r.ok).toBe(false);
    expect(r.problemas[0]?.mensaje).toContain("se cuenta por piezas");
    expect(productoPorNombre("Harina de prueba B")).toBeUndefined();
  });
});
