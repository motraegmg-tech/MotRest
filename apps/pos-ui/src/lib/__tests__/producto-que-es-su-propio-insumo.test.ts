/**
 * LA COCA-COLA: productos que son su propio insumo.
 *
 * Una bebida embotellada se compra hecha y se vende igual. Decírselo al sistema
 * exigía cuatro vueltas por cuatro pantallas —alta del insumo, alta del
 * producto, vincularle «1 pieza de sí mismo» y cargar la existencia—, así que
 * con treinta refrescos nadie lo hacía y las bebidas se quedaban fuera del
 * inventario, que es justo donde más se pierde producto.
 *
 * Lo que se prueba aquí es el CIRCUITO COMPLETO, no el formulario: que dar de
 * alta una bebida de un solo gesto deja el almacén enlazado de verdad, y que al
 * venderla se descuenta una pieza y al cancelarla vuelve. Si esto funciona, las
 * cinco entradas que lo llaman —la casilla del alta, la conversión de lo ya
 * capturado, la categoría de reventa, el importador y el alta rápida— funcionan.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { pesos } from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { inventario } from "../inventario.svelte";
import { menu } from "../menu.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import {
  altaDeReventa,
  convertirEnReventa,
  esDeReventa,
  insumoEspejoDe,
} from "../reventa.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const COSTO = pesos(14);
const PRECIO = pesos(35);
const CAJA = 24;

let siguiente = 0;
function otraMesa(): string {
  const mesa = plano.todasLasMesas[siguiente++];
  if (!mesa) throw new Error("Se acabaron las mesas del salón de pruebas");
  return mesa.id;
}

/** Sienta una mesa, pide el producto y devuelve el id del renglón capturado. */
async function pedir(productoId: string, cantidad = 1): Promise<string> {
  const mesa = otraMesa();
  pos.seleccionarMesa(mesa);
  pos.abrirMesa(mesa);
  await pos.agregar({ producto_id: productoId, cantidad });
  // El recién agregado es el ÚLTIMO: el salón de la demostración arranca con
  // comandas sembradas y la mesa puede traer cosas de antes.
  return pos.renglones.at(-1)!.id;
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("dar de alta una bebida que se vende tal cual", () => {
  let productoId = "";
  let insumoId = "";

  it("crea el producto, su insumo y la existencia inicial de un solo gesto", () => {
    const r = altaDeReventa({
      nombre: "Coca-Cola de prueba 600 ml",
      categoria_id: menu.categorias[0]!.id,
      costo: COSTO,
      precio: PRECIO,
      impuesto_id: menu.impuestos[0]!.id,
      existencia: CAJA,
      categoriaInsumo: "Bebidas de prueba",
    });

    expect(r.ok).toBe(true);
    expect(r.productoId).toBeTruthy();
    expect(r.insumoId).toBeTruthy();
    productoId = r.productoId!;
    insumoId = r.insumoId!;

    const insumo = inventario.insumo(insumoId);
    // En PIEZAS, no en gramos: es lo que hace que el descuento sea de uno en uno.
    expect(insumo?.unidad_base).toBe("pz");
    expect(insumo?.costo_unitario).toBe(COSTO);
    expect(insumo?.categoria).toBe("Bebidas de prueba");
    expect(inventario.cantidad(insumoId)).toBe(CAJA);
  });

  it("y queda enlazado 1:1 con su propio insumo", () => {
    expect(esDeReventa(productoId)).toBe(true);

    const receta = menu.recetaDe(productoId);
    expect(receta?.ingredientes).toHaveLength(1);
    expect(receta?.ingredientes[0]!.insumo_id).toBe(insumoId);
    expect(receta?.ingredientes[0]!.cantidad).toBe(1);
    expect(receta?.ingredientes[0]!.unidad).toBe("pz");
  });

  it("vender una se lleva una pieza del almacén", async () => {
    await pedir(productoId);

    const antes = inventario.cantidad(insumoId);
    await pos.enviarACocina();

    expect(inventario.cantidad(insumoId)).toBe(antes - 1);
  });

  it("y cancelarla la devuelve", async () => {
    const renglonId = await pedir(productoId);

    const antes = inventario.cantidad(insumoId);
    await pos.enviarACocina();
    expect(inventario.cantidad(insumoId)).toBe(antes - 1);

    await pos.cancelar(renglonId);
    expect(inventario.cantidad(insumoId)).toBe(antes);
  });

  /*
   * Dos insumos «Coca-Cola 600 ml» serían dos existencias llevadas por separado,
   * y el inventario de las bebidas dejaría de significar nada. Es además lo que
   * hace que convertir un producto ya capturado no duplique la despensa de quien
   * ya había dado de alta sus refrescos a mano.
   */
  it("dar de alta otra con el mismo nombre reutiliza el insumo, no lo duplica", () => {
    const cuantos = menu.insumos.filter(
      (i) => i.nombre === "Coca-Cola de prueba 600 ml",
    ).length;
    expect(cuantos).toBe(1);

    const otra = altaDeReventa({
      nombre: "Coca-Cola de prueba 600 ml",
      categoria_id: menu.categorias[0]!.id,
      costo: COSTO,
      precio: PRECIO,
      impuesto_id: menu.impuestos[0]!.id,
    });

    expect(otra.insumoId).toBe(insumoId);
    expect(
      menu.insumos.filter((i) => i.nombre === "Coca-Cola de prueba 600 ml"),
    ).toHaveLength(1);
  });
});

describe("convertir un producto que ya estaba capturado", () => {
  /*
   * Es el caso de Rodizio: la carta lleva meses cargada, así que una casilla en
   * el alta no le resuelve ni una bebida.
   */
  it("le crea su insumo con el costo de la ficha y lo enlaza", () => {
    const creado = menu.crearProducto({
      nombre: "Agua mineral de prueba",
      categoria_id: menu.categorias[0]!.id,
      costo: pesos(9),
      precio: pesos(28),
      impuesto_id: menu.impuestos[0]!.id,
      precio_incluye_impuesto: true,
      disponible: true,
    });
    expect(creado.ok).toBe(true);

    const r = convertirEnReventa(creado.id!, { existencia: 12 });
    expect(r.ok).toBe(true);

    const espejo = insumoEspejoDe(creado.id!);
    expect(espejo?.nombre).toBe("Agua mineral de prueba");
    expect(espejo?.costo_unitario).toBe(pesos(9));
    expect(inventario.cantidad(espejo!.id)).toBe(12);
  });

  /*
   * Un platillo con ingredientes NO es una bebida embotellada. Convertirlo
   * borraría su receta y le pondría un único renglón —él mismo—, así que el
   * costo del platillo pasaría a ser el de comprarlo hecho, que no existe.
   */
  it("se niega a convertir un platillo que ya tiene receta", () => {
    const conReceta = [...catalogo.productos.values()].find((p) => p.receta_id);
    expect(conReceta).toBeTruthy();

    const r = convertirEnReventa(conReceta!.id);
    expect(r.ok).toBe(false);
    expect(r.problemas[0]?.mensaje).toMatch(/receta/i);
  });

  /*
   * Volver a convertir algo ya convertido no puede duplicar nada ni resetear la
   * existencia: el botón se pulsa dos veces por costumbre.
   */
  it("convertir dos veces no duplica el insumo ni toca la existencia", () => {
    const creado = menu.crearProducto({
      nombre: "Jarra de prueba",
      categoria_id: menu.categorias[0]!.id,
      costo: pesos(11),
      precio: pesos(40),
      impuesto_id: menu.impuestos[0]!.id,
      precio_incluye_impuesto: true,
      disponible: true,
    });

    const primera = convertirEnReventa(creado.id!, { existencia: 5 });
    expect(primera.ok).toBe(true);

    const segunda = convertirEnReventa(creado.id!);
    expect(segunda.ok).toBe(true);
    expect(segunda.insumoId).toBe(primera.insumoId);
    expect(inventario.cantidad(primera.insumoId!)).toBe(5);
    expect(menu.insumos.filter((i) => i.nombre === "Jarra de prueba")).toHaveLength(1);
  });
});
