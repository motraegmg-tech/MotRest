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
  nombreRed?: string,
): Promise<CertificadoTls> {
  mkdirSync(carpeta, { recursive: true });
  const rutaCert = join(carpeta, "hub.crt");
  const rutaKey = join(carpeta, "hub.key");
  const rutaCubre = join(carpeta, "hub.cubre.json");

  /*
   * Qué nombres y direcciones tiene que cubrir el certificado hoy.
   *
   * Se guarda junto a él y se compara al arrancar, porque las dos cosas
   * cambian: el router puede reasignar la IP del equipo, y el nombre de red se
   * puede configurar. Un certificado que no cubre la dirección por la que se
   * abre da un aviso ADICIONAL al de la autoridad, y entonces el personal se
   * acostumbra a saltarse dos.
   */
  const cubre = [...(nombreRed ? [nombreRed] : []), ...direcciones].sort();

  if (existsSync(rutaCert) && existsSync(rutaKey)) {
    const previo = leerCubre(rutaCubre);
    const sigueSirviendo = cubre.every((d) => previo.includes(d));

    if (sigueSirviendo) {
      const cert = readFileSync(rutaCert, "utf8");
      const key = readFileSync(rutaKey, "utf8");
      return { cert, key, huella: huellaDe(cert), nuevo: false };
    }
    // Si no cubre lo de hoy se regenera. Cada terminal tendrá que aceptar el
    // nuevo una vez; es preferible a que vean un aviso extra cada día.
  }

  // `type: 2` es un nombre DNS y `type: 7` una dirección IP, según el estándar
  // X.509. Se incluyen todas las IP del equipo para que el navegador no proteste
  // además por no coincidir el nombre.
  const alternativos: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: "localhost" },
    // El nombre de red va dentro: si no, abrir por `motrest.local` daría un
    // aviso extra por no coincidir el nombre, además del de la autoridad.
    ...(nombreRed ? [{ type: 2 as const, value: nombreRed }] : []),
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
  writeFileSync(rutaCubre, JSON.stringify(cubre), { mode: 0o600 });

  return {
    cert: generado.cert,
    key: generado.private,
    huella: huellaDe(generado.cert),
    nuevo: true,
  };
}

/** Lo que cubría el certificado guardado. Vacío si no se sabe. */
function leerCubre(ruta: string): string[] {
  if (!existsSync(ruta)) return [];
  try {
    const dato: unknown = JSON.parse(readFileSync(ruta, "utf8"));
    return Array.isArray(dato) ? (dato as string[]) : [];
  } catch {
    // Archivo corrupto: se trata como si no cubriera nada y se regenera.
    return [];
  }
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
