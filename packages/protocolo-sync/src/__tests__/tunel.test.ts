/**
 * El túnel por Supabase Realtime, sin Supabase: dos `ExtremoTunel` unidos por
 * una función que hace de canal. Lo que se prueba es lo que el WebSocket daba
 * gratis y aquí se hace a mano —tamaño, orden y saber si el otro sigue vivo—, y
 * que un fragmento perdido cierre la sesión en vez de colgarla.
 */
import { describe, expect, it } from "vitest";
import {
  ESPERA_HUECO_MS,
  ExtremoTunel,
  Reensamblador,
  SILENCIO_MAXIMO_MS,
  TAMANO_FRAGMENTO,
  esSobreTunel,
  fragmentar,
  nuevaSesionTunel,
  type FragmentoTunel,
  type SobreTunel,
} from "../tunel.js";
import { cifrar, derivarClaves, descifrar, generarClaveLocal } from "../cifrado.js";

const SESION = "sesion-de-prueba-1";

function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
}

describe("fragmentar y reensamblar", () => {
  it("un mensaje de más de 1 MB sale en trozos y vuelve entero", () => {
    const texto = "x".repeat(1_250_000) + "fin";
    const trozos = fragmentar(SESION, "h", 0, texto);
    expect(trozos.length).toBe(Math.ceil(texto.length / TAMANO_FRAGMENTO));
    expect(trozos.every((t) => t.x.length <= TAMANO_FRAGMENTO && esSobreTunel(t))).toBe(true);

    const r = new Reensamblador();
    const salida = trozos.flatMap((t) => r.agregar(t));
    expect(salida).toEqual([texto]);
  });

  it("fragmentos desordenados y mensajes desordenados salen en orden", () => {
    const a = fragmentar(SESION, "h", 0, "primero-abc", 4);
    const b = fragmentar(SESION, "h", 1, "segundo-defg", 4);
    const c = fragmentar(SESION, "h", 2, "", 4);
    const revuelto: FragmentoTunel[] = [...c, b[2]!, a[1]!, b[0]!, a[2]!, b[1]!, a[0]!];

    const r = new Reensamblador();
    const salida = revuelto.flatMap((t) => r.agregar(t));
    expect(salida).toEqual(["primero-abc", "segundo-defg", ""]);
  });

  it("un fragmento repetido no duplica el mensaje", () => {
    const trozos = fragmentar(SESION, "c", 0, "hola", 2);
    const r = new Reensamblador();
    expect([...r.agregar(trozos[0]!), ...r.agregar(trozos[0]!), ...r.agregar(trozos[1]!)]).toEqual(["hola"]);
    expect(r.agregar(trozos[1]!)).toEqual([]);
  });

  it("un hueco que no se llena rompe la sesión", () => {
    const t = reloj();
    const r = new Reensamblador(t.ahora);
    r.agregar(fragmentar(SESION, "h", 1, "el segundo sin el primero")[0]!);
    r.revisar();
    expect(r.roto).toBeNull();
    t.avanzar(ESPERA_HUECO_MS + 1);
    r.revisar();
    expect(r.roto).not.toBeNull();
  });

  it("rechaza sobres con forma rara", () => {
    expect(esSobreTunel({ s: "x", d: "c", k: "abrir" })).toBe(false); // id muy corto
    expect(esSobreTunel({ s: SESION, d: "z", k: "abrir" })).toBe(false);
    expect(esSobreTunel({ s: SESION, d: "c", k: "otra" })).toBe(false);
    expect(esSobreTunel({ s: SESION, d: "c", m: 0, i: 2, t: 2, x: "" })).toBe(false);
    expect(esSobreTunel({ s: SESION, d: "c", m: 0, i: 0, t: 1, x: "a".repeat(TAMANO_FRAGMENTO + 1) })).toBe(false);
    expect(esSobreTunel({ s: SESION, d: "c", k: "latido" })).toBe(true);
  });

  it("los ids de sesión son únicos y pasan la validación", () => {
    const ids = new Set(Array.from({ length: 100 }, () => nuevaSesionTunel()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(esSobreTunel({ s: id, d: "c", k: "abrir" })).toBe(true);
  });
});

describe("dos extremos unidos", () => {
  function par(perder?: (s: SobreTunel) => boolean) {
    const t = reloj();
    const navegador: ExtremoTunel = new ExtremoTunel(SESION, "c", (s) => !perder?.(s) && hub.recibir(s), t.ahora);
    const hub: ExtremoTunel = new ExtremoTunel(SESION, "h", (s) => !perder?.(s) && navegador.recibir(s), t.ahora);
    return { navegador, hub, t };
  }

  it("el protocolo cifrado pasa de ida y vuelta sin enterarse", async () => {
    const clave = generarClaveLocal();
    const cliente = await derivarClaves(clave, "cliente");
    const servidor = await derivarClaves(clave, "hub");
    const { navegador, hub } = par();

    const recibidoHub: unknown[] = [];
    const recibidoNav: unknown[] = [];
    const pendientes: Promise<void>[] = [];
    hub.alMensaje = (x) => pendientes.push(descifrar(servidor.recepcion, x).then((m) => void recibidoHub.push(m)));
    navegador.alMensaje = (x) => pendientes.push(descifrar(cliente.recepcion, x).then((m) => void recibidoNav.push(m)));

    navegador.enviar(await cifrar(cliente.envio, { tipo: "hola", v: 1 }));
    hub.enviar(await cifrar(servidor.envio, { tipo: "eventos", eventos: Array(3000).fill({ relleno: "y".repeat(100) }) }));
    await Promise.all(pendientes);

    expect(recibidoHub).toEqual([{ tipo: "hola", v: 1 }]);
    expect((recibidoNav[0] as { eventos: unknown[] }).eventos).toHaveLength(3000);
  });

  it("cerrar de un lado cierra el otro con el motivo", () => {
    const { navegador, hub } = par();
    let motivo = "";
    navegador.alCerrar = (m) => (motivo = m);
    hub.cerrar("La contraseña del restaurante cambió");
    expect(navegador.abierto).toBe(false);
    expect(motivo).toBe("La contraseña del restaurante cambió");
  });

  it("si el otro lado calla, la sesión muere sola", () => {
    const { navegador, t } = par(() => true); // se pierde todo
    let cerrado = false;
    navegador.alCerrar = () => (cerrado = true);
    navegador.latir();
    expect(cerrado).toBe(false);
    t.avanzar(SILENCIO_MAXIMO_MS + 1);
    navegador.latir();
    expect(cerrado).toBe(true);
  });

  it("los latidos mantienen viva una sesión en silencio", () => {
    const { navegador, hub, t } = par();
    for (let i = 0; i < 10; i++) {
      t.avanzar(15_000);
      navegador.latir();
      hub.latir();
    }
    expect(navegador.abierto && hub.abierto).toBe(true);
  });

  it("un fragmento perdido cierra la sesión en vez de colgarla", () => {
    let contador = 0;
    const { navegador, hub, t } = par((s) => "x" in s && ++contador === 2);
    let motivo = "";
    hub.alCerrar = (m) => (motivo = m);
    navegador.enviar("a".repeat(TAMANO_FRAGMENTO * 3));
    navegador.enviar("despues");
    t.avanzar(ESPERA_HUECO_MS + 1);
    hub.latir();
    expect(hub.abierto).toBe(false);
    expect(motivo).toMatch(/perdió/);
  });

  it("ignora sobres de otra sesión o de su propio sentido", () => {
    const { hub } = par();
    const vistos: string[] = [];
    hub.alMensaje = (x) => vistos.push(x);
    hub.recibir({ s: "otra-sesion-xyz", d: "c", m: 0, i: 0, t: 1, x: "ajeno" });
    hub.recibir({ s: SESION, d: "h", m: 0, i: 0, t: 1, x: "eco" });
    expect(vistos).toEqual([]);
  });
});
