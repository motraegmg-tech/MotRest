/**
 * A qué archivo va cada renglón del registro del Hub.
 *
 * EL DEFECTO QUE ESTO CIERRA (23-sep-2026). La rotación por tamaño abría un
 * archivo con la hora en milisegundos en cuanto el del día pasaba de 5 MB… y el
 * renglón siguiente volvía a mirar el del día, lo veía lleno y abría otro. UN
 * ARCHIVO POR RENGLÓN. Sumado a un bucle de EPIPE (ver `main.ts`), la caja de
 * Gonzalo acumuló 1,013,561 archivos y 921 MB en 49 minutos. En un restaurante
 * eso es un disco lleno que nadie ve venir.
 *
 * Ahora hay PARTES numeradas —`hub-2026-09-23.log`, `hub-2026-09-23.1.log`,
 * `.2`…— y se escribe en la vigente hasta que se llena. La parte vigente se
 * recuerda en memoria; al arrancar se busca la primera que no esté llena.
 */
import { join } from "node:path";

export interface EstadoRegistro {
  dia: string;
  parte: number;
}

export function rutaDeParte(carpeta: string, dia: string, parte: number): string {
  return join(carpeta, parte === 0 ? `hub-${dia}.log` : `hub-${dia}.${parte}.log`);
}

/**
 * El archivo donde va el renglón de este momento.
 *
 * `tamanoDe` devuelve el tamaño en bytes, o `null` si el archivo no existe.
 * Recorre partes solo hacia adelante: con el estado en memoria, casi siempre
 * mira un único archivo.
 */
export function archivoDelRegistro(
  carpeta: string,
  dia: string,
  estado: EstadoRegistro,
  maximoBytes: number,
  tamanoDe: (ruta: string) => number | null,
): string {
  if (estado.dia !== dia) {
    estado.dia = dia;
    estado.parte = 0;
  }
  for (;;) {
    const ruta = rutaDeParte(carpeta, dia, estado.parte);
    const tamano = tamanoDe(ruta);
    if (tamano === null || tamano < maximoBytes) return ruta;
    estado.parte += 1;
  }
}

/**
 * ¿Es el error de escribir en una consola que ya no existe?
 *
 * Pasa cuando se cierra el proceso que lanzó al Hub y con él el otro extremo
 * de su salida estándar. No es un fallo del Hub: es que nadie está mirando.
 */
export function esConsolaRota(causa: unknown): boolean {
  const codigo = (causa as { code?: unknown } | null)?.code;
  return codigo === "EPIPE" || codigo === "ERR_STREAM_DESTROYED" || codigo === "EOF";
}
