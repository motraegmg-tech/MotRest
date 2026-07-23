/**
 * El CSD: leer el certificado, abrir la llave y sellar la cadena original.
 *
 * QUÉ ES EL CSD
 *
 * El Certificado de Sello Digital que el SAT entrega al contribuyente. Son dos
 * archivos: un `.cer` con el certificado público y un `.key` con la llave
 * privada, cifrada con una contraseña. Con esa llave se firma la cadena original
 * de cada factura. Sin CSD no hay factura.
 *
 * POR QUÉ VIVE EN EL HUB Y NO EN EL POS
 *
 * Es una decisión de seguridad, no de comodidad. La llave privada del CSD ES la
 * firma fiscal del restaurante: quien la tenga puede emitir facturas a su
 * nombre. No puede viajar a cada tablet ni quedar en el almacenamiento de un
 * navegador. Vive en la caja, en un solo lugar, y ahí se sella.
 *
 * Además hay una razón técnica que cierra la puerta: el navegador no sabe abrir
 * el `.key` del SAT. WebCrypto no descifra PKCS#8 protegido con contraseña.
 *
 * POR QUÉ NO SE PARSEA EL CERTIFICADO A MANO
 *
 * Un `.cer` es X.509 en DER, y leerlo es recorrer ASN.1. Escribir ese recorrido
 * a mano es un error de un byte esperando a ocurrir, y cuando ocurre el PAC
 * responde "sello inválido" sin decir dónde. `X509Certificate` viene con Node y
 * lo hace bien. La única parte propia es la conversión del número de serie,
 * porque el SAT lo guarda de una forma peculiar (ver abajo).
 */
import {
  X509Certificate,
  constants,
  createPrivateKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { normalizarRfc, rfcValido } from "@motrest/dominio";

export interface Csd {
  /** `NoCertificado`: 20 dígitos. Va en la cadena original y en el XML. */
  no_certificado: string;
  /** `Certificado`: el `.cer` completo en base64, tal cual lo pide el XML. */
  certificado_base64: string;
  /** RFC del titular, para cotejar que el CSD sea del emisor que factura. */
  rfc: string | null;
  valido_desde: Date;
  valido_hasta: Date;
}

/**
 * El número de certificado del SAT, a partir del número de serie del X.509.
 *
 * Aquí hay una rareza que cuesta cara si se ignora. El estándar dice que el
 * número de serie es un entero; el SAT mete ahí los 20 dígitos en ASCII. Así
 * que el serial hexadecimal `3330303031...` no vale `0x3330...`: son los bytes
 * de los caracteres `"3","0","0","0","1"...`.
 *
 * Tomar el hexadecimal como número daría un `NoCertificado` que no existe, la
 * cadena original saldría distinta y NINGUNA factura se timbraría.
 */
export function numeroDeCertificado(serialHexadecimal: string): string {
  const limpio = serialHexadecimal.replace(/[^0-9a-fA-F]/g, "");
  const par = limpio.length % 2 === 0 ? limpio : `0${limpio}`;
  return Buffer.from(par, "hex").toString("latin1");
}

/**
 * El Anexo 20 define `NoCertificado` como exactamente 20 dígitos.
 *
 * Comprobarlo distingue un CSD de cualquier otro certificado. Sin esta
 * comprobación, subir un certificado que no es un CSD —una e.firma, el
 * certificado de un servidor— produce un número de serie con bytes arbitrarios
 * que se cuelan en la cadena original y dan un sello que nadie puede timbrar.
 * El fallo aparecería mucho después, en el PAC, como "sello inválido".
 */
export function esNumeroDeCertificadoDelSat(numero: string): boolean {
  return /^[0-9]{20}$/.test(numero);
}

/**
 * Busca el RFC dentro del sujeto del certificado.
 *
 * El SAT lo pone en `x500UniqueIdentifier`, pero la forma en que ese campo se
 * escribe como texto depende de la versión de OpenSSL, y en algunos CSD el RFC
 * aparece además en otros atributos. En vez de atarse a un nombre de campo que
 * puede cambiar, se recorren los valores y se toma el primero que sea un RFC
 * válido de verdad — lo que ya sabe decidir el dominio.
 */
function rfcDelSujeto(sujeto: string): string | null {
  for (const parte of sujeto.split(/[\n,/]/)) {
    const valor = parte.includes("=") ? parte.slice(parte.indexOf("=") + 1) : parte;
    const candidato = normalizarRfc(valor);
    if (rfcValido(candidato)) return candidato;
  }
  return null;
}

/** Lee el `.cer` (DER, tal como lo entrega el SAT). */
export function leerCertificado(cer: Uint8Array): Csd {
  let certificado: X509Certificate;
  try {
    certificado = new X509Certificate(Buffer.from(cer));
  } catch {
    throw new Error(
      "El archivo no es un certificado válido. Sube el .cer que te entregó el SAT, sin convertirlo.",
    );
  }

  const no_certificado = numeroDeCertificado(certificado.serialNumber);
  if (!esNumeroDeCertificadoDelSat(no_certificado)) {
    throw new Error(
      "Este certificado no es un CSD del SAT: su número de serie no tiene los 20 dígitos que exige el Anexo 20. " +
        "Revisa que no sea tu e.firma —esa no sirve para facturar— y sube el .cer del Certificado de Sello Digital.",
    );
  }

  return {
    no_certificado,
    certificado_base64: certificado.raw.toString("base64"),
    rfc: rfcDelSujeto(certificado.subject),
    valido_desde: new Date(certificado.validFrom),
    valido_hasta: new Date(certificado.validTo),
  };
}

/**
 * Abre el `.key` del SAT con su contraseña.
 *
 * El SAT lo entrega como PKCS#8 cifrado. Los emitidos hace años usan 3DES, que
 * OpenSSL 3 considera heredado; si algún día deja de abrirse, el mensaje tiene
 * que decir exactamente eso, porque desde fuera se ve idéntico a una contraseña
 * mal escrita y se pierde media tarde buscando por el lado equivocado.
 */
export function abrirLlave(key: Uint8Array, contrasena: string): KeyObject {
  try {
    return createPrivateKey({
      key: Buffer.from(key),
      format: "der",
      type: "pkcs8",
      passphrase: contrasena,
    });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);

    /*
     * El discriminante tiene que ser exacto. OpenSSL responde a una contraseña
     * equivocada con "Provider routines::bad decrypt", así que buscar la
     * palabra "provider" manda al usuario a convertir su llave cuando lo único
     * que pasó es que se equivocó de contraseña. Es el error de diagnóstico
     * que este mensaje existe para evitar, y hay una prueba que lo vigila.
     */
    if (/bad decrypt/i.test(detalle)) {
      throw new Error("La contraseña del CSD no es correcta.");
    }
    if (/unsupported|legacy|no such|decoder/i.test(detalle)) {
      throw new Error(
        "La llave usa un cifrado que esta versión ya no abre por omisión. " +
          "Conviértela con OpenSSL antes de subirla. Detalle: " +
          detalle,
      );
    }
    throw new Error(
      "No se pudo abrir la llave privada. Revisa la contraseña del CSD y que el archivo sea el .key del SAT.",
    );
  }
}

/**
 * ¿El `.cer` y el `.key` son pareja?
 *
 * Vale la pena comprobarlo al cargarlos, no al facturar. Subir el certificado
 * de un CSD con la llave de otro es un error frecuente —se acumulan renovaciones
 * en la misma carpeta— y el PAC lo reporta como "sello inválido", que no apunta
 * a nada. Aquí se firma un dato al azar y se verifica con la clave pública del
 * certificado: si no cuadra, no son pareja, y se sabe en el momento de cargarlos.
 */
export function sonPareja(csd: Csd, llave: KeyObject): boolean {
  const certificado = new X509Certificate(Buffer.from(csd.certificado_base64, "base64"));
  const prueba = randomBytes(32);
  try {
    return verify("sha256", prueba, certificado.publicKey, sign("sha256", prueba, llave));
  } catch {
    return false;
  }
}

/** ¿El CSD está vigente en esta fecha? */
export function vigente(csd: Csd, ahora: Date = new Date()): boolean {
  return ahora >= csd.valido_desde && ahora <= csd.valido_hasta;
}

/** Días que le quedan de vigencia. Negativo si ya venció. */
export function diasDeVigencia(csd: Csd, ahora: Date = new Date()): number {
  const DIA = 86_400_000;
  return Math.floor((csd.valido_hasta.getTime() - ahora.getTime()) / DIA);
}

/**
 * Sella la cadena original.
 *
 * RSA con SHA-256 y relleno PKCS#1 v1.5, en base64. Eso es lo que pide el
 * Anexo 20 y no admite variantes: PSS produciría una firma perfectamente válida
 * en criptografía y perfectamente rechazada por el PAC. Se declara explícito
 * para que nadie lo "modernice" sin saber lo que rompe.
 *
 * La cadena se codifica en UTF-8: los acentos de un nombre o una descripción
 * tienen que producir los mismos bytes que verá el PAC al leer el XML.
 */
export function sellar(cadena: string, llave: KeyObject): string {
  return sign("sha256", Buffer.from(cadena, "utf8"), {
    key: llave,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString("base64");
}

/**
 * Comprueba que el CSD sirva para facturar a nombre de este RFC.
 *
 * Devuelve el problema en palabras, o `null` si todo está bien. Un CSD ajeno o
 * vencido tiene arreglo antes del servicio; descubrirlo con el comensal
 * esperando su factura, no.
 */
export function problemaDelCsd(
  csd: Csd,
  rfcEmisor: string,
  ahora: Date = new Date(),
): string | null {
  if (ahora < csd.valido_desde) {
    return `Este CSD todavía no entra en vigor (empieza el ${csd.valido_desde.toLocaleDateString("es-MX")}).`;
  }
  if (ahora > csd.valido_hasta) {
    return `Este CSD venció el ${csd.valido_hasta.toLocaleDateString("es-MX")}. Tramita uno nuevo en el portal del SAT.`;
  }
  if (csd.rfc && csd.rfc !== normalizarRfc(rfcEmisor)) {
    return `El CSD es del RFC ${csd.rfc} y estás facturando como ${normalizarRfc(rfcEmisor)}.`;
  }
  return null;
}
