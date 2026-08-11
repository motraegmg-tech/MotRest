/**
 * La cartera de MOTRAE.
 *
 * Lo que hay que probar es el ORDEN de lo urgente. Un panel que enseña primero
 * la gráfica de ingresos y esconde "Rodizio lleva 30 horas sin reportar" está
 * al revés: el ingreso del mes que viene depende de que Rodizio funcione hoy.
 */
import { describe, expect, it } from "vitest";
import { pesos, type Centavos } from "../comun/dinero.js";
import {
  DIAS_PARA_COBRAR,
  EVENTOS_AVISO,
  HORAS_SIN_SENAL,
  adopcionDeVersion,
  anotarEnHistorial,
  cobradoEnPeriodo,
  comisionDeResultado,
  comisionesPendientes,
  historiaDelLocal,
  idDeSucursal,
  localesConSoporteViejo,
  mensajeDeCobro,
  pendientesDeHoy,
  resumenDeCartera,
  saludDeCliente,
  situacionDeCliente,
  totalPagadoPor,
  type ClienteMotRest,
  type PagoCliente,
  type PulsoCliente,
  type ResultadoVerificado,
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

  /*
   * Pasó en Rodizio: vendiendo con normalidad y pintado como la emergencia
   * número uno del panel. El pulso colgaba del enlace de WhatsApp, así que un
   * local sin mensajería no reportaba nunca y Central lo daba por caído. Un
   * local que jamás reportó es casi siempre una instalación a la que le falta el
   * enlace, no un restaurante parado.
   */
  it("el que NUNCA reportó no se cuenta como caído: le falta el enlace", () => {
    const nuevo = [cliente("a", "Rodizio", 25)];
    const pendientes = pendientesDeHoy(nuevo, [], AHORA);

    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]!.urgencia).toBe("sin_telemetria");
    expect(pendientes[0]!.detalle).toContain("enlace");
  });

  it("el que reportaba y se calló SÍ está caído, y va primero", () => {
    const clientes = [
      cliente("a", "Rodizio", 25),
      cliente("b", "Vence hoy", 0),
      cliente("c", "Recién montado", 25),
    ];
    // `a` reportaba y dejó de hacerlo hace dos días; `b` está sano y al día en
    // señal, solo le vence el cobro; `c` no ha reportado nunca.
    const pulsos = [pulso("a", 48), pulso("b")];

    const pendientes = pendientesDeHoy(clientes, pulsos, AHORA);

    // El caído abre la lista, y el que nunca reportó queda POR DEBAJO del cobro:
    // el primero no está vendiendo, el último solo no se deja ver.
    expect(pendientes.map((p) => p.urgencia)).toEqual(["caido", "vence_hoy", "sin_telemetria"]);
    expect(pendientes[0]!.sucursal_id).toBe("a");
    expect(pendientes[2]!.sucursal_id).toBe("c");
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

// --- El dinero que entró de verdad -----------------------------------------------------------

function pago(ts: number, montoEnPesos: number, extra: Partial<PagoCliente> = {}): PagoCliente {
  return { id: `pago-${ts}`, ts, monto: pesos(montoEnPesos), metodo: "transferencia", ...extra };
}

function resultado(extra: Partial<ResultadoVerificado> = {}): ResultadoVerificado {
  return {
    id: "res-1",
    ts: AHORA - 5 * DIA,
    concepto: "Merma de masa: de 12 % a 4 %",
    ahorro: pesos(20_000),
    comision_pct: 15,
    verificado: true,
    cobrado: false,
    ...extra,
  };
}

describe("lo cobrado frente a lo prometido", () => {
  /*
   * `ingreso_mensual` es lo que entraría si todos pagaran; `cobrado_mes` es
   * dinero. La distancia entre los dos es el único número honesto del panel.
   */
  it("separa la promesa del dinero que ya entró", () => {
    const rodizio = cliente("a", "Rodizio", 20, {
      pagos: [pago(AHORA - 3 * DIA, 1_500), pago(AHORA - 200 * DIA, 1_500)],
    });

    const r = resumenDeCartera([rodizio], [], AHORA);

    expect(r.ingreso_mensual).toBe(pesos(1_500));
    /* El de hace 200 días queda fuera de la ventana de 30. */
    expect(r.cobrado_mes).toBe(pesos(1_500));
  });

  /*
   * El dinero de un cliente que se fue entró igual. Descontarlo haría que un mes
   * ya cerrado cambiara de cifra el día que alguien se da de baja.
   */
  it("cuenta lo que pagó un local que después se dio de baja", () => {
    const ido = cliente("b", "La Fonda", 10, {
      activo: false,
      pagos: [pago(AHORA - 2 * DIA, 900)],
    });

    expect(cobradoEnPeriodo([ido], AHORA - 30 * DIA, AHORA)).toBe(pesos(900));
    expect(resumenDeCartera([ido], [], AHORA).locales).toBe(0);
  });

  it("suma lo pagado por un local a lo largo de su vida", () => {
    const c = cliente("a", "Rodizio", 20, {
      pagos: [pago(AHORA - 400 * DIA, 1_500), pago(AHORA - 2 * DIA, 1_500)],
    });

    expect(totalPagadoPor(c)).toBe(pesos(3_000));
    expect(totalPagadoPor(cliente("z", "Sin pagos", 5))).toBe(0);
  });
});

describe("el cobro por resultado", () => {
  it("la comisión es el porcentaje del ahorro medido", () => {
    expect(comisionDeResultado(resultado())).toBe(pesos(3_000));
  });

  /*
   * Un ahorro que el restaurantero todavía no reconoce no es dinero por cobrar,
   * es una conversación pendiente. Contarlo infla el negocio con trabajo que
   * quizá no se pague nunca.
   */
  it("solo cuenta lo verificado y lo no cobrado", () => {
    const c = cliente("a", "Rodizio", 20, {
      resultados: [
        resultado({ id: "r1" }),
        resultado({ id: "r2", verificado: false }),
        resultado({ id: "r3", cobrado: true }),
      ],
    });

    expect(comisionesPendientes([c])).toBe(pesos(3_000));
    expect(resumenDeCartera([c], [], AHORA).por_cobrar_resultados).toBe(pesos(3_000));
  });
});

describe("el mensaje de cobro", () => {
  const dinero = (c: Centavos) => `$${(c / 100).toLocaleString("es-MX")}`;

  /* Un recordatorio que no dice la consecuencia se lee como opcional. */
  it("a un bloqueado le dice que está suspendido y cómo se reactiva", () => {
    const c = cliente("a", "Rodizio", -10);
    const texto = mensajeDeCobro(c, situacionDeCliente(c, AHORA), dinero);

    expect(texto).toContain("suspendido");
    expect(texto).toContain("Rodizio");
    expect(texto).toContain("$1,500");
  });

  it("a uno en gracia le dice cuántos días le quedan antes de la suspensión", () => {
    const c = cliente("a", "Rodizio", -1);
    const texto = mensajeDeCobro(c, situacionDeCliente(c, AHORA), dinero);

    expect(texto).toContain("gracia");
    expect(texto).toMatch(/quedan? \d+ día/);
  });

  it("a uno por cobrar le dice el plazo y saluda al responsable por su nombre", () => {
    const c = cliente("a", "Rodizio", 3, { contacto: "Ana" });
    const texto = mensajeDeCobro(c, situacionDeCliente(c, AHORA), dinero);

    expect(texto).toContain("Hola, Ana.");
    expect(texto).toContain("en 3 días");
  });

  it("a uno sin licencia le ofrece activarlo, no le reclama", () => {
    const c = cliente("a", "Rodizio", null);
    const texto = mensajeDeCobro(c, situacionDeCliente(c, AHORA), dinero);

    expect(texto).toContain("activarlo");
    expect(texto).not.toContain("venció");
  });
});

// --- La historia de cada local ---------------------------------------------------------------

describe("la historia de un local", () => {
  /*
   * Central pregunta al relay cada diez minutos y el Hub reporta una vez al día:
   * casi todas las consultas devuelven EL MISMO parte. Sin deduplicar, una tarde
   * llenaría el historial de copias y no guardaría ni un día de historia real.
   */
  it("no guarda dos veces el mismo parte", () => {
    const p = pulso("a", 2);
    let historial = anotarEnHistorial([], p);
    historial = anotarEnHistorial(historial, { ...p });
    historial = anotarEnHistorial(historial, { ...p, ts: p.ts + 1 });

    expect(historial).toHaveLength(2);
  });

  it("se queda con los más recientes cuando se llena", () => {
    let historial: PulsoCliente[] = [];
    for (let i = 0; i < 10; i++) {
      historial = anotarEnHistorial(historial, pulso("a", 100 - i), 4);
    }

    expect(historial).toHaveLength(4);
    /* Ordenado y con el más nuevo al final. */
    expect(historial[3]!.ts).toBeGreaterThan(historial[0]!.ts);
  });

  it("contesta desde cuándo un local dejó de dar señales", () => {
    const callado = historiaDelLocal([pulso("a", 24 * 5), pulso("a", 24 * 4)], AHORA);
    expect(callado.callado_desde_ts).toBe(AHORA - 24 * 4 * HORA);

    const vivo = historiaDelLocal([pulso("a", 2)], AHORA);
    expect(vivo.callado_desde_ts).toBeNull();
  });

  it("recuerda por qué versiones ha pasado, la más reciente primero", () => {
    const historia = historiaDelLocal(
      [
        pulso("a", 24 * 30, { version: "1.1.0" }),
        pulso("a", 24 * 20, { version: "1.1.0" }),
        pulso("a", 24 * 10, { version: "1.2.0" }),
        pulso("a", 2, { version: "1.3.0" }),
      ],
      AHORA,
    );

    expect(historia.versiones.map((v) => v.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
    expect(historia.partes).toBe(4);
  });

  it("un local sin historial no revienta", () => {
    expect(historiaDelLocal([], AHORA)).toMatchObject({ partes: 0, callado_desde_ts: null });
  });
});

// --- Cómo va un despliegue -------------------------------------------------------------------

describe("la adopción de una versión publicada", () => {
  /*
   * Un despliegue por anillos sin nadie mirando el resultado es el mismo
   * «publicar y rezar» de siempre, solo que más despacio.
   */
  it("separa a los que ya subieron de los que se quedaron atrás", () => {
    const clientes = [cliente("a", "Rodizio", 20), cliente("b", "La Fonda", 20)];
    const pulsos = [pulso("a", 1, { version: "1.5.0" }), pulso("b", 1, { version: "1.4.0" })];

    const adopcion = adopcionDeVersion(clientes, pulsos, "1.5.0");

    expect(adopcion.actualizados.map((c) => c.id)).toEqual(["a"]);
    expect(adopcion.rezagados[0]).toMatchObject({ version: "1.4.0" });
    expect(adopcion.avance_pct).toBe(50);
  });

  it("solo mira a quien le tocaba por el anillo", () => {
    const clientes = [cliente("a", "Rodizio", 20), cliente("b", "La Fonda", 20)];
    const adopcion = adopcionDeVersion(clientes, [], "1.5.0", 10, (id) => id === "a");

    expect(adopcion.esperados).toHaveLength(1);
    expect(adopcion.avance_pct).toBe(0);
  });

  it("un local que nunca reportó cuenta como rezagado, no como desconocido", () => {
    const adopcion = adopcionDeVersion([cliente("a", "Rodizio", 20)], [], "1.5.0");
    expect(adopcion.rezagados[0]!.version).toBeNull();
  });

  it("sin locales esperados no divide entre cero", () => {
    expect(adopcionDeVersion([], [], "1.5.0").avance_pct).toBe(0);
  });
});

// --- El acceso de soporte ---------------------------------------------------------------------

describe("rotar la contraseña de soporte", () => {
  /*
   * La contraseña va firmada DENTRO de la licencia: cambiarla en Central no
   * cambia nada en ningún restaurante hasta reemitir. El día que haya que
   * rotarla de urgencia, ésta es la única pregunta que importa.
   */
  it("señala los locales cuya última licencia es anterior al cambio", () => {
    const viejo = cliente("a", "Rodizio", 20);
    const nuevo = cliente("b", "La Fonda", 20, {
      licencia: {
        sucursal_id: "b",
        nombre: "La Fonda",
        plan: "mensual",
        vence_ts: AHORA + 20 * DIA,
        gracia_dias: 3,
        emitida_ts: AHORA - 1 * DIA,
        firma: "x",
      },
    });

    const pendientes = localesConSoporteViejo([viejo, nuevo], AHORA - 2 * DIA);

    expect(pendientes.map((c) => c.id)).toEqual(["a"]);
  });

  it("un local sin licencia todavía cuenta como pendiente", () => {
    expect(localesConSoporteViejo([cliente("a", "Rodizio", null)], AHORA)).toHaveLength(1);
  });

  it("sin contraseña de soporte configurada no señala a nadie", () => {
    expect(localesConSoporteViejo([cliente("a", "Rodizio", 20)], undefined)).toHaveLength(0);
  });
});
