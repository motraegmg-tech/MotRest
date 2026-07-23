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
import { leerIdentidad } from "@motrest/dominio";
import { YA_TIMBRADO, type Pac, type ResultadoTimbrado } from "./pac.js";

/**
 * Cuántas veces se va por un timbre existente antes de llamar a una persona.
 *
 * Con la espera creciente, diez intentos cubren varias horas. Si en ese tiempo
 * el PAC no lo devuelve, ya no es un retraso de su índice: es algo que alguien
 * tiene que mirar.
 */
const MAX_RECUPERACIONES = 10;

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

/**
 * Qué operación toca para esta factura.
 *
 * `timbrar` es lo normal. Una factura pasa a `recuperar` cuando el PAC dice que
 * ya la timbró: a partir de ahí insistir en timbrarla solo produciría más 307,
 * y lo que hace falta es ir por el timbre que ya existe.
 */
export type ModoTimbrado = "timbrar" | "recuperar";

export type EstadoTimbrado = "pendiente" | "timbrado" | "rechazado";

export interface EnCola {
  orden_id: string;
  serie: string;
  folio: string;
  total: number;
  estado: EstadoTimbrado;
  /** `recuperar` = el PAC ya la timbró y se está yendo por el documento. */
  modo: ModoTimbrado;
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
    this.migrar();
  }

  /**
   * Añade columnas nuevas a una cola que ya existe.
   *
   * `CREATE TABLE IF NOT EXISTS` no toca una tabla ya creada, así que una caja
   * que lleva semanas facturando se quedaría sin las columnas nuevas y
   * reventaría al primer INSERT. Se comprueba y se agrega.
   */
  private migrar(): void {
    const columnas = new Set(
      (this.db.prepare("PRAGMA table_info(timbrado)").all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );

    if (!columnas.has("modo")) {
      this.db.exec("ALTER TABLE timbrado ADD COLUMN modo TEXT NOT NULL DEFAULT 'timbrar'");
    }
    if (!columnas.has("recuperaciones")) {
      this.db.exec("ALTER TABLE timbrado ADD COLUMN recuperaciones INTEGER NOT NULL DEFAULT 0");
    }
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
  private porIntentar(
    limite: number,
    ahora: number,
  ): { orden_id: string; xml: string; modo: ModoTimbrado; recuperaciones: number }[] {
    return this.db
      .prepare(
        `SELECT orden_id, xml, modo, recuperaciones FROM timbrado
          WHERE estado = 'pendiente' AND proximo_ts <= ?
          ORDER BY creado_ts LIMIT ?`,
      )
      .all(ahora, limite) as unknown as {
      orden_id: string;
      xml: string;
      modo: ModoTimbrado;
      recuperaciones: number;
    }[];
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
        resultado =
          fila.modo === "recuperar"
            ? await this.intentarRecuperar(fila.xml, fila.recuperaciones)
            : await this.pac.timbrar(fila.xml);
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
        if (fila.modo === "recuperar") {
          this.anotar(
            "info",
            `Factura ${fila.orden_id}: se recuperó del PAC el timbre que ya existía. Nada que hacer a mano.`,
          );
        }
        timbradas += 1;
      } else if (resultado.estado === "ya_timbrado") {
        /*
         * El PAC dice que esta factura ya existe. Insistir en timbrarla solo
         * daría más 307; a partir de aquí la operación es otra: ir por ella.
         */
        this.pasarARecuperacion(fila.orden_id, resultado.motivo, ahora);
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

  /**
   * Va por un timbre que el PAC ya emitió.
   *
   * Puede no encontrarlo al primer intento sin que eso signifique nada malo: el
   * índice de búsqueda de un PAC suele tardar unos segundos en ver lo recién
   * timbrado. Por eso "no encontrado" se trata como pasajero y se reintenta.
   *
   * Se rinde tras `MAX_RECUPERACIONES` y entonces sí llama a una persona. Sin
   * ese tope, una factura irrecuperable se quedaría dando vueltas para siempre
   * y nadie se enteraría de que hay una factura que entregar.
   */
  private async intentarRecuperar(
    xml: string,
    yaIntentadas: number,
  ): Promise<ResultadoTimbrado> {
    const AYUDA =
      "Búscala en el portal de tu PAC con la serie y el folio, y descárgala desde ahí. " +
      "La factura EXISTE ante el SAT: ese folio no debe volver a usarse.";

    if (!this.pac?.recuperar) {
      return {
        estado: "rechazado",
        codigo: YA_TIMBRADO,
        motivo: `Este comprobante ya estaba timbrado y tu PAC no permite recuperarlo automáticamente. ${AYUDA}`,
      };
    }

    if (yaIntentadas >= MAX_RECUPERACIONES) {
      return {
        estado: "rechazado",
        codigo: YA_TIMBRADO,
        motivo: `Este comprobante ya estaba timbrado, pero el PAC no lo devuelve tras ${MAX_RECUPERACIONES} intentos. ${AYUDA}`,
      };
    }

    const identidad = leerIdentidad(xml);
    if (!identidad) {
      return {
        estado: "rechazado",
        codigo: YA_TIMBRADO,
        motivo: `Este comprobante ya estaba timbrado y no se pudo leer su identidad para pedirlo. ${AYUDA}`,
      };
    }

    const recuperado = await this.pac.recuperar(identidad);
    if (recuperado) return { estado: "timbrado", timbrado: recuperado };

    return {
      estado: "ya_timbrado",
      motivo: "El PAC todavía no devuelve el timbre de esta factura. Se sigue intentando.",
    };
  }

  /**
   * Cambia esta factura de "hay que timbrarla" a "hay que ir por ella".
   *
   * El estado sigue siendo pendiente porque, desde fuera, lo es: falta el
   * documento. Lo que cambia es la operación con la que se resuelve.
   */
  private pasarARecuperacion(ordenId: string, motivo: string, ahora: number): void {
    const fila = this.db
      .prepare("SELECT recuperaciones FROM timbrado WHERE orden_id = ?")
      .get(ordenId) as { recuperaciones: number } | undefined;
    const intentos = (fila?.recuperaciones ?? 0) + 1;

    this.db
      .prepare(
        `UPDATE timbrado
            SET modo = 'recuperar', recuperaciones = ?, proximo_ts = ?, problema = ?
          WHERE orden_id = ?`,
      )
      .run(intentos, ahora + esperaTrasIntentos(intentos), motivo, ordenId);

    if (intentos === 1) {
      this.anotar(
        "aviso",
        `El PAC informa que la factura ${ordenId} ya estaba timbrada. Se irá por el timbre existente.`,
      );
    }
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
    /*
     * El modo se conserva. Una factura que quedó en recuperación sigue estando
     * timbrada del lado del PAC: volver a mandarla a timbrar produciría otro
     * 307, y en el peor caso una factura duplicada si el PAC no dedujera bien.
     * Lo que se reinicia es el contador de intentos.
     */
    this.db
      .prepare(
        `UPDATE timbrado
            SET estado = 'pendiente', intentos = 0, recuperaciones = 0,
                proximo_ts = 0, problema = NULL
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
            `SELECT orden_id, serie, folio, total, estado, modo, intentos, creado_ts, uuid, problema
               FROM timbrado WHERE estado = ? ORDER BY creado_ts DESC LIMIT ?`,
          )
          .all(estado, limite)
      : this.db
          .prepare(
            `SELECT orden_id, serie, folio, total, estado, modo, intentos, creado_ts, uuid, problema
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
