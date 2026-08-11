/**
 * Firma asimétrica: lo que MOTRAE firma y los restaurantes solo verifican.
 *
 * ## Por qué existe este archivo
 *
 * Antes, licencias y actualizaciones se firmaban con **HMAC-SHA256**. HMAC es
 * simétrico: la llave que verifica **es** la llave que firma. Y esa llave se
 * instalaba en cada restaurante para que su Hub pudiera comprobar la firma.
 *
 * Consecuencia: cualquiera con lectura del entorno de **un solo** local —el
 * dueño, un técnico, malware, un disco de segunda mano— podía emitirse licencias
 * gratis y, mucho peor, **firmar una actualización que todos los demás Hubs
 * aceptarían como legítima**. Ejecución de código en toda la flota desde
 * cualquier cliente.
 *
 * El código incluso lo prometía al revés: *«ni siquiera hace falta confiar en
 * GitHub»*. El mecanismo protegía contra un GitHub comprometido, no contra un
 * cliente comprometido — y los clientes son N y crecen; GitHub es 1.
 *
 * ## Ed25519, y por qué
 *
 * - **Firmar y verificar dejan de ser la misma capacidad.** La privada no sale
 *   nunca de MotRest Central; en los Hubs va solo la pública, y da igual que se
 *   filtre porque no permite firmar nada.
 * - **La pública son 44 bytes** en formato SPKI (ECDSA P-256 son 91). Cabe en un
 *   renglón, se pega sin errores y se puede incrustar en el binario.
 * - **`subtle.verify` ya compara en tiempo constante**, así que desaparece la
 *   comparación manual carácter a carácter que había antes.
 * - **Nativo en Node 20+ y en WebCrypto.** Cero dependencias nuevas.
 */

/** Un par recién generado. Ambas partes en base64, listas para guardar. */
export interface ParDeLlaves {
  /** Va en los Hubs. No es secreta. */
  publica: string;
  /** No sale nunca de MotRest Central. */
  privada: string;
}

const ALGORITMO = "Ed25519";

function aBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function deBase64(texto: string): ArrayBuffer {
  const binario = atob(texto.trim());
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

/**
 * ¿Este entorno puede firmar con Ed25519?
 *
 * Se comprueba de verdad —generando un par— en vez de mirar versiones. MOTRAE
 * Central corre en una webview, y una webview vieja sin Ed25519 fallaría al
 * pulsar «firmar», con el usuario delante y sin explicación. Mejor decírselo al
 * abrir.
 */
export async function hayFirmaAsimetrica(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey(ALGORITMO, true, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

/** Genera un par nuevo. Solo MotRest Central hace esto. */
export async function generarPar(): Promise<ParDeLlaves> {
  const par = (await crypto.subtle.generateKey(ALGORITMO, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  return {
    publica: aBase64(await crypto.subtle.exportKey("spki", par.publicKey)),
    privada: aBase64(await crypto.subtle.exportKey("pkcs8", par.privateKey)),
  };
}

/**
 * La pública que corresponde a una privada.
 *
 * Hace falta en dos sitios: para que el CLI pueda verificar lo que acaba de
 * emitir —comprobación que existe para atrapar una llave pegada con un salto de
 * línea— y para que Central pueda volver a enseñar la pública sin guardarla
 * aparte.
 *
 * Se deriva del JWK: la privada de Ed25519 lleva dentro tanto `d` (el secreto)
 * como `x` (el punto público).
 */
export async function publicaDe(privadaB64: string): Promise<string> {
  const privada = await crypto.subtle.importKey(
    "pkcs8",
    deBase64(privadaB64),
    ALGORITMO,
    true,
    ["sign"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", privada);

  const publica = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, ext: true },
    ALGORITMO,
    true,
    ["verify"],
  );
  return aBase64(await crypto.subtle.exportKey("spki", publica));
}

/** Firma un contenido. Devuelve la firma en hexadecimal (128 caracteres). */
export async function firmar(privadaB64: string, contenido: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    "pkcs8",
    deBase64(privadaB64),
    ALGORITMO,
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign(ALGORITMO, llave, new TextEncoder().encode(contenido)),
  );
  return [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ¿Esta firma la hizo quien tiene la privada de este par?
 *
 * Devuelve `false` ante cualquier problema —llave malformada, firma que no es
 * hexadecimal, entorno sin Ed25519— en vez de lanzar. Quien llama solo necesita
 * saber si puede confiar, y una excepción a mitad del arranque de un Hub sería
 * peor que un `false`.
 */
export async function verificar(
  publicaB64: string,
  contenido: string,
  firmaHex: string,
): Promise<boolean> {
  try {
    const limpia = firmaHex.trim().toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(limpia)) return false;

    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) bytes[i] = parseInt(limpia.slice(i * 2, i * 2 + 2), 16);

    const llave = await crypto.subtle.importKey(
      "spki",
      deBase64(publicaB64),
      ALGORITMO,
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      ALGORITMO,
      llave,
      bytes,
      new TextEncoder().encode(contenido),
    );
  } catch {
    return false;
  }
}

/**
 * Serialización canónica: el texto que se firma.
 *
 * ## Por qué esto y no una lista de campos a mano
 *
 * Antes, cada tipo firmaba `[campo1, campo2, …].join("|")`. Tres problemas, y
 * los tres estaban vivos:
 *
 *   1. **Cualquier campo nuevo quedaba fuera de la firma en silencio.** Es lo
 *      que pasó con `notas` del manifiesto de actualización: el único texto que
 *      el restaurantero lee para decidir si instala, y se podía reescribir sin
 *      invalidar la firma.
 *   2. **`join("|")` sin escape permite colisiones.** Un `nombre` que contenga
 *      `|` puede producir la misma cadena firmable que otro objeto distinto.
 *   3. **Ausente y vacío daban lo mismo.** Una licencia sin `soporte` y otra con
 *      `soporte` vacío generaban idéntica cadena.
 *
 * Con el objeto entero serializado y las claves ordenadas, los tres desaparecen
 * y **ningún campo futuro puede quedarse fuera por olvido**.
 */
export function contenidoCanonico(objeto: unknown): string {
  return JSON.stringify(ordenar(objeto));
}

/**
 * El contenido firmable de un objeto que puede traer ya una firma.
 *
 * **Quita `firma` siempre**, aunque el tipo diga que no está. Sin esto, volver a
 * firmar algo ya firmado incluiría la firma vieja dentro del texto nuevo, y el
 * resultado no verificaría nunca — un fallo silencioso que solo aparece en el
 * restaurante, con el archivo ya pegado.
 *
 * Lo atrapó una prueba: el ayudante de test construía el objeto con
 * `firma: "sin-firmar"` y lo pasaba entero, que es exactamente lo que hará
 * cualquiera al reemitir una licencia.
 */
export function contenidoFirmableDe<T extends object>(objeto: T): string {
  const { firma: _firma, ...resto } = objeto as T & { firma?: unknown };
  return contenidoCanonico(resto);
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor === null || typeof valor !== "object") return valor;

  const entradas = Object.entries(valor as Record<string, unknown>)
    /*
     * `undefined` se descarta, igual que haría `JSON.stringify`. Así una
     * propiedad puesta a `undefined` y otra ausente firman igual — que es lo
     * correcto, porque al viajar como JSON las dos llegan ausentes.
     */
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return Object.fromEntries(entradas.map(([clave, v]) => [clave, ordenar(v)]));
}
