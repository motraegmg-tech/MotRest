import basicSsl from "@vitejs/plugin-basic-ssl";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

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
  server: {
    port: 5173,
    // Accesible desde las tablets y celulares de la red del local.
    host: true,
  },
});
