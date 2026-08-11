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
const version = JSON.parse(readFileSync(join(aqui, "package.json"), "utf8")).version;

if (typeof version !== "string" || !version) {
  throw new Error("No se encontró una versión válida en apps/hub/package.json.");
}

/**
 * El binario lleva las llaves públicas, nunca las privadas. Validarlas aquí
 * evita producir un instalador que parezca sano pero rechace cada licencia al
 * llegar al restaurante por una llave mal copiada.
 */
async function llavePublicaDeEntorno(nombre) {
  const texto = process.env[nombre]?.trim() ?? "";
  if (!texto) {
    throw new Error(
      `Falta ${nombre}. Genera los pares en MotRest Central y pasa la llave pública al empaquetado.`,
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

/**
 * El Node que corre esto ES el Node que se instala en el restaurante.
 *
 * Más abajo hay un `copyFileSync(process.execPath, exe)`: el ejecutable del Hub
 * se fabrica copiando el propio intérprete y metiéndole el código dentro. No es
 * un detalle de implementación — significa que la versión de Node que acabe en
 * la caja de Rodizio es, literalmente, la que tuviera en el PATH quien empaquetó
 * ese día.
 *
 * Por eso esto **aborta** en vez de avisar. Los síntomas de empaquetar con la
 * versión equivocada no aparecen aquí, aparecen en el restaurante: `node:sqlite`
 * no existe antes de Node 22 y el Hub no arranca, y entre versiones cercanas las
 * diferencias son sutiles y salen un viernes por la noche. Un instalador se
 * fabrica una vez y se instala muchas: es el peor sitio para "seguramente da
 * igual".
 *
 * La versión buena vive en `.nvmrc`, que es el mismo archivo que lee CI. Un solo
 * sitio donde cambiarla.
 */
function comprobarVersionDeNode() {
  const esperada = readFileSync(resolve(aqui, "../../.nvmrc"), "utf8").trim();
  const actual = process.version.replace(/^v/, "");

  if (actual !== esperada) {
    throw new Error(
      `Este empaquetado tiene que hacerse con Node ${esperada}, y se está usando ${actual}.\n` +
        `El ejecutable del Hub es una copia del Node que corre este script, así que esa\n` +
        `diferencia viajaría a todos los restaurantes.\n\n` +
        `  nvm use ${esperada}    (o instala esa versión y vuelve a intentarlo)`,
    );
  }
}

comprobarVersionDeNode();

const [LLAVE_PUBLICA_LICENCIAS, LLAVE_PUBLICA_ACTUALIZACIONES] = await Promise.all([
  llavePublicaDeEntorno("MOTREST_LICENCIA_PUBLICA"),
  llavePublicaDeEntorno("MOTREST_ACTUALIZACIONES_PUBLICA"),
]);

/**
 * De dónde bajará las actualizaciones el Hub que se instale en el restaurante.
 *
 * VIAJA DENTRO DEL BINARIO, y esa es la corrección. Antes solo se leía de una
 * variable de entorno en la máquina del local: el instalador NSIS no la escribe
 * y Tauri lanza el Hub sin entorno propio, así que **ningún restaurante tenía el
 * canal encendido** y ninguno llegaba a preguntar si había versión nueva. Se
 * descubrió con el canal apagado en la caja de Rodizio.
 *
 * No es un secreto —dice de dónde se baja, no autoriza nada— y por eso, a
 * diferencia de las llaves, tiene un valor por defecto en vez de abortar.
 */
const REPOSITORIO_ACTUALIZACIONES = (
  process.env.MOTREST_ACTUALIZACIONES_REPO?.trim() || "motrae/motrest"
);

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(REPOSITORIO_ACTUALIZACIONES)) {
  throw new Error(
    `MOTREST_ACTUALIZACIONES_REPO="${REPOSITORIO_ACTUALIZACIONES}" no tiene la forma dueño/repositorio.\n` +
      "El Hub lo rechazaría al arrancar y el local se quedaría sin actualizaciones en silencio.",
  );
}

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
    __MOTREST_ACTUALIZACIONES_REPO__: JSON.stringify(REPOSITORIO_ACTUALIZACIONES),
    __MOTREST_VERSION__: JSON.stringify(version),
  },
});

// El ejecutable SEA vive solo en la carpeta de la instalación: no puede subir
// un nivel para leer apps/hub/package.json. Si la sustitución anterior no
// eliminó esa ruta, abortamos aquí en vez de entregar una caja que no arranca.
if (readFileSync(join(salida, "hub.cjs"), "utf8").includes("../package.json")) {
  throw new Error("El Hub empaquetado aún depende de ../package.json y no puede instalarse.");
}

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

/*
 * AQUÍ, y no antes, es donde se firma el Hub.
 *
 * El orden no es negociable: la inyección del código dentro del ejecutable
 * modifica sus bytes, así que cualquier firma anterior queda inválida —por eso
 * unas líneas más arriba se quita la de Node—. Firmar antes de `inject` sería
 * producir un ejecutable que Windows rechaza por firma rota.
 *
 * Y hay que firmar el sidecar aparte, no basta con firmar el instalador: la
 * firma del instalador acredita al INSTALADOR, y una vez instalado, el que se
 * ejecuta cada mañana en la caja es este archivo. Sin firma propia, nada
 * distingue al Hub de MOTRAE de un ejecutable que alguien haya dejado en su
 * lugar en la carpeta del programa.
 *
 * Está cableado a una variable de entorno porque el certificado Authenticode es
 * un trámite comercial que todavía no está cerrado. El día que llegue, esto se
 * enciende poniendo la huella y no hay que tocar código.
 */
const HUELLA_FIRMA = process.env.MOTREST_FIRMA_HUELLA?.trim();

if (HUELLA_FIRMA) {
  console.log("3.5/4  Firmando el Hub…");
  execFileSync(
    "signtool",
    [
      "sign",
      "/sha1",
      HUELLA_FIRMA,
      "/fd",
      "SHA256",
      // El sellado de tiempo no es opcional: sin él la firma deja de valer el
      // día que caduque el certificado, y en las cajas ya instaladas.
      "/tr",
      "http://timestamp.sectigo.com",
      "/td",
      "SHA256",
      exe,
    ],
    { stdio: "inherit" },
  );
  // Se verifica lo que acaba de salir, no se da por bueno: `signtool sign`
  // puede terminar bien y dejar una firma que no valida.
  execFileSync("signtool", ["verify", "/pa", "/v", exe], { stdio: "inherit" });
} else {
  console.log(
    "\n  AVISO: el Hub sale SIN FIRMAR (falta MOTREST_FIRMA_HUELLA).\n" +
      "  Sirve para probar. Para lo que se instala en un restaurante, no:\n" +
      "  ver docs/FIRMA-DEL-INSTALADOR.md.\n",
  );
}

console.log("4/4  Copiando donde Tauri lo espera…");
mkdirSync(destinoTauri, { recursive: true });
copyFileSync(exe, join(destinoTauri, `motrest-hub-${SUFIJO}.exe`));

console.log(`\nListo: ${join(destinoTauri, `motrest-hub-${SUFIJO}.exe`)}\n`);
