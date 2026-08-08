/**
 * Que el Hub esté encendido sin que nadie se acuerde de encenderlo.
 *
 * EL PROBLEMA REAL. El Hub es el corazón del local: guarda el registro, asigna
 * la secuencia y sincroniza las terminales. Hasta ahora había que abrirlo a
 * mano. En un restaurante eso significa que, el día que se va la luz y el equipo
 * reinicia solo, nadie se da cuenta hasta que dos terminales dejan de verse a
 * media cena.
 *
 * POR QUÉ EL ARRANQUE DE SESIÓN Y NO UN SERVICIO DE WINDOWS
 *
 * Un servicio arranca antes de que nadie entre, que suena mejor — pero exige
 * permisos de administrador al instalar, un envoltorio de servicio, y corre en
 * una sesión sin acceso a la carpeta del usuario, que es donde vive el registro
 * y los certificados. La caja de un restaurante enciende y entra sola a su
 * usuario: registrarse en el arranque de sesión llega igual de temprano, no
 * pide permisos especiales y deja el Hub en la misma sesión que la aplicación.
 * Si algún día hace falta un servicio de verdad, esto no lo estorba.
 *
 * VISIBLE Y REVERSIBLE. Se anota en `/salud` y se puede apagar desde
 * Administración → Hub. Un programa que se instala solo en el arranque y no lo
 * dice es exactamente lo que uno no quiere en la computadora de su negocio.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const ejecutar = promisify(execFile);

const RAMA = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const ENTRADA = "MotRestHub";

/** El nombre del ejecutable que produce el empaquetado. */
const EJECUTABLE = "motrest-hub";
const LANZADOR_SILENCIOSO = "motrest-hub-arranque.vbs";

/*
 * Node SEA produce un ejecutable de consola. Registrarlo directo en Run abre
 * una ventana negra al iniciar sesión. WScript es el host gráfico de Windows:
 * no tiene consola, y Run(..., 0, False) oculta también al Hub que inicia. No
 * intervienen PowerShell ni CMD en esta ruta de arranque.
 *
 * El script recibe la ruta del Hub como argumento, sin incrustarla. Así una
 * ruta con espacios no termina como código y el mismo lanzador sirve después
 * de una actualización.
 */
const CONTENIDO_LANZADOR_SILENCIOSO = [
  "' Lanzador silencioso de MotRest Hub. Generado por MotRest; no editar.",
  "Option Explicit",
  "If WScript.Arguments.Count <> 1 Then WScript.Quit 87",
  "Dim shell",
  "Set shell = CreateObject(\"WScript.Shell\")",
  "shell.Run Chr(34) & WScript.Arguments(0) & Chr(34), 0, False",
  "",
].join("\r\n");

export interface EstadoAutoarranque {
  /** Se puede configurar en este equipo y con este ejecutable. */
  soportado: boolean;
  activo: boolean;
  /** Por qué no se puede, cuando no se puede. */
  motivo?: string;
}

/** Ruta del lanzador pequeño que queda junto al ejecutable instalado. */
export function rutaLanzadorSilencioso(rutaHub: string): string {
  return join(dirname(rutaHub), LANZADOR_SILENCIOSO);
}

/** Exact command stored under HKCU\\...\\Run. */
export function comandoDeArranqueSilencioso(rutaHub: string): string {
  return `wscript.exe //B "${rutaLanzadorSilencioso(rutaHub)}" "${rutaHub}"`;
}

/** Contenido estable, expuesto para probarlo sin tocar Windows. */
export function contenidoLanzadorSilencioso(): string {
  return CONTENIDO_LANZADOR_SILENCIOSO;
}

async function prepararLanzadorSilencioso(): Promise<void> {
  await writeFile(
    rutaLanzadorSilencioso(process.execPath),
    CONTENIDO_LANZADOR_SILENCIOSO,
    "utf8",
  );
}

/**
 * ¿Tiene sentido registrar el arranque en ESTE proceso?
 *
 * Solo si es Windows y si el Hub corre como su ejecutable instalado. Corriendo
 * desde el código con `tsx`, `process.execPath` es node.exe: registrar eso
 * dejaría en el arranque de Windows un node suelto sin argumentos, que no
 * levanta nada. Es la clase de basura que uno encuentra un año después.
 */
export function soportado(): boolean {
  if (process.platform !== "win32") return false;
  return basename(process.execPath).toLowerCase().startsWith(EJECUTABLE);
}

/** Lo que `reg` deja registrado hoy, o null si no hay entrada. */
async function leerEntrada(): Promise<string | null> {
  try {
    const { stdout } = await ejecutar("reg", ["query", RAMA, "/v", ENTRADA]);
    // La línea útil trae:  MotRestHub    REG_SZ    "C:\...\motrest-hub.exe"
    const linea = stdout.split(/\r?\n/).find((l) => l.includes(ENTRADA));
    const partes = linea?.split(/REG_SZ\s+/);
    return partes && partes.length > 1 ? partes[1]!.trim() : null;
  } catch {
    // `reg query` sale con error cuando el valor no existe: no es una falla.
    return null;
  }
}

export async function estado(): Promise<EstadoAutoarranque> {
  if (process.platform !== "win32") {
    return { soportado: false, activo: false, motivo: "Solo se configura en Windows" };
  }
  if (!soportado()) {
    return {
      soportado: false,
      activo: (await leerEntrada()) !== null,
      motivo: "El Hub no corre como su ejecutable instalado",
    };
  }
  return {
    soportado: true,
    activo: (await leerEntrada()) === comandoDeArranqueSilencioso(process.execPath),
  };
}

/**
 * Deja el Hub registrado para arrancar al entrar a Windows.
 *
 * Se reescribe si la ruta cambió: tras reinstalar o mover la aplicación, una
 * entrada que apunta a donde ya no está el ejecutable es peor que no tenerla,
 * porque parece configurado y no arranca nada.
 */
export async function activar(): Promise<EstadoAutoarranque> {
  if (!soportado()) return estado();

  // Se escribe antes del registro: nunca se deja una entrada que apunte a un
  // lanzador inexistente. Reescribirlo repara una instalación que tenga el
  // valor correcto pero haya perdido el .vbs.
  await prepararLanzadorSilencioso();
  const ruta = comandoDeArranqueSilencioso(process.execPath);
  if ((await leerEntrada()) === ruta) return { soportado: true, activo: true };

  await ejecutar("reg", ["add", RAMA, "/v", ENTRADA, "/t", "REG_SZ", "/d", ruta, "/f"]);
  return { soportado: true, activo: true };
}

export async function desactivar(): Promise<EstadoAutoarranque> {
  if (process.platform !== "win32") return estado();
  try {
    await ejecutar("reg", ["delete", RAMA, "/v", ENTRADA, "/f"]);
  } catch {
    // Borrar algo que no existe es el resultado que se buscaba.
  }
  return { soportado: soportado(), activo: false };
}

/**
 * Se asegura, al arrancar, de quedar registrado.
 *
 * NO se registra cuando el Hub corre sobre una base de datos distinta a la
 * suya: eso es un ensayo o una prueba, y dejaría en el arranque de Windows un
 * Hub apuntando a una carpeta temporal que ya no existe.
 */
export async function asegurarAlArrancar(
  esInstalacionReal: boolean,
): Promise<EstadoAutoarranque> {
  if (!esInstalacionReal || !soportado()) return estado();
  try {
    return await activar();
  } catch (causa) {
    return {
      soportado: true,
      activo: false,
      motivo: `No se pudo registrar el arranque automático: ${String(causa)}`,
    };
  }
}
