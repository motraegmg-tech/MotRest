/**
 * El Hub buscando versiones nuevas en GitHub.
 *
 * Estas pruebas protegen la cadena más sensible del producto: una actualización
 * no puede venir de otro par, retroceder en el tiempo, ni sacar un token de
 * GitHub hacia una URL escrita en un manifiesto.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  firmarVersion,
  generarPar,
  leTocaElAnillo,
  type ParDeLlaves,
  type VersionDisponible,
} from "@motrest/dominio";
import { Actualizaciones } from "../actualizaciones.js";

let MOTRAE: ParDeLlaves;
let ATACANTE: ParDeLlaves;

beforeEach(async () => {
  MOTRAE = await generarPar();
  ATACANTE = await generarPar();
});

const REPO = () => ({ repositorio: "motrae/motrest", llaveDeFirma: MOTRAE.publica });

async function manifiesto(v = "1.5.0", extra: Partial<VersionDisponible> = {}) {
  return firmarVersion(
    {
      version: v,
      notas: "Cortes más rápidos.",
      url: `https://github.com/motrae/motrest/releases/download/v${v}/MotRest_setup.exe`,
      sha256: "a".repeat(64),
      publicado_ts: Date.now(),
      ...extra,
    },
    MOTRAE.privada,
  );
}

/** Simula GitHub: primero el release, después el asset del manifiesto. */
function github(release: unknown, archivo?: unknown): typeof fetch {
  return vi.fn(async (url: string) => {
    if (String(url).includes("api.github.com")) {
      return new Response(JSON.stringify(release), { status: 200 });
    }
    return new Response(JSON.stringify(archivo ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
}

const RELEASE = {
  tag_name: "v1.5.0",
  assets: [{ name: "motrest.json", browser_download_url: "https://github.com/motrae/motrest/releases/motrest.json" }],
};

function hub(
  llamar: typeof fetch,
  instalada = "1.4.0",
  registro: string[] = [],
  memoria = {},
  token?: string,
  sucursalId?: string,
) {
  return {
    actualizaciones: new Actualizaciones(
      { ...REPO(), ...(token ? { token } : {}) },
      instalada,
      (nivel, texto) => registro.push(`${nivel}: ${texto}`),
      llamar,
      memoria,
      () => undefined,
      sucursalId
    ),
    registro,
  };
}

describe("buscar una versión nueva", () => {
  it("encuentra la que MOTRAE publicó y firmó", async () => {
    const { actualizaciones } = hub(github(RELEASE, await manifiesto("1.5.0")));
    const v = await actualizaciones.buscar();
    expect(v?.version).toBe("1.5.0");
  });

  it("una firma de otra privada se ignora y se registra como error", async () => {
    const falsa = await firmarVersion(
      { version: "9.9.9", notas: "", url: "https://github.com/motrae/motrest/virus.exe", sha256: "b".repeat(64), publicado_ts: Date.now() },
      ATACANTE.privada,
    );
    const { actualizaciones, registro } = hub(github(RELEASE, falsa));

    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro.join()).toContain("una firma que no es de MOTRAE");
  });

  it("si ya está en la última, no ofrece nada", async () => {
    const { actualizaciones } = hub(github(RELEASE, await manifiesto("1.5.0")), "1.5.0");
    expect(await actualizaciones.buscar()).toBeNull();
  });

  it("no ofrece una versión más vieja que la instalada", async () => {
    const { actualizaciones } = hub(github(RELEASE, await manifiesto("1.3.0")), "1.4.0");
    expect(await actualizaciones.buscar()).toBeNull();
  });

  it("si el anillo no le toca, no lo ofrece ni lo recuerda", async () => {
    // Le pasamos un anillo muy restrictivo (1%) y un sucursalId que sabemos que cae fuera.
    // Como el hash reparte uniformemente, "suc-fuera-del-1-por-ciento" casi seguro no está en el 1%.
    const archivo = await manifiesto("1.5.0", { anillo: 1, publicado_ts: 2000 });
    const memoria: { ultimo_publicado_ts?: number } = {};
    const { actualizaciones } = hub(github(RELEASE, archivo), "1.4.0", [], memoria, undefined, "suc-muy-lejos-del-anillo-1");

    expect(await actualizaciones.buscar()).toBeNull();
    // No debe recordarlo, porque si lo recuerda nunca más lo verá cuando el anillo se amplíe.
    expect(memoria.ultimo_publicado_ts).toBeUndefined();
  });

  it("no acepta un manifiesto firmado que retrocede el publicado_ts", async () => {
    let archivo = await manifiesto("1.5.0", { publicado_ts: 2_000 });
    const llamar = github(RELEASE, archivo);
    const memoria: { ultimo_publicado_ts?: number } = {};
    const { actualizaciones, registro } = hub(llamar, "1.4.0", [], memoria);

    expect((await actualizaciones.buscar(2_001))?.version).toBe("1.5.0");
    archivo = await manifiesto("1.6.0", { publicado_ts: 1_999 });
    // El mock lee `archivo` al contestar el segundo intento.
    (llamar as unknown as { mockImplementation: (fn: (url: string) => Promise<Response>) => void }).mockImplementation(
      async (url: string) => String(url).includes("api.github.com")
        ? new Response(JSON.stringify(RELEASE), { status: 200 })
        : new Response(JSON.stringify(archivo), { status: 200 }),
    );

    expect(await actualizaciones.buscar(2_002)).toBeNull();
    expect(registro.join()).toContain("podría ser una reversión");
    expect(memoria.ultimo_publicado_ts).toBe(2_000);
  });

  it("un release sin manifiesto no se puede verificar", async () => {
    const { actualizaciones, registro } = hub(github({ tag_name: "v1.5.0", assets: [] }));
    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro.join()).toContain("no se puede verificar");
  });

  it("los borradores y las versiones preliminares no llegan a nadie", async () => {
    for (const marca of [{ draft: true }, { prerelease: true }]) {
      const { actualizaciones } = hub(github({ ...RELEASE, ...marca }, await manifiesto()));
      expect(await actualizaciones.buscar()).toBeNull();
    }
  });

  it("sin internet no falla ni ensucia la bitácora", async () => {
    const caido = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const { actualizaciones, registro } = hub(caido);

    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro).toEqual([]);
  });

  it("no manda el token a un host de assets aunque GitHub redirija ahí", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const archivo = await manifiesto();
    const llamar = vi.fn(async (url: string, opciones?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: (opciones?.headers as Record<string, string>)?.authorization,
      });
      if (String(url).includes("api.github.com")) {
        return new Response(JSON.stringify({
          ...RELEASE,
          assets: [{ name: "motrest.json", browser_download_url: "https://objects.githubusercontent.com/motrest.json" }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify(archivo), { status: 200 });
    }) as unknown as typeof fetch;

    await hub(llamar, "1.4.0", [], {}, "token-privado").actualizaciones.buscar();

    expect(calls[0]?.authorization).toBe("Bearer token-privado");
    expect(calls[1]?.url).toContain("objects.githubusercontent.com");
    expect(calls[1]?.authorization).toBeUndefined();
  });

  it("no recuerda el manifiesto si el anillo no le toca (impide que quede ignorado para siempre)", async () => {
    const archivo = await manifiesto("1.5.0", { anillo: 5, publicado_ts: 5_000 });
    const llamar = github(RELEASE, archivo);
    const memoria: { ultimo_publicado_ts?: number } = {};
    
    // Buscamos un ID que sepamos que queda fuera del anillo del 5%
    let sucursalId = "sucursal-1";
    while (leTocaElAnillo(sucursalId, 5)) {
      sucursalId += "a";
    }

    const actualizaciones = new Actualizaciones(
      REPO(),
      "1.4.0",
      () => {},
      llamar,
      memoria,
      () => {},
      sucursalId
    );

    const resultado = await actualizaciones.buscar();
    
    expect(resultado).toBeNull();
    // La memoria no se debió modificar: si se hubiera recordado el 5000, 
    // la sucursal nunca vería esta versión cuando el anillo crezca
    expect(memoria.ultimo_publicado_ts).toBeUndefined();
  });
});

describe("bajar el instalador", () => {
  it("una URL ajena a GitHub no recibe el token ni se pide", async () => {
    const version = await manifiesto("1.5.0", { url: "https://sitio-atacante.mx/MotRest.exe" });
    const llamar = vi.fn() as unknown as typeof fetch;

    await expect(hub(llamar, "1.4.0", [], {}, "token-privado").actualizaciones.descargar(version))
      .rejects.toThrow(/HTTPS en un host permitido/);
    expect(llamar).not.toHaveBeenCalled();
  });

  it("un instalador que no coincide con su huella NO se guarda", async () => {
    const version = await manifiesto("1.5.0", { sha256: "c".repeat(64) });
    const conArchivo = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(hub(conArchivo).actualizaciones.descargar(version)).rejects.toThrow(
      /no coincide con el que MOTRAE firmó/,
    );
  });

  it("vuelve a calcular la huella desde disco justo antes del spawn", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const version = await manifiesto("1.5.0", {
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const conArchivo = vi.fn(async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch;
    const actualizaciones = hub(conArchivo).actualizaciones;
    const ruta = await actualizaciones.descargar(version);
    await writeFile(ruta, new Uint8Array([9, 9, 9]));

    await expect(actualizaciones.instalar(ruta, version)).rejects.toThrow(/cambió después de verificarse/);
  });

  it("una descarga que falla lo dice", async () => {
    const roto = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(hub(roto).actualizaciones.descargar(await manifiesto())).rejects.toThrow(
      /No se pudo descargar/,
    );
  });
});
