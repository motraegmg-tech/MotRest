/**
 * La factura global del mes, del lado del Hub: juntarla, timbrarla y anotarla.
 *
 * Qué entra y cuándo toca lo decide el dominio (`fiscal/global.ts`); aquí vive
 * lo que depende de la máquina: leer las cuentas del registro, hablar con
 * FacturAPI, reintentar sin red y dejar el hecho en el registro del local para
 * que la caja y el contador lo vean.
 *
 * QUIÉN DECIDE (1.5.6)
 *
 * El local. `modo_global` vive en el catálogo `facturacion_config` y vale
 * `manual` —por defecto— o `automatica`:
 *
 *   - En `automatica` esto corre solo, como en la 1.5.5: al arrancar y cada
 *     hora, de modo que un Hub apagado el día 1 —se fue la luz, cerraron por
 *     vacaciones— emite la global atrasada en cuanto enciende.
 *   - En `manual` el barrido NO timbra nada. Sigue mirando el calendario para
 *     avisar en la bitácora que el mes cerró y que corren las 72 horas del SAT,
 *     pero quien decide qué cuentas entran es una persona desde la caja, con
 *     `emitirManual()`.
 *
 * El cambio es de Gonzalo: «el restaurantero elige y es dueño de su tipo de
 * facturación». Hasta la 1.5.5 el Hub declaraba por él.
 *
 * LO QUE NO PUEDE PASAR
 *
 * Timbrar dos veces la misma venta. Por eso:
 *   - `idempotency_key` = `global-<sucursal>-<AAAA-MM>` (y `-pN` de la segunda
 *     parte en adelante): si la respuesta se pierde en un corte, el reintento
 *     devuelve la misma factura.
 *   - Las cuentas de cada parte se congelan en la base al primer intento: el
 *     reintento manda EXACTAMENTE lo mismo, que es lo que hace que la llave de
 *     idempotencia diga la verdad. Vale igual para la emisión manual: si hay una
 *     tanda congelada sin timbrar, la siguiente petición la REANUDA en vez de
 *     armar otra con lo que venga de la caja.
 *   - Un mes con su hecho en el registro ya no se vuelve a emitir solo aunque
 *     esta base se pierda.
 *   - Y una cuenta que ya está en una global de producción no vuelve a entrar en
 *     ninguna: es el filtro que se aplica SIEMPRE, también a lo que eligió una
 *     persona. En manual un mes puede llevar varias globales —lo que quedó fuera
 *     sigue vivo—, pero cada venta va en una sola.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  FabricaEventos,
  facturasGlobales,
  formaPagoDeLaGlobal,
  esPeriodoDiario,
  limitesDelPeriodo,
  partirEnFacturas,
  periodoDe,
  periodoEnPalabras,
  periodoGlobalValido,
  periodosPorEmitir,
  leerCorreosDeFactura,
  proyectarCfdis,
  proyectarSentadas,
  resumenDeDescartes,
  RFC_PUBLICO_GENERAL,
  streamFiscal,
  ticketsElegidosParaGlobal,
  ticketsParaGlobal,
  totalDeTickets,
  TIPOS_EVENTO_FISCAL,
  conceptosDeTicket,
  folioDeTicket,
  type CuentaDescartada,
  type EstadoComanda,
  type EventoBase,
  type EventoComanda,
  type EventoFiscal,
  type FacturaGlobalRegistrada,
  type ID,
  type ModoFacturacionGlobal,
  type ModoFacturapi,
  type PeriodicidadGlobal,
  type TicketGlobal,
} from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";
import type { EstadoFacturaGlobal } from "@motrest/protocolo-sync";
import { conceptoGlobalAFacturapi, type ClienteFacturapi, type FacturaFacturapi } from "./facturapi.js";

/** A las 72 horas del cierre el SAT ya no la da por oportuna: se avisa fuerte. */
const PLAZO_SAT_MS = 72 * 3_600_000;
const ESPERA_BASE_MS = 10 * 60_000;
const ESPERA_MAXIMA_MS = 3_600_000;
/** Cuántas globales se le cuentan a la caja. Más no cabe en una pantalla. */
const HISTORIAL_MAXIMO = 24;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS factura_global (
  periodo           TEXT NOT NULL,
  modo              TEXT NOT NULL,
  completa          INTEGER NOT NULL DEFAULT 0,
  intentos          INTEGER NOT NULL DEFAULT 0,
  proximo_ts        INTEGER NOT NULL DEFAULT 0,
  primer_intento_ts INTEGER NOT NULL,
  problema          TEXT,
  avisado           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (periodo, modo)
);
CREATE TABLE IF NOT EXISTS factura_global_parte (
  periodo    TEXT NOT NULL,
  modo       TEXT NOT NULL,
  parte      INTEGER NOT NULL,
  ordenes    TEXT NOT NULL,
  externo_id TEXT,
  emitida    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (periodo, modo, parte)
);
`;

/**
 * Columnas que la 1.5.6 añade a una base que ya existe en los locales.
 *
 * No se puede recrear la tabla: dentro están las tandas congeladas y las partes
 * ya timbradas, que es justo lo que impide timbrar dos veces. Se añaden sueltas
 * y se ignora el error de «ya existe», que es lo que SQLite contesta la segunda
 * vez que arranca el Hub.
 */
const COLUMNAS_NUEVAS: readonly string[] = [
  // Que el mes cerró se avisa UNA vez, no cada hora hasta que alguien emita.
  "ALTER TABLE factura_global ADD COLUMN avisado_cierre INTEGER NOT NULL DEFAULT 0",
  // Quién pidió esta tanda y quién la autorizó. Viaja con la tanda y no con la
  // petición: si el primer intento se cae sin red y se reanuda tres horas más
  // tarde, el hecho tiene que seguir diciendo quién decidió el corte.
  "ALTER TABLE factura_global_parte ADD COLUMN origen TEXT",
  "ALTER TABLE factura_global_parte ADD COLUMN autorizador_id TEXT",
  // 1.5.7: a dónde mandar la factura. Va con la tanda por lo mismo que el
  // autorizador: si el timbrado se reanuda horas después, el envío también.
  "ALTER TABLE factura_global_parte ADD COLUMN correos TEXT",
];

export interface FacturapiParaGlobal {
  cliente: Pick<ClienteFacturapi, "crearFactura" | "factura" | "buscarPorExterno" | "organizacion"> &
    Partial<Pick<ClienteFacturapi, "enviarPorCorreoA">>;
  modo: ModoFacturapi;
  /** Desde cuándo hay llave de este modo: los meses anteriores no se tocan. */
  desde_ts: number;
  /** CP del domicilio fiscal de la organización, si ya se conoce. */
  cp?: string;
}

export interface OpcionesFacturaGlobal {
  db: DatabaseSync;
  log: LogHub;
  sucursal: () => string;
  facturapi: () => FacturapiParaGlobal | null;
  hub_id?: ID;
  /**
   * El modo de facturación global del local (catálogo `facturacion_config`).
   *
   * Es una función y no un valor porque se cambia en caliente desde la caja: el
   * Hub no se reinicia para eso. Si no se pasa, `manual` — el valor con el que
   * nadie timbra sin haberlo pedido.
   */
  modo?: () => ModoFacturacionGlobal;
  /**
   * Cada cuánto emite el barrido automático, y desde cuándo (1.5.7). Sin esto,
   * mensual. La emisión manual no lo necesita: el periodo que llega dice si es
   * un mes o un día.
   */
  periodicidad?: () => { periodicidad: PeriodicidadGlobal; desde: number };
  /** Cómo entra el hecho al registro. En el Hub real, repartido a las terminales. */
  inyectar?: (eventos: readonly EventoBase[]) => void;
  anotar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
}

interface FilaPeriodo {
  periodo: string;
  modo: ModoFacturapi;
  completa: number;
  intentos: number;
  proximo_ts: number;
  primer_intento_ts: number;
  problema: string | null;
  avisado: number;
  avisado_cierre: number;
}

interface FilaParte {
  parte: number;
  ordenes: string;
  externo_id: string | null;
  emitida: number;
  origen: string | null;
  autorizador_id: string | null;
  correos: string | null;
}

/** Quién pidió una tanda. Sin esto, es el barrido del Hub. */
interface PeticionManual {
  ordenes: readonly ID[];
  autorizador_id: ID;
  /** A dónde se manda la factura timbrada. Vacío = no se manda. */
  correos?: readonly string[];
}

/** Lo que el Hub contesta a la caja cuando se le pide emitir una global. */
export interface ResultadoEmisionManual {
  ok: boolean;
  /** Cuántas facturas se timbraron (un mes grande va en varias partes). */
  emitidas: number;
  /** Cuántas cuentas quedaron dentro. */
  cuentas: number;
  /** Las que no pasaron el filtro del Hub, con su motivo. */
  descartadas: CuentaDescartada[];
  /** Qué hay que decirle a quien lo pidió. Vacío si todo salió limpio. */
  problema?: string;
}

/** La llave de idempotencia (y el `external_id`) de cada parte. */
export function claveDeGlobal(sucursal: string, periodo: string, parte: number): string {
  return `global-${sucursal}-${periodo}${parte > 1 ? `-p${parte}` : ""}`;
}

/** El JSON de `POST /v2/invoices` para una parte de la global. */
export function cuerpoDeGlobal(opciones: {
  tickets: readonly TicketGlobal[];
  periodo: string;
  parte: number;
  sucursal: string;
  cp: string;
}): Record<string, unknown> {
  const [anio, mes] = opciones.periodo.split("-") as [string, string];
  // «day» es el 01 Diario del SAT; el mes y el año son los del día amparado.
  const periodicity = esPeriodoDiario(opciones.periodo) ? "day" : "month";
  const clave = claveDeGlobal(opciones.sucursal, opciones.periodo, opciones.parte);
  return {
    type: "I",
    customer: {
      legal_name: "PUBLICO EN GENERAL",
      tax_id: RFC_PUBLICO_GENERAL,
      tax_system: "616",
      // Regla del SAT para la global: el domicilio es el CP de expedición.
      address: { zip: opciones.cp },
    },
    items: opciones.tickets.flatMap((t) => t.conceptos.map(conceptoGlobalAFacturapi)),
    use: "S01",
    payment_form: formaPagoDeLaGlobal(opciones.tickets),
    payment_method: "PUE",
    currency: "MXN",
    global: { periodicity, months: mes, year: Number(anio) },
    external_id: clave,
    idempotency_key: clave,
  };
}

export class FacturaGlobalMensual {
  private fabrica: FabricaEventos<EventoFiscal>;
  /** Orden → periodo de su global de PRODUCCIÓN. Lo consulta el facturador en cada cobro. */
  private enGlobales = new Map<ID, string>();
  private ultimoEstado: EstadoFacturaGlobal = {};
  private revisando = false;

  constructor(private readonly opciones: OpcionesFacturaGlobal) {
    this.opciones.db.exec(ESQUEMA);
    for (const columna of COLUMNAS_NUEVAS) {
      try {
        this.opciones.db.exec(columna);
      } catch {
        // Ya estaba. Es el caso normal a partir del segundo arranque.
      }
    }
    this.fabrica = new FabricaEventos<EventoFiscal>({
      device_id: opciones.hub_id ?? "hub",
      // Nadie la pidió: la emite el Hub a su nombre, como el timbrado.
      empleado_id: "sistema",
      sucursal_id: "",
    });
    this.refrescarGlobales();
  }

  private anotar(nivel: "info" | "aviso" | "error", mensaje: string): void {
    this.opciones.anotar?.(nivel, mensaje);
  }

  /** ¿Esta orden ya está en una global de verdad? Devuelve su periodo. */
  enGlobal(ordenId: ID): string | null {
    return this.enGlobales.get(ordenId) ?? null;
  }

  /** El modo del local. Sin catálogo aplicado, `manual`. */
  modo(): ModoFacturacionGlobal {
    return this.opciones.modo?.() ?? "manual";
  }

  estado(): EstadoFacturaGlobal {
    return { ...this.ultimoEstado, modo: this.modo() };
  }

  private eventosFiscales(): EventoFiscal[] {
    const todos: (EventoFiscal & { seq?: number })[] = [];
    for (const tipo of TIPOS_EVENTO_FISCAL) {
      todos.push(...(this.opciones.log.porTipo(tipo, 0, 1_000_000) as unknown as EventoFiscal[]));
    }
    return todos.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  private globalesDelRegistro(): FacturaGlobalRegistrada[] {
    return facturasGlobales(this.opciones.log.porTipo("factura_global_emitida", 0, 100_000));
  }

  private refrescarGlobales(): void {
    const globales = this.globalesDelRegistro();
    this.enGlobales.clear();
    for (const g of globales) {
      if (g.modo !== "produccion") continue;
      for (const o of g.ordenes) this.enGlobales.set(o, g.periodo);
    }
    const ultima = globales.filter((g) => g.modo === "produccion").at(-1) ?? globales.at(-1);
    this.ultimoEstado = {
      ...this.ultimoEstado,
      ...(ultima
        ? {
            ultima: {
              periodo: ultima.periodo,
              uuid: ultima.uuid,
              total: ultima.total,
              cuentas: ultima.ordenes.length,
              emitida_ts: ultima.ts,
              ...(ultima.origen ? { origen: ultima.origen } : {}),
            },
          }
        : {}),
      /*
       * El historial se arma aquí y no en la pantalla porque la pantalla no
       * tiene el registro fiscal completo: la caja recibe los eventos del
       * salón, y las globales las publica el Hub. Antes de la 1.5.6 esto no
       * hacía falta —solo se enseñaba la última— y el módulo de facturación
       * habría tenido que recorrer el log entero para pintar una tabla.
       */
      historial: globales
        .slice(-HISTORIAL_MAXIMO)
        .reverse()
        .map((g) => ({
          periodo: g.periodo,
          parte: g.parte,
          uuid: g.uuid,
          total: g.total,
          cuentas: g.ordenes.length,
          modo: g.modo,
          emitida_ts: g.ts,
          ...(g.origen ? { origen: g.origen } : {}),
        })),
    };
  }

  /** Las cuentas de unas órdenes, leídas de su propio stream. */
  private async cuentas(ordenes: Iterable<ID>): Promise<Map<ID, EstadoComanda>> {
    const resultado = new Map<ID, EstadoComanda>();
    for (const orden of ordenes) {
      // El stream de una cuenta es su orden (así lo escribe la caja).
      const eventos = (await this.opciones.log.leerStream(orden)) as EventoComanda[];
      const suyos = eventos.filter((e) => e.orden_id === orden);
      if (suyos.length === 0) continue;
      const cuenta = proyectarSentadas(suyos).find((c) => c.orden_id === orden);
      if (cuenta) resultado.set(orden, cuenta);
    }
    return resultado;
  }

  /** Las cuentas cobradas en el periodo, por la hora de su cierre. */
  private async cuentasDelPeriodo(periodo: string): Promise<EstadoComanda[]> {
    const { desde, hasta } = limitesDelPeriodo(periodo);
    const ordenes = new Set<ID>();
    for (const e of this.opciones.log.porTipo("cuenta_cerrada", 0, 5_000_000)) {
      if (e.ts >= desde && e.ts < hasta) ordenes.add((e as unknown as { orden_id: ID }).orden_id);
    }
    return [...(await this.cuentas(ordenes)).values()];
  }

  private fila(periodo: string, modo: ModoFacturapi): FilaPeriodo | undefined {
    return this.opciones.db
      .prepare("SELECT * FROM factura_global WHERE periodo = ? AND modo = ?")
      .get(periodo, modo) as FilaPeriodo | undefined;
  }

  private partesDe(periodo: string, modo: ModoFacturapi): FilaParte[] {
    return this.opciones.db
      .prepare(
        "SELECT parte, ordenes, externo_id, emitida, origen, autorizador_id, correos " +
          "FROM factura_global_parte WHERE periodo = ? AND modo = ? ORDER BY parte",
      )
      .all(periodo, modo) as unknown as FilaParte[];
  }

  /** Asegura la fila del periodo y la devuelve. */
  private filaOCrear(periodo: string, modo: ModoFacturapi, ahora: number): FilaPeriodo {
    const fila = this.fila(periodo, modo);
    if (fila) return fila;
    this.opciones.db
      .prepare("INSERT INTO factura_global (periodo, modo, primer_intento_ts) VALUES (?, ?, ?)")
      .run(periodo, modo, ahora);
    return this.fila(periodo, modo)!;
  }

  /**
   * Los meses cerrados que todavía no tienen su global, del más viejo al más nuevo.
   *
   * Lo que ya consta en el registro sin rastro en esta base (base perdida, Hub
   * reinstalado) se da por emitido: antes que timbrar dos veces, avisar.
   */
  private periodosPendientes(
    fa: FacturapiParaGlobal,
    ahora: number,
  ): { globales: FacturaGlobalRegistrada[]; pendientes: string[] } {
    const globales = this.globalesDelRegistro().filter((g) => g.modo === fa.modo);
    const conFila = new Set(
      (
        this.opciones.db.prepare("SELECT periodo FROM factura_global WHERE modo = ?").all(fa.modo) as {
          periodo: string;
        }[]
      ).map((f) => f.periodo),
    );
    const completos = new Set(
      (
        this.opciones.db
          .prepare("SELECT periodo FROM factura_global WHERE modo = ? AND completa = 1")
          .all(fa.modo) as { periodo: string }[]
      ).map((f) => f.periodo),
    );
    for (const g of globales) if (!conFila.has(g.periodo)) completos.add(g.periodo);

    /*
     * EN DIARIA, DESDE EL MES DEL CAMBIO. Los días de meses anteriores ya los
     * amparó —o los tiene que amparar— la global mensual; ponerse a emitir una
     * diaria por cada uno sería un alud de comprobantes vacíos o, peor, amparar
     * a destiempo lo que el restaurantero dejó fuera a propósito.
     */
    const { periodicidad, desde } = this.opciones.periodicidad?.() ?? { periodicidad: "mensual", desde: 0 };
    const desde_ts =
      periodicidad === "diaria" ? Math.max(fa.desde_ts, limitesDelPeriodo(periodoDe(desde)).desde) : fa.desde_ts;

    return {
      globales,
      pendientes: periodosPorEmitir({ ahora, desde_ts, emitidos: completos, periodicidad }),
    };
  }

  /**
   * Deja escrito en el estado qué mes espera y con cuánto plazo.
   *
   * El plazo del SAT viaja hasta la caja —y no se calcula allí— porque el mes se
   * cierra a una hora del local (`HORA_DE_CIERRE_GLOBAL`) que solo el Hub conoce
   * de forma autoritativa: una tableta con el reloj corrido pintaría un plazo
   * que no es.
   */
  private anunciarPendiente(periodo: string | undefined, modo: ModoFacturapi, ahora: number): void {
    const fila = periodo ? this.fila(periodo, modo) : undefined;
    const vence = periodo ? limitesDelPeriodo(periodo).vence : 0;
    this.ultimoEstado = {
      ...this.ultimoEstado,
      pendiente: periodo
        ? {
            periodo,
            desde_ts: vence,
            plazo_sat_ts: vence + PLAZO_SAT_MS,
            fuera_de_plazo: ahora - vence > PLAZO_SAT_MS,
            ...(fila?.problema ? { problema: fila.problema } : {}),
          }
        : undefined,
    };
  }

  /**
   * Avisa una sola vez de que el mes cerró y otra de que se pasó el plazo.
   *
   * Las dos son de bitácora, no de pantalla, y las dos se dicen igual en los dos
   * modos: el SAT no distingue si el local eligió emitir a mano. Lo que cambia
   * es el consejo, porque en manual no hay nada roto que arreglar — hay algo que
   * alguien tiene que ir a autorizar.
   */
  private avisarDelPlazo(periodo: string, modo: ModoFacturapi, ahora: number): void {
    const fila = this.filaOCrear(periodo, modo, ahora);
    const manual = this.modo() === "manual";

    if (!fila.avisado_cierre) {
      const cual = periodoEnPalabras(periodo);
      const Cual = cual.charAt(0).toUpperCase() + cual.slice(1);
      this.anotar(
        "aviso",
        manual
          ? `${Cual} ya cerró y su factura global está sin emitir. Tienes 72 horas desde el cierre ` +
              "para timbrarla: entra a Finanzas → Facturación → Factura global y elige qué cuentas entran."
          : `${Cual} ya cerró: su factura global entra en cola. Corren las 72 horas del SAT.`,
      );
      this.opciones.db
        .prepare("UPDATE factura_global SET avisado_cierre = 1 WHERE periodo = ? AND modo = ?")
        .run(periodo, modo);
    }

    if (!fila.avisado && ahora - limitesDelPeriodo(periodo).vence > PLAZO_SAT_MS) {
      this.anotar(
        "error",
        `La factura global de ${periodo} lleva más de 72 horas sin emitirse` +
          `${fila.problema ? ` (${fila.problema})` : ""}. ` +
          "Avisa a tu contador: está fuera del plazo del SAT.",
      );
      this.opciones.db
        .prepare("UPDATE factura_global SET avisado = 1 WHERE periodo = ? AND modo = ?")
        .run(periodo, modo);
    }
  }

  /**
   * Revisa si toca emitir alguna global y la emite —si el local lo tiene en
   * automático—.
   *
   * En manual solo mira el calendario: deja dicho qué mes espera, avisa en la
   * bitácora del cierre y del plazo del SAT, y no toca FacturAPI. Ese es el
   * punto del modo manual: que nadie timbre por el restaurantero.
   *
   * No lanza: un fallo aquí no puede tumbar el Hub. Lo que no salió se queda
   * pendiente con su motivo y se reintenta en la siguiente vuelta.
   */
  async revisar(ahora = Date.now()): Promise<{ emitidas: number; pendientes: string[] }> {
    if (this.revisando) return { emitidas: 0, pendientes: [] };
    this.revisando = true;
    try {
      return await this.revisarYa(ahora);
    } catch (error) {
      this.anotar("error", `Fallo al revisar la factura global: ${error instanceof Error ? error.message : String(error)}`);
      return { emitidas: 0, pendientes: [] };
    } finally {
      this.revisando = false;
    }
  }

  private async revisarYa(ahora: number): Promise<{ emitidas: number; pendientes: string[] }> {
    const fa = this.opciones.facturapi();
    if (!fa) return { emitidas: 0, pendientes: [] };

    const { globales, pendientes } = this.periodosPendientes(fa, ahora);

    /*
     * EL FRENO DEL MODO MANUAL.
     *
     * Aquí es donde la 1.5.6 se separa de la 1.5.5. En manual el Hub sigue
     * sabiéndolo todo —qué mes cerró, cuánto plazo queda— y lo dice, pero no
     * timbra: emitir una global es declarar ante el SAT qué se vendió y dejar
     * fuera el resto, y esa firma es del restaurantero. Se avisa ANTES de salir,
     * porque un local en manual que se olvide del mes es justo el que necesita
     * el recordatorio.
     */
    if (this.modo() === "manual") {
      for (const periodo of pendientes) this.avisarDelPlazo(periodo, fa.modo, ahora);
      this.refrescarGlobales();
      this.anunciarPendiente(pendientes[0], fa.modo, ahora);
      return { emitidas: 0, pendientes: [...pendientes] };
    }

    let emitidas = 0;
    for (const periodo of pendientes) {
      emitidas += (await this.emitirPeriodo(periodo, fa, globales, ahora)).emitidas;
    }

    this.refrescarGlobales();
    const restante = pendientes.find((p) => this.fila(p, fa.modo)?.completa !== 1);
    this.anunciarPendiente(restante, fa.modo, ahora);
    return { emitidas, pendientes: restante ? pendientes.filter((p) => this.fila(p, fa.modo)?.completa !== 1) : [] };
  }

  private async emitirPeriodo(
    periodo: string,
    fa: FacturapiParaGlobal,
    globales: readonly FacturaGlobalRegistrada[],
    ahora: number,
    manual?: PeticionManual,
  ): Promise<{
    emitidas: number;
    cuentas: number;
    problema: string | null;
    descartadas: CuentaDescartada[];
    reanudada: boolean;
    /** Lo que se timbró pero no se pudo mandar por correo. */
    avisosCorreo: string[];
  }> {
    const { db } = this.opciones;
    const nada = {
      emitidas: 0,
      cuentas: 0,
      descartadas: [] as CuentaDescartada[],
      reanudada: false,
      avisosCorreo: [] as string[],
    };
    const fila = this.filaOCrear(periodo, fa.modo, ahora);

    /*
     * El freno exponencial es del barrido automático: existe para no martillear
     * a FacturAPI cada hora cuando algo va mal. A quien emite a mano no se le
     * aplica, porque acaba de tocar un botón, está mirando la pantalla y casi
     * siempre acaba de arreglar la causa —puso el CP en el panel, volvió la
     * luz—. Hacerle esperar diez minutos sin decirle nada sería el peor de los
     * dos mundos.
     */
    if (!manual && fila.proximo_ts > ahora) return { ...nada, problema: null };

    const sucursal = this.opciones.sucursal();
    const previas = this.partesDe(periodo, fa.modo);
    const congeladas = previas.filter((p) => !p.emitida);

    let aEmitir: FilaParte[] = previas;
    let descartadas: CuentaDescartada[] = [];
    let reanudada = false;

    if (manual && congeladas.length > 0) {
      /*
       * HAY UNA TANDA CONGELADA SIN TIMBRAR: SE REANUDA ESA.
       *
       * Un intento anterior armó las partes y se quedó a medias —se cayó la red,
       * FacturAPI contestó «pending»—. Su `idempotency_key` ya viajó, así que
       * FacturAPI puede tener esa factura creada aunque el Hub no se enterara.
       * Mandar ahora una lista distinta bajo la MISMA llave es cómo se acaba con
       * una global que dice una cosa en el SAT y otra en el registro del local.
       * Por eso se ignora la selección nueva, se termina lo congelado, y se le
       * dice a quien lo pidió para que vuelva por lo que quedó fuera.
       */
      aEmitir = congeladas;
      reanudada = true;
    } else if (manual) {
      const seleccion = ticketsElegidosParaGlobal({
        seleccion: manual.ordenes,
        // Solo las cuentas elegidas: recorrer el mes entero para timbrar veinte
        // tickets sería leer el registro completo sin necesidad.
        comandas: [...(await this.cuentas(manual.ordenes)).values()],
        cfdis: proyectarCfdis(this.eventosFiscales()),
        globales,
        periodo,
      });
      descartadas = seleccion.descartadas;
      if (seleccion.tickets.length === 0) {
        return {
          ...nada,
          descartadas,
          problema:
            "Ninguna de las cuentas elegidas puede entrar en la factura global" +
            `${descartadas.length > 0 ? `: ${resumenDeDescartes(descartadas)}.` : "."}`,
        };
      }
      aEmitir = this.congelarTanda(periodo, fa.modo, seleccion.tickets, previas, manual);
    } else if (previas.length === 0) {
      // Primera vez del barrido: se eligen los tickets y se congelan por parte.
      const tickets = ticketsParaGlobal({
        comandas: await this.cuentasDelPeriodo(periodo),
        cfdis: proyectarCfdis(this.eventosFiscales()),
        globales,
        periodo,
      });
      if (tickets.length === 0) {
        db.prepare("UPDATE factura_global SET completa = 1, problema = NULL WHERE periodo = ? AND modo = ?").run(
          periodo,
          fa.modo,
        );
        this.anotar("info", `Factura global de ${periodo}: no hubo ventas sin facturar. Nada que emitir.`);
        return { ...nada, problema: null };
      }
      aEmitir = this.congelarTanda(periodo, fa.modo, tickets, previas, undefined);
    }

    let cp = fa.cp;
    if (!cp) {
      const org = await fa.cliente.organizacion();
      cp = org.ok ? org.datos.legal?.address?.zip : undefined;
    }

    let emitidas = 0;
    let cuentas = 0;
    let problema: string | null = null;
    const avisosCorreo: string[] = [];
    for (const parte of aEmitir) {
      if (parte.emitida) continue;
      if (!cp) {
        problema = "FacturAPI no tiene el código postal de la organización: complétalo en su panel.";
        break;
      }
      const ordenes = JSON.parse(parte.ordenes) as ID[];
      const tickets = await this.ticketsDe(ordenes);
      const resultado = await this.timbrarParte(fa, parte, {
        tickets,
        periodo,
        parte: parte.parte,
        sucursal,
        cp,
      });
      if (resultado.externo_id && resultado.externo_id !== parte.externo_id) {
        db.prepare("UPDATE factura_global_parte SET externo_id = ? WHERE periodo = ? AND modo = ? AND parte = ?").run(
          resultado.externo_id,
          periodo,
          fa.modo,
          parte.parte,
        );
      }
      if (resultado.factura) {
        this.publicar(periodo, parte.parte, resultado.factura, tickets, fa.modo, sucursal, {
          // Lo que se escribe es lo que se congeló CON LA TANDA, no lo que trae
          // la petición de ahora: una tanda reanudada la autorizó quien la armó.
          origen: (parte.origen as ModoFacturacionGlobal | null) ?? "automatica",
          ...(parte.autorizador_id ? { autorizador_id: parte.autorizador_id } : {}),
        });
        db.prepare("UPDATE factura_global_parte SET emitida = 1 WHERE periodo = ? AND modo = ? AND parte = ?").run(
          periodo,
          fa.modo,
          parte.parte,
        );
        emitidas += 1;
        cuentas += tickets.length;
        const aviso = await this.enviarPorCorreo(fa, resultado.factura, parte, periodo);
        if (aviso) avisosCorreo.push(aviso);
      } else {
        problema = resultado.problema ?? "No se pudo timbrar.";
        break;
      }
    }

    if (problema === null) {
      /*
       * `completa = 1` cierra el mes PARA EL BARRIDO, no para el restaurantero:
       * en manual puede emitir otra global del mismo mes con lo que quedó fuera
       * —la numeración de partes continúa y la llave de idempotencia cambia—.
       * Lo que esta marca evita es que el barrido automático, si el local se
       * pasa a ese modo, vuelva a juntar el mes por su cuenta.
       */
      db.prepare("UPDATE factura_global SET completa = 1, problema = NULL WHERE periodo = ? AND modo = ?").run(
        periodo,
        fa.modo,
      );
      return { emitidas, cuentas, problema: null, descartadas, reanudada, avisosCorreo };
    }

    const intentos = fila.intentos + 1;
    const espera = Math.min(ESPERA_BASE_MS * 2 ** (intentos - 1), ESPERA_MAXIMA_MS);
    db.prepare(
      "UPDATE factura_global SET intentos = ?, proximo_ts = ?, problema = ? WHERE periodo = ? AND modo = ?",
    ).run(intentos, ahora + espera, problema, periodo, fa.modo);
    if (intentos === 1) this.anotar("aviso", `Factura global de ${periodo} pendiente: ${problema}`);

    /*
     * El SAT da 72 horas desde el cierre del periodo. Pasado eso ya no es un
     * retraso de la red: alguien tiene que mirarlo —y el contador saberlo—.
     */
    this.avisarDelPlazo(periodo, fa.modo, ahora);
    return { emitidas, cuentas, problema, descartadas, reanudada, avisosCorreo };
  }

  /**
   * Manda la factura timbrada a los correos que se eligieron al emitirla.
   *
   * Un correo que no sale NO deshace nada: la factura ya existe ante el SAT. Se
   * cuenta para que quien la emitió sepa que tiene que descargarla o reenviarla,
   * y se deja en la bitácora. Devuelve el aviso, o `null` si salió o no había a
   * quién mandarla.
   */
  private async enviarPorCorreo(
    fa: FacturapiParaGlobal,
    factura: FacturaFacturapi,
    parte: FilaParte,
    periodo: string,
  ): Promise<string | null> {
    let correos: string[] = [];
    try {
      correos = parte.correos ? (JSON.parse(parte.correos) as string[]) : [];
    } catch {
      correos = [];
    }
    if (correos.length === 0) return null;
    const cual = `La factura global de ${periodo}${parte.parte > 1 ? ` (parte ${parte.parte})` : ""}`;
    if (!fa.cliente.enviarPorCorreoA) {
      return `${cual} se timbró, pero esta caja no puede enviarla por correo: descárgala del panel de FacturAPI.`;
    }
    const r = await fa.cliente.enviarPorCorreoA(factura.id, correos);
    if (r.ok) {
      this.anotar("info", `${cual} se envió a ${correos.join(", ")}.`);
      return null;
    }
    this.anotar("aviso", `${cual} se timbró, pero no se pudo enviar a ${correos.join(", ")}: ${r.mensaje}`);
    return `${cual} se timbró, pero no se pudo enviar a ${correos.join(", ")}: ${r.mensaje}`;
  }

  /**
   * Parte los tickets en facturas y las deja escritas antes de tocar FacturAPI.
   *
   * La numeración CONTINÚA la de las tandas anteriores del mismo mes, y eso es
   * lo que hace posible emitir en varias veces: la llave de idempotencia lleva
   * el número de parte, así que la segunda global de septiembre pide
   * `global-<suc>-2026-09-p2` y no choca con la primera. Si la cuenta se
   * reiniciara, FacturAPI devolvería la factura vieja y el local creería haber
   * amparado ventas que siguen sin comprobante.
   */
  private congelarTanda(
    periodo: string,
    modo: ModoFacturapi,
    tickets: readonly TicketGlobal[],
    previas: readonly FilaParte[],
    manual: PeticionManual | undefined,
  ): FilaParte[] {
    const desde = previas.reduce((n, p) => Math.max(n, p.parte), 0);
    const insertar = this.opciones.db.prepare(
      "INSERT INTO factura_global_parte (periodo, modo, parte, ordenes, origen, autorizador_id, correos) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const correos = manual?.correos && manual.correos.length > 0 ? JSON.stringify([...manual.correos]) : null;
    partirEnFacturas(tickets).forEach((grupo, i) =>
      insertar.run(
        periodo,
        modo,
        desde + i + 1,
        JSON.stringify(grupo.map((t) => t.orden_id)),
        manual ? "manual" : "automatica",
        manual?.autorizador_id ?? null,
        correos,
      ),
    );
    return this.partesDe(periodo, modo).filter((p) => p.parte > desde);
  }

  /**
   * Emite la global de un mes con las cuentas que eligió el restaurantero.
   *
   * ES LA PUERTA DE LA CAJA, y por eso desconfía de todo lo que entra: el mes
   * tiene que existir y estar cerrado, y cada cuenta se vuelve a mirar contra el
   * registro del Hub (`ticketsElegidosParaGlobal`). Lo que no pasa el filtro se
   * descarta y se CUENTA —nunca se emite «lo que se pueda» en silencio—, porque
   * quien tocó «Emitir» tiene que saber cuántas cuentas quedaron fuera para
   * poder volver por ellas.
   *
   * El permiso de la PERSONA no se revisa aquí sino en el canal (`servidor.ts`),
   * que es quien conoce la tabla de usuarios del local.
   */
  async emitirManual(peticion: {
    periodo: string;
    ordenes: readonly ID[];
    autorizador_id: ID;
    /** A dónde mandar la factura timbrada (1.5.7). Se limpia aquí: la caja propone. */
    correos?: readonly string[];
    ahora?: number;
  }): Promise<ResultadoEmisionManual> {
    const ahora = peticion.ahora ?? Date.now();
    const { periodo, ordenes, autorizador_id } = peticion;
    const correos = leerCorreosDeFactura(peticion.correos ?? []);
    const negar = (problema: string): ResultadoEmisionManual => ({
      ok: false,
      emitidas: 0,
      cuentas: 0,
      descartadas: [],
      problema,
    });

    if (!periodoGlobalValido(periodo)) return negar("El periodo no tiene la forma AAAA-MM ni AAAA-MM-DD.");
    if (!autorizador_id) return negar("Una factura global tiene que quedar autorizada por alguien.");

    if (esPeriodoDiario(periodo)) {
      /*
       * UN DÍA SÍ SE PUEDE FACTURAR EL MISMO DÍA (1.5.7). Quien elige la global
       * diaria quiere cerrar su jornada al cerrar la caja, no a las 6 de la
       * mañana siguiente. Lo que se cobre después no se pierde: puede ir en otra
       * global del mismo día. Tampoco se le cierra la puerta a un día de hace
       * más de 72 horas: sale igual, y la pantalla ya le dice que va fuera del
       * plazo del SAT. Lo único que no tiene sentido es un día que no ha llegado.
       */
      if (limitesDelPeriodo(periodo).desde > ahora) {
        return negar(`El día ${periodo} todavía no llega: no hay ventas que amparar.`);
      }
    } else if (ahora < limitesDelPeriodo(periodo).vence) {
      /*
       * UN MES ABIERTO NO SE FACTURA. Mientras el mes corre siguen entrando
       * cuentas, y una global emitida a mitad de mes dejaría fuera todo lo que
       * falta sin que nadie lo haya decidido. El corte es el del SAT visto por el
       * dominio: las 06:00 del día 1, con seis horas de margen para el servicio
       * que cierra de madrugada el último día. Quien necesita cortar antes,
       * elige la global diaria.
       */
      return negar(
        `El mes ${periodo} todavía no cierra. Su factura global se puede emitir a partir de las ` +
          "06:00 del día 1 del mes siguiente, o puedes emitir globales diarias.",
      );
    }

    const fa = this.opciones.facturapi();
    if (!fa) return negar("Este local no tiene la facturación conectada: falta la llave de FacturAPI.");
    if (ordenes.length === 0) return negar("No se eligió ninguna cuenta.");

    /*
     * Dos dedos a la vez no timbran dos veces. El barrido tiene su propia
     * guarda (`revisando`); esta cubre el caso de la caja —y el de la caja
     * mientras el barrido corre—, porque las dos emisiones comparten la tabla de
     * partes congeladas y quien llegue segundo leería un estado a medio escribir.
     */
    if (this.revisando) return negar("Ya hay una factura global en curso. Espera a que termine.");
    this.revisando = true;
    try {
      const globales = this.globalesDelRegistro().filter((g) => g.modo === fa.modo);
      const r = await this.emitirPeriodo(periodo, fa, globales, ahora, { ordenes, autorizador_id, correos });
      this.refrescarGlobales();
      this.anunciarPendiente(this.periodosPendientes(fa, ahora).pendientes[0], fa.modo, ahora);

      const avisos: string[] = [];
      if (r.reanudada) {
        avisos.push(
          "Había una factura global de este mes a medio emitir: se terminó ESA, con las cuentas que llevaba. " +
            "Vuelve a entrar para facturar las que quedaron fuera.",
        );
      }
      if (r.descartadas.length > 0) {
        avisos.push(`${r.descartadas.length} cuenta(s) quedaron fuera: ${resumenDeDescartes(r.descartadas)}.`);
      }
      if (r.problema) avisos.push(r.problema);
      avisos.push(...r.avisosCorreo);

      if (r.emitidas > 0) {
        this.anotar(
          "info",
          `Factura global de ${periodo} emitida a mano: ${r.cuentas} cuenta(s) en ${r.emitidas} factura(s)` +
            `${r.descartadas.length > 0 ? `, ${r.descartadas.length} fuera` : ""}. Autorizó ${autorizador_id}.`,
        );
      }

      return {
        ok: r.emitidas > 0,
        emitidas: r.emitidas,
        cuentas: r.cuentas,
        descartadas: r.descartadas,
        ...(avisos.length > 0 ? { problema: avisos.join(" ") } : {}),
      };
    } catch (error) {
      // Sin el detalle crudo hacia la caja: puede traer una URL o un cuerpo de
      // FacturAPI. La bitácora del Hub sí lo lleva, y ahí no hay secretos.
      this.anotar(
        "error",
        `Fallo al emitir la factura global de ${periodo}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return negar("No se pudo emitir la factura global. Revisa la bitácora del Hub e inténtalo otra vez.");
    } finally {
      this.revisando = false;
    }
  }

  /** Rearma los tickets congelados de una parte, igual que la primera vez. */
  private async ticketsDe(ordenes: readonly ID[]): Promise<TicketGlobal[]> {
    const cuentas = await this.cuentas(ordenes);
    const tickets: TicketGlobal[] = [];
    for (const orden of ordenes) {
      const c = cuentas.get(orden);
      if (!c) continue;
      const conceptos = conceptosDeTicket(c);
      tickets.push({
        orden_id: orden,
        folio: folioDeTicket(orden),
        cerrada_ts: c.cerrada_ts ?? 0,
        total: conceptos.reduce((n, x) => n + x.total, 0) as TicketGlobal["total"],
        conceptos,
        pagos: c.pagos.map((p) => ({ forma: p.forma, monto: p.monto })),
      });
    }
    return tickets;
  }

  private async timbrarParte(
    fa: FacturapiParaGlobal,
    parte: { externo_id: string | null },
    datos: Parameters<typeof cuerpoDeGlobal>[0],
  ): Promise<{ factura?: FacturaFacturapi; externo_id?: string; problema?: string }> {
    const cuerpo = cuerpoDeGlobal(datos);
    const clave = cuerpo.idempotency_key as string;

    let factura: FacturaFacturapi | null = null;
    if (parte.externo_id) {
      const r = await fa.cliente.factura(parte.externo_id);
      if (!r.ok) return { problema: r.mensaje, externo_id: parte.externo_id };
      factura = r.datos;
    } else {
      const r = await fa.cliente.crearFactura(cuerpo);
      if (r.ok) {
        factura = r.datos;
      } else if (r.status === 409 || /idempot/i.test(`${r.codigo ?? ""} ${r.mensaje}`)) {
        const busqueda = await fa.cliente.buscarPorExterno(clave);
        factura =
          (busqueda.ok ? busqueda.datos.data ?? [] : []).find(
            (f) => f.idempotency_key === clave || (f.external_id === clave && f.status !== "canceled"),
          ) ?? null;
        if (!factura) return { problema: "FacturAPI dice que ya existe, pero todavía no aparece en la búsqueda." };
      } else {
        return { problema: r.mensaje };
      }
    }

    if (factura.status === "valid" && factura.uuid) return { factura, externo_id: factura.id };
    if (factura.status === "pending") {
      return { externo_id: factura.id, problema: "FacturAPI la recibió y está esperando al SAT." };
    }
    return {
      externo_id: factura.status === "failed" || factura.status === "canceled" ? undefined : factura.id,
      problema: `FacturAPI la dejó como «${factura.status}».`,
    };
  }

  private publicar(
    periodo: string,
    parte: number,
    factura: FacturaFacturapi,
    tickets: readonly TicketGlobal[],
    modo: ModoFacturapi,
    sucursal: string,
    quien: { origen: ModoFacturacionGlobal; autorizador_id?: ID },
  ): void {
    this.fabrica.actualizarContexto({ sucursal_id: sucursal });
    const evento = this.fabrica.crear("factura_global_emitida", streamFiscal(sucursal), {
      periodo,
      parte,
      uuid: factura.uuid ?? "",
      externo_id: factura.id,
      ordenes: tickets.map((t) => t.orden_id),
      total: totalDeTickets(tickets),
      ...(factura.stamp?.date ? { fecha_timbrado: factura.stamp.date } : {}),
      modo,
      /*
       * Quién la disparó queda EN EL HECHO y no solo en la base del Hub. La base
       * del Hub se puede perder —se reinstala, se cambia la caja— y entonces
       * nadie podría decir quién autorizó dejar fuera un puñado de ventas. El
       * registro sí viaja: está en cada terminal y en el respaldo.
       */
      origen: quien.origen,
      ...(quien.autorizador_id ? { autorizador_id: quien.autorizador_id } : {}),
    });
    if (this.opciones.inyectar) this.opciones.inyectar([evento]);
    else this.opciones.log.ingerir([evento]);

    for (const t of tickets) if (modo === "produccion") this.enGlobales.set(t.orden_id, periodo);
    this.anotar(
      "info",
      `Factura global de ${periodo}${parte > 1 ? ` (parte ${parte})` : ""} timbrada: ${tickets.length} cuenta(s), ` +
        `folio fiscal ${factura.uuid}${modo === "pruebas" ? " — EN PRUEBAS, sin validez ante el SAT" : ""}.`,
    );
  }
}
