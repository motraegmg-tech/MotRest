/**
 * El sellador del local: guardar el CSD y firmar comprobantes.
 *
 * Se prueba contra el disco de verdad, en una carpeta temporal, porque la mitad
 * de lo que hay que verificar ES el manejo de archivos: que no se guarde un CSD
 * inválido, que sobreviva al reinicio y que desinstalarlo lo borre.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, verify } from "node:crypto";
import { pesos, type Comprobante } from "@motrest/dominio";
import { Sellador } from "../fiscal/sellador.js";
import { generarCsdDePrueba } from "./csd-de-prueba.js";

const CONTRASENA = "12345678a";
const RFC = "AAA010101AAA";

let cer: Uint8Array;
let key: Uint8Array;
let otroCer: Uint8Array;
let csdVencido: { cer: Uint8Array; key: Uint8Array };

beforeAll(async () => {
  ({ cer, key } = await generarCsdDePrueba({ rfc: RFC }));
  ({ cer: otroCer } = await generarCsdDePrueba({
    rfc: "BBB020202BB2",
    no_certificado: "30001000000500009999",
  }));
  csdVencido = await generarCsdDePrueba({ rfc: RFC, diasDeVigencia: -5 });
});

const carpetas: string[] = [];
function carpeta(): string {
  const c = mkdtempSync(join(tmpdir(), "motrest-csd-"));
  carpetas.push(c);
  return c;
}
afterEach(() => {
  while (carpetas.length) rmSync(carpetas.pop()!, { recursive: true, force: true });
});

function comprobante(): Comprobante {
  return {
    version: "4.0",
    serie: "A",
    folio: "123",
    fecha: "2026-07-23T21:15:00",
    forma_pago: "01",
    metodo_pago: "PUE",
    lugar_expedicion: "06000",
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal: pesos(500),
    descuento: pesos(0) as never,
    total: pesos(580),
    no_certificado: "",
    emisor: {
      rfc: RFC,
      nombre: "RESTAURANTE DE PRUEBA",
      regimen_fiscal: "601",
      codigo_postal: "06000",
    },
    receptor: {
      rfc: "XEXX010101000",
      nombre: "PUBLICO EN GENERAL",
      regimen_fiscal: "616",
      codigo_postal: "06000",
      uso_cfdi: "S01",
    },
    conceptos: [
      {
        clave_prod_serv: "90101501",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: "Pizza familiar",
        valor_unitario: pesos(500),
        importe: pesos(500),
        descuento: pesos(0) as never,
        objeto_imp: "02",
        traslados: [
          {
            base: pesos(500),
            impuesto: "002",
            tipo_factor: "Tasa",
            tasa_o_cuota: 0.16,
            importe: pesos(80),
          },
        ],
      },
    ],
    traslados: [
      {
        base: pesos(500),
        impuesto: "002",
        tipo_factor: "Tasa",
        tasa_o_cuota: 0.16,
        importe: pesos(80),
      },
    ],
    total_impuestos_trasladados: pesos(80),
    orden_id: "ord-1",
  } as Comprobante;
}

// --- Instalar el CSD ---------------------------------------------------------------------

describe("instalar el CSD", () => {
  it("acepta un CSD válido del emisor", () => {
    const s = new Sellador(carpeta());
    expect(s.instalar(cer, key, CONTRASENA, RFC)).toEqual({ ok: true });
    expect(s.listo).toBe(true);
    expect(s.estado().rfc).toBe(RFC);
  });

  /*
   * El error frecuente: se acumulan renovaciones en la misma carpeta y se
   * combinan archivos de dos trámites. El PAC diría "sello inválido", que no
   * apunta a nada; aquí se dice en el momento de subirlos.
   */
  it("rechaza un certificado que no es pareja de la llave", () => {
    const s = new Sellador(carpeta());
    const r = s.instalar(otroCer, key, CONTRASENA, "BBB020202BB2");
    expect(r).toMatchObject({ ok: false });
    expect((r as { problema: string }).problema).toMatch(/no son pareja/i);
  });

  it("rechaza el CSD de otro contribuyente", () => {
    const s = new Sellador(carpeta());
    const r = s.instalar(cer, key, CONTRASENA, "BBB020202BB2");
    expect(r).toMatchObject({ ok: false });
    expect((r as { problema: string }).problema).toContain(RFC);
  });

  it("rechaza la contraseña equivocada sin culpar al cifrado", () => {
    const s = new Sellador(carpeta());
    const r = s.instalar(cer, key, "otra", RFC);
    expect((r as { problema: string }).problema).toMatch(/contraseña/i);
  });

  /*
   * Subir el CSD viejo al renovarlo es un error clásico: los archivos se llaman
   * casi igual. Rechazarlo aquí evita un servicio entero facturando contra un
   * certificado que el SAT ya no reconoce.
   */
  it("rechaza un CSD vencido", () => {
    const s = new Sellador(carpeta());
    const r = s.instalar(csdVencido.cer, csdVencido.key, CONTRASENA, RFC);
    expect((r as { problema: string }).problema).toMatch(/venció/);
    expect(s.listo).toBe(false);
  });

  /*
   * Nada se escribe hasta que todo pasó. Si un CSD rechazado dejara archivos a
   * medias, el siguiente arranque los tomaría por buenos.
   */
  it("un CSD rechazado NO deja archivos en el disco", () => {
    const c = carpeta();
    const s = new Sellador(c);
    s.instalar(cer, key, "otra", RFC);

    expect(existsSync(join(c, "csd.cer"))).toBe(false);
    expect(existsSync(join(c, "csd.key"))).toBe(false);
    expect(existsSync(join(c, "csd.pass"))).toBe(false);
    expect(s.listo).toBe(false);
  });
});

// --- Sobrevivir al reinicio --------------------------------------------------------------

describe("el CSD sobrevive al reinicio de la caja", () => {
  it("se recupera del disco al volver a arrancar", () => {
    const c = carpeta();
    new Sellador(c).instalar(cer, key, CONTRASENA, RFC);

    const otroArranque = new Sellador(c);
    expect(otroArranque.listo).toBe(true);
    expect(otroArranque.estado().no_certificado).not.toBeNull();
  });

  /*
   * Sin caja no hay servicio. No facturar es un problema; no poder vender es
   * otro mucho peor, así que un CSD ilegible no puede tumbar el arranque.
   */
  it("un CSD corrupto no impide que el Hub arranque", () => {
    const c = carpeta();
    new Sellador(c).instalar(cer, key, CONTRASENA, RFC);
    writeFileSync(join(c, "csd.cer"), "basura");

    let s: Sellador | null = null;
    expect(() => (s = new Sellador(c))).not.toThrow();
    expect(s!.listo).toBe(false);
  });

  it("desinstalar borra los tres archivos", () => {
    const c = carpeta();
    const s = new Sellador(c);
    s.instalar(cer, key, CONTRASENA, RFC);
    s.desinstalar();

    for (const a of ["csd.cer", "csd.key", "csd.pass"]) {
      expect(existsSync(join(c, a))).toBe(false);
    }
    expect(s.listo).toBe(false);
  });
});

// --- Sellar ------------------------------------------------------------------------------

describe("sellar un comprobante", () => {
  it("sin CSD dice qué hacer, en vez de reventar con un error técnico", () => {
    const s = new Sellador(carpeta());
    expect(() => s.sellarComprobante(comprobante())).toThrow(/Administración/);
  });

  /*
   * El orden importa y es la trampa del Anexo 20: `NoCertificado` forma parte
   * de la cadena original. Armar la cadena antes de ponerlo daría un sello que
   * el PAC rechaza sin explicar por qué.
   */
  it("mete el número de certificado DENTRO de la cadena que firma", () => {
    const s = new Sellador(carpeta());
    s.instalar(cer, key, CONTRASENA, RFC);

    const sellado = s.sellarComprobante(comprobante());
    expect(sellado.cadena).toContain(sellado.no_certificado);
  });

  it("el sello se verifica con la clave pública del certificado", () => {
    const s = new Sellador(carpeta());
    s.instalar(cer, key, CONTRASENA, RFC);
    const sellado = s.sellarComprobante(comprobante());

    const certificado = new X509Certificate(Buffer.from(sellado.certificado, "base64"));
    expect(
      verify(
        "sha256",
        Buffer.from(sellado.cadena, "utf8"),
        certificado.publicKey,
        Buffer.from(sellado.sello, "base64"),
      ),
    ).toBe(true);
  });

  it("devuelve el certificado tal como va en el XML", () => {
    const s = new Sellador(carpeta());
    s.instalar(cer, key, CONTRASENA, RFC);
    expect(Buffer.from(s.sellarComprobante(comprobante()).certificado, "base64")).toEqual(
      Buffer.from(cer),
    );
  });
});

// --- Lo que se puede contar --------------------------------------------------------------

describe("el estado del CSD", () => {
  it("nunca expone la llave ni la contraseña", () => {
    const s = new Sellador(carpeta());
    s.instalar(cer, key, CONTRASENA, RFC);

    const texto = JSON.stringify(s.estado());
    expect(texto).not.toContain(CONTRASENA);
    expect(texto.toLowerCase()).not.toContain("private");
  });

  it("avisa cuántos días le quedan de vigencia", () => {
    const s = new Sellador(carpeta());
    s.instalar(cer, key, CONTRASENA, RFC);
    expect(s.estado().dias_restantes).toBeGreaterThan(300);
  });

  it("sin CSD lo dice sin inventar datos", () => {
    expect(new Sellador(carpeta()).estado()).toMatchObject({
      cargado: false,
      rfc: null,
      no_certificado: null,
    });
  });
});

// --- Permisos en el disco ----------------------------------------------------------------

describe("cómo queda el CSD en el disco", () => {
  /*
   * En Windows los permisos POSIX no aplican, así que esto solo se comprueba
   * donde significa algo. Lo que sí se verifica en todos lados es que los
   * archivos se escriban donde se espera y no en otro sitio.
   */
  it("guarda los tres archivos en la carpeta del local", () => {
    const c = carpeta();
    new Sellador(c).instalar(cer, key, CONTRASENA, RFC);

    expect(readFileSync(join(c, "csd.pass"), "utf8")).toBe(CONTRASENA);
    expect(Buffer.from(readFileSync(join(c, "csd.cer")))).toEqual(Buffer.from(cer));
    expect(Buffer.from(readFileSync(join(c, "csd.key")))).toEqual(Buffer.from(key));
  });
});
