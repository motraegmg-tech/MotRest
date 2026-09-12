/**
 * Lo que un mesero captura en la tableta tiene que verse en la caja, solo.
 *
 * ## El defecto que estas pruebas cierran
 *
 * Gonzalo: «las comandas que se hagan desde dispositivos del hub, se ven en
 * automático en la computadora que manda el hub». No se veían.
 *
 * Y no era la red. Solo `orden_creada` dice a qué mesa pertenece una orden; el
 * resto de los eventos —agregar un platillo, cobrar, cerrar— llevan únicamente
 * el `orden_id`. `agruparPorMesa` construía el mapa de orden→mesa **con los
 * eventos del lote que recibía y nada más**, así que:
 *
 * 1. La tableta abre la mesa 5. El Hub reparte ese evento. La caja lo ubica
 *    —viene con su `mesa_id` dentro— y pinta la mesa. **Funciona.**
 * 2. El mesero agrega una pizza. El Hub reparte un lote con ese solo evento.
 *    La caja no sabe de qué mesa es y lo **descarta en silencio**.
 *
 * El evento sí quedaba guardado en el disco, así que al reiniciar el POS
 * aparecía todo de golpe. Por eso parecía un problema de red intermitente.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  FabricaEventos,
  pesos,
  snapshotTasas,
  IVA_16,
  totalesComanda,
  uuidv7,
  type EventoComanda,
} from "@motrest/dominio";
import { pos } from "../pos.svelte";

const TABLETA = { device_id: "tablet-salon", empleado_id: "usr-mesero", sucursal_id: "suc-1" };
const f = () => new FabricaEventos<EventoComanda>(TABLETA);

const MESA = "mesa-5";
const ORDEN = "ord-tablet-1";

/** Lo que la tableta emite al sentar a la mesa. */
function abrirMesa(): EventoComanda {
  return f().crear("orden_creada", ORDEN, {
    orden_id: ORDEN,
    mesa_id: MESA,
    abierta_ts: Date.now(),
  });
}

/** Lo que emite al agregar un platillo. Ojo: NO lleva la mesa dentro. */
function agregarPizza(precio = 249): EventoComanda {
  return f().crear("item_agregado", ORDEN, {
    orden_id: ORDEN,
    renglon: {
      id: uuidv7(),
      producto_id: "p-margarita",
      descripcion: "Pizza Margarita",
      cantidad: 1,
      precio_unitario: pesos(precio),
      costo_unitario: pesos(70),
      impuesto: snapshotTasas(IVA_16),
      estado: "capturado",
    },
  });
}

/** La comanda de esa mesa, tal como la vería la pantalla de la caja. */
function comandaEnLaCaja() {
  return pos.todasLasComandas.find((c) => c.orden_id === ORDEN);
}

describe("las comandas de la tableta llegan a la caja", () => {
  beforeEach(() => {
    pos.hidratar([]);
  });

  it("EN LOTES SEPARADOS, que es como llegan de verdad", () => {
    /*
     * El Hub reparte lo que le va llegando, no espera a juntar la comanda. La
     * apertura viaja sola y el platillo viaja solo, en otro momento. Esta es la
     * prueba que fallaba antes del arreglo.
     */
    pos.integrar([abrirMesa()]);
    expect(comandaEnLaCaja()).toBeDefined();

    pos.integrar([agregarPizza()]);

    const comanda = comandaEnLaCaja();
    expect(comanda?.renglones).toHaveLength(1);
    expect(comanda?.renglones[0]?.descripcion).toBe("Pizza Margarita");
  });

  it("y la cuenta suma lo que el mesero capturó", () => {
    pos.integrar([abrirMesa()]);
    pos.integrar([agregarPizza(249)]);
    pos.integrar([agregarPizza(269)]);

    const t = totalesComanda(comandaEnLaCaja()!);
    // 518 de carta, con el IVA encima: es lo que verá la caja al cobrar.
    expect(t.subtotal).toBe(pesos(518));
    expect(t.total).toBe(pesos(600.88));
  });

  it("varios platillos seguidos, uno por lote", () => {
    pos.integrar([abrirMesa()]);
    for (let i = 0; i < 5; i += 1) pos.integrar([agregarPizza()]);
    expect(comandaEnLaCaja()?.renglones).toHaveLength(5);
  });

  it("el cobro y el cierre también llegan", () => {
    pos.integrar([abrirMesa()]);
    pos.integrar([agregarPizza()]);

    const total = totalesComanda(comandaEnLaCaja()!).total;
    pos.integrar([
      f().crear("pago_registrado", ORDEN, { orden_id: ORDEN, monto: total, forma: "efectivo" }),
    ]);
    pos.integrar([f().crear("cuenta_cerrada", ORDEN, { orden_id: ORDEN })]);

    const comanda = comandaEnLaCaja()!;
    expect(comanda.cerrada).toBe(true);
    expect(comanda.pagos).toHaveLength(1);
  });

  it("no duplica si el Hub reparte el mismo evento dos veces", () => {
    // Pasa al reconectar: el Hub reenvía desde la última secuencia conocida.
    pos.integrar([abrirMesa()]);
    const pizza = agregarPizza();
    pos.integrar([pizza]);
    pos.integrar([pizza]);
    expect(comandaEnLaCaja()?.renglones).toHaveLength(1);
  });

  it("un evento de una orden que esta terminal nunca vio NO se cuela", () => {
    /*
     * Sigue habiendo huérfanos legítimos —una orden de otra sucursal, un lote
     * fuera de orden— y no se inventan mesas para ellos. La diferencia es que
     * ahora se avisa por consola en vez de descartarlos en silencio.
     */
    pos.integrar([
      f().crear("item_agregado", "ord-desconocida", {
        orden_id: "ord-desconocida",
        renglon: {
          id: uuidv7(),
          producto_id: "p-x",
          descripcion: "Platillo fantasma",
          cantidad: 1,
          precio_unitario: pesos(100),
          costo_unitario: pesos(30),
          impuesto: snapshotTasas(IVA_16),
          estado: "capturado",
        },
      }),
    ]);
    expect(pos.todasLasComandas.find((c) => c.orden_id === "ord-desconocida")).toBeUndefined();
  });

  it("una mesa abierta en la tableta aparece ocupada en la caja", () => {
    // Es lo que ve el cajero: la mesa deja de estar libre sin que él toque nada.
    pos.integrar([abrirMesa()]);
    pos.integrar([agregarPizza()]);
    const abiertas = pos.todasLasComandas.filter((c) => !c.cerrada && !c.anulada);
    expect(abiertas.some((c) => c.orden_id === ORDEN)).toBe(true);
  });
});
