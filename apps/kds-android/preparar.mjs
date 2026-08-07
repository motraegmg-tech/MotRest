/**
 * Prepara lo que Capacitor empaqueta en el APK del KDS.
 *
 * La pantalla de cocina NO es una aplicación aparte: es el mismo POS, abierto
 * en su módulo de cocina. Mantener dos aplicaciones significaría dos versiones
 * del tablero, dos veces los arreglos y dos oportunidades de que se
 * desincronicen.
 *
 * Lo que aporta el APK es lo que un navegador no puede dar en una tablet de
 * cocina: pantalla completa sin barras, la pantalla que no se apaga a media
 * comanda, y arrancar sola al encender.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const origen = resolve(aqui, "../pos-ui/dist");
const destino = resolve(aqui, "www");

if (!existsSync(join(origen, "index.html"))) {
  console.error("Falta el POS compilado.");
  console.error("  Ejecuta antes:  corepack pnpm@9.15.0 --filter pos-ui build");
  process.exit(1);
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
cpSync(origen, destino, { recursive: true });

/*
 * La tablet arranca directo en el tablero de cocina.
 *
 * El POS enruta por hash, así que basta con dejar la ruta escrita. Nadie
 * debería tener que navegar hasta cocina cada vez que se enciende la pantalla.
 */
const indice = join(destino, "index.html");
const html = readFileSync(indice, "utf8");
writeFileSync(
  indice,
  html.replace(
    "</head>",
    `  <script>
      // Pantalla de cocina por omisión. Si alguien navega a otro módulo, se
      // respeta: solo se fija la ruta cuando no hay ninguna.
      if (!location.hash) location.hash = "#/cocina/tablero";
    </script>
  </head>`,
  ),
);

console.log(`Listo: ${destino}`);
