/**
 * Un cofre cifrado con contraseña, para sacar secretos de una máquina.
 *
 * POR QUÉ HACE FALTA, Y NO BASTA CON DPAPI
 *
 * Las privadas Ed25519 de MOTRAE viven protegidas por DPAPI, que las ata al
 * perfil de Windows de Gonzalo. Eso es exactamente lo que se quiere mientras la
 * máquina existe: copiar el archivo a otra cuenta no sirve de nada.
 *
 * Y es también el problema. Un respaldo DPAPI **solo se puede restaurar en ese
 * mismo perfil de esa misma máquina**. Si el equipo se pierde, se quema o
 * Windows se reinstala, el respaldo no abre en ningún sitio, y con él se pierde
 * la llave con la que se firman las licencias y las actualizaciones de todos los
 * restaurantes. No hay forma de regenerarla: habría que reinstalar cada local a
 * mano con un Hub nuevo compilado con otra pública.
 *
 * Este cofre es la salida: cifra lo mismo con una contraseña que Gonzalo se
 * sabe, de modo que el archivo se pueda guardar fuera de la máquina y abrir en
 * otra. Es a propósito un formato aburrido y estándar —PBKDF2-SHA256 y
 * AES-256-GCM, ambos de WebCrypto— para que dentro de cinco años se pueda abrir
 * con cualquier cosa aunque MotRest ya no exista.
 *
 * LA CONTRASEÑA ES LA LLAVE. Quien tenga el archivo y la contraseña puede firmar
 * en nombre de MOTRAE. Se guardan en sitios distintos o no se ha guardado nada.
 */

/** Iteraciones del derivado. Las mismas que una contraseña de acceso (ADR-11). */
export const ITERACIONES_COFRE = 600_000;

/** Lo mínimo que se acepta. Esto abre la firma de todo el producto. */
export const MINIMO_CONTRASENA_COFRE = 16;

export interface Cofre {
  formato: "motrest-cofre-v1";
  algoritmo: "PBKDF2-SHA256+AES-256-GCM";
  iteraciones: number;
  /** Sal del derivado, en base64. */
  sal: string;
  /** Vector de inicialización de AES-GCM, en base64. */
  iv: string;
  /** Texto cifrado + etiqueta de autenticación, en base64. */
  contenido: string;
  /** Cuándo se cerró. Sirve para saber si un respaldo está viejo. */
  creado_ts: number;
}

function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

async function llaveDe(contrasena: string, sal: Uint8Array, iteraciones: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(contrasena),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal as BufferSource, iterations: iteraciones, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Cierra un texto en un cofre. La contraseña no se guarda en ninguna parte. */
export async function cerrarCofre(
  contenido: string,
  contrasena: string,
  ahora = Date.now(),
): Promise<Cofre> {
  if (contrasena.length < MINIMO_CONTRASENA_COFRE) {
    throw new Error(
      `La contraseña del respaldo necesita al menos ${MINIMO_CONTRASENA_COFRE} caracteres: abre la firma de todos los restaurantes`,
    );
  }

  const sal = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(sal);
  crypto.getRandomValues(iv);

  const llave = await llaveDe(contrasena, sal, ITERACIONES_COFRE);
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    llave,
    new TextEncoder().encode(contenido),
  );

  return {
    formato: "motrest-cofre-v1",
    algoritmo: "PBKDF2-SHA256+AES-256-GCM",
    iteraciones: ITERACIONES_COFRE,
    sal: aBase64(sal),
    iv: aBase64(iv),
    contenido: aBase64(new Uint8Array(cifrado)),
    creado_ts: ahora,
  };
}

export function esCofre(valor: unknown): valor is Cofre {
  if (!valor || typeof valor !== "object") return false;
  const cofre = valor as Record<string, unknown>;
  return (
    cofre.formato === "motrest-cofre-v1" &&
    cofre.algoritmo === "PBKDF2-SHA256+AES-256-GCM" &&
    typeof cofre.iteraciones === "number" &&
    Number.isInteger(cofre.iteraciones) &&
    cofre.iteraciones > 0 &&
    typeof cofre.sal === "string" &&
    typeof cofre.iv === "string" &&
    typeof cofre.contenido === "string" &&
    typeof cofre.creado_ts === "number"
  );
}

/**
 * Abre un cofre. Devuelve `null` si la contraseña no es la suya.
 *
 * No distingue «contraseña mala» de «archivo alterado», y no es pereza: en
 * AES-GCM son el mismo fallo de autenticación, y la única respuesta honesta es
 * que ese contenido no se puede dar por bueno.
 */
export async function abrirCofre(cofre: unknown, contrasena: string): Promise<string | null> {
  if (!esCofre(cofre)) return null;
  try {
    const llave = await llaveDe(contrasena, deBase64(cofre.sal), cofre.iteraciones);
    const claro = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deBase64(cofre.iv) as BufferSource },
      llave,
      deBase64(cofre.contenido) as BufferSource,
    );
    return new TextDecoder().decode(claro);
  } catch {
    return null;
  }
}
