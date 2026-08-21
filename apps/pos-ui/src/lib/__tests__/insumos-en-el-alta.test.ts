/**
 * Dar de alta un platillo CON sus insumos, y que el almacén se mueva solo.
 *
 * Los insumos por platillo ya se podían declarar, pero en una pantalla aparte a
 * la que se llegaba DESPUÉS de crear el producto. El resultado práctico era que
 * casi ningún platillo los tenía —quien captura la carta captura treinta
 * seguidos y no vuelve— y sin ellos el inventario no se mueve solo, que es lo
 * único que hace útil llevarlo.
 *
 * Esta prueba recorre el circuito entero, que es donde vivía el fallo: el id del
 * producto no existe hasta que está creado, así que los insumos capturados en el
 * alta no tenían dónde guardarse y se perdían al cerrar el formulario.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  ingredienteNuevo,
  pesos,
  recetaNueva,
  type Receta,
} from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { inventario } from "../inventario.svelte";
import { menu } from "../menu.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const GRAMOS_POR_PLATILLO = 180;
const EXISTENCIA_INICIAL = 5_000;

let insumoId = "";
let productoId = "";

/**
 * Una mesa distinta en cada llamada, para que las pruebas no se pisen.
 *
 * NO se exige que esté libre: el salón de la demostración arranca sembrado con
 * comandas y quedan muy pocas vacías. Lo que sí importa es no suponer nunca cuál
 * de los renglones de la mesa es el de la prueba — suponer que era el primero
 * costó un falso negativo, porque se cancelaba el renglón de otro y el almacén,
 * con razón, no devolvía nada.
 */
let siguiente = 0;
function otraMesa(): string {
  const mesa = plano.todasLasMesas[siguiente++];
  if (!mesa) throw new Error("Se acabaron las mesas del salón de pruebas");
  return mesa.id;
}

/** Sienta la mesa, pide el producto y devuelve el id del renglón capturado. */
async function pedir(productoId: string, cantidad = 1): Promise<string> {
  const mesa = otraMesa();
  pos.seleccionarMesa(mesa);
  pos.abrirMesa(mesa);
  await pos.agregar({ producto_id: productoId, cantidad });

  // El recién agregado es el ÚLTIMO, no el primero: la mesa puede traer cosas.
  return pos.renglones.at(-1)!.id;
}

/** Los movimientos de almacén que causó un renglón concreto. */
function movimientosDe(renglonId: string) {
  return inventario.movimientos.filter(
    (m) => m.tipo === "movimiento_inventario" && m.renglon_id === renglonId,
  );
}

/** La receta tal como la arma el formulario del producto. */
function recetaCon(insumo_id: string, cantidad: number): Receta {
  const base = recetaNueva("Focaccia de prueba");
  return {
    ...base,
    ingredientes: [
      {
        ...ingredienteNuevo(),
        nombre: "Harina de prueba",
        insumo_id,
        cantidad,
        unidad: "g",
        costo: pesos(9),
      },
    ],
  };
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);

  const alta = menu.crearInsumo({
    nombre: "Harina de prueba",
    unidad_base: "g",
    costo_unitario: pesos(0.05),
    stock_minimo: 1_000,
  });
  if (!alta.ok) throw new Error("No se pudo dar de alta el insumo de prueba");

  insumoId = menu.insumos.find((i) => i.nombre === "Harina de prueba")!.id;
  inventario.registrar(insumoId, EXISTENCIA_INICIAL, "recepcion", "Carga de la prueba");
});

describe("el alta de un platillo con sus insumos", () => {
  /*
   * ESTE ES EL FALLO QUE SE ARREGLÓ. `crearProducto` no devolvía el id que
   * inventa el dominio, así que al terminar el alta no había contra qué guardar
   * la receta: los insumos recién capturados se iban a la basura en silencio.
   */
  it("crear un producto devuelve su id, que es donde se cuelga la receta", () => {
    const r = menu.crearProducto({
      nombre: "Focaccia de prueba",
      categoria_id: menu.categorias[0]!.id,
      costo: pesos(20),
      precio: pesos(90),
      impuesto_id: menu.impuestos[0]!.id,
      precio_incluye_impuesto: true,
      disponible: true,
    });

    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();
    productoId = r.id!;
  });

  it("la receta queda guardada contra ese producto", () => {
    const r = menu.guardarRecetaDe(productoId, recetaCon(insumoId, GRAMOS_POR_PLATILLO));
    expect(r.ok).toBe(true);

    const guardada = menu.recetaDe(productoId);
    expect(guardada?.ingredientes).toHaveLength(1);
    expect(guardada?.ingredientes[0]!.insumo_id).toBe(insumoId);
    expect(guardada?.ingredientes[0]!.cantidad).toBe(GRAMOS_POR_PLATILLO);
  });

  it("y el catálogo que usa el POS ya la conoce", () => {
    expect(catalogo.productos.get(productoId)?.receta_id).toBeTruthy();
  });
});

describe("vender ese platillo mueve el almacén", () => {
  it("mandar uno a cocina descuenta su gramaje", async () => {
    await pedir(productoId);

    const antes = inventario.cantidad(insumoId);
    await pos.enviarACocina();

    expect(inventario.cantidad(insumoId)).toBe(antes - GRAMOS_POR_PLATILLO);
  });

  it("dos unidades del mismo platillo se llevan el doble", async () => {
    await pedir(productoId, 2);

    const antes = inventario.cantidad(insumoId);
    await pos.enviarACocina();

    expect(inventario.cantidad(insumoId)).toBe(antes - GRAMOS_POR_PLATILLO * 2);
  });

  it("y cancelarlo lo devuelve entero", async () => {
    const renglonId = await pedir(productoId);

    const antes = inventario.cantidad(insumoId);
    await pos.enviarACocina();
    expect(inventario.cantidad(insumoId)).toBe(antes - GRAMOS_POR_PLATILLO);

    await pos.cancelar(renglonId);
    expect(inventario.cantidad(insumoId)).toBe(antes);
  });

  /*
   * Un platillo sin insumos declarados se vende exactamente igual: la capa es
   * OPCIONAL (ADR-16). Si esto fallara, poner insumos en el alta habría vuelto
   * obligatorio llevar inventario para poder vender.
   */
  it("un platillo sin insumos se vende igual y no mueve nada", async () => {
    const sinReceta = menu.crearProducto({
      nombre: "Agua de prueba",
      categoria_id: menu.categorias[0]!.id,
      costo: pesos(5),
      precio: pesos(30),
      impuesto_id: menu.impuestos[0]!.id,
      precio_incluye_impuesto: true,
      disponible: true,
    });
    expect(sinReceta.ok).toBe(true);

    const renglonId = await pedir(sinReceta.id!);
    await pos.enviarACocina();

    // Se mira POR RENGLÓN y no el total de movimientos: la mesa puede llevar
    // otros platillos que sí tengan receta, y esos deben moverse con normalidad.
    expect(movimientosDe(renglonId)).toEqual([]);
  });
});
