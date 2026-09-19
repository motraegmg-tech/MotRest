/**
 * Los correos que se piden desde una terminal, de ida y vuelta por el registro.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. De los seis correos del catálogo solo salía la
 * confirmación de reserva; los otros cinco no tenían manera de pedirse. Ahora la
 * terminal anota `correo_solicitado`, el Hub lo manda y anota el resultado, y el
 * resultado vuelve a todas las terminales atado por `solicitud_id`.
 *
 * QUÉ SE PRUEBA Y CÓMO. Contra el Hub REAL (`servidor.ts`), un log SQLite real
 * en memoria y la clase `Correo` real —con un proveedor de mentira en lugar de
 * Resend—. La lógica vive en `solicitudes-de-correo.ts` precisamente para poder
 * probarla así: `main.ts` no se puede importar sin arrancar el Hub entero. Lo
 * único que `main.ts` pone es el cable, y ese se comprueba al final leyéndolo
 * como texto, igual que en `enlace-al-instalar-licencia.test.ts`.
 *
 * Lo que más pesa aquí es NO MANDAR DOS VECES: el mismo cupón dos veces en el
 * buzón de un comensal es lo que acaba en «reportar spam», y eso mancha la
 * cuenta del restaurante para todo, incluidas las confirmaciones de reserva.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FabricaEventos,
  estadosDeCorreo,
  streamClientes,
  streamCorreo,
  type ConfiguracionCorreo,
  type EventoBase,
  type EventoCliente,
  type EventoCorreo,
  type SoloDatos,
} from "@motrest/dominio";
import { VERSION_PROTOCOLO, type MensajeHub } from "@motrest/protocolo-sync";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "../servidor.js";
import { Correo } from "../correo.js";
import {
  EMPLEADO_DEL_HUB,
  SolicitudesDeCorreo,
  type SolicitudDeCorreo,
} from "../solicitudes-de-correo.js";

const SUC = "suc-rodizio";
const HORA = 60 * 60 * 1000;
const COMENSAL = "comensal@correo.mx";

/** Sin `modo`, sale por Resend: así el proveedor de mentira es un `fetch`. */
const CONFIG: ConfiguracionCorreo = {
  remitente: "Rodizio <reservas@rodizio.mx>",
  local: "Rodizio",
  activos: { gracias: true, cupon: true, reserva_confirmada: true },
};

/**
 * Resend de mentira. Cuenta a quién le llegó de verdad cada correo, que es lo
 * único que el comensal ve, y deja cortar la red cuando haga falta.
 */
class Proveedor {
  entregados: string[] = [];
  hayRed = true;

  llamar = (async (_url: string, init: RequestInit) => {
    if (!this.hayRed) throw new Error("getaddrinfo ENOTFOUND api.resend.com");
    const cuerpo = JSON.parse(init.body as string) as { to: string[] };
    this.entregados.push(cuerpo.to[0]!);
    return new Response(JSON.stringify({ id: `email-${this.entregados.length}` }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

/** Conexión de mentira: guarda lo que el Hub le manda a la terminal. */
class ConexionPrueba implements Conexion {
  recibidos: MensajeHub[] = [];
  constructor(public id: string) {}
  enviar(mensaje: MensajeHub): void {
    this.recibidos.push(mensaje);
  }
  cerrar(): void {}
  /** Todos los eventos que le llegaron, de todos los mensajes. */
  eventos(): EventoBase[] {
    return this.recibidos.flatMap((m) => (m.tipo === "eventos" ? m.eventos : []));
  }
}

let log: LogHub;
let hub: Hub;
let proveedor: Proveedor;
let llave: string;
let correo: Correo | null;
let solicitudes: SolicitudesDeCorreo;
let bitacora: string[];
let reloj: () => number;

beforeEach(() => {
  log = new LogHub(":memory:");
  proveedor = new Proveedor();
  llave = "re_llave_de_prueba";
  bitacora = [];
  reloj = Date.now;
  const registrar = (nivel: string, texto: string) => bitacora.push(`${nivel}: ${texto}`);

  correo = new Correo(() => CONFIG, () => llave, registrar, Date.now, proveedor.llamar);
  // Las dependencias, igual que en `main.ts`: funciones que se leen al usarse.
  solicitudes = new SolicitudesDeCorreo({
    hubId: "hub-prueba",
    correo: () => correo,
    leerStream: (stream) => log.leerStream(stream),
    inyectar: (eventos) => hub.inyectar(eventos),
    registrar,
    ahora: () => reloj(),
  });
  hub = new Hub({
    hub_id: "hub-prueba",
    log,
    exigirAprobacion: false,
    alIngerir: (eventos) => solicitudes.atender(eventos),
  });
});

afterEach(async () => {
  await solicitudes.enCalma();
  log.cerrar();
});

/** La caja, conectada y saludada. */
function caja(): ConexionPrueba {
  const cx = new ConexionPrueba("cx-caja");
  hub.conectar(cx);
  hub.recibir(cx.id, {
    tipo: "hola",
    v: VERSION_PROTOCOLO,
    device_id: "dev-caja",
    sucursal_id: SUC,
    desde_seq: 0,
  });
  return cx;
}

function empujar(cx: ConexionPrueba, eventos: EventoBase[]): void {
  hub.recibir(cx.id, { tipo: "push", eventos });
}

const fabricaCorreo = new FabricaEventos<EventoCorreo>({
  device_id: "dev-caja",
  empleado_id: "usr-lucia",
  sucursal_id: SUC,
});
const fabricaClientes = new FabricaEventos<EventoCliente>({
  device_id: "dev-caja",
  empleado_id: "usr-lucia",
  sucursal_id: SUC,
});

/** Una petición de correo tal como la anota la terminal. */
function peticion(
  cambios: Partial<SoloDatos<SolicitudDeCorreo>> = {},
): SolicitudDeCorreo {
  return fabricaCorreo.crear("correo_solicitado", streamCorreo(SUC), {
    solicitud_id: "sol-1",
    clase_correo: "gracias",
    correo: COMENSAL,
    datos: { nombre: "Ramírez" },
    acepta_marketing: false,
    ...cambios,
  }) as SolicitudDeCorreo;
}

/** Lo que el Hub contestó, sin las peticiones. */
async function respuestas(): Promise<EventoCorreo[]> {
  const eventos = (await log.leerStream(streamCorreo(SUC))) as unknown as EventoCorreo[];
  return eventos.filter((e) => e.tipo !== "correo_solicitado");
}

async function estadoDe(solicitudId: string) {
  const eventos = (await log.leerStream(streamCorreo(SUC))) as unknown as EventoCorreo[];
  return estadosDeCorreo(eventos).get(solicitudId);
}

// --- Ida y vuelta -------------------------------------------------------------------------------

describe("una petición de correo, de ida y vuelta por el registro", () => {
  it("sale, y deja un correo_enviado atado a su solicitud_id que vuelve a la terminal", async () => {
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toEqual([COMENSAL]);

    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: "correo_enviado",
      solicitud_id: "sol-1",
      correo: COMENSAL,
      clase_correo: "gracias",
      externo_id: "email-1",
      sucursal_id: SUC,
      stream_id: streamCorreo(SUC),
      device_id: "hub-prueba",
      empleado_id: EMPLEADO_DEL_HUB,
    });

    // La vuelta: la terminal que lo pidió recibe el resultado sin preguntar.
    expect(cx.eventos().some((e) => e.tipo === "correo_enviado")).toBe(true);
    expect((await estadoDe("sol-1"))?.estado).toBe("enviado");
  });

  it("lo firma el Hub como «sistema», y entra aunque «sistema» no esté en el padrón", async () => {
    /*
     * El precedente que obliga a comprobarlo: un `caja_cerrada` firmado como
     * `sistema` se rechazó en bucle durante meses porque el Hub buscó al
     * firmante en el padrón. Aquí el padrón está cargado y vacío —nadie, ni
     * «sistema», está dado de alta— y el resultado entra igual: va por
     * `inyectar`, que no revalida, y los eventos de correo no exigen permiso.
     */
    hub.cargarIdentidad(SUC, []);
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]!.empleado_id).toBe("sistema");
    expect(bitacora.join("\n")).not.toContain("Permiso denegado");
  });
});

// --- No mandar dos veces ------------------------------------------------------------------------

describe("la misma petición, dos veces, manda UN solo correo", () => {
  it("repetida dentro del mismo lote", async () => {
    // El Hub no puede deduplicar dentro de un lote por el id del evento: los
    // dos pasan la comprobación del registro antes de que se escriba ninguno.
    const cx = caja();
    const p = peticion();
    empujar(cx, [p, p]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(1);
    expect(await respuestas()).toHaveLength(1);
  });

  it("reenviada después por una terminal que reconecta", async () => {
    const cx = caja();
    const p = peticion();
    empujar(cx, [p]);
    await solicitudes.enCalma();

    // La terminal no vio el acuse y reenvía su ventana tal cual.
    empujar(cx, [p]);
    // Y otra tableta reemite la misma petición con otro id de evento.
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(1);
    expect(await respuestas()).toHaveLength(1);
    expect(bitacora.join("\n")).toContain("ya estaba atendida");
  });

  it("aunque vuelva a entrar mientras la primera espera internet en la cola", async () => {
    /*
     * El hueco que el registro no cubre: la primera está en la cola, sin
     * resultado anotado, y la misma petición vuelve a entrar. Sin el candado en
     * memoria saldría a la cola una segunda copia, y al volver la red el
     * comensal recibiría las dos.
     */
    proveedor.hayRed = false;
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();
    expect(await respuestas()).toHaveLength(0);

    empujar(cx, [peticion()]);
    solicitudes.atender([peticion()]);
    await solicitudes.enCalma();
    expect(correo!.pendientes).toBe(1);

    proveedor.hayRed = true;
    await correo!.vaciarCola();
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(1);
    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "correo_enviado", solicitud_id: "sol-1" });
  });

  it("y tampoco al retomar lo pendiente después de reiniciar el Hub", async () => {
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    // El Hub arranca otra vez y repasa el stream: esa ya tiene respuesta.
    const retomadas = solicitudes.retomar(await log.leerStream(streamCorreo(SUC)));
    await solicitudes.enCalma();

    expect(retomadas).toBe(0);
    expect(proveedor.entregados).toHaveLength(1);
  });
});

// --- El consentimiento lo decide la ficha --------------------------------------------------------

describe("la publicidad la autoriza la ficha del comensal, no la tableta", () => {
  function alta(cliente_id: string, acepta?: boolean): EventoCliente {
    return fabricaClientes.crear("cliente_registrado", streamClientes(SUC), {
      cliente_id,
      datos: {
        nombre: "Ana Ramírez",
        correo: COMENSAL,
        ...(acepta === undefined
          ? {}
          : { acepta_promociones: acepta, acepta_promociones_ts: Date.now() }),
      },
    });
  }

  function cambio(cliente_id: string, acepta: boolean): EventoCliente {
    return fabricaClientes.crear("cliente_actualizado", streamClientes(SUC), {
      cliente_id,
      cambios: { acepta_promociones: acepta, acepta_promociones_ts: Date.now() },
    });
  }

  const cupon = (cliente_id: string | undefined, acepta_marketing: boolean) =>
    peticion({
      clase_correo: "cupon",
      datos: { mensaje: "2x1 en pizzas este jueves" },
      acepta_marketing,
      ...(cliente_id ? { cliente_id } : {}),
    });

  it("un cupón se rechaza si la ficha dice que NO, aunque la petición diga que sí", async () => {
    // Aceptó, y después pidió la baja. La tableta —vieja, o manipulada— sigue
    // diciendo que sí. La baja manda.
    const cx = caja();
    empujar(cx, [alta("cli-ana", true), cambio("cli-ana", false)]);
    empujar(cx, [cupon("cli-ana", true)]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "correo_rechazado", solicitud_id: "sol-1" });
    expect((r[0] as { motivo: string }).motivo).toContain("no aceptó recibir promociones");
  });

  it("y si la ficha nunca dijo que sí, tampoco", async () => {
    const cx = caja();
    empujar(cx, [alta("cli-ana"), cupon("cli-ana", true)]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    expect((await respuestas())[0]!.tipo).toBe("correo_rechazado");
  });

  it("una petición que apunta a un cliente que el Hub no conoce no prueba ningún permiso", async () => {
    const cx = caja();
    empujar(cx, [cupon("cli-que-no-existe", true)]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    expect((await respuestas())[0]!.tipo).toBe("correo_rechazado");
  });

  it("con la ficha diciendo que sí, sale", async () => {
    const cx = caja();
    empujar(cx, [alta("cli-ana", true), cupon("cli-ana", false)]);
    await solicitudes.enCalma();

    // La ficha es la autoridad en los dos sentidos: lo que diga la tableta no
    // cuenta cuando hay ficha contra la que comprobar.
    expect(proveedor.entregados).toEqual([COMENSAL]);
  });

  it("sin ficha —un correo tecleado a mano— vale lo que diga la petición", async () => {
    const cx = caja();
    empujar(cx, [cupon(undefined, true)]);
    empujar(cx, [{ ...cupon(undefined, false), solicitud_id: "sol-2" } as EventoBase]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(1);
    expect((await estadoDe("sol-1"))?.estado).toBe("enviado");
    expect((await estadoDe("sol-2"))?.estado).toBe("rechazado");
  });

  it("la baja que llega mientras el cupón espera internet también manda", async () => {
    proveedor.hayRed = false;
    const cx = caja();
    empujar(cx, [alta("cli-ana", true), cupon("cli-ana", true)]);
    await solicitudes.enCalma();
    expect(correo!.pendientes).toBe(1);

    // Contesta BAJA al correo anterior y alguien le quita la marca en la ficha.
    empujar(cx, [cambio("cli-ana", false)]);
    proveedor.hayRed = true;
    await correo!.vaciarCola();

    expect(proveedor.entregados).toHaveLength(0);
    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe("correo_rechazado");
  });
});

// --- Nunca «pendiente» para siempre -------------------------------------------------------------

describe("toda petición recibe respuesta", () => {
  it("sin llave configurada se contesta con correo_rechazado y un motivo claro", async () => {
    llave = "";
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "correo_rechazado", solicitud_id: "sol-1" });
    expect((r[0] as { motivo: string }).motivo).toContain("Falta la llave");
  });

  it("y también si el Hub todavía no tiene el correo preparado", async () => {
    correo = null;
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    const r = await respuestas();
    expect(r[0]).toMatchObject({ tipo: "correo_rechazado", solicitud_id: "sol-1" });
    expect((r[0] as { motivo: string }).motivo).toContain("no tiene listo el correo");
  });

  it("sin internet NO es un rechazo: queda pendiente y se anota cuando sale", async () => {
    // Anotarlo como rechazo sería mentir —sale igual al volver la red— e
    // invitaría a pedirlo otra vez, y entonces llegarían dos.
    proveedor.hayRed = false;
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    expect(await respuestas()).toHaveLength(0);
    expect((await estadoDe("sol-1"))?.estado).toBe("pendiente");

    proveedor.hayRed = true;
    await correo!.vaciarCola();

    expect((await estadoDe("sol-1"))?.estado).toBe("enviado");
    expect(proveedor.entregados).toEqual([COMENSAL]);
  });

  it("una petición que llega horas tarde se contesta como caducada, sin mandarse", async () => {
    // Una tableta que pasó la noche en isla entrega su «gracias por su visita»
    // de ayer. Mandarlo ahora molesta más de lo que sirve.
    reloj = () => Date.now() + 7 * HORA;
    const cx = caja();
    empujar(cx, [peticion()]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    const r = await respuestas();
    expect(r[0]!.tipo).toBe("correo_rechazado");
    expect((r[0] as { motivo: string }).motivo).toContain("horas después");
  });

  it("un tipo de correo que no existe se contesta, no se ignora", async () => {
    const cx = caja();
    empujar(cx, [{ ...peticion(), clase_correo: "boletin" } as EventoBase]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    expect((await respuestas())[0]!.tipo).toBe("correo_rechazado");
  });

  it("al arrancar, retoma las que el Hub dejó sin contestar", async () => {
    // Estaban en la cola en memoria cuando el Hub se reinició para actualizarse:
    // en el registro está la petición y no hay respuesta.
    log.ingerir([peticion({ solicitud_id: "sol-huerfana" })]);

    const retomadas = solicitudes.retomar(await log.leerStream(streamCorreo(SUC)));
    await solicitudes.enCalma();

    expect(retomadas).toBe(1);
    expect(proveedor.entregados).toEqual([COMENSAL]);
    expect((await estadoDe("sol-huerfana"))?.estado).toBe("enviado");
  });

  it("una petición sin solicitud_id se ignora: no habría a qué atar la respuesta", async () => {
    const cx = caja();
    const { solicitud_id: _sinId, ...resto } = peticion();
    empujar(cx, [resto as EventoBase]);
    await solicitudes.enCalma();

    expect(proveedor.entregados).toHaveLength(0);
    expect(bitacora.join("\n")).toContain("sin identificador");
  });
});

// --- Lo que el Hub manda por su cuenta ----------------------------------------------------------

describe("la confirmación de reserva también deja constancia", () => {
  it("se anota sin solicitud_id y no aparece como una petición pendiente", async () => {
    const anotado = solicitudes.anotar(
      { sucursal_id: SUC, correo: COMENSAL, clase_correo: "reserva_confirmada" },
      { enviado: true, externo_id: "email-9" },
    );
    expect(anotado).toBe(true);

    const r = await respuestas();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "correo_enviado", clase_correo: "reserva_confirmada" });
    expect("solicitud_id" in r[0]!).toBe(false);
    // `estadosDeCorreo` solo sigue peticiones: esto no puede inventar una.
    const eventos = (await log.leerStream(streamCorreo(SUC))) as unknown as EventoCorreo[];
    expect(estadosDeCorreo(eventos).size).toBe(0);
  });
});

// --- El cableado, sobre el `main.ts` de verdad ------------------------------------------------

/**
 * Lo que la prueba de arriba no puede demostrar: que `main.ts` llama a todo
 * esto. Se lee como texto porque importarlo arranca el Hub.
 */
const FUENTE = readFileSync(fileURLToPath(new URL("../main.ts", import.meta.url)), "utf8");

function trozo(desde: string, hasta: string): string {
  const inicio = FUENTE.indexOf(desde);
  expect(inicio, `no se encontró en main.ts: ${desde}`).toBeGreaterThan(-1);
  const fin = FUENTE.indexOf(hasta, inicio + desde.length);
  expect(fin, `no se encontró en main.ts: ${hasta}`).toBeGreaterThan(-1);
  return FUENTE.slice(inicio, fin);
}

describe("main.ts conecta las peticiones de correo", () => {
  it("atiende lo que entra al registro, venga de donde venga", () => {
    const opciones = trozo("const hub = new Hub({", "fiscal: {");
    expect(opciones).toContain("solicitudesDeCorreo.atender(eventos)");
  });

  it("con el correo, el registro y el Hub de verdad, leídos al usarse", () => {
    const construccion = trozo("const solicitudesDeCorreo = new SolicitudesDeCorreo({", "});");
    expect(construccion).toContain("correo: () => correo");
    expect(construccion).toContain("hub.inyectar(eventos)");
    expect(construccion).toContain("almacen.log.leerStream(");
  });

  it("la confirmación de reserva anota su resultado, también el que sale de la cola", () => {
    const funcion = trozo("function avisarPorLoQuePaso(", "\n/**");
    expect(funcion).toContain("solicitudesDeCorreo.anotar(destino, r)");
    expect(funcion).toContain("if (!r.encolado)");
    expect(funcion).toContain("alResolverse");
  });

  it("al arrancar retoma lo pendiente, después de preparar el correo", () => {
    const preparar = FUENTE.indexOf("await prepararCorreo();");
    const retomar = FUENTE.indexOf("await retomarCorreosPendientes();");
    expect(preparar).toBeGreaterThan(-1);
    expect(retomar).toBeGreaterThan(preparar);
    const funcion = trozo("async function retomarCorreosPendientes(", "\n/**");
    expect(funcion).toContain("solicitudesDeCorreo.retomar(");
  });
});

// `vi` se importa para que una prueba futura pueda espiar al proveedor sin
// tener que tocar las importaciones; hoy basta con contar entregas.
void vi;
