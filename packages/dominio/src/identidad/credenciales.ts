/**
 * Credenciales de acceso: contraseña (perfiles administrativos) y PIN (piso).
 *
 * ADR-11 — El secreto NUNCA se guarda: solo su derivación PBKDF2-SHA256 con sal
 * aleatoria, vía WebCrypto (disponible en Node 20+, navegador, Tauri y
 * Capacitor). Cuando llegue el Hub se migrará a argon2id del lado del servidor,
 * que es lo que pide el TRD §10.
 *
 * Honestidad sobre el alcance: un PIN de 4-6 dígitos es débil frente a quien
 * obtenga el archivo de hashes, sin importar el algoritmo. Lo que realmente
 * protege es la combinación de: caché cifrada en el dispositivo, expiración
 * corta, bloqueo progresivo por intentos fallidos y, sobre todo, el Hub como
 * fuente canónica. Ver `docs/SEGURIDAD.md`.
 */
import type { ID } from "../comun/ids.js";

export type TipoCredencial = "contrasena" | "pin";

/** Iteraciones por tipo: la contraseña puede permitirse ser más lenta. */
export const ITERACIONES: Record<TipoCredencial, number> = {
  contrasena: 600_000,
  // El cambio rápido de usuario ocurre decenas de veces por turno: se equilibra
  // costo de ataque contra latencia percibida en el POS.
  pin: 310_000,
};

export interface Credencial {
  empleado_id: ID;
  tipo: TipoCredencial;
  algoritmo: "PBKDF2-SHA256";
  iteraciones: number;
  /** Sal aleatoria en base64. */
  sal: string;
  /** Derivación en base64. */
  hash: string;
  /** Momento en que se estableció (epoch ms del dispositivo). */
  creada_ts: number;
}

// --- Utilidades base64 isomórficas ---------------------------------------------

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

/** Comparación en tiempo constante: no filtra información por cuánto tarda. */
function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferencia === 0;
}

// --- Derivación -----------------------------------------------------------------

async function derivar(
  secreto: string,
  sal: Uint8Array,
  iteraciones: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: sal as BufferSource, iterations: iteraciones, hash: "SHA-256" },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/** Crea una credencial nueva a partir del secreto en claro (que se descarta). */
export async function crearCredencial(
  empleado_id: ID,
  secreto: string,
  tipo: TipoCredencial,
): Promise<Credencial> {
  const sal = new Uint8Array(16);
  crypto.getRandomValues(sal);
  const iteraciones = ITERACIONES[tipo];
  const hash = await derivar(secreto, sal, iteraciones);

  return {
    empleado_id,
    tipo,
    algoritmo: "PBKDF2-SHA256",
    iteraciones,
    sal: aBase64(sal),
    hash: aBase64(hash),
    creada_ts: Date.now(),
  };
}

/** Verifica un secreto contra su credencial almacenada. */
export async function verificarCredencial(
  secreto: string,
  credencial: Credencial,
): Promise<boolean> {
  const calculado = await derivar(
    secreto,
    deBase64(credencial.sal),
    credencial.iteraciones,
  );
  return igualesEnTiempoConstante(calculado, deBase64(credencial.hash));
}

// --- Política de intentos --------------------------------------------------------

export interface EstadoIntentos {
  fallos: number;
  ultimo_fallo_ts: number;
}

/**
 * Tope duro de intentos fallidos, para contraseñas y PIN por igual.
 * Al agotarse, la credencial queda BLOQUEADA y solo un rol autorizante puede
 * desbloquearla: no hay reintento por tiempo. Evita el martilleo contra el
 * verificador (y, cuando exista el Hub, contra el backend).
 */
export const MAX_INTENTOS = 7;

/** Intentos sin penalización antes de que empiece la espera progresiva. */
const LIBRES = 3;

export interface ResultadoPolitica {
  permitido: boolean;
  /** Milisegundos que faltan para poder reintentar. */
  espera_ms: number;
  /** true = se agotaron los 7 intentos; requiere desbloqueo autorizado. */
  bloqueado: boolean;
  /** Intentos que quedan antes del bloqueo definitivo. */
  restantes: number;
}

/**
 * Política de intentos: espera progresiva (2 s, 4 s, 8 s… tope 5 min) a partir
 * del cuarto fallo, y **bloqueo definitivo al séptimo**.
 */
export function politicaIntentos(
  estado: EstadoIntentos,
  ahora: number,
): ResultadoPolitica {
  const restantes = Math.max(0, MAX_INTENTOS - estado.fallos);

  if (estado.fallos >= MAX_INTENTOS) {
    return { permitido: false, espera_ms: 0, bloqueado: true, restantes: 0 };
  }

  if (estado.fallos < LIBRES) {
    return { permitido: true, espera_ms: 0, bloqueado: false, restantes };
  }

  const espera = Math.min(2 ** (estado.fallos - LIBRES + 1) * 1000, 5 * 60_000);
  const transcurrido = ahora - estado.ultimo_fallo_ts;
  if (transcurrido >= espera) {
    return { permitido: true, espera_ms: 0, bloqueado: false, restantes };
  }

  return { permitido: false, espera_ms: espera - transcurrido, bloqueado: false, restantes };
}

/** Reglas mínimas de calidad del secreto. */
export function validarSecreto(secreto: string, tipo: TipoCredencial): string | null {
  if (tipo === "pin") {
    if (!/^\d{4,8}$/.test(secreto)) return "El PIN debe tener entre 4 y 8 dígitos";
    if (/^(\d)\1+$/.test(secreto)) return "El PIN no puede ser un mismo dígito repetido";
    return null;
  }
  if (secreto.length < 8) return "La contraseña debe tener al menos 8 caracteres";
  if (!/[a-zA-Z]/.test(secreto) || !/\d/.test(secreto)) {
    return "La contraseña debe combinar letras y números";
  }
  return null;
}

/**
 * Genera un PIN de administración que no depende de una semilla ni de una
 * constante del instalador.
 *
 * Se usa al dar de alta al responsable desde Central. Ocho dígitos dejan un
 * espacio de cien millones de combinaciones y, con el límite de intentos del
 * Hub, son apropiados para una cuenta que no se teclea a cada rato.
 */
export function generarPinSeguro(longitud = 8): string {
  if (!Number.isInteger(longitud) || longitud < 4 || longitud > 8) {
    throw new Error("La longitud del PIN debe estar entre 4 y 8 dígitos");
  }

  /* 250 es el múltiplo mayor de diez que cabe en un byte: evita sesgo de módulo. */
  const tope = 250;
  for (;;) {
    let pin = "";
    while (pin.length < longitud) {
      const byte = new Uint8Array(1);
      crypto.getRandomValues(byte);
      if (byte[0]! >= tope) continue;
      pin += String(byte[0]! % 10);
    }
    if (validarSecreto(pin, "pin") === null && pin !== "12345678") return pin;
  }
}
