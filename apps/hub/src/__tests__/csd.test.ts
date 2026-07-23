/**
 * El sellado con el CSD.
 *
 * No hay un CSD del SAT en el repositorio —ni lo habrá: es la firma fiscal de
 * un contribuyente—, así que las pruebas generan un certificado y una llave de
 * verdad y ejercitan el camino completo sobre ellos. Lo único que no se puede
 * reproducir así es la rareza del número de serie, que se prueba aparte con el
 * valor real de un CSD conocido.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { X509Certificate, generateKeyPairSync, verify } from "node:crypto";
import selfsigned from "selfsigned";
import {
  abrirLlave,
  diasDeVigencia,
  leerCertificado,
  numeroDeCertificado,
  problemaDelCsd,
  sellar,
  sonPareja,
  vigente,
  type Csd,
} from "../fiscal/csd.js";
import { generarCsdDePrueba } from "./csd-de-prueba.js";

const CONTRASENA = "12345678a";
const RFC = "AAA010101AAA";
const NO_CERTIFICADO = "30001000000500003416";

let cer: Uint8Array;
let key: Uint8Array;
let csd: Csd;

beforeAll(async () => {
  ({ cer, key } = await generarCsdDePrueba());
  csd = leerCertificado(cer);
});

// --- El número de certificado ------------------------------------------------------------

describe("el número de certificado del SAT", () => {
  /*
   * La trampa del archivo entero. El estándar dice que el número de serie es un
   * entero; el SAT mete ahí los 20 dígitos en ASCII. Leerlo como número da 48
   * dígitos que no existen, la cadena original sale distinta y NINGUNA factura
   * se timbra.
   */
  it("decodifica el serial como texto, no como número", () => {
    const serialDeUnCsdReal = "3330303031303030303030353030303033343136";
    expect(numeroDeCertificado(serialDeUnCsdReal)).toBe("30001000000500003416");
  });

  it("siempre da los 20 dígitos que pide el SAT", () => {
    expect(numeroDeCertificado("3330303031303030303030353030303033343136")).toHaveLength(20);
  });

  it("tolera un hexadecimal de largo impar en vez de perder un byte", () => {
    expect(() => numeroDeCertificado("333030")).not.toThrow();
    expect(numeroDeCertificado("333030")).toBe("300");
  });
});

// --- Lectura del certificado -------------------------------------------------------------

describe("leer el .cer", () => {
  it("saca el certificado en base64 tal como va en el XML", () => {
    expect(csd.certificado_base64).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Tiene que ser el DER completo: el PAC lo vuelve a leer.
    expect(Buffer.from(csd.certificado_base64, "base64")).toEqual(Buffer.from(cer));
  });

  it("encuentra el RFC del titular dentro del sujeto", () => {
    expect(csd.rfc).toBe(RFC);
  });

  it("lee la vigencia", () => {
    expect(csd.valido_desde.getTime()).toBeLessThanOrEqual(Date.now());
    expect(diasDeVigencia(csd)).toBeGreaterThan(300);
    expect(vigente(csd)).toBe(true);
  });

  it("recupera los 20 dígitos del CSD", () => {
    expect(csd.no_certificado).toBe(NO_CERTIFICADO);
  });

  it("un archivo que no es un certificado se rechaza con un mensaje que orienta", () => {
    expect(() => leerCertificado(Buffer.from("esto no es un .cer"))).toThrow(/SAT/);
  });

  /*
   * La e.firma es un certificado del SAT perfectamente válido que NO sirve para
   * facturar, y es una confusión clásica. Se distingue por el número de serie:
   * el CSD lleva 20 dígitos; cualquier otro certificado, un entero arbitrario.
   * Sin esta comprobación, esos bytes se colarían en la cadena original y el
   * error aparecería mucho después, en el PAC, como "sello inválido".
   */
  it("rechaza un certificado que NO es un CSD y explica por qué", async () => {
    const cualquiera = await selfsigned.generate([{ name: "commonName", value: "OTRO" }], {
      keySize: 2048,
      algorithm: "sha256",
      notBeforeDate: new Date(Date.now() - 86_400_000),
      notAfterDate: new Date(Date.now() + 86_400_000),
    });
    const der = new X509Certificate(cualquiera.cert).raw;

    expect(() => leerCertificado(der)).toThrow(/20 dígitos|e\.firma/);
  });
});

// --- La llave privada --------------------------------------------------------------------

describe("abrir el .key", () => {
  it("abre la llave cifrada del SAT con su contraseña", () => {
    expect(() => abrirLlave(key, CONTRASENA)).not.toThrow();
  });

  /*
   * OpenSSL responde a una contraseña equivocada con "Provider routines::bad
   * decrypt". Un filtro que busque "provider" manda a convertir la llave con
   * OpenSSL a quien solo se equivocó al teclear — y eso ya pasó una vez aquí.
   * Se comprueban los dos lados: que diga "contraseña" y que NO hable de
   * convertir nada.
   */
  it("con la contraseña equivocada culpa a la contraseña, no al cifrado", () => {
    expect(() => abrirLlave(key, "otra")).toThrow(/contraseña/i);
    expect(() => abrirLlave(key, "otra")).not.toThrow(/OpenSSL|cifrado/i);
  });
});

// --- Certificado y llave, ¿pareja? -------------------------------------------------------

describe("cotejar el .cer con el .key", () => {
  it("reconoce a la pareja correcta", () => {
    expect(sonPareja(csd, abrirLlave(key, CONTRASENA))).toBe(true);
  });

  /*
   * El error frecuente: se acumulan renovaciones en la misma carpeta y se sube
   * el certificado de un CSD con la llave de otro. El PAC lo reporta como
   * "sello inválido", que no apunta a nada. Detectarlo al cargar los archivos
   * ahorra la búsqueda a ciegas.
   */
  it("detecta una llave que NO es de ese certificado", () => {
    const ajena = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(sonPareja(csd, ajena)).toBe(false);
  });
});

// --- El sello ----------------------------------------------------------------------------

describe("sellar la cadena original", () => {
  const CADENA = "||4.0|A|1|2026-07-23T14:30:00|01|30001000000500003416|1000.00|MXN|1160.00||";

  it("produce un sello verificable con la clave pública del certificado", () => {
    const sello = sellar(CADENA, abrirLlave(key, CONTRASENA));
    const certificado = new X509Certificate(Buffer.from(csd.certificado_base64, "base64"));

    expect(
      verify("sha256", Buffer.from(CADENA, "utf8"), certificado.publicKey, Buffer.from(sello, "base64")),
    ).toBe(true);
  });

  /*
   * PKCS#1 v1.5 es determinista; PSS no lo es. Esta prueba es la que se pondrá
   * roja el día que alguien "modernice" el relleno: la firma seguiría siendo
   * criptográficamente impecable y el PAC la rechazaría igual.
   */
  it("el mismo texto con la misma llave da SIEMPRE el mismo sello", () => {
    const llave = abrirLlave(key, CONTRASENA);
    expect(sellar(CADENA, llave)).toBe(sellar(CADENA, llave));
  });

  it("un cambio de un solo carácter cambia el sello", () => {
    const llave = abrirLlave(key, CONTRASENA);
    expect(sellar(CADENA, llave)).not.toBe(sellar(CADENA.replace("1160", "1161"), llave));
  });

  /*
   * Los acentos tienen que producir los mismos bytes que verá el PAC al leer el
   * XML. Si se sellara en latin1, un "Café" bastaría para tumbar la factura.
   */
  it("sella en UTF-8, que es lo que leerá el PAC", () => {
    const llave = abrirLlave(key, CONTRASENA);
    const conAcento = "||4.0|Café de olla||";
    const certificado = new X509Certificate(Buffer.from(csd.certificado_base64, "base64"));

    expect(
      verify(
        "sha256",
        Buffer.from(conAcento, "utf8"),
        certificado.publicKey,
        Buffer.from(sellar(conAcento, llave), "base64"),
      ),
    ).toBe(true);
  });
});

// --- Revisión antes de facturar ----------------------------------------------------------

describe("revisar el CSD antes del servicio", () => {
  it("acepta el CSD del emisor que factura", () => {
    expect(problemaDelCsd(csd, RFC)).toBeNull();
  });

  it("rechaza un CSD de otro contribuyente y dice de quién es", () => {
    const problema = problemaDelCsd(csd, "BBB020202BB2");
    expect(problema).toContain(RFC);
    expect(problema).toContain("BBB020202BB2");
  });

  it("avisa cuando el CSD ya venció y hacia dónde ir", () => {
    const dentroDeDosAnios = new Date(Date.now() + 730 * 86_400_000);
    expect(problemaDelCsd(csd, RFC, dentroDeDosAnios)).toMatch(/venció.*SAT/s);
    expect(vigente(csd, dentroDeDosAnios)).toBe(false);
  });

  /*
   * Un CSD caduca a los cuatro años y, cuando caduca, la facturación se detiene
   * sin aviso. Aquí se prueba con uno realmente vencido, no adelantando el
   * reloj: es como llegará el día que alguien suba el CSD viejo por error.
   */
  it("un CSD ya vencido se detecta al leerlo, no al facturar", async () => {
    const viejo = await generarCsdDePrueba({ diasDeVigencia: -10 });
    const vencido = leerCertificado(viejo.cer);

    expect(vigente(vencido)).toBe(false);
    expect(diasDeVigencia(vencido)).toBeLessThan(0);
    expect(problemaDelCsd(vencido, RFC)).toMatch(/venció/);
  });

  it("cuenta los días que faltan para que venza", () => {
    const enUnMes = new Date(Date.now() + 30 * 86_400_000);
    expect(diasDeVigencia(csd, enUnMes)).toBeLessThan(diasDeVigencia(csd));
  });
});
