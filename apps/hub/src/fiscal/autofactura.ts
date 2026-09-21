/**
 * El portal de autofactura, del lado del Hub (1.5.6).
 *
 * El comensal pide su factura desde su teléfono, con el QR del ticket y sus
 * datos móviles. El portal (Vercel) NO timbra: deja sus datos fiscales en un
 * sobre cifrado que solo abre este Hub. Aquí se hace todo lo demás:
 *
 *   1. PUBLICAR cada cuenta cobrada que se puede facturar, con lo mínimo para
 *      reconocerla (folio, total, fecha y el código del QR). Sin platillos ni
 *      nombres: la nube es un cartero.
 *   2. RECOGER las solicitudes, abrir el sobre, comprobar el ticket contra el
 *      registro de ESTE local —no contra la nube— y generar el comprobante como
 *      lo haría la caja (`cfdi_generado`). La cola de timbrado lo timbra con la
 *      llave de FacturAPI, que nunca sale de la caja.
 *   3. CONTESTAR: timbrada con su folio fiscal, o rechazada con el motivo. Un
 *      rechazo devuelve el ticket a «disponible» (lo hace la base) y le llega al
 *      comensal por correo con el enlace para corregir (decisión de Gonzalo).
 *
 * Plan: `docs/PLAN-AUTOFACTURA-PORTAL.md` y `docs/PLAN-1.5.6.md` §6.
 *
 * TODO SE HACE EN SERIE. Dos solicitudes procesadas a la vez sacarían el mismo
 * folio, y dos pasadas de publicación subirían lo mismo dos veces.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  FabricaEventos,
  SERIE_BASE,
  TIPOS_EVENTO_FISCAL,
  cfdiAmpara,
  codigoDeAutofactura,
  construirComprobante,
  folioDeTicket,
  leerSolicitudDeAutofactura,
  motivoParaNoAutofacturar,
  proyectarCfdis,
  proyectarSentadas,
  serieDeTerminal,
  siguienteFolio,
  streamFiscal,
  ticketAutofacturable,
  urlDeAutofactura,
  uuidv7,
  validarComprobante,
  type CatalogoIndex,
  type DatosEmisor,
  type EstadoComanda,
  type EventoBase,
  type EventoComanda,
  type EventoFiscal,
  type ID,
  type RegistroCfdi,
} from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";

const DIA = 24 * 60 * 60 * 1000;
/** Cuánto se espera a que aparezca en el registro un comprobante inyectado. */
const PERDIDO_TRAS_MS = 10 * 60 * 1000;

/** La fila de `claves_de_autofactura` de este local. */
export interface ClaveDelLocal {
  clave: string;
  portal_url: string;
}

/** Lo que se publica de un ticket en `tickets_facturables`. */
export interface FilaTicketFacturable {
  orden_id: ID;
  folio: string;
  total: number;
  cerrada_ts: number;
  codigo: string;
  vence_ts: number;
}

/** Una fila de `solicitudes_de_factura`, tal como llega. */
export interface FilaSolicitud {
  id: string;
  orden_id: string;
  sobre: unknown;
}

export interface CambiosSolicitud {
  entregado_ts?: number;
  resuelto_ts?: number;
  resultado?: "timbrada" | "rechazada";
  uuid_cfdi?: string;
  error?: string;
}

/**
 * La nube, vista desde aquí. La implementa `EnlaceSupabase`; en las pruebas,
 * un doble. Todo devuelve en vez de lanzar: sin red, la siguiente pasada lo
 * vuelve a intentar.
 */
export interface NubeDeAutofactura {
  miClave(): Promise<ClaveDelLocal | null>;
  publicarTickets(filas: FilaTicketFacturable[]): Promise<boolean>;
  marcarFacturados(ordenes: ID[]): Promise<boolean>;
  purgarVencidos(antesDe: number): Promise<void>;
  solicitudesPendientes(): Promise<FilaSolicitud[]>;
  marcarSolicitud(id: string, cambios: CambiosSolicitud): Promise<boolean>;
}

export interface OpcionesAutofactura {
  db: DatabaseSync;
  log: LogHub;
  /** `null` mientras no hay enlace con la nube. */
  nube: () => NubeDeAutofactura | null;
  /** El secreto del código del QR (`derivarSecretoAutofactura`). */
  secreto: () => string | null;
  /** Abre un sobre dirigido a este Hub (`SecretosDelHub.abrir`). */
  abrir: (sobre: unknown) => Promise<string | null>;
  /** Sin FacturAPI no se ofrece el portal: nadie podría timbrar lo que pidan. */
  facturapiActiva: () => boolean;
  emisor: () => DatosEmisor | undefined;
  catalogo: () => CatalogoIndex | null;
  enGlobal: (ordenId: ID) => boolean;
  sucursal: () => string;
  hub_id: ID;
  /** Por el Hub y no directo al registro: las cajas tienen que enterarse. */
  inyectar: (eventos: EventoBase[]) => void;
  /** Se generó un comprobante: que la cola lo timbre ya, sin esperar su reloj. */
  alGenerar?: () => void;
  /** Cambió lo que la caja tiene que imprimir (el portal se encendió o apagó). */
  alCambiarEstado?: () => void;
  /** Le avisa al comensal que su factura no salió. */
  avisarRechazo?: (correo: string, datos: { folio: string; motivo: string; enlace: string }) => Promise<void>;
  anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
  ahora?: () => number;
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS autofactura_ticket (
  orden_id   TEXT PRIMARY KEY,
  folio      TEXT NOT NULL,
  total      INTEGER NOT NULL,
  cerrada_ts INTEGER NOT NULL,
  vence_ts   INTEGER NOT NULL,
  publicado  INTEGER NOT NULL DEFAULT 0,
  facturado  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS autofactura_solicitud (
  id          TEXT PRIMARY KEY,
  orden_id    TEXT NOT NULL,
  cfdi_id     TEXT,
  estado      TEXT NOT NULL,
  error       TEXT,
  uuid        TEXT,
  correo      TEXT,
  creado_ts   INTEGER NOT NULL,
  resuelto_ts INTEGER,
  informado   INTEGER NOT NULL DEFAULT 0,
  avisado     INTEGER NOT NULL DEFAULT 0
);
`;

interface FilaTicketLocal {
  orden_id: string;
  folio: string;
  total: number;
  cerrada_ts: number;
  vence_ts: number;
}

interface FilaSolicitudLocal {
  id: string;
  orden_id: string;
  cfdi_id: string | null;
  estado: "en_proceso" | "timbrada" | "rechazada";
  error: string | null;
  uuid: string | null;
  correo: string | null;
  creado_ts: number;
  resuelto_ts: number | null;
  avisado: number;
}

export class AutofacturaDelHub {
  private clave: ClaveDelLocal | null = null;
  private cadena: Promise<unknown> = Promise.resolve();
  private readonly ahora: () => number;

  constructor(private readonly o: OpcionesAutofactura) {
    this.o.db.exec(ESQUEMA);
    this.ahora = o.ahora ?? Date.now;
  }

  /**
   * Lo que la caja necesita para imprimir el QR, o `null` si no hay portal.
   * Solo con FacturAPI: un QR que lleva a un portal que no puede timbrar es
   * peor que no tener QR.
   */
  estado(): ClaveDelLocal | null {
    return this.clave && this.o.facturapiActiva() ? { ...this.clave } : null;
  }

  // --- Lo que entra al registro ----------------------------------------------------------

  /**
   * Anota los tickets que se acaban de cobrar. Se llama con lo que ingiere el
   * Hub; publicarlos es trabajo de `sincronizar`, que sabe si hay red.
   *
   * Se anotan AUNQUE el portal esté apagado: si Gonzalo lo enciende hoy, los
   * tickets de las últimas 72 horas ya se pueden pedir.
   */
  alIngerir(eventos: readonly EventoBase[]): void {
    const cerradas = eventos
      .filter((e) => e.tipo === "cuenta_cerrada")
      .map((e) => (e as unknown as { orden_id?: ID }).orden_id)
      .filter((o): o is ID => typeof o === "string");
    if (cerradas.length === 0) return;
    void this.enSerie(async () => {
      for (const orden of cerradas) await this.anotarTicket(orden);
    });
  }

  /** Al arrancar: los tickets de las últimas 72 horas, por si el Hub estuvo apagado. */
  async arrancar(): Promise<void> {
    const desde = this.ahora() - 3 * DIA;
    const ordenes = new Set<ID>();
    for (const e of this.o.log.porTipo("cuenta_cerrada", 0, 5_000_000)) {
      if (e.ts >= desde) ordenes.add((e as unknown as { orden_id: ID }).orden_id);
    }
    await this.enSerie(async () => {
      for (const orden of ordenes) await this.anotarTicket(orden);
    });
  }

  private async anotarTicket(orden: ID): Promise<void> {
    const cuenta = await this.cuenta(orden);
    const ticket = cuenta ? ticketAutofacturable(cuenta) : null;
    if (!ticket) return;
    /*
     * Si la cuenta se reabre y se vuelve a cobrar, el total cambia: se
     * reescribe y se vuelve a publicar. Si no cambió nada, no se toca —publicar
     * de nuevo lo mismo es tráfico para nada—.
     */
    this.o.db
      .prepare(
        `INSERT INTO autofactura_ticket (orden_id, folio, total, cerrada_ts, vence_ts, publicado)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(orden_id) DO UPDATE SET
           total = excluded.total, cerrada_ts = excluded.cerrada_ts,
           vence_ts = excluded.vence_ts, publicado = 0
         WHERE autofactura_ticket.total <> excluded.total
            OR autofactura_ticket.cerrada_ts <> excluded.cerrada_ts`,
      )
      .run(ticket.orden_id, ticket.folio, ticket.total, ticket.cerrada_ts, ticket.vence_ts);
  }

  // --- La pasada ---------------------------------------------------------------------------

  /** Una pasada completa. Se llama cada minuto, al conectar y tras timbrar. */
  sincronizar(): Promise<void> {
    return this.enSerie(() => this.pasada());
  }

  /** Una solicitud que acaba de llegar por Realtime. */
  recibir(fila: FilaSolicitud): Promise<void> {
    return this.enSerie(async () => {
      const nube = this.o.nube();
      if (!nube) return;
      // Puede llegar antes de la primera pasada: sin la clave parecería que el
      // portal está apagado y se rechazaría una solicitud buena.
      if (!this.clave) await this.refrescarClave(nube);
      await this.atender(fila, nube);
    });
  }

  private async pasada(): Promise<void> {
    const nube = this.o.nube();
    if (!nube) return;
    const ahora = this.ahora();

    await this.refrescarClave(nube);

    // Lo que ya se pidió se contesta aunque el portal se haya apagado después.
    await this.revisarResultados(ahora);
    await this.informar(nube);

    if (!this.estado()) return;
    const secreto = this.o.secreto();
    if (!secreto) return;

    await this.publicar(nube, secreto, ahora);
    await this.marcarFacturados(nube);

    await nube.purgarVencidos(ahora - DIA);
    this.o.db.prepare("DELETE FROM autofactura_ticket WHERE vence_ts < ?").run(ahora - 7 * DIA);
    this.o.db
      .prepare("DELETE FROM autofactura_solicitud WHERE informado = 1 AND creado_ts < ?")
      .run(ahora - 30 * DIA);

    for (const fila of await nube.solicitudesPendientes()) await this.atender(fila, nube);
  }

  private async refrescarClave(nube: NubeDeAutofactura): Promise<void> {
    try {
      this.clave = await nube.miClave();
    } catch {
      return; // Sin red: se queda lo último que se supo.
    }
    this.anunciarSiCambio();
  }

  private anunciado: string | undefined;

  /**
   * Avisa a las cajas si cambió lo que tienen que imprimir. Se compara contra
   * lo ÚLTIMO ANUNCIADO, no contra la pasada anterior: el estado depende también
   * de FacturAPI, que cambia por su lado (llega o se quita la llave) y se
   * anuncia desde fuera llamando aquí.
   */
  anunciarSiCambio(): void {
    const ahora = JSON.stringify(this.estado());
    if (ahora === this.anunciado) return;
    const primeraVez = this.anunciado === undefined;
    this.anunciado = ahora;
    if (!primeraVez || this.estado()) {
      const e = this.estado();
      this.o.anotar("info", e ? `Portal de autofactura encendido con la clave ${e.clave}.` : "Portal de autofactura apagado.");
    }
    this.o.alCambiarEstado?.();
  }

  private async publicar(nube: NubeDeAutofactura, secreto: string, ahora: number): Promise<void> {
    const pendientes = this.o.db
      .prepare(
        "SELECT orden_id, folio, total, cerrada_ts, vence_ts FROM autofactura_ticket " +
          "WHERE publicado = 0 AND facturado = 0 AND vence_ts > ? ORDER BY cerrada_ts LIMIT 200",
      )
      .all(ahora) as unknown as FilaTicketLocal[];
    if (pendientes.length === 0) return;

    const amparadas = this.ordenesAmparadas();
    const filas: FilaTicketFacturable[] = [];
    for (const t of pendientes) {
      // Lo que ya se facturó en la caja no se ofrece: se marca y ya.
      if (amparadas.has(t.orden_id)) {
        this.o.db.prepare("UPDATE autofactura_ticket SET facturado = 1 WHERE orden_id = ?").run(t.orden_id);
        continue;
      }
      filas.push({ ...t, codigo: await codigoDeAutofactura(t.orden_id, secreto) });
    }
    if (filas.length === 0) return;

    if (await nube.publicarTickets(filas)) {
      const marcar = this.o.db.prepare("UPDATE autofactura_ticket SET publicado = 1 WHERE orden_id = ?");
      for (const f of filas) marcar.run(f.orden_id);
    }
  }

  /**
   * Lo que se facturó por otro camino —en la caja, o en una global— se marca
   * «facturado» en la nube: el portal le dice al comensal que ya tiene factura
   * en vez de dejarle pedir otra.
   */
  private async marcarFacturados(nube: NubeDeAutofactura): Promise<void> {
    const publicados = this.o.db
      .prepare("SELECT orden_id FROM autofactura_ticket WHERE publicado = 1 AND facturado = 0")
      .all() as unknown as { orden_id: string }[];
    if (publicados.length === 0) return;
    const amparadas = this.ordenesAmparadas();
    const ordenes = publicados.map((p) => p.orden_id).filter((o) => amparadas.has(o));
    if (ordenes.length === 0) return;
    if (await nube.marcarFacturados(ordenes)) {
      const marcar = this.o.db.prepare("UPDATE autofactura_ticket SET facturado = 1 WHERE orden_id = ?");
      for (const o of ordenes) marcar.run(o);
    }
  }

  // --- Una solicitud -----------------------------------------------------------------------

  private async atender(fila: FilaSolicitud, nube: NubeDeAutofactura): Promise<void> {
    if (!fila?.id || !fila.orden_id) return;
    const ya = this.o.db.prepare("SELECT 1 FROM autofactura_solicitud WHERE id = ?").get(fila.id);
    if (ya) return;

    const ahora = this.ahora();
    await nube.marcarSolicitud(fila.id, { entregado_ts: ahora });

    const rechazar = async (motivo: string, correo?: string): Promise<void> => {
      this.o.db
        .prepare(
          `INSERT INTO autofactura_solicitud (id, orden_id, estado, error, correo, creado_ts, resuelto_ts)
           VALUES (?, ?, 'rechazada', ?, ?, ?, ?)`,
        )
        .run(fila.id, fila.orden_id, motivo.slice(0, 1000), correo ?? null, ahora, ahora);
      this.o.anotar("aviso", `Autofactura del ticket ${folioDeTicket(fila.orden_id)} rechazada: ${motivo}`);
      await this.informar(nube);
    };

    if (!this.estado()) {
      return rechazar("El restaurante apagó la factura por internet: pídela directamente ahí.");
    }

    const texto = await this.o.abrir(fila.sobre).catch(() => null);
    if (!texto) return rechazar("No pudimos leer tu solicitud: vuelve a pedirla desde el QR de tu ticket.");

    const leida = leerSolicitudDeAutofactura(texto);
    if (!leida.ok) return rechazar(leida.error);
    const { receptor, correo } = leida.solicitud;

    const cuenta = await this.cuenta(fila.orden_id);
    const cfdis = proyectarCfdis(this.eventosFiscales());
    const motivo = motivoParaNoAutofacturar({
      cuenta,
      cfdis,
      enGlobal: this.o.enGlobal(fila.orden_id),
      ahora,
    });
    if (motivo || !cuenta) return rechazar(motivo ?? "El restaurante no encuentra ese ticket.", correo);

    const emisor = this.o.emisor();
    const catalogo = this.o.catalogo();
    if (!emisor || !catalogo) {
      return rechazar(
        "El restaurante todavía no termina de configurar su facturación: pide tu factura directamente ahí.",
        correo,
      );
    }

    const serie = serieDeTerminal(SERIE_BASE, this.o.hub_id);
    const folio = siguienteFolio(cfdis, serie);
    const comprobante = construirComprobante(cuenta, catalogo, { serie, folio, emisor, receptor });
    const problemas = validarComprobante(comprobante);
    if (problemas.length > 0) return rechazar(problemas[0]!.mensaje, correo);

    /*
     * La fila local va ANTES que el comprobante. Si el Hub se cae en medio, al
     * volver encuentra la solicitud «en proceso» y espera a su comprobante —o
     * la da por perdida y la vuelve a atender—, en vez de atenderla de cero y
     * rechazarla por «ya tiene su factura» con la suya propia en la cola.
     */
    const cfdi_id = uuidv7();
    this.o.db
      .prepare(
        `INSERT INTO autofactura_solicitud (id, orden_id, cfdi_id, estado, correo, creado_ts)
         VALUES (?, ?, ?, 'en_proceso', ?, ?)`,
      )
      .run(fila.id, fila.orden_id, cfdi_id, correo, ahora);

    const sucursal = this.o.sucursal();
    const fabrica = new FabricaEventos<EventoFiscal>({
      device_id: this.o.hub_id,
      // Lo hizo el sistema, no una persona: nadie del local lo tocó.
      empleado_id: "sistema",
      sucursal_id: sucursal,
    });
    const evento = fabrica.crear("cfdi_generado", streamFiscal(sucursal), {
      cfdi_id,
      orden_id: fila.orden_id,
      serie,
      folio,
      comprobante,
      correo_receptor: correo,
    });
    this.o.inyectar([evento as unknown as EventoBase]);
    this.o.anotar("info", `Autofactura del ticket ${folioDeTicket(fila.orden_id)}: comprobante ${serie}-${folio} en cola.`);
    this.o.alGenerar?.();
  }

  // --- Los desenlaces ----------------------------------------------------------------------

  /** Lo que estaba en proceso y ya tiene desenlace en el registro fiscal. */
  private async revisarResultados(ahora: number): Promise<void> {
    const enProceso = this.o.db
      .prepare("SELECT * FROM autofactura_solicitud WHERE estado = 'en_proceso'")
      .all() as unknown as FilaSolicitudLocal[];
    if (enProceso.length === 0) return;

    const porCfdi = new Map<string, RegistroCfdi>();
    for (const r of proyectarCfdis(this.eventosFiscales())) porCfdi.set(r.cfdi_id, r);

    for (const s of enProceso) {
      const r = s.cfdi_id ? porCfdi.get(s.cfdi_id) : undefined;
      if (!r) {
        // El comprobante nunca llegó al registro (el Hub se cayó en medio): se
        // olvida la fila y la siguiente pasada vuelve a atender la solicitud.
        if (ahora - s.creado_ts > PERDIDO_TRAS_MS) {
          this.o.db.prepare("DELETE FROM autofactura_solicitud WHERE id = ?").run(s.id);
        }
        continue;
      }
      if (r.estado === "timbrado") {
        this.o.db
          .prepare("UPDATE autofactura_solicitud SET estado = 'timbrada', uuid = ?, resuelto_ts = ? WHERE id = ?")
          .run(r.uuid ?? null, ahora, s.id);
      } else if (r.estado === "rechazado") {
        // El registro guarda «400: motivo»; al comensal le sirve el motivo.
        const motivo = (r.error ?? "").replace(/^[A-Z0-9_-]+:\s*/i, "").trim() || "El SAT no aceptó la factura.";
        this.o.db
          .prepare("UPDATE autofactura_solicitud SET estado = 'rechazada', error = ?, resuelto_ts = ? WHERE id = ?")
          .run(motivo.slice(0, 1000), ahora, s.id);
      }
    }
  }

  /**
   * Contesta en la nube lo resuelto y avisa por correo los rechazos. El aviso
   * sale UNA vez, salga o no: repetirlo en cada pasada sería llenarle el buzón.
   */
  private async informar(nube: NubeDeAutofactura): Promise<void> {
    const resueltas = this.o.db
      .prepare(
        "SELECT * FROM autofactura_solicitud WHERE informado = 0 AND estado IN ('timbrada', 'rechazada')",
      )
      .all() as unknown as FilaSolicitudLocal[];

    for (const s of resueltas) {
      const ok = await nube.marcarSolicitud(s.id, {
        resultado: s.estado === "timbrada" ? "timbrada" : "rechazada",
        resuelto_ts: s.resuelto_ts ?? this.ahora(),
        ...(s.uuid ? { uuid_cfdi: s.uuid } : {}),
        ...(s.error ? { error: s.error } : {}),
      });
      if (ok) this.o.db.prepare("UPDATE autofactura_solicitud SET informado = 1 WHERE id = ?").run(s.id);

      if (s.estado === "rechazada" && s.correo && !s.avisado && this.o.avisarRechazo) {
        this.o.db.prepare("UPDATE autofactura_solicitud SET avisado = 1 WHERE id = ?").run(s.id);
        const enlace = await this.enlaceDe(s.orden_id);
        await this.o
          .avisarRechazo(s.correo, {
            folio: folioDeTicket(s.orden_id),
            motivo: s.error ?? "",
            enlace: enlace ?? "",
          })
          .catch((causa: unknown) => this.o.anotar("aviso", `No salió el aviso de rechazo: ${String(causa)}`));
      }
    }
  }

  // --- Ayudantes ---------------------------------------------------------------------------

  private async enlaceDe(orden: ID): Promise<string | null> {
    const clave = this.clave;
    const secreto = this.o.secreto();
    if (!clave || !secreto) return null;
    return urlDeAutofactura(clave.portal_url, clave.clave, folioDeTicket(orden), await codigoDeAutofactura(orden, secreto));
  }

  private async cuenta(orden: ID): Promise<EstadoComanda | undefined> {
    // El stream de una cuenta es su orden (así lo escribe la caja).
    const eventos = (await this.o.log.leerStream(orden)) as EventoComanda[];
    const suyos = eventos.filter((e) => e.orden_id === orden);
    if (suyos.length === 0) return undefined;
    return proyectarSentadas(suyos).find((c) => c.orden_id === orden);
  }

  private eventosFiscales(): EventoFiscal[] {
    const todos: (EventoFiscal & { seq?: number })[] = [];
    for (const tipo of TIPOS_EVENTO_FISCAL) {
      todos.push(...(this.o.log.porTipo(tipo, 0, 1_000_000) as unknown as EventoFiscal[]));
    }
    return todos.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  /** Las órdenes que ya tienen quien las ampare: un CFDI vigente o una global. */
  private ordenesAmparadas(): Set<ID> {
    const amparadas = new Set<ID>();
    for (const r of proyectarCfdis(this.eventosFiscales())) if (cfdiAmpara(r.estado)) amparadas.add(r.orden_id);
    const publicados = this.o.db
      .prepare("SELECT orden_id FROM autofactura_ticket WHERE facturado = 0")
      .all() as unknown as { orden_id: string }[];
    for (const { orden_id } of publicados) if (this.o.enGlobal(orden_id)) amparadas.add(orden_id);
    return amparadas;
  }

  private enSerie<T>(tarea: () => Promise<T>): Promise<T> {
    const siguiente = this.cadena.then(tarea, tarea);
    this.cadena = siguiente.catch((causa: unknown) => {
      this.o.anotar("error", `Fallo en la autofactura: ${causa instanceof Error ? causa.message : String(causa)}`);
    });
    return siguiente;
  }
}
