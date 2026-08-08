/**
 * El pulso de cada restaurante.
 *
 * Lo que se prueba no es que guarde: es que **un local no pueda reportar en
 * nombre de otro**, que un Hub con un fallo no pueda llenar el disco del relay
 * de todos los restaurantes, y que estas cifras —cuánto facturó ayer cada
 * cliente de MOTRAE— no queden legibles en el archivo.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { llaveDelPadron } from "../inquilinos.js";
import { Pulsos, sanearPulso } from "../pulsos.js";

const LLAVE = randomBytes(32).toString("base64");

let carpeta: string;
let ruta: string;

function almacen(): Pulsos {
  return new Pulsos(ruta, llaveDelPadron(LLAVE));
}

const PULSO = {
  version: "1.2.0",
  terminales: 3,
  eventos: 1200,
  ventas_dia: 45_000,
  cuentas_dia: 38,
};

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "motrest-pulsos-"));
  ruta = join(carpeta, "pulsos.json");
});

afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

describe("de quién es un pulso", () => {
  /*
   * EL CANDADO IMPORTANTE. La sucursal la pone quien autenticó al Hub con su
   * credencial, nunca el cuerpo del mensaje. Si el Hub pudiera declararla, un
   * local pisaría el pulso de otro y Central enseñaría sano a un caído.
   */
  it("la sucursal la pone el relay, no el mensaje del Hub", () => {
    const p = almacen();
    p.registrar("suc-rodizio", { ...PULSO, sucursal_id: "suc-otro-restaurante" });

    expect(p.de("suc-rodizio")?.sucursal_id).toBe("suc-rodizio");
    expect(p.de("suc-otro-restaurante")).toBeUndefined();
  });

  it("la hora también la pone el relay: el reloj del local puede estar en cualquier año", () => {
    const p = almacen();
    p.registrar("suc-rodizio", { ...PULSO, ts: 0 }, 1_800_000_000_000);
    expect(p.de("suc-rodizio")?.ts).toBe(1_800_000_000_000);
  });
});

describe("lo que se acepta", () => {
  it("guarda la versión y las cifras gruesas", () => {
    const p = almacen();
    const anotado = p.registrar("suc-rodizio", PULSO);

    expect(anotado?.version).toBe("1.2.0");
    expect(anotado?.terminales).toBe(3);
    expect(anotado?.cuentas_dia).toBe(38);
  });

  it("un pulso sin versión no dice nada útil y se descarta", () => {
    const p = almacen();
    expect(p.registrar("suc-rodizio", { terminales: 2 })).toBeNull();
    expect(p.registrar("suc-rodizio", null)).toBeNull();
    expect(p.total).toBe(0);
  });

  /*
   * Autenticado no es de fiar: una versión con un fallo puede mandar un
   * `problemas` de diez megas en bucle y llenar el disco del relay de TODOS los
   * restaurantes. Se recorta, no se rechaza: el local sigue diciendo que vive.
   */
  it("recorta lo que llega desmedido en vez de tragárselo", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "9".repeat(500),
      problemas: Array.from({ length: 100 }, () => "x".repeat(5000)),
    });

    expect(saneado?.version.length).toBe(32);
    expect(saneado?.problemas?.length).toBe(10);
    expect(saneado?.problemas?.[0]?.length).toBe(200);
  });

  /* Nada que el Hub añada por su cuenta acaba persistido y servido sin decidirlo. */
  it("no deja pasar campos que nadie ha decidido admitir", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      ventas_por_producto: { pizza: 20 },
      clientes: ["Juan"],
    }) as unknown as Record<string, unknown>;

    expect(saneado.ventas_por_producto).toBeUndefined();
    expect(saneado.clientes).toBeUndefined();
  });

  it("descarta números imposibles en vez de guardarlos", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      terminales: -3,
      eventos: Number.POSITIVE_INFINITY,
      cuentas_dia: "muchas",
    });

    expect(saneado?.terminales).toBeUndefined();
    expect(saneado?.eventos).toBeUndefined();
    expect(saneado?.cuentas_dia).toBeUndefined();
  });
});

describe("qué queda en disco", () => {
  it("no se puede leer sin la llave", () => {
    almacen().registrar("suc-rodizio", PULSO);
    const crudo = readFileSync(ruta, "utf8");

    expect(crudo).not.toContain("suc-rodizio");
    expect(crudo).not.toContain("45000");
    expect(JSON.parse(crudo)).toMatchObject({ v: 1 });
  });

  it("sobrevive al reinicio del relay", () => {
    almacen().registrar("suc-rodizio", PULSO);
    expect(almacen().de("suc-rodizio")?.version).toBe("1.2.0");
  });

  /* Un archivo ilegible no puede dejar sin WhatsApp a los restaurantes. */
  it("un archivo corrupto no impide arrancar", () => {
    almacen().registrar("suc-rodizio", PULSO);
    rmSync(ruta);
    const avisos: string[] = [];
    const p = new Pulsos(ruta, llaveDelPadron(randomBytes(32).toString("base64")), (t) =>
      avisos.push(t),
    );
    expect(p.total).toBe(0);
  });

  it("solo se guarda el último de cada local, nunca el histórico", () => {
    const p = almacen();
    p.registrar("suc-rodizio", { ...PULSO, version: "1.2.0" }, 1_000);
    p.registrar("suc-rodizio", { ...PULSO, version: "1.3.0" }, 2_000);

    expect(p.total).toBe(1);
    expect(p.de("suc-rodizio")?.version).toBe("1.3.0");
  });

  it("un local dado de baja se olvida", () => {
    const p = almacen();
    p.registrar("suc-rodizio", PULSO);
    p.olvidar("suc-rodizio");
    expect(p.total).toBe(0);
    expect(almacen().total).toBe(0);
  });
});
