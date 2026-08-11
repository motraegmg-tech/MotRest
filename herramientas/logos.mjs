/**
 * Genera los dos derivados de la marca que la aplicación necesita.
 *
 * Los originales viven en `Documentos_de_Primer_Orden/` y NO se tocan: son los
 * archivos de marca. Aquí se producen las dos variantes que el producto usa, y
 * se dejan como script para que se puedan rehacer el día que la marca cambie —
 * en vez de aparecer como dos PNG sin explicación dentro del código.
 *
 *   1. `apps/pos-ui/src/assets/motrest-logo-claro.png`
 *      El logotipo completo con las letras en BLANCO, para la pantalla de
 *      acceso, que es negra. El original las trae en negro y sobre ese fondo
 *      desaparecían. Solo cambian las letras: la M naranja se conserva tal cual.
 *
 *   2. `apps/escritorio/icono-fuente.png`
 *      El icono de la aplicación, a partir de la «M» de la marca. El original es
 *      una FOTOGRAFÍA del logo sobre papel, así que se reconstruye: se clasifica
 *      cada píxel en naranja o fondo, se recorta a la M, se centra en un cuadro
 *      y se vuelve a dibujar con dos colores planos. Así el icono sale limpio a
 *      32 px en vez de arrastrar la textura del papel y la sombra del original.
 *
 * Uso:  node herramientas/logos.mjs
 * Después, para propagar el icono a todos los tamaños de Windows/macOS/Linux:
 *       cd apps/escritorio && corepack pnpm@9.15.0 exec tauri icon icono-fuente.png
 *
 * Depende de `pngjs`, que ya está en el árbol de dependencias (vía `qrcode`).
 * No se añade una dependencia nueva por un script que se ejecuta a mano.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARCA = join(RAIZ, "Documentos_de_Primer_Orden");

/**
 * `pngjs` está en el árbol pero no en la raíz.
 *
 * pnpm no eleva las dependencias transitivas —viene de `qrcode`—, así que un
 * `require("pngjs")` a secas falla desde aquí. Se busca en el almacén antes de
 * rendirse. La alternativa era declararlo como dependencia del monorepo, y no
 * parece razonable que la lista de dependencias del producto crezca por un
 * script que se ejecuta a mano cuando cambia la marca.
 */
function cargarPngjs() {
  try {
    return require("pngjs");
  } catch {
    const almacen = join(RAIZ, "node_modules/.pnpm");
    const carpeta = readdirSync(almacen).find((n) => n.startsWith("pngjs@"));
    if (!carpeta) {
      throw new Error("No se encontró pngjs. Ejecuta `corepack pnpm@9.15.0 install` primero.");
    }
    return require(join(almacen, carpeta, "node_modules/pngjs"));
  }
}

const { PNG } = cargarPngjs();

/** Naranja MOTRAE. El de la marca, no el que salga de la foto. */
const NARANJA = [242, 133, 58];

// --- Utilidades -------------------------------------------------------------------------

function leer(ruta) {
  return PNG.sync.read(readFileSync(ruta));
}

function escribir(png, ruta) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, PNG.sync.write(png));
  console.log(`✔ ${ruta.replace(RAIZ + "\\", "").replace(RAIZ + "/", "")}  ${png.width}×${png.height}`);
}

function pixel(png, x, y) {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

/**
 * Reduce con promedio de caja y alfa PREMULTIPLICADO.
 *
 * Sin premultiplicar, los píxeles transparentes —que en este PNG son negros—
 * arrastran su color al promedio y dejan un halo oscuro alrededor de cada letra
 * justo cuando la letra es blanca sobre negro, que es el caso de uso.
 */
function reducir(origen, ancho, alto) {
  const salida = new PNG({ width: ancho, height: alto });
  const escalaX = origen.width / ancho;
  const escalaY = origen.height / alto;

  for (let y = 0; y < alto; y++) {
    const y0 = Math.floor(y * escalaY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * escalaY));
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.floor(x * escalaX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * escalaX));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const [pr, pg, pb, pa] = pixel(origen, sx, sy);
          const f = pa / 255;
          r += pr * f;
          g += pg * f;
          b += pb * f;
          a += pa;
          n++;
        }
      }
      const alfa = a / n;
      const f = alfa > 0 ? 255 / alfa : 0;
      const i = (ancho * y + x) << 2;
      salida.data[i] = Math.round((r / n) * f);
      salida.data[i + 1] = Math.round((g / n) * f);
      salida.data[i + 2] = Math.round((b / n) * f);
      salida.data[i + 3] = Math.round(alfa);
    }
  }
  return salida;
}

// --- 1 · El logotipo con las letras en blanco --------------------------------------------

/**
 * ¿Es tinta oscura —o sea, una letra— y no la M naranja?
 *
 * Se mide por saturación además de por luminosidad: el naranja oscurecido de
 * los bordes antialiaseados es oscuro pero muy saturado, y convertirlo en
 * blanco dejaría un borde claro alrededor de la M.
 */
function esTintaOscura(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 130 && max - min < 60;
}

function logoClaro() {
  const origen = leer(join(MARCA, "Logo Grande MotRest sin Fondo.png"));
  const copia = new PNG({ width: origen.width, height: origen.height });
  origen.data.copy(copia.data);

  for (let i = 0; i < copia.data.length; i += 4) {
    const [r, g, b, a] = [copia.data[i], copia.data[i + 1], copia.data[i + 2], copia.data[i + 3]];
    if (a === 0) continue;
    if (!esTintaOscura(r, g, b)) continue;
    // Solo el COLOR cambia; el alfa se respeta para no comerse el suavizado de
    // los bordes de cada letra.
    copia.data[i] = 255;
    copia.data[i + 1] = 255;
    copia.data[i + 2] = 255;
  }

  // 628 px basta de sobra para el tamaño al que se pinta (unos 320 px en la
  // pantalla de acceso, el doble en pantallas densas) y pesa la cuarta parte.
  escribir(reducir(copia, 628, 628), join(RAIZ, "apps/pos-ui/src/assets/motrest-logo-claro.png"));
}

// --- 2 · El icono de la aplicación, desde la «M» -----------------------------------------

/** El naranja de la marca dentro de la fotografía. */
function esNaranja(r, g, b) {
  return r > 150 && r - b > 80 && r - g > 45;
}

function iconoDesdeLaM() {
  const foto = leer(join(MARCA, "Logo M MotRest.png"));

  // Máscara binaria: 1 = tinta de la M. Se resuelve una sola vez y el resto del
  // trabajo se hace sobre ella, no sobre los píxeles de la foto.
  const marca = new Uint8Array(foto.width * foto.height);
  let minX = foto.width, minY = foto.height, maxX = -1, maxY = -1;
  for (let y = 0; y < foto.height; y++) {
    for (let x = 0; x < foto.width; x++) {
      const [r, g, b] = pixel(foto, x, y);
      if (!esNaranja(r, g, b)) continue;
      marca[y * foto.width + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("No se encontró la M naranja en el original");

  // Cuadro centrado en la M, con aire alrededor: un icono pegado a los bordes
  // se ve apretado en la barra de tareas.
  const anchoM = maxX - minX + 1;
  const altoM = maxY - minY + 1;
  const lado = Math.round(Math.max(anchoM, altoM) * 1.42);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const desdeX = cx - lado / 2;
  const desdeY = cy - lado / 2;

  const LADO = 1024;
  const MUESTRA = lado / LADO;
  const RADIO = LADO * 0.185;

  const icono = new PNG({ width: LADO, height: LADO });
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      // Cobertura de tinta: se promedia la máscara sobre el trozo de foto que
      // le toca a este píxel. Eso es lo que da los bordes suaves sin heredar la
      // textura del papel.
      const sx0 = Math.floor(desdeX + x * MUESTRA);
      const sx1 = Math.max(sx0 + 1, Math.floor(desdeX + (x + 1) * MUESTRA));
      const sy0 = Math.floor(desdeY + y * MUESTRA);
      const sy1 = Math.max(sy0 + 1, Math.floor(desdeY + (y + 1) * MUESTRA));

      let tinta = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++;
          if (sx < 0 || sy < 0 || sx >= foto.width || sy >= foto.height) continue;
          tinta += marca[sy * foto.width + sx];
        }
      }
      const cobertura = n > 0 ? tinta / n : 0;

      const i = (LADO * y + x) << 2;
      icono.data[i] = Math.round(255 + (NARANJA[0] - 255) * cobertura);
      icono.data[i + 1] = Math.round(255 + (NARANJA[1] - 255) * cobertura);
      icono.data[i + 2] = Math.round(255 + (NARANJA[2] - 255) * cobertura);
      icono.data[i + 3] = Math.round(255 * dentroDelRedondeo(x, y, LADO, RADIO));
    }
  }

  escribir(icono, join(RAIZ, "apps/escritorio/icono-fuente.png"));
}

/**
 * Cuánto de este píxel cae dentro del cuadrado de esquinas redondeadas (0..1).
 *
 * Se suaviza en un píxel de ancho para que la curva no salga dentada; a 32 px
 * el dentado se nota más que la propia forma.
 */
function dentroDelRedondeo(x, y, lado, radio) {
  const px = x + 0.5;
  const py = y + 0.5;
  const dx = Math.max(radio - px, px - (lado - radio), 0);
  const dy = Math.max(radio - py, py - (lado - radio), 0);
  if (dx === 0 || dy === 0) return 1;
  const d = Math.hypot(dx, dy);
  return Math.min(1, Math.max(0, radio + 0.5 - d));
}

logoClaro();
iconoDesdeLaM();
