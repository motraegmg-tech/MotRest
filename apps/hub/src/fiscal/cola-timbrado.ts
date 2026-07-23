/**
 * La cola de timbrado: facturar sin internet.
 *
 * EL PROBLEMA
 *
 * Timbrar exige internet; vender, no. Un restaurante no puede detener el
 * servicio porque se cayó el enlace, y el SAT da 72 horas para timbrar un
 * comprobante desde su fecha de emisión. Entre esas dos cosas cabe una cola:
 * el comprobante se sella al cobrar —eso es local e inmediato— y se timbra
 * cuando haya red.
 *
 * POR QUÉ VIVE EN LA BASE Y NO EN MEMORIA
 *
 * Porque el caso que hay que resolver es exactamente el del corte de luz. Una
 * cola en memoria se pierde en el peor momento posible: cuando se fue la
 * corriente con facturas pendientes. Va en SQLite, con la misma durabilidad que
 * el registro de ventas (ADR-19).
 *
 * EL FOLIO NO SE REUSA
 *
 * Un comprobante entra a la cola una sola vez, con su `orden_id` como llave. Si
 * se reintenta, se reintenta EL MISMO XML —el mismo sello, el mismo folio—, no
 * uno nuevo. Generar otro produciría dos comprobantes para una venta.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Pac, ResultadoTimbrado } from "./pac.js";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS timbrado (
  orden_id        TEXT PRIMARY KEY,
  serie           TEXT NOT NULL,
  folio           TEXT NOT NULL,
  total           INTEGER NOT NULL,
  xml             TEXT NOT NULL,
  estado          TEXT NOT NULL,
  intentos        INTEGER NOT NULL DEFAULT 0,
  proximo_ts      INTEGER NOT NULL DEFAULT 0,
  creado_ts       INTEGER NOT NULL,
  uuid            TEXT,
  xml_timbrado    TEXT,
  problema        TEXT
);
CREATE INDEX IF NOT EXISTS idx_timbrado_pendientes ON timbrado(estado, proximo_ts);
`;

export type EstadoTimbrado = "pendiente" | "timbrado" | "rechazado";

export interface EnCola {
  orden_id: string;
  serie: string;
  folio: string;
  total: number;
  estado: EstadoTimbrado;
  intentos: number;
  creado_ts: number;
  uuid: string | null;
  problema: string | null;
}

/**
 * Espera entre reintentos, creciente.
 *
 * Empieza en un minuto y se duplica hasta media hora. Sin el crecimiento, un
 * PAC caído recibiría un intento por minuto por cada factura pendiente durante
 * todo el turno; con un tope, la cola no se queda dormida cuando el servicio
 * vuelve.
 */
const ESPERA_BASE_MS = 60_000;
const ESPERA_MAXIMA_MS = 1_800_000;

export function esperaTrasIntentos(intentos: number): number {
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(0, intentos - 1), ESPERA_MAXIMA_MS);
}

/**
 * Aviso cuando una factura lleva demasiado tiempo sin timbrar.
 *
 * El SAT da 72 horas. Avisar a las 24 deja margen de sobra para resolverlo en
 * horario hábil, que es cuando se puede llamar al PAC o al contador.
 */
const HORAS_PARA_ALARMARSE = 24;

export class ColaDeTimbrado {
  constructor(
    private db: DatabaseSync,
    private pac: Pac | null,
    private anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void = () => {},
  ) {
    this.db.exec(ESQUEMA);
  }

  /**
   * Encola un comprobante ya sellado.
   *
   * `INSERT OR IGNORE`: si esa orden ya está en la cola no se toca. Reencolar
   * sobrescribiría el XML de una factura que quizá ya se timbró, y el folio se
   * duplicaría.
   */
  encolar(entrada: {
    orden_id: string;
    serie: string;
    folio: string;
    total: number;
    xml: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO timbrado
           (orden_id, serie, folio, total, xml, estado, intentos, proximo_ts, creado_ts)
         VALUES (?, ?, ?, ?, ?, 'pendiente', 0, 0, ?)`,
      )
      .run(
        entrada.orden_id,
        entrada.serie,
        entrada.folio,
        entrada.total,
        entrada.xml,
        Date.now(),
      );
  }

  /** Lo que toca intentar ahora: pendientes cuya espera ya venció. */
  private porIntentar(limite: number, ahora: number): { orden_id: string; xml: string }[] {
    return this.db
      .prepare(
        `SELECT orden_id, xml FROM timbrado
          WHERE estado = 'pendiente' AND proximo_ts <= ?
          ORDER BY creado_ts LIMIT ?`,
      )
      .all(ahora, limite) as unknown as { orden_id: string; xml: string }[];
  }

  /**
   * Intenta timbrar lo pendiente.
   *
   * Devuelve cuántas se timbraron y cuántas siguen esperando. Se llama al
   * arrancar el Hub, cada pocos minutos, y cuando vuelve la conexión.
   */
  async procesar(limite = 20, ahora: number = Date.now()): Promise<{
    timbradas: number;
    pendientes: number;
    rechazadas: number;
  }> {
    let timbradas = 0;
    let rechazadas = 0;

    if (!this.pac) {
      return { timbradas: 0, rechazadas: 0, pendientes: this.contar("pendiente") };
    }

    for (const fila of this.porIntentar(limite, ahora)) {
      let resultado: ResultadoTimbrado;
      try {
        resultado = await this.pac.timbrar(fila.xml);
      } catch (error) {
        /*
         * Una excepción del adaptador es casi siempre red. Se trata como
         * pasajera a propósito: descartar una factura por un error que no se
         * supo interpretar es peor que reintentarla de más.
         */
        resultado = {
          estado: "reintentable",
          motivo: error instanceof Error ? error.message : String(error),
        };
      }

      if (resultado.estado === "timbrado") {
        this.marcarTimbrado(fila.orden_id, resultado.timbrado.timbre.uuid, resultado.timbrado.xml);
        timbradas += 1;
      } else if (resultado.estado === "rechazado") {
        this.marcarRechazado(fila.orden_id, `${resultado.codigo}: ${resultado.motivo}`);
        this.anotar(
          "error",
          `Factura ${fila.orden_id} rechazada por el PAC (${resultado.codigo}): ${resultado.motivo}`,
        );
        rechazadas += 1;
      } else {
        this.posponer(fila.orden_id, resultado.motivo, ahora);
      }
    }

    const pendientes = this.contar("pendiente");
    if (timbradas > 0) this.anotar("info", `Timbradas ${timbradas} facturas pendientes.`);
    this.avisarDeLasViejas(ahora);

    return { timbradas, rechazadas, pendientes };
  }

  private marcarTimbrado(ordenId: string, uuid: string, xmlTimbrado: string): void {
    this.db
      .prepare(
        `UPDATE timbrado
            SET estado = 'timbrado', uuid = ?, xml_timbrado = ?, problema = NULL
          WHERE orden_id = ?`,
      )
      .run(uuid, xmlTimbrado, ordenId);
  }

  private marcarRechazado(ordenId: string, problema: string): void {
    this.db
      .prepare("UPDATE timbrado SET estado = 'rechazado', problema = ? WHERE orden_id = ?")
      .run(problema, ordenId);
  }

  private posponer(ordenId: string, motivo: string, ahora: number): void {
    const previos =
      (
        this.db.prepare("SELECT intentos FROM timbrado WHERE orden_id = ?").get(ordenId) as
          | { intentos: number }
          | undefined
      )?.intentos ?? 0;

    // La espera se calcula sobre el intento que acaba de fallar, no sobre los
    // anteriores: si no, los dos primeros reintentos caerían al mismo tiempo.
    const espera = esperaTrasIntentos(previos + 1);

    this.db
      .prepare(
        `UPDATE timbrado
            SET intentos = intentos + 1, proximo_ts = ?, problema = ?
          WHERE orden_id = ?`,
      )
      .run(ahora + espera, motivo, ordenId);
  }

  /**
   * Vuelve a poner en la cola algo rechazado.
   *
   * Se usa después de arreglar la causa —renovar el CSD, corregir el RFC del
   * receptor—. No es automático: si lo fuera, el sistema estaría reintentando
   * en círculo el error que un humano tiene que resolver.
   */
  reintentar(ordenId: string): void {
    this.db
      .prepare(
        `UPDATE timbrado
            SET estado = 'pendiente', intentos = 0, proximo_ts = 0, problema = NULL
          WHERE orden_id = ? AND estado = 'rechazado'`,
      )
      .run(ordenId);
  }

  private contar(estado: EstadoTimbrado): number {
    const fila = this.db
      .prepare("SELECT COUNT(*) AS n FROM timbrado WHERE estado = ?")
      .get(estado) as { n: number };
    return fila.n;
  }

  /** Facturas que llevan demasiado esperando: el reloj del SAT corre. */
  private avisarDeLasViejas(ahora: number): void {
    const limite = ahora - HORAS_PARA_ALARMARSE * 3_600_000;
    const fila = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM timbrado WHERE estado = 'pendiente' AND creado_ts < ?",
      )
      .get(limite) as { n: number };

    if (fila.n > 0) {
      this.anotar(
        "aviso",
        `Hay ${fila.n} factura(s) sin timbrar desde hace más de ${HORAS_PARA_ALARMARSE} horas. ` +
          "El SAT permite 72 horas desde la emisión.",
      );
    }
  }

  /** Lo que se muestra en la pantalla de facturación. */
  listar(estado?: EstadoTimbrado, limite = 100): EnCola[] {
    const consulta = estado
      ? this.db
          .prepare(
            `SELECT orden_id, serie, folio, total, estado, intentos, creado_ts, uuid, problema
               FROM timbrado WHERE estado = ? ORDER BY creado_ts DESC LIMIT ?`,
          )
          .all(estado, limite)
      : this.db
          .prepare(
            `SELECT orden_id, serie, folio, total, estado, intentos, creado_ts, uuid, problema
               FROM timbrado ORDER BY creado_ts DESC LIMIT ?`,
          )
          .all(limite);

    return consulta as unknown as EnCola[];
  }

  /** Resumen para el panel: cuántas hay de cada cosa. */
  resumen(): { pendientes: number; timbradas: number; rechazadas: number } {
    return {
      pendientes: this.contar("pendiente"),
      timbradas: this.contar("timbrado"),
      rechazadas: this.contar("rechazado"),
    };
  }

  /** El XML timbrado de una orden, que es lo que se le entrega al cliente. */
  facturaDe(ordenId: string): { uuid: string; xml: string } | null {
    const fila = this.db
      .prepare("SELECT uuid, xml_timbrado FROM timbrado WHERE orden_id = ? AND estado = 'timbrado'")
      .get(ordenId) as { uuid: string; xml_timbrado: string } | undefined;

    return fila ? { uuid: fila.uuid, xml: fila.xml_timbrado } : null;
  }
}
