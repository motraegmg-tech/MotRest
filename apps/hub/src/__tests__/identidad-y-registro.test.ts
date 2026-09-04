/**
 * La identidad del local y el registro del Hub.
 *
 * Dos cimientos que las etapas siguientes dan por supuestos, y que hasta ahora
 * no se sostenían:
 *
 *   - El `sucursal_id` se APRENDÍA de los últimos 5 eventos, con caída al
 *     literal `"suc-local"`. **Dos Hubs recién instalados colisionaban entre
 *     sí**: ambos se anunciaban igual a la nube y el segundo desplazaba al
 *     primero.
 *
 *   - El registro era un único `console.log`, y en la aplicación instalada esa
 *     salida se descartaba. Todo lo que el Hub anota —«dispositivo sin aprobar
 *     intentó sincronizar», «terminal autorizada por»— desaparecía. Sin destino
 *     no hay forensia.
 *
 * Se prueba la FORMA de las dos defensas contra el sistema de archivos real, no
 * `main.ts` entero: importarlo arranca el Hub completo —abre la base, escucha
 * puertos, lanza respaldos— y lo que interesa es el comportamiento.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let carpeta: string;

beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "motrest-id-"));
});
afterEach(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

// --- La identidad del local ---------------------------------------------------------------------

/** Réplica de la resolución de identidad de `main.ts`. */
function resolverSucursal(
  ruta: string,
  delEntorno?: string,
  delRegistro?: string,
): string {
  if (existsSync(ruta)) {
    const guardada = readFileSync(ruta, "utf8").trim();
    if (guardada) return guardada;
  }
  const identidad = delEntorno ?? delRegistro ?? `suc-${randomUUID().slice(0, 8)}`;
  mkdirSync(join(ruta, ".."), { recursive: true });
  writeFileSync(ruta, identidad, { encoding: "utf8", mode: 0o600 });
  return identidad;
}

describe("a qué sucursal pertenece este Hub", () => {
  /*
   * EL CANDADO. Antes ambos caían en el literal `"suc-local"` y colisionaban:
   * al conectarse a la nube, el segundo desplazaba el enlace del primero y se
   * quedaba con sus mensajes entrantes.
   */
  it("dos instalaciones nuevas NO reciben el mismo identificador", () => {
    const a = resolverSucursal(join(carpeta, "a", "sucursal.txt"));
    const b = resolverSucursal(join(carpeta, "b", "sucursal.txt"));

    expect(a).not.toBe(b);
    expect(a).not.toBe("suc-local");
    expect(a.startsWith("suc-")).toBe(true);
  });

  /* Un identificador que cambia solo no es un identificador. */
  it("una vez fijado, no cambia aunque el registro diga otra cosa", () => {
    const ruta = join(carpeta, "sucursal.txt");
    const primera = resolverSucursal(ruta, undefined, "suc-de-un-evento");

    expect(resolverSucursal(ruta, "suc-del-entorno", "suc-de-otro-evento")).toBe(primera);
  });

  it("lo que dijo quien instaló manda sobre lo aprendido del registro", () => {
    const ruta = join(carpeta, "sucursal.txt");
    expect(resolverSucursal(ruta, "suc-rodizio-centro", "suc-de-un-evento")).toBe(
      "suc-rodizio-centro",
    );
  });

  it("si el local ya operó, se respeta lo que trae su registro", () => {
    const ruta = join(carpeta, "sucursal.txt");
    expect(resolverSucursal(ruta, undefined, "suc-ya-existente")).toBe("suc-ya-existente");
  });

  it("queda escrito, para que sobreviva al reinicio", () => {
    const ruta = join(carpeta, "sucursal.txt");
    const identidad = resolverSucursal(ruta);
    expect(readFileSync(ruta, "utf8").trim()).toBe(identidad);
  });
});

// --- El registro ---------------------------------------------------------------------------------

/** Réplica de la escritura de `registrar()`. */
function anotar(base: string, nivel: string, mensaje: string, cuando = new Date()): void {
  const marca = cuando.toISOString();
  try {
    mkdirSync(base, { recursive: true });
    appendFileSync(join(base, `hub-${marca.slice(0, 10)}.log`), `${marca} ${nivel} ${mensaje}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Se pierde el renglón, no la venta.
  }
}

describe("el registro del Hub", () => {
  it("deja el renglón en un archivo del día", () => {
    const base = join(carpeta, "registro");
    anotar(base, "AVISO", "Dispositivo sin aprobar intentó sincronizar");

    const archivos = readdirSync(base);
    expect(archivos).toHaveLength(1);
    expect(readFileSync(join(base, archivos[0]!), "utf8")).toContain("sin aprobar");
  });

  it("un día distinto va a otro archivo", () => {
    const base = join(carpeta, "registro");
    anotar(base, "INFO ", "ayer", new Date("2026-08-05T10:00:00Z"));
    anotar(base, "INFO ", "hoy", new Date("2026-08-06T10:00:00Z"));

    expect(readdirSync(base)).toHaveLength(2);
  });

  /*
   * LO QUE NUNCA PUEDE PASAR: que el registro tumbe la caja. Si el disco está
   * lleno o la carpeta desaparece, se pierde el renglón y el restaurante sigue
   * vendiendo. Un registro que puede parar la venta es peor que no tenerlo.
   */
  it("si no se puede escribir, NO revienta", () => {
    // Un archivo donde debería ir la carpeta: `mkdirSync` fallará.
    const obstruido = join(carpeta, "obstruido");
    writeFileSync(obstruido, "no soy una carpeta");

    expect(() => anotar(obstruido, "ERROR", "algo pasó")).not.toThrow();
  });

  it("acumula renglones en vez de sobrescribir", () => {
    const base = join(carpeta, "registro");
    for (let i = 0; i < 5; i++) anotar(base, "INFO ", `renglón ${i}`);

    const contenido = readFileSync(join(base, readdirSync(base)[0]!), "utf8");
    expect(contenido.trim().split("\n")).toHaveLength(5);
  });
});

describe("limpiar lo viejo", () => {
  /** Réplica de `limpiarRegistrosViejos()`. */
  function limpiar(base: string, dias: number): void {
    if (!existsSync(base)) return;
    const limite = Date.now() - dias * 86_400_000;
    for (const nombre of readdirSync(base)) {
      const ruta = join(base, nombre);
      if (statSync(ruta).mtimeMs < limite) rmSync(ruta, { force: true });
    }
  }

  it("borra lo que pasó de la retención y conserva lo reciente", () => {
    const base = join(carpeta, "registro");
    mkdirSync(base, { recursive: true });

    const viejo = join(base, "hub-2020-01-01.log");
    writeFileSync(viejo, "antiguo");
    // Envejecerlo de verdad tocando su fecha de modificación: el nombre del
    // archivo no decide nada, la limpieza mira el `mtime`.
    const hace60Dias = new Date(Date.now() - 60 * 86_400_000);
    utimesSync(viejo, hace60Dias, hace60Dias);

    const nuevo = join(base, "hub-hoy.log");
    writeFileSync(nuevo, "reciente");

    limpiar(base, 30);

    expect(existsSync(viejo)).toBe(false);
    expect(existsSync(nuevo)).toBe(true);
  });

  it("una carpeta que no existe no es un problema", () => {
    expect(() => limpiar(join(carpeta, "no-existe"), 30)).not.toThrow();
  });
});

// --- La clave del local en la consola --------------------------------------------------------------

describe("la clave del local en la salida del arranque", () => {
  const enmascarar = (url: string, mostrar: boolean) =>
    mostrar ? url : url.replace(/([?&]k=)[^&]+/, "$1————————");

  const ENLACE = "https://192.168.1.10:8787/?hub=wss://192.168.1.10:8787/sync&k=SECRETO-DEL-LOCAL";

  /*
   * Esa clave cifra y autoriza TODO el canal de la LAN, y la salida del Hub
   * acaba en sitios que sobreviven al arranque: un archivo de registro, la
   * captura de un panel de soporte, el adjunto de un ticket.
   */
  it("por omisión no se enseña", () => {
    const salida = enmascarar(ENLACE, false);
    expect(salida).not.toContain("SECRETO-DEL-LOCAL");
    // Pero el resto del enlace sigue siendo útil para saber a dónde apunta.
    expect(salida).toContain("192.168.1.10:8787");
  });

  it("solo se enseña si se pide explícitamente", () => {
    expect(enmascarar(ENLACE, true)).toContain("SECRETO-DEL-LOCAL");
  });

  it("un enlace sin clave no se toca", () => {
    const sinClave = "https://192.168.1.10:8787/";
    expect(enmascarar(sinClave, false)).toBe(sinClave);
  });
});
