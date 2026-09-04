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
const RESPONSABLE = {
  id: "usr-gonzalo",
  nombre: "Responsable Rodizio",
  puesto: "Responsable del restaurante",
  provision_id: "018f8fe4-6740-7d0d-98b5-a4a3e0000001",
  credencial: {
    empleado_id: "usr-gonzalo",
    tipo: "pin" as const,
    algoritmo: "PBKDF2-SHA256" as const,
    iteraciones: 310_000,
    sal: "c2Fs",
    hash: "aGFzaA==",
    creada_ts: 1,
  },
};

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

/**
 * Un gestor de licencia sobre una carpeta desechable.
 *
 * `fijarIdentidad` se omite por defecto: la mayoría de las pruebas son de un
 * local que YA sabe cuál es, y ahí una licencia ajena tiene que rechazarse. El
 * alta por licencia se prueba aparte, pasándolo.
 */
function gestor(
  llave = MOTRAE.publica,
  sucursal = SUC,
  registro: string[] = [],
  fijarIdentidad?: (id: string) => boolean,
) {
  let actual = sucursal;
  return {
    g: new GestorLicencia(
      ruta,
      () => actual,
      llave,
      (n, t) => registro.push(`${n}: ${t}`),
      fijarIdentidad === undefined
        ? undefined
        : (id) => {
            const acepta = fijarIdentidad(id);
            if (acepta) actual = id;
            return acepta;
          },
    ),
    registro,
    /** Con qué identidad quedó el equipo después de todo. */
    sucursalAhora: () => actual,
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
  it("a una tablet del salón van SIN las credenciales de soporte ni responsable", async () => {
    const { g } = gestor();
    await g.instalar(await licencia(30, { responsable: RESPONSABLE }));

    const paraTablet = g.paraTerminales(false);
    expect(paraTablet.licencia?.soporte).toBeUndefined();
    expect(paraTablet.licencia?.responsable).toBeUndefined();
    expect(paraTablet.verificada).toBe(true);
  });

  /* A la caja sí: es la máquina donde MOTRAE se conecta a resolver. */
  it("a la caja sí, que es donde hacen falta", async () => {
    const { g } = gestor();
    await g.instalar(await licencia(30, { responsable: RESPONSABLE }));

    expect(g.paraTerminales(true).licencia?.soporte).toEqual(SOPORTE);
    expect(g.paraTerminales(true).licencia?.responsable).toEqual(RESPONSABLE);
  });

  it("sin licencia verificada no hay credencial de soporte", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const { g } = gestor("");
    await g.cargar();

    expect(g.credencialSoporte).toBeNull();
  });
});

/*
 * EL ALTA DE UN RESTAURANTE, que es la razón de ser de todo esto.
 *
 * Gonzalo da de alta el local en MotRest Central, Central emite el archivo
 * firmado, y ese archivo se pega en la caja. El equipo pasa de «no sé qué
 * restaurante soy» a saberlo, sin que nadie teclee un identificador y sin que
 * venga escrito en el código —donde era el mismo para todas las instalaciones—.
 */
describe("dar de alta el restaurante con su licencia", () => {
  const PROVISIONAL = "suc-d6c70a6d";

  it("un equipo recién instalado toma la identidad que trae la licencia", async () => {
    const g = gestor(MOTRAE.publica, PROVISIONAL, [], () => true);
    const r = await g.g.instalar(await licencia(30));

    expect(r.ok).toBe(true);
    expect(g.sucursalAhora()).toBe(SUC);
    expect(g.g.veredicto().situacion.opera).toBe(true);
  });

  it("también si el archivo se copia a mano a la carpeta del Hub", async () => {
    await writeFile(ruta, JSON.stringify(await licencia(30)));
    const g = gestor(MOTRAE.publica, PROVISIONAL, [], () => true);
    await g.g.cargar();

    expect(g.sucursalAhora()).toBe(SUC);
    expect(g.g.veredicto().verificada).toBe(true);
  });

  /*
   * Lo que impide que la licencia de un restaurante que paga sirva en todos los
   * demás. Un local con identidad firme la rechaza aunque la firma sea buena.
   */
  it("pero un local que ya es alguien NO adopta la licencia de otro", async () => {
    const g = gestor(MOTRAE.publica, "suc-otro-restaurante", [], () => false);
    const r = await g.g.instalar(await licencia(30));

    expect(r.ok).toBe(false);
    expect(r.error).toContain("no es de este local");
    expect(g.sucursalAhora()).toBe("suc-otro-restaurante");
  });

  /* Una licencia falsificada no da identidad a nadie, por nueva que sea la caja. */
  it("y una licencia sin la firma de MOTRAE no da identidad ni a un equipo virgen", async () => {
    const otro = await generarPar();
    const falsificada = await emitirLicencia(
      {
        sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
        vence_ts: Date.now() + 30 * 86_400_000, gracia_dias: 3, emitida_ts: Date.now(),
      },
      otro.privada,
    );

    const g = gestor(MOTRAE.publica, PROVISIONAL, [], () => true);
    const r = await g.g.instalar(falsificada);

    expect(r.ok).toBe(false);
    expect(g.sucursalAhora()).toBe(PROVISIONAL);
  });
});

describe("el Bloc de notas y su BOM", () => {
  /*
   * TRES BYTES INVISIBLES QUE DEJAN UN LOCAL SIN LICENCIA.
   *
   * Pegar la licencia a mano es un camino legitimo -- montar una caja con el
   * archivo en una USB, o entrar por SSH a un restaurante -- y en Windows eso
   * casi siempre pasa por el Bloc de notas, que antepone la marca de orden de
   * bytes al guardar en UTF-8.
   *
   * `JSON.parse` la rechaza, y el mensaje que sale ("el archivo de licencia no
   * se pudo leer") apunta al archivo entero cuando lo que sobra es un caracter
   * que nadie ve. Paso exactamente asi la primera vez que se probo, y costo
   * media hora entender por que una licencia que se ve perfecta no servia.
   */
  it("una licencia guardada con el Bloc de notas se lee igual", async () => {
    const licencia = await emitirLicencia(
      {
        sucursal_id: SUC,
        nombre: "Rodizio",
        plan: "mensual",
        vence_ts: Date.now() + 86_400_000,
        gracia_dias: 3,
        emitida_ts: Date.now(),
      },
      MOTRAE.privada,
    );

    // Exactamente lo que escribe el Bloc de notas: BOM y despues el JSON.
    await writeFile(ruta, "\uFEFF" + JSON.stringify(licencia, null, 2), "utf8");

    const gestor = new GestorLicencia(ruta, () => SUC, MOTRAE.publica, () => undefined);
    const veredicto = await gestor.cargar();

    expect(veredicto.verificada).toBe(true);
    expect(veredicto.licencia?.nombre).toBe("Rodizio");
  });
});
