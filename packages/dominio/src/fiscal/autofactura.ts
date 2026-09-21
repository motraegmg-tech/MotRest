/**
 * El portal de autofactura, en el dominio (1.5.6).
 *
 * El comensal pide su factura desde su teléfono con el QR del ticket, sin la
 * red del restaurante. El portal (Vercel) solo recoge sus datos y los deja
 * cifrados en la nube; el Hub del local los recoge, comprueba el ticket contra
 * su propio registro y timbra con su llave de FacturAPI, que nunca sale de la
 * caja. Plan: `docs/PLAN-AUTOFACTURA-PORTAL.md` y `docs/PLAN-1.5.6.md` §6.
 *
 * Aquí vive lo que la caja, el Hub, el portal y Central tienen que decidir
 * IGUAL: qué ticket se puede autofacturar, cómo es su código, cómo se arma su
 * dirección, qué se acepta de una solicitud y cómo se propone la clave de un
 * local.
 */
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { consumoDeSocio } from "../comanda/totales.js";
import { sumar, type Centavos } from "../comun/dinero.js";
import { firmarCuenta } from "../clientes/acceso.js";
import { correoPlausible } from "../clientes/correo.js";
import { REGIMENES_FISCALES, USOS_CFDI } from "./claves.js";
import type { DatosReceptor } from "./comprobante.js";
import { cfdiAmpara, conceptosDeTicket, folioDeTicket } from "./global.js";
import type { RegistroCfdi } from "./eventos.js";
import { problemaRfc } from "./rfc.js";

/**
 * 72 horas desde el cobro (decisión de Gonzalo). Después, el comensal la pide
 * en el restaurante: es cuando el ticket puede haber entrado en una global.
 */
export const VIGENCIA_AUTOFACTURA_MS = 72 * 60 * 60 * 1000;

/** La forma de la clave de un local: la misma regla que la tabla de la nube. */
export const FORMA_CLAVE_AUTOFACTURA = /^[A-Z0-9-]{3,20}$/;

// --- El código del QR --------------------------------------------------------------

/**
 * El código `t` del QR de un ticket: 16 caracteres que no se adivinan.
 *
 * Es la MISMA firma que el enlace de la encuesta (`firmarCuenta`), pero con otro
 * secreto —`derivarSecretoAutofactura`, del protocolo—. Las dos cosas importan:
 *
 *  - Sale de la clave del local, que tienen la caja y el Hub. La caja lo
 *    imprime al cobrar y el Hub lo publica en la nube SIN hablarse: un ticket
 *    impreso en modo isla tiene el mismo código que el Hub publicará después.
 *  - Con otro secreto, el código de la encuesta no abre la factura ni al revés.
 */
export async function codigoDeAutofactura(ordenId: ID, secreto: string): Promise<string> {
  return firmarCuenta(ordenId, secreto);
}

/**
 * La dirección que lleva el QR: `<portal>/r/<CLAVE>/<FOLIO>?t=<código>`.
 *
 * La dirección del portal es un AJUSTE (hoy la gratuita de Vercel, decisión de
 * Gonzalo), por eso llega de fuera y no está escrita aquí. Se le quita la barra
 * final para no imprimir `//r/` en el papel.
 */
export function urlDeAutofactura(
  portalUrl: string,
  clave: string,
  folio: string,
  codigo: string,
): string {
  const base = portalUrl.trim().replace(/\/+$/, "");
  return `${base}/r/${encodeURIComponent(clave)}/${encodeURIComponent(folio)}?t=${encodeURIComponent(codigo)}`;
}

/**
 * La dirección para teclear a mano, sin el `https://`: es la que se imprime
 * bajo el QR para quien no puede escanear.
 */
export function direccionLegible(portalUrl: string): string {
  return portalUrl.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// --- Qué ticket se puede autofacturar -------------------------------------------------

/** Lo que el Hub publica en la nube de un ticket. Sin platillos ni nombres. */
export interface TicketAutofacturable {
  orden_id: ID;
  folio: string;
  total: Centavos;
  cerrada_ts: number;
  vence_ts: number;
}

/**
 * ¿Esta cuenta se puede ofrecer en el portal? Las mismas reglas que la global,
 * para que las dos puertas de facturación no se contradigan:
 *
 *  - cobrada, sin anular ni cancelar;
 *  - con algo que facturar (una cortesía completa no es concepto);
 *  - sin consumo de socio: no fue una venta al público (1.5.6).
 *
 * Que ya tenga un CFDI o esté en una global se comprueba aparte
 * (`motivoParaNoAutofacturar`): eso cambia con el tiempo, y un ticket ya
 * publicado se marca «facturado» en vez de desaparecer.
 */
export function ticketAutofacturable(c: EstadoComanda): TicketAutofacturable | null {
  if (!c.cerrada || c.anulada || c.cancelada || c.cerrada_ts === undefined) return null;
  if (consumoDeSocio(c) > 0) return null;
  const conceptos = conceptosDeTicket(c);
  const total = sumar(...conceptos.map((x) => x.total)) as Centavos;
  if (conceptos.length === 0 || total <= 0) return null;
  return {
    orden_id: c.orden_id,
    folio: folioDeTicket(c.orden_id),
    total,
    cerrada_ts: c.cerrada_ts,
    vence_ts: c.cerrada_ts + VIGENCIA_AUTOFACTURA_MS,
  };
}

/**
 * Por qué el Hub NO debe timbrar esta solicitud, o `null` si puede.
 *
 * Lo decide contra SU registro, no contra la nube: la nube es un cartero. Una
 * venta no puede ir en dos comprobantes, ni aunque la pidan a la vez el
 * comensal por el portal y el cajero en la caja.
 */
export function motivoParaNoAutofacturar(opciones: {
  cuenta: EstadoComanda | undefined;
  cfdis: readonly RegistroCfdi[];
  enGlobal: boolean;
  ahora: number;
}): string | null {
  const { cuenta } = opciones;
  if (!cuenta) return "El restaurante no encuentra ese ticket.";
  const ticket = ticketAutofacturable(cuenta);
  if (!ticket) return "Ese ticket no se puede facturar por internet: pídela en el restaurante.";
  if (opciones.ahora > ticket.vence_ts) {
    return "Ya pasaron las 72 horas desde el cobro: pide la factura directamente en el restaurante.";
  }
  if (opciones.cfdis.some((r) => r.orden_id === cuenta.orden_id && cfdiAmpara(r.estado))) {
    return "Ese ticket ya tiene su factura.";
  }
  if (opciones.enGlobal) {
    return "Ese ticket ya va en la factura global del restaurante: pídela directamente ahí.";
  }
  return null;
}

// --- Lo que llega del portal ------------------------------------------------------------

/** Lo que trae el sobre, ya abierto y comprobado. */
export interface SolicitudDeAutofactura {
  receptor: DatosReceptor;
  correo: string;
}

/**
 * Lee el texto de un sobre del portal y lo comprueba entero.
 *
 * El portal ya valida, pero el Hub no se fía: el sobre lo puede cerrar
 * cualquiera que tenga la llave pública del local, que viaja en el pulso. Lo que
 * sale de aquí va directo a un comprobante fiscal, así que todo lo que el SAT
 * rechazaría se rechaza antes, con un motivo que el comensal entiende.
 *
 * Las llaves son las de `DatosReceptor` más `correo` (contrato con el portal).
 */
export function leerSolicitudDeAutofactura(
  texto: string,
): { ok: true; solicitud: SolicitudDeAutofactura } | { ok: false; error: string } {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, error: "La solicitud llegó dañada: vuelve a pedirla." };
  }
  if (!crudo || typeof crudo !== "object") {
    return { ok: false, error: "La solicitud llegó dañada: vuelve a pedirla." };
  }
  const d = crudo as Record<string, unknown>;
  const texto_ = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const rfc = texto_(d.rfc).toUpperCase();
  const nombre = texto_(d.nombre).toUpperCase().replace(/\s+/g, " ");
  const regimen = texto_(d.regimen_fiscal);
  const cp = texto_(d.codigo_postal);
  const uso = texto_(d.uso_cfdi).toUpperCase();
  const correo = texto_(d.correo).toLowerCase();

  const malRfc = problemaRfc(rfc);
  if (malRfc) return { ok: false, error: malRfc };
  if (nombre.length < 3 || nombre.length > 300) {
    return { ok: false, error: "Escribe tu nombre o razón social tal como aparece en tu constancia." };
  }
  if (!REGIMENES_FISCALES.some((r) => r.clave === regimen)) {
    return { ok: false, error: "El régimen fiscal no es válido." };
  }
  if (!/^\d{5}$/.test(cp)) {
    return { ok: false, error: "El código postal son 5 dígitos, como en tu constancia." };
  }
  if (!USOS_CFDI.some((u) => u.clave === uso)) {
    return { ok: false, error: "El uso del CFDI no es válido." };
  }
  if (!correoPlausible(correo) || correo.length > 200) {
    return { ok: false, error: "El correo no es válido: ahí te llega la factura." };
  }

  return {
    ok: true,
    solicitud: {
      receptor: { rfc, nombre, regimen_fiscal: regimen, codigo_postal: cp, uso_cfdi: uso },
      correo,
    },
  };
}

// --- La clave del local ------------------------------------------------------------------

/**
 * Palabras que no distinguen a un restaurante de otro. «Pizzería La Toscana»
 * se propone como TOSCANA, no como PIZZERIA.
 */
const PALABRAS_DE_RELLENO = new Set([
  "EL", "LA", "LOS", "LAS", "DE", "DEL", "Y", "E", "THE",
  "RESTAURANTE", "RESTAURANT", "REST", "PIZZERIA", "TAQUERIA", "CAFE", "CAFETERIA",
  "BAR", "COCINA", "FONDA", "LONCHERIA", "SA", "CV", "SAS",
]);

/**
 * La clave que se le propone a un local a partir de su nombre (decisión de
 * Gonzalo: se propone sola y él la cambia en Central).
 *
 * Corta y legible, porque se imprime en el ticket y se teclea en un teléfono:
 * mayúsculas sin acentos, la primera palabra que distingue al local y, si esa
 * sola queda muy corta, la siguiente pegada. Si otra sucursal ya la tiene, se le
 * añade un número (`RODIZIO-2`).
 */
export function proponerClaveDeAutofactura(nombre: string, ocupadas: Iterable<string> = []): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const palabras = limpio.split(" ").filter(Boolean);
  const utiles = palabras.filter((p) => !PALABRAS_DE_RELLENO.has(p));
  const fuente = utiles.length > 0 ? utiles : palabras;

  let clave = fuente[0] ?? "";
  for (let i = 1; clave.length < 5 && i < fuente.length; i++) clave += fuente[i];
  clave = clave.slice(0, 16);
  if (clave.length < 3) clave = (clave + "LOCAL").slice(0, Math.max(3, clave.length + 5));

  const tomadas = new Set([...ocupadas].map((c) => c.toUpperCase()));
  if (!tomadas.has(clave)) return clave;
  for (let n = 2; n < 1000; n++) {
    const candidata = `${clave}-${n}`;
    if (!tomadas.has(candidata)) return candidata;
  }
  return clave;
}
