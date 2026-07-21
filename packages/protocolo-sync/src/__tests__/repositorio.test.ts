/**
 * Las mismas pruebas corren contra las DOS implementaciones del contrato: la de
 * memoria y la de IndexedDB (con `fake-indexeddb`, que implementa la
 * especificación real). Si divergen, falla el CI.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { FabricaEventos, type EventoBase, type EventoComanda } from "@motrest/dominio";
import { almacenIndexedDB } from "../indexeddb.js";
import { almacenEnMemoria } from "../memoria.js";
import type { Almacen } from "../repositorio.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };

function eventos(cantidad: number, ordenId = "orden-1"): EventoComanda[] {
  const f = new FabricaEventos<EventoComanda>(CTX);
  return Array.from({ length: cantidad }, () =>
    f.crear("cuenta_cerrada", ordenId, { orden_id: ordenId }),
  );
}

const implementaciones: [string, () => Promise<Almacen>][] = [
  ["memoria", async () => almacenEnMemoria()],
  // Cada suite estrena su propia base para no arrastrar estado.
  ["IndexedDB", () => almacenIndexedDB(new IDBFactory())],
];

describe.each(implementaciones)("repositorio de eventos (%s)", (_nombre, crear) => {
  let almacen: Almacen;

  beforeEach(async () => {
    almacen = await crear();
    await almacen.eventos.limpiar();
    await almacen.estado.limpiar();
  });

  it("guarda y recupera eventos", async () => {
    const lote = eventos(3);
    await almacen.eventos.anexar(lote);

    const leidos = await almacen.eventos.leerTodos();
    expect(leidos).toHaveLength(3);
    expect(leidos.map((e) => e.id).sort()).toEqual(lote.map((e) => e.id).sort());
  });

  it("es idempotente: reanexar el mismo evento no lo duplica", async () => {
    const lote = eventos(2);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.anexar([lote[0]!]);

    expect(await almacen.eventos.contar()).toBe(2);
  });

  it("devuelve los eventos en orden determinista", async () => {
    const lote = eventos(20);
    // Se guardan desordenados a propósito.
    await almacen.eventos.anexar([...lote].reverse());

    const leidos = await almacen.eventos.leerTodos();
    expect(leidos.map((e) => e.id)).toEqual(lote.map((e) => e.id));
  });

  it("filtra por stream", async () => {
    await almacen.eventos.anexar([...eventos(2, "orden-A"), ...eventos(3, "orden-B")]);

    expect(await almacen.eventos.leerStream("orden-A")).toHaveLength(2);
    expect(await almacen.eventos.leerStream("orden-B")).toHaveLength(3);
    expect(await almacen.eventos.leerStream("orden-Z")).toHaveLength(0);
  });

  it("el log local ES el outbox: todo nace pendiente", async () => {
    const lote = eventos(3);
    await almacen.eventos.anexar(lote);

    const pendientes = await almacen.eventos.pendientes();
    expect(pendientes).toHaveLength(3);
    expect(pendientes.every((e) => e.seq === undefined)).toBe(true);
  });

  it("confirmar deja de listar el evento como pendiente y le fija su secuencia", async () => {
    const lote = eventos(3);
    await almacen.eventos.anexar(lote);

    await almacen.eventos.confirmar([
      { id: lote[0]!.id, seq: 10 },
      { id: lote[1]!.id, seq: 11 },
    ]);

    const pendientes = await almacen.eventos.pendientes();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]!.id).toBe(lote[2]!.id);

    const todos = await almacen.eventos.leerTodos();
    const confirmado = todos.find((e) => e.id === lote[0]!.id);
    expect(confirmado?.seq).toBe(10);
  });

  it("respeta el límite al pedir pendientes", async () => {
    await almacen.eventos.anexar(eventos(10));
    expect(await almacen.eventos.pendientes(4)).toHaveLength(4);
  });

  it("confirmar un id inexistente no rompe nada", async () => {
    await almacen.eventos.anexar(eventos(1));
    await expect(
      almacen.eventos.confirmar([{ id: "no-existe", seq: 1 }]),
    ).resolves.not.toThrow();
    expect(await almacen.eventos.contar()).toBe(1);
  });

  it("limpiar borra todo el log", async () => {
    await almacen.eventos.anexar(eventos(5));
    await almacen.eventos.limpiar();
    expect(await almacen.eventos.contar()).toBe(0);
  });
});

describe.each(implementaciones)("almacén de estado (%s)", (_nombre, crear) => {
  let almacen: Almacen;

  beforeEach(async () => {
    almacen = await crear();
    await almacen.estado.limpiar();
  });

  it("guarda y recupera valores estructurados", async () => {
    const credenciales = { "usr-1": [{ tipo: "pin", hash: "abc", sal: "def" }] };
    await almacen.estado.guardar("credenciales", credenciales);

    expect(await almacen.estado.cargar("credenciales")).toEqual(credenciales);
  });

  it("devuelve null cuando la clave no existe", async () => {
    expect(await almacen.estado.cargar("inexistente")).toBeNull();
  });

  it("sobrescribe el valor de una clave", async () => {
    await almacen.estado.guardar("intentos", { a: 1 });
    await almacen.estado.guardar("intentos", { a: 2 });
    expect(await almacen.estado.cargar("intentos")).toEqual({ a: 2 });
  });

  it("elimina una clave", async () => {
    await almacen.estado.guardar("sesion", "usr-1");
    await almacen.estado.eliminar("sesion");
    expect(await almacen.estado.cargar("sesion")).toBeNull();
  });
});

describe("persistencia real entre recargas (IndexedDB)", () => {
  it("lo guardado sobrevive a cerrar y reabrir la base", async () => {
    // Misma factory = mismo almacenamiento, como recargar la pestaña.
    const factory = new IDBFactory();

    const primera = await almacenIndexedDB(factory);
    const lote = eventos(4);
    await primera.eventos.anexar(lote);
    await primera.estado.guardar("sesion_activa", "usr-gonzalo");
    primera.cerrar();

    const segunda = await almacenIndexedDB(factory);
    const recuperados = await segunda.eventos.leerTodos();

    expect(recuperados).toHaveLength(4);
    expect(recuperados.map((e: EventoBase) => e.id)).toEqual(lote.map((e) => e.id));
    expect(await segunda.estado.cargar("sesion_activa")).toBe("usr-gonzalo");
    segunda.cerrar();
  });
});
