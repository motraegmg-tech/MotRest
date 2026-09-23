/**
 * «Buscar actualizaciones» de la barra lateral (pedido de Gonzalo, sep-2026).
 *
 * Lo que importa: que diga la verdad —«al día» solo cuando el Hub pudo
 * preguntar— y que, si hay versión, se abra el diálogo de siempre aunque la
 * hubieran pospuesto.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { aplazar, registrarDisponible, estadoInicial, type VersionDisponible } from "@motrest/dominio";
import { actualizaciones } from "../actualizaciones.svelte";

const VERSION: VersionDisponible = {
  version: "1.5.8",
  notas: "Mejoras.",
  url: "https://github.com/motraegmg-tech/MotRest/releases/download/1.5.8/MotRest_1.5.8_x64-setup.exe",
  sha256: "a".repeat(64),
  publicado_ts: Date.now() - 60_000,
  firma: "x",
};

function contesta(cuerpo: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(cuerpo), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  actualizaciones.fusionar(estadoInicial());
});

describe("buscar actualizaciones", () => {
  it("al día lo dice con la versión instalada", async () => {
    contesta({ estado: "al_dia", version: "1.5.7" });
    expect(await actualizaciones.buscar()).toEqual({ hay: false, texto: "MotRest está al día (versión 1.5.7)." });
  });

  it("sin nube no dice «al día»: dice que no pudo revisar", async () => {
    contesta({ estado: "sin_conexion", version: "1.5.7" });
    const r = await actualizaciones.buscar();
    expect(r.hay).toBe(false);
    expect(r.texto).toMatch(/no se pudo revisar/);
  });

  it("si hay versión abre el diálogo, aunque la hubieran pospuesto", async () => {
    const pospuesta = aplazar(registrarDisponible(estadoInicial(), VERSION, Date.now()), { cuando: "mas_tarde" }, Date.now());
    actualizaciones.fusionar(pospuesta);
    expect(actualizaciones.avisar).toBe(false);

    contesta({ estado: "hay", version: "1.5.7", actualizacion: pospuesta });
    const r = await actualizaciones.buscar();
    expect(r).toEqual({ hay: true, texto: "Hay una versión nueva: MotRest 1.5.8." });
    expect(actualizaciones.avisar).toBe(true);
  });

  it("un Hub que no contesta no se confunde con «al día»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    expect((await actualizaciones.buscar()).texto).toMatch(/No se pudo hablar con el Hub/);
    contesta({ error: "x" }, 500);
    expect((await actualizaciones.buscar()).texto).toMatch(/no pudo buscar \(500\)/);
  });
});
