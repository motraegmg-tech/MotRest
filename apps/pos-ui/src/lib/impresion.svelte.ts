/**
 * Store de impresión.
 *
 * Regla que gobierna todo lo de aquí: **imprimir nunca bloquea la venta.**
 * Encolar es instantáneo y, si no hay impresora configurada, el POS opera igual
 * — un local puede trabajar solo con el KDS, sin papel (métrica F1 del PRD §9).
 *
 * En el navegador no se puede abrir un socket al puerto 9100, así que el
 * transporte es simulado y la vista previa hace las veces de papel. El
 * transporte real llega con el empaquetado Tauri (etapa 12), donde sí hay
 * acceso a la red y al USB; la cola y las plantillas ya están listas para él.
 */
import { uuidv7, type Centavos, type ID } from "@motrest/dominio";
import {
  ColaImpresion,
  TransporteSimulado,
  comandaCocina,
  corteCaja,
  impresoraPara,
  sellarCorte,
  ticketVenta,
  type CifrasCorte,
  type DatosComanda,
  type DatosCorte,
  type DatosTicket,
  type Impresora,
  type TipoDocumento,
  type TrabajoImpresion,
} from "@motrest/impresion";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_IMPRESORAS = "impresoras";

/** Impresoras de arranque de la demostración. */
function impresorasPorDefecto(): Impresora[] {
  return [
    {
      id: "imp-caja", nombre: "Caja", conexion: "red", host: "192.168.1.60",
      puerto: 9100, ancho: 42, areas: ["caja"], corta: true, cajon: true, activa: true,
    },
    {
      id: "imp-cocina", nombre: "Cocina", conexion: "red", host: "192.168.1.61",
      puerto: 9100, ancho: 42, areas: ["est-horno", "est-pastas", "est-parrilla"],
      corta: true, cajon: false, activa: true,
    },
    {
      id: "imp-barra", nombre: "Barra", conexion: "red", host: "192.168.1.62",
      puerto: 9100, ancho: 32, areas: ["est-barra", "est-fria", "est-postres"],
      corta: true, cajon: false, activa: true,
    },
  ];
}

class StoreImpresion {
  impresoras = $state.raw<Impresora[]>(impresorasPorDefecto());
  trabajos = $state.raw<readonly TrabajoImpresion[]>([]);
  /** Última vista previa generada, para verla sin gastar papel. */
  vistaPrevia = $state<{ titulo: string; texto: string } | null>(null);

  private almacen: Almacen | null = null;
  private transporte = new TransporteSimulado();
  private cola = new ColaImpresion([this.transporte], (t) => {
    this.trabajos = [...t];
  });

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardadas = await almacen.estado.cargar<Impresora[]>(CLAVE_IMPRESORAS);
    if (guardadas && guardadas.length > 0) this.impresoras = guardadas;
  }

  private async guardar(): Promise<void> {
    await this.almacen?.estado.guardar(CLAVE_IMPRESORAS, this.impresoras);
  }

  get activas(): Impresora[] {
    return this.impresoras.filter((i) => i.activa);
  }

  get pendientes(): TrabajoImpresion[] {
    return this.cola.pendientes;
  }

  get fallidos(): TrabajoImpresion[] {
    return this.cola.fallidos;
  }

  // --- Configuración ------------------------------------------------------------------

  actualizar(impresoraId: ID, cambios: Partial<Impresora>): void {
    this.impresoras = this.impresoras.map((i) =>
      i.id === impresoraId ? { ...i, ...cambios } : i,
    );
    void this.guardar();
  }

  agregar(nombre: string): void {
    this.impresoras = [
      ...this.impresoras,
      {
        id: `imp-${uuidv7().slice(0, 8)}`,
        nombre: nombre.trim() || "Impresora",
        conexion: "red",
        puerto: 9100,
        ancho: 42,
        areas: [],
        corta: true,
        cajon: false,
        activa: true,
      },
    ];
    void this.guardar();
  }

  eliminar(impresoraId: ID): void {
    this.impresoras = this.impresoras.filter((i) => i.id !== impresoraId);
    void this.guardar();
  }

  // --- Documentos -----------------------------------------------------------------------

  private encolar(
    impresora: Impresora,
    documento: TipoDocumento,
    ticket: { construir(): Uint8Array; aTexto(): string },
    referencia?: ID,
  ): void {
    this.cola.encolar({
      id: uuidv7(),
      impresora_id: impresora.id,
      documento,
      datos: ticket.construir(),
      vista: ticket.aTexto(),
      referencia,
    });
    void this.cola.procesar(this.impresoras);
  }

  /**
   * Imprime la comanda en la impresora del área.
   *
   * Se agrupa por estación para que cada una reciba SOLO lo suyo: mandar la
   * comanda completa a las tres impresoras haría que se prepararan platillos
   * por duplicado.
   */
  comanda(datos: Omit<DatosComanda, "estacion">, porEstacion: Map<ID, DatosComanda["renglones"]>): number {
    let impresas = 0;
    for (const [estacion, renglones] of porEstacion) {
      if (renglones.length === 0) continue;
      const impresora = impresoraPara(this.impresoras, estacion);
      if (!impresora) continue;

      const ticket = comandaCocina(
        { ...datos, estacion: estacion.replace(/^est-/, "").toUpperCase(), renglones },
        impresora.ancho,
      );
      this.encolar(impresora, "comanda", ticket, datos.orden_id);
      impresas += 1;
    }
    return impresas;
  }

  ticket(datos: DatosTicket): boolean {
    const impresora = impresoraPara(this.impresoras, "caja");
    if (!impresora) {
      this.vistaPrevia = { titulo: `Ticket ${datos.folio}`, texto: ticketVenta(datos).aTexto() };
      return false;
    }
    const ticket = ticketVenta(datos, impresora.ancho);
    this.encolar(impresora, "ticket", ticket, datos.folio);
    this.vistaPrevia = { titulo: `Ticket ${datos.folio}`, texto: ticket.aTexto() };
    return true;
  }

  /** Sella el corte y lo imprime. El sello se calcula una sola vez. */
  async corte(cifras: CifrasCorte, datos: Omit<DatosCorte, "sello">): Promise<string> {
    const sello = await sellarCorte(cifras);
    const impresora = impresoraPara(this.impresoras, "caja");
    const ticket = corteCaja({ ...datos, sello }, impresora?.ancho ?? 42);

    this.vistaPrevia = { titulo: `Corte ${datos.folio}`, texto: ticket.aTexto() };
    if (impresora) this.encolar(impresora, "corte", ticket, datos.folio);
    return sello;
  }

  /** Página de prueba, para verificar que una impresora responde. */
  prueba(impresoraId: ID): void {
    const impresora = this.impresoras.find((i) => i.id === impresoraId);
    if (!impresora) return;

    const ticket = comandaCocina(
      {
        orden_id: "prueba",
        mesa: "—",
        mesero: "Prueba de impresión",
        estacion: impresora.nombre.toUpperCase(),
        ts: Date.now(),
        renglones: [
          { cantidad: 1, descripcion: "Página de prueba" },
          { cantidad: 1, descripcion: "Acentos: ñ á é í ó ú ¿? ¡!" },
        ],
      },
      impresora.ancho,
    );

    this.vistaPrevia = { titulo: `Prueba · ${impresora.nombre}`, texto: ticket.aTexto() };
    this.encolar(impresora, "prueba", ticket);
  }

  reintentar(trabajoId: ID): void {
    this.cola.reintentar(trabajoId);
    void this.cola.procesar(this.impresoras);
  }

  descartar(trabajoId: ID): void {
    this.cola.descartar(trabajoId);
  }

  limpiar(): void {
    this.cola.limpiarImpresos();
  }

  cerrarVista(): void {
    this.vistaPrevia = null;
  }
}

export const impresion = new StoreImpresion();

/** Reexporta el tipo para que la UI no dependa del paquete directamente. */
export type { CifrasCorte, Centavos, Impresora, TrabajoImpresion };
