import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  MAX_BYTES_FOTO,
  nombreDeFoto,
  nombreDeFotoValido,
  TIPOS_FOTO,
  type TipoFoto,
} from "@motrest/dominio";
import { archivoDentroDe } from "./seguridad-http.js";

/** Devuelve la ruta absoluta de una foto segura, o null si es inválida. */
export function rutaFotoSegura(carpetaBase: string, urlPath: string): string | null {
  const nombre = urlPath.replace(/^\/foto/, "");
  if (!nombreDeFotoValido(nombre.slice(1))) return null;
  const fotosDir = join(carpetaBase, "fotos");
  return archivoDentroDe(fotosDir, nombre);
}

/** 
 * Guarda los bytes de la foto en el disco del Hub.
 * Lanza un error si hay un problema con el archivo o tipo.
 */
export function manejarSubidaFoto(
  carpetaBase: string,
  contentType: string,
  cuerpo: Buffer,
): string {
  if (cuerpo.length > MAX_BYTES_FOTO) {
    throw new Error(`La foto excede el límite de tamaño permitido (${MAX_BYTES_FOTO} bytes)`);
  }

  const tipo = contentType as TipoFoto;
  if (!(tipo in TIPOS_FOTO)) {
    throw new Error("Formato de imagen no soportado. Debe ser JPEG, PNG o WebP.");
  }

  const nombre = nombreDeFoto(tipo);
  const fotosDir = join(carpetaBase, "fotos");
  
  if (!existsSync(fotosDir)) {
    mkdirSync(fotosDir, { recursive: true });
  }

  const destino = join(fotosDir, nombre);
  writeFileSync(destino, cuerpo);
  
  return nombre;
}
