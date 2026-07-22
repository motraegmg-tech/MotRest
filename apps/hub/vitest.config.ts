import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const enPaquete = (ruta: string) =>
  fileURLToPath(new URL(`../../packages/${ruta}`, import.meta.url));

export default defineConfig({
  test: {
    // El Hub corre en Node: necesita node:sqlite, node:http y `ws`.
    environment: "node",
  },
  resolve: {
    // Explícitos porque Vite no resuelve solo los subpaths de un paquete del
    // workspace que apunta a TypeScript sin compilar.
    alias: {
      "@motrest/protocolo-sync/sqlite": enPaquete("protocolo-sync/src/sqlite.ts"),
      "@motrest/protocolo-sync": enPaquete("protocolo-sync/src/index.ts"),
      "@motrest/dominio": enPaquete("dominio/src/index.ts"),
    },
  },
});
