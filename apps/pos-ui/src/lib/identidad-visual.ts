/**
 * La cara de un platillo que todavía no tiene foto.
 *
 * ## Por qué hace falta
 *
 * MotRest sabe guardar la foto de cada producto desde hace tiempo —el dominio,
 * el disco del Hub y el alta están hechos—, pero una carta recién dada de alta
 * no tiene ninguna, y Rodizio tampoco las ha subido. La cuadrícula quedaba
 * entonces como una pared de tarjetas de texto idénticas, y un mesero de su
 * primer turno buscando «Margarita» entre cuarenta rectángulos blancos tarda
 * lo mismo que si leyera una lista.
 *
 * La inicial sobre color no pretende sustituir a la foto: pretende que la
 * tarjeta tenga ALGO que el ojo reconozca de un vistazo. Cuando la foto llega,
 * la foto manda.
 *
 * ## Por qué el color sale del nombre y no es aleatorio
 *
 * Tiene que ser el MISMO color en cada arranque, en cada terminal y para todos
 * los meseros: la utilidad está en que «la naranja» siempre esté en el mismo
 * sitio y del mismo color, no en que se vea bonito. Por eso se deriva del
 * nombre con una suma estable y no de un contador ni de `Math.random()`.
 *
 * Los tonos son los del set de iconos, que ya están medidos: todos contrastan
 * con el texto oscuro que se les pone encima.
 */
import { TONOS, type NombreTono } from "@motrest/ui/iconos";

/**
 * Los tonos que sirven de fondo para una inicial.
 *
 * Se dejan fuera los muy apagados —`pizarra` y `acero`— porque entre ellos y
 * el gris de una tarjeta sin foto no habría diferencia, que es justo lo que se
 * quiere evitar.
 */
const PALETA: NombreTono[] = [
  "brasa",
  "tomate",
  "ambar",
  "mostaza",
  "oliva",
  "verde",
  "jade",
  "turquesa",
  "cielo",
  "indigo",
  "ciruela",
  "vino",
  "rosa",
  "cafe",
  "dorado",
];

/**
 * Suma estable de una cadena.
 *
 * Es la variante de djb2: barata, sin dependencias, y con buen reparto para
 * cadenas cortas como el nombre de un platillo. No es un hash criptográfico ni
 * lo necesita — aquí solo se reparte color.
 */
function sumar(texto: string): number {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) {
    h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** El color que le toca a este nombre. Siempre el mismo. */
export function tonoDeNombre(nombre: string): string {
  const clave = PALETA[sumar(nombre) % PALETA.length] ?? "brasa";
  return TONOS[clave].hex;
}

/**
 * La letra que se pinta.
 *
 * Dos caracteres cuando el nombre trae dos palabras con peso —«Margarita
 * Clásica» da «MC»—, porque distingue mucho mejor que una sola inicial en una
 * carta donde media docena de platillos empiezan con P. Las palabras de enlace
 * no cuentan: «Pizza de la Casa» debe dar «PC», no «PD».
 */
const ENLACES = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "a", "al", "en"]);

export function inicialDeNombre(nombre: string): string {
  const palabras = nombre
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0 && !ENLACES.has(p.toLowerCase()));

  if (palabras.length === 0) return "·";
  if (palabras.length === 1) return (palabras[0] ?? "").slice(0, 1).toUpperCase();
  return ((palabras[0] ?? "").slice(0, 1) + (palabras[1] ?? "").slice(0, 1)).toUpperCase();
}
