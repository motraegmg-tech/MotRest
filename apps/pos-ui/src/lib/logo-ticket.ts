/**
 * Convierte el logo del restaurante en puntos que una térmica sabe imprimir.
 *
 * ## Lo que hay que entender antes de tocar esto
 *
 * Una impresora de tickets **no tiene grises**. Cada punto del cabezal sale
 * negro o no sale, así que un logo a color hay que reducirlo a dos tintas, y ahí
 * no existe una conversión "correcta": un logotipo con letras claras sobre fondo
 * oscuro y otro con un degradado necesitan umbrales distintos. Por eso el umbral
 * es un control que el restaurante mueve mirando la vista previa, y no un número
 * escondido en el código.
 *
 * ## Por qué se convierte AQUÍ y no al imprimir
 *
 * Esto necesita `canvas`, que existe en el navegador y no en el Hub. Y en el
 * momento de cobrar no hay tiempo de decodificar un PNG: el ticket se arma de
 * forma sincrónica mientras el comensal espera. Así que se convierte una vez, al
 * configurarlo, y lo que se guarda son los puntos ya calculados —uno por ancho
 * de papel—. Ver `@motrest/impresion/logo`.
 */
import {
  ALTO_MAX_LOGO,
  PUNTOS_POR_ANCHO,
  empaquetarLogo,
  medidaParaPapel,
  type AnchoPapel,
  type MapaLogo,
} from "@motrest/impresion";
import type { LogoDelTicket } from "./local.svelte";

/**
 * Umbral de fábrica.
 *
 * Tirando a alto a propósito: con un logo normal —dibujo oscuro sobre fondo
 * blanco o transparente— deja el trazo completo. Bajarlo adelgaza el dibujo
 * hasta perderlo; subirlo lo engorda hasta convertirlo en una mancha.
 */
export const UMBRAL_LOGO_POR_DEFECTO = 0.62;

/** Los dos anchos de papel que existen en la práctica. */
const ANCHOS: AnchoPapel[] = [32, 42];

/** Lo más grande que se acepta de entrada, para no atragantar a la caja. */
const BYTES_MAX = 8 * 1024 * 1024;

export interface ResultadoLogo {
  ok: true;
  logo: LogoDelTicket;
}
export interface FalloLogo {
  ok: false;
  error: string;
}

/**
 * Toma el archivo que eligió el restaurante y devuelve el logo ya listo.
 *
 * No toca el almacén: devuelve el valor y quien llama decide si lo guarda. Así
 * la pantalla puede enseñar la vista previa de un logo que todavía no está
 * puesto.
 */
export async function prepararLogo(
  archivo: File,
  umbral = UMBRAL_LOGO_POR_DEFECTO,
): Promise<ResultadoLogo | FalloLogo> {
  if (!archivo.type.startsWith("image/")) {
    return { ok: false, error: "Eso no es una imagen. Sirve un PNG o un JPG del logo." };
  }
  if (archivo.size > BYTES_MAX) {
    return { ok: false, error: "La imagen pesa demasiado. Usa una de menos de 8 MB." };
  }

  try {
    const imagen = await cargar(URL.createObjectURL(archivo), true);
    /*
     * La fuente se guarda YA REDUCIDA al papel más ancho que existe.
     *
     * Guardar el original completo no aporta nada —nunca se va a imprimir con
     * más de 576 puntos— y sí ocupa: una foto de teléfono son varios megas en el
     * disco de la caja y dentro de cada respaldo.
     */
    const medidaFuente = medidaParaPapel(
      imagen.width,
      imagen.height,
      PUNTOS_POR_ANCHO[42],
      ALTO_MAX_LOGO,
    );
    const lienzoFuente = dibujar(imagen, medidaFuente.ancho, medidaFuente.alto);
    const fuente = lienzoFuente.toDataURL("image/png");

    return {
      ok: true,
      logo: { fuente, umbral, mapas: mapasDe(imagen, umbral), nombre: archivo.name },
    };
  } catch (causa) {
    return {
      ok: false,
      error: `No se pudo leer la imagen: ${causa instanceof Error ? causa.message : String(causa)}`,
    };
  }
}

/**
 * Vuelve a calcular los puntos con otro umbral, sin volver a pedir el archivo.
 *
 * Es lo que hace útil el control de intensidad: se mueve, se mira la vista
 * previa y se deja donde el logo se reconoce. El archivo original ya no está —lo
 * eligió alguien en un diálogo hace meses— y por eso la fuente reducida se
 * guarda con el logo.
 */
export async function recalcularLogo(
  logo: LogoDelTicket,
  umbral: number,
): Promise<ResultadoLogo | FalloLogo> {
  try {
    const imagen = await cargar(logo.fuente, false);
    return { ok: true, logo: { ...logo, umbral, mapas: mapasDe(imagen, umbral) } };
  } catch (causa) {
    return {
      ok: false,
      error: `No se pudo recalcular el logo: ${causa instanceof Error ? causa.message : String(causa)}`,
    };
  }
}

/** Un mapa de puntos por cada ancho de papel. */
function mapasDe(
  imagen: HTMLImageElement,
  umbral: number,
): Partial<Record<AnchoPapel, MapaLogo>> {
  const mapas: Partial<Record<AnchoPapel, MapaLogo>> = {};
  for (const columnas of ANCHOS) {
    const medida = medidaParaPapel(
      imagen.width,
      imagen.height,
      PUNTOS_POR_ANCHO[columnas],
      ALTO_MAX_LOGO,
    );
    if (medida.ancho === 0) continue;
    const lienzo = dibujar(imagen, medida.ancho, medida.alto);
    mapas[columnas] = empaquetarLogo(aPuntos(lienzo, umbral));
  }
  return mapas;
}

function dibujar(imagen: HTMLImageElement, ancho: number, alto: number): HTMLCanvasElement {
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("este equipo no permite procesar imágenes");
  /*
   * Fondo BLANCO antes de dibujar. Un PNG con transparencia dejaría píxeles
   * negros con alfa cero, y sobre negro todo el logo saldría como un rectángulo
   * sólido: el clásico "imprimí mi logo y salió una mancha".
   */
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  return lienzo;
}

/**
 * Brillo → punto. Por debajo del umbral, el punto sale.
 *
 * Los coeficientes son los de luminancia percibida (Rec. 601): el verde pesa
 * más que el azul porque el ojo lo ve más. Con un promedio simple, un logo verde
 * —el de MOTRAE, por ejemplo— sale mucho más oscuro de lo que se ve en pantalla.
 */
function aPuntos(lienzo: HTMLCanvasElement, umbral: number): {
  ancho: number;
  alto: number;
  pixeles: boolean[];
} {
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("este equipo no permite procesar imágenes");
  const { width: ancho, height: alto } = lienzo;
  const datos = ctx.getImageData(0, 0, ancho, alto).data;
  const corte = Math.min(1, Math.max(0, umbral));

  const pixeles = new Array<boolean>(ancho * alto);
  for (let i = 0; i < ancho * alto; i += 1) {
    const r = datos[i * 4]! / 255;
    const g = datos[i * 4 + 1]! / 255;
    const b = datos[i * 4 + 2]! / 255;
    pixeles[i] = 0.299 * r + 0.587 * g + 0.114 * b < corte;
  }
  return { ancho, alto, pixeles };
}

function cargar(url: string, liberar: boolean): Promise<HTMLImageElement> {
  return new Promise((listo, falla) => {
    const imagen = new Image();
    imagen.onload = () => {
      if (liberar) URL.revokeObjectURL(url);
      if (imagen.width === 0 || imagen.height === 0) {
        falla(new Error("la imagen no tiene tamaño"));
        return;
      }
      listo(imagen);
    };
    imagen.onerror = () => {
      if (liberar) URL.revokeObjectURL(url);
      falla(new Error("el archivo no se pudo abrir como imagen"));
    };
    imagen.src = url;
  });
}
