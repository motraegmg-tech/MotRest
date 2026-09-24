/**
 * Modalidad nube (1.6.0): el «Hub» que corre en el navegador, sin Supabase.
 *
 * Dos `ClienteSync` de verdad —los mismos que usa el POS— hablan con
 * `ServidorNube`, cada uno el suyo, y los dos guardan en la misma «nube» en
 * memoria. Lo que tiene que quedar garantizado:
 * - lo que vende una tableta le llega a la otra, y en orden;
 * - un reintento no duplica nada;
 * - los catálogos y el personal viajan entre dispositivos;
 * - en la nube no queda NADA legible del negocio.
 */
import { describe, expect, it } from "vitest";
import { generarClaveRemota, generarPar, emitirLicencia, type EventoBase } from "@motrest/dominio";
import {
  ClienteSync,
  almacenEnMemoria,
  derivarClaves,
  derivarLlaveDatosNube,
  type Almacen,
  type Catalogo,
  type SocketLike,
} from "@motrest/protocolo-sync";
import {
  ServidorNube,
  versionDeCatalogo,
  type AlmacenNube,
  type FilaDocumentoNube,
  type FilaEventoNube,
  type PulsoNube,
} from "../web/nube/servidor-nube";

const SUC = "suc-la-nube";

/** Lo que haría Supabase: filas en orden, una sola por id, y avisos a todos. */
class NubeEnMemoria implements AlmacenNube {
  filas: FilaEventoNube[] = [];
  docs = new Map<string, { version: bigint; sobre: string }>();
  lic: unknown = null;
  pulsos: PulsoNube[] = [];
  alEvento: (() => void)[] = [];
  alDocumento: ((f: FilaDocumentoNube) => void)[] = [];
  private seq = 0;

  async seqActual() {
    return this.filas.at(-1)?.seq ?? 0;
  }
  async empujar(filas: { id: string; device_id: string; sobre: string }[]) {
    let nuevas = 0;
    for (const f of filas) {
      if (this.filas.some((x) => x.id === f.id)) continue;
      this.filas.push({ ...f, seq: ++this.seq });
      nuevas += 1;
    }
    if (nuevas > 0) queueMicrotask(() => this.alEvento.forEach((o) => o()));
    return filas.map((f) => ({ id: f.id, seq: this.filas.find((x) => x.id === f.id)!.seq }));
  }
  async desde(seq: number, limite: number) {
    return this.filas.filter((f) => f.seq > seq).slice(0, limite);
  }
  async documentos(prefijo: string) {
    return [...this.docs].filter(([l]) => l.startsWith(prefijo)).map(([llave, d]) => ({ llave, sobre: d.sobre }));
  }
  async publicarDocumento(llave: string, version: string, sobre: string) {
    const actual = this.docs.get(llave);
    if (actual && actual.version >= BigInt(version)) return false;
    this.docs.set(llave, { version: BigInt(version), sobre });
    queueMicrotask(() => this.alDocumento.forEach((o) => o({ llave, sobre })));
    return true;
  }
  async licencia() {
    return this.lic;
  }
  async reportarPulso(p: PulsoNube) {
    this.pulsos.push(p);
  }
}

/** El `SocketNube` sin Supabase: mismo servidor, avisos de la nube en memoria. */
class SocketDePrueba implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  private servidor: Promise<ServidorNube>;

  constructor(nube: NubeEnMemoria, claveRemota: string, publica?: string) {
    this.servidor = (async () => {
      const servidor = new ServidorNube({
        almacen: nube,
        sucursal_id: SUC,
        canal: await derivarClaves(claveRemota, "hub"),
        datos: await derivarLlaveDatosNube(claveRemota),
        verificarLicencia: async (l) => {
          if (!publica) return false;
          const { verificarLicencia } = await import("@motrest/dominio");
          return verificarLicencia(l, SUC, publica);
        },
        entregar: (crudo) => this.onmessage?.({ data: crudo }),
      });
      nube.alEvento.push(() => servidor.hayEventosNuevos());
      nube.alDocumento.push((f) => servidor.cambioDocumento(f));
      return servidor;
    })();
    void this.servidor.then(() => this.onopen?.());
  }
  send(datos: string) {
    void this.servidor.then((s) => s.recibir(datos));
  }
  close() {
    this.onclose?.();
  }
}

interface Dispositivo {
  cliente: ClienteSync;
  almacen: Almacen;
  recibidos: EventoBase[];
  catalogos: Catalogo[];
  credenciales: Record<string, unknown[]>[];
  estado: () => string;
}

async function dispositivo(nube: NubeEnMemoria, clave: string, device: string, publica?: string): Promise<Dispositivo> {
  const almacen = almacenEnMemoria();
  const d: Dispositivo = { cliente: null!, almacen, recibidos: [], catalogos: [], credenciales: [], estado: () => "" };
  const cliente = new ClienteSync({
    url: "nube://PRUEBA",
    device_id: device,
    sucursal_id: SUC,
    clave,
    almacen,
    crearSocket: () => new SocketDePrueba(nube, clave, publica),
    alRecibir: (e) => d.recibidos.push(...e),
    alRecibirCatalogos: (c) => d.catalogos.push(...c),
    alRecibirCredenciales: (c) => d.credenciales.push(c),
    latidoOutbox: 60_000,
  });
  d.cliente = cliente;
  d.estado = () => cliente.estado;
  await cliente.conectar();
  return d;
}

let orden = 0;
function evento(device: string, tipo = "prueba_hecha"): EventoBase {
  orden += 1;
  return {
    id: `evt-${device}-${orden}`,
    tipo,
    ts: 1_790_000_000_000 + orden,
    stream_id: "mesa-1",
    device_id: device,
    sucursal_id: SUC,
    empleado_id: "usr-1",
    orden_local: orden,
    detalle: "una pizza mitad y mitad",
  } as unknown as EventoBase;
}

const esperar = async (condicion: () => boolean, ms = 3000) => {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error("La condición nunca se cumplió");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("modo nube: el Hub en el navegador", () => {
  it("reporta el pulso al entrar y, al cerrar la caja, con las cifras del corte", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "caja-web");
    await esperar(() => a.estado() === "sincronizado" && nube.pulsos.length === 1);
    expect(nube.pulsos[0]).toMatchObject({ sucursal_id: SUC, plataforma: "web", eventos: 0 });
    expect(nube.pulsos[0]).not.toHaveProperty("ventas_dia");

    const cierre = { ...evento("caja-web", "caja_cerrada"), resumen: { total_vendido: 1_234_500, cuentas_cerradas: 37 } };
    await a.almacen.eventos.anexar([cierre as unknown as EventoBase]);
    await a.cliente.empujar();
    await esperar(() => nube.pulsos.length === 2);
    expect(nube.pulsos[1]).toMatchObject({ ventas_dia: 1_234_500, cuentas_dia: 37, eventos: 1 });
    // El pulso no lleva nada más del negocio que esos dos totales.
    expect(Object.keys(nube.pulsos[1]!).sort()).toEqual(
      ["cuentas_dia", "eventos", "plataforma", "sucursal_id", "ventas_dia", "version"],
    );
  });

  it("lo que vende una tableta le llega a la otra, con su seq", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "tableta-a");
    const b = await dispositivo(nube, clave, "tableta-b");
    await esperar(() => a.estado() === "sincronizado" && b.estado() === "sincronizado");

    await a.almacen.eventos.anexar([evento("tableta-a"), evento("tableta-a")]);
    await a.cliente.empujar();

    await esperar(() => b.recibidos.length === 2);
    expect(b.recibidos.map((e) => e.device_id)).toEqual(["tableta-a", "tableta-a"]);
    expect(b.recibidos.map((e) => (e as { seq?: number }).seq)).toEqual([1, 2]);
    // A no recibe de vuelta lo suyo: la difusión es para los demás, como en el Hub.
    expect(a.recibidos).toHaveLength(0);
    expect(await a.almacen.eventos.pendientes()).toHaveLength(0);
  });

  it("un dispositivo que llega tarde recibe toda la historia", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "caja-web");
    await esperar(() => a.estado() === "sincronizado");
    await a.almacen.eventos.anexar(Array.from({ length: 7 }, () => evento("caja-web")));
    await a.cliente.empujar();
    await esperar(() => nube.filas.length === 7);

    const tarde = await dispositivo(nube, clave, "telefono-del-dueno");
    await esperar(() => tarde.recibidos.length === 7);
    expect(tarde.estado()).toBe("sincronizado");
  });

  it("un reintento no duplica nada en la nube", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "tableta-a");
    await esperar(() => a.estado() === "sincronizado");
    const e = evento("tableta-a");
    const filas = [{ id: e.id, device_id: e.device_id, sobre: "x" }];
    await nube.empujar(filas);
    await nube.empujar(filas);
    expect(nube.filas).toHaveLength(1);
  });

  it("en la nube no queda nada legible del negocio", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "tableta-a");
    await esperar(() => a.estado() === "sincronizado");
    await a.almacen.eventos.anexar([evento("tableta-a")]);
    await a.cliente.empujar();
    a.cliente.publicarCatalogo({ clave: "menu", version: 3, updated_at: 5, datos: { platillo: "Pizza Rodizio" } });
    a.cliente.publicarCredencial("usr-mesero", [{ hash: "hash-del-pin" }]);
    await esperar(() => nube.filas.length === 1 && nube.docs.size === 2);

    const todo = JSON.stringify({ filas: nube.filas, docs: [...nube.docs.values()].map((d) => d.sobre), llaves: [...nube.docs.keys()] });
    for (const secreto of ["una pizza mitad y mitad", "prueba_hecha", "Pizza Rodizio", "usr-mesero", "hash-del-pin", "menu"]) {
      expect(todo).not.toContain(secreto);
    }
  });

  it("catálogos y credenciales viajan entre dispositivos", async () => {
    const nube = new NubeEnMemoria();
    const clave = generarClaveRemota();
    const a = await dispositivo(nube, clave, "tableta-a");
    const b = await dispositivo(nube, clave, "tableta-b");
    await esperar(() => a.estado() === "sincronizado" && b.estado() === "sincronizado");

    a.cliente.publicarCatalogo({ clave: "menu", version: 3, updated_at: 5, datos: { platillos: 12 } });
    await esperar(() => b.catalogos.some((c) => c.clave === "menu" && c.version === 3));

    a.cliente.publicarCredencial("usr-mesero", [{ hash: "h" }]);
    await esperar(() => b.credenciales.some((c) => "usr-mesero" in c));
  });

  it("un catálogo viejo no pisa al nuevo", async () => {
    expect(BigInt(versionDeCatalogo({ version: 4, updated_at: 1 }))).toBeGreaterThan(
      BigInt(versionDeCatalogo({ version: 3, updated_at: 1_790_000_000_000 })),
    );
    expect(BigInt(versionDeCatalogo({ version: 3, updated_at: 9 }))).toBeGreaterThan(
      BigInt(versionDeCatalogo({ version: 3, updated_at: 8 })),
    );
  });

  /*
   * Quien llegara a las filas sin la clave remota —un volcado de la base, o la
   * propia Supabase— no puede leer ni un evento: se omiten como ilegibles. En
   * la vida real, además, sin la contraseña ni siquiera pasa Supabase Auth.
   */
  it("con otra clave remota las filas no se pueden leer", async () => {
    const nube = new NubeEnMemoria();
    const a = await dispositivo(nube, generarClaveRemota(), "tableta-a");
    await esperar(() => a.estado() === "sincronizado");
    await a.almacen.eventos.anexar([evento("tableta-a")]);
    await a.cliente.empujar();
    await esperar(() => nube.filas.length === 1);

    const intruso = await dispositivo(nube, generarClaveRemota(), "intruso");
    await esperar(() => intruso.estado() === "sincronizado");
    expect(intruso.recibidos).toHaveLength(0);
    expect(await intruso.almacen.eventos.leerTodos()).toHaveLength(0);
  });

  it("la licencia llega como catálogo, verificada y sin credenciales dentro", async () => {
    const motrae = await generarPar();
    const nube = new NubeEnMemoria();
    nube.lic = await emitirLicencia(
      {
        sucursal_id: SUC,
        nombre: "La Nube",
        plan: "mensual",
        vence_ts: Date.now() + 30 * 86_400_000,
        gracia_dias: 3,
        emitida_ts: Date.now(),
        soporte: { sal: "s", hash: "hash-soporte", iteraciones: 1 },
      },
      motrae.privada,
    );
    const a = await dispositivo(nube, generarClaveRemota(), "tableta-a", motrae.publica);
    await esperar(() => a.catalogos.some((c) => c.clave === "licencia_estado"));
    const veredicto = a.catalogos.find((c) => c.clave === "licencia_estado")!.datos as {
      licencia: { nombre: string; soporte?: unknown };
      verificada: boolean;
    };
    expect(veredicto.verificada).toBe(true);
    expect(veredicto.licencia.nombre).toBe("La Nube");
    expect(veredicto.licencia.soporte).toBeUndefined();
  });
});
