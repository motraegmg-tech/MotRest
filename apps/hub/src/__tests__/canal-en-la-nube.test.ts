/**
 * El canal de actualizaciones cuando el manifiesto sale de la nube.
 *
 * Estas pruebas existen porque al cambiar el origen es muy fácil aflojar sin
 * querer lo que protegía al carril anterior. Lo que se comprueba aquí es que
 * **cambió de dónde viene el manifiesto y nada más**: sigue mandando la firma de
 * MOTRAE, sigue sin poder retroceder, y sigue sin poder bajar un ejecutable de
 * un host que no esté en la lista blanca.
 *
 * Supabase no es parte de confianza, igual que GitHub nunca lo fue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { firmarVersion, generarPar, type ParDeLlaves, type VersionDisponible } from "@motrest/dominio";
import { Actualizaciones } from "../actualizaciones.js";
import { direccionDeNubeUsable, pareceNubeSupabase } from "../enlace-supabase.js";

const HOST_NUBE = "ixttslqbbwqfcqjmttyg.supabase.co";

let MOTRAE: ParDeLlaves;
let ATACANTE: ParDeLlaves;

beforeEach(async () => {
  MOTRAE = await generarPar();
  ATACANTE = await generarPar();
});

async function manifiesto(
  quien: ParDeLlaves,
  extra: Partial<VersionDisponible> = {},
): Promise<VersionDisponible> {
  return firmarVersion(
    {
      version: "1.5.0",
      notas: "Los cortes salen más rápido.",
      url: `https://${HOST_NUBE}/storage/v1/object/instaladores/MotRest_setup.exe`,
      sha256: "a".repeat(64),
      publicado_ts: Date.now(),
      ...extra,
    },
    quien.privada,
  );
}

/** Un Hub cuyo manifiesto viene de la nube, no de GitHub. */
function hubEnLaNube(
  devuelve: () => Promise<unknown | null>,
  instalada = "1.4.0",
  memoria = {},
) {
  const registro: string[] = [];
  const llamar = vi.fn() as unknown as typeof fetch;
  return {
    actualizaciones: new Actualizaciones(
      {
        // Deliberadamente inválido: un local ya migrado no debe necesitarlo.
        repositorio: "",
        llaveDeFirma: MOTRAE.publica,
        nube: { host: HOST_NUBE, manifiesto: devuelve },
      },
      instalada,
      (nivel, texto) => registro.push(`${nivel}: ${texto}`),
      llamar,
      memoria,
      () => undefined,
      "suc-a1b2c3d4",
    ),
    registro,
    llamar,
  };
}

describe("de dónde viene el manifiesto", () => {
  it("acepta el que la nube entrega firmado por MOTRAE", async () => {
    const firmado = await manifiesto(MOTRAE);
    const { actualizaciones } = hubEnLaNube(async () => firmado);

    expect((await actualizaciones.buscar())?.version).toBe("1.5.0");
  });

  it("un local ya migrado no necesita repositorio de GitHub", async () => {
    // El repositorio va vacío en `hubEnLaNube`. Antes esto abortaba la búsqueda
    // antes de mirar nada: exigirle una configuración que ya no usa dejaría al
    // local sin actualizaciones justo después de migrarlo.
    const { actualizaciones, registro } = hubEnLaNube(async () => await manifiesto(MOTRAE));

    expect(await actualizaciones.buscar()).not.toBeNull();
    expect(registro.join("\n")).not.toMatch(/dueño\/repositorio/);
  });

  it("NUNCA se llama a la red para buscar: el manifiesto ya venía", async () => {
    const { actualizaciones, llamar } = hubEnLaNube(async () => await manifiesto(MOTRAE));
    await actualizaciones.buscar();
    expect(llamar).not.toHaveBeenCalled();
  });

  it("si la nube no contesta, hoy no hay versión y no se rompe nada", async () => {
    const { actualizaciones, registro } = hubEnLaNube(async () => {
      throw new Error("sin internet");
    });

    expect(await actualizaciones.buscar()).toBeNull();
    // Un restaurante sin internet es normal: no merece un renglón por intento.
    expect(registro).toHaveLength(0);
  });
});

describe("lo que la nube NO puede hacer", () => {
  it("un manifiesto firmado por otro se ignora, venga de donde venga", async () => {
    const falso = await manifiesto(ATACANTE);
    const { actualizaciones, registro } = hubEnLaNube(async () => falso);

    expect(await actualizaciones.buscar()).toBeNull();
    expect(registro.join("\n")).toMatch(/una firma que no es de MOTRAE/);
  });

  it("un manifiesto al que le tocaron las notas después de firmar se ignora", async () => {
    /*
     * Las notas son el único texto que el restaurantero lee para decidir cuándo
     * instalar. Si se pudieran reescribir sin la llave, bastaría cambiar
     * "mejoras menores" por "actualización de seguridad crítica" para forzar un
     * reinicio en horario de servicio.
     */
    const firmado = await manifiesto(MOTRAE);
    const manipulado = { ...firmado, notas: "URGENTE: instale de inmediato." };
    const { actualizaciones } = hubEnLaNube(async () => manipulado);

    expect(await actualizaciones.buscar()).toBeNull();
  });

  it("no puede hacer retroceder el canal con un manifiesto viejo", async () => {
    const memoria = { ultimo_publicado_ts: 9_000_000 };
    const viejo = await manifiesto(MOTRAE, { publicado_ts: 5_000_000 });
    const { actualizaciones } = hubEnLaNube(async () => viejo, "1.4.0", memoria);

    expect(await actualizaciones.buscar()).toBeNull();
    expect(memoria.ultimo_publicado_ts).toBe(9_000_000);
  });

  it("no puede mandar a bajar el instalador de un host ajeno", async () => {
    /*
     * La lista blanca se amplió para dejar entrar a Storage, y este es el
     * renglón que comprueba que se amplió y no se abrió: una firma válida dice
     * QUÉ instalar, no autoriza a bajarlo de cualquier sitio.
     */
    const fuera = await manifiesto(MOTRAE, { url: "https://sitio-atacante.mx/MotRest.exe" });
    const { actualizaciones, llamar } = hubEnLaNube(async () => fuera);

    await expect(actualizaciones.descargar(fuera)).rejects.toThrow(/host permitido/);
    expect(llamar).not.toHaveBeenCalled();
  });
});

describe("qué dirección es de la nube y cuál del relay", () => {
  it("distingue la nube del relay de toda la vida", () => {
    // De esto depende que un local migrado no se quede hablando con Fly, y que
    // uno sin migrar no intente autenticarse contra Supabase.
    expect(pareceNubeSupabase(`https://${HOST_NUBE}`)).toBe(true);
    expect(pareceNubeSupabase("wss://relay.motrae.mx/hub")).toBe(false);
  });

  it("exige https, porque por ahí van la credencial y el token de Meta", () => {
    expect(direccionDeNubeUsable(`https://${HOST_NUBE}`).ok).toBe(true);

    const enClaro = direccionDeNubeUsable("http://nube.motrae.mx");
    expect(enClaro.ok).toBe(false);
    if (!enClaro.ok) expect(enClaro.motivo).toMatch(/https/);
  });

  it("deja pasar el bucle local, que es donde corre el ensayo", () => {
    expect(direccionDeNubeUsable("http://localhost:54321").ok).toBe(true);
    expect(direccionDeNubeUsable("http://127.0.0.1:54321").ok).toBe(true);
  });

  it("una dirección que no es una URL se rechaza sin reventar", () => {
    expect(direccionDeNubeUsable("nube.motrae.mx").ok).toBe(false);
  });
});
