/**
 * Importación de la carta en bloque.
 *
 * Dar de alta un restaurante producto por producto es lo que separa "el
 * software está listo" de "el restaurante está operando": una carta de sesenta
 * platillos son horas de teclear, y cada línea es una oportunidad de escribir
 * mal un precio. Esto convierte eso en pegar una lista.
 *
 * DOS REGLAS QUE GOBIERNAN EL DISEÑO
 *
 * 1. **Nunca se importa a ciegas.** Esta función NO crea nada: interpreta el
 *    texto y devuelve lo que haría, línea por línea, con sus errores y sus
 *    avisos. Quien importa ve exactamente qué va a quedar antes de confirmar.
 *
 * 2. **Se acepta lo que la gente de verdad pega.** El dueño va a copiar de
 *    Excel, de un Word o de un mensaje de WhatsApp. Se toleran tabuladores,
 *    comas, punto y coma o barras; el signo de pesos; los miles con coma; los
 *    encabezados; y los renglones sueltos con el nombre de una categoría, que
 *    es como están escritas todas las cartas.
 */
import { deCentavos, type Centavos } from "../comun/dinero.js";

export type EstadoLinea = "alta" | "aviso" | "error";

export interface LineaImportada {
  /** Número de renglón en el texto pegado, para poder señalarlo. */
  renglon: number;
  /** El texto original, tal cual, para que se reconozca. */
  original: string;
  categoria: string;
  nombre: string;
  precio: Centavos;
  costo: Centavos;
  estado: EstadoLinea;
  /** Qué pasa con esta línea, en una frase. */
  detalle?: string;
}

export interface CartaImportada {
  lineas: LineaImportada[];
  /** Categorías nuevas que habrá que crear. */
  categorias: string[];
  /** Cuántas líneas se darían de alta. */
  altas: number;
  errores: number;
  avisos: number;
  /** true = ninguna línea trae costo; el food cost y el margen saldrían falsos. */
  sin_costos: boolean;
}

/** Separadores tolerados, en orden de preferencia. */
const SEPARADORES = ["\t", "|", ";", ","];

/**
 * Lee un importe escrito por una persona.
 *
 * Acepta "$1,249.50", "1249.5", "249" y "  $89 ". Devuelve `null` si no hay un
 * número reconocible — que es distinto de cero: un precio de cero es una
 * decisión, y un precio ilegible es un error.
 */
export function leerImporte(texto: string): Centavos | null {
  const limpio = texto.replace(/[$\s]/g, "").replace(/,/g, "");
  if (limpio === "" || !/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor)) return null;
  return deCentavos(Math.round(valor * 100));
}

/** Con qué separador está escrito el bloque: el que más columnas produzca. */
function detectarSeparador(lineas: readonly string[]): string {
  let mejor = SEPARADORES[0]!;
  let maximo = 0;
  for (const sep of SEPARADORES) {
    const columnas = lineas.reduce(
      (max, l) => Math.max(max, l.split(sep).length),
      0,
    );
    if (columnas > maximo) {
      maximo = columnas;
      mejor = sep;
    }
  }
  return mejor;
}

/** ¿Este renglón es el encabezado de la tabla y no un producto? */
function esEncabezado(campos: readonly string[]): boolean {
  const texto = campos.join(" ").toLowerCase();
  return (
    /\b(producto|platillo|nombre|descripci)/.test(texto) &&
    /\b(precio|costo|importe)/.test(texto)
  );
}

/**
 * Interpreta la carta pegada.
 *
 * El orden esperado de columnas es **Categoría, Producto, Precio, Costo**, con
 * el costo opcional. Un renglón de un solo campo se toma como encabezado de
 * categoría y aplica a las líneas que siguen —así se puede pegar una carta tal
 * como está escrita, sin repetir la categoría en cada platillo—.
 */
export function interpretarCarta(
  texto: string,
  opciones: { categoriasExistentes?: readonly string[] } = {},
): CartaImportada {
  const renglones = texto.split(/\r?\n/);
  const conContenido = renglones.filter((l) => l.trim() !== "");
  const sep = detectarSeparador(conContenido);

  const existentes = new Set(
    (opciones.categoriasExistentes ?? []).map((c) => c.trim().toLowerCase()),
  );
  const nuevas: string[] = [];
  const vistas = new Set<string>();
  const nombresVistos = new Set<string>();
  const lineas: LineaImportada[] = [];

  /** Categoría que arrastran los renglones sueltos, al estilo de una carta. */
  let categoriaActual = "";

  renglones.forEach((original, i) => {
    const renglon = i + 1;
    if (original.trim() === "") return;

    const campos = original.split(sep).map((c) => c.trim());
    const utiles = campos.filter((c) => c !== "");

    if (esEncabezado(campos)) return;

    // Un solo campo: es el título de una sección de la carta.
    if (utiles.length === 1) {
      categoriaActual = utiles[0]!;
      registrarCategoria(categoriaActual);
      return;
    }

    /*
     * ¿El renglón trae su categoría, o la arrastra de la sección de arriba?
     *
     * Contar campos NO basta: «Pizzas|Margarita|249» y «Margarita|249|62»
     * tienen tres. El desempate está en el SEGUNDO campo: si es un número, solo
     * puede ser un precio, así que el primero es el producto y la categoría
     * viene de la sección. Un nombre de platillo nunca es un número.
     */
    const traeCategoria = campos.length >= 3 && leerImporte(campos[1] ?? "") === null;
    const categoria = traeCategoria ? campos[0]!.trim() : categoriaActual;
    const nombre = (traeCategoria ? campos[1] : campos[0])!.trim();
    const textoPrecio = (traeCategoria ? campos[2] : campos[1]) ?? "";
    const textoCosto = (traeCategoria ? campos[3] : campos[2]) ?? "";

    const precio = leerImporte(textoPrecio);
    const costo = leerImporte(textoCosto) ?? deCentavos(0);

    const agregar = (estado: EstadoLinea, detalle?: string) => {
      lineas.push({
        renglon,
        original,
        categoria,
        nombre,
        precio: precio ?? deCentavos(0),
        costo,
        estado,
        detalle,
      });
    };

    if (nombre === "") {
      agregar("error", "Sin nombre de producto");
      return;
    }
    if (precio === null) {
      agregar("error", `No se entiende el precio «${textoPrecio}»`);
      return;
    }
    if (precio < 0) {
      agregar("error", "El precio no puede ser negativo");
      return;
    }
    if (categoria === "") {
      agregar("error", "Sin categoría: ponla en la línea o como título de sección");
      return;
    }

    const clave = `${categoria.toLowerCase()}·${nombre.toLowerCase()}`;
    if (nombresVistos.has(clave)) {
      agregar("error", "Repetido en esta misma lista");
      return;
    }
    nombresVistos.add(clave);
    registrarCategoria(categoria);

    // Avisos: no impiden importar, pero hay que verlos.
    if (costo > precio) {
      agregar("aviso", "El costo es mayor que el precio: se vendería con pérdida");
      return;
    }
    if (costo === 0) {
      agregar("aviso", "Sin costo: el margen y el food cost de este platillo saldrán en 100 %");
      return;
    }
    agregar("alta");
  });

  function registrarCategoria(nombre: string): void {
    const clave = nombre.trim().toLowerCase();
    if (clave === "" || existentes.has(clave) || vistas.has(clave)) return;
    vistas.add(clave);
    nuevas.push(nombre.trim());
  }

  const validas = lineas.filter((l) => l.estado !== "error");
  return {
    lineas,
    categorias: nuevas,
    altas: validas.length,
    errores: lineas.filter((l) => l.estado === "error").length,
    avisos: lineas.filter((l) => l.estado === "aviso").length,
    sin_costos: validas.length > 0 && validas.every((l) => l.costo === 0),
  };
}
