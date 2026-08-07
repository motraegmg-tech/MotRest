/**
 * El Hub comprobando su licencia.
 *
 * Dos candados que valen todo el archivo:
 *
 *   1. Sin llave de verificación, el resultado es INVÁLIDA — no "válida". Al
 *      revés, bastaría con borrar una variable de entorno para desactivar toda
 *      la comprobación del sistema.
 *
 *   2. La credencial de soporte solo sale hacia la caja, nunca hacia una tablet.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitirLicencia, generarPar, type Licencia, type ParDeLlaves } from "@motrest/dominio";
import { GestorLicencia } from "../licencia.js";

const SUC = "suc-rodizio-centro";
const SOPORTE = { sal: "c2Fs", hash: "aGFzaA==", iteraciones: 600_000 };

let carpeta: string;
let ruta: string;
let MOTRAE: ParDeLlaves;

beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "motrest-lic-"));
  ruta = join(carpeta, "licencia.json");
  MOTRAE = await generarPar();
});

afterEach(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

function gestor(llave = MOTRAE.publica, sucursal = SUC, registro: string[] = []) {
  return {
    g: new GestorLicencia(ruta, sucursal, llave, (n, t) => registro.push(`${n}: ${t}`)),
    registro,
  };
}

async function licencia(dias = 30, extra: Partial<Licencia> = {}): Promise<Licencia> {
  return emitirLicencia(
    {
      sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
      vence_ts: Date.now() + dias * 86_400_000, gracia_dias: 3,
      emitida_ts: Date.now(), soporte: SOPORTE, ...extra,
    },
    MOTRAE.privada,
  );
}

describe("cargar la licencia del disco", () => {
  /*
   * Un local recién instalado todavía no tiene licencia. Arrancar bloqueado el
   * día de la instalación —justo cuando MOTRAE está ahí montándolo— no tiene
   * ningún sentido.
   */
  it("sin archivo, opera con normalidad y lo avisa", async () => {
    const { g, registro } = gestor();
    const v = await g.cargar();

    expect(v.licencia).toBeNull();
    expect(v.situacion.estado).toBe("invalida");
    expect(registro.join()).toContain("Sin licencia todavía");
  });

  it("una licencia buena se verifica sin llamar a nadie", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const v = await gestor().g.cargar();

    expect(v.verificada).toBe(true);
    expect(v.situacion.estado).toBe("activa");
  });

  /*
   * EL CANDADO. Sin llave no se puede comprobar, y no poder comprobar significa
   * NO VÁLIDA. Si fuera al revés, desactivar todo el sistema de licencias sería
   * tan fácil como borrar una variable de entorno.
   */
  it("sin llave de verificación NO se da por buena", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const { g, registro } = gestor("");
    const v = await g.cargar();

    expect(v.verificada).toBe(false);
    expect(v.situacion.opera).toBe(false);
    expect(registro.join()).toContain("llave pública Ed25519");
  });

  it("la licencia de otro local no sirve aquí", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const { g, registro } = gestor(MOTRAE.publica, "suc-otro-restaurante");

    expect((await g.cargar()).verificada).toBe(false);
    expect(registro.join()).toContain("no corresponde a este local");
  });

  it("un archivo corrupto no tumba el arranque", async () => {
    await writeFile(ruta, "{ esto no es json");
    const { g, registro } = gestor();

    expect((await g.cargar()).licencia).toBeNull();
    expect(registro.join()).toContain("no se pudo leer");
  });

  it("una licencia manipulada se rechaza", async () => {
    const buena = await licencia(-100);
    await writeFile(ruta, JSON.stringify({ ...buena, vence_ts: Date.now() + 999 * 86_400_000 }));

    expect((await gestor().g.cargar()).verificada).toBe(false);
  });
});

describe("instalar una licencia nueva", () => {
  it("una buena se guarda y surte efecto al momento", async () => {
    const { g } = gestor();
    await g.cargar();

    expect((await g.instalar(await licencia(60))).ok).toBe(true);
    expect(g.veredicto().situacion.estado).toBe("activa");
    expect(JSON.parse(await readFile(ruta, "utf8")).nombre).toBe("Rodizio");
  });

  /*
   * Una licencia mala NO se escribe ni siquiera "para intentarlo después":
   * sustituiría a la buena que ya estaba y dejaría al local peor que antes de
   * pegarla. Es el error de dedo más caro posible en una llamada de soporte.
   */
  it("una inválida no pisa la que ya estaba", async () => {
    const { g } = gestor();
    await g.instalar(await licencia(60));

    const ajena = await emitirLicencia(
      {
        sucursal_id: "suc-otro", nombre: "Otro", plan: "mensual",
        vence_ts: Date.now() + 999 * 86_400_000, gracia_dias: 3, emitida_ts: Date.now(),
      },
      MOTRAE.privada,
    );

    const r = await g.instalar(ajena);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(SUC);
    // La buena sigue en su sitio.
    expect(JSON.parse(await readFile(ruta, "utf8")).nombre).toBe("Rodizio");
  });
});

describe("lo que se le manda a cada terminal", () => {
  /*
   * El hash de la contraseña que abre TODOS los restaurantes no tiene por qué
   * viajar a la tablet de un mesero: no le sirve de nada ahí, y sí es material
   * para intentar adivinarla con calma.
   */
  it("a una tablet del salón va SIN la credencial de soporte", async () => {
    const { g } = gestor();
    await g.instalar(await licencia(30));

    const paraTablet = g.paraTerminales(false);
    expect(paraTablet.licencia?.soporte).toBeUndefined();
    expect(paraTablet.verificada).toBe(true);
  });

  /* A la caja sí: es la máquina donde MOTRAE se conecta a resolver. */
  it("a la caja sí, que es donde hace falta", async () => {
    const { g } = gestor();
    await g.instalar(await licencia(30));

    expect(g.paraTerminales(true).licencia?.soporte).toEqual(SOPORTE);
  });

  it("sin licencia verificada no hay credencial de soporte", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const { g } = gestor("");
    await g.cargar();

    expect(g.credencialSoporte).toBeNull();
  });
});
