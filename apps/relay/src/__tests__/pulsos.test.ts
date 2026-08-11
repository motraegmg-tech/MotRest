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

describe("el inventario de terminales", () => {
  it("guarda el equipo del local con su nombre y si está autorizado", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      dispositivos: [
        { device_id: "dev-caja", nombre: "Caja", aprobado: true, visto_ts: 1_700 },
        { device_id: "dev-tableta", aprobado: false, visto_ts: 900 },
      ],
    });

    expect(saneado?.dispositivos).toEqual([
      { device_id: "dev-caja", nombre: "Caja", aprobado: true, visto_ts: 1_700 },
      { device_id: "dev-tableta", aprobado: false, visto_ts: 900 },
    ]);
  });

  /*
   * EL `token` ES LA CREDENCIAL CON LA QUE ESA TERMINAL SINCRONIZA CONTRA SU HUB.
   * Persistirlo aquí sacaría del restaurante la llave de su propio canal, y sería
   * exactamente el descuido que un `...dispositivo` comete sin que nadie lo vea.
   */
  it("nunca deja entrar el token de emparejamiento de una terminal", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      dispositivos: [
        { device_id: "dev-caja", token: "token-secretisimo", aprobado: true, visto_ts: 1 },
      ],
    });

    expect(JSON.stringify(saneado)).not.toContain("token-secretisimo");
  });

  it("recorta un inventario desmedido y tira las entradas sin identificador", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      dispositivos: [
        ...Array.from({ length: 200 }, (_, i) => ({
          device_id: `dev-${i}`,
          nombre: "n".repeat(500),
          aprobado: true,
          visto_ts: 1,
        })),
        { nombre: "sin id" },
      ],
    });

    expect(saneado?.dispositivos?.length).toBe(40);
    expect(saneado?.dispositivos?.[0]?.nombre?.length).toBe(48);
  });

  /* «Aprobado» solo si lo dice de verdad: un `"si"` no autoriza a nadie. */
  it("no toma por autorizada una terminal que no lo declaró con un booleano", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      dispositivos: [{ device_id: "dev-x", aprobado: "si", visto_ts: "ayer" }],
    });

    expect(saneado?.dispositivos?.[0]).toEqual({
      device_id: "dev-x",
      aprobado: false,
      visto_ts: 0,
    });
  });

  it("acepta la identidad del Hub y si arranca solo", () => {
    const saneado = sanearPulso("suc-rodizio", {
      version: "1.2.0",
      hub_id: "hub-rodizio",
      plataforma: "win32 x64",
      arranque_automatico: false,
    });

    expect(saneado?.hub_id).toBe("hub-rodizio");
    expect(saneado?.plataforma).toBe("win32 x64");
    expect(saneado?.arranque_automatico).toBe(false);
  });

  /*
   * Un Hub viejo no manda nada de esto y tiene que seguir contando que vive: si
   * el relay lo rechazara, ampliar el parte convertiría en «caídos» a todos los
   * locales que aún no se han actualizado.
   */
  it("un pulso de una versión anterior sigue siendo un pulso válido", () => {
    const saneado = sanearPulso("suc-rodizio", { version: "1.1.0", terminales: 2 });

    expect(saneado?.version).toBe("1.1.0");
    expect(saneado?.dispositivos).toBeUndefined();
    expect(saneado?.hub_id).toBeUndefined();
    expect(saneado?.arranque_automatico).toBeUndefined();
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
