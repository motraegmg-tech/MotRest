/**
 * Store fiscal: datos del emisor, generación de comprobantes y cola de timbrado.
 *
 * El comprobante se genera y se guarda de inmediato, aunque no haya PAC
 * conectado: el ticket sale al momento y el timbrado espera (TRD A.7.8). Los
 * comprobantes quedan en la cola hasta que exista PAC y CSD.
 */
import {
  SERIE_BASE,
  cfdiAmpara,
  serieDeTerminal,
  siguienteFolio,
  FabricaEventos,
  colaDeTimbrado,
  comprobanteAXml,
  construirComprobante,
  facturasGlobales,
  limitesDelPeriodo,
  ordenEnFacturaGlobal,
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
  type FacturaGlobalRegistrada,
  type ID,
  type ProblemaFiscal,
  type RegistroCfdi,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { catalogo } from "./catalogo";
import { facturacion } from "./facturacion.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_EMISOR = "datos_fiscales_emisor";

/** Datos de arranque. El restaurante los corrige en M5 antes de facturar. */
const EMISOR_INICIAL: DatosEmisor = {
  rfc: "",
  nombre: "",
  regimen_fiscal: "601",
  codigo_postal: "",
  nombre_comercial: "",
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
  /**
   * Serie base del local, editable por el restaurante.
   *
   * La que se usa al facturar es `serieTerminal`: esta más el código de ESTA
   * terminal. Así dos cajas nunca emiten el mismo identificador, ni sin red.
   */
  serieBase = $state(SERIE_BASE);

  /** La serie con la que factura esta terminal. */
  get serie(): string {
    return serieDeTerminal(this.serieBase, obtenerDeviceId());
  }

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

  /**
   * Lo que llega del Hub o de otra terminal, ya en la pantalla.
   *
   * Faltaba, y el efecto era desconcertante: el Hub publica el `cfdi_timbrado`
   * en cuanto el PAC contesta —para que la caja lo vea— y el evento llegaba y se
   * guardaba en disco, pero nadie repoblaba el estado. La factura aparecía solo
   * al recargar, y hasta entonces la caja seguía creyendo que no se había
   * timbrado.
   *
   * Se descartan los ya conocidos por `id`: un evento puede llegar dos veces —al
   * reconectar se repite la ventana— y contar dos veces un comprobante sería
   * peor que no verlo.
   */
  integrar(eventos: readonly EventoFiscal[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos];
  }

  private emitir(evento: EventoFiscal): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento fiscal", causa);
    });
  }

  /**
   * Guarda los datos fiscales del restaurante en esta tableta Y los publica
   * para las demás y para el Hub (1.5.6), que ahora emite por su cuenta las
   * autofacturas del portal.
   */
  async guardarEmisor(datos: DatosEmisor): Promise<void> {
    await this.adoptarEmisor(datos);
    facturacion.fijarEmisor({ ...datos });
  }

  /** Los toma como propios SIN volver a publicarlos: ya vienen de la red. */
  async adoptarEmisor(datos: DatosEmisor): Promise<void> {
    this.emisor = { ...datos };
    await this.almacen?.estado.guardar(CLAVE_EMISOR, { ...datos });
  }

  /**
   * Enlaza los datos fiscales de esta tableta con los compartidos. Se llama al
   * arrancar, cuando ya están cargados los dos.
   *
   *  - Si el local ya los compartió, se adoptan: una tableta nueva no tiene que
   *    volver a capturarlos.
   *  - Si no, y ESTA tableta los tiene (un local que viene de la 1.5.5), los
   *    publica ella. Así el Hub los recibe sin que nadie tenga que abrir
   *    Finanzas y volver a guardar.
   *  - Y a partir de ahí, lo que cambie otra terminal llega solo.
   */
  async enlazarConLaConfiguracion(): Promise<void> {
    facturacion.alCambiarEmisor((emisor) => void this.adoptarEmisor(emisor));
    const compartido = facturacion.emisor;
    if (compartido) {
      await this.adoptarEmisor(compartido);
    } else if (this.emisorCompleto) {
      facturacion.fijarEmisor({ ...this.emisor });
    }
  }

  // --- Consultas -------------------------------------------------------------

  /**
   * Las facturas globales del registro (1.5.5). Los reportes las necesitan para
   * no contar como «sin facturar» lo que ya entró en una global.
   */
  get globales(): FacturaGlobalRegistrada[] {
    return facturasGlobales(this.eventos);
  }

  /**
   * Los hechos fiscales en crudo.
   *
   * Los pide la pantalla de la factura global para preguntarle al DOMINIO si
   * una cuenta ya está amparada, en vez de deducirlo aquí con otra cuenta que
   * algún día diría algo distinto de lo que dice el Hub al emitir.
   */
  get eventosFiscales(): readonly EventoFiscal[] {
    return this.eventos;
  }

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

  /**
   * El comprobante de una cuenta: el que la ampara, si lo hay; si no, el último
   * intento —un rechazado—, para poder enseñar por qué no salió.
   *
   * Antes devolvía el PRIMERO que encontrara. Con un rechazo por datos del
   * cliente eso dejaba la cuenta atada para siempre a una factura que el SAT
   * nunca vio, y desde la 1.5.6 se puede volver a facturar con los datos
   * corregidos —en la caja o desde el portal—.
   */
  cfdiDeOrden(ordenId: ID): RegistroCfdi | undefined {
    const suyos = this.registros.filter((r) => r.orden_id === ordenId && r.estado !== "cancelado");
    return suyos.find((r) => cfdiAmpara(r.estado)) ?? suyos.at(-1);
  }

  // --- Emisión ------------------------------------------------------------------

  /**
   * Genera el comprobante de una cuenta. No lo timbra: eso requiere PAC y CSD.
   * El comprobante queda guardado y en cola.
   */
  facturar(
    estado: EstadoComanda,
    receptor: DatosReceptor,
    opciones: {
      /** A dónde manda FacturAPI la factura timbrada (PDF + XML). */
      correo?: string;
      /**
       * El local emite factura global mensual (FacturAPI configurada). Con
       * ella, un ticket de un mes ya cerrado pertenece a la global.
       */
      conGlobal?: boolean;
    } = {},
  ): ResultadoFactura {
    /*
     * UNA VENTA NO PUEDE IR EN DOS COMPROBANTES, y ese es el único bloqueo que
     * queda. Si el ticket ya entró en una global, facturarlo a nombre de alguien
     * exigiría cancelar esa global ante el SAT, y eso no puede ocurrir con un
     * clic en la caja.
     *
     * En la 1.5.5 también se bloqueaba por «su mes ya cerró». Se retiró en la
     * 1.5.6: ahora el restaurantero elige qué entra en cada global, así que una
     * cuenta que se quedó fuera sigue disponible —para un cliente que vuelve por
     * su factura, o para una global posterior— y darla por perdida por el
     * calendario sería mentirle.
     */
    if (opciones.conGlobal) {
      const global = ordenEnFacturaGlobal(this.eventos, estado.orden_id);
      if (global) {
        return {
          ok: false,
          error: `Este ticket ya va en la factura global de ${mesLegible(global.periodo)}. Para facturarlo a nombre del cliente habría que cancelar esa global: pídeselo a MOTRAE.`,
        };
      }
    }

    if (!this.emisorCompleto) {
      return {
        ok: false,
        error: "Faltan los datos fiscales del restaurante. Complétalos en Finanzas.",
      };
    }
    // Un rechazado no cuenta: el SAT nunca lo vio y se puede corregir.
    const yaFacturada = this.cfdiDeOrden(estado.orden_id);
    if (yaFacturada && cfdiAmpara(yaFacturada.estado)) {
      return { ok: false, error: `Esta cuenta ya tiene el comprobante ${yaFacturada.serie}-${yaFacturada.folio}` };
    }

    const folio = siguienteFolio(this.registros, this.serie);
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
        ...(opciones.correo?.trim() ? { correo_receptor: opciones.correo.trim() } : {}),
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
    /*
     * CON FACTURAPI, LO QUE VALE ES LO QUE SE TIMBRÓ (1.5.5). FacturAPI arma y
     * sella el XML con SU certificado y SU aritmética: el número de certificado
     * y el total que certifica el SAT salen de ahí, no del comprobante que armó
     * la caja. El QR de verificación lleva el total, así que un centavo de
     * diferencia haría que el SAT dijera «no encontrado» al escanearlo.
     */
    const comprobante = {
      ...registro.comprobante,
      no_certificado: registro.no_certificado_emisor ?? registro.comprobante.no_certificado,
      total: registro.total_timbrado ?? registro.comprobante.total,
    };
    return representacionImpresa(comprobante, timbre);
  }
}

export const fiscal = new StoreFiscal();

/** «2026-08» → «agosto de 2026», para los mensajes de la global. */
function mesLegible(periodo: string): string {
  const { desde } = limitesDelPeriodo(periodo);
  return new Date(desde).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}
