/**
 * Respaldo del registro del local.
 *
 * `hub.sqlite` guarda TODA la operación: cada venta, cada corte y cada CFDI. Si
 * ese archivo se pierde, el restaurante no solo se queda sin su historial —se
 * queda sin los registros fiscales que el SAT le exige conservar cinco años—.
 * Hasta aquí no había ninguna copia; esto lo resuelve.
 *
 * TRES DECISIONES QUE GOBIERNAN EL DISEÑO
 *
 * 1. **`VACUUM INTO`, no copiar el archivo.** Con WAL, copiar `hub.sqlite`
 *    mientras el Hub escribe da un archivo roto: las transacciones ya
 *    confirmadas viven en el `-wal` y todavía no están en el principal. Una
 *    copia así parece un respaldo y no lo es. `VACUUM INTO` escribe una copia
 *    consistente y autocontenida del estado confirmado, con el Hub operando.
 *
 * 2. **Automático, no un botón.** Nadie en un restaurante va a acordarse de
 *    respaldar un viernes a las once de la noche. Se hace solo, al arrancar y
 *    una vez al día.
 *
 * 3. **Se verifica.** Un respaldo que nunca se abrió no es un respaldo: es un
 *    archivo. Cada copia se vuelve a abrir y se le corre un chequeo de
 *    integridad antes de darla por buena.
 *
 * LO QUE ESTO **NO** PROTEGE
 *
 * Un respaldo en el mismo disco salva de una corrupción o de un borrado, pero
 * NO de que el disco se muera. Para eso hay que apuntar `MOTREST_RESPALDOS` a
 * una unidad externa o a una carpeta sincronizada. El estado se reporta en
 * `/salud` para que se pueda ver si de verdad se está respaldando.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync as TipoDatabaseSync } from "node:sqlite";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof TipoDatabaseSync;
};

/** Cuántas copias se conservan antes de borrar la más vieja. */
export const RESPALDOS_A_CONSERVAR = 7;

/** Cada cuánto se respalda mientras el Hub está encendido. */
export const INTERVALO_RESPALDO_MS = 24 * 60 * 60 * 1000;

const PREFIJO = "hub-";
const SUFIJO = ".sqlite";

export interface ResultadoRespaldo {
  ok: boolean;
  ruta?: string;
  bytes?: number;
  error?: string;
}

/** Nombre ordenable por fecha: `hub-2026-07-27T12-30-00.sqlite`. */
export function nombreRespaldo(ts = Date.now()): string {
  const iso = new Date(ts).toISOString().slice(0, 19).replace(/[:]/g, "-");
  return `${PREFIJO}${iso}${SUFIJO}`;
}

/**
 * Crea una copia consistente de la base, con el Hub operando.
 *
 * Se abre una conexión aparte en solo lectura: el respaldo no debe poder tocar
 * el registro del local ni por accidente.
 */
export function crearRespaldo(rutaDb: string, carpetaDestino: string): ResultadoRespaldo {
  if (!existsSync(rutaDb)) {
    return { ok: false, error: `No existe la base en ${rutaDb}` };
  }

  try {
    mkdirSync(carpetaDestino, { recursive: true });
  } catch (causa) {
    return { ok: false, error: `No se pudo crear ${carpetaDestino}: ${mensaje(causa)}` };
  }

  const destino = join(carpetaDestino, nombreRespaldo());
  let db: TipoDatabaseSync | undefined;

  try {
    db = new DatabaseSync(rutaDb, { readOnly: true });
    // Las comillas simples se duplican: una ruta con apóstrofo rompería el SQL.
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } catch (causa) {
    return { ok: false, error: mensaje(causa) };
  } finally {
    db?.close();
  }

  const verificado = verificarRespaldo(destino);
  if (!verificado.ok) {
    // Una copia que no pasa el chequeo se borra: dejarla ahí haría creer que
    // hay respaldo cuando no lo hay, que es peor que no tener ninguno.
    try {
      unlinkSync(destino);
    } catch {
      /* si no se puede borrar, al menos se reporta el fallo */
    }
    return { ok: false, error: `La copia no pasó la verificación: ${verificado.error}` };
  }

  return { ok: true, ruta: destino, bytes: statSync(destino).size };
}

/**
 * Abre la copia y comprueba que esté íntegra y que traiga la operación.
 *
 * No basta con que el archivo abra: una base vacía abre perfecto. Se cuenta que
 * la tabla de eventos exista, que es lo que hace que el respaldo sirva para algo.
 */
export function verificarRespaldo(ruta: string): { ok: boolean; eventos?: number; error?: string } {
  let db: TipoDatabaseSync | undefined;
  try {
    db = new DatabaseSync(ruta, { readOnly: true });

    const integridad = db.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const veredicto = integridad?.integrity_check;
    if (veredicto !== "ok") {
      return { ok: false, error: `integrity_check devolvió "${veredicto ?? "nada"}"` };
    }

    const fila = db.prepare("SELECT COUNT(*) AS n FROM eventos").get() as { n?: number } | undefined;
    return { ok: true, eventos: Number(fila?.n ?? 0) };
  } catch (causa) {
    return { ok: false, error: mensaje(causa) };
  } finally {
    db?.close();
  }
}

export interface RespaldoEnDisco {
  ruta: string;
  nombre: string;
  ts: number;
  bytes: number;
}

/** Los respaldos que hay, del más reciente al más antiguo. */
export function listarRespaldos(carpeta: string): RespaldoEnDisco[] {
  if (!existsSync(carpeta)) return [];
  try {
    return readdirSync(carpeta)
      .filter((n) => n.startsWith(PREFIJO) && n.endsWith(SUFIJO))
      .map((nombre) => {
        const ruta = join(carpeta, nombre);
        const info = statSync(ruta);
        return { ruta, nombre, ts: info.mtimeMs, bytes: info.size };
      })
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * Borra los respaldos más viejos y deja los últimos `conservar`.
 *
 * Sin esto, un año de operación llena el disco de la caja — y una caja con el
 * disco lleno deja de vender, que es la falla que este módulo intenta evitar.
 */
export function rotarRespaldos(carpeta: string, conservar = RESPALDOS_A_CONSERVAR): number {
  const sobrantes = listarRespaldos(carpeta).slice(conservar);
  let borrados = 0;
  for (const r of sobrantes) {
    try {
      unlinkSync(r.ruta);
      borrados += 1;
    } catch {
      /* si uno no se deja borrar, se sigue con los demás */
    }
  }
  return borrados;
}

function mensaje(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}
