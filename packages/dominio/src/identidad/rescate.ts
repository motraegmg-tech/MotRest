/**
 * Código de rescate: la única forma de volver a entrar si el dueño olvida su
 * contraseña.
 *
 * EL PROBLEMA QUE RESUELVE, Y QUE NOSOTROS MISMOS CREAMOS
 *
 * Restablecer la credencial de alguien exige un rango ESTRICTAMENTE mayor. Eso
 * evita que un gerente tome control de la cuenta del dueño, y es correcto. Su
 * consecuencia deliberada era que la credencial del propietario no la
 * restablece nadie: si él la olvidaba —y agotaba sus siete intentos—, quedaba
 * fuera de su propio sistema **para siempre**, con años de operación y de
 * comprobantes fiscales dentro. Un candado sin llave de repuesto no es
 * seguridad, es una bomba de tiempo.
 *
 * POR QUÉ ESTO NO ES UNA PUERTA TRASERA
 *
 * Una recuperación que cualquiera pueda usar es peor que no tener ninguna. Aquí
 * la llave es un código de ~100 bits de entropía que:
 *
 *   - se genera UNA vez, se enseña UNA vez y se guarda solo como hash PBKDF2,
 *     igual que una contraseña. Ni el disco ni el respaldo lo contienen en claro;
 *   - es de un solo uso: al gastarlo se emite otro, para que un código anotado
 *     en un papel viejo no siga sirviendo;
 *   - está sujeto a la misma política de intentos que todo lo demás;
 *   - deja rastro en la bitácora. Recuperar el acceso no puede ser silencioso.
 *
 * LO QUE **NO** PROTEGE, dicho sin adornos: a quien tenga acceso físico al
 * disco de la caja. Esa persona ya puede leer y alterar `hub.sqlite`
 * directamente, sin pasar por aquí. El código de rescate protege del resto —la
 * red, el personal, una terminal prestada—, no del dueño del hardware.
 */

/**
 * Alfabeto sin caracteres ambiguos: fuera I, L, O, U, 0 y 1.
 *
 * El código se va a copiar a mano de una pantalla a un papel, y de vuelta. Un
 * cero confundido con una O el día que hay que usarlo convierte el rescate en
 * otro candado.
 */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Cuatro grupos de cinco: 20 caracteres ≈ 98 bits. */
const GRUPOS = 4;
const POR_GRUPO = 5;

/**
 * Genera un código de rescate legible: `A7K2M-9PQRS-3TVWX-YZ4BC`.
 *
 * Usa el generador criptográfico del entorno, nunca `Math.random`: un código
 * predecible sería exactamente la puerta trasera que este módulo evita.
 */
export function generarCodigoRescate(): string {
  const bytes = new Uint8Array(GRUPOS * POR_GRUPO);
  crypto.getRandomValues(bytes);

  const letras = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join("");
  const grupos: string[] = [];
  for (let i = 0; i < GRUPOS; i++) {
    grupos.push(letras.slice(i * POR_GRUPO, (i + 1) * POR_GRUPO));
  }
  return grupos.join("-");
}

/**
 * Normaliza lo que la persona teclea.
 *
 * Ignora guiones, espacios y mayúsculas. Y como el código viaja por papel, cada
 * carácter que el alfabeto excluyó se traduce al que se le parece y sí existe:
 * `0` y `O` → `Q`, `1` → `7`, `I` y `L` → `J`, `U` → `V`. Así, quien anotó una
 * O donde había una Q entra igual, en vez de pelearse con la pantalla el único
 * día que necesita este código.
 */
export function normalizarCodigo(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/0/g, "Q")
    .replace(/O/g, "Q")
    .replace(/1/g, "7")
    .replace(/I/g, "J")
    .replace(/L/g, "J")
    .replace(/U/g, "V");
}

/** ¿Tiene la forma de un código de rescate? Comprobación barata, antes de derivar. */
export function pareceCodigoRescate(texto: string): boolean {
  return normalizarCodigo(texto).length === GRUPOS * POR_GRUPO;
}
