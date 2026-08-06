import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

/**
 * El complemento de Svelte hace falta para probar el store: `central.svelte.ts`
 * usa runes y hay que compilarlo.
 */
export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: { environment: "node" },
});
