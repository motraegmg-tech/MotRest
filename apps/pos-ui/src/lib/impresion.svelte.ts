/**
 * Store de impresión.
 *
 * Regla que gobierna todo lo de aquí: **imprimir nunca bloquea la venta.**
 * Encolar es instantáneo y, si no hay impresora configurada, el POS opera igual
 * — un local puede trabajar solo con el KDS, sin papel (métrica F1 del PRD §9).
 *
 * El papel de verdad sale en la CAJA, que es donde corre el Hub: él abre el
 * socket al puerto 9100 o entrega el trabajo al spooler de Windows por USB. En
 * cualquier otra terminal no hay forma de hablar con una impresora desde una
 * página, así que el trabajo se simula y la vista previa hace de papel — pero
 * queda marcado como simulado, para que la pantalla nunca diga «impreso» de
 * algo que no salió.
 */
import {
  idCorto,
  uuidv7,
  type Centavos,
  type ID,
  type RepresentacionImpresa,
} from "@motrest/dominio";
import {
  ColaImpresion,
  TransporteSimulado,
  comandaCocina,
  corteCaja,
  impresoraPara,
  representacionCfdi,
  sellarCorte,
  ticketVenta,
  type CifrasCorte,
  type DatosComanda,
  type DatosCorte,
  type DatosTicket,
  type Impresora,
  type ResultadoEnvio,
  type TipoDocumento,
  type TrabajoImpresion,
  type Transporte,
} from "@motrest/impresion";
import type { Almacen } from "@motrest/protocolo-sync";

/**
 * Transporte real: manda los bytes al Hub, que abre el socket a la impresora.
 *
 * El navegador no puede abrir un socket TCP al puerto 9100; el Hub sí. Este
 * transporte solo actúa en la CAJA —el único equipo cuya página sirve el Hub, y
 * por eso el único con `window.__MOTREST_HUB__`—. En una terminal de la red no
 * se activa: cae al transporte simulado y la vista previa hace de papel, porque
 * el endpoint del Hub solo acepta impresión desde su propio equipo.
 */
class TransporteHub implements Transporte {
  puede(impresora: Impresora): boolean {
    if (!enLaCaja()) return false;
    if (impresora.conexion === "red") return !!impresora.host;
    // USB: el Hub la entrega al spooler de Windows, que es quien tiene abierto
    // el canal con el cable. Necesita el nombre exacto con el que está dada de
    // alta en el sistema.
    if (impresora.conexion === "usb") return !!impresora.dispositivo;
    return false;
  }

  async enviar(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio> {
    try {
      // La página de la caja la sirve el Hub, así que `/imprimir` es del mismo
      // origen: no hay origen cruzado que resolver.
      const respuesta = await fetch("/imprimir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modo: impresora.conexion,
          host: impresora.host,
          puerto: impresora.puerto ?? 9100,
          dispositivo: impresora.dispositivo,
          titulo: `MotRest · ${impresora.nombre}`,
          datos_base64: aBase64(datos),
        }),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: cuerpo.error ?? `El Hub respondió ${respuesta.status}` };
      }
      return { ok: true };
    } catch (causa) {
      return { ok: false, error: causa instanceof Error ? causa.message : "No se pudo contactar al Hub" };
    }
  }
}

/** Bytes a base64, por trozos para no reventar la pila con tickets largos. */
function aBase64(datos: Uint8Array): string {
  let binario = "";
  const trozo = 0x8000;
  for (let i = 0; i < datos.length; i += trozo) {
    binario += String.fromCharCode(...datos.subarray(i, i + trozo));
  }
  return btoa(binario);
}

export interface ImpresoraDelSistema {
  nombre: string;
  puerto: string;
  estado: string;
}

/** ¿Esta terminal es la caja —la única que puede imprimir de verdad—? */
export function enLaCaja(): boolean {
  return typeof globalThis !== "undefined" &&
    !!(globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__;
}

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
  /** Impresoras que Windows tiene dadas de alta. Solo se puebla en la caja. */
  impresorasSistema = $state.raw<ImpresoraDelSistema[]>([]);

  private almacen: Almacen | null = null;
  private transporte = new TransporteSimulado();
  /*
   * El orden importa: primero el Hub (impresión real en la caja) y, si no
   * aplica —una terminal de la red, o una impresora que no es de red—, el
   * simulado. La cola toma el primer transporte cuyo `puede()` diga que sí.
   */
  private cola = new ColaImpresion([new TransporteHub(), this.transporte], (t) => {
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

  /**
   * Pregunta al Hub qué impresoras tiene Windows instaladas.
   *
   * Solo aplica en la caja. Un fallo aquí no es un problema: la pantalla deja
   * escribir el nombre a mano, que es lo que se hacía antes de tener lista.
   */
  async cargarImpresorasSistema(): Promise<void> {
    if (!enLaCaja()) return;
    try {
      const respuesta = await fetch("/impresoras-sistema");
      if (!respuesta.ok) return;
      const cuerpo = (await respuesta.json()) as { impresoras?: ImpresoraDelSistema[] };
      this.impresorasSistema = cuerpo.impresoras ?? [];
    } catch {
      // Sin lista, la configuración sigue funcionando a mano.
    }
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
        id: idCorto("imp"),
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

  /**
   * Imprime la representación impresa de un CFDI, con su QR de verificación.
   *
   * Si el comprobante aún no está timbrado, la plantilla lo marca BORRADOR y
   * omite el QR: no es una factura hasta que el SAT la certifica. Como todo lo
   * demás, si no hay impresora se deja en la vista previa y la caja sigue.
   */
  factura(rep: RepresentacionImpresa, folio: string): boolean {
    const impresora = impresoraPara(this.impresoras, "caja");
    if (!impresora) {
      this.vistaPrevia = { titulo: `Factura ${folio}`, texto: representacionCfdi(rep).aTexto() };
      return false;
    }
    const ticket = representacionCfdi(rep, impresora.ancho);
    this.encolar(impresora, "factura", ticket, folio);
    this.vistaPrevia = { titulo: `Factura ${folio}`, texto: ticket.aTexto() };
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
