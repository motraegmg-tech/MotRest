#!/usr/bin/env node
/**
 * musica-suno.mjs — genera la pista instrumental del video con Suno.
 *
 * POR QUÉ EXISTE
 *
 * Cada video lleva una pista propia con una forma concreta: entrada sobria,
 * crecimiento a mitad y resolución limpia en el cierre. Los prompts viven en los
 * guiones (`video/guiones/*.md`) y aquí se convierten en un mp3 reproducible.
 *
 * CÓMO FUNCIONA EL PROVEEDOR
 *
 * sunoapi.org es asíncrono: `POST /api/v1/generate` devuelve un `taskId` y la
 * música llega minutos después. El proveedor ofrece callback, pero montar un
 * servidor público para recibir dos pistas no tiene sentido: aquí se sondea
 * `GET /api/v1/generate/record-info` hasta que la tarea termina. El campo
 * `callBackUrl` se manda igual porque la API lo exige.
 *
 * Suno entrega DOS versiones por generación. Se descargan las dos: casi siempre
 * una de las dos encaja mejor con el ritmo del montaje, y elegir cuesta menos que
 * volver a generar.
 *
 * USO
 *   node musica-suno.mjs --prompt-de 01          # toma el prompt del guion 01
 *   node musica-suno.mjs --prompt "Modern corporate tech, 92 BPM, instrumental…" \
 *     --titulo "MotRest Promo 1" --salida ../01-un-viernes-completo/audio/musica
 *
 *   node musica-suno.mjs --tarea <taskId>        # retoma una generación en curso
 *
 * OPCIONES
 *   --prompt-de <01|02|03>  Usa el prompt registrado para ese video
 *   --prompt "<texto>"      Descripción del estilo (instrumental)
 *   --titulo "<texto>"      Título de la pista en Suno
 *   --salida <ruta-base>    Base del nombre de salida (se añade -a.mp3 / -b.mp3)
 *   --modelo <V3_5|V4|V4_5> Modelo de Suno (por defecto: V4_5)
 *   --tarea <taskId>        Solo sondear y descargar una tarea ya lanzada
 *   --seco                  No llama a la API: enseña lo que enviaría
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_VIDEO = resolve(AQUI, "..");

/**
 * Los prompts de los tres videos, en un solo lugar para no re-teclearlos.
 * Espejo de la sección «Música» de cada guion en `video/guiones/`.
 */
const PISTAS = {
  "01": {
    titulo: "MotRest — Un viernes completo",
    salida: "../01-un-viernes-completo/audio/musica",
    prompt:
      "Modern corporate tech, warm optimism, 92 BPM, instrumental, subtle percussion " +
      "and warm pads, quiet sparse intro, builds at 0:45, confident clean resolve, 120 seconds",
  },
  "02": {
    titulo: "MotRest — Piezas sueltas",
    salida: "../02-piezas-sueltas/audio/musica",
    prompt:
      "Driving modern electronic, purposeful and confident, 118 BPM, instrumental, " +
      "tight percussion, staccato synth stabs, no vocals, hard stop at the end, 85 seconds",
  },
  "03": {
    titulo: "MotRest — Lo que se te va",
    salida: "../03-lo-que-se-te-va/audio/musica",
    prompt:
      "Tense minimal electronic that resolves into confidence, 100 BPM, instrumental, " +
      "sparse pulse, rising tension in the first half, bright resolve at 0:28, 45 seconds",
  },
};

/** El proveedor exige el campo aunque no vayamos a recibir el callback. */
const CALLBACK_INERTE = "https://motrae.com/suno/callback";

const ESPERA_MS = 15000;
const INTENTOS_MAX = 40; // 40 x 15 s = 10 minutos

// --- Argumentos ---------------------------------------------------------------

function parsearArgumentos(argv) {
  const op = { modelo: "V4_5", seco: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seco") op.seco = true;
    else if (a === "--prompt-de") op.promptDe = argv[++i];
    else if (a === "--prompt") op.prompt = argv[++i];
    else if (a === "--titulo") op.titulo = argv[++i];
    else if (a === "--salida") op.salida = argv[++i];
    else if (a === "--modelo") op.modelo = argv[++i];
    else if (a === "--tarea") op.tarea = argv[++i];
    else fallar("Opción desconocida: " + a);
  }
  return op;
}

function fallar(mensaje) {
  console.error("\n  x " + mensaje + "\n");
  process.exit(1);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Entorno ------------------------------------------------------------------

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

function credenciales() {
  const clave = process.env.SUNO_API_KEY;
  if (!clave) {
    fallar(
      "Falta SUNO_API_KEY.\n" +
        "    Copia video/.env.example a video/.env y pega ahí la llave de sunoapi.org.",
    );
  }
  const base = (process.env.SUNO_API_URL || "https://api.sunoapi.org").replace(/\/+$/, "");
  return { clave, base };
}

async function pedir(ruta, opciones = {}) {
  const { clave, base } = credenciales();
  const r = await fetch(base + ruta, {
    ...opciones,
    headers: {
      authorization: "Bearer " + clave,
      "content-type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  const texto = await r.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    fallar("Respuesta no-JSON de " + ruta + " (" + r.status + "):\n" + texto.slice(0, 400));
  }
  if (!r.ok || (datos.code && datos.code !== 200)) {
    fallar(
      "El proveedor respondió " + r.status + " / code " + datos.code + ":\n  " +
        (datos.msg || texto.slice(0, 400)),
    );
  }
  return datos.data;
}

// --- Generación ---------------------------------------------------------------

async function lanzar({ prompt, titulo, modelo }) {
  const data = await pedir("/api/v1/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      style: prompt,
      title: titulo,
      customMode: true,
      instrumental: true, // narración encima: la pista NUNCA lleva voz
      model: modelo,
      callBackUrl: CALLBACK_INERTE,
    }),
  });
  const taskId = data?.taskId || data?.task_id;
  if (!taskId) fallar("El proveedor no devolvió taskId:\n" + JSON.stringify(data, null, 2));
  return taskId;
}

/** Estados terminales de sunoapi.org: lo que no sea SUCCESS es un fallo con nombre. */
function esFallo(estado) {
  return typeof estado === "string" && /FAILED|ERROR|SENSITIVE/i.test(estado);
}

async function esperar(taskId) {
  for (let intento = 1; intento <= INTENTOS_MAX; intento++) {
    const data = await pedir("/api/v1/generate/record-info?taskId=" + encodeURIComponent(taskId));
    const estado = data?.status || data?.state || "DESCONOCIDO";
    const pistas = data?.response?.sunoData || data?.response?.data || [];
    const listas = pistas.filter((p) => p.audioUrl || p.audio_url);

    console.log(
      "  [" + intento + "/" + INTENTOS_MAX + "] " + estado +
        (listas.length ? " · " + listas.length + " pista(s) lista(s)" : ""),
    );

    if (esFallo(estado)) {
      fallar("La generación falló con estado " + estado + ": " + (data?.errorMessage || ""));
    }
    if (estado === "SUCCESS" && listas.length > 0) return listas;

    await dormir(ESPERA_MS);
  }
  fallar(
    "Se agotó la espera (" + ((ESPERA_MS * INTENTOS_MAX) / 60000) + " min).\n" +
      "    La tarea puede seguir viva. Retómala con:\n" +
      "      node musica-suno.mjs --tarea " + taskId,
  );
}

async function descargar(pistas, base) {
  const letras = ["a", "b", "c", "d"];
  const escritos = [];
  await mkdir(dirname(base), { recursive: true });
  for (const [i, pista] of pistas.entries()) {
    const url = pista.audioUrl || pista.audio_url;
    const destino = base + "-" + (letras[i] || i) + ".mp3";
    const r = await fetch(url);
    if (!r.ok) {
      console.warn("  ! No se pudo descargar la pista " + (i + 1) + " (" + r.status + ")");
      continue;
    }
    await writeFile(destino, Buffer.from(await r.arrayBuffer()));
    const seg = pista.duration ? " · " + Number(pista.duration).toFixed(0) + " s" : "";
    console.log("  OK  " + basename(destino) + seg);
    escritos.push(destino);
  }
  return escritos;
}

// --- Principal ----------------------------------------------------------------

async function principal() {
  cargarEntorno();
  const op = parsearArgumentos(process.argv.slice(2));

  if (op.promptDe) {
    const preset = PISTAS[op.promptDe];
    if (!preset) {
      fallar("No hay prompt registrado para «" + op.promptDe + "». Hay: " + Object.keys(PISTAS).join(", "));
    }
    op.prompt = op.prompt || preset.prompt;
    op.titulo = op.titulo || preset.titulo;
    op.salida = op.salida || resolve(AQUI, preset.salida);
  }

  if (!op.tarea && !op.prompt) {
    fallar(
      "Falta el prompt.\n" +
        "    node musica-suno.mjs --prompt-de 01\n" +
        "    node musica-suno.mjs --prompt \"…\" --salida ../01-.../audio/musica",
    );
  }

  const base = resolve(process.cwd(), op.salida || "musica");

  if (op.seco) {
    console.log("\n  Título   " + (op.titulo || "(sin título)"));
    console.log("  Modelo   " + op.modelo + " · instrumental");
    console.log("  Salida   " + base + "-a.mp3 / -b.mp3");
    console.log("  Prompt   " + op.prompt + "\n");
    console.log("  (--seco: no se llamó a la API)\n");
    return;
  }

  let taskId = op.tarea;
  if (!taskId) {
    console.log("\n  Generando: " + op.titulo);
    console.log("  " + op.prompt + "\n");
    taskId = await lanzar(op);
    console.log("  tarea " + taskId + " — sondeando cada " + ESPERA_MS / 1000 + " s\n");
  } else {
    console.log("\n  Retomando la tarea " + taskId + "\n");
  }

  const pistas = await esperar(taskId);
  console.log("");
  const escritos = await descargar(pistas, base);

  console.log("\n  " + escritos.length + " pista(s) descargada(s). Escúchalas y quédate con una.");
  console.log("  En la composición van partidas en tres clips con distinto data-volume");
  console.log("  (entrada · cuerpo bajo la voz · cierre): ver el guion del video.\n");
}

principal().catch((e) => fallar(e.stack || e.message));
