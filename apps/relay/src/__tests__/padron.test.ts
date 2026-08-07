/**
 * El padrón del relay.
 *
 * Aquí viven los tokens de la API de Meta de todos los restaurantes de MOTRAE.
 * Es el archivo más valioso de la empresa y el único que está en internet, así
 * que lo que se prueba no es que "funcione": es que un restaurante no pueda
 * tocar la ficha de otro, que el archivo no se lea en claro, y que un corte de
 * luz a media escritura no deje a todos sin WhatsApp.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inquilinos, llaveDelPadron } from "../inquilinos.js";

const LLAVE = randomBytes(32).toString("base64");

let carpeta: string;
let ruta: string;

function padron(): Inquilinos {
  return new Inquilinos(ruta, llaveDelPadron(LLAVE));
}

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "motrest-padron-"));
  ruta = join(carpeta, "restaurantes.json");
});

afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

describe("la llave", () => {
  it("exige 32 bytes exactos", () => {
    expect(() => llaveDelPadron(undefined)).toThrow(/32 bytes/);
    expect(() => llaveDelPadron("corta")).toThrow(/32 bytes/);
    expect(() => llaveDelPadron(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(llaveDelPadron(LLAVE)).toHaveLength(32);
  });
});

describe("el alta", () => {
  it("da una credencial distinta a cada restaurante", () => {
    const p = padron();
    const a = p.darDeAlta("suc-a", "Rodizio");
    const b = p.darDeAlta("suc-b", "La Fonda");
    expect(a).not.toBe(b);
    // 32 bytes en base64url: suficientemente larga como para no probarla a mano.
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("no deja dar de alta dos veces la misma sucursal", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    expect(() => p.darDeAlta("suc-a", "Otro")).toThrow(/ya está en el padrón/);
  });

  /**
   * La credencial NO se guarda: es el motivo de que se enseñe una sola vez.
   * Si algún día alguien la persiste "para poder consultarla", esta prueba cae.
   */
  it("no deja la credencial en el archivo", () => {
    const credencial = padron().darDeAlta("suc-a", "Rodizio");
    expect(readFileSync(ruta, "utf8")).not.toContain(credencial);
  });

  it("identifica al restaurante por su credencial, y solo por ella", () => {
    const p = padron();
    const a = p.darDeAlta("suc-a", "Rodizio");
    const b = p.darDeAlta("suc-b", "La Fonda");

    expect(p.porCredencial(a)?.sucursal_id).toBe("suc-a");
    expect(p.porCredencial(b)?.sucursal_id).toBe("suc-b");
    expect(p.porCredencial("no-es-de-nadie")).toBeUndefined();
    expect(p.porCredencial("")).toBeUndefined();
  });

  it("sobrevive al reinicio del relay", () => {
    const credencial = padron().darDeAlta("suc-a", "Rodizio");
    expect(padron().porCredencial(credencial)?.sucursal_id).toBe("suc-a");
  });
});

describe("la baja y la rotación", () => {
  it("la baja olvida la credencial de inmediato", () => {
    const p = padron();
    const credencial = p.darDeAlta("suc-a", "Rodizio");
    expect(p.darDeBaja("suc-a")).toBe(true);
    expect(p.porCredencial(credencial)).toBeUndefined();
    expect(padron().porCredencial(credencial)).toBeUndefined();
  });

  it("la baja de quien no está no revienta", () => {
    expect(padron().darDeBaja("suc-fantasma")).toBe(false);
  });

  it("rotar invalida la credencial vieja", () => {
    const p = padron();
    const vieja = p.darDeAlta("suc-a", "Rodizio");
    const nueva = p.rotarCredencial("suc-a");

    expect(p.porCredencial(vieja)).toBeUndefined();
    expect(p.porCredencial(nueva)?.sucursal_id).toBe("suc-a");
  });

  /**
   * Rotar es lo que se hace cuando la credencial vieja ya no es de fiar. Dejar
   * conectado a quien entró con ella sería rotarla a medias.
   */
  it("rotar corta el enlace que estuviera vivo", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    let cortado = false;
    p.conectar({ sucursal_id: "suc-a", enviar: () => {}, cerrar: () => (cortado = true) });

    p.rotarCredencial("suc-a");

    expect(cortado).toBe(true);
    expect(p.enlaceDe("suc-a")).toBeUndefined();
  });
});

describe("el número de WhatsApp", () => {
  it("un restaurante no puede reclamar el número de otro", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    p.darDeAlta("suc-b", "La Fonda");

    expect(p.publicarWhatsApp("suc-a", { phone_number_id: "111", token: "t-a" })).toBe("actualizado");
    // Aquí estaba el robo: el índice por número se reasignaba en silencio y los
    // mensajes entrantes de Rodizio pasaban a llegarle a La Fonda.
    expect(p.publicarWhatsApp("suc-b", { phone_number_id: "111", token: "t-b" })).toBe("ajeno");

    expect(p.mapa.get("111")?.sucursal_id).toBe("suc-a");
    expect(p.de("suc-a")?.token).toBe("t-a");
  });

  it("no escribe el padrón si no cambió nada", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    p.publicarWhatsApp("suc-a", { phone_number_id: "111", token: "t-a", nombre: "Rodizio" });

    const antes = statSync(ruta).mtimeMs;
    // El Hub reenvía sus credenciales en CADA reconexión: sin esta comprobación,
    // un Hub en bucle escribía el padrón completo una vez por intento.
    expect(p.publicarWhatsApp("suc-a", { phone_number_id: "111", token: "t-a", nombre: "Rodizio" })).toBe(
      "sin-cambios",
    );
    expect(statSync(ruta).mtimeMs).toBe(antes);
  });

  it("un restaurante que no está de alta no publica nada", () => {
    expect(padron().publicarWhatsApp("suc-fantasma", { phone_number_id: "111", token: "t" })).toBe("ajeno");
  });

  /**
   * Un inquilino sin número no se indexa para enrutar. Si se indexara con la
   * cadena vacía, un webhook al que le faltara el `phone_number_id` acabaría
   * entregado en un restaurante al azar.
   */
  it("un restaurante sin número no aparece en el enrutador", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    expect(p.mapa.get("")).toBeUndefined();
    expect(p.mapa.size).toBe(0);
    expect(p.total).toBe(1);
  });
});

describe("el archivo", () => {
  it("no guarda los tokens de Meta en claro", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    p.publicarWhatsApp("suc-a", { phone_number_id: "111", token: "EAAG-token-secreto-de-meta" });

    const crudo = readFileSync(ruta, "utf8");
    expect(crudo).not.toContain("EAAG-token-secreto-de-meta");
    expect(crudo).not.toContain("suc-a");
    expect(JSON.parse(crudo)).toMatchObject({ v: 1 });
  });

  it("con otra llave no se lee, y no se lleva por delante al relay", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");

    const avisos: string[] = [];
    const otro = new Inquilinos(ruta, llaveDelPadron(randomBytes(32).toString("base64")), (t) =>
      avisos.push(t),
    );

    expect(otro.total).toBe(0);
    expect(avisos.join(" ")).toContain("MOTREST_RELAY_LLAVE_PADRON");
  });

  /**
   * El padrón viejo estaba en claro. Se acepta una vez y se cifra en el acto:
   * reventar al arrancar dejaría a todos los restaurantes sin WhatsApp por un
   * formato de archivo.
   */
  it("migra un padrón antiguo en claro y lo deja cifrado", () => {
    writeFileSync(
      ruta,
      JSON.stringify([
        { sucursal_id: "suc-vieja", phone_number_id: "111", token: "t-vieja", nombre: "Vieja" },
      ]),
      "utf8",
    );

    const p = padron();
    expect(p.de("suc-vieja")?.token).toBe("t-vieja");
    expect(readFileSync(ruta, "utf8")).not.toContain("t-vieja");
  });

  /**
   * El que entró por auto-registro sigue recibiendo, pero su Hub no se conecta
   * hasta que MOTRAE lo dé de alta de verdad. Es el efecto que se busca.
   */
  it("el migrado no autentica a nadie hasta que se le dé de alta", () => {
    writeFileSync(
      ruta,
      JSON.stringify([{ sucursal_id: "suc-vieja", phone_number_id: "111", token: "t", nombre: "V" }]),
      "utf8",
    );
    const p = padron();
    expect(p.porCredencial("")).toBeUndefined();
    expect(p.mapa.get("111")?.sucursal_id).toBe("suc-vieja");
  });

  it("no deja temporales tirados", () => {
    const p = padron();
    p.darDeAlta("suc-a", "Rodizio");
    p.darDeAlta("suc-b", "La Fonda");
    // Escritura atómica: temporal + rename. Lo que no puede quedar es el temporal.
    expect(readdirSync(carpeta).filter((n) => n.includes(".tmp"))).toEqual([]);
    expect(readdirSync(carpeta)).toEqual(["restaurantes.json"]);
  });

  /**
   * En Windows `chmod` solo mueve el atributo de solo lectura: los permisos de
   * verdad son ACL de NTFS y `statSync` no los refleja. Se comprueba donde el
   * modo significa algo, que es donde el relay se despliega de verdad.
   */
  it.skipIf(process.platform === "win32")("no es legible por otros usuarios", () => {
    padron().darDeAlta("suc-a", "Rodizio");
    expect(statSync(ruta).mode & 0o777).toBe(0o600);
  });
});

describe("un solo Hub por restaurante", () => {
  it("rechaza el segundo enlace en vez de reemplazar al primero", () => {
    const p = padron();
    const primero = { sucursal_id: "suc-a", enviar: () => {}, cerrar: () => {} };
    const segundo = { sucursal_id: "suc-a", enviar: () => {}, cerrar: () => {} };

    expect(p.conectar(primero)).toBe(true);
    expect(p.conectar(segundo)).toBe(false);
    expect(p.enlaceDe("suc-a")).toBe(primero);
  });

  /**
   * Antes, el intruso al desconectarse borraba el enlace del legítimo, que se
   * quedaba mudo sin enterarse de nada.
   */
  it("al caerse un enlace ajeno, el bueno se queda", () => {
    const p = padron();
    const bueno = { sucursal_id: "suc-a", enviar: () => {}, cerrar: () => {} };
    const otro = { sucursal_id: "suc-a", enviar: () => {}, cerrar: () => {} };

    p.conectar(bueno);
    p.desconectar("suc-a", otro);

    expect(p.enlaceDe("suc-a")).toBe(bueno);
    expect(p.conectados).toBe(1);
  });
});
