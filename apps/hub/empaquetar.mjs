/**
 * Convierte el Hub en UN ejecutable, para que Tauri lo meta en el instalador.
 *
 * POR QUÉ ESTO ES NECESARIO
 *
 * El Hub es TypeScript que corre sobre Node. Pedirle a un restaurantero que
 * instale Node, clone un repositorio y ejecute comandos no es instalar un
 * producto. El criterio de la etapa 12 es "un instalador que un tercero instala
 * solo", y para eso el Hub tiene que ser un archivo que se copia y se ejecuta.
 *
 * CÓMO
 *
 * 1. esbuild junta todo el TypeScript en un solo archivo JavaScript.
 * 2. Node incrusta ese archivo dentro de una copia de `node.exe` (SEA).
 *
 * El resultado pesa lo que pesa Node —unos 100 MB— porque lleva el motor
 * dentro. Es el precio de que la máquina destino no necesite nada instalado.
 *
 * `node:sqlite` NO se empaqueta: es parte de Node y viaja en el propio
 * ejecutable. Por eso el Hub exige Node 22 o superior.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = resolve(aqui, "dist-sea");
/** Dónde espera Tauri el binario, con el sufijo de plataforma que exige. */
const destinoTauri = resolve(aqui, "../escritorio/src-tauri/binarios");
const SUFIJO = "x86_64-pc-windows-msvc";

/**
 * El binario lleva las llaves públicas, nunca las privadas. Validarlas aquí
 * evita producir un instalador que parezca sano pero rechace cada licencia al
 * llegar al restaurante por una llave mal copiada.
 */
async function llavePublicaDeEntorno(nombre) {
  const texto = process.env[nombre]?.trim() ?? "";
  if (!texto) {
    throw new Error(
      `Falta ${nombre}. Genera los pares en MOTRAE Central y pasa la llave pública al empaquetado.`,
    );
  }

  try {
    const bytes = Buffer.from(texto, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== texto) {
      throw new Error("no es base64 canónico");
    }
    await crypto.subtle.importKey("spki", bytes, "Ed25519", false, ["verify"]);
    return texto;
  } catch (causa) {
    throw new Error(`${nombre} no es una llave pública Ed25519 SPKI válida: ${String(causa)}`);
  }
}

const [LLAVE_PUBLICA_LICENCIAS, LLAVE_PUBLICA_ACTUALIZACIONES] = await Promise.all([
  llavePublicaDeEntorno("MOTREST_LICENCIA_PUBLICA"),
  llavePublicaDeEntorno("MOTREST_ACTUALIZACIONES_PUBLICA"),
]);

console.log("1/4  Juntando el Hub en un solo archivo…");
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

await build({
  entryPoints: [join(aqui, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  // CommonJS porque el empaquetado de Node todavía trata el módulo ESM como
  // experimental, y esto tiene que arrancar en la caja de un restaurante.
  format: "cjs",
  outfile: join(salida, "hub.cjs"),
  // Node los trae dentro; empaquetarlos rompería `node:sqlite`.
  external: ["node:*"],
  minify: true,
  // El mensaje de un fallo en producción tiene que apuntar al código real.
  sourcemap: "inline",
  banner: {
    js: [
      "// MotRest Hub — generado por empaquetar.mjs. No editar.",
      // El bundle en CJS pierde `import.meta.url`; se repone para que
      // `createRequire` de sqlite.ts siga funcionando.
      "const import_meta_url = require('node:url').pathToFileURL(__filename).href;",
    ].join("\n"),
  },
  define: {
    "import.meta.url": "import_meta_url",
    __MOTREST_LICENCIA_PUBLICA__: JSON.stringify(LLAVE_PUBLICA_LICENCIAS),
    __MOTREST_ACTUALIZACIONES_PUBLICA__: JSON.stringify(LLAVE_PUBLICA_ACTUALIZACIONES),
  },
});

console.log("2/4  Preparando la incrustación…");
writeFileSync(
  join(salida, "sea.json"),
  JSON.stringify(
    {
      main: join(salida, "hub.cjs").replace(/\\/g, "/"),
      output: join(salida, "sea.blob").replace(/\\/g, "/"),
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(salida, "sea.json")], {
  stdio: "inherit",
});

console.log("3/4  Creando el ejecutable…");
const exe = join(salida, `motrest-hub-${SUFIJO}.exe`);
copyFileSync(process.execPath, exe);

// La firma del ejecutable de Node deja de valer al modificarlo; quitarla evita
// que Windows lo rechace por firma inválida. El instalador firma el conjunto.
try {
  execFileSync("signtool", ["remove", "/s", exe], { stdio: "ignore" });
} catch {
  // signtool no está en todas las máquinas; sin firma previa tampoco estorba.
}

/*
 * Se usa la API de postject y no su comando.
 *
 * Pasarlo por la consola rompía con rutas que llevan espacios —"Empresa
 * MOTRAE"— porque los argumentos se unen sin comillas. La API recibe las rutas
 * como valores y no tiene ese problema.
 */
await inject(exe, "NODE_SEA_BLOB", readFileSync(join(salida, "sea.blob")), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

console.log("4/4  Copiando donde Tauri lo espera…");
mkdirSync(destinoTauri, { recursive: true });
copyFileSync(exe, join(destinoTauri, `motrest-hub-${SUFIJO}.exe`));

console.log(`\nListo: ${join(destinoTauri, `motrest-hub-${SUFIJO}.exe`)}\n`);
