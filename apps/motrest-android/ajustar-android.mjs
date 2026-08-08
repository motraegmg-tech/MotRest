/** Mantiene el número de versión del APK alineado con MotRest. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const paquete = JSON.parse(readFileSync(resolve(aqui, "package.json"), "utf8"));
const version = paquete.version;
const partes = String(version).split(".").map(Number);

if (partes.length !== 3 || partes.some((parte) => !Number.isInteger(parte) || parte < 0)) {
  throw new Error(`Versión Android inválida: ${version}`);
}

const versionCode = partes[0] * 1_000_000 + partes[1] * 1_000 + partes[2];
const gradle = resolve(aqui, "android", "app", "build.gradle");

if (!existsSync(gradle)) {
  throw new Error("Falta android/app/build.gradle; ejecuta primero cap sync android.");
}

const anterior = readFileSync(gradle, "utf8");
const conCodigo = anterior.replace(/^\s*versionCode\s+\d+\s*$/m, `        versionCode ${versionCode}`);
const siguiente = conCodigo.replace(/^\s*versionName\s+"[^"]+"\s*$/m, `        versionName "${version}"`);

if (siguiente === anterior) {
  throw new Error("No se encontraron versionCode/versionName en android/app/build.gradle.");
}

writeFileSync(gradle, siguiente);
console.log(`Android preparado: versionName ${version} · versionCode ${versionCode}`);
