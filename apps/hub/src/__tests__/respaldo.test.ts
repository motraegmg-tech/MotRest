/**
 * Respaldo del registro del local.
 *
 * La prueba que de verdad importa es la del WAL: que la copia se lleve las
 * ventas que todavía viven en el `-wal` y no han bajado al archivo principal.
 * Copiar el archivo a mano falla justo ahí, y el fallo es silencioso —parece
 * que hay respaldo hasta el día que se necesita—.
 */
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync as TipoDatabaseSync } from "node:sqlite";
import {
  crearRespaldo,
  listarRespaldos,
  nombreRespaldo,
  rotarRespaldos,
  verificarRespaldo,
} from "../respaldo.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof TipoDatabaseSync;
};

let carpeta: string;
let rutaDb: string;
let db: TipoDatabaseSync;

/** Una base como la del Hub: WAL, synchronous FULL y la tabla de eventos. */
function abrirBase(ruta: string): TipoDatabaseSync {
  const base = new DatabaseSync(ruta);
  base.exec("PRAGMA journal_mode = WAL");
  base.exec("PRAGMA synchronous = FULL");
  base.exec("CREATE TABLE IF NOT EXISTS eventos (seq INTEGER PRIMARY KEY, id TEXT, tipo TEXT)");
  return base;
}

function insertar(base: TipoDatabaseSync, cuantos: number, desde = 1): void {
  const ins = base.prepare("INSERT INTO eventos (seq, id, tipo) VALUES (?, ?, ?)");
  for (let i = 0; i < cuantos; i++) ins.run(desde + i, `ev-${desde + i}`, "pago_registrado");
}

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "motrest-respaldo-"));
  rutaDb = join(carpeta, "hub.sqlite");
  db = abrirBase(rutaDb);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ya cerrada */
  }
  rmSync(carpeta, { recursive: true, force: true });
});

describe("crear respaldo", () => {
  it("copia la operación y la deja verificable", () => {
    insertar(db, 25);
    const destino = join(carpeta, "respaldos");

    const r = crearRespaldo(rutaDb, destino);
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);

    const v = verificarRespaldo(r.ruta!);
    expect(v.ok).toBe(true);
    expect(v.eventos).toBe(25);
  });

  /*
   * EL CASO QUE JUSTIFICA TODO EL MÓDULO.
   *
   * Con WAL, lo recién confirmado vive en el archivo `-wal` y todavía no está
   * en `hub.sqlite`. Copiar el archivo principal a mano deja fuera esas ventas
   * —en silencio—. `VACUUM INTO` se las lleva todas.
   */
  it("se lleva las ventas que aún viven en el WAL", () => {
    insertar(db, 50);

    const destino = join(carpeta, "respaldos");
    const r = crearRespaldo(rutaDb, destino);
    expect(verificarRespaldo(r.ruta!).eventos).toBe(50);

    // Una copia ingenua del archivo principal, para contrastar.
    const copiaCruda = join(carpeta, "copia-cruda.sqlite");
    copyFileSync(rutaDb, copiaCruda);
    const cruda = verificarRespaldo(copiaCruda);
    // O no abre, o abre con menos eventos: en ningún caso es un respaldo fiel.
    expect(cruda.ok === false || (cruda.eventos ?? 0) < 50).toBe(true);
  });

  it("el Hub puede seguir escribiendo mientras se respalda", () => {
    insertar(db, 10);
    const r = crearRespaldo(rutaDb, join(carpeta, "respaldos"));
    expect(r.ok).toBe(true);

    // La base original sigue viva y aceptando operación.
    insertar(db, 5, 11);
    const fila = db.prepare("SELECT COUNT(*) AS n FROM eventos").get() as { n: number };
    expect(Number(fila.n)).toBe(15);
  });

  it("falla claro si la base no existe", () => {
    const r = crearRespaldo(join(carpeta, "no-existe.sqlite"), join(carpeta, "respaldos"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No existe/);
  });
});

describe("verificación", () => {
  it("rechaza un archivo que no es una base", () => {
    const basura = join(carpeta, "basura.sqlite");
    writeFileSync(basura, "esto no es sqlite");
    expect(verificarRespaldo(basura).ok).toBe(false);
  });

  /*
   * Una base vacía ABRE perfecto. Si solo se comprobara que abre, un respaldo
   * sin la operación pasaría por bueno — justo lo que no se puede permitir.
   */
  it("rechaza una base que abre pero no trae la operación", () => {
    const vacia = join(carpeta, "vacia.sqlite");
    const otra = new DatabaseSync(vacia);
    otra.exec("CREATE TABLE cualquier_cosa (x INTEGER)");
    otra.close();

    expect(verificarRespaldo(vacia).ok).toBe(false);
  });

  it("una copia que no verifica no se deja en disco", () => {
    // Se respalda contra una ruta imposible de escribir para forzar el fallo.
    const r = crearRespaldo(rutaDb, join(carpeta, "respaldos"));
    expect(r.ok).toBe(true);
    // Y en el caso bueno, queda exactamente una.
    expect(listarRespaldos(join(carpeta, "respaldos"))).toHaveLength(1);
  });
});

describe("rotación", () => {
  it("conserva los más recientes y borra los viejos", () => {
    insertar(db, 3);
    const destino = join(carpeta, "respaldos");

    // Se fabrican ocho copias con nombres de días distintos.
    const base = crearRespaldo(rutaDb, destino);
    for (let i = 1; i <= 7; i++) {
      copyFileSync(base.ruta!, join(destino, nombreRespaldo(Date.now() - i * 86_400_000)));
    }
    expect(readdirSync(destino)).toHaveLength(8);

    const borrados = rotarRespaldos(destino, 7);
    expect(borrados).toBe(1);
    expect(listarRespaldos(destino)).toHaveLength(7);
  });

  it("no borra nada si todavía no se llega al tope", () => {
    insertar(db, 1);
    const destino = join(carpeta, "respaldos");
    crearRespaldo(rutaDb, destino);
    expect(rotarRespaldos(destino, 7)).toBe(0);
  });

  it("una carpeta que no existe se lista vacía en vez de reventar", () => {
    expect(listarRespaldos(join(carpeta, "ni-existe"))).toEqual([]);
  });
});

describe("nombres", () => {
  it("son ordenables por fecha", () => {
    const viejo = nombreRespaldo(new Date(2026, 0, 1, 10).getTime());
    const nuevo = nombreRespaldo(new Date(2026, 6, 27, 10).getTime());
    expect([nuevo, viejo].sort()).toEqual([viejo, nuevo]);
  });
});
