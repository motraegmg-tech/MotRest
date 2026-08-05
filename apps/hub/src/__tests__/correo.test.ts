/**
 * El envío de correo desde el Hub.
 *
 * Lo que importa probar son los tres casos que deciden si esto es fiable un
 * viernes: que sin internet no se pierda nada, que lo que Resend rechaza por
 * configuración NO se reintente para siempre, y que lo viejo se descarte en vez
 * de mandarse tarde.
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfiguracionCorreo } from "@motrest/dominio";
import { Correo } from "../correo.js";

const CONFIG: ConfiguracionCorreo = {
  remitente: "Rodizio <reservas@rodizio.mx>",
  local: "Rodizio",
  telefono: "3311223344",
  activos: { reserva_confirmada: true, cupon: true },
};

const AHORA = new Date(2026, 6, 24, 21, 0).getTime();

function correo(
  respuesta: () => Promise<Response>,
  ahora = () => AHORA,
  config = CONFIG,
): Correo {
  return new Correo(
    () => config,
    () => "re_llave_de_prueba",
    () => {},
    ahora,
    respuesta as unknown as typeof fetch,
  );
}

const ok = () =>
  Promise.resolve(new Response(JSON.stringify({ id: "email-123" }), { status: 200 }));

describe("mandar un correo", () => {
  it("sale y devuelve el id del proveedor", async () => {
    const c = correo(ok);
    const r = await c.mandar({
      tipo: "reserva_confirmada",
      para: "cliente@correo.mx",
      datos: { nombre: "Ramírez", cuando: "viernes a las 21:00" },
    });

    expect(r.enviado).toBe(true);
    expect(r.externo_id).toBe("email-123");
  });

  it("manda el HTML y el texto juntos", async () => {
    const llamada = vi.fn(ok);
    await correo(llamada).mandar({
      tipo: "reserva_confirmada",
      para: "a@b.mx",
      datos: { cuando: "hoy" },
    });

    const opciones = (llamada.mock.calls as unknown as [string, RequestInit][])[0]![1];
    const cuerpo = JSON.parse(opciones.body as string);
    expect(cuerpo.html).toContain("Rodizio");
    expect(cuerpo.text).toContain("Rodizio");
    expect(cuerpo.from).toBe("Rodizio <reservas@rodizio.mx>");
  });

  /* Las reglas las decide el dominio, no el transporte. */
  it("un cupón sin consentimiento no llega ni a llamar a Resend", async () => {
    const llamada = vi.fn(ok);
    const r = await correo(llamada).mandar({
      tipo: "cupon",
      para: "a@b.mx",
      datos: { mensaje: "2x1" },
      aceptaMarketing: false,
    });

    expect(r.enviado).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it("sin llave de Resend no se intenta nada", async () => {
    const c = new Correo(() => CONFIG, () => "", () => {}, () => AHORA, ok as never);
    const r = await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });
    expect(r.enviado).toBe(false);
    expect(r.razon).toContain("llave");
  });
});

describe("cuando algo sale mal", () => {
  /*
   * Un 4xx es la configuración: dominio sin verificar, llave mala. Reintentarlo
   * no lo va a arreglar, y encolar lo que nunca va a salir llena la cola de
   * basura que tapa los correos que sí podrían salir.
   */
  it("lo que Resend rechaza por configuración NO se encola", async () => {
    const c = correo(() =>
      Promise.resolve(new Response("domain not verified", { status: 403 })),
    );
    const r = await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });

    expect(r.enviado).toBe(false);
    expect(c.pendientes).toBe(0);
  });

  it("un fallo del proveedor sí se encola", async () => {
    const c = correo(() => Promise.resolve(new Response("boom", { status: 503 })));
    await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });
    expect(c.pendientes).toBe(1);
  });

  it("sin internet, el correo se guarda y el restaurante sigue", async () => {
    const c = correo(() => Promise.reject(new Error("ENOTFOUND")));
    const r = await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });

    expect(r.enviado).toBe(false);
    expect(c.pendientes).toBe(1);
  });
});

describe("cuando vuelve internet", () => {
  it("sale lo que quedó pendiente", async () => {
    let hayRed = false;
    const c = correo(() =>
      hayRed ? ok() : Promise.reject(new Error("sin red")),
    );

    await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });
    expect(c.pendientes).toBe(1);

    hayRed = true;
    expect(await c.vaciarCola()).toEqual({ enviados: 1, caducados: 0 });
    expect(c.pendientes).toBe(0);
  });

  /* Un recordatorio de una reserva que ya pasó es una molestia, no un correo. */
  it("lo viejo se descarta en vez de mandarse tarde", async () => {
    let reloj = AHORA;
    let hayRed = false;
    const c = correo(() => (hayRed ? ok() : Promise.reject(new Error("sin red"))), () => reloj);

    await c.mandar({ tipo: "reserva_confirmada", para: "a@b.mx", datos: {} });

    reloj = AHORA + 8 * 60 * 60 * 1000; // ocho horas después
    hayRed = true;
    expect(await c.vaciarCola()).toEqual({ enviados: 0, caducados: 1 });
  });

  /*
   * Quinientos correos de golpe al recuperar internet es exactamente lo que un
   * proveedor interpreta como abuso.
   */
  it("la cola tiene tope", async () => {
    const c = correo(() => Promise.reject(new Error("sin red")));
    for (let i = 0; i < 600; i++) {
      await c.mandar({ tipo: "reserva_confirmada", para: `c${i}@b.mx`, datos: {} });
    }
    expect(c.pendientes).toBe(500);
  });
});
