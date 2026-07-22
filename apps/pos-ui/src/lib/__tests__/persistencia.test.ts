/**
 * Prueba de aceptación de la etapa 4: **recargar no pierde la operación**.
 *
 * Arranca la aplicación contra IndexedDB, opera, y comprueba que reconstruir el
 * estado desde lo guardado en disco da exactamente lo mismo que hay en pantalla.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  agruparPorMesa,
  pesos,
  proyectarComanda,
  renglonesActivos,
  totalesComanda,
  type EventoComanda,
} from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";

/** Lee el log guardado y reconstruye la comanda de una mesa, como al recargar. */
async function comandaDesdeDisco(mesaId: string) {
  const almacen = arranque.repositorio!;
  const guardados = (await almacen.eventos.leerTodos()) as EventoComanda[];
  const soloComanda = guardados.filter((e) => "orden_id" in e);
  const log = agruparPorMesa(soloComanda)[mesaId];
  return log ? proyectarComanda(log) : null;
}

describe("arranque con persistencia", () => {
  beforeAll(async () => {
    await arranque.iniciar();
  });

  it("no cae al modo efímero: IndexedDB está disponible", () => {
    expect(arranque.efimero).toBe(false);
    expect(arranque.error).toBe("");
    expect(arranque.cargando).toBe(false);
  });

  it("siembra la demostración cuando el dispositivo está vacío", async () => {
    const total = await arranque.repositorio!.eventos.contar();
    expect(total).toBeGreaterThan(0);

    const mesa12 = await comandaDesdeDisco("mesa-12");
    expect(mesa12).not.toBeNull();
    expect(totalesComanda(mesa12!).total).toBe(pesos(598.56));
  });

  it("abre una sesión utilizable", () => {
    expect(sesion.autenticado).toBe(true);
    expect(sesion.usuarioActual?.id).toBe("usr-lucia");
  });
});

describe("lo que se opera queda guardado", () => {
  it("agregar un producto se persiste y reconstruye igual", async () => {
    pos.seleccionarMesa("mesa-12");
    const antes = pos.renglones.length;

    await pos.agregarSimple("prod-agua");

    // En pantalla.
    expect(pos.renglones).toHaveLength(antes + 1);
    const enPantalla = totalesComanda(pos.comanda!);

    // En disco: reconstruido desde cero, como haría una recarga.
    const enDisco = await comandaDesdeDisco("mesa-12");
    expect(renglonesActivos(enDisco!)).toHaveLength(antes + 1);
    expect(totalesComanda(enDisco!)).toEqual(enPantalla);
  });

  it("cancelar un renglón también viaja al disco", async () => {
    pos.seleccionarMesa("mesa-12");
    const objetivo = pos.renglones.find((r) => r.producto_id === "prod-agua");
    expect(objetivo).toBeDefined();

    await pos.cancelar(objetivo!.id);

    const enDisco = await comandaDesdeDisco("mesa-12");
    const cancelado = enDisco!.renglones.find((r) => r.id === objetivo!.id);
    expect(cancelado?.estado).toBe("cancelado");
    expect(totalesComanda(enDisco!)).toEqual(totalesComanda(pos.comanda!));
  });

  it("enviar a cocina persiste el estado de cada renglón", async () => {
    pos.seleccionarMesa("mesa-12");
    await pos.enviarACocina();

    const enDisco = await comandaDesdeDisco("mesa-12");
    const activos = renglonesActivos(enDisco!);
    expect(activos.length).toBeGreaterThan(0);
    expect(activos.every((r) => r.estado !== "capturado")).toBe(true);
  });

  it("seleccionar una mesa libre NO la abre sola", async () => {
    pos.seleccionarMesa("mesa-2");
    // Poner una mesa en servicio es una decisión del mesero, no un efecto de
    // tocarla: puede estar solo consultándola.
    expect(pos.estadoMesa("mesa-2")).toBe("libre");
    expect(await comandaDesdeDisco("mesa-2")).toBeNull();
  });

  it("ponerla en servicio genera una sentada nueva persistida", async () => {
    pos.seleccionarMesa("mesa-2");
    await pos.ponerEnServicio();

    const orden = pos.comanda?.orden_id;
    expect(orden).toBeDefined();

    const enDisco = await comandaDesdeDisco("mesa-2");
    expect(enDisco?.orden_id).toBe(orden);
    expect(enDisco?.mesa_id).toBe("mesa-2");
  });

  it("una mesa en servicio SIN consumo ya cuenta como ocupada", async () => {
    // Regresión: antes se seguía reportando libre mientras no hubiera
    // renglones, y ponerla en servicio parecía no hacer nada.
    pos.seleccionarMesa("mesa-6");
    await pos.ponerEnServicio();

    expect(pos.estadoMesa("mesa-6")).toBe("ocupada");
    expect(pos.renglones).toHaveLength(0);
    expect(pos.comandaAbierta).toBe(true);
    // Sin consumo no se puede cobrar todavía.
    expect(pos.hayCuenta).toBe(false);
  });

  it("al ordenar, la mesa sigue ocupada hasta que se envía a cocina", async () => {
    pos.seleccionarMesa("mesa-9");
    await pos.ponerEnServicio();
    await pos.agregarSimple("prod-cafe");

    expect(pos.estadoMesa("mesa-9")).toBe("ocupada");
    expect(pos.hayCuenta).toBe(true);

    await pos.enviarACocina();
    expect(pos.estadoMesa("mesa-9")).toBe("cuenta");
  });

  it("el log local es el outbox: todo sigue pendiente de enviar al Hub", async () => {
    const pendientes = await arranque.repositorio!.eventos.pendientes();
    const total = await arranque.repositorio!.eventos.contar();
    expect(pendientes).toHaveLength(total);
  });
});
