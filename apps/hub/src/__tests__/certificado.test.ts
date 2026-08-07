/**
 * El certificado TLS del Hub.
 *
 * Lo que se prueba aquí no es que "se genere": es que **no sea una autoridad
 * certificadora** y que **se renueve solo**. Las dos cosas van juntas y por eso
 * están en el mismo archivo.
 *
 * El certificado se generaba con `cA: true` y `keyCertSign`, es decir con
 * permiso para firmar otros certificados, y con diez años de vigencia. Cada
 * terminal del restaurante lo acepta una vez al emparejarse, y en algunos
 * sistemas aceptarlo significa confiar en él COMO AUTORIDAD: quien copiara la
 * llave privada del Hub —que vive en el disco de una computadora de restaurante,
 * detrás de la barra— podría emitir certificados válidos para cualquier sitio, y
 * esa tablet se los creería. Durante diez años, sin forma de revocarlo.
 *
 * Bajar la vigencia a trece meses sin renovación automática habría sido peor que
 * el problema: un certificado caducado no se puede aceptar ni pulsando
 * «continuar», así que el local entero se quedaría sin poder abrir el POS.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { certificadoTls } from "../certificado.js";

let carpeta: string;
const DIA_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "motrest-tls-"));
});
afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

function leer(cert: string): X509Certificate {
  return new X509Certificate(cert);
}

/** `serverAuth`: el único uso extendido que este certificado debería tener. */
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

/**
 * Los bits de la extensión KeyUsage, leídos del DER.
 *
 * Node no expone esta extensión —`x509.keyUsage` devuelve el uso EXTENDIDO, que
 * es otra cosa—, así que se busca a mano. Es fea, pero es la única forma de
 * comprobar el bit que importa: `keyCertSign`, el que convierte a este
 * certificado en algo capaz de firmar otros.
 *
 * OID 2.5.29.15 en DER es `06 03 55 1D 0F`. Detrás va un BOOLEAN opcional
 * (crítico), luego un OCTET STRING que envuelve un BIT STRING.
 */
function bitsDeKeyUsage(cert: string): number {
  const der = Buffer.from(cert.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  const oid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0f]);

  let i = der.indexOf(oid);
  if (i < 0) return 0;
  i += oid.length;
  if (der[i] === 0x01) i += 3; // BOOLEAN "crítico"
  if (der[i] !== 0x04) return 0; // OCTET STRING
  i += 2;
  if (der[i] !== 0x03) return 0; // BIT STRING
  return der[i + 3] ?? 0; // 03 <largo> <bits sin usar> <primer byte>
}

const KEY_CERT_SIGN = 0x04;
const FIRMA_DIGITAL = 0x80;

describe("qué clase de certificado es", () => {
  it("NO es una autoridad certificadora", async () => {
    const { cert } = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const x509 = leer(cert);

    // `ca` es lo que decide si una tablet que lo acepta empieza a creerse
    // certificados firmados por él.
    expect(x509.ca).toBe(false);
  });

  it("solo sirve para identificar a este servidor", async () => {
    const { cert } = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");

    expect(leer(cert).keyUsage).toEqual([SERVER_AUTH]);
  });

  /**
   * `cA: false` y `keyCertSign` son dos candados distintos, y este es el que de
   * verdad impide firmar. Un certificado sin él no puede emitir otros aunque un
   * cliente descuidado ignore las restricciones básicas.
   */
  it("no puede firmar otros certificados", async () => {
    const { cert } = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const bits = bitsDeKeyUsage(cert);

    expect(bits & KEY_CERT_SIGN).toBe(0);
    // Y lo que sí necesita para servir TLS sigue estando.
    expect(bits & FIRMA_DIGITAL).toBe(FIRMA_DIGITAL);
  });

  it("cubre el nombre de red y las direcciones del equipo", async () => {
    const { cert } = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const alt = leer(cert).subjectAltName ?? "";

    expect(alt).toContain("localhost");
    expect(alt).toContain("rodizio");
    expect(alt).toContain("192.168.1.50");
    expect(alt).toContain("127.0.0.1");
  });

  /** 397 días es el tope que aceptan Chrome y Safari desde 2020. */
  it("no dura más de lo que los navegadores admiten", async () => {
    const { cert } = await certificadoTls(carpeta, ["192.168.1.50"]);
    const x509 = leer(cert);
    const dias = (Date.parse(x509.validTo) - Date.parse(x509.validFrom)) / DIA_MS;

    expect(dias).toBeLessThanOrEqual(398);
    expect(dias).toBeGreaterThan(300);
  });
});

describe("la renovación", () => {
  it("el mismo día se reutiliza, no se regenera", async () => {
    const primero = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const segundo = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");

    expect(primero.nuevo).toBe(true);
    // Regenerarlo cada arranque obligaría a aceptarlo de nuevo cada mañana, y
    // acostumbrar al personal a aceptar avisos de seguridad es el verdadero
    // riesgo de fondo.
    expect(segundo.nuevo).toBe(false);
    expect(segundo.huella).toBe(primero.huella);
  });

  /**
   * LA PRUEBA QUE IMPORTA. Sin esto, el arreglo de la vigencia deja al
   * restaurante sin poder abrir el POS a los trece meses, y sin manera de
   * saltárselo desde el navegador.
   */
  it("se renueva sola antes de caducar", async () => {
    const primero = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");

    // Trece meses menos una semana: dentro de la ventana de renovación.
    const casiVencido = new Date(Date.now() + 390 * DIA_MS);
    const segundo = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio", casiVencido);

    expect(segundo.nuevo).toBe(true);
    expect(segundo.huella).not.toBe(primero.huella);
  });

  it("a mitad de vigencia todavía no se toca", async () => {
    const primero = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const aMitad = new Date(Date.now() + 200 * DIA_MS);
    const segundo = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio", aMitad);

    expect(segundo.nuevo).toBe(false);
    expect(segundo.huella).toBe(primero.huella);
  });

  it("si cambia la IP del equipo se regenera aunque no toque renovar", async () => {
    const primero = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const segundo = await certificadoTls(carpeta, ["192.168.1.77"], "rodizio");

    expect(segundo.nuevo).toBe(true);
    expect(leer(segundo.cert).subjectAltName).toContain("192.168.1.77");
  });

  /**
   * Hay Hubs con el archivo en el formato viejo —un array pelado, sin fecha—.
   * No pueden quedarse sin poder arrancar por eso.
   */
  it("acepta el archivo de la versión anterior", async () => {
    await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");
    const antes = readFileSync(join(carpeta, "hub.crt"), "utf8");

    writeFileSync(join(carpeta, "hub.cubre.json"), JSON.stringify(["192.168.1.50", "rodizio"]));
    const despues = await certificadoTls(carpeta, ["192.168.1.50"], "rodizio");

    expect(despues.nuevo).toBe(false);
    expect(despues.cert).toBe(antes);
  });
});
