#!/usr/bin/env node
/**
 * subtitulos.mjs — convierte los tiempos de la narración en clips de subtítulo.
 *
 * POR QUÉ EXISTE
 *
 * `voz-gemini.mjs` sabe dónde empieza y termina cada frase del guion, pero una
 * frase de trece segundos no es un subtítulo: es un párrafo pegado a la pantalla.
 * Este script parte cada frase en trozos legibles y les reparte la duración de la
 * frase en proporción a lo que cada trozo tarda en decirse (aproximado por número
 * de caracteres, que para español es una regla decente).
 *
 * Sale HTML por la salida estándar, listo para pegar en la composición. No lo
 * inyecta solo a propósito: el HTML es la fuente de verdad del video y se edita a
 * mano, no por generación automática.
 *
 * USO
 *   node subtitulos.mjs ../00-piloto/audio/narracion.tiempos.json --pista 7
 *   node subtitulos.mjs ... --max 52     # caracteres por línea de subtítulo
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const opciones = { max: 52, pista: 7 };
const sueltos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--max") opciones.max = Number(argv[++i]);
  else if (argv[i] === "--pista") opciones.pista = Number(argv[++i]);
  else sueltos.push(argv[i]);
}
if (!sueltos[0]) {
  console.error("Uso: node subtitulos.mjs <narracion.tiempos.json> [--max 52] [--pista 7]");
  process.exit(1);
}

const datos = JSON.parse(readFileSync(resolve(process.cwd(), sueltos[0]), "utf8"));

/**
 * Parte un texto en trozos de como mucho `max` caracteres, cortando por donde
 * la lengua ya corta: primero en punto, luego en coma o dos puntos, y solo al
 * final entre palabras.
 */
function partir(texto, max) {
  const frases = texto.match(/[^.]+\.?/g) || [texto];
  const trozos = [];
  for (const frase of frases) {
    const limpia = frase.trim();
    if (!limpia) continue;
    if (limpia.length <= max) {
      trozos.push(limpia);
      continue;
    }
    // Demasiado larga: reagrupar por comas y, si aún no cabe, por palabras.
    let actual = "";
    for (const parte of limpia.split(/(?<=[,:;])\s+/)) {
      for (const palabra of parte.split(/\s+/)) {
        const tentativa = actual ? actual + " " + palabra : palabra;
        if (tentativa.length > max && actual) {
          trozos.push(actual);
          actual = palabra;
        } else {
          actual = tentativa;
        }
      }
    }
    if (actual) trozos.push(actual);
  }
  return trozos;
}

function escapar(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const lineas = [];
let n = 0;
for (const bloque of datos.bloques) {
  const trozos = partir(bloque.texto, opciones.max);
  const total = trozos.reduce((s, t) => s + t.length, 0);
  const duracionBloque = bloque.fin - bloque.inicio;
  // Se acumula sobre los valores YA redondeados a centésimas. Acumular en
  // coma flotante y redondear al imprimir hacía que un clip terminara en
  // 39.690000000000005 mientras el siguiente empezaba en 39.68: solapamiento
  // de dos milésimas que el linter rechaza, con razón.
  let reloj = Number(bloque.inicio.toFixed(2));
  for (const trozo of trozos) {
    const dur = Number(((trozo.length / total) * duracionBloque).toFixed(2));
    n++;
    lineas.push(
      '        <div id="st' + n + '" class="clip subtitulo" data-start="' +
        reloj.toFixed(2) + '" data-duration="' + dur.toFixed(2) +
        '" data-track-index="' + opciones.pista + '">' + escapar(trozo) + "</div>",
    );
    reloj = Number((reloj + dur).toFixed(2));
  }
}

console.log("      <!-- Subtítulos · generados con herramientas/subtitulos.mjs -->");
console.log('      <div id="subtitulos">');
console.log(lineas.join("\n"));
console.log("      </div>");
console.error("\n  " + n + " subtítulos · hasta " + opciones.max + " caracteres cada uno\n");
