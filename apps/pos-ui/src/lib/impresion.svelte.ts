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
  cortePeriodo,
  impresoraPara,
  precuenta,
  pruebaCodigosQr,
  representacionCfdi,
  sellarCorte,
  ticketInterno,
  ticketVenta,
  type CifrasCorte,
  type DatosComanda,
  type DatosCorte,
  type DatosCortePeriodo,
  type DatosPrecuenta,
  type DatosTicket,
  type DatosTicketInterno,
  type Impresora,
  type ResultadoEnvio,
  type TipoDocumento,
  type TrabajoImpresion,
  type Transporte,
} from "@motrest/impresion";
import type { Almacen } from "@motrest/protocolo-sync";
import QRCode from "qrcode";

function conMatrizQr(datos: DatosPrecuenta): DatosPrecuenta {
  return {
    ...datos,
    qrs: datos.qrs?.map((qr) => {
      const creado = QRCode.create(qr.url, { errorCorrectionLevel: "M" });
      return {
        ...qr,
        matriz: {
          ancho: creado.modules.size,
          alto: creado.modules.size,
          pixeles: Array.from(creado.modules.data, Boolean),
        },
      };
    }),
  };
}

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
    // Bluetooth: el Hub envía RAW al puerto COM asignado por Windows
    if (impresora.conexion === "bluetooth") return !!impresora.dispositivo;
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

/** Una impresora que el Hub encontró sola. Ver `hub/src/impresion/buscador.ts`. */
export interface ImpresoraDetectada {
  /*
   * Los mismos valores que `TipoConexion`, a propósito: así adoptar una
   * detectada es copiar el origen, sin una tabla de traducción en medio que se
   * quede corta cuando aparezca la siguiente forma de conectar una impresora.
   */
  origen: "usb" | "red" | "bluetooth";
  nombre: string;
  detalle: string;
  host?: string;
  puerto?: number;
  /** USB: el nombre exacto de la cola de Windows. Bluetooth: el puerto, `COM5`. */
  dispositivo?: string;
  /** true = no imprime en papel (PDF, XPS, fax). Se agrupa aparte. */
  virtual?: boolean;
  /** Solo si falta darla de alta: el puerto de Windows donde está enchufada. */
  puerto_sistema?: string;
  /** true = conectada, pero Windows no le creó la cola. Hay que instalarla. */
  sin_instalar?: boolean;
  ancho: 32 | 42;
}

export interface ResultadoBusqueda {
  impresoras: ImpresoraDetectada[];
  redes: string[];
  sin_red: boolean;
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

  // --- Detección automática ------------------------------------------------------------

  /** Lo último que encontró la búsqueda. Null = todavía no se ha buscado. */
  deteccion = $state.raw<ResultadoBusqueda | null>(null);
  /** true = la búsqueda está en curso. El barrido de red tarda unos segundos. */
  buscando = $state(false);
  /** Por qué no se pudo buscar, si es que no se pudo. */
  errorBusqueda = $state("");
  /** El puerto que se está dando de alta ahora mismo, o "" si ninguno. */
  instalando = $state("");

  /**
   * Los puertos Bluetooth de la última búsqueda, para elegirlos de una lista.
   *
   * Sale de `deteccion` en vez de una consulta propia: el Hub ya los devuelve
   * junto con las demás. Mientras nadie haya buscado esto viene vacío y la ficha
   * cae al campo libre, igual que hace la de USB cuando no hay lista.
   *
   * Teclear el puerto a mano es justo lo que hay que evitar: en la caja de
   * Rodizio hay cuatro puertos COM de Bluetooth y solo uno es la impresora.
   */
  get puertosBluetooth(): { puerto: string; nombre: string }[] {
    return (this.deteccion?.impresoras ?? [])
      .filter((d) => d.origen === "bluetooth" && !!d.dispositivo)
      .map((d) => ({ puerto: d.dispositivo as string, nombre: d.nombre }));
  }

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

  /**
   * Busca impresoras: las de Windows y, si se pide, las que contestan en la red.
   *
   * El barrido de red va aparte porque tarda unos segundos: al abrir la pantalla
   * se consulta solo el spooler, que es instantáneo, y la búsqueda completa la
   * dispara quien la necesita.
   */
  async buscar(conRed: boolean): Promise<void> {
    if (this.buscando) return;
    this.errorBusqueda = "";

    if (!enLaCaja()) {
      this.errorBusqueda =
        "Solo la caja puede buscar impresoras: es el equipo que habla con ellas.";
      return;
    }

    this.buscando = true;
    try {
      const respuesta = await fetch(`/impresoras-detectadas${conRed ? "?red=1" : ""}`);
      if (!respuesta.ok) {
        this.errorBusqueda = `El Hub respondió ${respuesta.status}`;
        return;
      }
      this.deteccion = (await respuesta.json()) as ResultadoBusqueda;
    } catch (causa) {
      this.errorBusqueda =
        causa instanceof Error ? causa.message : "No se pudo contactar al Hub";
    } finally {
      this.buscando = false;
    }
  }

  /**
   * Le pide a Windows que dé de alta una impresora que está enchufada y sin cola.
   *
   * Es el caso de una térmica que alguien conectó y Windows dejó a medias: el
   * puerto existe, la impresora no. Sin esto había que ir al panel de control de
   * Windows a instalarla a mano, sabiendo además que sirve el controlador
   * genérico de texto — que no lo sabe nadie que no haya escrito este código.
   */
  async instalar(detectada: ImpresoraDetectada): Promise<boolean> {
    this.errorBusqueda = "";
    if (!detectada.puerto_sistema) {
      this.errorBusqueda = "Esa impresora no necesita instalarse.";
      return false;
    }
    this.instalando = detectada.puerto_sistema;
    try {
      const respuesta = await fetch("/instalar-impresora", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: detectada.nombre, puerto: detectada.puerto_sistema }),
      });
      const cuerpo = (await respuesta.json()) as { error?: string; pista?: string };
      if (!respuesta.ok) {
        this.errorBusqueda = [cuerpo.error, cuerpo.pista].filter(Boolean).join(" ");
        return false;
      }
      // Se vuelve a buscar: ahora sale como una impresora normal, con su cola,
      // y desde ahí sigue el camino de siempre —probar y elegir qué imprime—.
      await this.buscar(false);
      return true;
    } catch (causa) {
      this.errorBusqueda =
        causa instanceof Error ? causa.message : "No se pudo contactar al Hub";
      return false;
    } finally {
      this.instalando = "";
    }
  }

  /** ¿Esta impresora encontrada ya está dada de alta en MotRest? */
  yaConfigurada(detectada: ImpresoraDetectada): Impresora | undefined {
    return this.impresoras.find((i) =>
      detectada.origen === "red"
        ? i.conexion === "red" &&
          i.host === detectada.host &&
          (i.puerto ?? 9100) === (detectada.puerto ?? 9100)
        : i.conexion === detectada.origen && i.dispositivo === detectada.dispositivo,
    );
  }

  /**
   * Da de alta una impresora encontrada, ya conectada y con lo que imprime.
   *
   * Es el único camino que deja la impresora lista de una vez: nombre, conexión,
   * dirección o dispositivo y áreas, sin volver a la ficha a rellenar campos. Si
   * ya estaba dada de alta se le actualizan las áreas en vez de duplicarla —dos
   * fichas de la misma impresora imprimen dos veces cada comanda—.
   */
  adoptar(detectada: ImpresoraDetectada, areas: readonly ID[], nombre?: string): ID {
    const comun: Partial<Impresora> = {
      nombre: (nombre ?? detectada.nombre).trim() || detectada.nombre,
      conexion: detectada.origen,
      ancho: detectada.ancho,
      areas: [...areas],
      activa: true,
      ...(detectada.origen === "red"
        ? { host: detectada.host, puerto: detectada.puerto ?? 9100 }
        : { dispositivo: detectada.dispositivo }),
    };

    const existente = this.yaConfigurada(detectada);
    if (existente) {
      this.actualizar(existente.id, comun);
      return existente.id;
    }

    const id = idCorto("imp");
    this.impresoras = [
      ...this.impresoras,
      {
        id,
        corta: true,
        // Solo la de caja abre el cajón, y eso lo decide quién imprime tickets.
        cajon: areas.includes("caja"),
        ...comun,
      } as Impresora,
    ];
    void this.guardar();
    return id;
  }

  /**
   * Página de prueba en una impresora que TODAVÍA NO está dada de alta.
   *
   * Es lo que permite saber cuál de las tres cajas del mostrador es «192.168.1.62»
   * antes de comprometerse: se manda un papel y se mira de dónde sale. Sin esto,
   * identificar una impresora de red exige darla de alta a ciegas y borrarla si
   * no era.
   */
  probarDetectada(detectada: ImpresoraDetectada): void {
    const efimera: Impresora = {
      id: `imp-prueba-${uuidv7()}`,
      nombre: detectada.nombre,
      conexion: detectada.origen,
      ancho: detectada.ancho,
      areas: [],
      corta: true,
      cajon: false,
      activa: true,
      ...(detectada.origen === "red"
        ? { host: detectada.host, puerto: detectada.puerto ?? 9100 }
        : { dispositivo: detectada.dispositivo }),
    };

    const ticket = comandaCocina(
      {
        orden_id: "prueba",
        mesa: "—",
        mesero: "Prueba de impresión",
        estacion: "¿ES ESTA?",
        ts: Date.now(),
        renglones: [
          { cantidad: 1, descripcion: detectada.nombre },
          { cantidad: 1, descripcion: detectada.detalle },
          { cantidad: 1, descripcion: "Si ves este papel, es la correcta." },
        ],
      },
      efimera.ancho,
    );

    /*
     * La impresora efímera se pasa a la cola SOLO para este trabajo: no se
     * guarda en la configuración. Si no imprime, no queda ninguna ficha suelta
     * que alguien tenga que borrar después.
     */
    this.cola.encolar({
      id: uuidv7(),
      impresora_id: efimera.id,
      documento: "prueba",
      datos: ticket.construir(),
      vista: ticket.aTexto(),
    });
    this.vistaPrevia = { titulo: `Prueba · ${detectada.nombre}`, texto: ticket.aTexto() };
    void this.cola.procesar([...this.impresoras, efimera]);
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

  /**
   * La cuenta que se lleva a la mesa antes de cobrar.
   *
   * Va a la impresora de caja, como el ticket. Si no hay ninguna configurada
   * queda en la vista previa y la operación sigue: pedir la cuenta nunca puede
   * bloquear una mesa.
   */
  precuenta(datos: DatosPrecuenta): boolean {
    const impresora = impresoraPara(this.impresoras, "caja");
    if (!impresora) {
      this.vistaPrevia = { titulo: `Cuenta ${datos.folio}`, texto: precuenta(datos).aTexto() };
      return false;
    }
    const preparados = impresora.modo_qr === "imagen" ? conMatrizQr(datos) : datos;
    const ticket = precuenta(preparados, impresora.ancho, impresora.modo_qr ?? "nativo");
    this.encolar(impresora, "precuenta", ticket, datos.folio);
    this.vistaPrevia = { titulo: `Cuenta ${datos.folio}`, texto: ticket.aTexto() };
    return true;
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

  /** Copia simplificada que se queda en el restaurante después del cobro. */
  ticketInterno(datos: DatosTicketInterno): boolean {
    const impresora = impresoraPara(this.impresoras, "caja");
    if (!impresora) {
      this.vistaPrevia = {
        titulo: `Ticket interno ${datos.folio}`,
        texto: ticketInterno(datos).aTexto(),
      };
      return false;
    }
    const ticket = ticketInterno(datos, impresora.ancho);
    this.encolar(impresora, "ticket_interno", ticket, datos.folio);
    this.vistaPrevia = { titulo: `Ticket interno ${datos.folio}`, texto: ticket.aTexto() };
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

  /**
   * Corte de un período: un día pasado, o los últimos tres.
   *
   * No sella. El sello es del arqueo del turno —el acto de contar el cajón— y
   * este papel es un informe que se puede volver a sacar cuantas veces haga
   * falta. Sellarlo daría a entender que sustituye a la firma del cajero.
   */
  cortePorFechas(datos: DatosCortePeriodo): void {
    const impresora = impresoraPara(this.impresoras, "caja");
    const ticket = cortePeriodo(datos, impresora?.ancho ?? 42);
    const titulo = `Corte ${new Date(datos.desde).toLocaleDateString("es-MX")}`;

    this.vistaPrevia = { titulo, texto: ticket.aTexto() };
    if (impresora) this.encolar(impresora, "corte", ticket, titulo);
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

  /** Saca los dos modos QR en el mismo papel para elegir el compatible. */
  pruebaQr(impresoraId: ID): void {
    const impresora = this.impresoras.find((i) => i.id === impresoraId);
    if (!impresora) return;
    const contenido = "https://motrest.mx/prueba-qr";
    const preparado = conMatrizQr({
      folio: "PRUEBA",
      ts: Date.now(),
      local: { nombre: "MotRest" },
      mesa: "—",
      mesero: "—",
      renglones: [],
      suma: 0 as Centavos,
      descuentos: 0 as Centavos,
      cortesias: 0 as Centavos,
      total: 0 as Centavos,
      qrs: [{ leyenda: "", url: contenido }],
    });
    const matriz = preparado.qrs?.[0]?.matriz;
    if (!matriz) return;
    const ticket = pruebaCodigosQr(contenido, matriz, impresora.ancho);
    this.vistaPrevia = { titulo: `Prueba QR · ${impresora.nombre}`, texto: ticket.aTexto() };
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
