/**
 * Generador de PDF propio, sin una sola dependencia.
 *
 * ## Por qué escribirlo en vez de instalar una librería
 *
 * Misma razón por la que el ESC/POS de este paquete está escrito a mano: lo que
 * se mete aquí viaja dentro del instalador de CADA restaurante y hay que
 * mantenerlo durante años. Una librería de PDF pesa más que todo el POS, arrastra
 * su propia cadena de dependencias y un día publica una versión que rompe algo
 * en la caja de un cliente un viernes por la noche.
 *
 * Y no hace falta. Un estado financiero es texto colocado en una hoja y unas
 * líneas: eso es lo que un PDF sabe hacer de nacimiento, con las catorce fuentes
 * que TODO lector trae incorporadas. No se embebe ninguna tipografía, así que el
 * archivo pesa unos pocos kilobytes y abre igual en Windows, en el celular del
 * contador y en el navegador.
 *
 * ## Las tres cosas que hay que hacer bien
 *
 * 1. **Los offsets del `xref`.** Un PDF lleva al final una tabla con la posición
 *    EN BYTES de cada objeto. Si un solo número está mal, el lector lo rechaza
 *    entero. Por eso el documento se arma como bytes desde el principio y no
 *    como texto que luego se convierte: en cuanto una `á` ocupara dos bytes en
 *    UTF-8, todos los offsets calculados sobre caracteres quedarían corridos.
 *
 * 2. **Los acentos.** Las fuentes base usan `WinAnsiEncoding`, que es un byte por
 *    carácter. `traducir()` lleva de Unicode a esa tabla — incluidas las comillas
 *    tipográficas y la raya larga que este proyecto usa por todas partes—.
 *
 * 3. **Los importes alineados.** Las cifras van en Courier, que es de ancho fijo:
 *    los pesos quedan bajo los pesos y los centavos bajo los centavos sin
 *    depender de ninguna métrica. Un estado financiero con las columnas
 *    desalineadas no se lee, se descifra.
 */

/** Tamaño carta en puntos, que es la unidad del PDF (72 por pulgada). */
export const CARTA = { ancho: 612, alto: 792 };

/** Las cuatro fuentes que se usan. Todas van incorporadas en cualquier lector. */
export type Fuente = "normal" | "negrita" | "cifra" | "cifra-negrita";

const NOMBRE_FUENTE: Record<Fuente, string> = {
  normal: "Helvetica",
  negrita: "Helvetica-Bold",
  cifra: "Courier",
  "cifra-negrita": "Courier-Bold",
};

const RECURSO_FUENTE: Record<Fuente, string> = {
  normal: "F1",
  negrita: "F2",
  cifra: "F3",
  "cifra-negrita": "F4",
};

// --- Anchos de carácter ------------------------------------------------------------------

/**
 * Anchos de Helvetica, en milésimas de em, para el ASCII imprimible.
 *
 * Solo hacen falta para centrar un título y para recortar un texto que no cabe.
 * Los importes no los usan —van en Courier— así que un error de unas milésimas
 * en una letra acentuada no mueve ninguna cifra de sitio.
 */
const ANCHO_HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const ANCHO_HELVETICA_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Courier es de ancho fijo: toda letra ocupa lo mismo, y en eso está la gracia. */
const ANCHO_COURIER = 600;

/**
 * A qué letra sin acento se parece cada acentuada, para medirla.
 *
 * En Helvetica la vocal acentuada mide igual que la vocal: el acento se dibuja
 * encima sin ocupar avance. Así que basta con quitarlo para saber el ancho.
 */
const SIN_ACENTO: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  Á: "A", É: "E", Í: "I", Ó: "O", Ú: "U", Ü: "U", Ñ: "N",
  "¿": "?", "¡": "!", "°": "o", "·": ".", "—": "M", "–": "n",
  "“": '"', "”": '"', "‘": "'", "’": "'", "«": '"', "»": '"',
};

/** Cuánto mide un texto, en puntos, con esa fuente y ese tamaño. */
export function anchoDeTexto(texto: string, fuente: Fuente, tamano: number): number {
  if (fuente === "cifra" || fuente === "cifra-negrita") {
    return (texto.length * ANCHO_COURIER * tamano) / 1000;
  }

  const tabla = fuente === "negrita" ? ANCHO_HELVETICA_NEGRITA : ANCHO_HELVETICA;
  let milesimas = 0;
  for (const caracter of texto) {
    const base = SIN_ACENTO[caracter] ?? caracter;
    const codigo = base.charCodeAt(0);
    // Fuera del ASCII imprimible se supone el ancho de una letra media: es
    // preferible a descuadrar el cálculo con un cero.
    milesimas += codigo >= 32 && codigo <= 126 ? (tabla[codigo - 32] ?? 556) : 556;
  }
  return (milesimas * tamano) / 1000;
}

/** Recorta un texto para que quepa en un ancho, con puntos suspensivos. */
export function recortar(texto: string, fuente: Fuente, tamano: number, ancho: number): string {
  if (anchoDeTexto(texto, fuente, tamano) <= ancho) return texto;

  let cortado = texto;
  while (cortado.length > 1 && anchoDeTexto(`${cortado}…`, fuente, tamano) > ancho) {
    cortado = cortado.slice(0, -1);
  }
  return `${cortado.trimEnd()}…`;
}

// --- Codificación ------------------------------------------------------------------------

/**
 * Los caracteres de WinAnsi que NO coinciden con su código Unicode.
 *
 * Son los del hueco 0x80–0x9F: la comilla tipográfica, la raya larga y los
 * puntos suspensivos, que este proyecto usa en cada pantalla. Sin esta tabla
 * saldrían como cuadritos en el papel del contador.
 */
const WINANSI_ESPECIAL: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Pasa un texto a los bytes de WinAnsiEncoding, escapando lo que el PDF exige. */
function traducir(texto: string): number[] {
  const bytes: number[] = [];

  for (const caracter of texto) {
    let codigo = WINANSI_ESPECIAL[caracter];
    if (codigo === undefined) {
      const punto = caracter.codePointAt(0) ?? 63;
      // Lo que no cabe en un byte se sustituye por su versión sin acento, y si
      // tampoco la hay, por un interrogante. Nunca por un byte inventado.
      codigo = punto <= 0xff ? punto : (SIN_ACENTO[caracter] ?? "?").charCodeAt(0);
    }

    // Paréntesis y barra invertida delimitan y escapan las cadenas del PDF.
    if (codigo === 0x28 || codigo === 0x29 || codigo === 0x5c) bytes.push(0x5c);
    bytes.push(codigo);
  }

  return bytes;
}

// --- El documento -------------------------------------------------------------------------

export interface OpcionesTextoPdf {
  fuente?: Fuente;
  tamano?: number;
  /** Gris de 0 (negro) a 1 (blanco). */
  gris?: number;
  /** Dónde cae `x`: al inicio del texto, en su centro o a su final. */
  alineacion?: "izquierda" | "centro" | "derecha";
}

/**
 * Una hoja en construcción.
 *
 * Las coordenadas se dan como se lee, con el ORIGEN ARRIBA A LA IZQUIERDA y `y`
 * creciendo hacia abajo. El PDF las quiere al revés y la conversión se hace
 * aquí: quien maqueta un informe piensa «este renglón va 40 puntos más abajo»,
 * no «va 40 puntos menos arriba».
 */
export class Pagina {
  private ordenes: string[] = [];

  texto(x: number, y: number, texto: string, opciones: OpcionesTextoPdf = {}): void {
    const fuente = opciones.fuente ?? "normal";
    const tamano = opciones.tamano ?? 10;
    const gris = opciones.gris ?? 0;

    let inicio = x;
    if (opciones.alineacion === "derecha") {
      inicio = x - anchoDeTexto(texto, fuente, tamano);
    } else if (opciones.alineacion === "centro") {
      inicio = x - anchoDeTexto(texto, fuente, tamano) / 2;
    }

    const cadena = traducir(texto)
      .map((b) => String.fromCharCode(b))
      .join("");

    this.ordenes.push(
      `BT /${RECURSO_FUENTE[fuente]} ${tamano} Tf ${gris} g ` +
        `1 0 0 1 ${redondear(inicio)} ${redondear(CARTA.alto - y)} Tm (${cadena}) Tj ET`,
    );
  }

  /** Una línea horizontal: la que separa el encabezado de una tabla de sus datos. */
  linea(x1: number, y: number, x2: number, grosor = 0.5, gris = 0.7): void {
    const alto = redondear(CARTA.alto - y);
    this.ordenes.push(
      `${gris} G ${grosor} w ${redondear(x1)} ${alto} m ${redondear(x2)} ${alto} l S`,
    );
  }

  /** Un rectángulo relleno: la banda gris de un encabezado de sección. */
  rectangulo(x: number, y: number, ancho: number, alto: number, gris: number): void {
    this.ordenes.push(
      `${gris} g ${redondear(x)} ${redondear(CARTA.alto - y - alto)} ` +
        `${redondear(ancho)} ${redondear(alto)} re f`,
    );
  }

  contenido(): string {
    return this.ordenes.join("\n");
  }
}

/** Dos decimales bastan y sobran, y acortan el archivo. */
function redondear(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * El documento completo. Se le piden páginas y al final se le piden los bytes.
 */
export class DocumentoPdf {
  private paginas: Pagina[] = [];
  /** Metadatos que el lector muestra en las propiedades del archivo. */
  constructor(
    private titulo: string,
    private autor = "MotRest · MOTRAE",
  ) {}

  nuevaPagina(): Pagina {
    const pagina = new Pagina();
    this.paginas.push(pagina);
    return pagina;
  }

  get cuantasPaginas(): number {
    return this.paginas.length;
  }

  /**
   * Arma el archivo.
   *
   * Los objetos se escriben en orden y se va anotando en qué byte empieza cada
   * uno; esa lista es el `xref` del final, que es lo que permite al lector
   * saltar a cualquier objeto sin leer el archivo entero. Un offset mal contado
   * y el PDF no abre — de ahí que todo se mida en bytes y nunca en caracteres.
   */
  bytes(): Uint8Array {
    if (this.paginas.length === 0) this.nuevaPagina();

    const trozos: number[] = [];
    const offsets: number[] = [];
    let posicion = 0;

    /*
     * Se anexa byte a byte y NO con `push(...bytes)`: desparramar un arreglo
     * grande como argumentos revienta la pila, y el flujo de una página con
     * cien renglones de gastos pasa de sobra ese tamaño.
     */
    const escribirCrudo = (bytes: readonly number[]): void => {
      for (const b of bytes) trozos.push(b);
      posicion += bytes.length;
    };
    const escribir = (texto: string): void => {
      for (let i = 0; i < texto.length; i += 1) trozos.push(texto.charCodeAt(i) & 0xff);
      posicion += texto.length;
    };
    const objeto = (numero: number, cuerpo: string): void => {
      offsets[numero] = posicion;
      escribir(`${numero} 0 obj\n${cuerpo}\nendobj\n`);
    };

    /*
     * Numeración: 1 catálogo, 2 árbol de páginas, 3-6 las cuatro fuentes, y a
     * partir de 7 las páginas con su contenido, de dos en dos.
     */
    const PRIMERA_PAGINA = 7;
    const idPagina = (i: number) => PRIMERA_PAGINA + i * 2;
    const idContenido = (i: number) => PRIMERA_PAGINA + i * 2 + 1;

    escribir("%PDF-1.4\n");
    // Cuatro bytes altos: así los programas que copian archivos lo tratan como
    // binario y no le cambian los saltos de línea, que rompería los offsets.
    escribirCrudo([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

    objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");

    const kids = this.paginas.map((_, i) => `${idPagina(i)} 0 R`).join(" ");
    objeto(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.paginas.length} >>`);

    (Object.keys(NOMBRE_FUENTE) as Fuente[]).forEach((fuente, i) => {
      objeto(
        3 + i,
        `<< /Type /Font /Subtype /Type1 /BaseFont /${NOMBRE_FUENTE[fuente]} ` +
          "/Encoding /WinAnsiEncoding >>",
      );
    });

    const recursos =
      "<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >>";

    this.paginas.forEach((pagina, i) => {
      objeto(
        idPagina(i),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${CARTA.ancho} ${CARTA.alto}] ` +
          `/Resources ${recursos} /Contents ${idContenido(i)} 0 R >>`,
      );

      /*
       * `flujo.length` ES el número de bytes: cada carácter de la cadena salió
       * de `traducir`, que ya dejó todo en el rango 0–255. Es exactamente la
       * razón de codificar a WinAnsi antes de maquetar y no al final.
       */
      const flujo = pagina.contenido();
      objeto(idContenido(i), `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`);
    });

    const totalObjetos = idContenido(this.paginas.length - 1) + 1;
    offsets[0] = 0;

    const inicioXref = posicion;
    escribir(`xref\n0 ${totalObjetos}\n`);
    escribir("0000000000 65535 f \n");
    for (let n = 1; n < totalObjetos; n += 1) {
      escribir(`${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`);
    }

    const info = `<< /Title (${cadenaPdf(this.titulo)}) /Producer (${cadenaPdf(this.autor)}) >>`;
    escribir(
      `trailer\n<< /Size ${totalObjetos} /Root 1 0 R /Info ${info} >>\n` +
        `startxref\n${inicioXref}\n%%EOF\n`,
    );

    return Uint8Array.from(trozos);
  }
}

/** Escapa un texto para meterlo en una cadena literal del PDF. */
function cadenaPdf(texto: string): string {
  return traducir(texto)
    .map((b) => String.fromCharCode(b))
    .join("");
}
