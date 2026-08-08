/**
 * El sobre cifrado con el que el relay escribe en disco.
 *
 * Vive aparte porque ya lo usan dos cosas —el padrón y los pulsos— y las dos
 * guardan algo que no debería viajar en claro en un respaldo, un disco devuelto
 * al proveedor o un `docker cp` distraído. La llave va en el entorno
 * (`MOTREST_RELAY_LLAVE_PADRON`), nunca junto al archivo.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** El sobre cifrado tal y como queda en disco. */
export interface SobreCifrado {
  v: 1;
  iv: string;
  tag: string;
  datos: string;
}

/**
 * Convierte lo que venga en `MOTREST_RELAY_LLAVE_PADRON` en 32 bytes.
 *
 * Se exige base64 de 32 bytes exactos y **no** se acepta una frase corta
 * derivada al vuelo: una llave débil aquí no da ningún error visible, cifra
 * igual, y solo se descubre el día que alguien la rompe.
 */
export function llaveDelPadron(valor: string | undefined): Buffer {
  const llave = Buffer.from(valor ?? "", "base64");
  if (llave.length !== 32) {
    throw new Error(
      "MOTREST_RELAY_LLAVE_PADRON debe ser 32 bytes en base64. " +
        "Genera una con: pnpm --filter @motrest/relay padron llave",
    );
  }
  return llave;
}

export function cifrar(texto: string, llave: Buffer): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", llave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const sobre: SobreCifrado = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    datos: datos.toString("base64"),
  };
  return JSON.stringify(sobre);
}

export function descifrar(sobre: SobreCifrado, llave: Buffer): string {
  const descifrador = createDecipheriv("aes-256-gcm", llave, Buffer.from(sobre.iv, "base64"));
  descifrador.setAuthTag(Buffer.from(sobre.tag, "base64"));
  return Buffer.concat([
    descifrador.update(Buffer.from(sobre.datos, "base64")),
    descifrador.final(),
  ]).toString("utf8");
}
