import { describe, expect, it } from "vitest";
import {
  aBase64Url,
  cifrar,
  claveValida,
  deBase64Url,
  derivarClaves,
  descifrar,
  esSobreCifrado,
  generarClaveLocal,
} from "../cifrado.js";

const mensaje = {
  tipo: "push" as const,
  eventos: [{ id: "ev-1", monto: 59856, empleado_id: "usr-lucia" }],
};

/** Los dos extremos del canal, derivados de la misma clave del local. */
async function canal(clave = generarClaveLocal()) {
  return {
    clave,
    cliente: await derivarClaves(clave, "cliente"),
    hub: await derivarClaves(clave, "hub"),
  };
}

describe("clave del local", () => {
  it("cada local tiene la suya", () => {
    expect(generarClaveLocal()).not.toBe(generarClaveLocal());
  });

  it("viaja limpia en una URL y en un QR", () => {
    const clave = generarClaveLocal();
    expect(clave).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(clave)).toBe(clave);
  });

  it("reconoce una clave con forma válida", () => {
    expect(claveValida(generarClaveLocal())).toBe(true);
  });

  it("rechaza lo que no lo es", () => {
    expect(claveValida("")).toBe(false);
    expect(claveValida("clave-corta")).toBe(false);
    expect(claveValida("no+es/base64url" + "x".repeat(30))).toBe(false);
    // La longitud importa: media clave no es una clave.
    expect(claveValida(generarClaveLocal().slice(0, 20))).toBe(false);
  });

  it("la codificación va y viene sin perder un byte", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect([...deBase64Url(aBase64Url(bytes))]).toEqual([...bytes]);
  });
});

describe("cifrado del canal", () => {
  it("lo que sale de un extremo llega entero al otro", async () => {
    const c = await canal();
    const sobre = await cifrar(c.cliente.envio, mensaje);
    expect(await descifrar(c.hub.recepcion, sobre)).toEqual(mensaje);
  });

  it("también en el sentido contrario", async () => {
    const c = await canal();
    const respuesta = { tipo: "acks" as const, acks: [{ id: "ev-1", seq: 7 }] };
    const sobre = await cifrar(c.hub.envio, respuesta);
    expect(await descifrar(c.cliente.recepcion, sobre)).toEqual(respuesta);
  });

  it("lo que viaja NO contiene los datos en claro", async () => {
    const c = await canal();
    const sobre = await cifrar(c.cliente.envio, mensaje);

    // Ni el importe, ni el empleado, ni el tipo de mensaje.
    expect(sobre).not.toContain("59856");
    expect(sobre).not.toContain("usr-lucia");
    expect(sobre).not.toContain("push");
  });

  it("dos envíos del MISMO mensaje se ven distintos", async () => {
    const c = await canal();
    const uno = await cifrar(c.cliente.envio, mensaje);
    const dos = await cifrar(c.cliente.envio, mensaje);

    // Si se vieran iguales, quien observa el canal sabría que se repitió algo
    // —por ejemplo, el mismo platillo pedido dos veces— sin descifrar nada.
    expect(uno).not.toBe(dos);
  });

  it("una clave distinta no puede leer nada", async () => {
    const local = await canal();
    const otro = await canal();
    const sobre = await cifrar(local.cliente.envio, mensaje);
    expect(await descifrar(otro.hub.recepcion, sobre)).toBeNull();
  });

  it("un mensaje alterado a medio camino se detecta", async () => {
    const c = await canal();
    const sobre = JSON.parse(await cifrar(c.cliente.envio, mensaje));
    // Se cambia un carácter del texto cifrado.
    sobre.c = sobre.c.slice(0, -2) + (sobre.c.at(-2) === "A" ? "B" : "A") + sobre.c.at(-1);
    expect(await descifrar(c.hub.recepcion, JSON.stringify(sobre))).toBeNull();
  });

  it("un mensaje del cliente NO se puede reenviar como si viniera del Hub", async () => {
    const c = await canal();
    const sobre = await cifrar(c.cliente.envio, mensaje);

    // Cada sentido tiene su clave: sin eso, alguien podría capturar un mensaje
    // de la caja y devolverlo haciéndose pasar por el Hub.
    expect(await descifrar(c.cliente.recepcion, sobre)).toBeNull();
  });

  it("basura por el canal devuelve nada, en vez de reventar", async () => {
    const c = await canal();
    for (const crudo of ["", "{}", "no es json", '{"ec":1}', '{"ec":2,"n":"a","c":"b"}']) {
      expect(await descifrar(c.hub.recepcion, crudo)).toBeNull();
    }
  });

  it("un mensaje en claro de un cliente viejo se distingue a simple vista", async () => {
    const claro = JSON.stringify({ tipo: "hola", v: 1 });
    expect(esSobreCifrado(JSON.parse(claro))).toBe(false);

    const c = await canal();
    const cifrado = await cifrar(c.cliente.envio, mensaje);
    expect(esSobreCifrado(JSON.parse(cifrado))).toBe(true);
  });

  it("la misma clave del local da siempre las mismas claves derivadas", async () => {
    const clave = generarClaveLocal();
    const primera = await canal(clave);
    const segunda = await canal(clave);

    // Es lo que permite que una terminal reconecte y siga entendiéndose.
    const sobre = await cifrar(primera.cliente.envio, mensaje);
    expect(await descifrar(segunda.hub.recepcion, sobre)).toEqual(mensaje);
  });

  it("una clave con forma inválida no deriva nada", async () => {
    await expect(derivarClaves("no-es-una-clave", "cliente")).rejects.toThrow();
  });
});
