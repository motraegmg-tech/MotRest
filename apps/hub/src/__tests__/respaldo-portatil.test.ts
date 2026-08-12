/**
 * La mudanza de un restaurante a otra computadora, de punta a punta.
 *
 * Se ejercita contra un log SQLite real: exportar de un local con operación,
 * abrir el archivo en otro vacío y comprobar que llega TODO. Es la prueba que
 * más importa de este archivo, porque una función de respaldo que nadie ensayó
 * restaurando falla el día que hace falta, que es el peor día posible.
 */
import { describe, expect, it } from "vitest";
import { FabricaEventos, type EventoComanda } from "@motrest/dominio";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { exportarRespaldo, leerRespaldo, VERSION_RESPALDO } from "../respaldo-portatil.js";

const SUC = "suc-prueba";
const CLAVE = "clave-de-respaldo-de-32-caracteres!!";

function ventas(cuantas: number): EventoComanda[] {
  const fabrica = new FabricaEventos<EventoComanda>({
    device_id: "dev-caja",
    empleado_id: "usr-gonzalo",
    sucursal_id: SUC,
  });
  return Array.from({ length: cuantas }, (_, i) =>
    fabrica.crear("orden_creada", `ord-${i}`, {
      orden_id: `ord-${i}`,
      mesa_id: `mesa-${i}`,
      abierta_ts: Date.now(),
    }),
  );
}

describe("llevarse el restaurante a otra computadora", () => {
  it("lo exportado se vuelve a abrir completo", async () => {
    const viejo = new LogHub(":memory:");
    const lote = ventas(12);
    viejo.ingerir(lote);

    const archivo = await exportarRespaldo(
      viejo,
      SUC,
      "Restaurante de prueba",
      { catalogos: [{ clave: "menu_local", version: 3 }] },
      CLAVE,
    );

    const r = await leerRespaldo(archivo, CLAVE, SUC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.contenido.version).toBe(VERSION_RESPALDO);
    expect(r.contenido.nombre).toBe("Restaurante de prueba");
    expect(r.contenido.eventos).toHaveLength(12);
    expect(r.contenido.eventos.map((e) => e.id).sort()).toEqual(lote.map((e) => e.id).sort());
    expect(r.contenido.estado.catalogos).toEqual([{ clave: "menu_local", version: 3 }]);
    viejo.cerrar();
  });

  it("restaurar en un equipo vacío deja el mismo registro", async () => {
    const viejo = new LogHub(":memory:");
    viejo.ingerir(ventas(30));
    const archivo = await exportarRespaldo(viejo, SUC, "Local", {}, CLAVE);

    // La máquina nueva: un log en blanco, como recién instalada.
    const nuevo = new LogHub(":memory:");
    expect(nuevo.seqActual).toBe(0);

    const r = await leerRespaldo(archivo, CLAVE, SUC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    nuevo.ingerir(r.contenido.eventos);

    expect(nuevo.seqActual).toBe(viejo.seqActual);
    expect(await nuevo.contar()).toBe(await viejo.contar());
    viejo.cerrar();
    nuevo.cerrar();
  });

  /*
   * Va cifrado de verdad: el archivo no puede llevar las ventas legibles. Se
   * comprueba con el identificador de una mesa, que sale en cada evento.
   */
  it("el archivo no deja leer nada sin la clave", async () => {
    const log = new LogHub(":memory:");
    log.ingerir(ventas(3));
    const archivo = await exportarRespaldo(log, SUC, "Local", {}, CLAVE);

    expect(archivo).not.toContain("mesa-1");
    expect(archivo).not.toContain("orden_creada");
    expect(await leerRespaldo(archivo, "otra-clave-distinta-de-32-caracteres", SUC)).toMatchObject({
      ok: false,
    });
    log.cerrar();
  });

  /*
   * Sin esta comprobación, el respaldo de un restaurante se podría volcar en la
   * caja de otro: a partir de ahí los dos emiten eventos con el mismo
   * identificador y los dos registros quedan mezclados sin forma de separarlos.
   */
  it("un respaldo de otro local se rechaza aunque la clave sea buena", async () => {
    const log = new LogHub(":memory:");
    log.ingerir(ventas(2));
    const archivo = await exportarRespaldo(log, SUC, "Local", {}, CLAVE);

    const r = await leerRespaldo(archivo, CLAVE, "suc-de-otro-restaurante");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("otro local");
    log.cerrar();
  });

  it("un archivo que no es un respaldo se rechaza sin reventar", async () => {
    expect(await leerRespaldo("esto no es json", CLAVE, SUC)).toMatchObject({ ok: false });
    expect(await leerRespaldo('{"hola":1}', CLAVE, SUC)).toMatchObject({ ok: false });
  });
});
