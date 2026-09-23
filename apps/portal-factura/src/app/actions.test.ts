import { describe, it, expect, vi, beforeEach } from "vitest";
import { buscarTicket, consultarTicket, solicitarFactura } from "./actions";
import { supabaseAdmin } from "@/lib/supabase";
import { generarParDeSobre, abrirSobre } from "@motrest/dominio";
import * as dominio from "@motrest/dominio";

// El servidor de Vercel exige next/headers para (await headers()).get(...)
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-forwarded-for", "127.0.0.1"]]))
}));

// Mock del cliente supabase
vi.mock("@/lib/supabase", () => {
  return {
    supabaseAdmin: {
      from: vi.fn(),
      rpc: vi.fn(),
    }
  };
});

// Mock del crypto si falla en entorno Node sin native crypto, aunque Node 20 lo trae.

describe("Portal de Autofactura - Reglas de Negocio", () => {
  let llaveroHub: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Generar un par de llaves real para la prueba del sobre
    llaveroHub = await generarParDeSobre();
    if (!llaveroHub) {
      // Mock de respaldo por si el paquete dominio requiere entorno web o similar en su generarLlavero
      llaveroHub = { publica: "mock-pub", privada: "mock-priv" };
    }
  });

  const datosFiscalesOk = {
    rfc: "XAXX010101000",
    razonSocial: "PUBLICO EN GENERAL",
    regimenFiscal: "616",
    codigoPostal: "00000",
    usoCfdi: "S01",
    correo: "correo@ejemplo.com"
  };

  const sucursalValida = { data: { sucursal_id: "LOC-123" } };
  const pulsoValido = { data: { llave_publica: "llave-pub-local" } };

  function mockSupabaseBuilder(responses: any = {}) {
    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      const builder: any = {
        select(this: any) { return this; },
        insert(this: any) { return this; },
        update(this: any) { return this; },
        eq(this: any) { return this; },
        async single() {
          const params = (this as any)._params || {};
          // Simulador simple para intentos_factura usando params
          if (table === "intentos_factura") {
            const llave = params.eq?.llave;
            if (llave && responses.intentos_factura && responses.intentos_factura[llave]) {
              return responses.intentos_factura[llave].single;
            } else if (responses.intentos_factura && responses.intentos_factura.single) {
              return responses.intentos_factura.single;
            }
          }
          return responses[table]?.single ?? { data: null, error: "Mock not configured for " + table }; 
        }
      };
      
      // Capturar los .eq para poder diferenciarlos
      const originalEq = builder.eq;
      builder.eq = function(key: string, val: string) {
        this._params = this._params || {};
        this._params.eq = this._params.eq || {};
        this._params.eq[key] = val;
        return originalEq.call(this, key, val);
      };
      
      return builder;
    });

    (supabaseAdmin.rpc as any).mockResolvedValue(null);
  }

  it("1. Rechaza clave de restaurante inexistente", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: { data: null } } // Clave no existe
    });

    const res = await solicitarFactura("FALSO", "12345678", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/clave del restaurante no es válida/i);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_fallo_autofactura", expect.anything());
  });

  it("2. Rechaza RFC inválido sin tocar BD", async () => {
    const res = await solicitarFactura("RODIZIO", "12345678", 10000, undefined, {
      ...datosFiscalesOk, rfc: "MALO"
    });
    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/RFC introducido no es válido/i);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("3. Rechaza ticket inexistente", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: null } }
    });

    const res = await solicitarFactura("RODIZIO", "NOEXISTE", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/No se encontró el ticket/i);
  });

  it("4. Rechaza total equivocado", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { folio: "12345678", total: 50000, codigo: "ABC", estado: "disponible", vence_ts: "2030-01-01" } } }
    });

    const res = await solicitarFactura("RODIZIO", "12345678", 10000 /* Mal total */, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/datos de comprobación no coinciden/i);
  });

  it("5. Rechaza código equivocado", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { folio: "12345678", total: 50000, codigo: "CODIGO_REAL", estado: "disponible", vence_ts: "2030-01-01" } } }
    });

    const res = await solicitarFactura("RODIZIO", "12345678", undefined, "CODIGO_FALSO", datosFiscalesOk);
    expect(res.exito).toBe(false);
  });

  it("6. Rechaza ticket vencido (> 72 horas)", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { 
        folio: "ABCD1234", total: 10000, codigo: "ABC", estado: "disponible", 
        vence_ts: "2020-01-01" // Ya venció
      } } }
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).vencido).toBe(true);
    expect((res as any).error).toMatch(/pasaron las 72 horas/i);
  });

  it("7. Rechaza ticket ya solicitado o facturado", async () => {
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { 
        folio: "ABCD1234", total: 10000, codigo: "ABC", estado: "solicitado", 
        vence_ts: "2030-01-01"
      } } }
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).estadoActual).toBe("solicitado");
  });

  it("8. Control de intentos: ANTES de la hora (castigado)", async () => {
    mockSupabaseBuilder({
      intentos_factura: {
        "ip:127.0.0.1": { single: { data: null } },
        "ticket:RODIZIO:ABCD1234": { single: { data: { fallos: 5, ultimo_ts: new Date().toISOString() } } }
      },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { orden_id: "ORD-1", total: 10000, codigo: "ABC", estado: "disponible", vence_ts: "2030-01-01" } } }
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).cerradoPorIntentos).toBe(true);
  });

  it("9. Control de intentos: DESPUÉS de la hora (perdona)", async () => {
    const haceDosHoras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockSupabaseBuilder({
      intentos_factura: {
        "ip:127.0.0.1": { single: { data: null } },
        "ticket:RODIZIO:ABCD1234": { single: { data: { fallos: 5, ultimo_ts: haceDosHoras } } }
      },
      claves_de_autofactura: { single: { data: null } } // Fallamos otra cosa para ver que avanzó
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).cerradoPorIntentos).toBeUndefined(); // Avanzó y chocó con clave
  });

  it("10. Condiciones de carrera (dos envíos simultáneos del mismo ticket)", async () => {
    // Simulamos que el SELECT inicial lo ve disponible
    // Pero el UPDATE falla porque alguien se adelantó (row count 0)
    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      pulsos: { single: pulsoValido },
      tickets_facturables: { single: { data: null } }, // El segundo single será para el UPDATE
    });

    // Override tickets_facturables for SELECT vs UPDATE
    let callCount = 0;
    (supabaseAdmin.from as any).mockImplementation((tb: string) => {
      const builder: any = {
        select(this: any) { return this; },
        update(this: any) { return this; },
        eq(this: any) { return this; },
        insert(this: any) { return this; },
        async single() {
          if (tb === "tickets_facturables") {
            callCount++;
            if (callCount === 1) return { data: { orden_id: "ORD-1", total: 10000, estado: "disponible", vence_ts: "2030-01-01" } };
            if (callCount === 2) return { data: null, error: "Not found" }; // Falla el update
          }
          if (tb === "claves_de_autofactura") return sucursalValida;
          if (tb === "pulsos") return { data: { llave_publica: llaveroHub.publica } };
          return { data: null };
        }
      };
      return builder;
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/acaba de ser solicitado/i);
  });

  it("11. El sobre generado lo puede abrir el Hub y trae exactamente las llaves correctas", async () => {
    if (!dominio.abrirSobre) {
      console.warn("Saltando test de cripto porque abrirSobre no es mockeable fácilmente aquí.");
      return;
    }

    mockSupabaseBuilder({
      intentos_factura: { single: { data: null } },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { orden_id: "ORD-1", total: 10000, estado: "disponible", vence_ts: "2030-01-01" } } },
      pulsos: { single: { data: { llave_publica: llaveroHub.publica } } },
    });

    let capturedSobre: any = null;
    
    (supabaseAdmin.from as any).mockImplementation((tb: string) => {
      const builder: any = {
        select(this: any) { return this; },
        update(this: any) { return this; },
        eq(this: any) { return this; },
        insert(this: any, data: any) {
          if (tb === "solicitudes_de_factura") capturedSobre = data?.sobre;
          return this;
        },
        async single() {
          if (tb === "tickets_facturables") return { data: { orden_id: "ORD-1", total: 10000, estado: "disponible", vence_ts: "2030-01-01" } };
          if (tb === "claves_de_autofactura") return sucursalValida;
          if (tb === "pulsos") return { data: { llave_publica: llaveroHub.publica } };
          if (tb === "solicitudes_de_factura") return { data: { id: "ID-1" } };
          return { data: null };
        }
      };
      return builder;
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", 10000, undefined, datosFiscalesOk);
    
    expect(res.exito).toBe(true);
    expect(capturedSobre).toBeDefined();

    const extraido = await abrirSobre(capturedSobre, llaveroHub);
    const datosRecibidos = JSON.parse(extraido as string);
    
    expect(datosRecibidos).toStrictEqual({
      rfc: datosFiscalesOk.rfc.toUpperCase(),
      nombre: datosFiscalesOk.razonSocial.toUpperCase(),
      regimen_fiscal: datosFiscalesOk.regimenFiscal,
      codigo_postal: datosFiscalesOk.codigoPostal,
      uso_cfdi: datosFiscalesOk.usoCfdi,
      correo: datosFiscalesOk.correo.trim().toLowerCase()
    });
  });

  it("12. Límite por red con folios distintos (IP bloqueada bloquea todo)", async () => {
    // Simulamos que la IP ya tiene 20 fallos, aunque pida el folio ZZZZ9999
    mockSupabaseBuilder({
      intentos_factura: {
        "ip:127.0.0.1": { single: { data: { fallos: 20, ultimo_ts: new Date().toISOString() } } },
        "ticket:RODIZIO:ZZZZ9999": { single: { data: null } }
      }
    });

    const res = await solicitarFactura("RODIZIO", "ZZZZ9999", 10000, undefined, datosFiscalesOk);
    expect(res.exito).toBe(false);
    expect((res as any).cerradoPorIntentos).toBe(true);
    expect((res as any).error).toMatch(/acceso desde tu red está bloqueado/i);
  });

  it("13. QR con código 't' correcto entra aunque el ticket tenga 5 fallos", async () => {
    // La IP está bien, el ticket tiene 5 fallos, PERO enviamos el código correcto
    mockSupabaseBuilder({
      intentos_factura: {
        "ip:127.0.0.1": { single: { data: null } },
        "ticket:RODIZIO:ABCD1234": { single: { data: { fallos: 5, ultimo_ts: new Date().toISOString() } } }
      },
      claves_de_autofactura: { single: sucursalValida },
      tickets_facturables: { single: { data: { orden_id: "ORD-1", total: 10000, codigo: "ABCDEFGHJKMNPQRS", estado: "disponible", vence_ts: "2030-01-01" } } },
      pulsos: { single: { data: null } } // Fallamos el pulso para ver que pasó el rate limit
    });

    const res = await solicitarFactura("RODIZIO", "ABCD1234", undefined, "ABCDEFGHJKMNPQRS", datosFiscalesOk);
    expect(res.exito).toBe(false);
    // No debe decir que está cerrado por intentos, sino avanzar y fallar porque el restaurante no está configurado (pulso nulo)
    expect((res as any).cerradoPorIntentos).toBeUndefined();
    expect((res as any).error).toMatch(/restaurante no está configurado/i);
  });

  it("14. La clave y el folio en minúsculas se buscan en mayúsculas, como van impresos", async () => {
    const filtros: Array<[string, string, unknown]> = [];
    (supabaseAdmin.from as any).mockImplementation((tabla: string) => {
      const builder: any = {
        select(this: any) { return this; },
        eq(this: any, columna: string, valor: unknown) { filtros.push([tabla, columna, valor]); return this; },
        async single() { return { data: null }; },
      };
      return builder;
    });
    (supabaseAdmin.rpc as any).mockResolvedValue(null);

    await solicitarFactura("  rodizio ", "abcd1234", 10000, undefined, datosFiscalesOk);

    expect(filtros).toContainEqual(["claves_de_autofactura", "clave", "RODIZIO"]);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_fallo_autofactura", {
      p_clave: "RODIZIO",
      p_folio: "ABCD1234",
      p_ip: "127.0.0.1",
    });
  });

  it("15. Un folio que no puede existir no toca la base ni el contador de intentos", async () => {
    mockSupabaseBuilder({});
    const enorme = "X".repeat(100_000);

    const res = await solicitarFactura("RODIZIO", enorme, 10000, undefined, datosFiscalesOk);

    expect(res.exito).toBe(false);
    expect((res as any).error).toMatch(/clave del restaurante y el folio/i);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

});

/*
 * EN QUÉ VA EL TICKET (1.5.6): lo que ve quien vuelve a abrir su QR. Es la mitad
 * de «portal + correo» que decidió Gonzalo.
 */
describe("consultarTicket - quien vuelve a abrir su QR", () => {
  const CODIGO = "ABCDEFGHJKMNPQRS";

  function nube(tablas: Record<string, unknown>) {
    vi.clearAllMocks();
    (supabaseAdmin.from as any).mockImplementation((tabla: string) => {
      const b: any = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        single: async () => ({ data: tablas[tabla] ?? null }),
        maybeSingle: async () => ({ data: tablas[tabla] ?? null }),
      };
      return b;
    });
    (supabaseAdmin.rpc as any).mockResolvedValue(null);
  }

  const ticket = (estado: string, vence = "2030-01-01") => ({ orden_id: "ORD-1", codigo: CODIGO, estado, vence_ts: vence });

  it("si el SAT rechazó la anterior, dice por qué para corregir ahí mismo", async () => {
    nube({
      claves_de_autofactura: { sucursal_id: "LOC-1" },
      tickets_facturables: ticket("disponible"),
      solicitudes_de_factura: { resultado: "rechazada", error: "El código postal no coincide" },
    });
    expect(await consultarTicket("rodizio", "abcd1234", CODIGO)).toEqual({
      estado: "disponible",
      rechazo: "El código postal no coincide",
    });
  });

  it("en proceso, facturado o vencido se dice sin volver a pedir datos", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("solicitado") });
    expect((await consultarTicket("RODIZIO", "ABCD1234", CODIGO)).estado).toBe("solicitado");
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("facturado") });
    expect((await consultarTicket("RODIZIO", "ABCD1234", CODIGO)).estado).toBe("facturado");
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("disponible", "2020-01-01") });
    expect((await consultarTicket("RODIZIO", "ABCD1234", CODIGO)).estado).toBe("vencido");
  });

  it("sin el código correcto del QR no dice nada, y cuenta como intento fallido", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("solicitado") });
    expect(await consultarTicket("RODIZIO", "ABCD1234", "ZZZZZZZZZZZZZZZZ")).toEqual({ estado: "desconocido" });
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_fallo_autofactura", expect.anything());
  });

  it("un ticket que el Hub todavía no publica no es un intento fallido", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" } });
    expect(await consultarTicket("RODIZIO", "ABCD1234", CODIGO)).toEqual({ estado: "desconocido" });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});

describe("buscarTicket - el total se llena solo", () => {
  function nube(tablas: Record<string, unknown>) {
    vi.clearAllMocks();
    (supabaseAdmin.from as any).mockImplementation((tabla: string) => {
      const b: any = {
        select: () => b, eq: () => b,
        single: async () => ({ data: tablas[tabla] ?? null }),
      };
      return b;
    });
    (supabaseAdmin.rpc as any).mockResolvedValue(null);
  }
  const ticket = (estado: string, vence = "2030-01-01") => ({ total: 106400, estado, vence_ts: vence });

  it("con clave y folio correctos devuelve el total del ticket", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("disponible") });
    expect(await buscarTicket("prueba", "ab12cd34")).toEqual({ ok: true, total: 106400 });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("un folio que no existe cuenta como intento fallido: así no se adivinan", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" } });
    const r = await buscarTicket("PRUEBA", "AB12CD34");
    expect(r.ok).toBe(false);
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("registrar_fallo_autofactura", expect.anything());
  });

  it("una clave que no existe también cuenta como intento fallido", async () => {
    nube({});
    expect((await buscarTicket("NOEXISTE", "AB12CD34")).ok).toBe(false);
    expect(supabaseAdmin.rpc).toHaveBeenCalled();
  });

  it("una red bloqueada no puede seguir buscando", async () => {
    nube({ intentos_factura: { fallos: 20, ultimo_ts: new Date().toISOString() } });
    const r = await buscarTicket("PRUEBA", "AB12CD34");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/bloqueado/) });
  });

  it("ya pedido, facturado o vencido: no devuelve total, dice por qué", async () => {
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("solicitado") });
    expect((await buscarTicket("PRUEBA", "AB12CD34")).ok).toBe(false);
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("facturado") });
    expect((await buscarTicket("PRUEBA", "AB12CD34")).ok).toBe(false);
    nube({ claves_de_autofactura: { sucursal_id: "LOC-1" }, tickets_facturables: ticket("disponible", "2020-01-01") });
    expect((await buscarTicket("PRUEBA", "AB12CD34")).ok).toBe(false);
  });

  it("lo que ni siquiera tiene forma de folio no llega a la base", async () => {
    nube({});
    expect((await buscarTicket("PRUEBA", "ABC")).ok).toBe(false);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
