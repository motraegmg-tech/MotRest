/**
 * El cancelador: de "pido cancelar" al SAT y de vuelta a la caja.
 *
 * Mismo patrón que el facturador. La caja emite «solicito cancelar este CFDI» y
 * el Hub reacciona: le pide al PAC que lo cancele ante el SAT y publica el
 * desenlace en el registro del local —cancelado, o rechazado con su motivo—.
 *
 * Vive aparte del facturador porque es otra operación con otras reglas: aquí no
 * se sella nada, y el "no" del SAT (un rechazo de cancelación) deja la factura
 * vigente, al contrario que un rechazo de timbrado.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  FabricaEventos,
  streamFiscal,
  type EventoBase,
  type EventoFiscal,
  type ID,
} from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";
import type { Sellador } from "./sellador.js";
import type { Pac } from "./pac.js";

const TIPO_SOLICITUD = "cfdi_cancelacion_solicitada";
const TIPO_TIMBRADO = "cfdi_timbrado";
const MARCA = "ultimo_seq_cancelacion";
const EMPLEADO_SISTEMA = "sistema";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS marcas_cancelacion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`;

interface EventoSolicitud extends EventoBase {
  cfdi_id: ID;
  motivo: string;
  uuid_sustitucion?: string;
}

interface EventoTimbre extends EventoBase {
  cfdi_id: ID;
  uuid: string;
}

export class Cancelador {
  private fabrica: FabricaEventos<EventoFiscal>;

  constructor(
    private log: LogHub,
    private sellador: Sellador,
    private db: DatabaseSync,
    private pac: Pac | null,
    private anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void = () => {},
    private hubId: ID = "hub",
  ) {
    this.db.exec(ESQUEMA);
    this.fabrica = new FabricaEventos<EventoFiscal>({
      device_id: hubId,
      empleado_id: EMPLEADO_SISTEMA,
      sucursal_id: "",
    });
  }

  private get marca(): number {
    const fila = this.db.prepare("SELECT valor FROM marcas_cancelacion WHERE clave = ?").get(MARCA) as
      | { valor: string }
      | undefined;
    return fila ? Number(fila.valor) : 0;
  }

  private set marca(seq: number) {
    this.db
      .prepare(
        "INSERT INTO marcas_cancelacion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = ?",
      )
      .run(MARCA, String(seq), String(seq));
  }

  /** El UUID de un comprobante, buscado en su evento de timbrado. */
  private uuidDe(cfdiId: ID): string | null {
    for (const ev of this.log.porTipo(TIPO_TIMBRADO, 0, 5000)) {
      const t = ev as unknown as EventoTimbre;
      if (t.cfdi_id === cfdiId && t.uuid) return t.uuid;
    }
    return null;
  }

  /**
   * Atiende las cancelaciones pedidas que aún no se mandaron.
   *
   * A diferencia del timbrado, la marca AVANZA aunque falle: una solicitud que
   * no se puede resolver ahora —sin PAC, sin conexión— se reintenta desde su
   * propio estado en el registro, no reprocesando el evento. Reprocesarlo
   * emitiría dos desenlaces para la misma solicitud.
   */
  async procesar(limite = 50): Promise<{ resueltas: number }> {
    const pendientes = this.log.porTipo(TIPO_SOLICITUD, this.marca, limite);
    if (pendientes.length === 0) return { resueltas: 0 };

    let resueltas = 0;
    // La marca solo avanza sobre lo que quedó FIRME (cancelado o rechazado). Lo
    // que no se resolvió mantiene la marca antes de sí, para retomarlo tal cual.
    let ultimoFirme = this.marca;

    for (const evento of pendientes) {
      const sol = evento as unknown as EventoSolicitud;

      if (!this.pac?.cancelar) break; // Sin PAC no se resuelve nada; se espera.

      const uuid = this.uuidDe(sol.cfdi_id);
      if (!uuid) {
        this.publicarRechazo(sol, evento.sucursal_id, "SIN_UUID", "No se encontró el timbre del comprobante.");
        ultimoFirme = evento.seq;
        resueltas += 1;
        continue;
      }

      let resultado;
      try {
        resultado = await this.pac.cancelar({
          uuid,
          rfc_emisor: this.sellador.estado().rfc ?? "",
          motivo: sol.motivo,
          uuid_sustitucion: sol.uuid_sustitucion,
        });
      } catch (error) {
        this.anotar("aviso", `Cancelación de ${uuid} no se pudo enviar: ${String(error)}`);
        break; // Red: se retoma en el próximo ciclo, sin avanzar la marca.
      }

      if (resultado.estado === "cancelado") {
        this.publicarCancelado(sol, evento.sucursal_id, resultado.fecha);
        this.anotar("info", `CFDI ${uuid} cancelado ante el SAT.`);
        ultimoFirme = evento.seq;
        resueltas += 1;
      } else if (resultado.estado === "rechazado") {
        this.publicarRechazo(sol, evento.sucursal_id, resultado.codigo, resultado.motivo);
        this.anotar("aviso", `Cancelación de ${uuid} rechazada: ${resultado.motivo}`);
        ultimoFirme = evento.seq;
        resueltas += 1;
      } else {
        /*
         * `en_espera` (el SAT aguarda al receptor) y `reintentable` (red, PAC
         * ocupado) no son desenlaces: la solicitud sigue viva en el registro,
         * como `cancelacion_solicitada`, y se retoma en el próximo ciclo. No se
         * avanza la marca para no darla por resuelta.
         */
        if (resultado.estado === "en_espera") {
          this.anotar("info", `Cancelación de ${uuid} a la espera de aceptación del receptor.`);
        }
        break;
      }
    }

    this.marca = ultimoFirme;
    return { resueltas };
  }

  private publicarCancelado(sol: EventoSolicitud, sucursal: ID, fecha: string): void {
    this.fabrica.actualizarContexto({ sucursal_id: sucursal });
    this.log.ingerir([
      this.fabrica.crear("cfdi_cancelado", streamFiscal(sucursal), {
        cfdi_id: sol.cfdi_id,
        motivo: sol.motivo,
        fecha_cancelacion: fecha,
      }),
    ]);
  }

  private publicarRechazo(sol: EventoSolicitud, sucursal: ID, codigo: string, motivo: string): void {
    this.fabrica.actualizarContexto({ sucursal_id: sucursal });
    this.log.ingerir([
      this.fabrica.crear("cfdi_cancelacion_rechazada", streamFiscal(sucursal), {
        cfdi_id: sol.cfdi_id,
        codigo,
        motivo,
      }),
    ]);
  }
}
