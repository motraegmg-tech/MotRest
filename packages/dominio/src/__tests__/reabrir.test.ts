/**
 * Reabrir una cuenta cobrada por error.
 *
 * El permiso `pos.cuenta.reabrir` existía en la matriz desde el principio y no
 * hacía nada: una promesa vacía. Lo que se prueba aquí es sobre todo lo que
 * NO debe pasar al reabrir, porque una cuenta que vuelve a abrirse es la vía
 * más limpia para sacar dinero de una caja si no deja rastro.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "d1", empleado_id: "usr-lucia", sucursal_id: "s1" };
const ORDEN = "orden-1";
const f = () => new FabricaEventos<EventoComanda>(CTX);

/** Una cuenta con un platillo, pagada y cerrada. */
function cobrada(): EventoComanda[] {
  return [
    f().crear("orden_creada", ORDEN, { orden_id: ORDEN, mesa_id: "mesa-1", abierta_ts: Date.now() }),
    f().crear("item_agregado", ORDEN, {
      orden_id: ORDEN,
      renglon: {
        id: uuidv7(), producto_id: "prod-pizza", descripcion: "Pizza", cantidad: 1,
        precio_unitario: pesos(249), costo_unitario: pesos(62),
        impuesto: snapshotTasas(IVA_16), estado: "entregado",
      },
    }),
    f().crear("pago_registrado", ORDEN, { orden_id: ORDEN, monto: pesos(249), forma: "efectivo" }),
    f().crear("cuenta_cerrada", ORDEN, { orden_id: ORDEN }),
  ];
}

function reabrir(motivo = "Se cobró de más"): EventoComanda {
  return f().crear("cuenta_reabierta", ORDEN, {
    orden_id: ORDEN,
    motivo,
    autorizador_id: "usr-gonzalo",
  });
}

describe("reabrir", () => {
  it("la cuenta vuelve a estar abierta", () => {
    const c = proyectarComanda([...cobrada(), reabrir()]);
    expect(c.cerrada).toBe(false);
  });

  /*
   * EL CANDADO CONTABLE. Si se dejara el sello de cierre viejo, la venta
   * seguiría contando en el corte del turno en que se cobró mal mientras la
   * cuenta está otra vez abierta: el mismo dinero aparecería dos veces.
   */
  it("se borra el sello de cierre, para que no cuente dos veces en el corte", () => {
    const antes = proyectarComanda(cobrada());
    expect(antes.cerrada_ts).toBeDefined();

    const despues = proyectarComanda([...cobrada(), reabrir()]);
    expect(despues.cerrada_ts).toBeUndefined();
  });

  /*
   * Los pagos NO se borran: fueron hechos. Borrarlos haría desaparecer dinero
   * que sí entró al cajón; se ven al reabrir para poder devolverlos.
   */
  it("los pagos ya hechos siguen registrados", () => {
    const c = proyectarComanda([...cobrada(), reabrir()]);
    expect(c.pagos).toHaveLength(1);
    expect(c.pagos[0]!.monto).toBe(pesos(249));
  });

  it("el consumo no se toca", () => {
    const c = proyectarComanda([...cobrada(), reabrir()]);
    expect(c.renglones).toHaveLength(1);
    expect(totalesComanda(c).total).toBe(totalesComanda(proyectarComanda(cobrada())).total);
  });

  /* Queda marcada para siempre: merece una segunda mirada al revisar el corte. */
  it("queda marcada como reabierta, incluso tras volver a cobrarla", () => {
    const c = proyectarComanda([
      ...cobrada(),
      reabrir(),
      f().crear("cuenta_cerrada", ORDEN, { orden_id: ORDEN }),
    ]);
    expect(c.reabierta).toBe(true);
    expect(c.cerrada).toBe(true);
  });

  it("una cuenta que nunca se reabrió no lleva la marca", () => {
    expect(proyectarComanda(cobrada()).reabierta).toBeUndefined();
  });

  it("se puede cobrar de nuevo tras reabrir, con su nuevo sello", () => {
    const c = proyectarComanda([
      ...cobrada(),
      reabrir(),
      f().crear("cuenta_cerrada", ORDEN, { orden_id: ORDEN }),
    ]);
    expect(c.cerrada_ts).toBeDefined();
  });
});
