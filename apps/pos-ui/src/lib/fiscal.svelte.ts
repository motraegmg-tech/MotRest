/**
 * Store fiscal: datos del emisor, generación de comprobantes y cola de timbrado.
 *
 * El comprobante se genera y se guarda de inmediato, aunque no haya PAC
 * conectado: el ticket sale al momento y el timbrado espera (TRD A.7.8). Los
 * comprobantes quedan en la cola hasta que exista PAC y CSD.
 */
import {
  FabricaEventos,
  colaDeTimbrado,
  comprobanteAXml,
  construirComprobante,
  problemaCancelacion,
  proyectarCfdis,
  representacionImpresa,
  requierenAtencion,
  streamFiscal,
  uuidv7,
  validarComprobante,
  type Comprobante,
  type RepresentacionImpresa,
  type TimbreFiscal,
  type DatosEmisor,
  type DatosReceptor,
  type EstadoComanda,
  type EventoFiscal,
  type ID,
  type ProblemaFiscal,
  type RegistroCfdi,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { catalogo } from "./catalogo";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_EMISOR = "datos_fiscales_emisor";

/** Datos de arranque. El restaurante los corrige en M5 antes de facturar. */
const EMISOR_INICIAL: DatosEmisor = {
  rfc: "",
  nombre: "",
  regimen_fiscal: "601",
  codigo_postal: "",
  nombre_comercial: "Rodizio Centro",
};

export interface ResultadoFactura {
  ok: boolean;
  error?: string;
  problemas?: ProblemaFiscal[];
  registro?: RegistroCfdi;
}

const STREAM = streamFiscal(SUCURSAL_ID);

class StoreFiscal {
  emisor = $state<DatosEmisor>({ ...EMISOR_INICIAL });
  serie = $state("A");

  private eventos = $state.raw<EventoFiscal[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoFiscal>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  // --- Persistencia ---------------------------------------------------------

  async hidratar(eventos: readonly EventoFiscal[], almacen: Almacen): Promise<void> {
    this.eventos = [...eventos];
    const guardado = await almacen.estado.cargar<DatosEmisor>(CLAVE_EMISOR);
    if (guardado) this.emisor = guardado;
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  private emitir(evento: EventoFiscal): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento fiscal", causa);
    });
  }

  async guardarEmisor(datos: DatosEmisor): Promise<void> {
    this.emisor = { ...datos };
    await this.almacen?.estado.guardar(CLAVE_EMISOR, this.emisor);
  }

  // --- Consultas -------------------------------------------------------------

  get registros(): RegistroCfdi[] {
    return proyectarCfdis(this.eventos).sort((a, b) => b.generado_ts - a.generado_ts);
  }

  get cola(): RegistroCfdi[] {
    return colaDeTimbrado(this.registros);
  }

  get atorados(): RegistroCfdi[] {
    return requierenAtencion(this.registros);
  }

  get timbrados(): RegistroCfdi[] {
    return this.registros.filter((r) => r.estado === "timbrado");
  }

  /** ¿Están completos los datos fiscales del restaurante? */
  get emisorCompleto(): boolean {
    return (
      this.emisor.rfc.trim().length > 0 &&
      this.emisor.nombre.trim().length > 2 &&
      this.emisor.codigo_postal.trim().length === 5
    );
  }

  /** Folio consecutivo, a partir de lo ya emitido. */
  private siguienteFolio(): string {
    const numeros = this.registros
      .map((r) => Number(r.folio))
      .filter((n) => Number.isFinite(n));
    const maximo = numeros.length > 0 ? Math.max(...numeros) : 1000;
    return String(maximo + 1);
  }

  cfdiDeOrden(ordenId: ID): RegistroCfdi | undefined {
    return this.registros.find((r) => r.orden_id === ordenId && r.estado !== "cancelado");
  }

  // --- Emisión ------------------------------------------------------------------

  /**
   * Genera el comprobante de una cuenta. No lo timbra: eso requiere PAC y CSD.
   * El comprobante queda guardado y en cola.
   */
  facturar(estado: EstadoComanda, receptor: DatosReceptor): ResultadoFactura {
    if (!this.emisorCompleto) {
      return {
        ok: false,
        error: "Faltan los datos fiscales del restaurante. Complétalos en Finanzas.",
      };
    }
    const yaFacturada = this.cfdiDeOrden(estado.orden_id);
    if (yaFacturada) {
      return { ok: false, error: `Esta cuenta ya tiene el comprobante ${yaFacturada.serie}-${yaFacturada.folio}` };
    }

    const folio = this.siguienteFolio();
    const comprobante = construirComprobante(estado, catalogo, {
      serie: this.serie,
      folio,
      emisor: this.emisor,
      receptor,
    });

    const problemas = validarComprobante(comprobante);
    if (problemas.length > 0) {
      return { ok: false, problemas, error: problemas[0]!.mensaje };
    }

    const cfdi_id = uuidv7();
    this.emitir(
      this.fabrica.crear("cfdi_generado", STREAM, {
        cfdi_id,
        orden_id: estado.orden_id,
        serie: this.serie,
        folio,
        comprobante,
      }),
    );

    return { ok: true, registro: this.registros.find((r) => r.cfdi_id === cfdi_id) };
  }

  /** Registra el rechazo del PAC, para que el comprobante vuelva a la cola. */
  registrarRechazo(cfdiId: ID, codigo: string, motivo: string): void {
    this.emitir(this.fabrica.crear("cfdi_rechazado", STREAM, { cfdi_id: cfdiId, codigo, motivo }));
  }

  /**
   * PIDE cancelar un comprobante. No lo cancela: eso lo confirma el SAT.
   *
   * Valida las reglas del SAT ANTES de emitir —motivo del catálogo, la regla
   * del 01 con su sustitución— para no encolar una cancelación que el SAT
   * rechazará. El Hub la manda al PAC y publica el desenlace.
   */
  solicitarCancelacion(
    cfdiId: ID,
    motivo: string,
    opciones: { uuidSustitucion?: string; autorizadorId?: ID } = {},
  ): { ok: true } | { ok: false; error: string } {
    const registro = this.registros.find((r) => r.cfdi_id === cfdiId);
    if (!registro) return { ok: false, error: "No se encontró el comprobante" };

    const problema = problemaCancelacion(registro, motivo, opciones.uuidSustitucion);
    if (problema) return { ok: false, error: problema };

    this.emitir(
      this.fabrica.crear("cfdi_cancelacion_solicitada", STREAM, {
        cfdi_id: cfdiId,
        motivo,
        uuid_sustitucion: opciones.uuidSustitucion?.trim() || undefined,
        autorizador_id: opciones.autorizadorId,
      }),
    );
    return { ok: true };
  }

  /** XML tal como se enviaría al PAC (sin sello ni certificado). */
  xmlDe(comprobante: Comprobante): string {
    return comprobanteAXml(comprobante);
  }

  /**
   * Arma la representación impresa de un comprobante.
   *
   * Si el registro ya trae los sellos del timbre —los publicó el Hub al
   * timbrar— sale la factura completa con QR. Si no, sale el borrador: útil
   * para revisar antes de que el SAT la certifique.
   */
  representacionDe(registro: RegistroCfdi): RepresentacionImpresa {
    const timbre: TimbreFiscal | undefined =
      registro.estado === "timbrado" && registro.uuid && registro.sello_cfd
        ? {
            uuid: registro.uuid,
            fecha_timbrado: registro.fecha_timbrado ?? "",
            sello_cfd: registro.sello_cfd,
            sello_sat: registro.sello_sat ?? "",
            no_certificado_sat: registro.no_certificado_sat ?? "",
            rfc_pac: registro.pac ?? "",
          }
        : undefined;
    return representacionImpresa(registro.comprobante, timbre);
  }
}

export const fiscal = new StoreFiscal();
