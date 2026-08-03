/**
 * Cifrado del canal entre las terminales y el Hub.
 *
 * POR QUÉ NO ES TLS (y por qué esto es lo correcto aquí)
 *
 * Un Hub vive en la red del restaurante, sin nombre de dominio. Un certificado
 * TLS de verdad necesita un dominio; uno autofirmado obliga a que cada terminal
 * pase a mano por la advertencia roja del navegador, y los navegadores cada vez
 * lo ponen más difícil. Pedirle eso a quien abre la caja un viernes es pedirle
 * que se acostumbre a saltarse advertencias de seguridad — justo el hábito que
 * no queremos crear.
 *
 * La alternativa es cifrar el contenido de los mensajes con una clave que el
 * Hub genera y que se entrega al emparejar. La clave ES la credencial: una
 * terminal que no la tiene no puede leer ni escribir nada, ni siquiera
 * presentarse. Funciona en cualquier navegador, sin advertencias.
 *
 * QUÉ PROTEGE
 *   - Que alguien conectado al wifi del local lea las ventas, los precios, los
 *     datos del personal o los importes de caja.
 *   - Que alguien inyecte comandas, pagos o cancelaciones falsas: sin la clave
 *     el Hub descarta el mensaje sin siquiera interpretarlo.
 *   - Que un mensaje se altere a medio camino: AES-GCM lo detecta.
 *
 * QUÉ NO PROTEGE — y conviene decirlo claro
 *   - No hay secreto hacia adelante: quien obtenga la clave del local y hubiera
 *     grabado el tráfico anterior podría leerlo. Rotar la clave corta eso hacia
 *     adelante, no hacia atrás.
 *   - La clave es compartida: una terminal emparejada podría hacerse pasar por
 *     otra. Quién hizo qué se sigue apoyando en el `empleado_id` del evento y
 *     en la revalidación de permisos del Hub, no en el cifrado.
 *   - El enlace de emparejamiento LLEVA la clave. Es una credencial: se manda
 *     por un canal de confianza y no se publica.
 *
 * Cuando llegue el empaquetado nativo (etapa 12) se puede añadir TLS con
 * certificado fijado por encima de esto, sin quitarlo: son capas distintas.
 */

/** Bytes de la clave del local. 32 = AES-256. */
const BYTES_CLAVE = 32;
/** AES-GCM exige 12 bytes de nonce. */
const BYTES_NONCE = 12;

export type RolCanal = "cliente" | "hub";

/** Las dos claves de un extremo: con cuál escribe y con cuál lee. */
export interface ClavesCanal {
  envio: CryptoKey;
  recepcion: CryptoKey;
}

// --- Codificación --------------------------------------------------------------------

/** base64url sin relleno: viaja limpio en una URL y en un QR. */
export function aBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64Url(texto: string): Uint8Array {
  const relleno = texto.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(relleno.padEnd(Math.ceil(relleno.length / 4) * 4, "="));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

/** Genera la clave del local. Se hace UNA vez, al instalar el Hub. */
export function generarClaveLocal(): string {
  const bytes = new Uint8Array(BYTES_CLAVE);
  crypto.getRandomValues(bytes);
  return aBase64Url(bytes);
}

/** ¿Tiene forma de clave del local? No prueba que sea la correcta. */
export function claveValida(clave: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(clave)) return false;
  try {
    return deBase64Url(clave).length === BYTES_CLAVE;
  } catch {
    return false;
  }
}

// --- Derivación ------------------------------------------------------------------------

/**
 * Deriva las claves de un extremo a partir del secreto del local.
 *
 * Cada sentido lleva su propia clave —una para cliente→hub y otra para
 * hub→cliente— para que un mensaje capturado en un sentido no pueda reenviarse
 * en el otro haciéndose pasar por el otro extremo.
 */
export async function derivarClaves(
  secreto: string,
  rol: RolCanal,
): Promise<ClavesCanal> {
  /*
   * La clave se valida ANTES de derivar.
   *
   * HKDF acepta cualquier cadena de bytes, así que una clave con un carácter de
   * más o de menos derivaría claves perfectamente válidas —solo que
   * equivocadas—. La terminal se conectaría y fallaría al descifrar todo, con
   * un síntoma difícil de rastrear. Es mejor negarse aquí y decir por qué.
   */
  if (!claveValida(secreto)) {
    throw new Error("La clave del local no tiene la forma esperada");
  }

  const material = await crypto.subtle.importKey(
    "raw",
    deBase64Url(secreto) as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const derivar = (etiqueta: string): Promise<CryptoKey> =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        // Sin sal: el secreto ya es aleatorio de 32 bytes, no una contraseña.
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(etiqueta),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

  const aHub = await derivar("motrest:sync:cliente->hub:v1");
  const aCliente = await derivar("motrest:sync:hub->cliente:v1");

  return rol === "cliente"
    ? { envio: aHub, recepcion: aCliente }
    : { envio: aCliente, recepcion: aHub };
}

/**
 * El secreto con que se firman los enlaces del portal del comensal.
 *
 * Se DERIVA de la clave del local con su propia etiqueta HKDF, en vez de usar
 * la clave tal cual. Son dos cosas con vidas distintas: la clave del local abre
 * la sincronización de todo el restaurante; este secreto solo sirve para firmar
 * "esta cuenta es la 42". Separarlos hace que, si algún día hay que rotar uno,
 * no haya que rotar el otro — y que un fallo en el portal no toque el canal.
 *
 * Lo derivan por igual el Hub y cada terminal, porque las dos tienen la clave
 * del local. Así el POS puede imprimir un ticket con su QR válido **aunque el
 * Hub esté apagado**, que es justo cuando más falta hace que nada se detenga.
 *
 * El comensal nunca recibe este secreto: solo el resultado de firmar con él.
 */
export async function derivarSecretoPortal(claveLocal: string): Promise<string> {
  if (!claveValida(claveLocal)) {
    throw new Error("La clave del local no tiene la forma esperada");
  }

  const material = await crypto.subtle.importKey(
    "raw",
    deBase64Url(claveLocal) as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("motrest:portal:enlace-de-cuenta:v1"),
    },
    material,
    256,
  );

  return aBase64Url(new Uint8Array(bits));
}

// --- Sobre cifrado -----------------------------------------------------------------------

/**
 * Sobre que viaja por el WebSocket.
 *
 * Va como JSON con el nonce y el texto cifrado aparte, en vez de una sola
 * cadena, para que un mensaje en claro de un cliente viejo se distinga a
 * simple vista de uno cifrado y se pueda rechazar con un mensaje útil.
 */
export interface SobreCifrado {
  /** Versión del cifrado, por si hay que cambiarlo sin romper el local. */
  ec: 1;
  /** Nonce en base64url. Distinto en cada mensaje, siempre. */
  n: string;
  /** Contenido cifrado en base64url. */
  c: string;
}

export function esSobreCifrado(valor: unknown): valor is SobreCifrado {
  if (typeof valor !== "object" || valor === null) return false;
  const s = valor as Record<string, unknown>;
  return s.ec === 1 && typeof s.n === "string" && typeof s.c === "string";
}

/**
 * Cifra un mensaje.
 *
 * El nonce es aleatorio y nuevo en cada mensaje: repetir uno con la misma clave
 * rompe AES-GCM por completo, así que nunca se deriva de un contador ni del
 * reloj.
 */
export async function cifrar(clave: CryptoKey, mensaje: unknown): Promise<string> {
  const nonce = new Uint8Array(BYTES_NONCE);
  crypto.getRandomValues(nonce);

  const claro = new TextEncoder().encode(JSON.stringify(mensaje));
  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    clave,
    claro as BufferSource,
  );

  const sobre: SobreCifrado = {
    ec: 1,
    n: aBase64Url(nonce),
    c: aBase64Url(new Uint8Array(cifrado)),
  };
  return JSON.stringify(sobre);
}

/**
 * Descifra un mensaje. Devuelve `null` si no se pudo.
 *
 * Nunca lanza ni distingue entre "clave equivocada", "mensaje alterado" y
 * "basura": todos son el mismo caso —no es de una terminal legítima— y
 * responder distinto a cada uno le diría a quien prueba por dónde va bien.
 */
export async function descifrar<T>(clave: CryptoKey, crudo: string): Promise<T | null> {
  try {
    const sobre: unknown = JSON.parse(crudo);
    if (!esSobreCifrado(sobre)) return null;

    const claro = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deBase64Url(sobre.n) as BufferSource },
      clave,
      deBase64Url(sobre.c) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(claro)) as T;
  } catch {
    return null;
  }
}
