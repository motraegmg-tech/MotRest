/**
 * El transporte de red manda los bytes exactos a un socket, y se protege de
 * destinos que no son impresoras de la LAN.
 */
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { enviarARed, enviarBytes, esDestinoPermitido } from "../impresion/transporte-red.js";

describe("lista blanca de destinos", () => {
  it("acepta IPs privadas en puertos de impresión", () => {
    expect(esDestinoPermitido("192.168.1.60", 9100)).toBe(true);
    expect(esDestinoPermitido("10.0.0.5", 9100)).toBe(true);
    expect(esDestinoPermitido("172.16.3.9", 9100)).toBe(true);
    expect(esDestinoPermitido("127.0.0.1", 9100)).toBe(true);
  });

  it("rechaza IPs públicas: una impresora no vive en internet", () => {
    expect(esDestinoPermitido("8.8.8.8", 9100)).toBe(false);
    expect(esDestinoPermitido("172.32.0.1", 9100)).toBe(false); // fuera de 172.16/12
  });

  it("rechaza puertos que no son de impresión: no es un cliente TCP de propósito general", () => {
    expect(esDestinoPermitido("192.168.1.60", 22)).toBe(false);
    expect(esDestinoPermitido("192.168.1.60", 8787)).toBe(false); // ni el propio Hub
  });

  it("rechaza nombres de host: solo IPs, para no depender de resolución", () => {
    expect(esDestinoPermitido("impresora.local", 9100)).toBe(false);
  });
});

describe("envío por socket", () => {
  let servidor: Server | undefined;

  afterEach(() => {
    servidor?.close();
    servidor = undefined;
  });

  function levantarImpresoraFalsa(recibido: Buffer[]): Promise<number> {
    return new Promise((resolver) => {
      servidor = createServer((socket) => {
        socket.on("data", (trozo) => recibido.push(trozo));
      });
      servidor.listen(0, "127.0.0.1", () => {
        const dir = servidor!.address();
        resolver(typeof dir === "object" && dir ? dir.port : 0);
      });
    });
  }

  it("entrega los bytes exactos a la impresora", async () => {
    const recibido: Buffer[] = [];
    const puerto = await levantarImpresoraFalsa(recibido);
    const datos = new Uint8Array([0x1b, 0x40, 0x48, 0x6f, 0x6c, 0x61, 0x0a]); // ESC @ "Hola\n"

    // `enviarBytes` prueba la ruta de envío contra el puerto efímero del
    // servidor de prueba; la lista blanca se prueba aparte, arriba.
    const r = await enviarBytes("127.0.0.1", puerto, datos);
    expect(r.ok).toBe(true);
    expect(Buffer.concat(recibido)).toEqual(Buffer.from(datos));
  });

  it("falla limpio cuando nadie responde", async () => {
    // Puerto de impresión permitido, pero sin nadie escuchando: debe cortar.
    const r = await enviarARed("127.0.0.1", 9101, new Uint8Array([0x00]), 400);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
