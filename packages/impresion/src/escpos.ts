/**
 * Generador de comandos ESC/POS.
 *
 * Una impresora térmica de tickets no recibe texto: recibe bytes con comandos
 * intercalados. Aquí se arma ese flujo de bytes.
 *
 * Decisión de codificación: **CP437**, que es lo que traen de fábrica
 * prácticamente todas las térmicas del mercado mexicano. Enviar UTF-8 a una
 * impresora que espera CP437 produce basura donde van los acentos y las eñes —
 * y un ticket que dice "Jamon serrano" o "Pina" es un ticket mal impreso.
 *
 * ADR-08, TRD §8.
 */

/** Bytes de control del estándar. */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Alineacion = "izquierda" | "centro" | "derecha";

export interface OpcionesTexto {
  negrita?: boolean;
  doble_alto?: boolean;
  doble_ancho?: boolean;
  subrayado?: boolean;
  alineacion?: Alineacion;
}

/**
 * Tabla de conversión a CP437 para los caracteres del español.
 *
 * Solo se mapea lo que un ticket mexicano necesita de verdad. Lo que no esté
 * aquí se degrada a su letra sin acento antes de perderse como un signo de
 * interrogación: es preferible "Jamon" a "Jam?n".
 */
const CP437: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9,
  ñ: 0xa4, Ñ: 0xa5,
  ü: 0x81, Ü: 0x9a,
  "¿": 0xa8, "¡": 0xad,
  "°": 0xf8, "º": 0xa7, "ª": 0xa6,
};

/**
 * Último recurso: reemplazar por caracteres que sí existen.
 *
 * Ojo con la diferencia: aquí van los que NO tienen byte propio en CP437 y se
 * sustituyen por otra cosa. Meterlos en la tabla de arriba apuntando al byte de
 * una letra existente rompería la lectura inversa —el byte de la "E" pasaría a
 * leerse como "€"— y la previsualización mostraría basura.
 */
const SIN_ACENTO: Record<string, string> = {
  à: "a", è: "e", ì: "i", ò: "o", ù: "u",
  â: "a", ê: "e", î: "i", ô: "o", û: "u",
  ä: "a", ë: "e", ï: "i", ö: "o",
  ç: "c", Ç: "C",
  "€": "EUR",
  "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...",
};

/** Convierte una cadena a bytes CP437. */
export function aCP437(texto: string): number[] {
  const bytes: number[] = [];
  for (const caracter of texto) {
    const directo = CP437[caracter];
    if (directo !== undefined) {
      bytes.push(directo);
      continue;
    }
    const codigo = caracter.charCodeAt(0);
    if (codigo < 128) {
      bytes.push(codigo);
      continue;
    }
    const degradado = SIN_ACENTO[caracter];
    if (degradado) {
      for (const c of degradado) bytes.push(c.charCodeAt(0));
      continue;
    }
    // Desconocido: un espacio molesta menos que un símbolo raro.
    bytes.push(0x20);
  }
  return bytes;
}

/**
 * Construye un flujo ESC/POS.
 *
 * El ancho se declara en caracteres porque es como se piensa un ticket: 32
 * columnas para papel de 58 mm y 42 para el de 80 mm, que son los dos formatos
 * que existen en la práctica.
 */
export class Ticket {
  private bytes: number[] = [];

  constructor(public readonly columnas = 42) {
    // Inicializa la impresora y fija la tabla de caracteres a CP437.
    this.bytes.push(ESC, 0x40);
    this.bytes.push(ESC, 0x74, 0x00);
  }

  private alinear(alineacion: Alineacion): this {
    const valor = alineacion === "centro" ? 1 : alineacion === "derecha" ? 2 : 0;
    this.bytes.push(ESC, 0x61, valor);
    return this;
  }

  /** Escribe una línea con su formato y lo revierte al terminar. */
  linea(texto: string, opciones: OpcionesTexto = {}): this {
    if (opciones.alineacion) this.alinear(opciones.alineacion);
    if (opciones.negrita) this.bytes.push(ESC, 0x45, 1);
    if (opciones.subrayado) this.bytes.push(ESC, 0x2d, 1);
    if (opciones.doble_alto || opciones.doble_ancho) {
      const modo = (opciones.doble_ancho ? 0x20 : 0) | (opciones.doble_alto ? 0x10 : 0);
      this.bytes.push(GS, 0x21, modo);
    }

    this.bytes.push(...aCP437(texto), LF);

    // Se revierte SIEMPRE: dejar el estilo activo contagiaría a la línea
    // siguiente, y ese es el defecto clásico de los tickets mal armados.
    if (opciones.doble_alto || opciones.doble_ancho) this.bytes.push(GS, 0x21, 0);
    if (opciones.subrayado) this.bytes.push(ESC, 0x2d, 0);
    if (opciones.negrita) this.bytes.push(ESC, 0x45, 0);
    if (opciones.alineacion) this.alinear("izquierda");
    return this;
  }

  /**
   * Línea de dos columnas: concepto a la izquierda, importe a la derecha.
   *
   * Si no cabe, se recorta el CONCEPTO y nunca el importe: un nombre a medias
   * se entiende, un precio a medias es un ticket inservible.
   */
  columnasDobles(izquierda: string, derecha: string, opciones: OpcionesTexto = {}): this {
    const disponible = this.columnas - derecha.length - 1;
    const concepto =
      izquierda.length > disponible ? izquierda.slice(0, Math.max(0, disponible)) : izquierda;
    const relleno = " ".repeat(Math.max(1, this.columnas - concepto.length - derecha.length));
    return this.linea(`${concepto}${relleno}${derecha}`, opciones);
  }

  separador(caracter = "-"): this {
    return this.linea(caracter.repeat(this.columnas));
  }

  salto(cuantos = 1): this {
    for (let i = 0; i < cuantos; i += 1) this.bytes.push(LF);
    return this;
  }

  /** Código QR (modelo 2). Lo usa la autofactura del ticket. */
  qr(contenido: string, tamano = 6): this {
    const datos = aCP437(contenido);
    const longitud = datos.length + 3;
    const pL = longitud & 0xff;
    const pH = (longitud >> 8) & 0xff;

    this.alinear("centro");
    // Modelo 2
    this.bytes.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Tamaño del módulo
    this.bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tamano);
    // Nivel de corrección M
    this.bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
    // Contenido
    this.bytes.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...datos);
    // Imprimir
    this.bytes.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    this.alinear("izquierda");
    return this;
  }

  /** Corta el papel dejando margen para que el corte no se coma la última línea. */
  cortar(): this {
    this.salto(4);
    this.bytes.push(GS, 0x56, 0x42, 0x00);
    return this;
  }

  /** Abre el cajón de efectivo. Solo tiene sentido tras cobrar en efectivo. */
  abrirCajon(): this {
    this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  construir(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  /** Vista legible del contenido, para previsualizar sin gastar papel. */
  aTexto(): string {
    const salida: string[] = [];
    let linea: number[] = [];
    for (let i = 0; i < this.bytes.length; i += 1) {
      const b = this.bytes[i]!;
      // Se saltan las secuencias de control para quedarse solo con el texto.
      if (b === ESC || b === GS) {
        i += longitudComando(this.bytes, i) - 1;
        continue;
      }
      if (b === LF) {
        salida.push(deCP437(linea));
        linea = [];
        continue;
      }
      linea.push(b);
    }
    if (linea.length > 0) salida.push(deCP437(linea));
    return salida.join("\n");
  }
}

/** Cuántos bytes ocupa el comando que empieza en `i`. */
function longitudComando(bytes: readonly number[], i: number): number {
  const b = bytes[i];
  const siguiente = bytes[i + 1];

  if (b === ESC) {
    if (siguiente === 0x40) return 2;
    if (siguiente === 0x74 || siguiente === 0x61 || siguiente === 0x45 || siguiente === 0x2d) {
      return 3;
    }
    if (siguiente === 0x70) return 5;
    return 2;
  }

  if (b === GS) {
    if (siguiente === 0x21) return 3;
    if (siguiente === 0x56) return 4;
    if (siguiente === 0x28) {
      // Los comandos GS ( k llevan su longitud en dos bytes.
      const pL = bytes[i + 3] ?? 0;
      const pH = bytes[i + 4] ?? 0;
      return 5 + (pL | (pH << 8));
    }
    return 3;
  }

  return 1;
}

/**
 * Tabla inversa, solo para bytes altos.
 *
 * El filtro `>= 0x80` no es cosmético: si alguna entrada apuntara a un byte
 * ASCII, ese byte se leería como el carácter especial y la previsualización
 * mostraría "€sperado" donde el ticket dice "Esperado".
 */
const INVERSO: Record<number, string> = Object.fromEntries(
  Object.entries(CP437)
    .filter(([, byte]) => byte >= 0x80)
    .map(([caracter, byte]) => [byte, caracter]),
);

function deCP437(bytes: readonly number[]): string {
  return bytes.map((b) => INVERSO[b] ?? String.fromCharCode(b)).join("");
}
