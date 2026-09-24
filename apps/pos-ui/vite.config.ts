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
/**
 * MotRest en la web (1.6.0): `vite build --mode web`, lo que publica Vercel.
 *
 * Tres valores PÚBLICOS que la web necesita y que la caja no: dónde está la
 * nube, su llave publicable y la pública de licencias de MOTRAE. Van con valor
 * por defecto, igual que en `apps/hub/empaquetar.mjs`, porque no son secretos
 * y porque una web compilada sin ellos no deja entrar a nadie —y sin la pública
 * de licencias, un restaurante en nube saldría con la licencia «sin verificar»
 * y quedaría BLOQUEADO—. Se pueden sustituir con variables de entorno.
 *
 * La pública de licencias es la misma que lleva el Hub (`llaves-motrae.ts`),
 * sacada del hub.cjs 1.5.7 y comprobada: la otra literal verifica
 * `docs/motrest.json`, así que es la de actualizaciones.
 */
function valoresDeLaWeb(): Record<string, string> {
  const url = (process.env.VITE_SUPABASE_URL ?? "https://ixttslqbbwqfcqjmttyg.supabase.co").trim();
  const publicable = (process.env.VITE_SUPABASE_PUBLICABLE ?? "sb_publishable_dcYaU3LejSfVFJDtZQ6XBw_tVl_dPW0").trim();
  const licencias = (
    process.env.VITE_MOTREST_LICENCIA_PUBLICA ?? "MCowBQYDK2VwAyEAC83o5lSMLQ7ciyKGFCXG1LDjqHqxdx2zFOqaU5/z82s="
  ).trim();
  if (!url.startsWith("https://")) throw new Error(`VITE_SUPABASE_URL tiene que ser https://: ${url}`);
  if (!/^sb_publishable_/.test(publicable)) throw new Error("VITE_SUPABASE_PUBLICABLE no parece una llave publicable");
  if (!/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/.test(licencias)) {
    throw new Error("VITE_MOTREST_LICENCIA_PUBLICA no parece una pública Ed25519");
  }
  return {
    "import.meta.env.VITE_MOTREST_WEB": JSON.stringify("1"),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
    "import.meta.env.VITE_SUPABASE_PUBLICABLE": JSON.stringify(publicable),
    "import.meta.env.VITE_MOTREST_LICENCIA_PUBLICA": JSON.stringify(licencias),
  };
}

/*
 * EN VERCEL SOLO SE COMPILA LA WEB. Vercel pone `VERCEL=1` al compilar. Si ahí
 * se corre `vite build` a secas —rama equivocada, comando sobrescrito en el
 * tablero—, sale el POS de la caja: sin «Entra a tu restaurante» y abriendo en el
 * alta de un responsable de ningún restaurante. Pasó el 23-sep-2026. Mejor que
 * el despliegue falle diciendo por qué.
 */
function exigirModoWebEnVercel(mode: string): void {
  if (process.env.VERCEL === "1" && mode !== "web") {
    throw new Error(
      "En Vercel la web se compila con `pnpm run build:web` (vite build --mode web). " +
        "Revisa que el Root Directory sea apps/pos-ui y que no haya un Build Command sobrescrito en el tablero.",
    );
  }
}

export default defineConfig(({ mode }) => (exigirModoWebEnVercel(mode), {
  plugins: [svelte(), basicSsl()],
  define: {
    __MOTREST_VERSION__: JSON.stringify(VERSION),
    ...(mode === "web" ? valoresDeLaWeb() : {}),
  },
  server: {
    port: 5173,
    // Accesible desde las tablets y celulares de la red del local.
    host: true,
  },
}));
