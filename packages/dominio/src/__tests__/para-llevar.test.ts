/**
 * Pedidos para llevar: a nombre de quién va.
 *
 * En una pizzería buena parte de la venta sale por el mostrador. Sin un nombre,
 * cocina prepara y nadie sabe de quién es la bolsa: el número de "mesa" de un
 * pedido para llevar no le dice nada a nadie.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import { proyectarTablero } from "../cocina/tablero.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "d1", empleado_id: "usr-lucia", sucursal_id: "s1" };
const ORDEN = "orden-llevar-1";

function base(): EventoComanda[] {
  const f = new FabricaEventos<EventoComanda>(CTX);
  return [
    f.crear("orden_creada", ORDEN, {
      orden_id: ORDEN,
      mesa_id: "mostrador-1",
      abierta_ts: Date.now(),
    }),
    f.crear("item_agregado", ORDEN, {
      orden_id: ORDEN,
      renglon: {
        id: uuidv7(), producto_id: "prod-pizza", descripcion: "Pizza familiar",
        cantidad: 1, precio_unitario: pesos(249), costo_unitario: pesos(62),
        impuesto: snapshotTasas(IVA_16), estado: "enviado",
        enviado_ts: Date.now(), estacion_id: "est-horno",
      },
    }),
  ];
}

function identificar(nombre: string, telefono?: string): EventoComanda {
  return new FabricaEventos<EventoComanda>(CTX).crear("orden_identificada", ORDEN, {
    orden_id: ORDEN,
    nombre,
    telefono,
  });
}

describe("poner nombre al pedido", () => {
  it("queda en la comanda, con su teléfono", () => {
    const c = proyectarComanda([...base(), identificar("Gonzalo", "33-1122-3344")]);
    expect(c.a_nombre_de).toBe("Gonzalo");
    expect(c.telefono).toBe("33-1122-3344");
  });

  it("se puede corregir: manda el último", () => {
    const c = proyectarComanda([
      ...base(),
      identificar("Gonzálo"),
      identificar("Gonzalo Díaz"),
    ]);
    expect(c.a_nombre_de).toBe("Gonzalo Díaz");
  });

  it("una comanda sin identificar no lo inventa", () => {
    const c = proyectarComanda(base());
    expect(c.a_nombre_de).toBeUndefined();
  });

  /* Identificar el pedido NO lo cierra ni le toca nada más. */
  it("no altera el resto de la cuenta", () => {
    const sin = proyectarComanda(base());
    const con = proyectarComanda([...base(), identificar("Gonzalo")]);

    expect(con.renglones).toHaveLength(sin.renglones.length);
    expect(con.cerrada).toBe(sin.cerrada);
  });
});

describe("el nombre llega a cocina", () => {
  const estaciones = [
    { id: "est-horno", nombre: "Horno", minutos_objetivo: 12, minutos_limite: 20 },
  ];

  it("el ticket del KDS lo lleva", () => {
    const c = proyectarComanda([...base(), identificar("Gonzalo")]);
    const [ticket] = proyectarTablero([c], { ahora: Date.now(), estaciones });

    expect(ticket!.a_nombre_de).toBe("Gonzalo");
  });

  it("un pedido de mesa no lo lleva, y el KDS sigue mostrando la mesa", () => {
    const c = proyectarComanda(base());
    const [ticket] = proyectarTablero([c], { ahora: Date.now(), estaciones });

    expect(ticket!.a_nombre_de).toBeUndefined();
    expect(ticket!.mesa_id).toBe("mostrador-1");
  });
});
