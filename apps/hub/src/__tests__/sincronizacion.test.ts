/**
 * El criterio de aceptación de la etapa 10, ejercido de punta a punta:
 *
 *   "Dos dispositivos comparten el salón en vivo. Apagar el hub → se sigue
 *    vendiendo → reconectar → todo cuadra sin duplicados."
 *
 * Se prueba contra el Hub REAL y un log SQLite real (en memoria), con conexiones
 * falsas en lugar de sockets. Lo que no se ejercita aquí es el transporte —
 * `ws`— que es justo la parte que no tiene lógica de negocio.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FabricaEventos,
  permisosDePlantilla,
  streamIdentidad,
  type EventoComanda,
  type EventoIdentidad,
  type RolId,
  type Usuario,
} from "@motrest/dominio";
import {
  VERSION_PROTOCOLO,
  almacenEnMemoria,
  type Almacen,
  type MensajeHub,
} from "@motrest/protocolo-sync";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "../servidor.js";

const SUC = "suc-rodizio";
const HORA = 3_600_000;
const T0 = new Date(2026, 6, 22, 20, 0).getTime();

/** Conexión de mentira: guarda lo que el Hub le manda. */
class ConexionPrueba implements Conexion {
  recibidos: MensajeHub[] = [];
  cerrada = false;
  constructor(public id: string) {}

  enviar(mensaje: MensajeHub): void {
    this.recibidos.push(mensaje);
  }
  cerrar(): void {
    this.cerrada = true;
  }
  /** Último mensaje de un tipo, que es lo que casi siempre interesa. */
  ultimo<T extends MensajeHub["tipo"]>(tipo: T): Extract<MensajeHub, { tipo: T }> | undefined {
    return [...this.recibidos].reverse().find((m) => m.tipo === tipo) as never;
  }
  todos<T extends MensajeHub["tipo"]>(tipo: T): Extract<MensajeHub, { tipo: T }>[] {
    return this.recibidos.filter((m) => m.tipo === tipo) as never;
  }
}

/** Una terminal: su fábrica de eventos y su almacén local (el outbox). */
function terminal(deviceId: string, empleadoId: string) {
  const almacen: Almacen = almacenEnMemoria();
  const fabrica = new FabricaEventos<EventoComanda>({
    device_id: deviceId,
    empleado_id: empleadoId,
    sucursal_id: SUC,
  });
  return { deviceId, almacen, fabrica };
}

function usuarioDePrueba(id: string, rol_id: RolId): Usuario {
  return {
    id,
    nombre: id,
    iniciales: id.slice(0, 1).toUpperCase(),
    rol_id,
    puesto: rol_id,
    sucursal_id: SUC,
    permisos: permisosDePlantilla(rol_id),
    activo: true,
  };
}

/** Eventos ya asentados en el stream de identidad, para cargar una proyección. */
function semillaDeIdentidad(...usuarios: Usuario[]): EventoIdentidad[] {
  const propietario = usuarios.find((usuario) => usuario.rol_id === "propietario");
  if (!propietario) throw new Error("La prueba necesita un propietario");
  const fabrica = new FabricaEventos<EventoIdentidad>({
    device_id: "dev-semilla",
    empleado_id: propietario.id,
    sucursal_id: SUC,
  });
  return usuarios.map((usuario) =>
    fabrica.crear("usuario_creado", streamIdentidad(SUC), {
      usuario_id: usuario.id,
      nombre: usuario.nombre,
      puesto: usuario.puesto,
      rol_id: usuario.rol_id,
      permisos: usuario.permisos,
    }),
  );
}

async function venta(
  t: ReturnType<typeof terminal>,
  mesa: string,
): Promise<EventoComanda[]> {
  const orden_id = `ord-${mesa}-${t.deviceId}`;
  const eventos = [
    t.fabrica.crear("orden_creada", orden_id, { orden_id, mesa_id: mesa, abierta_ts: Date.now() }),
  ];
  await t.almacen.eventos.anexar(eventos);
  return eventos;
}

let log: LogHub;
let hub: Hub;

beforeEach(() => {
  // ":memory:" da una base SQLite real y desechable por prueba.
  log = new LogHub(":memory:");
  hub = new Hub({ hub_id: "hub-prueba", log, exigirAprobacion: false });
});

afterEach(() => log.cerrar());

function saludar(cx: ConexionPrueba, deviceId: string, desdeSeq = 0): void {
  hub.conectar(cx);
  hub.recibir(cx.id, {
    tipo: "hola",
    v: VERSION_PROTOCOLO,
    device_id: deviceId,
    sucursal_id: SUC,
    desde_seq: desdeSeq,
  });
}

// --- Secuencia total ---------------------------------------------------------------------

describe("el Hub arbitra la secuencia total", () => {
  it("asigna secuencias crecientes sin importar el reloj del dispositivo", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);

    const eventos = await venta(caja, "mesa-1");
    // Un reloj adelantado no debe alterar el orden que fija el Hub.
    (eventos[0] as { ts: number }).ts = Date.now() + 3_600_000;

    hub.recibir(cx.id, { tipo: "push", eventos });

    const acks = cx.ultimo("acks")!;
    expect(acks.acks).toHaveLength(1);
    expect(acks.acks[0]!.seq).toBe(1);
    expect(hub.seqActual).toBe(1);
  });

  it("da la bienvenida con la secuencia actual", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);
    hub.recibir(cx.id, { tipo: "push", eventos: await venta(caja, "mesa-1") });

    const otra = new ConexionPrueba("cx-2");
    saludar(otra, "dev-tablet");
    expect(otra.ultimo("bienvenida")!.seq_actual).toBe(1);
  });
});

// --- Deduplicación -----------------------------------------------------------------------

describe("deduplicación por UUID", () => {
  it("reenviar el mismo evento NO lo duplica y conserva su secuencia", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);

    const eventos = await venta(caja, "mesa-4");
    hub.recibir(cx.id, { tipo: "push", eventos });
    const primera = cx.ultimo("acks")!.acks[0]!.seq;

    // La terminal no recibió el ack (se cayó la red) y reenvía.
    hub.recibir(cx.id, { tipo: "push", eventos });
    const segunda = cx.ultimo("acks")!.acks[0]!.seq;

    expect(segunda).toBe(primera);
    expect(await log.contar()).toBe(1);
  });

  it("un evento repetido no reescribe el original: el log es la bitácora", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);

    const eventos = await venta(caja, "mesa-4");
    hub.recibir(cx.id, { tipo: "push", eventos });

    // Alguien reenvía el MISMO id con el contenido cambiado.
    const falsificado = [{ ...eventos[0]!, mesa_id: "mesa-99" }] as EventoComanda[];
    hub.recibir(cx.id, { tipo: "push", eventos: falsificado });

    const guardados = await log.leerTodos();
    expect(guardados).toHaveLength(1);
    expect((guardados[0] as unknown as { mesa_id: string }).mesa_id).toBe("mesa-4");
  });
});

// --- Difusión en vivo --------------------------------------------------------------------

describe("dos dispositivos comparten el salón en vivo", () => {
  it("lo que captura una terminal llega a la otra", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const tablet = terminal("dev-tablet", "emp-marco");

    const cxCaja = new ConexionPrueba("cx-caja");
    const cxTablet = new ConexionPrueba("cx-tablet");
    saludar(cxCaja, caja.deviceId);
    saludar(cxTablet, tablet.deviceId);

    hub.recibir(cxCaja.id, { tipo: "push", eventos: await venta(caja, "mesa-7") });

    const difundido = cxTablet.ultimo("eventos");
    expect(difundido?.eventos).toHaveLength(1);
    expect((difundido!.eventos[0] as unknown as { mesa_id: string }).mesa_id).toBe("mesa-7");
  });

  it("a quien lo mandó no se le devuelve su propio evento", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-caja");
    saludar(cx, caja.deviceId);

    hub.recibir(cx.id, { tipo: "push", eventos: await venta(caja, "mesa-7") });
    expect(cx.todos("eventos")).toHaveLength(0);
  });

  it("no se difunde a terminales de otra sucursal", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cxCaja = new ConexionPrueba("cx-caja");
    saludar(cxCaja, caja.deviceId);

    const ajena = new ConexionPrueba("cx-ajena");
    hub.conectar(ajena);
    hub.recibir(ajena.id, {
      tipo: "hola",
      v: VERSION_PROTOCOLO,
      device_id: "dev-otro-local",
      sucursal_id: "suc-otra",
      desde_seq: 0,
    });

    hub.recibir(cxCaja.id, { tipo: "push", eventos: await venta(caja, "mesa-7") });
    expect(ajena.todos("eventos")).toHaveLength(0);
  });
});

// --- Modo isla y resync -------------------------------------------------------------------

describe("apagar el hub, seguir vendiendo, reconectar", () => {
  it("todo cuadra y nada se duplica", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const tablet = terminal("dev-tablet", "emp-marco");

    // 1 · Con Hub: la caja vende y la tablet lo ve.
    const cxCaja = new ConexionPrueba("cx-caja-1");
    const cxTablet = new ConexionPrueba("cx-tablet-1");
    saludar(cxCaja, caja.deviceId);
    saludar(cxTablet, tablet.deviceId);
    hub.recibir(cxCaja.id, { tipo: "push", eventos: await venta(caja, "mesa-1") });
    expect(cxTablet.ultimo("eventos")!.eventos).toHaveLength(1);

    // 2 · Se cae el Hub. Ambas terminales SIGUEN vendiendo contra su log local.
    hub.desconectar(cxCaja.id);
    hub.desconectar(cxTablet.id);
    const enIslaCaja = await venta(caja, "mesa-2");
    const enIslaTablet = await venta(tablet, "mesa-3");

    // El modo isla no bloquea nada: las ventas ya están en el outbox.
    expect(await caja.almacen.eventos.pendientes()).toHaveLength(2);
    expect(await tablet.almacen.eventos.pendientes()).toHaveLength(1);

    // 3 · Vuelve el Hub. Cada quien reenvía TODO su outbox, incluido lo que ya
    //     había confirmado antes del corte.
    const cxCaja2 = new ConexionPrueba("cx-caja-2");
    const cxTablet2 = new ConexionPrueba("cx-tablet-2");
    saludar(cxCaja2, caja.deviceId);
    saludar(cxTablet2, tablet.deviceId);

    hub.recibir(cxCaja2.id, {
      tipo: "push",
      eventos: await caja.almacen.eventos.pendientes(),
    });
    hub.recibir(cxTablet2.id, {
      tipo: "push",
      eventos: [...enIslaTablet],
    });

    // 4 · El log del Hub tiene exactamente 3 eventos: ni uno duplicado.
    expect(await log.contar()).toBe(3);
    const seqs = (await log.leerTodos()).map((e) => e.seq);
    expect(new Set(seqs).size).toBe(3);

    // 5 · Cada terminal se pone al día pidiendo desde donde se quedó.
    hub.recibir(cxTablet2.id, { tipo: "pull", desde_seq: 1 });
    const alDia = cxTablet2.ultimo("eventos")!;
    const mesas = alDia.eventos.map((e) => (e as unknown as { mesa_id: string }).mesa_id);
    expect(mesas).toContain("mesa-2");
    expect(alDia.hay_mas).toBe(false);
  });

  it("un dispositivo nuevo pide todo desde cero y recibe el historial", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-caja");
    saludar(cx, caja.deviceId);
    hub.recibir(cx.id, { tipo: "push", eventos: await venta(caja, "mesa-1") });
    hub.recibir(cx.id, { tipo: "push", eventos: await venta(caja, "mesa-2") });

    const nueva = new ConexionPrueba("cx-nueva");
    saludar(nueva, "dev-recien-llegado");
    hub.recibir(nueva.id, { tipo: "pull", desde_seq: 0 });

    expect(nueva.ultimo("eventos")!.eventos).toHaveLength(2);
  });

  it("entrega por lotes y avisa que quedan más", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-caja");
    saludar(cx, caja.deviceId);
    for (let i = 0; i < 5; i += 1) {
      hub.recibir(cx.id, { tipo: "push", eventos: await venta(caja, `mesa-${i}`) });
    }

    const nueva = new ConexionPrueba("cx-nueva");
    saludar(nueva, "dev-nueva");
    hub.recibir(nueva.id, { tipo: "pull", desde_seq: 0, limite: 2 });

    const lote = nueva.ultimo("eventos")!;
    expect(lote.eventos).toHaveLength(2);
    expect(lote.hay_mas).toBe(true);
  });
});

// --- Defensas del servidor -----------------------------------------------------------------

describe("el Hub no confía en el cliente", () => {
  it("exige presentarse antes de escribir", () => {
    const cx = new ConexionPrueba("cx-1");
    hub.conectar(cx);
    hub.recibir(cx.id, { tipo: "push", eventos: [] });

    expect(cx.ultimo("error")!.codigo).toBe("no_emparejado");
  });

  it("rechaza una versión de protocolo incompatible y cierra", () => {
    const cx = new ConexionPrueba("cx-1");
    hub.conectar(cx);
    hub.recibir(cx.id, {
      tipo: "hola",
      v: VERSION_PROTOCOLO + 1,
      device_id: "dev-viejo",
      sucursal_id: SUC,
      desde_seq: 0,
    });

    expect(cx.ultimo("error")!.codigo).toBe("version_incompatible");
    expect(cx.cerrada).toBe(true);
  });

  it("descarta eventos malformados SIN tirar los buenos del mismo lote", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);

    const buenos = await venta(caja, "mesa-1");
    hub.recibir(cx.id, {
      tipo: "push",
      eventos: [{ tipo: "basura" } as never, ...buenos],
    });

    expect(cx.ultimo("error")!.codigo).toBe("evento_invalido");
    // El bueno entró igual: una comanda corrupta no puede tirar a las demás.
    expect(await log.contar()).toBe(1);
  });

  it("rechaza eventos de otra sucursal", async () => {
    const caja = terminal("dev-caja", "emp-lucia");
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, caja.deviceId);

    const eventos = await venta(caja, "mesa-1");
    const ajeno = [{ ...eventos[0]!, sucursal_id: "suc-otra" }] as EventoComanda[];
    hub.recibir(cx.id, { tipo: "push", eventos: ajeno });

    expect(cx.ultimo("error")!.codigo).toBe("sucursal_distinta");
    expect(await log.contar()).toBe(0);
  });

  /*
   * EL LOCAL QUE NO PODÍA ABRIR NUNCA.
   *
   * Un Hub recién instalado no sabe a qué sucursal pertenece —el registro está
   * en blanco— así que se inventa un identificador y lo fija en disco. Con ese
   * identificador rechazaba a TODAS las terminales, incluida la caja del propio
   * equipo, que mostraba «Modo isla» contra su propio Hub. Y no se corregía
   * solo: sin terminales no entra un evento, y sin eventos la identidad
   * inventada no cambia jamás. Le pasó a la caja de Rodizio.
   */
  describe("identidad del local recién instalado", () => {
    it("adopta la sucursal de su primera terminal cuando el registro está en blanco", () => {
      const recien = new Hub({ hub_id: "hub-nuevo", log, adoptarSucursal: () => true });
      // Lo que hace `arrancar()`: fija la identidad inventada antes de escuchar.
      recien.cargarIdentidad("suc-d6c70a6d", []);

      const caja = new ConexionPrueba("cx-caja");
      recien.conectar(caja);
      recien.recibir(caja.id, {
        tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
      });

      expect(caja.ultimo("error")).toBeUndefined();
      expect(caja.ultimo("bienvenida")).toBeDefined();
      expect(caja.cerrada).toBe(false);
    });

    it("avisa a quien tiene que persistirla, con el identificador que adoptó", () => {
      const adoptadas: string[] = [];
      const recien = new Hub({
        hub_id: "hub-nuevo",
        log,
        adoptarSucursal: (id) => {
          adoptadas.push(id);
          return true;
        },
      });
      recien.cargarIdentidad("suc-d6c70a6d", []);

      const caja = new ConexionPrueba("cx-caja");
      recien.conectar(caja);
      recien.recibir(caja.id, {
        tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
      });

      expect(adoptadas).toEqual([SUC]);
    });

    it("NO la adopta si quien instaló ya decidió cuál es", () => {
      const asignado = new Hub({ hub_id: "hub-asignado", log, adoptarSucursal: () => false });
      asignado.cargarIdentidad("suc-la-que-dijo-motrae", []);

      const ajena = new ConexionPrueba("cx-ajena");
      asignado.conectar(ajena);
      asignado.recibir(ajena.id, {
        tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-ajena", sucursal_id: SUC, desde_seq: 0,
      });

      expect(ajena.ultimo("error")!.codigo).toBe("sucursal_distinta");
      expect(ajena.cerrada).toBe(true);
    });

    it("y en un local que YA operó no adopta nada: sus eventos dicen de quién es", async () => {
      const enMarcha = new Hub({ hub_id: "hub-en-marcha", log, adoptarSucursal: () => true });
      enMarcha.cargarIdentidad(SUC, []);

      // El local abre y registra su primera venta.
      const caja = terminal("dev-caja", "emp-lucia");
      const cx = new ConexionPrueba("cx-caja");
      enMarcha.conectar(cx);
      enMarcha.recibir(cx.id, {
        tipo: "hola", v: VERSION_PROTOCOLO, device_id: caja.deviceId, sucursal_id: SUC, desde_seq: 0,
      });
      enMarcha.recibir(cx.id, { tipo: "push", eventos: await venta(caja, "mesa-1") });
      expect(log.seqActual).toBeGreaterThan(0);

      // Ahora llega una terminal de otro restaurante. Con historia de por medio,
      // adoptar su sucursal repartiría las ventas de este local a otro.
      const forastera = new ConexionPrueba("cx-forastera");
      enMarcha.conectar(forastera);
      enMarcha.recibir(forastera.id, {
        tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-forastera", sucursal_id: "suc-otro-local", desde_seq: 0,
      });

      expect(forastera.ultimo("error")!.codigo).toBe("sucursal_distinta");
      expect(forastera.cerrada).toBe(true);
    });
  });

  it("la PRIMERA terminal del local se autoriza sola, o nadie podría autorizar a nadie", () => {
    const cerrado = new Hub({ hub_id: "hub-cerrado", log, exigirAprobacion: true });
    const primera = new ConexionPrueba("cx-primera");
    cerrado.conectar(primera);
    cerrado.recibir(primera.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    expect(primera.ultimo("bienvenida")).toBeDefined();
    expect(log.dispositivo("dev-caja")!.aprobado).toBe(true);
  });

  it("pero la SEGUNDA ya no: hace falta que alguien la autorice", () => {
    const cerrado = new Hub({ hub_id: "hub-cerrado", log, exigirAprobacion: true });

    const primera = new ConexionPrueba("cx-primera");
    cerrado.conectar(primera);
    cerrado.recibir(primera.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    const intrusa = new ConexionPrueba("cx-intrusa");
    cerrado.conectar(intrusa);
    cerrado.recibir(intrusa.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-intrusa", sucursal_id: SUC, desde_seq: 0,
    });

    expect(intrusa.ultimo("error")!.codigo).toBe("no_emparejado");
    expect(intrusa.cerrada).toBe(true);
    // Queda registrada para que alguien pueda decidir sobre ella.
    expect(log.dispositivo("dev-intrusa")!.aprobado).toBe(false);
  });

  it("tras autorizarla, la terminal rechazada entra al segundo intento", () => {
    const cerrado = new Hub({ hub_id: "hub-cerrado", log, exigirAprobacion: true });

    // La primera del local se autoriza sola y consume la confianza inicial.
    const caja = new ConexionPrueba("cx-caja");
    cerrado.conectar(caja);
    cerrado.recibir(caja.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    // La siguiente llega y la rechazan.
    const primera = new ConexionPrueba("cx-1");
    cerrado.conectar(primera);
    cerrado.recibir(primera.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-nuevo", sucursal_id: SUC, desde_seq: 0,
    });
    expect(primera.ultimo("error")!.codigo).toBe("no_emparejado");

    // Alguien la autoriza desde la caja, y vuelve a intentar.
    log.aprobarDispositivo("dev-nuevo");

    const segunda = new ConexionPrueba("cx-2");
    cerrado.conectar(segunda);
    cerrado.recibir(segunda.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-nuevo", sucursal_id: SUC, desde_seq: 0,
    });
    expect(segunda.ultimo("bienvenida")).toBeDefined();
    expect(segunda.cerrada).toBe(false);
  });

  it("responde al latido, para distinguir un enlace muerto de uno callado", () => {
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, "dev-caja");
    hub.recibir(cx.id, { tipo: "ping", ts: 1 });
    expect(cx.ultimo("pong")).toBeDefined();
  });
});

// --- Catálogos del local -----------------------------------------------------------------

describe("la carta del local se replica entre terminales", () => {
  const carta = (version: number, updated_at = T0) => ({
    clave: "menu_local",
    version,
    updated_at,
    datos: { version, updated_at, productos: [{ id: "p1", precio: version * 100 }] },
  });

  it("el Hub reparte a las demás terminales lo que edita una", () => {
    const caja = new ConexionPrueba("cx-caja");
    const tablet = new ConexionPrueba("cx-tablet");
    saludar(caja, "dev-caja");
    saludar(tablet, "dev-tablet");

    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(2)] });

    const recibido = tablet.ultimo("catalogo");
    expect(recibido?.catalogos).toHaveLength(1);
    expect(recibido!.catalogos[0]!.version).toBe(2);
  });

  it("a quien la editó no se le devuelve su propia carta", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");
    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(2)] });
    expect(caja.todos("catalogo")).toHaveLength(0);
  });

  it("una terminal que se enciende después recibe la carta vigente", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");
    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(5)] });

    // Llega una terminal nueva: no debe atender con precios viejos.
    const tarde = new ConexionPrueba("cx-tarde");
    saludar(tarde, "dev-tarde");

    const recibido = tarde.ultimo("catalogo");
    expect(recibido?.catalogos[0]!.version).toBe(5);
  });

  it("una versión vieja NO pisa a la nueva, aunque llegue después", () => {
    const caja = new ConexionPrueba("cx-caja");
    const tablet = new ConexionPrueba("cx-tablet");
    saludar(caja, "dev-caja");
    saludar(tablet, "dev-tablet");

    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(7)] });
    // Una terminal que estuvo apagada reenvía su copia atrasada al reconectar.
    hub.recibir(tablet.id, { tipo: "catalogo", catalogos: [carta(3)] });

    const tercera = new ConexionPrueba("cx-tercera");
    saludar(tercera, "dev-tercera");
    expect(tercera.ultimo("catalogo")!.catalogos[0]!.version).toBe(7);
  });

  it("manda la versión sobre el reloj: un reloj adelantado no gana", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");

    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(4, T0)] });
    // Terminal con la hora una semana adelantada, pero versión anterior.
    hub.recibir(caja.id, {
      tipo: "catalogo",
      catalogos: [carta(2, T0 + 7 * 24 * HORA)],
    });

    const nueva = new ConexionPrueba("cx-nueva");
    saludar(nueva, "dev-nueva");
    expect(nueva.ultimo("catalogo")!.catalogos[0]!.version).toBe(4);
  });

  it("a igual versión desempata el reloj: eso es 'gana la última escritura'", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");

    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(4, T0)] });
    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(4, T0 + HORA)] });

    const nueva = new ConexionPrueba("cx-nueva");
    saludar(nueva, "dev-nueva");
    expect(nueva.ultimo("catalogo")!.catalogos[0]!.updated_at).toBe(T0 + HORA);
  });

  it("no se reparte la carta a otra sucursal", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");

    const ajena = new ConexionPrueba("cx-ajena");
    hub.conectar(ajena);
    hub.recibir(ajena.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-otro",
      sucursal_id: "suc-otra", desde_seq: 0,
    });

    hub.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(2)] });
    expect(ajena.todos("catalogo")).toHaveLength(0);
  });

  it("descarta un catálogo malformado sin tumbar la conexión", () => {
    const caja = new ConexionPrueba("cx-caja");
    const tablet = new ConexionPrueba("cx-tablet");
    saludar(caja, "dev-caja");
    saludar(tablet, "dev-tablet");

    hub.recibir(caja.id, {
      tipo: "catalogo",
      catalogos: [{ clave: 5, version: "x" } as never, carta(3)],
    });

    // El bueno pasó igual.
    expect(tablet.ultimo("catalogo")!.catalogos).toHaveLength(1);
    expect(caja.cerrada).toBe(false);
  });

  it("una terminal no puede falsificar ni persistir el estado reservado del Hub", () => {
    const guardados: { clave: string; origen: "terminal" | "hub" }[] = [];
    const conAutoridad = new Hub({
      hub_id: "hub-1",
      log,
      exigirAprobacion: false,
      guardarCatalogo: (catalogo, origen) => guardados.push({ clave: catalogo.clave, origen }),
    });
    const caja = new ConexionPrueba("cx-caja");
    const tablet = new ConexionPrueba("cx-tablet");
    conAutoridad.conectar(caja);
    conAutoridad.conectar(tablet);
    conAutoridad.recibir(caja.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });
    conAutoridad.recibir(tablet.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-tablet", sucursal_id: SUC, desde_seq: 0,
    });

    conAutoridad.recibir(caja.id, {
      tipo: "catalogo",
      catalogos: [{
        clave: "licencia_estado",
        version: 999_999,
        updated_at: T0,
        datos: { valida: true },
      }],
    });

    expect(conAutoridad.catalogoDe("licencia_estado")).toBeUndefined();
    expect(tablet.ultimo("catalogo")).toBeUndefined();
    expect(guardados).toEqual([]);

    conAutoridad.publicarCatalogo("licencia_estado", { valida: false });
    expect(conAutoridad.catalogoDe("licencia_estado")).toEqual({ valida: false });
    expect(tablet.ultimo("catalogo")!.catalogos[0]!.clave).toBe("licencia_estado");
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ clave: "licencia_estado", origen: "hub" });
  });

  it("no reanima una clave reservada desde el almacenamiento de terminales", () => {
    const reiniciado = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    const reservado = {
      clave: "modo_abierto",
      version: 999_999,
      updated_at: T0,
      datos: { activo: true },
    };
    reiniciado.cargarCatalogos([reservado]);
    expect(reiniciado.catalogoDe("modo_abierto")).toBeUndefined();

    reiniciado.cargarCatalogosInternos([reservado]);
    expect(reiniciado.catalogoDe("modo_abierto")).toEqual({ activo: true });
  });

  it("persiste lo aceptado, para sobrevivir al reinicio del Hub", () => {
    const guardados: { clave: string; version: number }[] = [];
    const conDisco = new Hub({
      hub_id: "hub-1",
      log,
      exigirAprobacion: false,
      guardarCatalogo: (c) => guardados.push({ clave: c.clave, version: c.version }),
    });

    const caja = new ConexionPrueba("cx-caja");
    conDisco.conectar(caja);
    conDisco.recibir(caja.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });
    conDisco.recibir(caja.id, { tipo: "catalogo", catalogos: [carta(9)] });

    expect(guardados).toEqual([{ clave: "menu_local", version: 9 }]);
  });

  it("al arrancar, el Hub recupera la carta guardada", () => {
    const reiniciado = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    reiniciado.cargarCatalogos([carta(11)]);

    const caja = new ConexionPrueba("cx-caja");
    reiniciado.conectar(caja);
    reiniciado.recibir(caja.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    expect(caja.ultimo("catalogo")!.catalogos[0]!.version).toBe(11);
  });

  it("exige presentarse antes de mandar catálogos", () => {
    const cx = new ConexionPrueba("cx-1");
    hub.conectar(cx);
    hub.recibir(cx.id, { tipo: "catalogo", catalogos: [carta(2)] });
    expect(cx.ultimo("error")!.codigo).toBe("no_emparejado");
  });
});

// --- Administración de terminales -----------------------------------------------------

describe("administrar las terminales del local", () => {
  it("una terminal autorizada puede listar las demás", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");
    log.aprobarDispositivo("dev-caja");

    hub.recibir(caja.id, { tipo: "admin", accion: "listar_terminales" });
    expect(caja.ultimo("terminales")!.terminales).toHaveLength(1);
  });

  it("una terminal SIN autorizar no puede ni listar ni autorizar", () => {
    // Con una ya registrada, la siguiente no hereda la confianza inicial.
    saludar(new ConexionPrueba("cx-caja"), "dev-caja");

    const intrusa = new ConexionPrueba("cx-intrusa");
    saludar(intrusa, "dev-intrusa");

    hub.recibir(intrusa.id, { tipo: "admin", accion: "listar_terminales" });
    expect(intrusa.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(intrusa.ultimo("terminales")).toBeUndefined();
  });

  it("una terminal sin autorizar NO puede autorizarse a sí misma", () => {
    saludar(new ConexionPrueba("cx-caja"), "dev-caja");

    const intrusa = new ConexionPrueba("cx-intrusa");
    saludar(intrusa, "dev-intrusa");

    hub.recibir(intrusa.id, {
      tipo: "admin", accion: "autorizar", device_id: "dev-intrusa",
    });

    expect(intrusa.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(log.dispositivo("dev-intrusa")!.aprobado).toBe(false);
  });

  it("una autorizada sí puede autorizar a otra, y recibe la lista al día", () => {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");
    log.aprobarDispositivo("dev-caja");

    const tablet = new ConexionPrueba("cx-tablet");
    saludar(tablet, "dev-tablet");

    hub.recibir(caja.id, { tipo: "admin", accion: "autorizar", device_id: "dev-tablet" });

    expect(log.dispositivo("dev-tablet")!.aprobado).toBe(true);
    const lista = caja.ultimo("terminales")!.terminales;
    expect(lista.find((t) => t.device_id === "dev-tablet")!.aprobado).toBe(true);
  });

  it("exige presentarse antes de administrar", () => {
    const cx = new ConexionPrueba("cx-1");
    hub.conectar(cx);
    hub.recibir(cx.id, { tipo: "admin", accion: "listar_terminales" });
    expect(cx.ultimo("error")!.codigo).toBe("no_emparejado");
  });
});

describe("revocar una terminal", () => {
  /** Una caja ya autorizada y una tablet autorizada por ella. */
  function local() {
    const caja = new ConexionPrueba("cx-caja");
    saludar(caja, "dev-caja");
    log.aprobarDispositivo("dev-caja");

    const tablet = new ConexionPrueba("cx-tablet");
    saludar(tablet, "dev-tablet");
    log.aprobarDispositivo("dev-tablet");

    return { caja, tablet };
  }

  it("la deja fuera del local", () => {
    const { caja } = local();
    hub.recibir(caja.id, { tipo: "admin", accion: "revocar", device_id: "dev-tablet" });
    expect(log.dispositivo("dev-tablet")!.aprobado).toBe(false);
  });

  it("la desconecta en el acto, no en su próximo arranque", () => {
    const { caja, tablet } = local();
    hub.recibir(caja.id, { tipo: "admin", accion: "revocar", device_id: "dev-tablet" });

    // Revocar sin expulsar no serviría: seguiría escribiendo hasta que
    // alguien fuera a apagarla físicamente.
    expect(tablet.ultimo("error")!.codigo).toBe("no_emparejado");
    expect(tablet.cerrada).toBe(true);
  });

  it("conserva su registro: hay que poder ver que existió", () => {
    const { caja } = local();
    hub.recibir(caja.id, { tipo: "admin", accion: "revocar", device_id: "dev-tablet" });
    expect(log.dispositivo("dev-tablet")).not.toBeNull();
  });

  it("una terminal NO puede revocarse a sí misma", () => {
    const { caja } = local();
    hub.recibir(caja.id, { tipo: "admin", accion: "revocar", device_id: "dev-caja" });

    // Si pudiera, la única terminal autorizada de un local podría dejarlo sin
    // nadie capaz de autorizar a nadie, y habría que reinstalar el Hub.
    expect(caja.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(log.dispositivo("dev-caja")!.aprobado).toBe(true);
  });

  it("una terminal sin autorizar no puede revocar a nadie", () => {
    saludar(new ConexionPrueba("cx-caja"), "dev-caja");
    const intrusa = new ConexionPrueba("cx-intrusa");
    saludar(intrusa, "dev-intrusa");

    hub.recibir(intrusa.id, { tipo: "admin", accion: "revocar", device_id: "dev-caja" });
    expect(intrusa.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(log.dispositivo("dev-caja")!.aprobado).toBe(true);
  });
});

describe("enlace de emparejamiento", () => {
  it("lo compone el Hub, que es quien conoce sus direcciones", () => {
    const conEnlaces = new Hub({
      hub_id: "hub-1",
      log,
      exigirAprobacion: false,
      enlaces: () => [{ etiqueta: "192.168.1.50", url: "https://192.168.1.50:8787/?hub=…&k=…" }],
    });

    const caja = new ConexionPrueba("cx-caja");
    conEnlaces.conectar(caja);
    conEnlaces.recibir(caja.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });
    conEnlaces.recibir(caja.id, { tipo: "admin", accion: "enlace_emparejamiento" });

    expect(caja.ultimo("enlace")!.enlaces).toHaveLength(1);
  });

  it("solo una terminal autorizada puede pedirlo: lleva la clave del local", () => {
    saludar(new ConexionPrueba("cx-caja"), "dev-caja");
    const intrusa = new ConexionPrueba("cx-intrusa");
    saludar(intrusa, "dev-intrusa");

    hub.recibir(intrusa.id, { tipo: "admin", accion: "enlace_emparejamiento" });
    expect(intrusa.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(intrusa.ultimo("enlace")).toBeUndefined();
  });
});

// --- Revalidación de permisos ---------------------------------------------------------------

describe("el Hub revalida permisos", () => {
  const propietario = usuarioDePrueba("emp-propietario", "propietario");
  const gerente = usuarioDePrueba("emp-gerente", "gerente");
  const mesero = usuarioDePrueba("emp-mesero", "mesero");

  function cancelacionDe(empleadoId: string) {
    const fabrica = new FabricaEventos<EventoComanda>({
      device_id: "dev-tablet", empleado_id: empleadoId, sucursal_id: SUC,
    });
    return fabrica.crear("item_cancelado", "ord-1", {
      orden_id: "ord-1", renglon_id: "ren-1",
    });
  }

  it("rechaza una cancelación contra la proyección que cargó del stream", () => {
    const conAutoridad = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    conAutoridad.cargarIdentidad(SUC, semillaDeIdentidad(propietario, mesero));

    const cx = new ConexionPrueba("cx-1");
    conAutoridad.conectar(cx);
    conAutoridad.recibir(cx.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-tablet", sucursal_id: SUC, desde_seq: 0,
    });
    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [cancelacionDe(mesero.id)] });

    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
  });

  it("acepta la semilla en lote y usa el propietario recién creado para validar el resto", () => {
    const conAutoridad = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    conAutoridad.cargarIdentidad(SUC, []);
    const cx = new ConexionPrueba("cx-1");
    conAutoridad.conectar(cx);
    conAutoridad.recibir(cx.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    const fabrica = new FabricaEventos<EventoIdentidad>({
      device_id: "dev-caja", empleado_id: propietario.id, sucursal_id: SUC,
    });
    const eventos = [propietario, mesero].map((usuario) =>
      fabrica.crear("usuario_creado", streamIdentidad(SUC), {
        usuario_id: usuario.id,
        nombre: usuario.nombre,
        puesto: usuario.puesto,
        rol_id: usuario.rol_id,
        permisos: usuario.permisos,
      }),
    );

    conAutoridad.recibir(cx.id, { tipo: "push", eventos });
    expect(cx.ultimo("acks")!.acks).toHaveLength(2);

    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [cancelacionDe(mesero.id)] });
    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
  });

  it("no deja que un gerente se cree un propietario aunque tenga permiso de altas", () => {
    const conAutoridad = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    conAutoridad.cargarIdentidad(SUC, semillaDeIdentidad(propietario, gerente));
    const cx = new ConexionPrueba("cx-1");
    conAutoridad.conectar(cx);
    conAutoridad.recibir(cx.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-gerencia", sucursal_id: SUC, desde_seq: 0,
    });

    const fabrica = new FabricaEventos<EventoIdentidad>({
      device_id: "dev-gerencia", empleado_id: gerente.id, sucursal_id: SUC,
    });
    const autoelevacion = fabrica.crear("usuario_creado", streamIdentidad(SUC), {
      usuario_id: "emp-intruso",
      nombre: "Intruso",
      puesto: "Dirección",
      rol_id: "propietario",
      permisos: permisosDePlantilla("propietario"),
    });

    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [autoelevacion] });
    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(conAutoridad.seqActual).toBe(0);
  });

  /*
   * BORRAR PERSONAL NO SE DESHACE, así que es donde menos puede valer la palabra
   * del cliente. La pantalla ya esconde el botón a quien no es la dirección,
   * pero esconder un botón no protege de nada: una terminal manipulada manda el
   * evento igual, y la proyección lo aplicaría con un `filter` sin vuelta atrás.
   */
  it("un gerente no puede eliminar a nadie aunque su terminal mande el evento", () => {
    const conAutoridad = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    conAutoridad.cargarIdentidad(SUC, semillaDeIdentidad(propietario, gerente, mesero));
    const cx = new ConexionPrueba("cx-1");
    conAutoridad.conectar(cx);
    conAutoridad.recibir(cx.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-gerencia", sucursal_id: SUC, desde_seq: 0,
    });

    const fabrica = new FabricaEventos<EventoIdentidad>({
      device_id: "dev-gerencia", empleado_id: gerente.id, sucursal_id: SUC,
    });
    const baja = fabrica.crear("usuario_eliminado", streamIdentidad(SUC), {
      usuario_id: mesero.id,
      eliminado_por: gerente.id,
      nombre: mesero.nombre,
    });

    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [baja] });
    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
    expect(conAutoridad.seqActual).toBe(0);
  });

  it("el propietario sí, y el evento entra al registro del local", () => {
    const conAutoridad = new Hub({ hub_id: "hub-1", log, exigirAprobacion: false });
    conAutoridad.cargarIdentidad(SUC, semillaDeIdentidad(propietario, mesero));
    const cx = new ConexionPrueba("cx-1");
    conAutoridad.conectar(cx);
    conAutoridad.recibir(cx.id, {
      tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0,
    });

    const fabrica = new FabricaEventos<EventoIdentidad>({
      device_id: "dev-caja", empleado_id: propietario.id, sucursal_id: SUC,
    });
    const baja = fabrica.crear("usuario_eliminado", streamIdentidad(SUC), {
      usuario_id: mesero.id,
      eliminado_por: propietario.id,
      nombre: mesero.nombre,
    });

    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [baja] });
    expect(cx.ultimo("acks")!.acks).toHaveLength(1);

    // Y a partir de aquí el eliminado ya no firma nada: dejó de existir.
    conAutoridad.recibir(cx.id, { tipo: "push", eventos: [cancelacionDe(mesero.id)] });
    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
  });

  it("falla cerrado cuando no se cargó ninguna autoridad de identidad", () => {
    const cx = new ConexionPrueba("cx-1");
    saludar(cx, "dev-tablet");

    hub.recibir(cx.id, { tipo: "push", eventos: [cancelacionDe("emp-quien-sea")] });
    expect(cx.ultimo("error")!.codigo).toBe("permiso_denegado");
  });
});
