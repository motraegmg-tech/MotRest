/**
 * El saludo del Hub, contra un relay encendido de verdad.
 *
 * POR QUÉ ESTA PRUEBA LEVANTA UN SERVIDOR
 *
 * Porque la lección ya se pagó una vez en este proyecto: el usuario de soporte
 * tenía doce pruebas verdes en el dominio y no existía en el paquete que se
 * instalaba, porque nadie lo llamaba. Aquí pasa lo mismo — que el padrón sepa
 * identificar por credencial no demuestra nada si el saludo sigue creyéndose el
 * `sucursal_id` que venga en el mensaje. Lo único que lo demuestra es abrir un
 * WebSocket contra el relay y mentirle.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Inquilinos, llaveDelPadron } from "../inquilinos.js";

const LLAVE = randomBytes(32).toString("base64");
const CLAVE_ADMIN = "clave-de-administracion-de-motrae";

const carpeta = mkdtempSync(join(tmpdir(), "motrest-relay-"));
const ruta = join(carpeta, "restaurantes.json");

let credRodizio: string;
let credFonda: string;
let relay: { puerto: number; listo: Promise<void>; cerrar(): Promise<void> };

/** Lee el padrón desde fuera del relay: es lo que quedó escrito de verdad. */
function padronEnDisco(): Inquilinos {
  return new Inquilinos(ruta, llaveDelPadron(LLAVE));
}

/** Abre un enlace y devuelve lo que pase: o entra, o lo echan. */
function hablar(
  mensajes: unknown[],
  opciones: { origin?: string } = {},
): Promise<{ recibidos: Record<string, unknown>[]; codigo: number; razon: string; error?: string }> {
  return new Promise((listo) => {
    const recibidos: Record<string, unknown>[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${relay.puerto}/hub`, { origin: opciones.origin });
    let error: string | undefined;

    socket.on("open", () => {
      for (const m of mensajes) socket.send(JSON.stringify(m));
      // Se deja un respiro para que el relay conteste y, si toca, escriba.
      setTimeout(() => socket.close(), 250);
    });
    socket.on("message", (crudo) => recibidos.push(JSON.parse(String(crudo))));
    socket.on("error", (causa) => (error = causa.message));
    socket.on("close", (codigo, razon) =>
      listo({ recibidos, codigo, razon: razon?.toString() ?? "", error }),
    );
  });
}

function tipos(recibidos: Record<string, unknown>[]): string[] {
  return recibidos.map((m) => String(m.tipo));
}

beforeAll(async () => {
  const padron = padronEnDisco();
  credRodizio = padron.darDeAlta("suc-rodizio", "Rodizio");
  credFonda = padron.darDeAlta("suc-fonda", "La Fonda");

  process.env.MOTREST_RELAY_PADRON = ruta;
  process.env.MOTREST_RELAY_LLAVE_PADRON = LLAVE;
  process.env.MOTREST_RELAY_CLAVE_ADMIN = CLAVE_ADMIN;
  process.env.MOTREST_META_APP_SECRET = "secreto-de-la-app";
  process.env.MOTREST_META_VERIFY_TOKEN = "token-de-verificacion";

  const { arrancar } = await import("../main.js");
  relay = arrancar(0);
  await relay.listo;
});

afterAll(async () => {
  await relay?.cerrar();
  rmSync(carpeta, { recursive: true, force: true });
});

describe("quién entra", () => {
  it("con su credencial, entra", async () => {
    const { recibidos } = await hablar([{ tipo: "hola", credencial: credRodizio }]);
    expect(tipos(recibidos)).toContain("bienvenida");
  });

  it("sin credencial no entra", async () => {
    const { recibidos, codigo } = await hablar([{ tipo: "hola" }]);
    expect(tipos(recibidos)).not.toContain("bienvenida");
    expect(codigo).toBe(1008);
  });

  it("con una credencial inventada no entra", async () => {
    const { recibidos, razon } = await hablar([
      { tipo: "hola", credencial: "esta-me-la-acabo-de-inventar" },
    ]);
    expect(tipos(recibidos)).not.toContain("bienvenida");
    expect(razon).toContain("credencial no reconocida");
  });

  it("hablar antes de presentarse cierra la conexión", async () => {
    const { razon } = await hablar([{ tipo: "enviar", peticion: {} }]);
    expect(razon).toContain("antes de presentarse");
  });

  /**
   * El fallo peor que tenía el relay: `sucursalId` era reasignable, así que un
   * Hub podía saludar como un local, y a mitad de la conversación volver a
   * saludar como otro sin siquiera reconectar.
   */
  it("no se puede saludar dos veces en la misma conexión", async () => {
    const { razon } = await hablar([
      { tipo: "hola", credencial: credRodizio },
      { tipo: "hola", credencial: credFonda },
    ]);
    expect(razon).toContain("dos veces");
  });

  /**
   * Un Hub es un proceso de Node y no manda `Origin`. Quien la manda es un
   * navegador — es decir, una página de internet usando de puente al teléfono
   * de alguien que está en el wifi del restaurante.
   */
  it("un navegador no completa el apretón de manos", async () => {
    const { recibidos, error } = await hablar([{ tipo: "hola", credencial: credRodizio }], {
      origin: "https://sitio-cualquiera.example",
    });
    expect(tipos(recibidos)).not.toContain("bienvenida");
    expect(error).toContain("403");
  });
});

describe("la identidad sale de la credencial", () => {
  /**
   * ESTA es la prueba de la etapa. El Hub declara ser otro local y publica un
   * número de WhatsApp: si el relay se creyera el mensaje, el número acabaría
   * en la ficha de La Fonda. Antes se lo creía.
   */
  it("declarar ser otro restaurante no sirve de nada", async () => {
    const { recibidos } = await hablar([
      { tipo: "hola", credencial: credRodizio, sucursal_id: "suc-fonda" },
      { tipo: "credenciales", phone_number_id: "num-rodizio", token: "tok-rodizio", nombre: "Rodizio" },
    ]);
    expect(tipos(recibidos)).toContain("bienvenida");

    const padron = padronEnDisco();
    expect(padron.de("suc-rodizio")?.phone_number_id).toBe("num-rodizio");
    expect(padron.de("suc-fonda")?.phone_number_id).toBe("");
  });

  it("no se puede reclamar el número de otro restaurante", async () => {
    const { recibidos } = await hablar([
      { tipo: "hola", credencial: credFonda },
      { tipo: "credenciales", phone_number_id: "num-rodizio", token: "robado", nombre: "La Fonda" },
    ]);
    expect(tipos(recibidos)).toContain("credenciales_rechazadas");

    const padron = padronEnDisco();
    expect(padron.mapa.get("num-rodizio")?.sucursal_id).toBe("suc-rodizio");
    expect(padron.de("suc-rodizio")?.token).toBe("tok-rodizio");
  });
});

describe("un solo Hub por restaurante", () => {
  it("el segundo enlace se rechaza, y el primero sigue", async () => {
    const primero = new WebSocket(`ws://127.0.0.1:${relay.puerto}/hub`);
    await new Promise<void>((listo) => {
      primero.on("open", () => primero.send(JSON.stringify({ tipo: "hola", credencial: credRodizio })));
      primero.on("message", () => listo());
    });

    const segundo = await hablar([{ tipo: "hola", credencial: credRodizio }]);
    expect(tipos(segundo.recibidos)).not.toContain("bienvenida");
    expect(segundo.razon).toContain("ya tiene un Hub conectado");
    expect(primero.readyState).toBe(WebSocket.OPEN);

    primero.close();
  });
});

describe("la salud del relay", () => {
  async function salud(ruta: string, clave?: string): Promise<{ estado: number; cuerpo: string }> {
    const respuesta = await fetch(`http://127.0.0.1:${relay.puerto}${ruta}`, {
      headers: clave ? { authorization: `Bearer ${clave}` } : {},
    });
    return { estado: respuesta.status, cuerpo: await respuesta.text() };
  }

  /**
   * Lo que había aquí era la cartera de clientes de MOTRAE y el horario de sus
   * locales, servidos en abierto a cualquiera que diera con el dominio.
   */
  it("la pública no dice cuántos restaurantes hay", async () => {
    const { estado, cuerpo } = await salud("/salud");
    expect(estado).toBe(200);
    expect(cuerpo).not.toContain("restaurantes");
    expect(cuerpo).not.toContain("hubs_conectados");
  });

  it("el detalle sin clave no contesta", async () => {
    expect((await salud("/salud/detalle")).estado).toBe(401);
    expect((await salud("/salud/detalle", "clave-equivocada")).estado).toBe(401);
  });

  it("el detalle con la clave sí", async () => {
    const { estado, cuerpo } = await salud("/salud/detalle", CLAVE_ADMIN);
    expect(estado).toBe(200);
    expect(JSON.parse(cuerpo)).toMatchObject({ restaurantes: 2 });
  });
});
