/**
 * El Hub buscando versiones nuevas en GitHub.
 *
 * LA PRUEBA QUE JUSTIFICA EL ARCHIVO: que un manifiesto sin la firma de MOTRAE
 * NO se instale. El canal de actualización es la llave maestra de todas las
 * instalaciones — quien pueda publicar por él manda en todos los restaurantes a
 * la vez. Si esto falla, da igual todo lo demás.
 */
import { describe, expect, it, vi } from "vitest";
import { firmarVersion, type VersionDisponible } from "@motrest/dominio";
import { Actualizaciones } from "../actualizaciones.js";

const SECRETO = "secreto-de-publicacion-motrae";
const REPO = { repositorio: "motrae/motrest", llaveDeFirma: SECRETO };

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
    SECRETO,
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
  assets: [{ name: "motrest.json", browser_download_url: "https://github.com/…/motrest.json" }],
};

function hub(llamar: typeof fetch, instalada = "1.4.0", registro: string[] = []) {
  return {
    actualizaciones: new Actualizaciones(
      REPO,
      instalada,
      (nivel, texto) => registro.push(`${nivel}: ${texto}`),
      llamar,
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

  /*
   * EL CANDADO. Un instalador publicado por quien tomó la cuenta de GitHub se
   * queda aquí: sin el secreto de MOTRAE no hay firma válida, y el Hub ni
   * siquiera llega a pedir el archivo.
   */
  it("una firma que no es de MOTRAE se ignora y se registra como error", async () => {
    const falsa = await firmarVersion(
      { version: "9.9.9", notas: "", url: "https://sitio-atacante.mx/virus.exe", sha256: "b".repeat(64), publicado_ts: Date.now() },
      "secreto-de-un-atacante",
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

  /* Un release sin manifiesto no se puede verificar: no se toca. */
  it("un release sin manifiesto se rechaza", async () => {
    const { actualizaciones, registro } = hub(github({ tag_name: "v1.5.0", assets: [] }));
    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro.join()).toContain("no se puede verificar");
  });

  /* Los borradores y las preliminares son para probar, no para los restaurantes. */
  it("los borradores y las versiones preliminares no llegan a nadie", async () => {
    for (const marca of [{ draft: true }, { prerelease: true }]) {
      const { actualizaciones } = hub(github({ ...RELEASE, ...marca }, await manifiesto()));
      expect(await actualizaciones.buscar()).toBeNull();
    }
  });

  /*
   * Sin internet es lo normal en un restaurante. Ni un renglón en la bitácora:
   * llenarla de "no hay internet" hace que nadie la lea cuando pase algo real.
   */
  it("sin internet no falla ni ensucia la bitácora", async () => {
    const caido = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const { actualizaciones, registro } = hub(caido);

    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro).toEqual([]);
  });

  /* Un repositorio sin releases todavía responde 404, y eso no es un problema. */
  it("un repositorio sin releases todavía no es un error", async () => {
    const vacio = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const { actualizaciones, registro } = hub(vacio);

    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro).toEqual([]);
  });
});

describe("bajar el instalador", () => {
  /*
   * La huella cubre lo que la firma no puede: que la descarga se corte a la
   * mitad, o que el archivo del release no sea el que se firmó. Un ejecutable
   * incompleto arranca y falla a medio instalar, y eso deja la instalación peor
   * que si no se hubiera intentado nada.
   */
  it("un instalador que no coincide con su huella NO se guarda", async () => {
    const version = await manifiesto("1.5.0", { sha256: "c".repeat(64) });
    const conArchivo = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(hub(conArchivo).actualizaciones.descargar(version)).rejects.toThrow(
      /no coincide con el que MOTRAE firmó/,
    );
  });

  it("una descarga que falla lo dice", async () => {
    const roto = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(hub(roto).actualizaciones.descargar(await manifiesto())).rejects.toThrow(
      /No se pudo descargar/,
    );
  });
});
