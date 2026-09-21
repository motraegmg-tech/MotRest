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

/**
 * LO QUE ESCRIBE EL RESTAURANTE (1.5.6), en el Hub.
 *
 * La configuración se lee en CADA intento, así que lo que se cambia en la caja
 * vale para el siguiente envío —y también para lo que espera en la cola—.
 */
describe("los correos que escribe el restaurante", () => {
  const NOCHE = {
    tipo: "propio:noche" as const,
    nombre: "Noche italiana",
    asunto: "Noche italiana en {{local}}",
    titulo: "Lo esperamos",
    texto: "Este viernes, noche italiana en {{local}}.",
    activo: true,
  };

  it("sale con el texto que escribió el restaurante", async () => {
    const llamada = vi.fn(ok);
    const config = {
      ...CONFIG,
      activos: { ...CONFIG.activos, gracias: true },
      plantillas: { gracias: { texto: "Fue un gusto, {{nombre}}. Vuelva pronto a {{local}}." } },
    };
    await correo(llamada, () => AHORA, config).mandar({
      tipo: "gracias",
      para: "a@b.mx",
      datos: { nombre: "Ana" },
    });

    const cuerpo = JSON.parse(
      (llamada.mock.calls as unknown as [string, RequestInit][])[0]![1].body as string,
    );
    expect(cuerpo.html).toContain("Fue un gusto, Ana. Vuelva pronto a <b>Rodizio</b>.");
    expect(cuerpo.text).toContain("Fue un gusto, Ana. Vuelva pronto a Rodizio.");
  });

  it("uno que se borra mientras espera internet ya no sale", async () => {
    let hayRed = false;
    let config: typeof CONFIG = { ...CONFIG, propios: [NOCHE] };
    const llamada = vi.fn(() => (hayRed ? ok() : Promise.reject(new Error("sin red"))));
    const c = new Correo(() => config, () => "re_llave", () => {}, () => AHORA, llamada as never);

    let desenlace: { enviado: boolean; razon?: string } | undefined;
    await c.mandar({
      tipo: "propio:noche",
      para: "a@b.mx",
      datos: {},
      aceptaMarketing: true,
      alResolverse: (r) => (desenlace = r),
    });
    expect(c.pendientes).toBe(1);

    // Alguien lo borra en la caja; la configuración nueva llega al Hub.
    config = { ...CONFIG, propios: [] };
    hayRed = true;
    await c.vaciarCola();

    expect(llamada).toHaveBeenCalledTimes(1); // solo el intento sin red
    expect(desenlace?.enviado).toBe(false);
    expect(desenlace?.razon).toContain("ya no existe");
  });
});
