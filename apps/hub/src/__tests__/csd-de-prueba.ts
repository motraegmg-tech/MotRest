/**
 * Fabrica CSD de prueba con la misma forma que los del SAT.
 *
 * No hay ni habrá un CSD real en el repositorio: es la firma fiscal de un
 * contribuyente. Pero un certificado cualquiera tampoco sirve para probar,
 * porque el SAT tiene una peculiaridad que hay que reproducir: mete los 20
 * dígitos del `NoCertificado` en ASCII dentro del número de serie, donde el
 * estándar espera un entero. Un certificado con serial aleatorio no ejercita
 * ese camino — y ese camino es justo el que rompe todas las facturas si se
 * equivoca.
 *
 * También permite fijar la vigencia, para poder probar el CSD vencido sin
 * esperar cuatro años.
 */
import * as x509 from "@peculiar/x509";
import { createPrivateKey, webcrypto, X509Certificate } from "node:crypto";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALGORITMO = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;

const DIA = 86_400_000;

export interface CsdDePrueba {
  cer: Uint8Array;
  key: Uint8Array;
  no_certificado: string;
  rfc: string;
  contrasena: string;
}

export interface OpcionesCsd {
  rfc?: string;
  no_certificado?: string;
  contrasena?: string;
  /** Días de vigencia desde hoy. Negativo para un CSD ya vencido. */
  diasDeVigencia?: number;
}

export async function generarCsdDePrueba(opciones: OpcionesCsd = {}): Promise<CsdDePrueba> {
  const {
    rfc = "AAA010101AAA",
    no_certificado = "30001000000500003416",
    contrasena = "12345678a",
    diasDeVigencia = 365,
  } = opciones;

  const par = await webcrypto.subtle.generateKey(ALGORITMO, true, ["sign", "verify"]);

  const vencido = diasDeVigencia < 0;
  const certificado = await x509.X509CertificateGenerator.createSelfSigned({
    // La peculiaridad del SAT: los 20 dígitos como bytes ASCII.
    serialNumber: Buffer.from(no_certificado, "latin1").toString("hex"),
    // 2.5.4.45 es `x500UniqueIdentifier`, donde el SAT pone el RFC.
    name: `CN=RESTAURANTE DE PRUEBA, 2.5.4.45=${rfc}`,
    notBefore: new Date(Date.now() - (vencido ? -diasDeVigencia + 1 : 1) * DIA),
    notAfter: new Date(Date.now() + diasDeVigencia * DIA),
    keys: par,
    signingAlgorithm: ALGORITMO,
  });

  const privadaPkcs8 = await webcrypto.subtle.exportKey("pkcs8", par.privateKey);

  return {
    cer: new X509Certificate(Buffer.from(certificado.rawData)).raw,
    // El SAT entrega la llave cifrada. 3DES es lo que traen los CSD de años atrás.
    key: createPrivateKey({
      key: Buffer.from(privadaPkcs8),
      format: "der",
      type: "pkcs8",
    }).export({
      type: "pkcs8",
      format: "der",
      cipher: "des-ede3-cbc",
      passphrase: contrasena,
    }),
    no_certificado,
    rfc,
    contrasena,
  };
}
