#!/usr/bin/env node
/**
 * voz-gemini.mjs — convierte un guion de texto en la narración del video.
 *
 * POR QUÉ EXISTE
 *
 * Los tres videos son «sin cara»: la voz ES el presentador. Este script llama al
 * modelo de texto-a-voz de Gemini y devuelve un WAV listo para la pista de audio
 * de HyperFrames.
 *
 * DOS DECISIONES QUE VALE LA PENA CONOCER
 *
 * 1. El modelo NO está escrito a mano. Los modelos TTS de Gemini han ido
 *    cambiando de nombre entre versiones preliminares; fijar uno a ciegas es
 *    garantizar que el script se rompa en silencio dentro de unos meses. Aquí se
 *    consulta el catálogo (`GET /v1beta/models`) y se elige el TTS vigente. Con
 *    `--modelo` se puede forzar uno.
 *
 * 2. El guion se sintetiza PÁRRAFO POR PÁRRAFO y se une con silencio real. Los
 *    guiones están escritos con pausas dramáticas («¿Cuánto ganaste ayer?» —beat—
 *    «No cuánto vendiste.»). Pedir todo de una vez entrega una lectura corrida;
 *    pedirlo por bloques deja el control del ritmo aquí, que es donde el montaje
 *    lo necesita.
 *
 * USO
 *   node voz-gemini.mjs ../guiones/01-un-viernes-completo-voz.txt \
 *     --salida ../01-un-viernes-completo/audio/narracion.wav
 *
 *   node voz-gemini.mjs --listar-voces
 *   node voz-gemini.mjs --listar-modelos
 *
 * OPCIONES
 *   --salida <ruta>    Archivo WAV de salida (por defecto: junto al guion)
 *   --voz <nombre>     Voz prefabricada de Gemini (por defecto: Charon)
 *   --modelo <nombre>  Fuerza un modelo TTS en vez de descubrirlo
 *   --pausa <ms>       Silencio entre párrafos (por defecto: 550)
 *   --ritmo <ms>       Espera entre peticiones (por defecto: 21000, plan gratuito)
 *   --velocidad <n>    Acelera el resultado conservando el tono (1.5 = redes)
 *   --estilo "<texto>" Instrucción de interpretación (hay una por defecto)
 *   --seco             No escribe nada: solo dice qué haría
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_VIDEO = resolve(AQUI, "..");
const API = "https://generativelanguage.googleapis.com/v1beta";

/** Formato que devuelve Gemini para audio: PCM 16 bits, mono, 24 kHz. */
const MUESTREO = 24000;
const CANALES = 1;
const BITS = 16;

/**
 * Voces prefabricadas de Gemini y para qué sirve cada una en este proyecto.
 * La lista viva está en la documentación de Gemini; esta es la selección que
 * tiene sentido para una narración comercial en español.
 */
const VOCES = {
  Charon: "Informativa, serena. La recomendada para el video ancla.",
  Kore: "Firme, con autoridad. Buena para la comparativa POS vs ERP.",
  Orus: "Firme y cálida a la vez. Alternativa a Charon.",
  Puck: "Animada, con energía. Buena para el vertical de redes.",
  Fenrir: "Excitable, empuja el ritmo. Riesgo: puede sonar a comercial de radio.",
  Aoede: "Ligera, aireada.",
  Leda: "Juvenil.",
  Zephyr: "Brillante.",
  Enceladus: "Susurrada, íntima.",
  Algieba: "Suave.",
};

const ESTILO_POR_DEFECTO =
  "Narra en español de México, con calidez y autoridad, ritmo pausado y seguro, " +
  "como quien le explica un sistema a un dueño de restaurante sin venderle humo. " +
  "Sin entusiasmo publicitario. Respeta los signos de puntuación como pausas reales.";

// --- Argumentos ---------------------------------------------------------------

function parsearArgumentos(argv) {
  const opciones = {
    voz: "Charon",
    pausa: 550,
    // El plan gratuito admite 3 peticiones por minuto: 21 s entre bloques deja
    // margen. Con plan de pago, --ritmo 0 y el guion sale en segundos.
    ritmo: 21000,
    // 1 = ritmo natural. 1.5 = como se cuenta en redes.
    velocidad: 1,
    estilo: ESTILO_POR_DEFECTO,
    seco: false,
  };
  const sueltos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--listar-voces") opciones.listarVoces = true;
    else if (a === "--listar-modelos") opciones.listarModelos = true;
    else if (a === "--seco") opciones.seco = true;
    else if (a === "--salida") opciones.salida = argv[++i];
    else if (a === "--voz") opciones.voz = argv[++i];
    else if (a === "--modelo") opciones.modelo = argv[++i];
    else if (a === "--pausa") opciones.pausa = Number(argv[++i]);
    else if (a === "--ritmo") opciones.ritmo = Number(argv[++i]);
    else if (a === "--velocidad") opciones.velocidad = Number(argv[++i]);
    else if (a === "--estilo") opciones.estilo = argv[++i];
    else if (a.startsWith("--")) fallar("Opción desconocida: " + a);
    else sueltos.push(a);
  }
  opciones.guion = sueltos[0];
  return opciones;
}

function fallar(mensaje) {
  console.error("\n  x " + mensaje + "\n");
  process.exit(1);
}

// --- Llave --------------------------------------------------------------------

/**
 * Lee `video/.env` sin dependencias. Un archivo con dos llaves dentro no
 * justifica arrastrar un paquete al proyecto.
 */
function cargarEntorno() {
  const ruta = resolve(RAIZ_VIDEO, ".env");
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte === -1) continue;
    const clave = limpia.slice(0, corte).trim();
    const valor = limpia
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (valor && !process.env[clave]) process.env[clave] = valor;
  }
}

function llave() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) {
    fallar(
      "Falta GEMINI_API_KEY.\n" +
        "    Copia video/.env.example a video/.env y pega ahí la llave\n" +
        "    de Google AI Studio (https://aistudio.google.com/apikey).",
    );
  }
  return k;
}

// --- Modelo -------------------------------------------------------------------

async function catalogoDeModelos() {
  const r = await fetch(API + "/models?pageSize=200&key=" + llave());
  if (!r.ok) fallar("El catálogo de modelos respondió " + r.status + ": " + (await r.text()));
  const { models = [] } = await r.json();
  return models;
}

/** Los modelos de voz se anuncian con "tts" en el nombre y generan por generateContent. */
function esModeloDeVoz(m) {
  const nombre = (m.name || "").toLowerCase();
  const metodos = m.supportedGenerationMethods || [];
  return nombre.includes("tts") && metodos.includes("generateContent");
}

/**
 * Elige el TTS vigente. Preferimos "flash" sobre "pro": para narración comercial
 * la diferencia de calidad no se oye y el flash cuesta bastante menos.
 */
async function descubrirModelo() {
  const candidatos = (await catalogoDeModelos()).filter(esModeloDeVoz);
  if (candidatos.length === 0) {
    fallar(
      "Ningún modelo de texto-a-voz disponible para esta llave.\n" +
        "    Revisa con: node voz-gemini.mjs --listar-modelos",
    );
  }
  const flash = candidatos.find((m) => m.name.toLowerCase().includes("flash"));
  const elegido = (flash || candidatos[0]).name.replace(/^models\//, "");
  console.log("  · modelo de voz: " + elegido);
  return elegido;
}

// --- Síntesis -----------------------------------------------------------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Segundos que el propio Google pide esperar, si los dice. El 429 del plan
 * gratuito trae un `RetryInfo` con el retraso exacto: hacerle caso es más
 * barato que adivinar.
 */
function retrasoSugerido(texto) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(texto);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/**
 * Un bloque de guion (párrafo) -> PCM crudo.
 *
 * El plan gratuito de Gemini permite 3 peticiones por minuto por modelo, y un
 * guion tiene más bloques que eso. Por eso aquí hay reintentos con espera
 * creciente en vez de un fallo seco: la alternativa era que el guion se
 * generara a medias y hubiera que empezar de cero.
 */
async function sintetizar(texto, { modelo, voz, estilo }) {
  const cuerpo = {
    contents: [{ parts: [{ text: estilo + "\n\n" + texto }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
    },
  };

  const INTENTOS = 6;
  let espera = 8000;
  let r;
  for (let intento = 1; ; intento++) {
    r = await fetch(API + "/models/" + modelo + ":generateContent?key=" + llave(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (r.ok) break;

    const detalle = await r.text();
    const recuperable = r.status === 429 || r.status >= 500;
    if (!recuperable || intento >= INTENTOS) {
      fallar("Gemini respondió " + r.status + ":\n" + detalle.slice(0, 1200));
    }
    const pausa = retrasoSugerido(detalle) || espera;
    process.stdout.write("(" + r.status + ", reintento en " + Math.round(pausa / 1000) + " s) ");
    await dormir(pausa);
    espera = Math.min(espera * 2, 60000);
  }

  const datos = await r.json();
  const parte = datos?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!parte) {
    fallar(
      "Gemini no devolvió audio. Respuesta:\n" +
        JSON.stringify(datos, null, 2).slice(0, 900),
    );
  }
  return Buffer.from(parte.inlineData.data, "base64");
}

function silencio(ms) {
  return Buffer.alloc(Math.round((MUESTREO * (BITS / 8) * CANALES * ms) / 1000));
}

/** Gemini devuelve PCM pelado; el WAV es ese PCM con 44 bytes de cabecera. */
function envolverEnWav(pcm) {
  const cabecera = Buffer.alloc(44);
  const bytesPorMuestra = (BITS / 8) * CANALES;
  cabecera.write("RIFF", 0);
  cabecera.writeUInt32LE(36 + pcm.length, 4);
  cabecera.write("WAVE", 8);
  cabecera.write("fmt ", 12);
  cabecera.writeUInt32LE(16, 16); // tamaño del bloque fmt
  cabecera.writeUInt16LE(1, 20); // 1 = PCM sin comprimir
  cabecera.writeUInt16LE(CANALES, 22);
  cabecera.writeUInt32LE(MUESTREO, 24);
  cabecera.writeUInt32LE(MUESTREO * bytesPorMuestra, 28);
  cabecera.writeUInt16LE(bytesPorMuestra, 32);
  cabecera.writeUInt16LE(BITS, 34);
  cabecera.write("data", 36);
  cabecera.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cabecera, pcm]);
}

function duracion(pcm) {
  return pcm.length / (MUESTREO * (BITS / 8) * CANALES);
}

/**
 * Acelera (o frena) el WAV ya escrito, conservando el tono.
 *
 * Para redes el guion se cuenta más rápido, pero pedirle a Gemini que "hable
 * deprisa" da un resultado distinto en cada bloque y desbarata el cuadre. Aquí
 * se sintetiza a ritmo natural y se estira el resultado con `atempo`, que es
 * exacto: los tiempos de cada frase se dividen por el mismo factor y el video
 * sigue cuadrando al milisegundo.
 *
 * `atempo` admite de 0.5 a 2.0 en un solo paso; fuera de ahí se encadena.
 */
function acelerar(ruta, factor) {
  const cadena = [];
  let resto = factor;
  while (resto > 2) {
    cadena.push("atempo=2.0");
    resto /= 2;
  }
  while (resto < 0.5) {
    cadena.push("atempo=0.5");
    resto /= 0.5;
  }
  cadena.push("atempo=" + resto.toFixed(6));

  const temporal = ruta.replace(/\.wav$/i, "") + ".natural.wav";
  const r1 = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", ruta, "-c:a", "pcm_s16le", temporal], {
    encoding: "utf8",
  });
  if (r1.error || r1.status !== 0) {
    fallar(
      "No se pudo preparar el audio para acelerarlo. ¿Está ffmpeg en el PATH?\n    " +
        (r1.error?.message || r1.stderr || ""),
    );
  }
  const r2 = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", temporal, "-filter:a", cadena.join(","), "-c:a", "pcm_s16le", ruta],
    { encoding: "utf8" },
  );
  if (r2.error || r2.status !== 0) {
    fallar("ffmpeg falló al acelerar:\n    " + (r2.error?.message || r2.stderr || ""));
  }
  return temporal;
}

// --- Principal ----------------------------------------------------------------

async function principal() {
  cargarEntorno();
  const op = parsearArgumentos(process.argv.slice(2));

  if (op.listarVoces) {
    console.log("\n  Voces de Gemini seleccionadas para MotRest:\n");
    for (const [nombre, para] of Object.entries(VOCES)) {
      console.log("    " + nombre.padEnd(12) + para);
    }
    console.log("");
    return;
  }

  if (op.listarModelos) {
    const modelos = await catalogoDeModelos();
    const voz = modelos.filter(esModeloDeVoz);
    console.log("\n  " + voz.length + " modelo(s) de voz disponibles para esta llave:\n");
    for (const m of voz) console.log("    " + m.name.replace(/^models\//, ""));
    console.log("");
    return;
  }

  if (!op.guion) {
    fallar(
      "Falta el archivo de guion.\n" +
        "    Uso: node voz-gemini.mjs <guion.txt> [--salida narracion.wav]",
    );
  }
  if (!VOCES[op.voz]) {
    console.warn('  ! La voz "' + op.voz + '" no está en la lista conocida; se envía igual.');
  }

  const rutaGuion = resolve(process.cwd(), op.guion);
  if (!existsSync(rutaGuion)) fallar("No existe el guion: " + rutaGuion);

  const bloques = (await readFile(rutaGuion, "utf8"))
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const salida = resolve(
    process.cwd(),
    op.salida || rutaGuion.replace(/(-voz)?\.txt$/, ".wav"),
  );

  console.log("\n  Guion   " + basename(rutaGuion) + " · " + bloques.length + " bloques");
  console.log("  Voz     " + op.voz);
  console.log("  Pausa   " + op.pausa + " ms entre bloques");
  console.log("  Salida  " + salida + "\n");

  if (op.seco) {
    bloques.forEach((b, i) => console.log("  [" + (i + 1) + "] " + b.slice(0, 70) + "…"));
    console.log("\n  (--seco: no se llamó a la API)\n");
    return;
  }

  const modelo = op.modelo || (await descubrirModelo());
  const piezas = [];
  const tiempos = [];
  let reloj = 0;
  for (const [i, bloque] of bloques.entries()) {
    if (i > 0 && op.ritmo > 0) await dormir(op.ritmo);
    process.stdout.write("  [" + (i + 1) + "/" + bloques.length + "] sintetizando… ");
    const pcm = await sintetizar(bloque, { modelo, voz: op.voz, estilo: op.estilo });
    const dur = duracion(pcm);
    console.log(dur.toFixed(1) + " s");
    if (i > 0) {
      piezas.push(silencio(op.pausa));
      reloj += op.pausa / 1000;
    }
    piezas.push(pcm);
    tiempos.push({
      id: "b" + (i + 1),
      texto: bloque.replace(/\s+/g, " "),
      inicio: Number(reloj.toFixed(3)),
      fin: Number((reloj + dur).toFixed(3)),
    });
    reloj += dur;
  }

  const pcm = Buffer.concat(piezas);
  await mkdir(dirname(salida), { recursive: true });
  await writeFile(salida, envolverEnWav(pcm));

  let duracionFinal = duracion(pcm);
  let tiemposFinales = tiempos;
  if (op.velocidad !== 1) {
    process.stdout.write("\n  acelerando a " + op.velocidad + "x… ");
    const natural = acelerar(salida, op.velocidad);
    console.log("hecho (queda también " + basename(natural) + ", a ritmo natural)");
    // Al estirar el audio de forma uniforme, cada marca de tiempo se divide por
    // el mismo factor. No hay que volver a medir nada.
    duracionFinal = duracionFinal / op.velocidad;
    tiemposFinales = tiempos.map((t) => ({
      ...t,
      inicio: Number((t.inicio / op.velocidad).toFixed(3)),
      fin: Number((t.fin / op.velocidad).toFixed(3)),
    }));
  }

  // Los tiempos por frase salen gratis de haber sintetizado bloque por bloque:
  // sabemos exactamente dónde empieza y termina cada uno. Eso basta para los
  // subtítulos del video y ahorra montar whisper solo para volver a averiguar
  // algo que este script ya sabe. (Solo el karaoke palabra-por-palabra pediría
  // transcripción de verdad: `npx hyperframes transcribe`.)
  const rutaTiempos = salida.replace(/\.wav$/i, "") + ".tiempos.json";
  await writeFile(
    rutaTiempos,
    JSON.stringify(
      {
        audio: basename(salida),
        muestreo: MUESTREO,
        velocidad: op.velocidad,
        duracion: Number(duracionFinal.toFixed(3)),
        bloques: tiemposFinales,
      },
      null,
      2,
    ),
  );

  console.log("\n  OK  " + basename(salida) + " · " + duracionFinal.toFixed(1) + " s en total");
  console.log("  OK  " + basename(rutaTiempos) + " · " + tiemposFinales.length + " frases con sus tiempos\n");
  console.log("  Los subtítulos del video se arman con ese .tiempos.json.");
  console.log("  Si algún día quieres karaoke palabra por palabra:");
  console.log('    npx hyperframes transcribe "' + salida + '" --model small --language es\n');
}

principal().catch((e) => fallar(e.stack || e.message));
