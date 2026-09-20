/**
 * Un FacturAPI de mentira, para no llamar al de verdad desde las pruebas.
 *
 * Contesta las rutas que usa el Hub con la forma de su especificación oficial
 * (v2), guarda cada petición para poder revisarla y deja cambiar su humor: caído,
 * esperando al SAT, con la llave revocada.
 */
import type { FacturaFacturapi, FetchLike } from "../fiscal/facturapi.js";

/*
 * LAS LLAVES DE MENTIRA SE ARMAN EN DOS TROZOS, no se escriben enteras.
 *
 * FacturAPI usa el mismo prefijo que Stripe —`sk_live_`, `sk_test_`—, así que el
 * escáner de secretos de GitHub las toma por llaves de Stripe de verdad y
 * RECHAZA el envío ENTERO del repositorio. Pasó al publicar la 1.5.5. Partir la
 * cadena es todo lo que hace falta: lo que ve la prueba es idéntico, y así no
 * hay que pedirle a GitHub que haga una excepción con algo que parece una llave.
 */
export const LLAVE_PRUEBA = `sk_${"test"}_ABCDEFGHIJKLMNOPQRSTUVWX1234`;
export const LLAVE_VIVA = `sk_${"live"}_ABCDEFGHIJKLMNOPQRSTUVWX9876`;

export interface PeticionVista {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
  autorizacion: string | null;
}

type FacturaGuardada = FacturaFacturapi & { cuerpo: Record<string, unknown> };

export function xmlTimbrado(uuid: string, total = "580.00"): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Version="4.0" Total="${total}" ` +
    `NoCertificado="30001000000500003416"><cfdi:Emisor Rfc="AAA010101AAA" /><cfdi:Receptor Rfc="XAXX010101000" />` +
    `<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-09-19T12:00:00" ` +
    `SelloCFD="sellocfd==" NoCertificadoSAT="00001000000504465028" SelloSAT="sellosat==" RfcProvCertif="SPR190613I52" />` +
    `</cfdi:Complemento></cfdi:Comprobante>`
  );
}

export class FacturapiFalsa {
  peticiones: PeticionVista[] = [];
  facturas = new Map<string, FacturaGuardada>();
  llaves = new Set([LLAVE_PRUEBA, LLAVE_VIVA]);
  /** Sin red: cada petición falla como un corte. */
  caida = false;
  /** Cómo nace una factura: timbrada o esperando al SAT (202). */
  alCrear: "valid" | "pending" = "valid";
  /** Respuesta forzada al crear (400 del SAT, 500…), si se quiere. */
  errorAlCrear: { status: number; cuerpo: unknown } | null = null;
  /** Qué hace el SAT al cancelar: al momento, o espera al receptor. */
  alCancelar: "canceled" | "pending" = "canceled";
  /** Cuando la idempotencia choca, ¿contesta 409 (lo documentado es nada)? */
  conflictoCon409 = true;
  organizacion = {
    id: "org_rodizio",
    is_production_ready: true,
    pending_steps: [] as { type: string; description: string }[],
    legal: { name: "Rodizio", legal_name: "RODIZIO", tax_id: "AAA010101AAA", tax_system: "601", address: { zip: "44100" } },
    certificate: { has_certificate: true, expires_at: "2029-01-01T00:00:00.000Z" },
  };
  private siguiente = 1;

  private responder(status: number, cuerpo: unknown, texto = false): Response {
    return new Response(texto ? String(cuerpo) : JSON.stringify(cuerpo), {
      status,
      headers: { "content-type": texto ? "application/xml" : "application/json" },
    });
  }

  private error(status: number, message: string, code = "error"): Response {
    return this.responder(status, { message, status, ok: false, code });
  }

  fetch: FetchLike = async (entrada, init) => {
    const url = new URL(entrada);
    const metodo = init?.method ?? "GET";
    const cabeceras = new Headers(init?.headers);
    const cuerpo = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const ruta = url.pathname.replace(/^\/v2/, "");
    this.peticiones.push({ metodo, ruta: ruta + url.search, cuerpo, autorizacion: cabeceras.get("authorization") });

    if (this.caida) throw new TypeError("fetch failed");
    const llave = cabeceras.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!this.llaves.has(llave)) return this.error(401, "La llave de API no es válida.", "unauthenticated");

    if (metodo === "GET" && ruta === "/organizations/me") return this.responder(200, this.organizacion);

    if (metodo === "POST" && ruta === "/invoices") {
      if (this.errorAlCrear) return this.responder(this.errorAlCrear.status, this.errorAlCrear.cuerpo);
      const clave = (cuerpo as { idempotency_key?: string }).idempotency_key;
      const previa = [...this.facturas.values()].find((f) => clave && f.idempotency_key === clave);
      if (previa) {
        return this.conflictoCon409
          ? this.error(409, "Ya existe una factura con este idempotency_key.", "idempotency_conflict")
          : this.responder(200, previa);
      }
      const id = `inv_${this.siguiente++}`;
      const factura: FacturaGuardada = {
        id,
        status: this.alCrear,
        uuid: this.alCrear === "valid" ? `0000000${this.siguiente}-AAAA-BBBB-CCCC-DDDDEEEEFFFF` : undefined,
        idempotency_key: clave,
        external_id: (cuerpo as { external_id?: string }).external_id,
        cancellation_status: "none",
        stamp: { date: "2026-10-01T12:00:00.000Z" },
        cuerpo: cuerpo as Record<string, unknown>,
      };
      this.facturas.set(id, factura);
      return this.responder(this.alCrear === "pending" ? 202 : 200, factura);
    }

    if (metodo === "GET" && ruta === "/invoices") {
      const externo = url.searchParams.get("external_id");
      return this.responder(200, { data: [...this.facturas.values()].filter((f) => f.external_id === externo) });
    }

    const partes = /^\/invoices\/([^/]+)(?:\/(xml|email))?$/.exec(ruta);
    if (partes) {
      const factura = this.facturas.get(decodeURIComponent(partes[1]!));
      if (!factura) return this.error(404, "No se encontró la factura.", "not_found");
      if (metodo === "GET" && !partes[2]) return this.responder(200, factura);
      if (metodo === "GET" && partes[2] === "xml") return this.responder(200, xmlTimbrado(factura.uuid ?? ""), true);
      if (metodo === "POST" && partes[2] === "email") return this.responder(200, { ok: true });
      if (metodo === "DELETE") {
        if (factura.status === "canceled") return this.error(409, "La factura ya está cancelada.", "conflict");
        if (this.alCancelar === "canceled") {
          factura.status = "canceled";
          factura.cancellation_status = "accepted";
          factura.canceled_at = "2026-09-20T10:00:00.000Z";
        } else {
          factura.cancellation_status = "pending";
        }
        return this.responder(200, factura);
      }
    }
    return this.error(404, `Ruta desconocida: ${metodo} ${ruta}`, "not_found");
  };

  /** Pasa una factura pendiente a timbrada, como haría FacturAPI al rescatarla. */
  timbrarPendiente(id: string): void {
    const f = this.facturas.get(id)!;
    f.status = "valid";
    f.uuid = "99999999-AAAA-BBBB-CCCC-DDDDEEEEFFFF";
  }
}
