/**
 * El contraste de la marca, medido contra el archivo de tokens de verdad.
 *
 * Esto existe porque la regresión ya ocurrió una vez y nadie la vio: el POS
 * estuvo meses con letra blanca sobre el naranja de marca —2.56:1, cuando el
 * mínimo es 4.5— en TODO botón primario, y con el gris secundario a 2.79:1
 * repetido 402 veces. No se detectó porque en la pantalla del que programa,
 * con buena luz y a 40 cm, se lee. En una caja con reflejo y de pie, no.
 *
 * La prueba lee `tokens.css` directamente en vez de repetir los valores aquí:
 * si alguien cambia un color en el archivo, esto se entera. Copiar los
 * hexadecimales haría que la prueba siguiera pasando mientras la aplicación se
 * rompe, que es exactamente el fallo que se quiere impedir.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../tokens.css", import.meta.url)), "utf8");

function token(nombre: string): string {
  const m = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`el token --${nombre} no está en tokens.css, o ya no es un hexadecimal`);
  return m[1].toLowerCase();
}

function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const lineal = canales.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (lineal[0] ?? 0) + 0.7152 * (lineal[1] ?? 0) + 0.0722 * (lineal[2] ?? 0);
}

function contraste(a: string, b: string): number {
  const x = luminancia(a);
  const y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Texto normal. WCAG 2.2, SC 1.4.3. */
const TEXTO = 4.5;
/** Objetos gráficos y bordes que portan significado. SC 1.4.11. */
const GRAFICO = 3;

describe("los pares de texto de la marca", () => {
  const pares: Array<[string, string, string]> = [
    ["texto principal sobre el fondo de la app", "pizarra", "fondo"],
    ["texto principal sobre una tarjeta", "pizarra", "blanco"],
    ["texto secundario sobre el fondo de la app", "gris", "fondo"],
    ["texto secundario sobre una tarjeta", "gris", "blanco"],
    ["texto secundario sobre el carril oscuro", "gris-claro", "negro"],
    ["el naranja como texto sobre el fondo", "acento-texto", "fondo"],
    ["el naranja como texto sobre una tarjeta", "acento-texto", "blanco"],
    ["el verde como texto sobre una tarjeta", "exito-texto", "blanco"],
    ["rojo de peligro como texto sobre una tarjeta", "peligro", "blanco"],
    ["lo que se escribe sobre el relleno naranja", "sobre-acento", "acento"],
    ["blanco sobre el relleno rojo", "blanco", "peligro"],
    ["chip cálido: texto principal sobre --claro", "pizarra", "claro"],
  ];

  it.each(pares)("%s", (_que, texto, fondo) => {
    expect(contraste(token(texto), token(fondo))).toBeGreaterThanOrEqual(TEXTO);
  });
});

describe("los objetos gráficos", () => {
  /*
   * EL NARANJA DE MARCA NO PUEDE DEFINIR SU PROPIO BORDE.
   *
   * #F2853A contra el fondo #F4F6F3 da 2.36:1, y contra una tarjeta blanca
   * 2.56:1: los dos por debajo del 3:1 que la norma pide para que se vea DÓNDE
   * empieza y termina un control. Es un hecho del color, no un descuido, y no
   * se arregla oscureciendo la marca —el naranja MOTRAE es el naranja MOTRAE—.
   *
   * Se arregla del otro lado: un relleno naranja que necesite recortarse del
   * fondo lleva borde en `--acento-texto`, que sí lo consigue. Por eso lo que
   * se comprueba aquí es que ese token exista y sirva, no que el naranja haga
   * algo que no puede hacer.
   */
  it("el naranja tiene un borde que sí se recorta del fondo", () => {
    expect(contraste(token("acento-texto"), token("fondo"))).toBeGreaterThanOrEqual(GRAFICO);
    expect(contraste(token("acento-texto"), token("blanco"))).toBeGreaterThanOrEqual(GRAFICO);
  });

  it("el naranja de marca no cambió de tono al arreglar el contraste", () => {
    expect(token("acento")).toBe("#f2853a");
  });

  it("el rojo de peligro se distingue del fondo de la app", () => {
    expect(contraste(token("peligro"), token("fondo"))).toBeGreaterThanOrEqual(GRAFICO);
  });
});

describe("las reglas del sistema", () => {
  it("hay una escala de texto y no baja de 12.8px", () => {
    const escalones = [...css.matchAll(/--t-(\w+):\s*([\d.]+)rem/g)].map(([, , v]) => Number(v));
    expect(escalones.length).toBeGreaterThanOrEqual(6);
    expect(Math.min(...escalones)).toBeGreaterThanOrEqual(0.8);
  });

  it("el objetivo de toque cumple el mínimo de 44px", () => {
    const m = /--toque:\s*([\d.]+)rem/.exec(css);
    expect(m?.[1]).toBeDefined();
    expect(Number(m?.[1]) * 16).toBeGreaterThanOrEqual(44);
  });

  it("los planos están nombrados y ordenados de menos a más urgente", () => {
    const planos = ["z-contenido", "z-flotante", "z-velo", "z-dialogo", "z-aviso", "z-bloqueo"];
    const valores = planos.map((p) => {
      const m = new RegExp(`--${p}:\\s*(\\d+)`).exec(css);
      expect(m?.[1], `falta el plano --${p}`).toBeDefined();
      return Number(m?.[1]);
    });
    const ordenados = [...valores].sort((a, b) => a - b);
    expect(valores).toEqual(ordenados);
  });
});
