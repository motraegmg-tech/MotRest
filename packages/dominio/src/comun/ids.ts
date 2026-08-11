/**
 * Identificadores del sistema.
 *
 * UUIDv7: ordenable por tiempo (los primeros 48 bits son el timestamp), ideal
 * para el event log. Usa Web Crypto (`globalThis.crypto`), disponible tanto en
 * Node 20+ como en el navegador, para mantener el dominio isomórfico.
 */

/** Identificador de entidad (UUID o slug estable). */
export type ID = string;

function aHex(bytes: Uint8Array): string {
  let salida = "";
  for (let i = 0; i < bytes.length; i++) {
    salida += (bytes[i] ?? 0).toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) salida += "-";
  }
  return salida;
}

/** Genera un UUID versión 7 (ordenable por tiempo). */
export function uuidv7(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ts = Date.now();

  // 48 bits de timestamp en milisegundos, big-endian.
  b[0] = Math.floor(ts / 2 ** 40) & 0xff;
  b[1] = Math.floor(ts / 2 ** 32) & 0xff;
  b[2] = Math.floor(ts / 2 ** 24) & 0xff;
  b[3] = Math.floor(ts / 2 ** 16) & 0xff;
  b[4] = Math.floor(ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  // version 7 y variant RFC 4122.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  return aHex(b);
}

/**
 * Identificador corto para el catálogo: `prod-019fe3848c1f4a2b9c3d`.
 *
 * Conserva los 48 bits de tiempo del UUIDv7 —el id sigue ordenando por captura—
 * y le suma 32 bits de azar.
 *
 * NO se recorta el UUID a sus primeros 8 caracteres, como se hacía antes: esos
 * 8 son solo los 32 bits ALTOS del milisegundo, así que el id no cambiaba hasta
 * pasados 2^16 ms ≈ 65 s. Dar de alta dos platillos en el mismo minuto —lo
 * normal al capturar una carta— producía dos ids idénticos, y como el catálogo
 * se indexa en un Map por id, el segundo pisaba al primero: quedaba guardado en
 * el archivo pero desaparecía de la pantalla.
 */
export function idCorto(prefijo: string): ID {
  const hex = uuidv7().replaceAll("-", "");
  return `${prefijo}-${hex.slice(0, 12)}${hex.slice(-8)}`;
}

/** Como `idCorto`, pero garantizando que no choque con los ya emitidos. */
export function idCortoLibre(prefijo: string, usados: ReadonlySet<ID>): ID {
  let id = idCorto(prefijo);
  while (usados.has(id)) id = idCorto(prefijo);
  return id;
}
