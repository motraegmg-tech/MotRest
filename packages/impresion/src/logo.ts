/**
 * El logo del restaurante, guardado como mapa de puntos.
 *
 * ## Por qué se guarda en blanco y negro y no la imagen original
 *
 * Una térmica no imprime grises: cada punto sale o no sale. Convertir el PNG del
 * restaurante en puntos es una decisión con criterio —dónde está el umbral entre
 * lo que sale negro y lo que se queda en blanco— y esa decisión se toma UNA vez,
 * en la pantalla de configuración, con la vista previa delante. Guardarla hecha
 * es lo que permite que imprimir siga siendo instantáneo y sin `canvas`: en el
 * momento de cobrar no hay tiempo de convertir nada, y en el Hub no hay `canvas`
 * que convertirla.
 *
 * ## Por qué HAY DOS mapas y no uno
 *
 * El ancho del papel manda: 58 mm son 384 puntos y 80 mm son 576. Un logo
 * guardado a 384 puntos e impreso en 80 mm sale a dos tercios del rollo, y al
 * revés no cabe. Se guarda uno por ancho, calculado del mismo original, y cada
 * impresora usa el suyo.
 *
 * ## El formato
 *
 * Un bit por punto, ocho por byte, en base64. Un logo de 576×200 son 14 KB
 * empaquetado; el mismo mapa como lista de booleanos en JSON pasa de 280 KB, y
 * eso vive en el disco de la caja y viaja en cada respaldo.
 */
import type { ImagenMonocroma } from "./escpos.js";
import type { AnchoPapel } from "./plantillas.js";

/** Puntos de ancho útiles de cada papel, según sus columnas de texto. */
export const PUNTOS_POR_ANCHO: Record<AnchoPapel, number> = {
  32: 384,
  42: 576,
};

/**
 * Alto máximo del logo, en puntos.
 *
 * 200 puntos son unos 25 mm de rollo. No es estética: el papel se paga, y un
 * logo alto lo consume en cada ticket, cada pre-cuenta y cada reimpresión.
 */
export const ALTO_MAX_LOGO = 200;

/** Un logo ya convertido a puntos, listo para el cable. */
export interface MapaLogo {
  ancho: number;
  alto: number;
  /** Un bit por punto, de izquierda a derecha y de arriba abajo, en base64. */
  bits: string;
}

/** Empaqueta un mapa de puntos para guardarlo. */
export function empaquetarLogo(imagen: ImagenMonocroma): MapaLogo {
  const bytes = new Uint8Array(Math.ceil((imagen.ancho * imagen.alto) / 8));
  for (let i = 0; i < imagen.ancho * imagen.alto; i += 1) {
    if (imagen.pixeles[i]) bytes[i >> 3]! |= 0x80 >> (i & 7);
  }
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { ancho: imagen.ancho, alto: imagen.alto, bits: btoa(binario) };
}

/**
 * Devuelve el mapa a su forma imprimible.
 *
 * Ante un mapa corrupto —base64 a medias, medidas imposibles— devuelve `null` en
 * vez de reventar: un logo ilegible no puede dejar sin ticket a un comensal que
 * está esperando para pagar.
 */
export function desempaquetarLogo(mapa: MapaLogo | null | undefined): ImagenMonocroma | null {
  if (!mapa) return null;
  const { ancho, alto, bits } = mapa;
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho <= 0 || alto <= 0) return null;
  if (typeof bits !== "string" || !bits) return null;

  try {
    const binario = atob(bits);
    const puntos = ancho * alto;
    if (binario.length < Math.ceil(puntos / 8)) return null;

    const pixeles = new Array<boolean>(puntos);
    for (let i = 0; i < puntos; i += 1) {
      pixeles[i] = (binario.charCodeAt(i >> 3) & (0x80 >> (i & 7))) !== 0;
    }
    return { ancho, alto, pixeles };
  } catch {
    return null;
  }
}

/**
 * Cuánto hay que reducir una imagen para que quepa en un papel.
 *
 * Se devuelve entero en los dos lados y conservando la proporción: un logo
 * estirado se nota más que uno pequeño.
 */
export function medidaParaPapel(
  ancho: number,
  alto: number,
  puntos: number,
  altoMax = ALTO_MAX_LOGO,
): { ancho: number; alto: number } {
  /*
   * `isFinite` y no `<= 0`: un `NaN` —una imagen que el navegador no pudo medir—
   * pasa la comparación con cero y sale de aquí como `{NaN, NaN}`, que más
   * adelante se convierte en un mapa de puntos imposible. Se corta aquí, donde
   * todavía se entiende de dónde viene.
   */
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) {
    return { ancho: 0, alto: 0 };
  }
  const escala = Math.min(puntos / ancho, altoMax / alto, 1);
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}
