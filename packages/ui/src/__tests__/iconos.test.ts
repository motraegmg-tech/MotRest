/**
 * Las reglas del set de iconos, puestas donde no se puedan olvidar.
 *
 * Los 103 dibujos se revisaron a ojo uno por uno, pero hay tres cosas que el
 * ojo no ve y que un descuido rompería sin ruido: que un tono deje de
 * contrastar contra uno de los dos fondos, que un dibujo se salga del lienzo y
 * salga recortado, y que un icono quede con un tono que ya no existe.
 */
import { describe, expect, it } from "vitest";
import { ICONOS, NOMBRES_ICONO, TONOS, esNombreIcono } from "../iconos.js";

/** Los dos fondos donde vive cada icono. */
const PANEL = "#f4f6f3"; // --fondo
const CARRIL = "#14181a"; // --negro

/** Mínimo de la WCAG 2.2 (SC 1.4.11) para objetos gráficos. */
const MINIMO = 3;

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

describe("los tonos", () => {
  it.each(Object.entries(TONOS))(
    "%s contrasta contra el panel Y contra el carril",
    (_nombre, tono) => {
      expect(contraste(tono.hex, PANEL)).toBeGreaterThanOrEqual(MINIMO);
      expect(contraste(tono.hex, CARRIL)).toBeGreaterThanOrEqual(MINIMO);
    },
  );

  it("las cifras declaradas son las medidas de verdad", () => {
    for (const [nombre, tono] of Object.entries(TONOS)) {
      expect(contraste(tono.hex, PANEL), `${nombre} sobre el panel`).toBeCloseTo(
        tono.contrastePanel,
        1,
      );
      expect(contraste(tono.hex, CARRIL), `${nombre} sobre el carril`).toBeCloseTo(
        tono.contrasteCarril,
        1,
      );
    }
  });
});

/**
 * Recorre un `path` de SVG y devuelve su caja envolvente.
 *
 * Los arcos se resuelven de verdad —centro y extremos barridos, apéndice F.6
 * de la especificación—, no por aproximación: media docena de iconos usan
 * arcos grandes para las cúpulas y los hombros, y una aproximación floja los
 * daba por fuera del lienzo cuando estaban dentro.
 */
function cajaDeRuta(d: string, caja: Caja): void {
  const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const piezas = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  let x = 0;
  let y = 0;
  let ix = 0;
  let iy = 0;
  let i = 0;
  let cmd = "";

  while (i < piezas.length) {
    const pieza = piezas[i];
    if (pieza !== undefined && /[A-Za-z]/.test(pieza)) {
      cmd = pieza;
      i += 1;
    }
    const may = cmd.toUpperCase();
    const rel = cmd !== may;
    if (may === "Z") {
      x = ix;
      y = iy;
      continue;
    }
    const n = ARGS[may] ?? 0;
    const a: number[] = [];
    for (let k = 0; k < n; k += 1) a.push(Number(piezas[i++]));
    const v = (px: number, py: number): void => {
      caja.x0 = Math.min(caja.x0, px);
      caja.y0 = Math.min(caja.y0, py);
      caja.x1 = Math.max(caja.x1, px);
      caja.y1 = Math.max(caja.y1, py);
    };
    const abs = (k: number, eje: "x" | "y"): number =>
      rel ? (eje === "x" ? x : y) + (a[k] ?? 0) : (a[k] ?? 0);

    if (may === "M") {
      x = abs(0, "x");
      y = abs(1, "y");
      ix = x;
      iy = y;
      v(x, y);
      cmd = rel ? "l" : "L";
    } else if (may === "L" || may === "T") {
      x = abs(0, "x");
      y = abs(1, "y");
      v(x, y);
    } else if (may === "H") {
      x = abs(0, "x");
      v(x, y);
    } else if (may === "V") {
      y = rel ? y + (a[0] ?? 0) : (a[0] ?? 0);
      v(x, y);
    } else if (may === "C" || may === "Q" || may === "S") {
      const pares = may === "C" ? 3 : 2;
      for (let k = 0; k < pares; k += 1) v(abs(k * 2, "x"), abs(k * 2 + 1, "y"));
      x = abs((pares - 1) * 2, "x");
      y = abs((pares - 1) * 2 + 1, "y");
    } else if (may === "A") {
      const nx = abs(5, "x");
      const ny = abs(6, "y");
      for (const [px, py] of extremosDeArco(x, y, a[0] ?? 0, a[1] ?? 0, a[3] ?? 0, a[4] ?? 0, nx, ny)) {
        v(px, py);
      }
      x = nx;
      y = ny;
    }
  }
}

function extremosDeArco(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  granArco: number,
  barrido: number,
  x2: number,
  y2: number,
): Array<[number, number]> {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    return [
      [x1, y1],
      [x2, y2],
    ];
  }
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lam > 1) {
    const k = Math.sqrt(lam);
    rx *= k;
    ry *= k;
  }
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const co = (granArco !== barrido ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cx = (co * rx * dy) / ry + (x1 + x2) / 2;
  const cy = (-co * ry * dx) / rx + (y1 + y2) / 2;
  const a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  const a2 = Math.atan2((y2 - cy) / ry, (x2 - cx) / rx);
  let barre = a2 - a1;
  if (barrido === 1 && barre < 0) barre += 2 * Math.PI;
  if (barrido === 0 && barre > 0) barre -= 2 * Math.PI;

  const puntos: Array<[number, number]> = [
    [x1, y1],
    [x2, y2],
  ];
  // Los cuatro puntos cardinales del elipse, si el arco pasa por ellos.
  for (let k = -2; k <= 4; k += 1) {
    const ang = (k * Math.PI) / 2;
    const t = (ang - a1) / barre;
    if (t >= 0 && t <= 1) puntos.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)]);
  }
  return puntos;
}

interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function cajaDeCapa(svg: string, caja: Caja): void {
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) cajaDeRuta(m[1] ?? "", caja);
  for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
    const cx = Number(m[1]);
    const cy = Number(m[2]);
    const r = Number(m[3]);
    caja.x0 = Math.min(caja.x0, cx - r);
    caja.y0 = Math.min(caja.y0, cy - r);
    caja.x1 = Math.max(caja.x1, cx + r);
    caja.y1 = Math.max(caja.y1, cy + r);
  }
  for (const m of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    caja.x0 = Math.min(caja.x0, x);
    caja.y0 = Math.min(caja.y0, y);
    caja.x1 = Math.max(caja.x1, x + Number(m[3]));
    caja.y1 = Math.max(caja.y1, y + Number(m[4]));
  }
}

describe("los dibujos", () => {
  it("son 103, el set que se aprobó", () => {
    expect(NOMBRES_ICONO).toHaveLength(103);
  });

  it.each(NOMBRES_ICONO)("%s cabe en el lienzo de 24×24", (nombre) => {
    const icono = ICONOS[nombre];
    const caja: Caja = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    cajaDeCapa(icono.linea, caja);
    if (icono.fondo) cajaDeCapa(icono.fondo, caja);
    if (icono.fondo2) cajaDeCapa(icono.fondo2, caja);

    // Medio píxel de margen: el trazo de 1.75 se dibuja centrado en la ruta,
    // así que una línea pegada al borde asomaría fuera del viewBox.
    expect(caja.x0, `${nombre} se sale por la izquierda`).toBeGreaterThanOrEqual(0.5);
    expect(caja.y0, `${nombre} se sale por arriba`).toBeGreaterThanOrEqual(0.5);
    expect(caja.x1, `${nombre} se sale por la derecha`).toBeLessThanOrEqual(23.5);
    expect(caja.y1, `${nombre} se sale por abajo`).toBeLessThanOrEqual(23.5);
  });

  it.each(NOMBRES_ICONO)("%s usa tonos que existen", (nombre) => {
    const icono = ICONOS[nombre];
    expect(TONOS).toHaveProperty(icono.tono);
    if (icono.tono2) expect(TONOS).toHaveProperty(icono.tono2);
  });

  it("el segundo relleno solo aparece con su segundo tono", () => {
    for (const nombre of NOMBRES_ICONO) {
      const icono = ICONOS[nombre];
      const tieneForma = Boolean(icono.fondo2);
      const tieneTono = Boolean(icono.tono2);
      expect(tieneForma, `${nombre}: fondo2 y tono2 van juntos o no van`).toBe(tieneTono);
    }
  });

  it("ningún icono se queda sin nombre ni sin idea", () => {
    for (const nombre of NOMBRES_ICONO) {
      expect(ICONOS[nombre].nombre.length, nombre).toBeGreaterThan(0);
      expect(ICONOS[nombre].idea.length, nombre).toBeGreaterThan(0);
    }
  });
});

describe("esNombreIcono", () => {
  it("acepta los del set y rechaza lo demás", () => {
    expect(esNombreIcono("cocina")).toBe(true);
    expect(esNombreIcono("gorrito-de-chef")).toBe(false);
    expect(esNombreIcono(undefined)).toBe(false);
    expect(esNombreIcono(42)).toBe(false);
  });
});
