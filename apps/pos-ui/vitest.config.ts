import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

/**
 * El complemento de Svelte es necesario para probar los stores: los archivos
 * `*.svelte.ts` usan runes y hay que compilarlos.
 */
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: "node",
    setupFiles: ["./src/lib/__tests__/preparar.ts"],
  },
});
