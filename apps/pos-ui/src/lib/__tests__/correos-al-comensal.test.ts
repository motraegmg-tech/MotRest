/**
 * Los correos al comensal, desde la terminal: pedirlos y enseñar cómo acabaron.
 *
 * ## El defecto que estas pruebas cierran
 *
 * De los seis correos del catálogo solo salía uno —la confirmación de reserva,
 * que el Hub dispara solo—. Los otros cinco eran interruptores conectados a
 * nada: no había botón ni forma de pedirle al Hub que mandara uno. Gonzalo:
 * «está pero no se pueden mandar los correos manualmente».
 *
 * Ahora la terminal anota `correo_solicitado` y el Hub contesta con el mismo
 * `solicitud_id`. Lo que se prueba aquí es la mitad de la terminal: que la
 * petición salga bien formada y a nombre de alguien, que la respuesta se
 * pinte, y que las reglas de la pantalla —la reserva próxima, la víspera, el
 * permiso de publicidad— digan lo mismo en la ficha y en Reservas.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FabricaEventos,
  streamCorreo,
  type ConfiguracionCorreo,
  type EventoCorreo,
  type Reserva,
} from "@motrest/dominio";
import { almacenEnMemoria, type Almacen } from "@motrest/protocolo-sync";
import { CLAVE_CORREO, StoreCorreo, normalizarConfiguracion } from "../correo.svelte";
import {
  cuandoDeReserva,
  datosDeEjemplo,
  datosDelCorreo,
  esVispera,
  opcionesDeCorreo,
  reservaProximaDe,
} from "../correos-del-comensal";
import { SUCURSAL_ID } from "../presentacion";

const REMITENTE = "Rodizio <rodizio.gdl@gmail.com>";

/** Un almacén listo para mandar: remitente puesto y los seis encendidos. */
async function almacenListo(): Promise<{ store: StoreCorreo; almacen: Almacen }> {
  const store = new StoreCorreo();
  const almacen = almacenEnMemoria();
  await store.hidratar(almacen);
  store.actualizar({ remitente: REMITENTE, local: "Rodizio" });
  for (const tipo of ["reserva_confirmada", "reserva_recordatorio", "gracias", "cupon"] as const) {
    store.alternar(tipo);
  }
  store.actuarComo("usr-lucia");
  return { store, almacen };
}

/** La respuesta del Hub, firmada por él. */
function respuestaDelHub(
  solicitud_id: string,
  resultado: { enviado: true } | { enviado: false; motivo: string },
  ts = Date.now(),
): EventoCorreo {
  const fabrica = new FabricaEventos<EventoCorreo>({
    device_id: "hub",
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });
  const ev = resultado.enviado
    ? fabrica.crear("correo_enviado", streamCorreo(SUCURSAL_ID), {
        correo: "ana@correo.mx",
        clase_correo: "gracias",
        solicitud_id,
      })
    : fabrica.crear("correo_rechazado", streamCorreo(SUCURSAL_ID), {
        correo: "ana@correo.mx",
        clase_correo: "gracias",
        solicitud_id,
        motivo: resultado.motivo,
      });
  return { ...ev, ts };
}

describe("pedir un correo desde la terminal", () => {
  it("anota un correo_solicitado con su solicitud_id, a nombre de quien lo pidió", async () => {
    const { store, almacen } = await almacenListo();

    const r = store.solicitar(
      "gracias",
      "  ana@correo.mx ",
      { nombre: "Ana Ruiz", mensaje: "" },
      { cliente_id: "cli-ana", acepta_marketing: false },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const guardados = (await almacen.eventos.leerTodos()) as EventoCorreo[];
    expect(guardados).toHaveLength(1);
    const ev = guardados[0]!;
    expect(ev.tipo).toBe("correo_solicitado");
    if (ev.tipo !== "correo_solicitado") return;

    expect(ev.solicitud_id).toBe(r.solicitud_id);
    expect(ev.clase_correo).toBe("gracias");
    expect(ev.correo).toBe("ana@correo.mx");
    expect(ev.cliente_id).toBe("cli-ana");
    expect(ev.acepta_marketing).toBe(false);
    expect(ev.stream_id).toBe(streamCorreo(SUCURSAL_ID));
    // Sin campos vacíos: un `mensaje: ""` en el registro es ruido para siempre.
    expect(ev.datos).toEqual({ nombre: "Ana Ruiz" });
    // LO QUE IMPORTA: nunca «sistema». Así estuvo meses rechazándose el cierre de caja.
    expect(ev.empleado_id).toBe("usr-lucia");
    expect(ev.seq).toBeUndefined();
  });

  it("sin nadie en sesión no se pide nada", async () => {
    const store = new StoreCorreo();
    store.actualizar({ remitente: REMITENTE, local: "Rodizio" });
    store.alternar("gracias");

    const r = store.solicitar("gracias", "ana@correo.mx", {}, { acepta_marketing: false });
    expect(r.ok).toBe(false);
    expect(store.solicitudes).toHaveLength(0);
  });

  it("pasa por la misma puerta que el Hub: sin permiso no hay publicidad", async () => {
    const { store } = await almacenListo();
    const r = store.solicitar(
      "cupon",
      "ana@correo.mx",
      { mensaje: "2×1 los martes" },
      { cliente_id: "cli-ana", acepta_marketing: false },
    );
    expect(r).toEqual({ ok: false, error: "Esta persona no aceptó recibir promociones" });
  });

  it("una promoción vacía no sale, aunque haya permiso", async () => {
    const { store } = await almacenListo();
    const r = store.solicitar(
      "cupon",
      "ana@correo.mx",
      { mensaje: "   " },
      { cliente_id: "cli-ana", acepta_marketing: true },
    );
    expect(r.ok).toBe(false);
  });

  it("un correo apagado tampoco se pide", async () => {
    const { store } = await almacenListo();
    const r = store.solicitar("encuesta", "ana@correo.mx", {}, { acepta_marketing: false });
    expect(r.ok).toBe(false);
  });
});

describe("la respuesta del Hub", () => {
  it("integrar no duplica lo que ya se conocía", async () => {
    const { store } = await almacenListo();
    const r = store.solicitar("gracias", "ana@correo.mx", {}, { cliente_id: "cli-ana", acepta_marketing: false });
    if (!r.ok) throw new Error(r.error);

    const enviado = respuestaDelHub(r.solicitud_id, { enviado: true });
    store.integrar([enviado]);
    store.integrar([enviado]);

    expect(store.solicitudes).toHaveLength(1);
    expect(store.solicitudes[0]!.estado).toBe("enviado");
    expect(store.estados.get(r.solicitud_id)?.estado).toBe("enviado");
  });

  it("un rechazo deja el motivo a la vista", async () => {
    const { store } = await almacenListo();
    const r = store.solicitar("gracias", "ana@correo.mx", {}, { cliente_id: "cli-ana", acepta_marketing: false });
    if (!r.ok) throw new Error(r.error);

    store.integrar([
      respuestaDelHub(r.solicitud_id, { enviado: false, motivo: "Gmail no aceptó la contraseña de aplicación" }),
    ]);

    const s = store.solicitudes[0]!;
    expect(s.estado).toBe("rechazado");
    expect(s.motivo).toContain("contraseña de aplicación");
  });
});

describe("los últimos correos de un comensal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("solo los suyos, y el más reciente primero", async () => {
    const { store } = await almacenListo();

    vi.setSystemTime(new Date("2026-09-10T12:00:00"));
    store.solicitar("gracias", "ana@correo.mx", {}, { cliente_id: "cli-ana", acepta_marketing: false });
    vi.setSystemTime(new Date("2026-09-12T12:00:00"));
    store.solicitar("gracias", "beto@correo.mx", {}, { cliente_id: "cli-beto", acepta_marketing: false });
    vi.setSystemTime(new Date("2026-09-15T12:00:00"));
    store.solicitar(
      "cupon",
      "ana@correo.mx",
      { mensaje: "2×1 los martes" },
      { cliente_id: "cli-ana", acepta_marketing: true },
    );

    const deAna = store.ultimosDe("cli-ana");
    expect(deAna.map((s) => s.clase_correo)).toEqual(["cupon", "gracias"]);
    expect(deAna.every((s) => s.correo === "ana@correo.mx")).toBe(true);
    expect(deAna.map((s) => s.pedido_por)).toEqual(["usr-lucia", "usr-lucia"]);
  });
});

describe("la configuración", () => {
  it("con un remitente de Gmail el modo es Gmail, aunque la guardada no lo dijera", () => {
    const store = new StoreCorreo();
    /*
     * Una configuración de antes de los modos: el Hub la leía como dominio propio.
     * Lleva versión 1 porque `fusionar` ya solo adopta lo MÁS NUEVO que lo que
     * tiene —antes adoptaba sin mirar, y una tableta con una copia vieja podía
     * pisar lo que se acababa de cambiar en la caja—.
     */
    store.fusionar({
      remitente: "",
      local: "Rodizio",
      activos: {},
      version: 1,
      updated_at: 1,
    } as ConfiguracionCorreo);
    expect(store.config.modo).toBeUndefined();

    const r = store.actualizar({ remitente: REMITENTE });
    expect(r.ok).toBe(true);
    expect(store.config.modo).toBe("gmail");
  });

  it("ya no guarda «Responder a»", () => {
    const store = new StoreCorreo();
    store.actualizar({ remitente: REMITENTE, responder_a: "hola@rodizio.mx" });
    expect(store.config.responder_a).toBeUndefined();
    expect("responder_a" in store.config).toBe(false);
  });

  it("al cargarse, arregla la configuración vieja sin tocar lo demás", async () => {
    const almacen = almacenEnMemoria();
    await almacen.estado.guardar(CLAVE_CORREO, {
      remitente: REMITENTE,
      local: "Rodizio",
      responder_a: "viejo@rodizio",
      activos: { gracias: true },
    });

    const store = new StoreCorreo();
    await store.hidratar(almacen);

    expect(store.config.modo).toBe("gmail");
    expect(store.config.responder_a).toBeUndefined();
    expect(store.config.activos).toEqual({ gracias: true });
    // El «Responder a» mal escrito ya no aparece como un problema sin arreglo.
    expect(store.problemas).toEqual([]);
  });

  it("en modo MOTRAE el «Responder a» se conserva: ahí sí hace falta", () => {
    const c = normalizarConfiguracion({
      modo: "motrae",
      remitente: "Rodizio <rodizio@avisos.motrest.mx>",
      responder_a: "rodizio.gdl@gmail.com",
      local: "Rodizio",
      activos: {},
    });
    expect(c.responder_a).toBe("rodizio.gdl@gmail.com");
  });

  it("el enlace de la encuesta tiene que ser una dirección web", () => {
    const store = new StoreCorreo();
    expect(store.actualizar({ enlace_encuesta: "reseñas de Google" }).ok).toBe(false);
    expect(store.actualizar({ enlace_encuesta: "g.page/r/rodizio/review" }).ok).toBe(false);
    expect(store.actualizar({ enlace_encuesta: "https://g.page/r/rodizio/review" }).ok).toBe(true);
    expect(store.config.enlace_encuesta).toBe("https://g.page/r/rodizio/review");
    // Vaciarlo lo quita, en vez de guardar un enlace en blanco.
    expect(store.actualizar({ enlace_encuesta: "" }).ok).toBe(true);
    expect(store.config.enlace_encuesta).toBeUndefined();
  });
});

describe("las reglas de la ficha y de Reservas", () => {
  const AHORA = new Date("2026-09-18T12:00:00").getTime();
  const CONFIG: ConfiguracionCorreo = {
    modo: "gmail",
    remitente: REMITENTE,
    local: "Rodizio",
    activos: {
      reserva_confirmada: true,
      reserva_recordatorio: true,
      encuesta: true,
      gracias: true,
      cupon: true,
      te_extranamos: true,
    },
  };

  function reserva(parcial: Partial<Reserva>): Reserva {
    return {
      id: "res-1",
      nombre: "Ana Ruiz",
      personas: 4,
      para_ts: new Date("2026-09-19T21:00:00").getTime(),
      duracion_min: 90,
      origen: "casa",
      estado: "apartada",
      creada_ts: AHORA - 86_400_000,
      ...parcial,
    } as Reserva;
  }

  it("la reserva próxima se encuentra aunque no esté atada a la ficha", () => {
    const ana = { cliente_id: "cli-ana", correo: "Ana@Correo.mx", telefono: "+52 33 1122 3344" };
    const reservas = [
      reserva({ id: "pasada", correo: "ana@correo.mx", para_ts: AHORA - 3_600_000 }),
      reserva({ id: "cancelada", correo: "ana@correo.mx", estado: "cancelada" }),
      reserva({ id: "de-otro", cliente_id: "cli-beto", correo: "ana@correo.mx" }),
      reserva({ id: "lejana", correo: "ana@correo.mx", para_ts: AHORA + 7 * 86_400_000 }),
      reserva({ id: "por-telefono", telefono: "33 1122 3344", para_ts: AHORA + 2 * 86_400_000 }),
      reserva({ id: "manana", correo: "ana@correo.mx" }),
    ];
    expect(reservaProximaDe(ana, reservas, AHORA)?.id).toBe("manana");
    expect(reservaProximaDe(ana, reservas.slice(0, 5), AHORA)?.id).toBe("por-telefono");
    expect(reservaProximaDe(ana, reservas.slice(0, 3), AHORA)).toBeUndefined();
  });

  it("los seis se enseñan siempre; los que no, con su motivo", () => {
    const opciones = opcionesDeCorreo(CONFIG, {
      correo: "ana@correo.mx",
      aceptaPromociones: false,
      ahora: AHORA,
    });
    expect(opciones).toHaveLength(6);

    const motivo = (tipo: string) => opciones.find((o) => o.def.tipo === tipo)?.razon;
    expect(motivo("reserva_confirmada")).toBe("No tiene una reserva próxima");
    expect(motivo("reserva_recordatorio")).toBe("No tiene una reserva próxima");
    expect(motivo("cupon")).toBe("Esta persona no aceptó recibir promociones");
    expect(motivo("encuesta")).toContain("enlace de la encuesta");
    expect(opciones.find((o) => o.def.tipo === "gracias")?.puede).toBe(true);
    expect(opciones.filter((o) => !o.puede).every((o) => !!o.razon)).toBe(true);
  });

  it("el recordatorio sale la víspera, y una sola vez", () => {
    const manana = reserva({});
    const base = { correo: "ana@correo.mx", aceptaPromociones: true, ahora: AHORA };
    const recordatorio = (situacion: Parameters<typeof opcionesDeCorreo>[1]) =>
      opcionesDeCorreo(CONFIG, situacion).find((o) => o.def.tipo === "reserva_recordatorio")!;

    expect(recordatorio({ ...base, reserva: manana }).puede).toBe(true);
    expect(recordatorio({ ...base, reserva: manana, recordatorioPedido: true }).razon).toBe(
      "Ya se le mandó el recordatorio de esta reserva",
    );

    const hoy = reserva({ para_ts: new Date("2026-09-18T21:00:00").getTime() });
    expect(recordatorio({ ...base, reserva: hoy }).razon).toContain("Su reserva es hoy");

    const lejana = reserva({ para_ts: new Date("2026-09-25T21:00:00").getTime() });
    expect(recordatorio({ ...base, reserva: lejana }).razon).toContain("sale la víspera");

    // La confirmación, en cambio, no depende del día.
    const confirmacion = opcionesDeCorreo(CONFIG, { ...base, reserva: lejana }).find(
      (o) => o.def.tipo === "reserva_confirmada",
    );
    expect(confirmacion?.puede).toBe(true);
  });

  it("la víspera es el día de calendario anterior, no «dentro de 24 horas»", () => {
    const noche = new Date("2026-09-18T23:30:00").getTime();
    expect(esVispera(new Date("2026-09-19T13:00:00").getTime(), noche)).toBe(true);
    expect(esVispera(new Date("2026-09-20T00:30:00").getTime(), noche)).toBe(false);
  });

  it("cada correo lleva solo sus datos", () => {
    const r = reserva({});
    expect(datosDelCorreo("reserva_recordatorio", { nombre: " Ana Ruiz ", reserva: r, mensaje: "x" })).toEqual({
      nombre: "Ana Ruiz",
      cuando: cuandoDeReserva(r.para_ts),
      personas: 4,
    });
    expect(datosDelCorreo("gracias", { nombre: "Ana Ruiz", reserva: r, mensaje: "x" })).toEqual({
      nombre: "Ana Ruiz",
    });
    expect(datosDelCorreo("cupon", { nombre: "Ana Ruiz", mensaje: " 2×1 " })).toEqual({
      nombre: "Ana Ruiz",
      mensaje: "2×1",
    });
  });

  it("el ejemplo de la configuración es Ana Ruiz, el viernes a las 21:00, para cuatro", () => {
    const datos = datosDeEjemplo("reserva_confirmada", AHORA);
    expect(datos.nombre).toBe("Ana Ruiz");
    expect(datos.personas).toBe(4);
    expect(datos.cuando).toContain("viernes");
    // Escrito como lo escribe el Hub en la confirmación: es-MX, reloj de 12 horas.
    expect(datos.cuando).toBe(cuandoDeReserva(new Date("2026-09-25T21:00:00").getTime()));
    expect(datosDeEjemplo("cupon", AHORA).mensaje).toBeTruthy();
  });
});

/*
 * El cable, comprobado contra el archivo de verdad. Una réplica del arranque no
 * puede demostrar que el reparto llama a `correo.integrar`: tres veces se ha
 * quedado corta en este proyecto una lista de tipos escrita a mano.
 */
describe("el arranque reparte los correos", () => {
  const fuente = readFileSync(
    new URL("../persistencia/arranque.svelte.ts", import.meta.url),
    "utf8",
  );

  it("usa la lista del dominio, no una copia", () => {
    expect(fuente).toContain("new Set<string>(TIPOS_EVENTO_CORREO)");
  });

  it("los rehidrata al arrancar y los integra en vivo", () => {
    expect(fuente).toContain("correo.hidratarEventos(");
    expect(fuente).toContain("correo.integrar(");
  });
});

/**
 * LA CONFIGURACIÓN VIAJA AL HUB.
 *
 * Era el defecto que dejaba todo lo anterior sin mandar un solo correo en el
 * local: lo configurado en «Correos al comensal» se guardaba en el disco de la
 * terminal y ahí se quedaba. El Hub —que es quien manda— nunca se enteraba, y
 * las otras tabletas decían «el restaurante todavía no configuró su remitente».
 */
describe("la configuración se publica", () => {
  it("cada cambio se publica con una versión mayor", () => {
    const store = new StoreCorreo();
    const publicadas: { version: number; updated_at: number }[] = [];
    store.alPublicar((c) => publicadas.push({ version: c.version, updated_at: c.updated_at }));

    store.actualizar({ remitente: REMITENTE });
    store.alternar("gracias");
    store.cambiarAsunto("gracias", "¡Gracias por venir!");

    expect(publicadas).toHaveLength(3);
    // Estrictamente creciente: el Hub se queda con la de versión mayor.
    expect(publicadas.map((p) => p.version)).toEqual([1, 2, 3]);
  });

  /*
   * El Hub rechaza cualquier catálogo sin versión numérica. Una configuración
   * guardada antes de la 1.5.5 no la trae; al publicarla tiene que salir con 0.
   */
  it("una configuración sin versión se publica con versión 0, no sin ella", () => {
    const store = new StoreCorreo();
    const p = store.paraPublicar;
    expect(typeof p.version).toBe("number");
    expect(typeof p.updated_at).toBe("number");
  });

  /*
   * ESTE catálogo llega a TODAS las tabletas del salón. La contraseña de Gmail
   * permite mandar correo en nombre del restaurante; no puede ir aquí dentro.
   */
  it("la contraseña de Gmail nunca se publica", () => {
    const store = new StoreCorreo();
    store.fusionar({
      remitente: REMITENTE,
      local: "Rodizio",
      activos: {},
      version: 5,
      updated_at: 5,
      llave: "abcd efgh ijkl mnop",
    } as ConfiguracionCorreo & { llave: string });

    expect("llave" in store.paraPublicar).toBe(false);
  });

  it("adopta una configuración más nueva", () => {
    const store = new StoreCorreo();
    const adoptada = store.fusionar({
      remitente: REMITENTE,
      local: "Rodizio",
      activos: {},
      version: 4,
      updated_at: 100,
    });
    expect(adoptada).toBe(true);
    expect(store.config.local).toBe("Rodizio");
  });

  /*
   * La que ya tenía era más nueva: una tableta que reconecta con una copia vieja
   * no puede pisar lo que se acaba de cambiar en la caja.
   */
  it("NO adopta una configuración más vieja que la que tiene", () => {
    const store = new StoreCorreo();
    store.fusionar({ remitente: REMITENTE, local: "Nueva", activos: {}, version: 7, updated_at: 700 });

    const adoptada = store.fusionar({
      remitente: REMITENTE,
      local: "Vieja",
      activos: {},
      version: 3,
      updated_at: 300,
    });

    expect(adoptada).toBe(false);
    expect(store.config.local).toBe("Nueva");
  });
});

/** El cable, leyendo los archivos de verdad: la lógica sola no demuestra que esté puesta. */
describe("el enlace publica y aplica la configuración de correo", () => {
  const sync = readFileSync(new URL("../sync.svelte.ts", import.meta.url), "utf8");

  it("la publica al cambiar", () => {
    expect(sync).toMatch(/correo\.alPublicar\(/);
  });

  it("la ofrece al conectar, para los locales que ya estaban configurados", () => {
    expect(sync).toMatch(/clave: CLAVE_CORREO/);
  });

  it("la adopta al recibirla", () => {
    expect(sync).toMatch(/correo\.fusionar\(/);
  });
});
