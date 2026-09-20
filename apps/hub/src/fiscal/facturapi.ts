/**
 * FacturAPI: el proveedor que sella y timbra por nosotros.
 *
 * LO QUE CAMBIA RESPECTO A UN PAC DE SIEMPRE
 *
 * Un PAC recibe el XML ya sellado con el CSD del restaurante y solo le pone el
 * timbre. FacturAPI no tiene esa puerta: recibe la venta en JSON, arma el XML,
 * lo sella con el CSD que el restaurante subió a SU panel y lo timbra. Así que
 * el Hub deja de sellar y el secreto que protege pasa a ser la llave de API de
 * la organización (ver `docs/PLAN-FACTURAPI-1.5.5.md`).
 *
 * Todo lo que decide si una factura sale —la cola durable, los reintentos, qué
 * error tiene arreglo— sigue siendo de la cola de timbrado. Esto solo traduce:
 * nuestro `Comprobante` a su JSON, y sus respuestas a `ResultadoTimbrado`.
 *
 * LO QUE SE CONFIRMÓ CONTRA SU ESPECIFICACIÓN (OpenAPI oficial, sep-2026)
 *
 *   - `POST /v2/invoices` acepta `idempotency_key` y `external_id`. Responde 200
 *     con la factura (`status: "valid"`) o 202 con `status: "pending"` cuando el
 *     SAT no contestó: FacturAPI reintenta sola hasta cinco veces, una cada
 *     diez minutos, y hay que PREGUNTAR (el Hub vive en la red del local y no
 *     puede recibir webhooks).
 *   - `tax_included` vale `true` por omisión: si no se manda `false`, FacturAPI
 *     entiende que el precio ya trae el IVA y lo vuelve a desglosar.
 *   - La especificación no documenta qué contesta un `idempotency_key`
 *     repetido. Se trata cualquier 409, o un error que hable de idempotencia,
 *     como «ya existe»: se busca por `external_id` y se recupera la que tenga
 *     esa llave. Si no aparece, se reintenta —nunca se da por rechazada una
 *     factura que quizá ya existe ante el SAT—.
 *
 * LA LLAVE NO SALE DE AQUÍ. Va en el encabezado `Authorization` y en ningún
 * mensaje de error: estos textos acaban en la bitácora y en la caja.
 */
import {
  aPesos,
  IMPUESTO_IEPS,
  leerIdentidad,
  leerTimbre,
  RFC_PUBLICO_GENERAL,
  type Centavos,
  type Comprobante,
  type ConceptoCfdi,
  type ID,
} from "@motrest/dominio";
import type { PacDeDatos, ResultadoCancelacion, ResultadoTimbradoDatos } from "./pac.js";

export const URL_FACTURAPI = "https://www.facturapi.io/v2";

// --- Lo que contesta FacturAPI (solo lo que usamos) ----------------------------------------

export interface FacturaFacturapi {
  id: string;
  status: "pending" | "valid" | "canceled" | "draft" | "failed" | string;
  cancellation_status?: "none" | "pending" | "accepted" | "rejected" | "expired" | string;
  uuid?: string;
  total?: number;
  external_id?: string;
  idempotency_key?: string;
  canceled_at?: string;
  verification_url?: string;
  stamp?: { date?: string };
}

export interface OrganizacionFacturapi {
  id: string;
  is_production_ready?: boolean;
  pending_steps?: { type?: string; description?: string }[];
  legal?: {
    name?: string;
    legal_name?: string;
    /** No viene en la especificación pero sí en las respuestas reales. */
    tax_id?: string;
    tax_system?: string;
    address?: { zip?: string };
  };
  certificate?: { has_certificate?: boolean; expires_at?: string };
}

export type RespuestaFacturapi<T> =
  | { ok: true; status: number; datos: T }
  | {
      ok: false;
      /** `null` cuando ni siquiera hubo respuesta: red, DNS o tiempo agotado. */
      status: number | null;
      /** Sin respuesta, o una que no se pudo leer: siempre pasajero. */
      red: boolean;
      mensaje: string;
      codigo?: string;
    };

export type FetchLike = (entrada: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesClienteFacturapi {
  llave: string;
  /** Inyectable para probar sin llamar a FacturAPI de verdad. */
  fetch?: FetchLike;
  /**
   * Corto a propósito, igual que con cualquier PAC: una factura que tarda se
   * reintenta sola, pero una petición colgada frena la cola entera.
   */
  tiempoLimiteMs?: number;
  base?: string;
}

/** El mensaje de un error de FacturAPI, con el detalle cuando lo trae. */
function mensajeDeError(cuerpo: unknown, status: number): { mensaje: string; codigo?: string } {
  const e = (cuerpo ?? {}) as { message?: unknown; code?: unknown; errors?: { message?: unknown }[] };
  const base = typeof e.message === "string" && e.message.trim() ? e.message.trim() : `FacturAPI respondió ${status}.`;
  const detalles = Array.isArray(e.errors)
    ? e.errors.map((d) => (typeof d?.message === "string" ? d.message : "")).filter(Boolean)
    : [];
  const mensaje = detalles.length > 0 ? `${base} (${detalles.join("; ")})` : base;
  return {
    mensaje: mensaje.slice(0, 400),
    codigo: typeof e.code === "string" ? e.code : undefined,
  };
}

export class ClienteFacturapi {
  private readonly hacer: FetchLike;
  private readonly base: string;
  private readonly limite: number;

  constructor(private readonly opciones: OpcionesClienteFacturapi) {
    this.hacer = opciones.fetch ?? ((url, init) => fetch(url, init));
    this.base = (opciones.base ?? URL_FACTURAPI).replace(/\/$/, "");
    this.limite = opciones.tiempoLimiteMs ?? 25_000;
  }

  private async pedir<T>(
    metodo: "GET" | "POST" | "DELETE",
    ruta: string,
    cuerpo?: unknown,
    comoTexto = false,
  ): Promise<RespuestaFacturapi<T>> {
    let respuesta: Response;
    try {
      respuesta = await this.hacer(`${this.base}${ruta}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${this.opciones.llave}`,
          ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(this.limite),
      });
    } catch (causa) {
      // El texto de la excepción no se reenvía: no aporta nada a quien lee la
      // caja y es un sitio más por donde podría colarse algo que no debe.
      const tiempo = causa instanceof Error && causa.name === "TimeoutError";
      return {
        ok: false,
        status: null,
        red: true,
        mensaje: tiempo ? "FacturAPI no contestó a tiempo." : "No hay conexión con FacturAPI.",
      };
    }

    let texto = "";
    try {
      texto = await respuesta.text();
    } catch {
      return { ok: false, status: respuesta.status, red: true, mensaje: "La respuesta de FacturAPI se cortó." };
    }

    if (!respuesta.ok) {
      let json: unknown = null;
      try {
        json = JSON.parse(texto);
      } catch {
        // Un 502 de un balanceador trae HTML, no JSON: se cuenta solo el código.
      }
      return { ok: false, status: respuesta.status, red: false, ...mensajeDeError(json, respuesta.status) };
    }

    if (comoTexto) return { ok: true, status: respuesta.status, datos: texto as T };
    try {
      return { ok: true, status: respuesta.status, datos: JSON.parse(texto) as T };
    } catch {
      return { ok: false, status: respuesta.status, red: true, mensaje: "Respuesta ilegible de FacturAPI." };
    }
  }

  organizacion(): Promise<RespuestaFacturapi<OrganizacionFacturapi>> {
    return this.pedir("GET", "/organizations/me");
  }

  crearFactura(cuerpo: unknown): Promise<RespuestaFacturapi<FacturaFacturapi>> {
    return this.pedir("POST", "/invoices", cuerpo);
  }

  factura(id: string): Promise<RespuestaFacturapi<FacturaFacturapi>> {
    return this.pedir("GET", `/invoices/${encodeURIComponent(id)}`);
  }

  buscarPorExterno(externalId: string): Promise<RespuestaFacturapi<{ data?: FacturaFacturapi[] }>> {
    return this.pedir("GET", `/invoices?external_id=${encodeURIComponent(externalId)}&limit=100`);
  }

  xml(id: string): Promise<RespuestaFacturapi<string>> {
    return this.pedir("GET", `/invoices/${encodeURIComponent(id)}/xml`, undefined, true);
  }

  /** Sin cuerpo: FacturAPI la manda al correo del cliente que va en la factura. */
  enviarPorCorreo(id: string): Promise<RespuestaFacturapi<{ ok?: boolean }>> {
    return this.pedir("POST", `/invoices/${encodeURIComponent(id)}/email`);
  }

  cancelar(id: string, motivo: string, sustitucion?: string): Promise<RespuestaFacturapi<FacturaFacturapi>> {
    const q = new URLSearchParams({ motive: motivo });
    if (sustitucion) q.set("substitution", sustitucion);
    return this.pedir("DELETE", `/invoices/${encodeURIComponent(id)}?${q.toString()}`);
  }
}

// --- Probar una llave --------------------------------------------------------------------

/** Lo que se puede contar de una organización de FacturAPI. */
export interface DatosOrganizacion {
  id: string;
  razon_social?: string;
  rfc?: string;
  /** Código postal del domicilio fiscal: el de expedición y el de la global. */
  cp?: string;
  csd_vence?: string;
  lista?: boolean;
  pendientes?: string[];
}

export type PruebaDeLlave =
  | { estado: "valida"; organizacion: DatosOrganizacion }
  | { estado: "invalida"; mensaje: string }
  | { estado: "sin_red"; mensaje: string };

export function datosDeOrganizacion(org: OrganizacionFacturapi): DatosOrganizacion {
  return {
    id: org.id,
    razon_social: org.legal?.legal_name || org.legal?.name || undefined,
    rfc: org.legal?.tax_id || undefined,
    cp: org.legal?.address?.zip || undefined,
    csd_vence: org.certificate?.expires_at || undefined,
    lista: org.is_production_ready,
    pendientes: (org.pending_steps ?? [])
      .map((p) => p.description || p.type || "")
      .filter(Boolean),
  };
}

/**
 * ¿FacturAPI reconoce esta llave? Pregunta por la organización dueña.
 *
 * Tres respuestas y no dos, porque «no la reconoce» y «no se pudo preguntar»
 * se tratan distinto: la primera se rechaza siempre; la segunda depende de
 * quién la mande (ver `secretos.ts`).
 */
export async function probarLlaveFacturapi(
  llave: string,
  opciones: Omit<OpcionesClienteFacturapi, "llave"> = {},
): Promise<PruebaDeLlave> {
  const r = await new ClienteFacturapi({ ...opciones, llave }).organizacion();
  if (r.ok) return { estado: "valida", organizacion: datosDeOrganizacion(r.datos) };
  if (r.red || r.status === null || r.status >= 500 || r.status === 429) {
    return { estado: "sin_red", mensaje: r.mensaje };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      estado: "invalida",
      mensaje: "FacturAPI no reconoce esta llave. Revisa que la hayas copiado completa y que no la hayan revocado.",
    };
  }
  return { estado: "invalida", mensaje: `FacturAPI rechazó la llave: ${r.mensaje}` };
}

// --- Del comprobante a su JSON -----------------------------------------------------------

/** Seis decimales: los que admiten el precio y el descuento de un concepto. */
function seis(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

const NOMBRE_UNIDAD: Record<string, string> = {
  E48: "Unidad de servicio",
  ACT: "Actividad",
  H87: "Pieza",
};

interface ImpuestoFacturapi {
  type: "IVA" | "IEPS";
  rate: number;
  factor: "Tasa";
  ieps_mode?: "break_down";
}

/**
 * Los impuestos de un concepto, como los calcula MotRest.
 *
 * El IEPS va en modo `break_down`: MotRest calcula IVA e IEPS los dos sobre la
 * base (`calcularImpuesto`), no el IVA sobre la base más el IEPS. Con el modo
 * por omisión de FacturAPI el mismo refresco saldría con otro IVA.
 */
function impuestos(tasaIva: number, tasaIeps: number): ImpuestoFacturapi[] {
  const lista: ImpuestoFacturapi[] = [];
  if (tasaIva > 0) lista.push({ type: "IVA", rate: tasaIva, factor: "Tasa" });
  if (tasaIeps > 0) lista.push({ type: "IEPS", rate: tasaIeps, factor: "Tasa", ieps_mode: "break_down" });
  return lista;
}

/**
 * Un concepto, cuadrado para que FacturAPI llegue al MISMO total que el ticket.
 *
 * El problema: FacturAPI recalcula los impuestos con seis decimales a partir
 * del precio y el descuento, y MotRest los redondeó al centavo por renglón. Si
 * se le pasaran tal cual el importe y el descuento del comprobante, el total
 * timbrado podía salir un centavo distinto del que pagó el comensal — y el QR
 * del ticket, que lleva el total, dejaría de verificar en el portal del SAT.
 *
 * Así que se fija lo cobrado CON impuestos (base + traslados, exacto al
 * centavo) y se despeja el neto con seis decimales. El precio unitario sigue
 * siendo el de carta y el descuento es lo que falta para llegar al neto: el
 * comensal ve su cortesía en la factura y el total cuadra.
 */
function conceptoAFacturapi(c: ConceptoCfdi): Record<string, unknown> {
  const tasaIva = c.traslados.find((t) => t.impuesto !== IMPUESTO_IEPS)?.tasa_o_cuota ?? 0;
  const tasaIeps = c.traslados.find((t) => t.impuesto === IMPUESTO_IEPS)?.tasa_o_cuota ?? 0;
  const lista = c.traslados.length > 0 ? impuestos(tasaIva, tasaIeps) : [];

  const cobrado =
    c.traslados.length > 0
      ? aPesos((c.traslados[0]!.base + c.traslados.reduce((n, t) => n + t.importe, 0)) as Centavos)
      : aPesos((c.importe - c.descuento) as Centavos);
  const neto = c.traslados.length > 0 ? cobrado / (1 + tasaIva + tasaIeps) : cobrado;

  const cantidad = c.cantidad > 0 ? c.cantidad : 1;
  const precio = seis(aPesos(c.importe) / cantidad);
  const descuento = seis(Math.max(0, precio * cantidad - neto));

  return {
    quantity: cantidad,
    ...(descuento > 0 ? { discount: descuento } : {}),
    product: {
      description: c.descripcion,
      product_key: c.clave_prod_serv,
      unit_key: c.clave_unidad,
      ...(NOMBRE_UNIDAD[c.clave_unidad] ? { unit_name: NOMBRE_UNIDAD[c.clave_unidad] } : {}),
      price: precio,
      tax_included: false,
      taxability: lista.length > 0 ? "02" : "01",
      taxes: lista,
    },
  };
}

/** «AAAA-MM-DDThh:mm:ss» en hora local, a milisegundos. `null` si no se lee. */
function fechaLocal(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(fecha);
  if (!m) return null;
  const [, a, me, d, h, mi, s] = m.map(Number) as number[];
  return new Date(a!, me! - 1, d!, h!, mi!, s!).getTime();
}

/** FacturAPI no acepta fechas de más de 72 horas atrás. Se deja margen. */
const VENTANA_FECHA_MS = 71 * 3_600_000;

/**
 * El comprobante que armó la caja, en la forma que pide `POST /v2/invoices`.
 *
 * - `idempotency_key` = id del comprobante: un reintento —por un corte justo
 *   después de timbrar— devuelve la misma factura en vez de timbrar otra.
 * - `external_id` = la orden: es por donde se busca si hay que recuperarla.
 * - La fecha del cobro va solo si está dentro de las 72 horas que admite
 *   FacturAPI; una factura que esperó más en la cola (sin internet un fin de
 *   semana largo) sale con la fecha de hoy, que el SAT acepta.
 * - Un comprobante a PÚBLICO EN GENERAL lleva `global` por regla del SAT (4.0):
 *   un ticket suelto al público es una global de un día con un concepto.
 */
export function comprobanteAFacturapi(
  c: Comprobante,
  cfdiId: ID,
  opciones: { correo?: string; ahora?: number } = {},
): Record<string, unknown> {
  const ahora = opciones.ahora ?? Date.now();
  const cuando = fechaLocal(c.fecha);
  const fechaUtil = cuando !== null && cuando <= ahora && ahora - cuando < VENTANA_FECHA_MS;
  const publico = c.receptor.rfc === RFC_PUBLICO_GENERAL;
  const deCuando = new Date(cuando ?? ahora);
  const correo = opciones.correo?.trim();

  return {
    type: "I",
    customer: {
      legal_name: c.receptor.nombre,
      tax_id: c.receptor.rfc,
      tax_system: c.receptor.regimen_fiscal,
      // Al público en general el SAT pide el CP de expedición como domicilio.
      address: { zip: c.receptor.codigo_postal || c.lugar_expedicion },
      ...(correo ? { email: correo } : {}),
    },
    items: c.conceptos.map(conceptoAFacturapi),
    use: c.receptor.uso_cfdi,
    payment_form: c.forma_pago,
    payment_method: c.metodo_pago,
    currency: "MXN",
    ...(c.serie ? { series: c.serie } : {}),
    ...(/^\d{1,9}$/.test(c.folio) ? { folio_number: Number(c.folio) } : {}),
    ...(fechaUtil ? { date: new Date(cuando).toISOString() } : {}),
    ...(publico
      ? {
          global: {
            periodicity: "day",
            months: String(deCuando.getMonth() + 1).padStart(2, "0"),
            year: deCuando.getFullYear(),
          },
        }
      : {}),
    external_id: c.orden_id,
    idempotency_key: cfdiId,
  };
}

/** Una línea de la factura global, ya con su neto de seis decimales. */
export function conceptoGlobalAFacturapi(x: {
  folio: string;
  total: Centavos;
  tasa_iva: number;
  tasa_ieps: number;
}): Record<string, unknown> {
  const lista = impuestos(x.tasa_iva, x.tasa_ieps);
  const neto = aPesos(x.total) / (1 + x.tasa_iva + x.tasa_ieps);
  return {
    quantity: 1,
    product: {
      description: "Venta",
      product_key: "01010101",
      unit_key: "ACT",
      unit_name: "Actividad",
      // NoIdentificacion: el número del ticket, que es lo que el SAT pide.
      sku: x.folio,
      price: seis(neto),
      tax_included: false,
      taxability: lista.length > 0 ? "02" : "01",
      taxes: lista,
    },
  };
}

// --- El PAC ------------------------------------------------------------------------------

/** Lo que se lee del XML timbrado para contárselo a la caja. */
export function datosDelXml(xml: string): { total?: Centavos; no_certificado?: string } {
  const identidad = leerIdentidad(xml);
  const total = identidad?.total ? Math.round(Number(identidad.total) * 100) : NaN;
  const certificado = /<cfdi:Comprobante\b[^>]*\bNoCertificado\s*=\s*"([^"]*)"/i.exec(xml)?.[1];
  return {
    ...(Number.isFinite(total) ? { total: total as Centavos } : {}),
    ...(certificado ? { no_certificado: certificado } : {}),
  };
}

function esConflictoDeIdempotencia(r: { status: number | null; mensaje: string; codigo?: string }): boolean {
  return r.status === 409 || /idempot/i.test(`${r.codigo ?? ""} ${r.mensaje}`);
}

/**
 * Traduce un fallo de FacturAPI a lo que la cola entiende.
 *
 * - 401/403: la llave. No se arregla reintentando: hace falta otra llave, y al
 *   llegar una nueva la cola vuelve a intentar SOLO estas (`reintentarPorLlave`).
 * - 400/422: el comprobante. El mensaje de FacturAPI dice qué campo, y eso es
 *   lo que tiene que leer quien lo corrija.
 * - Todo lo demás —red, 5xx, 429, un 402 por la suscripción de MOTRAE— es
 *   pasajero. Ante la duda se reintenta: una factura que tarda se entrega
 *   tarde, una que se descarta por error no se entrega nunca.
 */
export function clasificarFalloFacturapi(r: {
  status: number | null;
  red: boolean;
  mensaje: string;
}): ResultadoTimbradoDatos {
  if (!r.red && (r.status === 401 || r.status === 403)) {
    return {
      estado: "rechazado",
      codigo: String(r.status),
      motivo: `FacturAPI no aceptó la llave del restaurante: ${r.mensaje}`,
    };
  }
  if (!r.red && (r.status === 400 || r.status === 422)) {
    return { estado: "rechazado", codigo: String(r.status), motivo: r.mensaje };
  }
  return { estado: "reintentable", motivo: r.mensaje };
}

export class PacFacturapi implements PacDeDatos {
  readonly nombre: string;

  constructor(
    private readonly cliente: ClienteFacturapi,
    opciones: {
      nombre?: string;
      anotar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
    } = {},
  ) {
    this.nombre = opciones.nombre ?? "FacturAPI";
    this.anotar = opciones.anotar ?? (() => {});
  }

  private anotar: (nivel: "info" | "aviso" | "error", mensaje: string) => void;

  async timbrarDatos(cuerpo: string, externoId: string | null): Promise<ResultadoTimbradoDatos> {
    let peticion: { idempotency_key?: string; external_id?: string; customer?: { email?: string } };
    try {
      peticion = JSON.parse(cuerpo);
    } catch {
      return { estado: "rechazado", codigo: "ILEGIBLE", motivo: "El comprobante en cola no se pudo leer." };
    }

    // Ya existe del lado de FacturAPI: se pregunta por ella, no se vuelve a crear.
    if (externoId) {
      const r = await this.cliente.factura(externoId);
      if (!r.ok) {
        if (r.status === 404) {
          return {
            estado: "reintentable",
            motivo: "FacturAPI no encuentra la factura anterior; se volverá a pedir.",
            externo_id: null,
          };
        }
        return { ...clasificarFalloFacturapi(r), externo_id: externoId };
      }
      return this.resolver(r.datos, peticion.customer?.email);
    }

    const creada = await this.cliente.crearFactura(peticion);
    if (creada.ok) return this.resolver(creada.datos, peticion.customer?.email);

    if (esConflictoDeIdempotencia(creada)) {
      const existente = await this.recuperar(peticion.external_id, peticion.idempotency_key);
      if (existente) return this.resolver(existente, peticion.customer?.email);
      return {
        estado: "reintentable",
        motivo: "FacturAPI dice que la factura ya existe, pero todavía no aparece en la búsqueda.",
      };
    }
    return clasificarFalloFacturapi(creada);
  }

  /** La factura que ya existe con esta llave de idempotencia. */
  private async recuperar(
    externalId: string | undefined,
    llave: string | undefined,
  ): Promise<FacturaFacturapi | null> {
    if (!externalId) return null;
    const r = await this.cliente.buscarPorExterno(externalId);
    if (!r.ok) return null;
    const candidatas = (r.datos.data ?? []).filter((f) => f.status !== "draft");
    return (
      candidatas.find((f) => llave && f.idempotency_key === llave) ??
      // Si FacturAPI no devolviera la llave, la única con esa orden que siga viva.
      (candidatas.filter((f) => f.status !== "canceled").length === 1
        ? candidatas.find((f) => f.status !== "canceled")!
        : null)
    );
  }

  private async resolver(
    factura: FacturaFacturapi,
    correo: string | undefined,
  ): Promise<ResultadoTimbradoDatos> {
    const externo_id = factura.id;
    switch (factura.status) {
      case "valid": {
        const xml = await this.cliente.xml(factura.id);
        if (!xml.ok) {
          return { estado: "reintentable", motivo: `Timbrada, falta bajar el XML: ${xml.mensaje}`, externo_id };
        }
        const timbre = leerTimbre(xml.datos);
        if (!timbre) {
          return { estado: "reintentable", motivo: "FacturAPI devolvió un XML sin timbre.", externo_id };
        }
        /*
         * El correo al comensal lo manda FacturAPI (PDF y XML), una sola vez:
         * esto corre solo en el paso a timbrada. Si falla no se deshace nada —
         * la factura existe— y queda escrito para volver a mandarla a mano.
         */
        if (correo) {
          const envio = await this.cliente.enviarPorCorreo(factura.id);
          if (!envio.ok) {
            this.anotar("aviso", `La factura ${timbre.uuid} se timbró pero FacturAPI no pudo mandarla por correo: ${envio.mensaje}`);
          }
        }
        return { estado: "timbrado", timbrado: { timbre, xml: xml.datos }, externo_id };
      }
      case "pending":
        return {
          estado: "reintentable",
          motivo: "FacturAPI la recibió y está esperando al SAT. Se vuelve a preguntar.",
          externo_id,
        };
      case "failed":
        return {
          estado: "rechazado",
          codigo: "FACTURAPI",
          motivo: "FacturAPI no consiguió timbrarla con el SAT tras varios intentos.",
          externo_id,
        };
      case "canceled":
        return { estado: "rechazado", codigo: "CANCELADA", motivo: "La factura aparece cancelada en FacturAPI.", externo_id };
      default:
        return { estado: "reintentable", motivo: `Estado desconocido en FacturAPI: ${factura.status}`, externo_id };
    }
  }
}

// --- Cancelar ----------------------------------------------------------------------------

/**
 * Lo que dice una factura de FacturAPI sobre su cancelación.
 *
 * El Hub no recibe webhooks, así que esto se lee dos veces: al pedir la
 * cancelación y cada vez que se vuelve a preguntar mientras el receptor decide.
 */
export function leerCancelacion(f: FacturaFacturapi): ResultadoCancelacion {
  if (f.status === "canceled" || f.cancellation_status === "accepted") {
    return { estado: "cancelado", fecha: f.canceled_at ?? new Date().toISOString() };
  }
  if (f.cancellation_status === "pending") {
    return { estado: "en_espera", motivo: "El SAT espera a que el receptor acepte la cancelación." };
  }
  if (f.cancellation_status === "rejected") {
    return { estado: "rechazado", codigo: "RECEPTOR", motivo: "El receptor rechazó la cancelación. La factura sigue vigente." };
  }
  if (f.cancellation_status === "expired") {
    return {
      estado: "rechazado",
      codigo: "VENCIDA",
      motivo: "La solicitud de cancelación venció sin respuesta. Vuelve a pedirla si todavía hace falta.",
    };
  }
  return { estado: "reintentable", motivo: "FacturAPI todavía no refleja la cancelación." };
}

export class CanceladorFacturapi {
  constructor(private readonly cliente: ClienteFacturapi) {}

  async cancelar(externoId: string, motivo: string, sustitucion?: string): Promise<ResultadoCancelacion> {
    const r = await this.cliente.cancelar(externoId, motivo, sustitucion);
    if (r.ok) return leerCancelacion(r.datos);
    if (r.red || r.status === null || r.status >= 500 || r.status === 429 || r.status === 402) {
      return { estado: "reintentable", motivo: r.mensaje };
    }
    /*
     * Un «no» puede ser un reintento de algo que ya pasó: la primera petición
     * llegó, la respuesta se perdió en un corte, y ahora FacturAPI dice que ya
     * está cancelada (o en trámite). Antes de publicar un rechazo se pregunta
     * cómo está la factura de verdad.
     */
    const actual = await this.consultar(externoId);
    if (actual.estado === "cancelado" || actual.estado === "en_espera") return actual;
    return { estado: "rechazado", codigo: String(r.status), motivo: r.mensaje };
  }

  async consultar(externoId: string): Promise<ResultadoCancelacion> {
    const r = await this.cliente.factura(externoId);
    if (r.ok) return leerCancelacion(r.datos);
    return { estado: "reintentable", motivo: r.mensaje };
  }
}
