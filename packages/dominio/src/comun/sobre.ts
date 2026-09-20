/**
 * Un sobre sellado: un secreto que solo puede abrir UN Hub.
 *
 * PARA QUÉ
 *
 * Central tiene que hacerle llegar a cada restaurante secretos que no son de
 * nadie más —la llave de FacturAPI de su organización, la contraseña de
 * aplicación de su Gmail— y el único camino entre los dos es la nube. La nube
 * es un cartero (igual que con las licencias): puede no entregar, pero no debe
 * poder LEER. Una base de datos con las llaves de facturación de toda la
 * cartera en claro sería el blanco más rentable de todo MOTRAE.
 *
 * CÓMO
 *
 * Cada Hub genera su par X25519 una sola vez y publica la parte pública en su
 * pulso. Central cierra el sobre con esa pública y un par efímero de un solo
 * uso: del acuerdo X25519 sale, por HKDF-SHA256, la llave AES-256-GCM que cifra
 * el contenido. Solo quien tiene la privada del Hub rehace ese acuerdo. Es el
 * esquema de «sobre sellado» de siempre, con piezas estándar de WebCrypto para
 * que funcione igual en el Hub (Node) y en la ventana de Central.
 *
 * En la derivación entran las DOS públicas —la efímera y la del destino—: así
 * un sobre no se puede reetiquetar para otro destinatario sin que falle la
 * autenticación.
 */

export interface Sobre {
  formato: "motrest-sobre-v1";
  algoritmo: "X25519+HKDF-SHA256+AES-256-GCM";
  /** Pública efímera del remitente: X25519 cruda (32 bytes), en base64. */
  efimera: string;
  /** Vector de inicialización de AES-GCM, en base64. */
  iv: string;
  /** Texto cifrado + etiqueta de autenticación, en base64. */
  contenido: string;
  creado_ts: number;
}

/** El par de un Hub. La privada NUNCA sale de su máquina. */
export interface ParDeSobre {
  /** X25519 cruda (32 bytes) en base64: lo que se publica en el pulso. */
  publica: string;
  /** PKCS#8 en base64. */
  privada: string;
}

const INFO = new TextEncoder().encode("motrest-sobre-v1");
const X25519 = { name: "X25519" } as const;

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

/**
 * ¿Este entorno sabe hacer X25519?
 *
 * Node 20+ sí. La ventana de Central corre en WebView2, que lo trae desde
 * Chromium 133; una instalación de Windows sin actualizar podría no tenerlo, y
 * en ese caso hay que decirlo en claro en vez de fallar a medio envío.
 */
export async function haySobres(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey(X25519, true, ["deriveBits"]);
    return true;
  } catch {
    return false;
  }
}

export async function generarParDeSobre(): Promise<ParDeSobre> {
  const par = (await crypto.subtle.generateKey(X25519, true, ["deriveBits"])) as CryptoKeyPair;
  const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const privada = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  return { publica: aBase64(publica), privada: aBase64(privada) };
}

/** Una pública X25519 bien formada: 32 bytes en base64. */
export function esPublicaDeSobre(valor: unknown): valor is string {
  if (typeof valor !== "string" || valor.length > 64) return false;
  try {
    return deBase64(valor).length === 32;
  } catch {
    return false;
  }
}

async function llaveDelAcuerdo(
  secreto: ArrayBuffer,
  efimera: Uint8Array,
  destino: Uint8Array,
  uso: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const sal = new Uint8Array(efimera.length + destino.length);
  sal.set(efimera, 0);
  sal.set(destino, efimera.length);

  const material = await crypto.subtle.importKey("raw", secreto, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: sal as BufferSource, info: INFO as BufferSource },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [uso],
  );
}

/** Cierra un texto para el Hub dueño de `publicaDestino`. */
export async function cerrarSobre(
  publicaDestino: string,
  texto: string,
  ahora = Date.now(),
): Promise<Sobre> {
  if (!esPublicaDeSobre(publicaDestino)) {
    throw new Error("La llave pública del restaurante no es válida: que su Hub mande un pulso nuevo");
  }
  const destino = deBase64(publicaDestino);
  const publicaDelHub = await crypto.subtle.importKey("raw", destino as BufferSource, X25519, false, []);

  const efimero = (await crypto.subtle.generateKey(X25519, true, ["deriveBits"])) as CryptoKeyPair;
  const efimera = new Uint8Array(await crypto.subtle.exportKey("raw", efimero.publicKey));
  const secreto = await crypto.subtle.deriveBits(
    { name: "X25519", public: publicaDelHub },
    efimero.privateKey,
    256,
  );

  const llave = await llaveDelAcuerdo(secreto, efimera, destino, "encrypt");
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: INFO as BufferSource },
    llave,
    new TextEncoder().encode(texto),
  );

  return {
    formato: "motrest-sobre-v1",
    algoritmo: "X25519+HKDF-SHA256+AES-256-GCM",
    efimera: aBase64(efimera),
    iv: aBase64(iv),
    contenido: aBase64(new Uint8Array(cifrado)),
    creado_ts: ahora,
  };
}

export function esSobre(valor: unknown): valor is Sobre {
  if (!valor || typeof valor !== "object") return false;
  const sobre = valor as Record<string, unknown>;
  return (
    sobre.formato === "motrest-sobre-v1" &&
    sobre.algoritmo === "X25519+HKDF-SHA256+AES-256-GCM" &&
    esPublicaDeSobre(sobre.efimera) &&
    typeof sobre.iv === "string" &&
    typeof sobre.contenido === "string" &&
    typeof sobre.creado_ts === "number"
  );
}

/**
 * Abre un sobre con el par del Hub. Devuelve `null` si no es para él.
 *
 * Como en el cofre, «no es para mí» y «lo alteraron» son el mismo fallo de
 * autenticación de AES-GCM, y la única respuesta honesta es no darlo por bueno.
 */
export async function abrirSobre(sobre: unknown, par: ParDeSobre): Promise<string | null> {
  if (!esSobre(sobre)) return null;
  try {
    const privada = await crypto.subtle.importKey(
      "pkcs8",
      deBase64(par.privada) as BufferSource,
      X25519,
      false,
      ["deriveBits"],
    );
    const efimera = deBase64(sobre.efimera);
    const publicaEfimera = await crypto.subtle.importKey(
      "raw",
      efimera as BufferSource,
      X25519,
      false,
      [],
    );
    const secreto = await crypto.subtle.deriveBits(
      { name: "X25519", public: publicaEfimera },
      privada,
      256,
    );
    const llave = await llaveDelAcuerdo(secreto, efimera, deBase64(par.publica), "decrypt");
    const claro = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: deBase64(sobre.iv) as BufferSource,
        additionalData: INFO as BufferSource,
      },
      llave,
      deBase64(sobre.contenido) as BufferSource,
    );
    return new TextDecoder().decode(claro);
  } catch {
    return null;
  }
}
