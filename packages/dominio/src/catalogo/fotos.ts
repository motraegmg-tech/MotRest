/**
 * Fotos de los productos: aquí vive la REFERENCIA, nunca los bytes.
 *
 * POR QUÉ LA IMAGEN NO PUEDE VIAJAR EN EL CATÁLOGO
 *
 * El menú se replica entero a cada terminal (TRD §5.2) y el event log se carga
 * completo al arrancar. Una carta de 80 platillos con la foto en base64 dentro
 * son decenas de megas que cada tablet tendría que recibir y volver a guardar
 * cada vez que alguien cambia un precio. `crecimiento.ts` existe justo para
 * avisar de ese tipo de degradación; meter fotos ahí sería provocarla a mano.
 *
 * Así que el catálogo guarda un NOMBRE DE ARCHIVO y nada más. Los bytes viven
 * en el disco del Hub y se piden por HTTP, que es lo que un navegador hace bien:
 * los cachea, los pide solo cuando se ven, y si el Hub no responde la pantalla
 * sigue funcionando sin ellos.
 *
 * EL NOMBRE ES DELIBERADAMENTE RÍGIDO
 *
 * `f-<uuid>.<ext>` y nada más. No es un capricho de estilo: ese nombre lo
 * escribe una terminal, viaja dentro de un catálogo replicado y termina
 * concatenado a una ruta de disco en el Hub. Si se aceptara texto libre, un
 * catálogo manipulado con `"../../licencia.json"` convertiría la ruta que sirve
 * fotos en una ruta que sirve secretos. Con esta forma no hay nada que escapar:
 * lo que no encaje en el patrón sencillamente no es un nombre de foto.
 */
import { uuidv7 } from "../comun/ids.js";

/**
 * Los tres formatos que acepta el sistema, con la extensión que les toca.
 *
 * WebP es el que produce el POS al comprimir; JPEG y PNG se aceptan porque son
 * lo que sale de un teléfono o de una captura, y porque un navegador viejo
 * puede no saber codificar WebP.
 */
export const TIPOS_FOTO = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type TipoFoto = keyof typeof TIPOS_FOTO;

/**
 * Tope de una foto ya comprimida, en bytes.
 *
 * El POS redimensiona antes de subir y una foto de plato queda en 40–80 KB, así
 * que medio mega es holgura, no presupuesto. Sirve para que una imagen que se
 * escapó del redimensionado —o alguien saltándose el POS— no llene el disco de
 * la caja: 200 platillos en el peor caso son 100 MB, no 800.
 */
export const MAX_BYTES_FOTO = 512 * 1024;

/** Lado mayor al que el POS reduce antes de subir. Suficiente para una rejilla táctil. */
export const LADO_MAXIMO_FOTO = 640;

export function esTipoFoto(valor: unknown): valor is TipoFoto {
  return typeof valor === "string" && valor in TIPOS_FOTO;
}

/**
 * El único patrón de nombre que el sistema reconoce.
 *
 * Sin `.`, sin `/`, sin `\` y sin mayúsculas: no queda ningún carácter con el
 * que construir una ruta hacia otro sitio, ni forma de que dos sistemas de
 * archivos con distinta sensibilidad a mayúsculas discrepen sobre qué archivo es.
 */
const NOMBRE = /^f-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function nombreDeFotoValido(valor: unknown): valor is string {
  return typeof valor === "string" && NOMBRE.test(valor);
}

/**
 * Nombre nuevo para una foto que se acaba de subir.
 *
 * Lo pone el HUB, no la terminal. Que el nombre lo elija quien recibe el archivo
 * cierra de raíz que alguien suba dos veces con el mismo nombre para pisar la
 * foto de otro platillo, y hace que el nombre sea irrepetible sin coordinar nada
 * entre terminales.
 */
export function nombreDeFoto(tipo: TipoFoto): string {
  return `f-${uuidv7()}.${TIPOS_FOTO[tipo]}`;
}

/** Ruta HTTP donde el Hub sirve una foto. Relativa: la resuelve quien la pinta. */
export function rutaDeFoto(nombre: string): string {
  return `/foto/${nombre}`;
}
