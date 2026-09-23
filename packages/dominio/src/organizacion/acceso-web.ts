/**
 * MotRest en la web (1.6.0): cómo entra un restaurante desde un navegador.
 *
 * POR QUÉ EXISTE. Sin cuenta de Apple no hay app para iPad ni iPhone, y los
 * dueños quieren ver su restaurante desde fuera. Gonzalo decidió (23-sep-2026)
 * publicar el mismo POS en la web, con un candado previo POR RESTAURANTE —«Entra
 * a tu restaurante»: clave + contraseña— antes del «¿Quién eres?» de siempre.
 *
 * TRES MODALIDADES, que se eligen en Central y viajan firmadas en la licencia:
 *
 * - **app**: como siempre. Hub en la caja y ningún acceso por internet. Es lo
 *   que tiene toda licencia emitida antes de la 1.6.0 (no lleva bloque `web`).
 * - **ambas**: los datos siguen viviendo en el Hub del local. La web llega a él
 *   por un túnel cifrado a través de Supabase Realtime, mientras esté conectado.
 * - **nube**: no hay computadora en el local. Los datos viven en Supabase,
 *   **cifrados** con una llave que Supabase no tiene.
 *
 * LA CLAVE DE LA RED LOCAL NUNCA SALE A LA WEB. La web usa otra, la `clave
 * remota`, que genera Central. Así una contraseña web filtrada no abre la
 * sincronización del salón, y cambiarla no obliga a volver a emparejar ninguna
 * tablet. La clave remota se guarda en la nube ENVUELTA con la contraseña del
 * restaurante (un cofre: PBKDF2 + AES-GCM); solo quien la teclea la desenvuelve.
 */
import { abrirCofre, cerrarCofre, type Cofre } from "../comun/cofre.js";
import type { ID } from "../comun/ids.js";

/** Cómo vive un restaurante. `app` es la de siempre. */
export type ModalidadLocal = "app" | "ambas" | "nube";

/** Las dos que abren acceso por internet. */
export type ModalidadWeb = Exclude<ModalidadLocal, "app">;

export const MODALIDADES_LOCAL: readonly ModalidadLocal[] = ["app", "ambas", "nube"];

/**
 * El bloque `web` de la licencia.
 *
 * NO LLEVA SECRETOS, a propósito: la licencia se reparte a las tabletas del
 * salón con solo tres campos filtrados, y los Hubs anteriores a la 1.6.0 no
 * saben filtrar uno nuevo. Aquí solo hay datos públicos.
 */
export interface WebLicenciada {
  modalidad: ModalidadWeb;
  /**
   * La llave PÚBLICA del buzón de Central (X25519, la de `sobre.ts`).
   *
   * Cuando el propietario cambia la contraseña web desde su restaurante, se la
   * manda a Central sellada con esta llave: así Gonzalo puede seguir viéndola, y
   * Supabase, que la transporta, no. Va firmada dentro de la licencia para que
   * quien controle la nube no pueda cambiarla por una suya.
   */
  buzon_central: string;
}

/** La modalidad de un local según su licencia. Sin bloque `web` = app. */
export function modalidadDe(licencia: { web?: WebLicenciada | null } | null | undefined): ModalidadLocal {
  const m = licencia?.web?.modalidad;
  return m === "ambas" || m === "nube" ? m : "app";
}

export function esModalidadLocal(valor: unknown): valor is ModalidadLocal {
  return valor === "app" || valor === "ambas" || valor === "nube";
}

/**
 * ¿Se puede pasar de una modalidad a otra con un clic en Central?
 *
 * app ↔ ambas, sí: los datos no se mueven, solo se abre o se cierra el túnel.
 * Todo lo que entra o sale de «nube» es una MUDANZA de datos —de Supabase al
 * Hub o al revés— y esa todavía no existe. Negarse aquí evita dejar un
 * restaurante apuntando a un sitio donde no están sus ventas.
 */
export function cambioDeModalidadPermitido(
  actual: ModalidadLocal,
  nueva: ModalidadLocal,
): { ok: true } | { ok: false; error: string } {
  if (actual === nueva) return { ok: true };
  if (actual !== "nube" && nueva !== "nube") return { ok: true };
  return {
    ok: false,
    error:
      actual === "nube"
        ? "Este restaurante tiene sus datos en la nube. Pasarlo a una computadora es una mudanza de datos que llega en una versión posterior."
        : "Este restaurante tiene sus datos en su computadora. Pasarlo a la nube es una mudanza de datos que llega en una versión posterior.",
  };
}

// --- La clave del restaurante --------------------------------------------------------

/**
 * La clave con que un restaurante se presenta en la web («RODIZIO»).
 *
 * Mismo formato que la del portal de autofactura, y Central propone la misma:
 * un restaurante tiene UNA clave corta. No es secreta —se imprime en el ticket—;
 * lo secreto es la contraseña.
 */
export const FORMATO_CLAVE_RESTAURANTE = /^[A-Z0-9-]{3,20}$/;

/** Mayúsculas y sin espacios: se teclea en un teléfono, y así no hay dudas. */
export function normalizarClaveRestaurante(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, "");
}

export function claveRestauranteValida(texto: string): boolean {
  return FORMATO_CLAVE_RESTAURANTE.test(normalizarClaveRestaurante(texto));
}

// --- La contraseña web ----------------------------------------------------------------

/** Lo mínimo que se acepta cuando el propietario elige la suya. */
export const MINIMO_CONTRASENA_WEB = 10;

/**
 * Sin 0/O, 1/l/I: la contraseña se dicta por teléfono y se lee de una pantalla.
 * Solo minúsculas y dígitos, para no depender de que el teclado del teléfono
 * ponga o no mayúscula al empezar.
 */
const ALFABETO_CONTRASENA = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Una contraseña nueva, en tres grupos: `k7mp-x3qa-9vhe`.
 *
 * 12 símbolos de 32 = 60 bits, sobrados detrás de un freno de intentos; los
 * guiones son para leerla en voz alta sin perderse, y cuentan como caracteres.
 */
export function generarContrasenaWeb(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const letras = Array.from(bytes, (b) => ALFABETO_CONTRASENA[b % ALFABETO_CONTRASENA.length]);
  return [letras.slice(0, 4), letras.slice(4, 8), letras.slice(8, 12)].map((g) => g.join("")).join("-");
}

/**
 * ¿Se acepta esta contraseña elegida por el propietario?
 *
 * Largo mínimo y que no sea un solo carácter repetido. Nada de reglas de «una
 * mayúscula y un símbolo»: empujan a `Rodizio2026!`, que es peor que una frase.
 */
export function contrasenaWebAceptable(
  texto: string,
): { ok: true } | { ok: false; error: string } {
  if (texto.length < MINIMO_CONTRASENA_WEB) {
    return { ok: false, error: `La contraseña necesita al menos ${MINIMO_CONTRASENA_WEB} caracteres` };
  }
  if (new Set(texto).size < 4) {
    return { ok: false, error: "Esa contraseña es demasiado fácil de adivinar" };
  }
  return { ok: true };
}

// --- La clave remota -------------------------------------------------------------------

const BYTES_CLAVE_REMOTA = 32;

function aBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * La clave remota de un restaurante: 32 bytes en base64url.
 *
 * Misma forma que la clave del local de la LAN, a propósito: así sirve tal cual
 * para `derivarClaves` del protocolo de sincronización, y el túnel cifra con el
 * mismo código probado que la red del salón.
 */
export function generarClaveRemota(): string {
  const bytes = new Uint8Array(BYTES_CLAVE_REMOTA);
  crypto.getRandomValues(bytes);
  return aBase64Url(bytes);
}

export function claveRemotaValida(texto: unknown): texto is string {
  return typeof texto === "string" && /^[A-Za-z0-9_-]{43}$/.test(texto);
}

/** Envuelve la clave remota con la contraseña web. Lo hace quien conoce las dos. */
export function envolverClaveRemota(
  claveRemota: string,
  contrasena: string,
  ahora = Date.now(),
): Promise<Cofre> {
  if (!claveRemotaValida(claveRemota)) {
    return Promise.reject(new Error("La clave remota no tiene la forma esperada"));
  }
  return cerrarCofre(claveRemota, contrasena, ahora, MINIMO_CONTRASENA_WEB);
}

/**
 * La desenvuelve el navegador con la contraseña que se tecleó.
 *
 * `null` si la contraseña no es la de la envoltura. La entrada ya pasó por
 * Supabase Auth, así que esto solo falla si la envoltura quedó vieja respecto a
 * la contraseña — un defecto, no un intento de adivinarla.
 */
export async function desenvolverClaveRemota(cofre: unknown, contrasena: string): Promise<string | null> {
  const abierta = await abrirCofre(cofre, contrasena);
  return claveRemotaValida(abierta) ? abierta : null;
}

// --- Identidad en Supabase -------------------------------------------------------------

/**
 * El buzón del usuario web de un restaurante en Supabase Auth.
 *
 * Va por `sucursal_id` y no por la clave corta, porque la clave se puede
 * corregir en Central y el usuario tiene que seguir siendo el mismo. No recibe
 * correo; es un identificador, igual que el de los Hubs.
 */
export const DOMINIO_WEB = "web.motrae.mx";

export function correoWebDe(sucursalId: ID): string {
  return `web-${sucursalId}@${DOMINIO_WEB}`;
}

/**
 * Lo que la nube guarda del acceso web de un restaurante (`accesos_web`).
 *
 * `envoltura` es un cofre: la nube no puede abrirlo. `version` sube cada vez
 * que cambia la contraseña; el Hub corta las sesiones web abiertas al verla
 * subir.
 */
export interface AccesoWebPublicado {
  clave: string;
  sucursal_id: ID;
  modalidad: ModalidadWeb;
  envoltura: Cofre;
  version: number;
}
