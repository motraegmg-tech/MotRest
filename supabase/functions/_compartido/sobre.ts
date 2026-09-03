/**
 * El sobre cifrado con el que se guardan los tokens de Meta.
 *
 * POR QUÉ SIGUE EXISTIENDO AL MUDARSE A SUPABASE
 *
 * ADR-27 rechazó poner el padrón en la base de datos de nadie más. Esto es lo
 * que conserva esa propiedad: dentro de `sucursales.wa_token_cifrado` hay texto
 * cifrado por MOTRAE, y la llave vive únicamente en el entorno de las Edge
 * Functions (`MOTREST_LLAVE_PADRON`). Supabase guarda un sobre que no puede
 * abrir, igual que el volumen de Fly guardaba un archivo que no podía leer.
 *
 * Quien se lleve un volcado de la base de datos —un respaldo, un disco devuelto
 * al proveedor, una consulta distraída— se lleva sobres, no los tokens con los
 * que se manda WhatsApp en nombre de cincuenta restaurantes.
 *
 * Portado de apps/relay/src/sobre.ts a Web Crypto, que es lo que hay en Deno.
 * El formato del sobre es EL MISMO, así que un padrón exportado del relay se
 * puede leer aquí con la misma llave.
 */

/** El sobre cifrado tal y como queda guardado. */
export interface SobreCifrado {
  v: 1;
  iv: string;
  tag: string;
  datos: string;
}

const b64 = {
  aBytes: (texto: string): Uint8Array =>
    Uint8Array.from(atob(texto), (c) => c.charCodeAt(0)),
  deBytes: (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)),
};

/**
 * Convierte lo que venga en `MOTREST_LLAVE_PADRON` en una llave de 32 bytes.
 *
 * Se exigen 32 bytes exactos en base64 y **no** se acepta una frase corta
 * derivada al vuelo: una llave débil aquí no da ningún error visible, cifra
 * igual, y solo se descubre el día que alguien la rompe.
 */
export async function llaveDelPadron(valor: string | undefined): Promise<CryptoKey> {
  const bytes = valor ? b64.aBytes(valor) : new Uint8Array();
  if (bytes.length !== 32) {
    throw new Error(
      "MOTREST_LLAVE_PADRON debe ser 32 bytes en base64. " +
        'Genera una con: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifrar(texto: string, llave: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sellado = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, llave, new TextEncoder().encode(texto)),
  );

  /*
   * Web Crypto devuelve el tag pegado al final; Node lo entrega aparte. Se
   * separan aquí para que el sobre tenga la MISMA forma que el del relay: si
   * algún día hay que leer un padrón exportado de Fly, se lee sin traducir nada.
   */
  const corte = sellado.length - 16;
  const sobre: SobreCifrado = {
    v: 1,
    iv: b64.deBytes(iv),
    tag: b64.deBytes(sellado.slice(corte)),
    datos: b64.deBytes(sellado.slice(0, corte)),
  };
  return JSON.stringify(sobre);
}

export async function descifrar(crudo: string, llave: CryptoKey): Promise<string> {
  const sobre = JSON.parse(crudo) as SobreCifrado;
  const datos = b64.aBytes(sobre.datos);
  const tag = b64.aBytes(sobre.tag);

  const sellado = new Uint8Array(datos.length + tag.length);
  sellado.set(datos);
  sellado.set(tag, datos.length);

  const abierto = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64.aBytes(sobre.iv) },
    llave,
    sellado,
  );
  return new TextDecoder().decode(abierto);
}
