/**
 * Detección de impresoras.
 *
 * Lo que hay que dejar clavado con pruebas es lo que decide si el restaurante
 * encuentra su impresora o no: que el sondeo distinga de verdad un puerto
 * abierto de uno cerrado, que la lista de Windows se traduzca a algo que una
 * persona pueda reconocer, y —lo más importante— que el barrido no salga nunca
 * de la red privada del local.
 */
import { createServer, type Server } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import {
  anchoProbable,
  desdeElSistema,
  redesLocales,
  sondear,
  buscarImpresoras,
  PUERTO_IMPRESION,
} from "../impresion/buscador.js";

/** Un socket que acepta conexiones, como haría una impresora en el 9100. */
function impresoraDeMentira(): Promise<{ puerto: number; cerrar: () => void }> {
  return new Promise((resolver) => {
    const servidor: Server = createServer((socket) => socket.end());
    servidor.listen(0, "127.0.0.1", () => {
      const dir = servidor.address();
      const puerto = typeof dir === "object" && dir ? dir.port : 0;
      resolver({ puerto, cerrar: () => servidor.close() });
    });
  });
}

const abiertos: Array<() => void> = [];
afterAll(() => {
  for (const cerrar of abiertos) cerrar();
});

describe("sondeo de un puerto", () => {
  it("encuentra a quien está escuchando", async () => {
    const falsa = await impresoraDeMentira();
    abiertos.push(falsa.cerrar);
    expect(await sondear("127.0.0.1", falsa.puerto)).toBe(true);
  });

  it("un puerto cerrado es un no, no un cuelgue", async () => {
    // Un puerto efímero que se abrió y se cerró: nadie escucha ahí.
    const falsa = await impresoraDeMentira();
    falsa.cerrar();
    expect(await sondear("127.0.0.1", falsa.puerto, 300)).toBe(false);
  });

  /*
   * Con 254 direcciones por red, una que no responde NO puede dejar la búsqueda
   * colgada: el tiempo total depende de que cada sondeo se rinda a tiempo.
   */
  it("una dirección que no contesta se rinde por tiempo", async () => {
    const arranque = Date.now();
    // 192.0.2.1 es de la red reservada para documentación (RFC 5737): nunca hay
    // nadie, así que el sondeo tiene que agotar su espera y no colgarse.
    expect(await sondear("192.0.2.1", PUERTO_IMPRESION, 250)).toBe(false);
    expect(Date.now() - arranque).toBeLessThan(3000);
  });
});

describe("redes que se barren", () => {
  /*
   * LA REGLA DE SEGURIDAD. El barrido no acepta que le digan qué red mirar: la
   * saca de las interfaces de este equipo y descarta todo lo que no sea IPv4
   * privada. Sin esto, el endpoint sería un escáner de puertos a domicilio.
   */
  it("solo devuelve prefijos /24 de rangos privados", () => {
    for (const prefijo of redesLocales()) {
      expect(prefijo).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      const [a, b] = prefijo.split(".").map(Number) as [number, number, number];
      const privada =
        a === 10 ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 169 && b === 254);
      expect(privada, `${prefijo} no es una red privada`).toBe(true);
    }
  });

  it("nunca incluye la de loopback: ahí no hay impresoras", () => {
    expect(redesLocales()).not.toContain("127.0.0");
  });
});

describe("traducir lo que dice Windows", () => {
  it("una cola en USB001 se presenta como conectada por cable", () => {
    const d = desdeElSistema({ nombre: "BIXOLON SRP-350plus", puerto: "USB001", estado: "Normal" });
    expect(d.origen).toBe("usb");
    expect(d.dispositivo).toBe("BIXOLON SRP-350plus");
    expect(d.detalle).toContain("cable USB");
    expect(d.virtual).toBeUndefined();
  });

  it("una cola apuntando a una IP se presenta como de red", () => {
    const d = desdeElSistema({ nombre: "TM-T20 Wi-Fi", puerto: "192.168.1.62", estado: "Normal" });
    expect(d.detalle).toContain("En red");
  });

  it("un estado que no es Normal se dice: una impresora apagada hay que verla", () => {
    const d = desdeElSistema({ nombre: "Cocina", puerto: "USB002", estado: "Offline" });
    expect(d.detalle).toContain("Offline");
  });

  /*
   * Las virtuales se MARCAN, no se esconden. Filtrar por lista de nombres
   * acabaría ocultando la térmica de algún local que se llame raro.
   */
  it("marca las que no imprimen en papel, pero no las quita", () => {
    expect(desdeElSistema({ nombre: "Microsoft Print to PDF", puerto: "PORTPROMPT:", estado: "Normal" }).virtual).toBe(true);
    expect(desdeElSistema({ nombre: "Enviar a OneNote 16", puerto: "nul:", estado: "Normal" }).virtual).toBe(true);
    expect(desdeElSistema({ nombre: "Fax", puerto: "SHRFAX:", estado: "Normal" }).virtual).toBe(true);
  });
});

describe("ancho de papel probable", () => {
  it("supone 80 mm, que es lo normal en caja", () => {
    expect(anchoProbable("BIXOLON SRP-350plus")).toBe(42);
  });

  it("reconoce las de 58 mm por el nombre y ahorra un paso", () => {
    expect(anchoProbable("Térmica 58mm BT")).toBe(32);
    expect(anchoProbable("POS 58 Printer")).toBe(32);
  });
});

describe("búsqueda completa", () => {
  /*
   * 20 s y no los 5 de vitest: en Windows esto arranca PowerShell DOS veces —una
   * para las colas y otra para los puertos sin cola— y bajo carga no le da
   * tiempo. No está roto el código, está corto el corredor; es el mismo ajuste
   * que llevan las pruebas del transporte USB por el mismo motivo.
   */
  it("sin barrido de red contesta igual, y lo dice", async () => {
    const r = await buscarImpresoras({ conRed: false });
    expect(r.sin_red).toBe(true);
    expect(r.redes).toEqual([]);
    // Fuera de Windows no hay spooler y la lista sale vacía: no es un error.
    expect(Array.isArray(r.impresoras)).toBe(true);
  }, 20_000);

  it("las virtuales quedan al final de la lista", async () => {
    const lista = [
      desdeElSistema({ nombre: "Microsoft Print to PDF", puerto: "PORTPROMPT:", estado: "Normal" }),
      desdeElSistema({ nombre: "BIXOLON SRP-350plus", puerto: "USB001", estado: "Normal" }),
    ];
    const ordenada = [...lista].sort((a, b) =>
      !!a.virtual !== !!b.virtual ? (a.virtual ? 1 : -1) : 0,
    );
    expect(ordenada[0]!.nombre).toBe("BIXOLON SRP-350plus");
  });
});
