/**
 * Certificado TLS del Hub.
 *
 * POR QUÉ HACE FALTA, si el canal ya va cifrado con la clave del local
 *
 * No es por el cifrado —ese ya está—, es porque el navegador lo exige para
 * habilitar su motor criptográfico. Sin HTTPS, `crypto.subtle` no existe, y sin
 * él una terminal no puede verificar contraseñas, ni cifrar el canal, ni sellar
 * el corte. Una tablet abierta como `http://192.168.1.50` se quedaba sin las
 * tres cosas, con el único síntoma de "no me deja entrar".
 *
 * El certificado es AUTOFIRMADO porque un equipo de la red del local no tiene
 * nombre de dominio y no hay autoridad que pueda emitirle uno. Cada terminal
 * acepta el aviso UNA vez, al emparejarse. Como el Hub sirve también el POS
 * desde el mismo puerto, esa aceptación cubre a la vez la aplicación y el canal
 * de sincronización: un solo aviso por terminal, no dos.
 *
 * El certificado se guarda y se reutiliza. Regenerarlo en cada arranque
 * obligaría a aceptarlo de nuevo cada mañana, y acostumbrar al personal a
 * aceptar avisos de seguridad es exactamente lo que no queremos.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import selfsigned from "selfsigned";

export interface CertificadoTls {
  cert: string;
  key: string;
  /** Huella SHA-256, para poder cotejar que es el mismo Hub de siempre. */
  huella: string;
  /** true = se acaba de crear. */
  nuevo: boolean;
}

/** Diez años: un restaurante no debería renovar certificados a mano. */
const DIAS_VIGENCIA = 3650;

/**
 * Carga el certificado del Hub, o lo crea la primera vez.
 *
 * `direcciones` son las IP del equipo en la red: van dentro del certificado
 * como nombres alternativos para que el navegador no se queje además por no
 * coincidir el nombre.
 */
export async function certificadoTls(
  carpeta: string,
  direcciones: readonly string[],
): Promise<CertificadoTls> {
  mkdirSync(carpeta, { recursive: true });
  const rutaCert = join(carpeta, "hub.crt");
  const rutaKey = join(carpeta, "hub.key");

  if (existsSync(rutaCert) && existsSync(rutaKey)) {
    const cert = readFileSync(rutaCert, "utf8");
    const key = readFileSync(rutaKey, "utf8");
    return { cert, key, huella: huellaDe(cert), nuevo: false };
  }

  // `type: 2` es un nombre DNS y `type: 7` una dirección IP, según el estándar
  // X.509. Se incluyen todas las IP del equipo para que el navegador no proteste
  // además por no coincidir el nombre.
  const alternativos: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...direcciones.map((ip) => ({ type: 7 as const, ip })),
  ];

  const desde = new Date();
  const hasta = new Date(desde.getTime() + DIAS_VIGENCIA * 24 * 60 * 60 * 1000);

  const generado = await selfsigned.generate(
    [{ name: "commonName", value: "MotRest Hub" }],
    {
      notBeforeDate: desde,
      notAfterDate: hasta,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: true },
        {
          name: "keyUsage",
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
        },
        { name: "subjectAltName", altNames: alternativos },
      ],
    },
  );

  writeFileSync(rutaCert, generado.cert, { mode: 0o600 });
  // La llave privada solo la puede leer quien corre el servicio.
  writeFileSync(rutaKey, generado.private, { mode: 0o600 });

  return {
    cert: generado.cert,
    key: generado.private,
    huella: huellaDe(generado.cert),
    nuevo: true,
  };
}

/** Huella legible del certificado, en grupos de cuatro para cotejarla a ojo. */
function huellaDe(cert: string): string {
  const cuerpo = cert
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(cuerpo, "base64");
  return createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
}

/** Carpeta donde viven los certificados, junto a la base de datos del Hub. */
export function carpetaCertificados(rutaBaseDatos: string): string {
  return join(dirname(rutaBaseDatos), "tls");
}
