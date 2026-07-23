/**
 * El eslabón que faltaba: del cobro a la cola de timbrado.
 *
 * CÓMO SE DISPARA
 *
 * La caja no le pide al Hub que selle. Emite el hecho —«se generó este
 * comprobante»— y el Hub reacciona a él. Esa dirección importa:
 *
 *   - El comprobante queda en el event log ANTES de sellarse, así que sobrevive
 *     a que el Hub se apague en medio.
 *   - Una tablet que factura desde el piso no necesita saber que existe un CSD
 *     ni dónde está: emite el evento y ya.
 *   - Reproducir el log reconstruye exactamente las mismas facturas, que es la
 *     premisa de todo el sistema (ADR-02).
 *
 * POR QUÉ BARRE EN VEZ DE ATENDER UNA NOTIFICACIÓN
 *
 * Porque el orden real no es el ideal. Un restaurante puede operar semanas
 * antes de cargar su CSD: esos comprobantes se acumulan y hay que sellarlos
 * todos el día que llegue el certificado. Un barrido que avanza solo cuando
 * consigue sellar resuelve ese caso y el normal con el mismo código.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  comprobanteAXml,
  type Comprobante,
  type EventoBase,
  type ID,
} from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";
import type { ColaDeTimbrado } from "./cola-timbrado.js";
import type { Sellador } from "./sellador.js";

const TIPO = "cfdi_generado";
const MARCA = "ultimo_seq_cfdi";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS marcas (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`;

/** La forma del evento que emite la caja al facturar una cuenta. */
interface EventoCfdiGenerado extends EventoBase {
  cfdi_id: ID;
  orden_id: ID;
  serie: string;
  folio: string;
  comprobante: Comprobante;
}

export class Facturador {
  constructor(
    private log: LogHub,
    private sellador: Sellador,
    private cola: ColaDeTimbrado,
    private db: DatabaseSync,
    private anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void = () => {},
  ) {
    this.db.exec(ESQUEMA);
  }

  private get marca(): number {
    const fila = this.db.prepare("SELECT valor FROM marcas WHERE clave = ?").get(MARCA) as
      | { valor: string }
      | undefined;
    return fila ? Number(fila.valor) : 0;
  }

  private set marca(seq: number) {
    this.db
      .prepare("INSERT INTO marcas (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = ?")
      .run(MARCA, String(seq), String(seq));
  }

  /**
   * Sella y encola los comprobantes que todavía no lo están.
   *
   * Se llama al arrancar, cada vez que llegan eventos nuevos y justo después de
   * instalar un CSD.
   */
  procesar(limite = 100): { encolados: number; sinCsd: number } {
    const pendientes = this.log.porTipo(TIPO, this.marca, limite);
    if (pendientes.length === 0) return { encolados: 0, sinCsd: 0 };

    if (!this.sellador.listo) {
      /*
       * Sin CSD no se sella, y la marca NO avanza: estos mismos comprobantes se
       * volverán a encontrar el día que se cargue el certificado. Es lo que
       * permite que un restaurante opere semanas antes de facturar y luego
       * emita todo lo acumulado.
       */
      return { encolados: 0, sinCsd: pendientes.length };
    }

    let encolados = 0;
    let ultimoBueno = this.marca;

    for (const evento of pendientes) {
      const cfdi = evento as unknown as EventoCfdiGenerado;
      if (!cfdi.comprobante || !cfdi.orden_id) {
        // Un evento malformado no puede detener la cola entera detrás de él.
        this.anotar("aviso", `Comprobante ${evento.id} ilegible: se omite.`);
        ultimoBueno = evento.seq;
        continue;
      }

      try {
        const sellado = this.sellador.sellarComprobante(cfdi.comprobante);
        this.cola.encolar({
          orden_id: cfdi.orden_id,
          serie: cfdi.serie,
          folio: cfdi.folio,
          total: cfdi.comprobante.total,
          xml: comprobanteAXml(cfdi.comprobante, {
            sello: sellado.sello,
            no_certificado: sellado.no_certificado,
            certificado: sellado.certificado,
          }),
        });
        encolados += 1;
        ultimoBueno = evento.seq;
      } catch (error) {
        /*
         * Si falla el sellado de UNO, la marca se queda antes de él para no
         * saltárselo, y se corta el barrido. Seguir adelante dejaría un hueco
         * silencioso: una venta cobrada sin factura y sin nadie enterado.
         */
        this.anotar(
          "error",
          `No se pudo sellar el comprobante ${cfdi.serie}-${cfdi.folio}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }

    this.marca = ultimoBueno;
    if (encolados > 0) {
      this.anotar("info", `${encolados} comprobante(s) sellado(s) y en cola de timbrado.`);
    }
    return { encolados, sinCsd: 0 };
  }

  /** Cuántos comprobantes esperan un CSD para poder sellarse. */
  esperandoCsd(): number {
    if (this.sellador.listo) return 0;
    return this.log.porTipo(TIPO, this.marca, 1000).length;
  }
}
