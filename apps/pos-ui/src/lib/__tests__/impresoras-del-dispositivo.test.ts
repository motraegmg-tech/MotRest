/**
 * Impresoras conectadas al propio dispositivo (MotRest en la web, 1.6.0).
 *
 * Sin hardware: `navigator.serial` y `navigator.usb` de mentira que guardan lo
 * que se les manda. Lo que se prueba es que los bytes ESC/POS lleguen tal cual,
 * que una impresora de otro equipo no se use aquí, que el cajón no se finja por
 * el diálogo del sistema, y que el error de Windows se diga en palabras.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Impresora, TrabajoImpresion } from "@motrest/impresion";
import { TransporteDispositivo } from "../web/impresoras-del-dispositivo";

const EQUIPO = "tableta-de-la-caja";

function impresora(extra: Partial<Impresora> = {}): Impresora {
  return {
    id: "imp-1",
    nombre: "Térmica",
    conexion: "dispositivo",
    navegador: "serial",
    equipo: EQUIPO,
    reconocer: { vendor: 0x1504, producto: 0x0006, baudios: 9600 },
    ancho: 42,
    areas: ["caja"],
    corta: true,
    cajon: true,
    activa: true,
    ...extra,
  };
}

const original = globalThis.navigator;
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
});

function conNavegador(extra: Record<string, unknown>) {
  Object.defineProperty(globalThis, "navigator", { value: { ...extra }, configurable: true });
}

describe("impresoras del dispositivo", () => {
  it("solo usa la impresora conectada a ESTE equipo", () => {
    conNavegador({ serial: {} });
    const t = new TransporteDispositivo(() => EQUIPO);
    expect(t.puede(impresora())).toBe(true);
    expect(t.puede(impresora({ equipo: "otra-tableta" }))).toBe(false);
    expect(t.puede(impresora({ conexion: "red" }))).toBe(false);
  });

  it("no ofrece una vía que el navegador no tiene (Safari no tiene serie)", () => {
    conNavegador({});
    const t = new TransporteDispositivo(() => EQUIPO);
    expect(t.puede(impresora())).toBe(false);
  });

  it("por puerto serie, los bytes ESC/POS llegan tal cual y el puerto se cierra", async () => {
    const escritos: Uint8Array[] = [];
    const cerrar = vi.fn(async () => undefined);
    const puerto = {
      getInfo: () => ({ usbVendorId: 0x1504, usbProductId: 0x0006 }),
      open: vi.fn(async () => undefined),
      close: cerrar,
      writable: {
        getWriter: () => ({ write: async (d: Uint8Array) => void escritos.push(d), releaseLock: () => undefined }),
      },
    };
    conNavegador({ serial: { getPorts: async () => [puerto] } });
    const t = new TransporteDispositivo(() => EQUIPO);
    const datos = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]); // el pulso del cajón
    const r = await t.enviar(impresora(), datos);
    expect(r).toEqual({ ok: true });
    expect(escritos).toEqual([datos]);
    expect(puerto.open).toHaveBeenCalledWith({ baudRate: 9600 });
    expect(cerrar).toHaveBeenCalled();
  });

  it("si la impresora no está conectada, lo dice en vez de fingir", async () => {
    conNavegador({ serial: { getPorts: async () => [] } });
    const r = await new TransporteDispositivo(() => EQUIPO).enviar(impresora(), new Uint8Array([1]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no está conectada/);
  });

  it("por USB manda al punto de salida y avisa si Windows tiene tomada la impresora", async () => {
    const enviados: number[] = [];
    const aparato = {
      vendorId: 0x1504,
      productId: 0x0006,
      configuration: {
        interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [{ endpointNumber: 2, direction: "out", type: "bulk" }] } }],
      },
      open: async () => undefined,
      close: async () => undefined,
      selectConfiguration: async () => undefined,
      claimInterface: vi.fn(async () => undefined),
      releaseInterface: async () => undefined,
      transferOut: async (punto: number) => void enviados.push(punto),
    };
    conNavegador({ usb: { getDevices: async () => [aparato] } });
    const t = new TransporteDispositivo(() => EQUIPO);
    expect(await t.enviar(impresora({ navegador: "usb" }), new Uint8Array([1, 2]))).toEqual({ ok: true });
    expect(enviados).toEqual([2]);

    aparato.claimInterface.mockRejectedValueOnce(new Error("Access denied"));
    const r = await t.enviar(impresora({ navegador: "usb" }), new Uint8Array([1]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/driver/);
  });

  it("el diálogo del sistema no finge abrir el cajón", async () => {
    conNavegador({});
    const t = new TransporteDispositivo(() => EQUIPO);
    const cajon = { documento: "cajon", vista: "" } as TrabajoImpresion;
    const r = await t.enviar(impresora({ navegador: "sistema" }), new Uint8Array([0x1b, 0x70]), cajon);
    expect(r).toEqual({ ok: true, simulado: true });
  });
});
