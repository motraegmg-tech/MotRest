import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * MOTRAE Central corre en la máquina de Gonzalo, no en ningún restaurante.
 *
 * Puerto propio para poder tenerla abierta al mismo tiempo que un MotRest de
 * pruebas (5173) y que el portal del comensal (5174) — que es exactamente lo que
 * se hace al preparar una actualización: verla en Central y comprobarla en el
 * POS de al lado antes de publicarla.
 */
export default defineConfig({
  server: { port: 5180 },
  plugins: [svelte()],
  build: { target: "es2022" },
});
