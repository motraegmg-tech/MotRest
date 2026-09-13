import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * La versión que el POS enseña en el pie del menú.
 *
 * Se lee de `apps/hub/package.json` y no de un archivo propio A PROPÓSITO: esa
 * es la versión que el Hub reporta en `/salud`, la que `empaquetar.mjs` mete
 * dentro del binario y la que acaba en el instalador. Dos números distintos
 * para la misma instalación es peor que no enseñar ninguno — quien llama a
 * soporte leería uno y el panel de MOTRAE vería el otro.
 *
 * Aborta si falta: un pie que dice «MOTRAE undefined» sale a producción sin que
 * nadie lo note hasta que un restaurante lo lee por teléfono.
 */
const VERSION: string = (() => {
  const ruta = fileURLToPath(new URL("../hub/package.json", import.meta.url));
  const version: unknown = JSON.parse(readFileSync(ruta, "utf8")).version;
  if (typeof version !== "string" || !version) {
    throw new Error("apps/hub/package.json no tiene una versión válida: el POS saldría sin número.");
  }
  return version;
})();

/**
 * El servidor de desarrollo va por HTTPS a propósito.
 *
 * Los navegadores solo exponen `crypto.subtle` en contextos seguros: HTTPS o
 * `localhost`. Sin él no se pueden verificar contraseñas ni PIN, ni cifrar el
 * canal con el Hub, ni sellar el corte de caja. Una terminal abierta como
 * `http://192.168.1.50:5173` —el caso normal de una tablet en el salón— se
 * quedaba sin ninguna de las tres cosas.
 *
 * El certificado es autofirmado, así que la primera vez cada terminal muestra
 * un aviso que hay que aceptar. Es incómodo y por eso NO es la solución final:
 * la aplicación instalada de la etapa 12 corre en un origen que siempre es
 * seguro y este problema desaparece. Mientras tanto, esto permite probar el
 * local completo con varios dispositivos de verdad.
 */
export default defineConfig({
  plugins: [svelte(), basicSsl()],
  define: {
    __MOTREST_VERSION__: JSON.stringify(VERSION),
  },
  server: {
    port: 5173,
    // Accesible desde las tablets y celulares de la red del local.
    host: true,
  },
});
