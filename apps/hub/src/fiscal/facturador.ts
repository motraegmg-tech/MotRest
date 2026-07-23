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
  FabricaEventos,
  streamFiscal,
  type Comprobante,
  type EventoBase,
  type EventoFiscal,
  type ID,
} from "@motrest/dominio";

/**
 * A nombre de quién anota el Hub lo que hace por su cuenta.
 *
 * No es un usuario: no tiene credencial ni puede iniciar sesión. Existe para
 * que la bitácora pueda decir «esto lo hizo el sistema» en vez de colgárselo a
 * la última persona que tocó la caja.
 */
const EMPLEADO_SISTEMA = "sistema";
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
  private fabrica: FabricaEventos<EventoFiscal>;
  private nombrePac: string;

  constructor(
    private log: LogHub,
    private sellador: Sellador,
    private cola: ColaDeTimbrado,
    private db: DatabaseSync,
    private anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void = () => {},
    opciones: { hub_id?: ID; nombrePac?: string } = {},
  ) {
    this.db.exec(ESQUEMA);
    this.nombrePac = opciones.nombrePac ?? "PAC";

    /*
     * El Hub firma estos hechos a su propio nombre.
     *
     * Timbrar no lo hace una persona: ocurre solo, minutos u horas después del
     * cobro y quizá con el local cerrado. Atribuirlo a quien facturó sería
     * escribir en la bitácora algo que esa persona no hizo.
     *
     * La sucursal se ajusta por comprobante, no aquí: el Hub no tiene una
     * propia, la declaran los dispositivos.
     */
    this.fabrica = new FabricaEventos<EventoFiscal>({
      device_id: opciones.hub_id ?? "hub",
      empleado_id: EMPLEADO_SISTEMA,
      sucursal_id: "",
    });
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
          cfdi_id: cfdi.cfdi_id,
          sucursal_id: cfdi.sucursal_id,
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

  /**
   * Devuelve al registro del local el desenlace de cada factura.
   *
   * Sin esto, el folio fiscal se queda en la base del Hub y la caja nunca se
   * entera: el mesero no puede decirle al comensal que su factura salió ni
   * darle el UUID. Peor todavía, un rechazo pasaría inadvertido hasta que
   * alguien abriera la pantalla de facturación.
   *
   * El hecho va al event log, así que se replica a todas las terminales y
   * queda en la bitácora — igual que cualquier otro hecho del negocio.
   */
  publicarResultados(): number {
    const pendientes = this.cola.porPublicar();
    if (pendientes.length === 0) return 0;

    for (const fila of pendientes) {
      /*
       * Sin `cfdi_id` no hay a qué comprobante enganchar el resultado. Pasa
       * solo con filas anteriores a esta columna; se dan por publicadas para
       * que no se queden intentándolo en cada ciclo.
       */
      if (!fila.cfdi_id) {
        this.cola.marcarPublicado(fila.orden_id);
        continue;
      }

      // El hecho vuelve a la sucursal de donde salió el comprobante.
      this.fabrica.actualizarContexto({ sucursal_id: fila.sucursal_id });
      const stream = streamFiscal(fila.sucursal_id);

      const evento =
        fila.estado === "timbrado"
          ? this.fabrica.crear("cfdi_timbrado", stream, {
              cfdi_id: fila.cfdi_id,
              uuid: fila.uuid ?? "",
              fecha_timbrado: new Date().toISOString(),
              pac: this.nombrePac,
            })
          : this.fabrica.crear("cfdi_rechazado", stream, {
              cfdi_id: fila.cfdi_id,
              codigo: (fila.problema ?? "").split(":")[0]?.trim() ?? "",
              motivo: fila.problema ?? "El PAC no explicó el motivo.",
            });

      this.log.ingerir([evento]);
      this.cola.marcarPublicado(fila.orden_id);
    }

    return pendientes.length;
  }
}
