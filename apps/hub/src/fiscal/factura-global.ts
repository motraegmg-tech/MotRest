/**
 * La factura global del mes, del lado del Hub: juntarla, timbrarla y anotarla.
 *
 * Qué entra y cuándo toca lo decide el dominio (`fiscal/global.ts`); aquí vive
 * lo que depende de la máquina: leer las cuentas del registro, hablar con
 * FacturAPI, reintentar sin red y dejar el hecho en el registro del local para
 * que la caja y el contador lo vean.
 *
 * CUÁNDO CORRE
 *
 * Al arrancar y cada hora. Así un Hub que estuvo apagado el día 1 —se fue la
 * luz, cerraron por vacaciones— emite la global atrasada en cuanto enciende, y
 * uno encendido la emite a las 06:00 del día 1 o en la hora siguiente.
 *
 * LO QUE NO PUEDE PASAR
 *
 * Timbrar dos veces el mismo mes. Por eso:
 *   - `idempotency_key` = `global-<sucursal>-<AAAA-MM>`: si la respuesta se
 *     pierde en un corte, el reintento devuelve la misma factura.
 *   - Las cuentas de cada parte se congelan en la base al primer intento: el
 *     reintento manda EXACTAMENTE lo mismo, que es lo que hace que la llave de
 *     idempotencia diga la verdad.
 *   - Un mes con su hecho en el registro ya no se vuelve a emitir aunque esta
 *     base se pierda.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  FabricaEventos,
  facturasGlobales,
  formaPagoDeLaGlobal,
  limitesDelPeriodo,
  partirEnFacturas,
  periodosPorEmitir,
  proyectarCfdis,
  proyectarSentadas,
  RFC_PUBLICO_GENERAL,
  streamFiscal,
  ticketsParaGlobal,
  totalDeTickets,
  TIPOS_EVENTO_FISCAL,
  conceptosDeTicket,
  folioDeTicket,
  type EstadoComanda,
  type EventoBase,
  type EventoComanda,
  type EventoFiscal,
  type FacturaGlobalRegistrada,
  type ID,
  type ModoFacturapi,
  type TicketGlobal,
} from "@motrest/dominio";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";
import type { EstadoFacturaGlobal } from "@motrest/protocolo-sync";
import { conceptoGlobalAFacturapi, type ClienteFacturapi, type FacturaFacturapi } from "./facturapi.js";

/** A las 72 horas del cierre el SAT ya no la da por oportuna: se avisa fuerte. */
const PLAZO_SAT_MS = 72 * 3_600_000;
const ESPERA_BASE_MS = 10 * 60_000;
const ESPERA_MAXIMA_MS = 3_600_000;

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

export interface FacturapiParaGlobal {
  cliente: Pick<ClienteFacturapi, "crearFactura" | "factura" | "buscarPorExterno" | "organizacion">;
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
    global: { periodicity: "month", months: mes, year: Number(anio) },
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

  estado(): EstadoFacturaGlobal {
    return this.ultimoEstado;
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
            },
          }
        : {}),
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

  /**
   * Revisa si toca emitir alguna global y la emite.
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
    // Lo que ya consta en el registro sin rastro en esta base (base perdida,
    // Hub reinstalado) se da por emitido: antes que timbrar dos veces, avisar.
    for (const g of globales) if (!conFila.has(g.periodo)) completos.add(g.periodo);

    const pendientes = periodosPorEmitir({ ahora, desde_ts: fa.desde_ts, emitidos: completos });
    let emitidas = 0;
    for (const periodo of pendientes) emitidas += await this.emitirPeriodo(periodo, fa, globales, ahora);

    this.refrescarGlobales();
    const restante = pendientes.find((p) => this.fila(p, fa.modo)?.completa !== 1);
    const fila = restante ? this.fila(restante, fa.modo) : undefined;
    this.ultimoEstado = {
      ...this.ultimoEstado,
      pendiente: restante
        ? {
            periodo: restante,
            desde_ts: limitesDelPeriodo(restante).vence,
            ...(fila?.problema ? { problema: fila.problema } : {}),
          }
        : undefined,
    };
    return { emitidas, pendientes: restante ? pendientes.filter((p) => this.fila(p, fa.modo)?.completa !== 1) : [] };
  }

  private async emitirPeriodo(
    periodo: string,
    fa: FacturapiParaGlobal,
    globales: readonly FacturaGlobalRegistrada[],
    ahora: number,
  ): Promise<number> {
    const { db } = this.opciones;
    let fila = this.fila(periodo, fa.modo);
    if (!fila) {
      db.prepare("INSERT INTO factura_global (periodo, modo, primer_intento_ts) VALUES (?, ?, ?)").run(
        periodo,
        fa.modo,
        ahora,
      );
      fila = this.fila(periodo, fa.modo)!;
    }
    if (fila.proximo_ts > ahora) return 0;

    const sucursal = this.opciones.sucursal();
    let partes = db
      .prepare("SELECT parte, ordenes, externo_id, emitida FROM factura_global_parte WHERE periodo = ? AND modo = ? ORDER BY parte")
      .all(periodo, fa.modo) as { parte: number; ordenes: string; externo_id: string | null; emitida: number }[];

    // Primera vez: se eligen los tickets y se congelan por parte.
    if (partes.length === 0) {
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
        return 0;
      }
      const insertar = db.prepare(
        "INSERT INTO factura_global_parte (periodo, modo, parte, ordenes) VALUES (?, ?, ?, ?)",
      );
      partirEnFacturas(tickets).forEach((grupo, i) =>
        insertar.run(periodo, fa.modo, i + 1, JSON.stringify(grupo.map((t) => t.orden_id))),
      );
      partes = db
        .prepare("SELECT parte, ordenes, externo_id, emitida FROM factura_global_parte WHERE periodo = ? AND modo = ? ORDER BY parte")
        .all(periodo, fa.modo) as typeof partes;
    }

    let cp = fa.cp;
    if (!cp) {
      const org = await fa.cliente.organizacion();
      cp = org.ok ? org.datos.legal?.address?.zip : undefined;
    }

    let emitidas = 0;
    let problema: string | null = null;
    for (const parte of partes) {
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
        this.publicar(periodo, parte.parte, resultado.factura, tickets, fa.modo, sucursal);
        db.prepare("UPDATE factura_global_parte SET emitida = 1 WHERE periodo = ? AND modo = ? AND parte = ?").run(
          periodo,
          fa.modo,
          parte.parte,
        );
        emitidas += 1;
      } else {
        problema = resultado.problema ?? "No se pudo timbrar.";
        break;
      }
    }

    if (problema === null) {
      db.prepare("UPDATE factura_global SET completa = 1, problema = NULL WHERE periodo = ? AND modo = ?").run(
        periodo,
        fa.modo,
      );
      return emitidas;
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
    if (!fila.avisado && ahora - limitesDelPeriodo(periodo).vence > PLAZO_SAT_MS) {
      this.anotar(
        "error",
        `La factura global de ${periodo} lleva más de 72 horas sin poder timbrarse (${problema}). ` +
          "Avisa a tu contador: está fuera del plazo del SAT.",
      );
      db.prepare("UPDATE factura_global SET avisado = 1 WHERE periodo = ? AND modo = ?").run(periodo, fa.modo);
    }
    return emitidas;
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
