/**
 * Que una petición rara NO apague el restaurante.
 *
 * ESTE ARCHIVO EXISTE POR UN INTERRUPTOR DE APAGADO REMOTO. El manejador de
 * peticiones del Hub es SÍNCRONO, así que una excepción dentro de él no la
 * captura Node: sube a `uncaughtException` y mata el proceso. Y el proceso es
 * el registro de ventas del local — con él caen la caja, las tablets y la
 * cocina, sin autenticación y sin la clave del local.
 *
 * Tres vectores, todos de una sola petición:
 *   GET /%          → URIError en decodeURIComponent
 *   GET /portal/%   → lo mismo, desde el teléfono de un comensal
 *   Host: [         → TypeError al construir la URL
 *
 * Aquí se prueban las piezas que lo cierran. La comprobación de que el proceso
 * entero sobrevive se hace en el ensayo, contra el binario instalado.
 */
import { describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

/**
 * Réplica exacta del patrón que protege `atender()` en `main.ts`.
 *
 * Se reproduce aquí en vez de importar el módulo porque `main.ts` arranca el
 * Hub entero al importarse —abre la base, escucha puertos, lanza respaldos— y
 * lo que se quiere probar es la forma de la defensa, no el arranque.
 */
function decodificar(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return null;
  }
}

function servidorConRed(interno: (p: IncomingMessage, r: ServerResponse) => void) {
  return createServer((peticion, respuesta) => {
    try {
      interno(peticion, respuesta);
    } catch {
      if (!respuesta.headersSent) respuesta.writeHead(400, { "content-type": "application/json" });
      respuesta.end('{"error":"Petición inválida"}');
    }
  });
}

/** Levanta un servidor, hace una petición cruda y devuelve el estado. */
async function pedir(
  interno: (p: IncomingMessage, r: ServerResponse) => void,
  ruta: string,
  host?: string,
): Promise<{ estado: number; vivo: boolean }> {
  const servidor = servidorConRed(interno);
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const { port } = servidor.address() as AddressInfo;

  try {
    const respuesta = await fetch(`http://127.0.0.1:${port}${ruta}`, {
      ...(host ? { headers: { host } } : {}),
    });
    // Que el servidor siga escuchando es la mitad del asunto: un Hub que
    // responde 400 pero muere después no sirve de nada.
    return { estado: respuesta.status, vivo: servidor.listening };
  } finally {
    servidor.close();
  }
}

// --- La decodificación defensiva ---------------------------------------------------------------

describe("decodificar una ruta que no se puede decodificar", () => {
  /*
   * EL VECTOR. `decodeURIComponent("%")` lanza. Tres caracteres desde la wifi
   * del local, o desde el teléfono de un comensal contra el portal.
   */
  it("un porcentaje suelto devuelve null en vez de lanzar", () => {
    expect(decodificar("/%")).toBeNull();
    expect(decodificar("/%zz")).toBeNull();
    expect(decodificar("/portal/%")).toBeNull();
  });

  it("una ruta normal se decodifica como siempre", () => {
    expect(decodificar("/assets/index.js")).toBe("/assets/index.js");
    expect(decodificar("/carta%20del%20d%C3%ADa.png")).toBe("/carta del día.png");
  });

  /*
   * Lo que NO cambia: `%2e%2e%2f` sigue decodificándose a `../`. La defensa
   * contra travesía no es esta función —es el `normalize` + la comprobación de
   * contención que va después—. Se prueba aquí para dejar claro el reparto.
   */
  it("sigue decodificando lo que parece una travesía, para que la ataje quien debe", () => {
    expect(decodificar("/%2e%2e%2fetc")).toBe("/../etc");
  });
});

// --- La red de seguridad del manejador -----------------------------------------------------------

describe("una excepción en el camino de la petición", () => {
  /*
   * EL CANDADO. Antes, cualquier throw aquí mataba el proceso. Ahora se
   * responde 400 y el servidor sigue escuchando.
   */
  it("devuelve 400 y el servidor sobrevive", async () => {
    const { estado, vivo } = await pedir(() => {
      throw new URIError("URI malformed");
    }, "/%");

    expect(estado).toBe(400);
    expect(vivo).toBe(true);
  });

  it("aguanta varias seguidas sin degradarse", async () => {
    for (let i = 0; i < 5; i++) {
      const { estado, vivo } = await pedir(() => {
        throw new TypeError("Invalid URL");
      }, "/%");
      expect(estado).toBe(400);
      expect(vivo).toBe(true);
    }
  });

  /*
   * El detalle del error NUNCA sale en la respuesta: describiría por dentro el
   * sistema a quien está probando. Va a la bitácora, que es donde sirve.
   */
  it("no filtra el detalle del error al que la provocó", async () => {
    const servidor = servidorConRed(() => {
      throw new Error("ENOENT: /ruta/secreta/del/hub/hub.sqlite");
    });
    servidor.listen(0, "127.0.0.1");
    await once(servidor, "listening");
    const { port } = servidor.address() as AddressInfo;

    try {
      const cuerpo = await (await fetch(`http://127.0.0.1:${port}/%`)).text();
      expect(cuerpo).not.toContain("hub.sqlite");
      expect(cuerpo).not.toContain("ruta/secreta");
      expect(cuerpo).toContain("Petición inválida");
    } finally {
      servidor.close();
    }
  });

  /* Y una petición normal sigue pasando: la red no estorba a lo que funciona. */
  it("lo que no falla, responde como siempre", async () => {
    const { estado } = await pedir((_p, respuesta) => {
      respuesta.writeHead(200);
      respuesta.end("ok");
    }, "/salud");

    expect(estado).toBe(200);
  });
});

// --- El Host --------------------------------------------------------------------------------------

describe("el Host que manda el cliente", () => {
  /*
   * `new URL(ruta, \`https://${host}\`)` con un host inválido lanza TypeError.
   * Era el tercer vector. La solución es no usar el Host del cliente para
   * construir la URL: solo hace falta la ruta.
   */
  it("un Host inválido ya no se usa para construir la URL", () => {
    // Como se hacía antes: revienta.
    expect(() => new URL("/salud", "https://[")).toThrow();
    // Como se hace ahora: base fija, la ruta es lo único que se lee.
    expect(new URL("/salud", "https://motrest.local").pathname).toBe("/salud");
  });
});
