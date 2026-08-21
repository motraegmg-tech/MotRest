/**
 * El interruptor del QR de reseña del ticket.
 *
 * Se prueba sobre `enlaceDeCuenta` y no sobre el papel a propósito: ahí es donde
 * está la decisión. Si el enlace no existe, no hay nada que la plantilla pueda
 * imprimir, y así una impresora nueva o un ticket nuevo heredan la regla sin
 * tener que acordarse de consultarla.
 *
 * La clave del local se sustituye en vez de emparejar la terminal de verdad:
 * emparejar abre un WebSocket contra un Hub que aquí no existe, y lo que se
 * quiere comprobar no es el enlace de sincronización sino el interruptor.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generarClaveLocal } from "@motrest/protocolo-sync";
import { local } from "../local.svelte";
import { portal } from "../portal.svelte";
import { sync } from "../sync.svelte";

const ORDEN = "orden-de-prueba";

beforeAll(() => {
  const proto = Object.getPrototypeOf(sync) as { claveLocal: string };
  vi.spyOn(proto, "claveLocal", "get").mockReturnValue(generarClaveLocal());
  sync.url = "wss://192.168.1.50:8787/sync";
});

describe("el QR de reseña del ticket", () => {
  it("viene apagado de fábrica", () => {
    expect(local.qrResena).toBe(false);
  });

  it("apagado, no hay enlace que imprimir aunque la terminal esté emparejada", async () => {
    local.fijarQrResena(false);
    expect(await portal.enlaceDeCuenta(ORDEN)).toBeNull();
  });

  it("encendido, firma el enlace de esa cuenta contra el Hub del local", async () => {
    local.fijarQrResena(true);

    const enlace = await portal.enlaceDeCuenta(ORDEN);
    // El `wss:` del canal de sincronización sale como `https:` para el teléfono.
    expect(enlace).toContain("https://192.168.1.50:8787/portal/#/c/");
    // El código lleva la orden y su firma: `orden~firma`.
    expect(enlace).toContain(`/c/${ORDEN}~`);
  });

  it("cada cuenta lleva su propia firma", async () => {
    local.fijarQrResena(true);

    const uno = await portal.enlaceDeCuenta("mesa-7");
    const otro = await portal.enlaceDeCuenta("mesa-8");
    expect(uno).not.toEqual(otro);
  });

  it("se puede volver a apagar", async () => {
    local.fijarQrResena(true);
    expect(await portal.enlaceDeCuenta(ORDEN)).not.toBeNull();

    local.fijarQrResena(false);
    expect(await portal.enlaceDeCuenta(ORDEN)).toBeNull();
    expect(local.qrResena).toBe(false);
  });
});
