/**
 * Empaqueta el POS completo en la aplicación Android de MotRest.
 *
 * A diferencia del APK de Cocina, aquí no se fuerza ninguna ruta: el router
 * del POS abre Venta y, tras iniciar sesión, cada usuario solo ve los módulos
 * y las acciones que sus permisos le permiten.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const aqui = dirname(fileURLToPath(import.meta.url));
const origen = resolve(aqui, "../pos-ui/dist");
const destino = resolve(aqui, "www");

if (!existsSync(resolve(origen, "index.html"))) {
  console.error("Falta el POS compilado.");
  console.error("  Ejecuta antes: corepack pnpm@9.15.0 --filter pos-ui build");
  process.exit(1);
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
cpSync(origen, destino, { recursive: true });

if (!existsSync(resolve(aqui, "android"))) {
  const cli = resolve(aqui, "node_modules", "@capacitor", "cli", "bin", "capacitor");
  if (!existsSync(cli)) {
    console.error("Falta la CLI local de Capacitor. Ejecuta pnpm install.");
    process.exit(1);
  }
  const resultado = spawnSync(process.execPath, [cli, "add", "android"], {
    cwd: aqui,
    stdio: "inherit",
  });
  if (resultado.status !== 0) process.exit(resultado.status ?? 1);
}

console.log(`Listo: ${destino}`);
