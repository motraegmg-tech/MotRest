/**
 * La promoción a lo largo de una cuenta que crece.
 *
 * El caso que se rompía en el local: la mesa pide dos pizzas, se le aplica el
 * 2×1, y media hora después pide dos más. La promoción dejaba de ofrecerse para
 * siempre — la cuenta ya la había «usado»— y no había manera de quitarla si se
 * había puesto la equivocada, salvo cancelar la cuenta entera.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { totalesComanda, uuidv7, type Promocion } from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { menu } from "../menu.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

/** Un producto vendible y la categoría a la que pertenece. */
function productoConCategoria(): { producto: string; categoria: string } {
  for (const p of catalogo.productos.values()) {
    if (p.disponible && p.precio > 0 && p.categoria_id) {
      return { producto: p.id, categoria: p.categoria_id };
    }
  }
  throw new Error("La carta de prueba no tiene productos vendibles con categoría");
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("una promoción en una cuenta que crece", () => {
  it("se vuelve a ofrecer cuando llegan platillos elegibles, y se puede quitar", async () => {
    const { producto, categoria } = productoConCategoria();

    const promo: Promocion = {
      id: uuidv7(),
      nombre: "2x1 de prueba",
      tipo: "nxm",
      productos: [],
      categorias: [categoria],
      vigencia: {},
      activa: true,
      lleva: 2,
      paga: 1,
    };
    expect(menu.guardarPromocion(promo).ok).toBe(true);

    const mesa = plano.todasLasMesas[4]!.id;
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);

    // Primera ronda: dos platillos elegibles.
    await pos.agregarSimple(producto);
    await pos.agregarSimple(producto);

    const ofrecidas = pos.promociones!.descuentos;
    expect(ofrecidas.length).toBeGreaterThan(0);
    const sinPromo = totalesComanda(pos.comanda!).total;

    pos.aplicarPromocion(ofrecidas[0]!);
    const conPromo = totalesComanda(pos.comanda!).total;
    expect(conPromo).toBeLessThan(sinPromo);
    expect(pos.promocionesAplicadas).toHaveLength(1);

    // Sin platillos nuevos no hay nada más que regalar.
    expect(pos.promociones!.descuentos).toHaveLength(0);

    /*
     * SEGUNDA RONDA. Aquí es donde el POS se quedaba mudo: la promoción existía,
     * los platillos eran elegibles, y el botón no volvía a salir.
     */
    await pos.agregarSimple(producto);
    await pos.agregarSimple(producto);
    const otraVez = pos.promociones!.descuentos;
    expect(otraVez.length).toBeGreaterThan(0);

    // La cuenta creció, así que se compara contra lo que costaría la segunda
    // ronda SIN promoción, no contra el total de antes de pedirla.
    const cuatroSinSegunda = totalesComanda(pos.comanda!).total;
    pos.aplicarPromocion(otraVez[0]!);
    expect(pos.promocionesAplicadas).toHaveLength(2);
    expect(totalesComanda(pos.comanda!).total).toBeLessThan(cuatroSinSegunda);

    /*
     * QUITAR UNA SOLA. Las dos aplicaciones son de la misma promoción, así que
     * retirar por promoción se habría llevado las dos por delante.
     */
    const segunda = pos.promocionesAplicadas[1]!;
    pos.retirarPromocion(segunda.id);

    expect(pos.promocionesAplicadas).toHaveLength(1);
    expect(pos.promocionesAplicadas[0]!.id).not.toBe(segunda.id);
    // Y al liberarse sus renglones, vuelve a estar disponible.
    expect(pos.promociones!.descuentos.length).toBeGreaterThan(0);
  });

  it("quitar la única promoción devuelve la cuenta a su total sin descuento", async () => {
    const { producto, categoria } = productoConCategoria();
    const promo: Promocion = {
      id: uuidv7(), nombre: "Mitad de prueba", tipo: "porcentaje",
      productos: [], categorias: [categoria], vigencia: {}, activa: true, fraccion: 0.5,
    };
    expect(menu.guardarPromocion(promo).ok).toBe(true);

    const mesa = plano.todasLasMesas[5]!.id;
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregarSimple(producto);

    const original = totalesComanda(pos.comanda!).total;
    const ofrecida = pos.promociones!.descuentos[0]!;
    pos.aplicarPromocion(ofrecida);
    expect(totalesComanda(pos.comanda!).total).toBeLessThan(original);

    pos.retirarPromocion(pos.promocionesAplicadas[0]!.id);
    expect(totalesComanda(pos.comanda!).total).toBe(original);
    expect(pos.promocionesAplicadas).toHaveLength(0);
  });
});
