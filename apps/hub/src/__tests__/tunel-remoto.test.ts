/**
 * El túnel de la web contra el Hub REAL (modalidad «ambas», 1.6.0).
 *
 * Un `ClienteSync` de verdad —el del POS— habla con un `Hub` de verdad a través
 * del túnel, sin Supabase: una función hace de canal broadcast. Lo que tiene
 * que quedar garantizado:
 * - la web sincroniza igual que una tableta del salón;
 * - entra aprobada la primera vez, anotada como «Web», y si se revoca se queda
 *   fuera;
 * - con otra clave remota no pasa ni el saludo;
 * - hay un tope de sesiones y se pueden cortar todas de golpe.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventoBase } from "@motrest/dominio";
import {
  ClienteSync,
  ExtremoTunel,
  almacenEnMemoria,
  derivarClaves,
  esControl,
  generarClaveLocal,
  nuevaSesionTunel,
  type SobreTunel,
  type SocketLike,
} from "@motrest/protocolo-sync";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { Hub } from "../servidor.js";
import { TunelRemoto } from "../tunel-remoto.js";

const SUC = "suc-rodizio";

let log: LogHub;
let hub: Hub;
let tunel: TunelRemoto;
/** Los navegadores conectados, por id de sesión: el «broadcast» los reparte. */
let navegadores: Map<string, (s: SobreTunel) => void>;

async function montar(claveRemota: string, maximo?: number) {
  navegadores = new Map();
  tunel = new TunelRemoto({
    hub,
    claves: await derivarClaves(claveRemota, "hub"),
    enviar: (s) => queueMicrotask(() => navegadores.get(s.s)?.(s)),
    ...(maximo ? { maximo } : {}),
  });
}

/** El `SocketTunel` del POS sin Supabase. */
class SocketPorTunel implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  extremo: ExtremoTunel;
  motivo = "";
  private abierto = false;

  constructor() {
    const sesion = nuevaSesionTunel();
    this.extremo = new ExtremoTunel(sesion, "c", (s) => queueMicrotask(() => tunel.recibir(s)));
    this.extremo.alMensaje = (t) => this.onmessage?.({ data: t });
    this.extremo.alCerrar = (m) => {
      this.motivo = m;
      this.onclose?.();
    };
    navegadores.set(sesion, (s) => {
      if (esControl(s) && s.k === "abierta") {
        if (!this.abierto) {
          this.abierto = true;
          this.onopen?.();
        }
        return;
      }
      this.extremo.recibir(s);
    });
    queueMicrotask(() => this.extremo.control("abrir"));
  }
  send(d: string) {
    this.extremo.enviar(d);
  }
  close() {
    this.extremo.cerrar("cerrado por la prueba");
  }
}

function navegador(clave: string, device = "web-telefono") {
  const almacen = almacenEnMemoria();
  let socket: SocketPorTunel | null = null;
  const errores: string[] = [];
  const cliente = new ClienteSync({
    url: "tunel://RODIZIO",
    device_id: device,
    sucursal_id: SUC,
    clave,
    almacen,
    crearSocket: () => (socket = new SocketPorTunel()),
    alCambiarEstado: (_e, detalle) => detalle && errores.push(detalle),
    latidoOutbox: 60_000,
    reintentoBase: 60_000,
  });
  return { cliente, almacen, errores, socket: () => socket };
}

const esperar = async (condicion: () => boolean, ms = 3000) => {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error("La condición nunca se cumplió");
    await new Promise((r) => setTimeout(r, 10));
  }
};

let orden = 0;
function evento(device: string): EventoBase {
  orden += 1;
  return {
    id: `evt-${orden}`,
    tipo: "orden_creada",
    ts: Date.now(),
    stream_id: "ord-1",
    device_id: device,
    sucursal_id: SUC,
    empleado_id: "usr-1",
    orden_local: orden,
    orden_id: "ord-1",
    mesa_id: "mesa-1",
  } as unknown as EventoBase;
}

beforeEach(() => {
  log = new LogHub(":memory:");
  /*
   * Con aprobación EXIGIDA, como en un local real. Y una terminal del salón
   * ya registrada, para que la web no sea «la primera del local» (esa se
   * aprueba sola por otro motivo y taparía lo que se prueba).
   */
  hub = new Hub({ hub_id: "hub-prueba", log, exigirAprobacion: true });
  log.registrarDispositivo("caja-del-salon", "");
  log.aprobarDispositivo("caja-del-salon");
});

afterEach(() => log.cerrar());

describe("el túnel de la web contra el Hub", () => {
  it("la web sincroniza por el túnel y lo suyo llega al log del Hub", async () => {
    const clave = generarClaveLocal();
    await montar(clave);
    const web = navegador(clave);
    await web.cliente.conectar();
    await esperar(() => web.cliente.estado === "sincronizado");

    await web.almacen.eventos.anexar([evento("web-telefono")]);
    await web.cliente.empujar();
    await esperar(() => log.seqActual === 1);
    expect(tunel.abiertas).toBe(1);
    expect(hub.sesionesRemotas()).toBe(1);
  });

  it("entra aprobada la primera vez y queda anotada como «Web»", async () => {
    const clave = generarClaveLocal();
    await montar(clave);
    const web = navegador(clave);
    await web.cliente.conectar();
    await esperar(() => web.cliente.estado === "sincronizado");

    const dispositivo = log.dispositivo("web-telefono")!;
    expect(dispositivo.aprobado).toBe(true);
    expect(dispositivo.nombre).toBe("Web");
  });

  it("si se revoca, la web se queda fuera aunque tenga la contraseña", async () => {
    const clave = generarClaveLocal();
    await montar(clave);
    const primera = navegador(clave);
    await primera.cliente.conectar();
    await esperar(() => primera.cliente.estado === "sincronizado");
    primera.cliente.desconectar();

    log.revocarDispositivo("web-telefono");
    expect(log.dispositivo("web-telefono")!.aprobado).toBe(false);

    const otra = navegador(clave);
    await otra.cliente.conectar();
    await esperar(() => otra.errores.some((e) => /autorizado/.test(e)));
    expect(otra.cliente.estado).not.toBe("sincronizado");
  });

  it("con otra clave remota no pasa ni el saludo, y la sesión se cierra", async () => {
    await montar(generarClaveLocal());
    const intruso = navegador(generarClaveLocal(), "intruso");
    await intruso.cliente.conectar();
    // Tres mensajes ilegibles y fuera: el saludo, y los reintentos del outbox.
    for (let i = 0; i < 3; i++) intruso.socket()?.send('{"ec":1,"n":"x","c":"y"}');
    await esperar(() => tunel.abiertas === 0 && intruso.socket()?.extremo.abierto === false);
    expect(log.dispositivo("intruso")).toBeNull();
  });

  it("hay un tope de sesiones web", async () => {
    const clave = generarClaveLocal();
    await montar(clave, 2);
    const a = navegador(clave, "web-a");
    const b = navegador(clave, "web-b");
    const c = navegador(clave, "web-c");
    await Promise.all([a.cliente.conectar(), b.cliente.conectar()]);
    await esperar(() => tunel.abiertas === 2);
    await c.cliente.conectar();
    await esperar(() => /demasiadas/.test(c.socket()?.motivo ?? ""));
    expect(tunel.abiertas).toBe(2);
  });

  it("cambiar la contraseña corta todas las sesiones", async () => {
    const clave = generarClaveLocal();
    await montar(clave);
    const web = navegador(clave);
    await web.cliente.conectar();
    await esperar(() => web.cliente.estado === "sincronizado");

    tunel.cerrarTodas("La contraseña del restaurante cambió. Vuelve a entrar.");
    await esperar(() => /contraseña/.test(web.socket()?.motivo ?? ""));
    expect(tunel.abiertas).toBe(0);
    expect(hub.sesionesRemotas()).toBe(0);
  });
});
