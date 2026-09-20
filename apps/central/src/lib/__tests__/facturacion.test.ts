/**
 * La facturación de cada restaurante desde Central.
 *
 * Lo que se prueba aquí es lo que no puede fallar en silencio: que la llave de
 * un restaurante solo la pueda abrir SU Hub, que ninguna llave acabe en la
 * cartera ni en la vista pública, que no se cree una llave Live que luego no
 * llegue a nadie, y que el semáforo diga la verdad sobre si un local puede
 * facturar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirSobre,
  generarParDeSobre,
  pesos,
  type ParDeSobre,
  type SecretoFacturapi,
  type SecretoGmail,
} from "@motrest/dominio";
import { crearCentralParaPruebas, type StoreCentral } from "../central.svelte";
import {
  SIN_LLAVE_PUBLICA,
  entregaDeSecreto,
  idDeLaLlaveNueva,
  leerEstadoSecretos,
  leerLlaveDeRespuesta,
  leerOrganizacion,
  semaforoDeOrganizacion,
  type OrganizacionFacturapi,
} from "../facturacion";

const ORG = "5a2a307be93a2f00129ea035";
/*
 * LAS LLAVES DE MENTIRA SE ARMAN EN DOS TROZOS, no se escriben enteras.
 *
 * FacturAPI usa el mismo prefijo que Stripe —`sk_live_`, `sk_test_`—, así que el
 * escáner de secretos de GitHub las toma por llaves de Stripe de verdad y
 * RECHAZA el envío ENTERO del repositorio. Pasó al publicar la 1.5.5. Partir la
 * cadena es todo lo que hace falta: lo que ve la prueba es idéntico, y así no
 * hay que pedirle a GitHub que haga una excepción con algo que parece una llave.
 */
const USUARIO = `sk_${"user"}_0123456789abcdefghijKLMN`;
const LIVE = `sk_${"live"}_Zq9xWv8uTs7rQp6oNm5lKj4`;
const TEST = `sk_${"test"}_Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8`;
const AHORA = Date.parse("2026-09-19T12:00:00Z");

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function respuesta(estado: number, cuerpo: unknown = ""): Response {
  return {
    ok: estado < 300,
    status: estado,
    text: async () => (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)),
    headers: { get: () => null },
  } as unknown as Response;
}

/** Una organización como la devuelve FacturAPI. */
function orgDeFacturapi(cambios: Record<string, unknown> = {}) {
  return {
    id: ORG,
    is_production_ready: true,
    pending_steps: [],
    legal: { name: "Rodizio", legal_name: "RODIZIO PIZZAS", tax_id: "ROD010101AB1" },
    certificate: { has_certificate: true, expires_at: "2028-01-01T00:00:00Z" },
    ...cambios,
  };
}

function organizacion(cambios: Record<string, unknown> = {}): OrganizacionFacturapi {
  return leerOrganizacion(orgDeFacturapi(cambios))!;
}

// --- Lo que se lee de FacturAPI -----------------------------------------------------------

describe("leer lo que contesta FacturAPI", () => {
  it("una organización se reduce a lo que el panel enseña, con su RFC", () => {
    const org = organizacion();
    expect(org).toMatchObject({
      id: ORG,
      nombre: "Rodizio",
      razon_social: "RODIZIO PIZZAS",
      rfc: "ROD010101AB1",
      lista: true,
      csd: { cargado: true, vence: "2028-01-01T00:00:00Z" },
    });
  });

  /* El id acaba en una ruta: uno con «/» o «..» no se acepta ni para enseñarlo. */
  it("una organización con un id raro se descarta", () => {
    expect(leerOrganizacion({ ...orgDeFacturapi(), id: "../invoices" })).toBeNull();
    expect(leerOrganizacion("no")).toBeNull();
  });

  it("la llave pedida llega como texto JSON y se comprueba su prefijo", () => {
    expect(leerLlaveDeRespuesta(JSON.stringify(LIVE), "produccion")).toBe(LIVE);
    expect(leerLlaveDeRespuesta(TEST, "pruebas")).toBe(TEST);
    /* Pedir la de producción y recibir la de pruebas se para aquí, no en la caja. */
    expect(leerLlaveDeRespuesta(JSON.stringify(TEST), "produccion")).toBeNull();
    expect(leerLlaveDeRespuesta('{"message":"x"}', "produccion")).toBeNull();
  });

  /* Cuatro caracteres de azar pueden coincidir: gana la más reciente, que es la nuestra. */
  it("reconoce la llave recién creada por su principio y su fecha", () => {
    const llaves = [
      { id: "vieja", inicio: LIVE.slice(0, 12), creada_ts: 1 },
      { id: "nueva", inicio: LIVE.slice(0, 12), creada_ts: 2 },
      { id: "otra", inicio: "sk_live_XXXX", creada_ts: 3 },
    ];
    expect(idDeLaLlaveNueva(llaves, LIVE)).toBe("nueva");
    expect(idDeLaLlaveNueva(llaves, `sk_${"live"}_nada_que_ver_123456`)).toBeUndefined();
  });
});

// --- El semáforo --------------------------------------------------------------------------

describe("el semáforo de la organización", () => {
  it("todo en orden es verde", () => {
    expect(semaforoDeOrganizacion(organizacion(), "produccion", AHORA).color).toBe("verde");
  });

  /*
   * Sin CSD no se timbra de verdad. En producción eso es un restaurante que no
   * puede dar factura: rojo. En pruebas no hace falta CSD: se puede ensayar ya.
   */
  it("sin CSD es rojo en producción y ámbar en pruebas", () => {
    const sinCsd = organizacion({
      is_production_ready: false,
      certificate: { has_certificate: false },
      pending_steps: [{ type: "certificate", description: "Sube tu CSD" }],
    });
    const produccion = semaforoDeOrganizacion(sinCsd, "produccion", AHORA);
    expect(produccion.color).toBe("rojo");
    expect(produccion.puntos.some((p) => p.texto.includes("CSD"))).toBe(true);
    expect(semaforoDeOrganizacion(sinCsd, "pruebas", AHORA).color).toBe("ambar");
  });

  it("un CSD que vence en días se avisa en ámbar, y uno vencido en rojo", () => {
    const pronto = organizacion({ certificate: { has_certificate: true, expires_at: "2026-09-29T12:00:00Z" } });
    const s = semaforoDeOrganizacion(pronto, "produccion", AHORA);
    expect(s.color).toBe("ambar");
    expect(s.puntos.find((p) => p.color === "ambar")!.texto).toContain("en 10 días");

    const vencido = organizacion({ certificate: { has_certificate: true, expires_at: "2026-09-01T00:00:00Z" } });
    expect(semaforoDeOrganizacion(vencido, "produccion", AHORA).color).toBe("rojo");
  });

  /* Los pasos pendientes se dicen en palabras de persona, no con el código de FacturAPI. */
  it("los pasos pendientes se traducen", () => {
    const org = organizacion({
      is_production_ready: false,
      pending_steps: [{ type: "manifiesto", description: "Firma el manifiesto" }],
    });
    const textos = semaforoDeOrganizacion(org, "produccion", AHORA).puntos.map((p) => p.texto);
    expect(textos.some((t) => t.includes("manifiesto de FacturAPI"))).toBe(true);
  });
});

// --- Lo que reporta el Hub ----------------------------------------------------------------

describe("el estado que reporta el Hub", () => {
  /*
   * Si una versión del Hub metiera la llave dentro de su estado, Central no la
   * pintaría: se lee campo a campo y la terminación se corta a cuatro.
   */
  it("solo se queda con los campos del contrato, y la terminación con cuatro caracteres", () => {
    const estado = leerEstadoSecretos({
      facturapi: { configurada: true, modo: "produccion", termina_en: LIVE, llave: LIVE, origen: "local" },
      gmail: { configurada: true, contrasena: "abcdabcdabcdabcd", remitente: "r@gmail.com" },
      otra: "cosa",
    })!;
    expect(JSON.stringify(estado)).not.toContain(LIVE);
    expect(JSON.stringify(estado)).not.toContain("abcdabcdabcdabcd");
    expect(estado.facturapi.termina_en).toBe(LIVE.slice(-4));
    expect(estado.facturapi.origen).toBe("local");
    expect(estado.gmail.remitente).toBe("r@gmail.com");
  });

  /* Depositada no es aplicada: la diferencia es un cliente sin factura con todo en verde. */
  it("distingue enviada, recogida, aplicada y rechazada", () => {
    const hace = () => "hace 1 min";
    const base = { sucursal_id: "suc-a", clase: "facturapi" as const, depositado_ts: 1 };
    expect(entregaDeSecreto(undefined, hace)).toBeNull();
    expect(entregaDeSecreto(base, hace)!.color).toBe("ambar");
    expect(entregaDeSecreto({ ...base, entregado_ts: 2 }, hace)!.texto).toContain("todavía no confirma");
    expect(entregaDeSecreto({ ...base, entregado_ts: 2, aplicado_ts: 3 }, hace)!.color).toBe("verde");
    const rechazada = entregaDeSecreto({ ...base, entregado_ts: 2, ultimo_error: "Llave inválida" }, hace)!;
    expect(rechazada.color).toBe("rojo");
    expect(rechazada.texto).toContain("Llave inválida");
  });
});

// --- El store: llave de usuario, envío y buzón --------------------------------------------

let central: StoreCentral;
let id: string;
let parDelHub: ParDeSobre;

beforeEach(async () => {
  central = crearCentralParaPruebas();
  central.clientes = [];
  central.pulsos = [];
  central.facturacion = {};
  central.secretosDeLocales = {};
  await central.generarPares();
  /* Sin nube al dar de alta: así el alta no llama a la red. */
  await central.guardarConfiguracion({ repositorio: "motrae/motrest" });
  id = (await central.alta({ nombre: "Rodizio", sufijo: "Centro", contacto: "Dueño", plan: "mensual", cuota: pesos(1_500) }))
    .cliente!.id;
  await central.guardarConfiguracion({
    repositorio: "motrae/motrest",
    nube_url: "https://nube.test",
    nube_servicio: "servicio123",
  });
  parDelHub = await generarParDeSobre();
});

/** Lo que el local publicó en su pulso: la llave con la que se le cierran sobres. */
function localCon15_5() {
  central.secretosDeLocales = { [id]: { llave_publica: parDelHub.publica } };
}

interface Llamada {
  url: string;
  metodo: string;
  cuerpo?: string;
  autorizacion?: string;
}

/**
 * Un FacturAPI y una nube de mentira. Se anota cada llamada para poder decir
 * después qué se pidió, a quién y con qué.
 */
function dobles(opciones: { depositoFalla?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  global.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    llamadas.push({
      url,
      metodo,
      ...(typeof init.body === "string" ? { cuerpo: init.body } : {}),
      ...(headers.authorization ? { autorizacion: headers.authorization } : {}),
    });

    if (url.startsWith("https://www.facturapi.io/v2/organizations?")) {
      return respuesta(200, { page: 1, total_pages: 1, data: [orgDeFacturapi()] });
    }
    if (url === `https://www.facturapi.io/v2/organizations/${ORG}/apikeys/live` && metodo === "PUT") {
      return respuesta(200, JSON.stringify(LIVE));
    }
    if (url === `https://www.facturapi.io/v2/organizations/${ORG}/apikeys/live` && metodo === "GET") {
      return respuesta(200, [
        { id: "llave-vieja", first_12: "sk_live_OTRA", created_at: "2026-01-01T00:00:00Z" },
        { id: "llave-nueva", first_12: LIVE.slice(0, 12), created_at: "2026-09-19T12:00:00Z" },
      ]);
    }
    if (url === `https://www.facturapi.io/v2/organizations/${ORG}/apikeys/test`) {
      return respuesta(200, JSON.stringify(TEST));
    }
    if (url.startsWith(`https://www.facturapi.io/v2/organizations/${ORG}/apikeys/live/`) && metodo === "DELETE") {
      return respuesta(200, []);
    }
    if (url.startsWith("https://nube.test/rest/v1/secretos_pendientes") && metodo === "POST") {
      return opciones.depositoFalla ? respuesta(500, "caída") : respuesta(201);
    }
    return respuesta(404, "no esperada");
  }) as unknown as typeof fetch;
  return llamadas;
}

function sobreDepositado(llamadas: Llamada[]) {
  const deposito = llamadas.find((l) => l.url.includes("/rest/v1/secretos_pendientes") && l.metodo === "POST");
  return deposito ? { llamada: deposito, fila: JSON.parse(deposito.cuerpo!) } : null;
}

describe("la llave de usuario de FacturAPI", () => {
  /* Una llave de un restaurante pegada aquí funcionaría a medias y fallaría lejos. */
  it("solo acepta una llave de usuario, no la de un restaurante", async () => {
    expect((await central.guardarLlaveFacturapi(LIVE)).ok).toBe(false);
    expect((await central.guardarLlaveFacturapi(USUARIO)).ok).toBe(true);
    expect(central.puedeUsarFacturapi).toBe(true);
  });

  /* Abre las organizaciones de toda la cartera: ni en la vista ni en el respaldo. */
  it("nunca sale en la vista pública ni en el respaldo de la cartera", async () => {
    await central.guardarLlaveFacturapi(USUARIO);
    expect(JSON.stringify(central.secretos)).not.toContain(USUARIO);
    expect(central.secretos.facturapi?.termina_en).toBe(USUARIO.slice(-4));
    expect(central.exportar()).not.toContain(USUARIO);
  });

  it("vacía, se quita", async () => {
    await central.guardarLlaveFacturapi(USUARIO);
    expect((await central.guardarLlaveFacturapi("")).ok).toBe(true);
    expect(central.puedeUsarFacturapi).toBe(false);
    expect(central.secretos.facturapi).toBeUndefined();
  });

  it("va a FacturAPI como Bearer y trae la lista de organizaciones", async () => {
    await central.guardarLlaveFacturapi(USUARIO);
    const llamadas = dobles();
    const r = await central.listarOrganizaciones();
    expect(r.ok).toBe(true);
    expect(central.organizaciones?.[0]?.rfc).toBe("ROD010101AB1");
    expect(llamadas[0]!.url).toBe("https://www.facturapi.io/v2/organizations?limit=100&page=1");
    expect(llamadas[0]!.autorizacion).toBe(`Bearer ${USUARIO}`);
  });
});

describe("los pulsos traen la llave pública y el estado de los secretos", () => {
  it("se leen aparte del pulso, y una llave mal formada no cuenta", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      respuesta(200, [
        {
          sucursal_id: id,
          ts: "2026-09-19T12:00:00Z",
          version: "1.5.5",
          llave_publica: parDelHub.publica,
          secretos: { facturapi: { configurada: true, modo: "pruebas", termina_en: "Hh8" } },
        },
        { sucursal_id: "suc-otro", ts: "2026-09-19T12:00:00Z", version: "1.5.4", llave_publica: "corta" },
      ]),
    );
    expect((await central.traerPulsos()).ok).toBe(true);
    expect(central.secretosDe(id).llave_publica).toBe(parDelHub.publica);
    expect(central.secretosDe(id).estado?.facturapi.modo).toBe("pruebas");
    expect(central.secretosDe("suc-otro").llave_publica).toBeUndefined();
    /* No entra en el pulso: el pulso se copia al historial y esto no es historia. */
    expect(central.pulsoDe(id)).not.toHaveProperty("llave_publica");
  });
});

describe("enviar la llave de FacturAPI al restaurante", () => {
  beforeEach(async () => {
    await central.guardarLlaveFacturapi(USUARIO);
    central.elegirOrganizacion(id, { id: ORG, nombre: "Rodizio" });
  });

  /*
   * EL CASO QUE IMPORTA: la llave sale de FacturAPI, se cierra para ESE Hub y
   * solo ese Hub la abre. La nube no la ve en claro.
   */
  it("en producción crea una Live exclusiva y solo el Hub del local la abre", async () => {
    localCon15_5();
    central.fijarModoFacturapi(id, "produccion");
    const llamadas = dobles();

    const r = await central.enviarFacturapi(id, AHORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.termina_en).toBe(LIVE.slice(-4));

    expect(llamadas.some((l) => l.metodo === "PUT" && l.url.endsWith("/apikeys/live"))).toBe(true);
    const deposito = sobreDepositado(llamadas)!;
    expect(deposito.llamada.url).toBe("https://nube.test/rest/v1/secretos_pendientes?on_conflict=sucursal_id,clase");
    expect(deposito.llamada.cuerpo).not.toContain(LIVE);
    expect(deposito.fila).toMatchObject({
      sucursal_id: id,
      clase: "facturapi",
      entregado_ts: null,
      aplicado_ts: null,
      ultimo_error: null,
    });

    const claro = await abrirSobre(deposito.fila.sobre, parDelHub);
    const secreto = JSON.parse(claro!) as SecretoFacturapi;
    expect(secreto).toMatchObject({
      clase: "facturapi",
      sucursal_id: id,
      llave: LIVE,
      modo: "produccion",
      origen: "central",
      emitido_ts: AHORA,
      organizacion_id: ORG,
      organizacion_nombre: "Rodizio",
    });

    /* Otro Hub no lo abre. */
    expect(await abrirSobre(deposito.fila.sobre, await generarParDeSobre())).toBeNull();

    /* Se recuerda el id de la llave para poder revocarla sola; nunca la llave. */
    expect(central.facturacionDe(id).llaves_live).toEqual([{ id: "llave-nueva", creada_ts: AHORA }]);
    expect(central.duenoDeLlaveLive("llave-nueva")).toEqual({ sucursal_id: id, vigente: true });
    expect(central.exportar()).not.toContain(LIVE);
    expect(JSON.stringify(central.facturacion)).not.toContain(LIVE);
    expect(JSON.stringify(central.secretos)).not.toContain(LIVE);
  });

  it("en pruebas manda la Test de la organización y no crea nada", async () => {
    localCon15_5();
    const llamadas = dobles();
    const r = await central.enviarFacturapi(id, AHORA);
    expect(r.ok).toBe(true);
    expect(llamadas.some((l) => l.metodo === "PUT")).toBe(false);
    const secreto = JSON.parse((await abrirSobre(sobreDepositado(llamadas)!.fila.sobre, parDelHub))!);
    expect(secreto).toMatchObject({ llave: TEST, modo: "pruebas" });
  });

  /*
   * Un Hub anterior a la 1.5.5 no sabe abrir sobres. Se dice ANTES de pedir
   * nada: crear una Live que no puede llegar es dejar una llave suelta.
   */
  it("sin llave pública lo dice en claro y no le pide nada a FacturAPI", async () => {
    central.fijarModoFacturapi(id, "produccion");
    const llamadas = dobles();
    const r = await central.enviarFacturapi(id, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(SIN_LLAVE_PUBLICA);
    expect(llamadas).toHaveLength(0);
  });

  /* Una llave que no llegó a nadie no tiene por qué seguir existiendo. */
  it("si la nube no acepta el sobre, revoca la Live que acaba de crear", async () => {
    localCon15_5();
    central.fijarModoFacturapi(id, "produccion");
    const llamadas = dobles({ depositoFalla: true });
    const r = await central.enviarFacturapi(id, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya se revocó");
    expect(
      llamadas.some((l) => l.metodo === "DELETE" && l.url.endsWith(`/apikeys/live/llave-nueva`)),
    ).toBe(true);
    expect(central.facturacionDe(id).llaves_live).toBeUndefined();
  });

  /* Dos clics seguidos no pueden crear dos llaves de facturación. */
  it("un doble clic solo crea una llave", async () => {
    localCon15_5();
    central.fijarModoFacturapi(id, "produccion");
    const llamadas = dobles();
    const [a, b] = await Promise.all([central.enviarFacturapi(id, AHORA), central.enviarFacturapi(id, AHORA)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(1);
  });

  it("sin organización elegida no envía", async () => {
    localCon15_5();
    central.elegirOrganizacion(id, null);
    const r = await central.enviarFacturapi(id, AHORA);
    expect(r.ok).toBe(false);
  });
});

describe("enviar la contraseña de Gmail al restaurante", () => {
  it("se normaliza, se cierra para su Hub y no se queda en Central", async () => {
    localCon15_5();
    const llamadas = dobles();
    const r = await central.enviarGmail(id, { contrasena: "ABCD efgh IJKL mnop", remitente: "rodizio@gmail.com" }, AHORA);
    expect(r.ok).toBe(true);

    const deposito = sobreDepositado(llamadas)!;
    expect(deposito.fila.clase).toBe("gmail");
    const secreto = JSON.parse((await abrirSobre(deposito.fila.sobre, parDelHub))!) as SecretoGmail;
    expect(secreto).toMatchObject({
      clase: "gmail",
      sucursal_id: id,
      contrasena: "abcdefghijklmnop",
      remitente: "rodizio@gmail.com",
      origen: "central",
      emitido_ts: AHORA,
    });
    expect(central.facturacionDe(id).gmail_remitente).toBe("rodizio@gmail.com");
    expect(central.exportar()).not.toContain("abcdefghijklmnop");
  });

  it("una contraseña que no son 16 letras no sale", async () => {
    localCon15_5();
    const llamadas = dobles();
    expect((await central.enviarGmail(id, { contrasena: "mi-contraseña-normal" })).ok).toBe(false);
    expect((await central.enviarGmail(id, { contrasena: "abcdefghijklmnop", remitente: "no es correo" })).ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });
});

describe("el buzón de secretos", () => {
  /* El sobre no se trae de vuelta: Central no lo necesita y es lo único que proteger. */
  it("se lee sin el sobre y se entiende fila a fila", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      respuesta(200, [
        {
          sucursal_id: id,
          clase: "facturapi",
          depositado_ts: "2026-09-19T12:00:00Z",
          entregado_ts: "2026-09-19T12:00:05Z",
          aplicado_ts: null,
          ultimo_error: "La llave no es de esta organización",
        },
        { sucursal_id: id, clase: "otra", depositado_ts: "2026-09-19T12:00:00Z" },
      ]),
    );
    expect((await central.traerSecretosPendientes()).ok).toBe(true);
    const url = String(vi.mocked(global.fetch).mock.calls[0]![0]);
    expect(url).toContain("select=sucursal_id,clase,depositado_ts,entregado_ts,aplicado_ts,ultimo_error");
    expect(url).not.toContain("sobre");
    expect(central.secretosPendientes).toHaveLength(1);
    expect(central.filaSecretoDe(id, "facturapi")?.ultimo_error).toContain("no es de esta organización");
  });
});

describe("la elección de organización viaja con la cartera", () => {
  it("se exporta y se vuelve a importar", () => {
    central.elegirOrganizacion(id, { id: ORG, nombre: "Rodizio" });
    central.fijarModoFacturapi(id, "produccion");
    const copia = central.exportar();
    central.facturacion = {};
    expect(central.importar(copia).ok).toBe(true);
    expect(central.facturacionDe(id)).toMatchObject({ organizacion_id: ORG, modo: "produccion" });
  });
});
