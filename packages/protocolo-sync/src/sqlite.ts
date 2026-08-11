/**
 * Event log en SQLite — el almacenamiento del Hub (TRD §5.1).
 *
 * Usa `node:sqlite`, integrado en Node 22+, en vez de una dependencia nativa que
 * haya que compilar en cada máquina donde se instale el Hub. Un restaurante no
 * debería necesitar herramientas de compilación para operar su caja.
 *
 * Aquí vive la regla que hace segura toda la sincronización: **el `id` del
 * evento es la llave primaria.** Reenviar un evento ya guardado no lo duplica y
 * devuelve el `seq` que ya tenía. Eso es lo que permite que un dispositivo que
 * perdió la conexión a media confirmación reenvíe sin miedo.
 */
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDatabaseSync } from "node:sqlite";
import type { EventoBase, ID } from "@motrest/dominio";
import type { Ack, Almacen, RepositorioEstado, RepositorioEventos } from "./repositorio.js";

/**
 * `node:sqlite` se carga por `require` y no con un `import` estático.
 *
 * Es de Node 22 en adelante y los empaquetadores que traemos todavía no lo
 * tienen en su lista de módulos internos: al no reconocerlo le quitan el
 * prefijo `node:` y buscan un paquete de npm llamado "sqlite" que no existe.
 * Cargarlo así lo deja en manos de Node, que sí lo tiene, sin perder el tipado
 * —que viene del `import type` de arriba—. Se puede volver a un import normal
 * cuando el empaquetador lo reconozca.
 */
const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as {
  DatabaseSync: typeof TipoDatabaseSync;
};

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS eventos (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT    NOT NULL UNIQUE,
  tipo         TEXT    NOT NULL,
  stream_id    TEXT    NOT NULL,
  sucursal_id  TEXT    NOT NULL,
  device_id    TEXT    NOT NULL,
  empleado_id  TEXT    NOT NULL,
  ts           INTEGER NOT NULL,
  orden_local  INTEGER NOT NULL,
  cuerpo       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eventos_stream ON eventos(stream_id, seq);
CREATE INDEX IF NOT EXISTS idx_eventos_sucursal ON eventos(sucursal_id, seq);

CREATE TABLE IF NOT EXISTS estado (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispositivos (
  device_id   TEXT PRIMARY KEY,
  nombre      TEXT,
  token       TEXT NOT NULL,
  aprobado    INTEGER NOT NULL DEFAULT 0,
  visto_ts    INTEGER NOT NULL,
  ultimo_seq  INTEGER NOT NULL DEFAULT 0
);
`;

export interface EventoConSeq extends EventoBase {
  seq: number;
}

interface FilaEvento {
  seq: number;
  cuerpo: string;
}

/**
 * `node:sqlite` devuelve las filas como `Record<string, SQLOutputValue>`, sin
 * saber qué columnas pidió la consulta. La forma real la garantiza el SELECT,
 * así que se acota en un solo punto en vez de esparcir conversiones.
 */
function comoFilas<T>(filas: unknown): T[] {
  return filas as T[];
}

/** Reconstruye el evento guardado y le adjunta la secuencia del Hub. */
function aEvento(fila: FilaEvento): EventoConSeq {
  return { ...(JSON.parse(fila.cuerpo) as EventoBase), seq: fila.seq };
}

export interface Dispositivo {
  device_id: ID;
  nombre: string | null;
  token: string;
  aprobado: boolean;
  visto_ts: number;
  ultimo_seq: number;
}

/**
 * Log de eventos del Hub.
 *
 * Extiende el contrato compartido con métodos propios del servidor: asignar
 * secuencia, leer desde una secuencia y administrar dispositivos.
 */
export class LogHub implements RepositorioEventos {
  private db: TipoDatabaseSync;

  constructor(ruta: string) {
    this.db = new DatabaseSync(ruta);
    // WAL: permite leer mientras se escribe. En un servicio de viernes el Hub
    // recibe comandas y sirve consultas al mismo tiempo.
    this.db.exec("PRAGMA journal_mode = WAL");
    /*
     * FULL, no NORMAL, y esto NO es exceso de celo.
     *
     * Con WAL, `NORMAL` protege contra corrupción pero NO contra pérdida: un
     * apagón puede deshacer las últimas transacciones ya confirmadas. Eso sería
     * tolerable si alguien las volviera a mandar, y aquí nadie lo hace: el Hub
     * responde un acuse por cada evento que ingiere, y la terminal que lo
     * recibe lo da por guardado y deja de reintentarlo. Un acuse sobre datos
     * que todavía no tocaron el disco es una promesa que el Hub no puede
     * cumplir.
     *
     * El costo es un fsync por lote. Un restaurante lleno genera unos pocos
     * eventos por segundo; el disco los absorbe sin notarlo. Cambiar pérdida de
     * ventas por microsegundos sería un mal negocio.
     */
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(ESQUEMA);
  }

  // --- Escritura -----------------------------------------------------------------------

  /**
   * Guarda eventos y devuelve su secuencia.
   *
   * Los que ya existían NO se reescriben: se devuelve el `seq` que tenían. Un
   * evento es un hecho ocurrido; reescribirlo sería reescribir la historia, y
   * el log es la bitácora de auditoría del sistema (TRD §10).
   *
   * Todo va en una transacción: o entra el lote completo o no entra nada, para
   * que un corte a media escritura no deje media comanda.
   */
  ingerir(eventos: readonly EventoBase[]): Ack[] {
    if (eventos.length === 0) return [];

    const insertar = this.db.prepare(
      `INSERT OR IGNORE INTO eventos
         (id, tipo, stream_id, sucursal_id, device_id, empleado_id, ts, orden_local, cuerpo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const buscarSeq = this.db.prepare("SELECT seq FROM eventos WHERE id = ?");

    const acks: Ack[] = [];
    this.db.exec("BEGIN");
    try {
      for (const evento of eventos) {
        insertar.run(
          evento.id,
          evento.tipo,
          evento.stream_id,
          evento.sucursal_id,
          evento.device_id,
          evento.empleado_id,
          evento.ts,
          evento.orden_local,
          JSON.stringify(evento),
        );
        const fila = buscarSeq.get(evento.id) as { seq: number } | undefined;
        if (fila) acks.push({ id: evento.id, seq: fila.seq });
      }
      this.db.exec("COMMIT");
    } catch (causa) {
      this.db.exec("ROLLBACK");
      throw causa;
    }

    return acks;
  }

  async anexar(eventos: readonly EventoBase[]): Promise<void> {
    this.ingerir(eventos);
  }

  // --- Lectura --------------------------------------------------------------------------

  /**
   * La secuencia que ya tiene este evento, o `null` si el log no lo conoce.
   *
   * Permite responder «esto ya está» sin volver a juzgarlo. Un evento del log es
   * un hecho ocurrido y aceptado en su momento; que hoy no pasara la validación
   * no lo deshace, solo haría imposible reenviarlo.
   */
  seqDe(id: ID): number | null {
    const fila = this.db.prepare("SELECT seq FROM eventos WHERE id = ?").get(id) as
      | { seq: number }
      | undefined;
    return fila ? fila.seq : null;
  }

  /** Eventos posteriores a una secuencia. Es la base del resync. */
  desde(seq: number, limite = 500): EventoConSeq[] {
    const filas = comoFilas<FilaEvento>(
      this.db
        .prepare("SELECT seq, cuerpo FROM eventos WHERE seq > ? ORDER BY seq LIMIT ?")
        .all(seq, limite),
    );
    return filas.map(aEvento);
  }

  /**
   * Eventos de un tipo concreto, a partir de una secuencia.
   *
   * Existe para que un proceso que solo reacciona a cierta clase de hecho
   * —facturar cuando aparece un comprobante, por ejemplo— no tenga que leer
   * todo el log y descartar el 99 % en memoria. La columna `tipo` ya está
   * indexada por la llave primaria del recorrido.
   */
  porTipo(tipo: string, desdeSeq = 0, limite = 200): EventoConSeq[] {
    const filas = comoFilas<FilaEvento>(
      this.db
        .prepare(
          "SELECT seq, cuerpo FROM eventos WHERE tipo = ? AND seq > ? ORDER BY seq LIMIT ?",
        )
        .all(tipo, desdeSeq, limite),
    );
    return filas.map(aEvento);
  }

  /** Última secuencia asignada. 0 si el log está vacío. */
  get seqActual(): number {
    const fila = comoFilas<{ s: number | null }>(
      this.db.prepare("SELECT MAX(seq) AS s FROM eventos").all(),
    )[0];
    return fila?.s ?? 0;
  }

  async leerTodos(): Promise<EventoBase[]> {
    const filas = comoFilas<FilaEvento>(
      this.db.prepare("SELECT seq, cuerpo FROM eventos ORDER BY seq").all(),
    );
    return filas.map(aEvento);
  }

  async leerStream(streamId: ID): Promise<EventoBase[]> {
    const filas = comoFilas<FilaEvento>(
      this.db
        .prepare("SELECT seq, cuerpo FROM eventos WHERE stream_id = ? ORDER BY seq")
        .all(streamId),
    );
    return filas.map(aEvento);
  }

  /** En el Hub no hay outbox: él es el destino. */
  async pendientes(): Promise<EventoBase[]> {
    return [];
  }

  async confirmar(_acks: readonly Ack[]): Promise<void> {
    // No aplica en el Hub.
  }

  async reabrirOutbox(): Promise<void> {
    // Tampoco: el Hub no le reenvía a nadie, él ES la referencia.
  }

  async contar(): Promise<number> {
    const fila = this.db.prepare("SELECT COUNT(*) AS n FROM eventos").get() as { n: number };
    return fila.n;
  }

  async limpiar(): Promise<void> {
    this.db.exec("DELETE FROM eventos");
  }

  // --- Dispositivos ---------------------------------------------------------------------

  /**
   * Registra un dispositivo que se presenta.
   *
   * Nace SIN aprobar: que alguien alcance la red del local no le da derecho a
   * escribir en el log de ventas. Un responsable lo autoriza desde M9.
   */
  registrarDispositivo(deviceId: ID, token: string, nombre?: string): Dispositivo {
    this.db
      .prepare(
        `INSERT INTO dispositivos (device_id, nombre, token, aprobado, visto_ts)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(device_id) DO UPDATE SET visto_ts = excluded.visto_ts`,
      )
      .run(deviceId, nombre ?? null, token, Date.now());
    return this.dispositivo(deviceId)!;
  }

  dispositivo(deviceId: ID): Dispositivo | null {
    const fila = this.db
      .prepare("SELECT * FROM dispositivos WHERE device_id = ?")
      .get(deviceId) as Record<string, unknown> | undefined;
    if (!fila) return null;
    return {
      device_id: fila.device_id as string,
      nombre: (fila.nombre as string | null) ?? null,
      token: fila.token as string,
      aprobado: fila.aprobado === 1,
      visto_ts: fila.visto_ts as number,
      ultimo_seq: fila.ultimo_seq as number,
    };
  }

  aprobarDispositivo(deviceId: ID): void {
    this.db.prepare("UPDATE dispositivos SET aprobado = 1 WHERE device_id = ?").run(deviceId);
  }

  /**
   * Retira la autorización de una terminal.
   *
   * El registro NO se borra: hay que poder ver que existió y hasta dónde
   * sincronizó. Además, borrarla haría que volviera a aparecer como
   * desconocida en su siguiente intento, y una terminal expulsada del local
   * debe verse como expulsada, no como nueva.
   */
  revocarDispositivo(deviceId: ID): void {
    this.db.prepare("UPDATE dispositivos SET aprobado = 0 WHERE device_id = ?").run(deviceId);
  }

  anotarAvance(deviceId: ID, seq: number): void {
    this.db
      .prepare("UPDATE dispositivos SET ultimo_seq = ?, visto_ts = ? WHERE device_id = ?")
      .run(seq, Date.now(), deviceId);
  }

  dispositivos(): Dispositivo[] {
    const filas = this.db
      .prepare("SELECT device_id FROM dispositivos ORDER BY visto_ts DESC")
      .all() as { device_id: string }[];
    return filas.map((f) => this.dispositivo(f.device_id)!).filter(Boolean);
  }

  cerrar(): void {
    this.db.close();
  }
}

/** Almacén clave-valor del Hub, para lo que no es evento. */
export class EstadoSqlite implements RepositorioEstado {
  constructor(private log: LogHub) {}

  private get db(): TipoDatabaseSync {
    return (this.log as unknown as { db: TipoDatabaseSync }).db;
  }

  async guardar<T>(clave: string, valor: T): Promise<void> {
    this.db
      .prepare("INSERT INTO estado (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor")
      .run(clave, JSON.stringify(valor));
  }

  async cargar<T>(clave: string): Promise<T | null> {
    const fila = this.db.prepare("SELECT valor FROM estado WHERE clave = ?").get(clave) as
      | { valor: string }
      | undefined;
    return fila ? (JSON.parse(fila.valor) as T) : null;
  }

  async eliminar(clave: string): Promise<void> {
    this.db.prepare("DELETE FROM estado WHERE clave = ?").run(clave);
  }

  async limpiar(): Promise<void> {
    this.db.exec("DELETE FROM estado");
  }
}

/** Almacén completo del Hub, respaldado por un archivo SQLite. */
export function almacenSqlite(ruta: string): Almacen & { log: LogHub } {
  const log = new LogHub(ruta);
  return {
    log,
    eventos: log,
    estado: new EstadoSqlite(log),
    cerrar: () => log.cerrar(),
  };
}
