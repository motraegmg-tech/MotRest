/**
 * La cartera de MOTRAE.
 *
 * Lo que hay que probar es el ORDEN de lo urgente. Un panel que enseña primero
 * la gráfica de ingresos y esconde "Rodizio lleva 30 horas sin reportar" está
 * al revés: el ingreso del mes que viene depende de que Rodizio funcione hoy.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import {
  DIAS_PARA_COBRAR,
  EVENTOS_AVISO,
  HORAS_SIN_SENAL,
  idDeSucursal,
  pendientesDeHoy,
  resumenDeCartera,
  saludDeCliente,
  situacionDeCliente,
  type ClienteMotRest,
  type PulsoCliente,
} from "../organizacion/central.js";
import type { Licencia } from "../organizacion/licencia.js";

const AHORA = new Date(2026, 6, 24, 9, 0).getTime();
const DIA = 86_400_000;
const HORA = 3_600_000;

function cliente(
  id: string,
  nombre: string,
  diasParaVencer: number | null,
  extra: Partial<ClienteMotRest> = {},
): ClienteMotRest {
  const licencia: Licencia | null =
    diasParaVencer === null
      ? null
      : {
          sucursal_id: id, nombre, plan: "mensual",
          vence_ts: AHORA + diasParaVencer * DIA, gracia_dias: 3,
          emitida_ts: AHORA - 30 * DIA, firma: "x",
        };

  return {
    id, nombre, contacto: "Dueño", plan: "mensual", cuota: pesos(1_500),
    alta_ts: AHORA - 200 * DIA, licencia, activo: true, ...extra,
  };
}

function pulso(id: string, horasAtras = 2, extra: Partial<PulsoCliente> = {}): PulsoCliente {
  return {
    sucursal_id: id,
    ts: AHORA - horasAtras * HORA,
    version: "1.4.0",
    respaldo_ts: AHORA - 6 * HORA,
    eventos: 12_000,
    ...extra,
  };
}

// --- El cobro -------------------------------------------------------------------------------

describe("quién debe y quién no", () => {
  it("con mes de sobra está al corriente", () => {
    expect(situacionDeCliente(cliente("a", "Rodizio", 25), AHORA).cobro).toBe("al_corriente");
  });

  it("dentro de la semana entra en «por cobrar»", () => {
    expect(situacionDeCliente(cliente("a", "Rodizio", DIAS_PARA_COBRAR - 2), AHORA).cobro).toBe("por_cobrar");
  });

  /* Vencido pero en gracia: todavía opera, y eso cambia cómo se le llama. */
  it("vencido dentro de la gracia sigue operando", () => {
    const s = situacionDeCliente(cliente("a", "Rodizio", -2), AHORA);
    expect(s.cobro).toBe("vencido");
    expect(s.licencia).toBe("gracia");
  });

  it("pasada la gracia queda bloqueado", () => {
    expect(situacionDeCliente(cliente("a", "Rodizio", -10), AHORA).cobro).toBe("bloqueado");
  });

  it("un local recién dado de alta sin licencia se distingue del moroso", () => {
    expect(situacionDeCliente(cliente("a", "Nuevo", null), AHORA).cobro).toBe("sin_licencia");
  });
});

// --- La salud -------------------------------------------------------------------------------

describe("cómo está cada instalación", () => {
  it("reportando y con respaldo fresco, está bien", () => {
    const s = saludDeCliente(cliente("a", "Rodizio", 20), pulso("a"), AHORA);
    expect(s.estado).toBe("bien");
    expect(s.motivos).toEqual([]);
  });

  /*
   * 30 horas y no 24: un restaurante que cierra los lunes deja de reportar más
   * de un día sin que pase nada. Con 24, cada martes Central estaría gritando
   * por locales que están perfectos.
   */
  it("un local que cierra un día entero no dispara la alarma", () => {
    expect(saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", 26), AHORA).estado).toBe("bien");
    expect(saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", HORAS_SIN_SENAL + 1), AHORA).estado).toBe("sin_senal");
  });

  it("el que nunca reportó se distingue del que dejó de reportar", () => {
    const s = saludDeCliente(cliente("a", "Nuevo", 20), null, AHORA);
    expect(s.estado).toBe("nunca_reporto");
    expect(s.motivos[0]).toContain("instalación se completara");
  });

  /* Un respaldo viejo no tumba nada hoy, y por eso hay que verlo antes. */
  it("un respaldo de hace días pide atención", () => {
    const s = saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", 2, { respaldo_ts: AHORA - 5 * DIA }), AHORA);
    expect(s.estado).toBe("atencion");
    expect(s.motivos.join()).toContain("respaldo");
  });

  it("sin ningún respaldo registrado también avisa", () => {
    const s = saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", 2, { respaldo_ts: undefined }), AHORA);
    expect(s.motivos.join()).toContain("ningún respaldo");
  });

  it("el registro creciendo demasiado sale en la lista (ADR-21)", () => {
    const s = saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", 2, { eventos: EVENTOS_AVISO + 1 }), AHORA);
    expect(s.estado).toBe("atencion");
    expect(s.motivos.join()).toContain("registro va por");
  });

  it("lo que el propio Hub reporta mal se arrastra tal cual", () => {
    const s = saludDeCliente(cliente("a", "Rodizio", 20), pulso("a", 2, { problemas: ["Impresora de cocina sin responder"] }), AHORA);
    expect(s.motivos).toContain("Impresora de cocina sin responder");
  });
});

// --- Lo que hay que atender hoy --------------------------------------------------------------

describe("la lista con la que se abre la mañana", () => {
  /*
   * EL ORDEN ES EL PRODUCTO. Un local CAÍDO va antes que uno que DEBE: el que
   * debe sigue vendiendo y va a pagar; el caído está perdiendo dinero ahora
   * mismo y va a llamar enojado.
   */
  it("primero lo caído, después lo bloqueado, y al final lo que solo hay que revisar", () => {
    const clientes = [
      cliente("deudor", "Deudor", 3),
      cliente("caido", "Caído", 20),
      cliente("bloqueado", "Bloqueado", -10),
      cliente("revisar", "Revisar", 20),
    ];
    const pulsos = [
      pulso("deudor"),
      pulso("caido", 40),
      pulso("bloqueado"),
      pulso("revisar", 2, { eventos: EVENTOS_AVISO + 1 }),
    ];

    expect(pendientesDeHoy(clientes, pulsos, AHORA).map((p) => p.urgencia)).toEqual([
      "caido",
      "bloqueado",
      "por_cobrar",
      "revisar",
    ]);
  });

  it("un local sano y al corriente no ocupa un renglón", () => {
    const sano = [cliente("a", "Rodizio", 25)];
    expect(pendientesDeHoy(sano, [pulso("a")], AHORA)).toEqual([]);
  });

  it("el que vence hoy se distingue del que vence en tres días", () => {
    const lista = pendientesDeHoy([cliente("a", "Hoy", 0)], [pulso("a")], AHORA);
    expect(lista[0]!.urgencia).toBe("vence_hoy");
    expect(lista[0]!.detalle).toBe("Vence hoy");
  });

  it("los dados de baja no aparecen por ningún lado", () => {
    const baja = [cliente("a", "Cerrado", -100, { activo: false })];
    expect(pendientesDeHoy(baja, [], AHORA)).toEqual([]);
  });

  /* Un local caído Y moroso sale una sola vez, por lo más grave. */
  it("un local con dos problemas sale una vez, por el peor", () => {
    const lista = pendientesDeHoy([cliente("a", "Los dos", -10)], [pulso("a", 50)], AHORA);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.urgencia).toBe("caido");
  });
});

// --- El resumen -----------------------------------------------------------------------------

describe("el resumen del negocio", () => {
  it("cuenta locales, cobros y problemas", () => {
    const clientes = [
      cliente("a", "Uno", 25),
      cliente("b", "Dos", 3),
      cliente("c", "Tres", -10),
      cliente("d", "Baja", 25, { activo: false }),
    ];
    const r = resumenDeCartera(clientes, [pulso("a"), pulso("b"), pulso("c")], AHORA);

    expect(r.locales).toBe(3);
    expect(r.al_corriente).toBe(1);
    expect(r.por_cobrar).toBe(1);
    expect(r.bloqueados).toBe(1);
    expect(r.ingreso_mensual).toBe(pesos(4_500));
  });

  /*
   * Mezclar una anualidad con once mensualidades y llamarlo "lo que entra este
   * mes" da un número que no significa nada.
   */
  it("el plan anual se reparte entre doce para poder compararlo", () => {
    const anual = [cliente("a", "Anual", 300, { plan: "anual", cuota: pesos(18_000) })];
    expect(resumenDeCartera(anual, [], AHORA).ingreso_mensual).toBe(pesos(1_500));
  });

  /* Muchas versiones distintas = despliegue disperso, y eso es un problema. */
  it("agrupa qué versión tiene cada quien, de la más común a la menos", () => {
    const clientes = [cliente("a", "A", 25), cliente("b", "B", 25), cliente("c", "C", 25)];
    const pulsos = [
      pulso("a", 2, { version: "1.4.0" }),
      pulso("b", 2, { version: "1.4.0" }),
      pulso("c", 2, { version: "1.2.0" }),
    ];
    expect(resumenDeCartera(clientes, pulsos, AHORA).versiones).toEqual([
      { version: "1.4.0", locales: 2 },
      { version: "1.2.0", locales: 1 },
    ]);
  });

  /* Un Hub que reintentó manda el pulso dos veces: manda el más reciente. */
  it("dos pulsos del mismo local no cuentan doble", () => {
    const r = resumenDeCartera(
      [cliente("a", "Uno", 25)],
      [pulso("a", 10, { version: "1.3.0" }), pulso("a", 1, { version: "1.4.0" })],
      AHORA,
    );
    expect(r.versiones).toEqual([{ version: "1.4.0", locales: 1 }]);
  });

  it("una cartera vacía no revienta", () => {
    const r = resumenDeCartera([], [], AHORA);
    expect(r.locales).toBe(0);
    expect(r.ingreso_mensual).toBe(0);
  });
});

// --- El identificador -----------------------------------------------------------------------

describe("el identificador de un local nuevo", () => {
  /*
   * Legible a propósito: este id se dicta por teléfono en cada soporte, y
   * `suc-rodizio-centro` vale mucho más que un UUID en esa llamada.
   */
  it("sale legible y sin acentos", () => {
    expect(idDeSucursal("Rodizio", "Centro")).toBe("suc-rodizio-centro");
    expect(idDeSucursal("Café Málaga")).toBe("suc-cafe-malaga");
    expect(idDeSucursal("  La  Fonda  ")).toBe("suc-la-fonda");
  });
});
