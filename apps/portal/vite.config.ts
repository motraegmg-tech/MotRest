import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * El portal se sirve DESDE EL HUB, bajo `/portal/`.
 *
 * Comparte origen con la API que consume, así que no hay CORS que negociar ni
 * un segundo certificado que aceptar. Y como vive en el Hub, funciona con el
 * internet del local caído: el teléfono del comensal solo necesita el wifi.
 */
export default defineConfig({
  base: "/portal/",
  plugins: [svelte()],
  build: { target: "es2022" },
});
