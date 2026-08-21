/**
 * Junta el relay en dos archivos que Node ejecuta sin nada más instalado.
 *
 * POR QUÉ NO SE DESPLIEGA EL WORKSPACE TAL CUAL
 *
 * En desarrollo el relay se corre con `tsx src/main.ts`, que necesita el
 * monorepo entero: tsx, TypeScript, vitest y `@motrest/dominio` como fuente. En
 * la nube eso significaría meter en el único componente de MotRest expuesto a
 * internet un compilador, un ejecutor de pruebas y las fuentes de todo lo demás.
 * Lo que va al servidor es lo que hace falta para atender: dos archivos y Node.
 *
 * SON DOS Y NO UNO
 *
 *   relay.cjs   el servicio: webhook de Meta, enlaces de los Hubs, /pulsos
 *   padron.cjs  el alta de restaurantes, que se corre A MANO dentro del servidor
 *
 * El padrón vive en el disco del relay y está cifrado con una llave que solo
 * existe en su entorno, así que dar de alta un restaurante se hace ahí dentro
 * (`fly ssh console`) y no desde la máquina de nadie. Por eso su CLI viaja en la
 * imagen: sin él, el servidor tendría el padrón pero no con qué escribirlo.
 *
 * CJS, COMO EL HUB
 *
 * `ws` carga `bufferutil` y `utf-8-validate` con un `require` dentro de un
 * try/catch: son aceleradores opcionales en C++. En CommonJS ese require queda
 * tal cual y falla en silencio hacia la implementación en JavaScript, que es lo
 * que se quiere. Convertido a ESM sería un import estático y el relay no
 * arrancaría por culpa de una dependencia que ni siquiera necesita.
 */
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = resolve(aqui, "dist");

/**
 * La versión de Node del contenedor es la que manda, y está en `.nvmrc`.
 *
 * Un solo sitio donde cambiarla: el mismo archivo que lee CI y el que decide
 * qué Node se empaqueta en el Hub del restaurante. Si aquí se compilara para
 * una versión y el Dockerfile arrancara otra, el desajuste saldría en
 * producción y no en el build.
 */
const nodeDelProyecto = readFileSync(resolve(aqui, "../../.nvmrc"), "utf8").trim();
const objetivo = `node${nodeDelProyecto.split(".")[0]}`;

rmSync(salida, { recursive: true, force: true });

for (const [entrada, archivo] of [
  ["src/main.ts", "relay.cjs"],
  ["src/padron-cli.ts", "padron.cjs"],
]) {
  await build({
    entryPoints: [join(aqui, entrada)],
    bundle: true,
    platform: "node",
    target: objetivo,
    format: "cjs",
    outfile: join(salida, archivo),
    // Node los trae dentro. Los aceleradores opcionales de `ws` se dejan fuera
    // a propósito: no se instalan y su require falla al fallback en JavaScript.
    external: ["node:*", "bufferutil", "utf-8-validate"],
    // Sin minificar. Esto corre en un servidor, no en la caja de un
    // restaurante: no hay que ahorrar megas y sí hay que poder leer una traza a
    // las once de la noche.
    sourcemap: "inline",
    banner: {
      js: [
        `// MotRest relay — generado por construir.mjs. No editar.`,
        // El bundle en CJS no tiene `import.meta.url`, y `main.ts` la usa para
        // decidir si arranca el servidor o solo se está importando.
        "const import_meta_url = require('node:url').pathToFileURL(__filename).href;",
      ].join("\n"),
    },
    define: { "import.meta.url": "import_meta_url" },
  });
  console.log(`  ${archivo}`);
}

console.log(`\nListo: ${salida}\n`);
