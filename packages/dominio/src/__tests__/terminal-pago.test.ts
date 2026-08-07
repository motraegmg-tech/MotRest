/**
 * La terminal bancaria conectada al POS.
 *
 * Todo este archivo gira alrededor de UN caso: **la terminal no contestó.**
 *
 * Es el que casi todos los sistemas tratan mal, porque se parece a un fallo y no
 * lo es: es no saber. Tratarlo como rechazo le cobra dos veces a alguien que ya
 * pagó; tratarlo como aprobado regala la comida. Lo único correcto es consultar.
 */
import { describe, expect, it, vi } from "vitest";
import { pesos } from "../comun/dinero.js";
import {
  ESPERAS_CONSULTA_MS,
  configuracionTerminalVacia,
  evaluarCobro,
  formaPagoDe,
  resolverDesconocido,
  type ResultadoCobro,
  type TerminalPago,
} from "../ventas/terminal-pago.js";

const REF = "ref-001";

function resultado(extra: Partial<ResultadoCobro> = {}): ResultadoCobro {
  return { referencia: REF, estado: "aprobado", autorizacion: "123456", ...extra };
}

// --- Dar por bueno un cobro ------------------------------------------------------------------

describe("cuándo se da un cobro por bueno", () => {
  it("aprobado y con autorización, se registra", () => {
    const v = evaluarCobro(resultado());
    expect(v.registrar).toBe(true);
  });

  /*
   * EL CANDADO. Una aprobación sin número de autorización no es una aprobación.
   * Pasa con adaptadores mal escritos y con respuestas cortadas a la mitad; si
   * se acepta, el restaurante cree que cobró y el banco no le deposita nada.
   */
  it("aprobado SIN autorización no se registra", () => {
    for (const autorizacion of [undefined, "", "   "]) {
      const v = evaluarCobro(resultado({ autorizacion }));
      expect(v.registrar).toBe(false);
      expect(v.registrar === false && v.motivo).toContain("no dio número de autorización");
    }
  });

  it("un rechazo se puede reintentar: quizá pasa otra tarjeta", () => {
    const v = evaluarCobro(resultado({ estado: "rechazado", mensaje: "Fondos insuficientes" }));
    expect(v.registrar).toBe(false);
    expect(v.registrar === false && v.reintentable).toBe(true);
    expect(v.registrar === false && v.motivo).toBe("Fondos insuficientes");
  });

  it("cancelado también se puede reintentar", () => {
    const v = evaluarCobro(resultado({ estado: "cancelado" }));
    expect(v.registrar === false && v.reintentable).toBe(true);
  });

  /*
   * EL CANDADO MÁS IMPORTANTE DEL ARCHIVO. "No se sabe" NO es reintentable:
   * ofrecer "reintentar" aquí es ofrecer cobrarle otra vez a alguien que quizá
   * ya pagó, y el cajero lo va a pulsar porque el cliente está esperando.
   */
  it("«no se sabe» NUNCA se ofrece como reintentable", () => {
    const v = evaluarCobro(resultado({ estado: "desconocido", autorizacion: undefined }));
    expect(v.registrar).toBe(false);
    expect(v.registrar === false && v.reintentable).toBe(false);
    expect(v.registrar === false && v.motivo).toContain("Consulta antes de volver a intentar");
  });

  it("mientras espera la tarjeta no se registra nada", () => {
    const v = evaluarCobro(resultado({ estado: "esperando", autorizacion: undefined }));
    expect(v.registrar).toBe(false);
    expect(v.registrar === false && v.reintentable).toBe(false);
  });
});

// --- Resolver lo que no se sabe --------------------------------------------------------------

describe("cuando la terminal no contestó", () => {
  function terminal(respuestas: ResultadoCobro[]): TerminalPago & { veces: number } {
    let veces = 0;
    return {
      proveedor: "clip",
      veces: 0,
      cobrar: vi.fn(),
      consultar: vi.fn(async () => {
        const r = respuestas[Math.min(veces, respuestas.length - 1)]!;
        veces += 1;
        (terminal as unknown as { veces: number }).veces = veces;
        return r;
      }),
    } as unknown as TerminalPago & { veces: number };
  }

  const sinEsperar = async () => {};

  it("consulta y encuentra que SÍ se había cobrado", async () => {
    const t = terminal([resultado({ estado: "aprobado", autorizacion: "998877" })]);
    const r = await resolverDesconocido(t, REF, sinEsperar);

    expect(r.estado).toBe("aprobado");
    expect(r.autorizacion).toBe("998877");
    // Y ese resultado sí se puede registrar: el cobro existía.
    expect(evaluarCobro(r).registrar).toBe(true);
  });

  it("consulta y confirma que NO se cobró", async () => {
    const t = terminal([resultado({ estado: "rechazado", autorizacion: undefined })]);
    expect((await resolverDesconocido(t, REF, sinEsperar)).estado).toBe("rechazado");
  });

  /* Insiste unas cuantas veces: es justo el caso de una red inestable. */
  it("insiste mientras siga sin saberse, y se rinde con esperas crecientes", async () => {
    const t = terminal([resultado({ estado: "desconocido", autorizacion: undefined })]);
    const esperas: number[] = [];

    const r = await resolverDesconocido(t, REF, async (ms) => { esperas.push(ms); });

    expect(esperas).toEqual([...ESPERAS_CONSULTA_MS]);
    expect(r.estado).toBe("desconocido");
  });

  /*
   * Cuando se rinde, lo DICE. No inventa un veredicto: le pide al cajero que
   * mire el aparato antes de volver a cobrar, que es lo honesto y lo único que
   * evita el doble cargo.
   */
  it("al rendirse le dice al cajero que mire la terminal antes de recobrar", async () => {
    const t = terminal([resultado({ estado: "desconocido", autorizacion: undefined })]);
    const r = await resolverDesconocido(t, REF, sinEsperar);

    expect(r.mensaje).toContain("ANTES de volver a cobrar");
    expect(evaluarCobro(r).registrar).toBe(false);
  });

  /* Si la consulta misma revienta, no se cae: se sigue intentando. */
  it("una consulta que falla no tumba el proceso", async () => {
    const t: TerminalPago = {
      proveedor: "clip",
      cobrar: vi.fn(),
      consultar: vi.fn(async () => { throw new Error("sin red"); }),
    };
    await expect(resolverDesconocido(t, REF, sinEsperar)).resolves.toMatchObject({
      estado: "desconocido",
    });
  });
});

// --- Detalles que llegan al ticket -----------------------------------------------------------

describe("lo que resultó ser la tarjeta", () => {
  /*
   * El POS no sabe si es débito o crédito hasta que la tarjeta pasa. Lo dice la
   * terminal, y de ahí sale la forma de pago del corte — no de lo que el cajero
   * eligió antes.
   */
  it("la forma de pago la decide la terminal, no el cajero", () => {
    expect(formaPagoDe(resultado({ tipo_tarjeta: "credito" }))).toBe("tarjeta_credito");
    expect(formaPagoDe(resultado({ tipo_tarjeta: "debito" }))).toBe("tarjeta_debito");
  });

  /* Sin dato, débito: es lo más común y lo que menos distorsiona el corte. */
  it("sin dato se asume débito", () => {
    expect(formaPagoDe(resultado())).toBe("tarjeta_debito");
  });

  it("la propina que el comensal dejó en la terminal vuelve al ticket", () => {
    const r = resultado({ importe: pesos(348), propina: pesos(48) });
    expect(evaluarCobro(r).registrar).toBe(true);
    expect(r.propina).toBe(pesos(48));
  });
});

// --- El arranque -----------------------------------------------------------------------------

describe("cómo arranca un restaurante", () => {
  /*
   * SIN INTEGRAR. Es lo que hay hoy en todos: el cajero teclea el monto en la
   * terminal. Arrancar prometiendo una integración que nadie configuró rompería
   * el cobro el día uno.
   */
  it("de fábrica NO está integrada", () => {
    const c = configuracionTerminalVacia();
    expect(c.integrada).toBe(false);
    expect(c.proveedor).toBe("otro");
  });
});
