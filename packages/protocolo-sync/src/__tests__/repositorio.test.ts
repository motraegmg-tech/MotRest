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

  /*
   * Si el Hub pierde su base —disco cambiado, reinstalación, respaldo viejo—
   * la terminal es la única que conserva la operación. Sin esto seguiría
   * creyendo que sus ventas están a salvo en un Hub que ya las olvidó, y el
   * corte de caja saldría corto sin que nadie supiera por qué.
   */
  it("reabrir el outbox devuelve TODO al pendiente, aunque ya estuviera confirmado", async () => {
    const lote = eventos(3);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.confirmar(lote.map((e, i) => ({ id: e.id, seq: i + 1 })));
    expect(await almacen.eventos.pendientes()).toHaveLength(0);

    await almacen.eventos.reabrirOutbox();

    const pendientes = await almacen.eventos.pendientes();
    expect(pendientes).toHaveLength(3);
    // La secuencia vieja era la posición en la historia de un Hub que ya no
    // existe: se va con ella. La asignará el Hub nuevo.
    expect(pendientes.every((e) => e.seq === undefined)).toBe(true);
  });

  it("reabrir el outbox no pierde ni duplica ningún evento", async () => {
    const lote = eventos(5);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.confirmar([{ id: lote[0]!.id, seq: 1 }]);

    await almacen.eventos.reabrirOutbox();

    expect(await almacen.eventos.contar()).toBe(5);
    const ids = (await almacen.eventos.pendientes()).map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
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
  // --- El evento que el Hub rechaza ------------------------------------------------
  //
  // Lo que se prueba aquí es el defecto que dejó a Rodizio meses sin un solo
  // corte de caja: un evento rechazado que se quedaba en el outbox y se
  // reenviaba en cada reconexión, para siempre y en silencio.

  it("saca del outbox lo que el Hub rechazó", async () => {
    const lote = eventos(3);
    await almacen.eventos.anexar(lote);
    expect(await almacen.eventos.pendientes()).toHaveLength(3);

    await almacen.eventos.rechazar([lote[1]!.id], "Empleado desconocido: sistema");

    // Ya no se reintenta: es lo que corta el bucle.
    const pendientes = await almacen.eventos.pendientes();
    expect(pendientes).toHaveLength(2);
    expect(pendientes.map((e) => e.id)).not.toContain(lote[1]!.id);
  });

  it("NO lo borra: el evento sigue en el log y en la proyección", async () => {
    const lote = eventos(2);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.rechazar([lote[0]!.id], "sin permiso");

    expect(await almacen.eventos.contar()).toBe(2);
    const todos = await almacen.eventos.leerTodos();
    expect(todos.map((e) => e.id)).toContain(lote[0]!.id);
  });

  it("guarda el motivo que dio el Hub, para poder enseñarlo", async () => {
    const lote = eventos(1);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.rechazar([lote[0]!.id], "Empleado desconocido: sistema");

    const rechazados = await almacen.eventos.rechazados();
    expect(rechazados).toHaveLength(1);
    expect(rechazados[0]!.motivo).toBe("Empleado desconocido: sistema");
    expect(rechazados[0]!.evento.id).toBe(lote[0]!.id);
  });

  it("reabrirOutbox NO resucita lo rechazado", async () => {
    /*
     * `reabrirOutbox` es para cuando el Hub perdió su historia y hay que
     * reenviárselo todo. Un evento rechazado por permisos lo va a rechazar
     * igual el Hub nuevo —el defecto está en el evento—, así que devolverlo al
     * outbox reabriría el bucle que esto vino a cerrar.
     */
    const lote = eventos(2);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.confirmar([{ id: lote[0]!.id, seq: 1 }]);
    await almacen.eventos.rechazar([lote[1]!.id], "sin permiso");

    await almacen.eventos.reabrirOutbox();

    const pendientes = await almacen.eventos.pendientes();
    expect(pendientes.map((e) => e.id)).toEqual([lote[0]!.id]);
  });

  it("si el Hub acaba aceptándolo, deja de estar rechazado", async () => {
    // Pasa tras corregir los permisos del usuario y reenviarlo a mano.
    const lote = eventos(1);
    await almacen.eventos.anexar(lote);
    await almacen.eventos.rechazar([lote[0]!.id], "sin permiso");
    await almacen.eventos.confirmar([{ id: lote[0]!.id, seq: 7 }]);

    expect(await almacen.eventos.rechazados()).toHaveLength(0);
    expect(await almacen.eventos.pendientes()).toHaveLength(0);
  });

  it("rechazar un id que no existe no rompe nada", async () => {
    await almacen.eventos.anexar(eventos(1));
    await almacen.eventos.rechazar(["no-existe"], "sin permiso");
    expect(await almacen.eventos.rechazados()).toHaveLength(0);
    expect(await almacen.eventos.pendientes()).toHaveLength(1);
  });

  // --- La purga por retención -------------------------------------------------------
  //
  // Lo que importa aquí no es lo que se borra, sino LO QUE NO. Un evento que
  // sigue en el outbox es un hecho que todavía no existe en ninguna otra parte:
  // tirarlo lo perdería para siempre y sin rastro.

  it("retira los eventos de las cuentas que se le piden", async () => {
    const vieja = eventos(3, "orden-vieja");
    const nueva = eventos(2, "orden-nueva");
    await almacen.eventos.anexar([...vieja, ...nueva]);
    // Todo confirmado: está a salvo en el Hub.
    await almacen.eventos.confirmar(
      [...vieja, ...nueva].map((e, i) => ({ id: e.id, seq: i + 1 })),
    );

    const retirados = await almacen.eventos.purgarStreams(["orden-vieja"]);

    expect(retirados).toBe(3);
    expect(await almacen.eventos.contar()).toBe(2);
    expect((await almacen.eventos.leerStream("orden-vieja"))).toHaveLength(0);
    expect((await almacen.eventos.leerStream("orden-nueva"))).toHaveLength(2);
  });

  it("NO retira una cuenta con algo sin confirmar, y la salta ENTERA", async () => {
    /*
     * Media cuenta borrada es peor que ninguna: quedan renglones sueltos que ya
     * no se pueden ubicar en ninguna mesa. Si una sola pieza está pendiente, la
     * cuenta completa se queda.
     */
    const lote = eventos(3, "orden-a-medias");
    await almacen.eventos.anexar(lote);
    // Solo dos de los tres llegaron al Hub.
    await almacen.eventos.confirmar([
      { id: lote[0]!.id, seq: 1 },
      { id: lote[1]!.id, seq: 2 },
    ]);

    const retirados = await almacen.eventos.purgarStreams(["orden-a-medias"]);

    expect(retirados).toBe(0);
    expect(await almacen.eventos.contar()).toBe(3);
  });

  it("una cuenta pendiente no impide limpiar las demás", async () => {
    const buena = eventos(2, "orden-confirmada");
    const pendiente = eventos(2, "orden-pendiente");
    await almacen.eventos.anexar([...buena, ...pendiente]);
    await almacen.eventos.confirmar(buena.map((e, i) => ({ id: e.id, seq: i + 1 })));

    const retirados = await almacen.eventos.purgarStreams([
      "orden-confirmada",
      "orden-pendiente",
    ]);

    expect(retirados).toBe(2);
    expect((await almacen.eventos.leerStream("orden-pendiente"))).toHaveLength(2);
  });

  it("purgar una lista vacía no hace nada", async () => {
    await almacen.eventos.anexar(eventos(2));
    expect(await almacen.eventos.purgarStreams([])).toBe(0);
    expect(await almacen.eventos.contar()).toBe(2);
  });

  it("lo purgado sale también del outbox y de los rechazados", async () => {
    const lote = eventos(2, "orden-x");
    await almacen.eventos.anexar(lote);
    await almacen.eventos.confirmar(lote.map((e, i) => ({ id: e.id, seq: i + 1 })));

    await almacen.eventos.purgarStreams(["orden-x"]);

    expect(await almacen.eventos.pendientes()).toHaveLength(0);
    expect(await almacen.eventos.rechazados()).toHaveLength(0);
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

  /*
   * Lo que dejó al responsable de Rodizio fuera de su propio sistema.
   *
   * Los stores del POS son de Svelte 5 y casi todo lo que sale de un `$state`
   * es un Proxy. `put()` serializa con structured clone, que revienta con un
   * Proxy: la escritura fallaba, quien llamaba lo anotaba en la consola, y las
   * escrituras siguientes de esa misma función no llegaban a ejecutarse. En el
   * disco de la caja: `credenciales` 43 veces, `provisiones_responsable` cero.
   */
  /*
   * Lo que hacía desaparecer a los empleados de Rodizio.
   *
   * Los permisos de un alta salen tal cual de la pantalla, y en Svelte 5 eso es
   * un Proxy. `anexar` lo metía directo en IndexedDB: `DataCloneError`, el
   * `.catch()` lo anotaba en la consola, y el usuario vivía solo en memoria
   * hasta que alguien cerraba la aplicación. En el log del Hub no había ni un
   * alta de empleado, ni un rechazo: el evento nunca salió de la terminal.
   */
  it("anexar un evento con datos reactivos dentro NO revienta", async () => {
    const factory = new IDBFactory();
    const almacen = await almacenIndexedDB(factory);

    const base = eventos(1)[0]!;
    const alta = {
      ...base,
      tipo: "usuario_creado",
      usuario_id: "usr-nuevo",
      // Tal cual llega de la pantalla de administración.
      permisos: new Proxy([{ accion: "pos.orden.abrir", nivel: "operar" }], {}),
    } as unknown as EventoBase;

    await expect(almacen.eventos.anexar([alta])).resolves.toBeUndefined();
    const guardados = await almacen.eventos.leerTodos();
    expect(guardados).toHaveLength(1);
    expect((guardados[0] as unknown as { permisos: unknown[] }).permisos).toHaveLength(1);
    almacen.cerrar();
  });

  it("guardar un objeto reactivo (Proxy) NO revienta", async () => {
    const factory = new IDBFactory();
    const almacen = await almacenIndexedDB(factory);

    const original = { "usr-gonzalo": { provision_id: "local:usr-gonzalo", debe_cambiar: false } };
    const comoUnStore = new Proxy(original, {});

    await expect(almacen.estado.guardar("provisiones_responsable", comoUnStore)).resolves
      .toBeUndefined();
    expect(await almacen.estado.cargar("provisiones_responsable")).toEqual(original);
    almacen.cerrar();
  });

  it("una escritura que falla no impide las siguientes de la misma tanda", async () => {
    const factory = new IDBFactory();
    const almacen = await almacenIndexedDB(factory);

    // Tal cual lo hace `guardarSecretos`: varias claves seguidas, y la de en
    // medio es la reactiva. Antes, esa tiraba y las de después no corrían.
    await almacen.estado.guardar("credenciales", { "usr-gonzalo": [{ tipo: "pin" }] });
    await almacen.estado.guardar("intentos", new Proxy({ "usr-gonzalo": { fallos: 0 } }, {}));
    await almacen.estado.guardar("provisiones_responsable", new Proxy({ aplicada: true }, {}));

    expect(await almacen.estado.cargar("credenciales")).not.toBeNull();
    expect(await almacen.estado.cargar("intentos")).not.toBeNull();
    expect(await almacen.estado.cargar("provisiones_responsable")).toEqual({ aplicada: true });
    almacen.cerrar();
  });
  /**
   * EL BUCLE NO PUEDE VOLVER AL REINICIAR.
   *
   * Es la propiedad de la que depende todo el arreglo de Rodizio. El apartado
   * vive en la base, no en memoria: si se perdiera al cerrar el POS, el evento
   * volvería al outbox en cada arranque y el bucle de rechazos se reanudaría
   * cada mañana — que es exactamente lo que llevaba meses pasando.
   */
  it("lo rechazado sigue apartado tras reiniciar el POS", async () => {
    const factory = new IDBFactory();

    // El día del defecto: el corte se emite y el Hub lo rechaza.
    const antes = await almacenIndexedDB(factory);
    const lote = eventos(3);
    await antes.eventos.anexar(lote);
    await antes.eventos.rechazar([lote[1]!.id], "Empleado desconocido: sistema");
    antes.cerrar();

    // A la mañana siguiente se abre el POS.
    const despues = await almacenIndexedDB(factory);

    // No vuelve al outbox: no se reenvía, no lo rechazan, no se cae a isla.
    const pendientes = await despues.eventos.pendientes();
    expect(pendientes).toHaveLength(2);
    expect(pendientes.map((e: EventoBase) => e.id)).not.toContain(lote[1]!.id);

    // Y el motivo sigue ahí para poder enseñarlo.
    const rechazados = await despues.eventos.rechazados();
    expect(rechazados).toHaveLength(1);
    expect(rechazados[0]!.motivo).toBe("Empleado desconocido: sistema");

    // El evento NO se perdió: sigue en el log y en la proyección local.
    expect(await despues.eventos.contar()).toBe(3);
    despues.cerrar();
  });

});
