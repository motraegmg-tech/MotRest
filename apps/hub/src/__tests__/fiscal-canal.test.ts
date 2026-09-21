/**
 * La facturación por el canal cifrado del Hub.
 *
 * Lo que se verifica aquí es quién puede hacer qué. Administrar el CSD es
 * entregar la firma fiscal del negocio: no basta con que el aparato pertenezca
 * al local, tiene que poder la persona.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import { VERSION_PROTOCOLO, type MensajeHub } from "@motrest/protocolo-sync";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { permisosDePlantilla, type RolId, type Usuario } from "@motrest/dominio";
import { Hub, type Conexion } from "../servidor.js";
import { Sellador } from "../fiscal/sellador.js";
import { ColaDeTimbrado } from "../fiscal/cola-timbrado.js";
import { generarCsdDePrueba, type CsdDePrueba } from "./csd-de-prueba.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const RFC = "AAA010101AAA";

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
  ultimo<T extends MensajeHub["tipo"]>(tipo: T): Extract<MensajeHub, { tipo: T }> | undefined {
    return [...this.recibidos].reverse().find((m) => m.tipo === tipo) as never;
  }
}

function usuario(id: string, rol_id: RolId, activo = true): Usuario {
  return {
    id,
    nombre: `Usuario ${id}`,
    iniciales: "US",
    rol_id,
    puesto: rol_id,
    sucursal_id: SUC,
    permisos: permisosDePlantilla(rol_id),
    activo,
  };
}

const USUARIOS: Record<string, Usuario> = {
  "emp-gonzalo": usuario("emp-gonzalo", "propietario"),
  "emp-mesero": usuario("emp-mesero", "mesero"),
  "emp-baja": usuario("emp-baja", "propietario", false),
  // Cierra el mes y timbra, pero no administra el CSD: es el caso que separa
  // los dos permisos de la 1.5.6.
  "emp-conta": usuario("emp-conta", "administracion"),
};

let csd: CsdDePrueba;
let log: LogHub;
let db: TipoDb;
let hub: Hub;
let carpeta: string;
let sellador: Sellador;
let cola: ColaDeTimbrado;
let cx: ConexionPrueba;
/** Lo que el canal le pidió al emisor de globales, en orden. */
let globalesPedidas: { periodo: string; ordenes: readonly string[]; autorizador_id: string }[];

beforeAll(async () => {
  csd = await generarCsdDePrueba({ rfc: RFC });
});

beforeEach(() => {
  log = new LogHub(":memory:");
  db = new DatabaseSync(":memory:");
  carpeta = mkdtempSync(join(tmpdir(), "motrest-canal-"));
  sellador = new Sellador(carpeta);
  cola = new ColaDeTimbrado(db, null);

  globalesPedidas = [];
  hub = new Hub({
    hub_id: "hub-prueba",
    log,
    exigirAprobacion: false,
    usuarioDe: (id) => USUARIOS[id],
    fiscal: {
      sellador,
      cola,
      nombrePac: "PAC de prueba",
      emitirGlobal: (peticion) => {
        globalesPedidas.push({ ...peticion });
        return Promise.resolve({ ok: true });
      },
    },
  });

  cx = new ConexionPrueba("cx-1");
  hub.conectar(cx);
  hub.recibir(cx.id, {
    tipo: "hola",
    v: VERSION_PROTOCOLO,
    device_id: "dev-caja",
    sucursal_id: SUC,
    desde_seq: 0,
  });
});

afterEach(() => {
  log.cerrar();
  db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

function pedir(accion: string, empleado_id: string, extra: Record<string, unknown> = {}): void {
  hub.recibir(cx.id, { tipo: "fiscal", accion, empleado_id, ...extra } as never);
}

function instalar(empleado_id: string): void {
  pedir("instalar_csd", empleado_id, {
    cer: Buffer.from(csd.cer).toString("base64"),
    key: Buffer.from(csd.key).toString("base64"),
    contrasena: csd.contrasena,
    rfc_emisor: RFC,
  });
}

// --- Quién puede -------------------------------------------------------------------------

describe("quién puede administrar el CSD", () => {
  it("el propietario lo instala", () => {
    instalar("emp-gonzalo");

    expect(cx.ultimo("fiscal")?.problema).toBeUndefined();
    expect(cx.ultimo("fiscal")?.estado.csd_cargado).toBe(true);
    expect(sellador.listo).toBe(true);
  });

  /*
   * Un mesero puede tener terminal autorizada y sesión válida. Eso lo habilita
   * para vender, no para entregarle a nadie la firma fiscal del negocio.
   */
  it("un mesero NO puede, aunque su terminal esté autorizada", () => {
    instalar("emp-mesero");

    expect(cx.ultimo("error")?.codigo).toBe("permiso_denegado");
    expect(sellador.listo).toBe(false);
  });

  it("un usuario dado de baja tampoco", () => {
    instalar("emp-baja");

    expect(cx.ultimo("error")?.mensaje).toMatch(/desactivado/);
    expect(sellador.listo).toBe(false);
  });

  it("un empleado que no existe tampoco", () => {
    instalar("emp-fantasma");

    expect(cx.ultimo("error")?.mensaje).toMatch(/desconocido/i);
    expect(sellador.listo).toBe(false);
  });

  /*
   * Para todo lo demás, no saber significa no arbitrar. Aquí significaría
   * regalar la firma fiscal a quien pregunte, así que se deniega.
   */
  it("sin tabla de usuarios se DENIEGA, no se deja pasar", () => {
    const sinUsuarios = new Hub({
      hub_id: "hub-2",
      log,
      exigirAprobacion: false,
      fiscal: { sellador, cola },
    });
    const otra = new ConexionPrueba("cx-2");
    sinUsuarios.conectar(otra);
    sinUsuarios.recibir(otra.id, {
      tipo: "hola",
      v: VERSION_PROTOCOLO,
      device_id: "dev-2",
      sucursal_id: SUC,
      desde_seq: 0,
    });
    sinUsuarios.recibir(otra.id, {
      tipo: "fiscal",
      accion: "desinstalar_csd",
      empleado_id: "emp-gonzalo",
    });

    expect(otra.ultimo("error")?.codigo).toBe("permiso_denegado");
  });

  it("desinstalar exige el mismo permiso que instalar", () => {
    instalar("emp-gonzalo");
    expect(sellador.listo).toBe(true);

    pedir("desinstalar_csd", "emp-mesero");
    expect(sellador.listo).toBe(true);

    pedir("desinstalar_csd", "emp-gonzalo");
    expect(sellador.listo).toBe(false);
  });
});

// --- Quién puede emitir la factura global (1.5.6) -----------------------------------------

/** La respuesta de `emitir_global` llega tras un `await`: hay que dejarla pasar. */
async function emitirGlobal(empleado_id: string, extra: Record<string, unknown> = {}): Promise<void> {
  pedir("emitir_global", empleado_id, { periodo: "2026-09", ordenes: ["ord-1"], ...extra });
  await new Promise((listo) => setTimeout(listo, 0));
}

describe("quién puede emitir la factura global", () => {
  /*
   * Es OTRO permiso que el del CSD. Administrar el certificado es entregar la
   * firma fiscal del negocio; emitir una factura es usarla. Quien cierra el mes
   * tiene que poder timbrar sin que nadie le entregue el certificado.
   */
  it("quien administra la contabilidad puede, sin tocar el CSD", async () => {
    await emitirGlobal("emp-conta");

    expect(cx.ultimo("error")).toBeUndefined();
    expect(globalesPedidas).toEqual([
      { periodo: "2026-09", ordenes: ["ord-1"], autorizador_id: "emp-conta" },
    ]);
  });

  it("un mesero NO puede, aunque su terminal esté autorizada", async () => {
    await emitirGlobal("emp-mesero");

    expect(cx.ultimo("error")?.codigo).toBe("permiso_denegado");
    expect(globalesPedidas).toEqual([]);
  });

  it("un usuario dado de baja tampoco", async () => {
    await emitirGlobal("emp-baja");

    expect(cx.ultimo("error")?.mensaje).toMatch(/desactivado/);
    expect(globalesPedidas).toEqual([]);
  });

  /*
   * El autorizador sale de quien mandó la petición —ya verificado contra la
   * tabla de usuarios del Hub—, nunca de un campo del mensaje. Si la caja
   * pudiera decir «lo autorizó el dueño», la firma no valdría nada.
   */
  it("el autorizador es quien pide, no lo que diga la tableta", async () => {
    await emitirGlobal("emp-conta", { autorizador_id: "emp-gonzalo" });

    expect(globalesPedidas[0]?.autorizador_id).toBe("emp-conta");
  });

  it("sin mes o sin cuentas lo dice en vez de emitir a medias", async () => {
    await emitirGlobal("emp-conta", { periodo: undefined });
    expect(cx.ultimo("fiscal")?.problema).toMatch(/Falta el mes/);

    await emitirGlobal("emp-conta", { ordenes: [] });
    expect(cx.ultimo("fiscal")?.problema).toMatch(/ninguna cuenta/);

    expect(globalesPedidas).toEqual([]);
  });
});

// --- Consultar sí es de todos ------------------------------------------------------------

describe("consultar el estado de la facturación", () => {
  /*
   * Quien cobra tiene que poder ver si la factura salió. Consultar no es
   * administrar.
   */
  it("un mesero puede consultar el estado", () => {
    pedir("estado", "emp-mesero");

    expect(cx.ultimo("error")).toBeUndefined();
    expect(cx.ultimo("fiscal")?.estado.csd_cargado).toBe(false);
  });

  it("informa qué PAC está configurado y cómo va la cola", () => {
    pedir("estado", "emp-mesero");

    expect(cx.ultimo("fiscal")?.estado.pac).toBe("PAC de prueba");
    expect(cx.ultimo("fiscal")?.estado.cola).toEqual({
      pendientes: 0,
      timbradas: 0,
      rechazadas: 0,
    });
  });

  it("la lista de la cola solo llega cuando se pide", () => {
    pedir("estado", "emp-mesero");
    expect(cx.ultimo("fiscal")?.cola).toBeUndefined();

    pedir("listar_cola", "emp-mesero");
    expect(cx.ultimo("fiscal")?.cola).toEqual([]);
  });
});

// --- Lo que nunca sale del Hub -----------------------------------------------------------

describe("lo que el Hub NO devuelve", () => {
  it("el estado del CSD jamás incluye la llave ni la contraseña", () => {
    instalar("emp-gonzalo");
    pedir("estado", "emp-gonzalo");

    const texto = JSON.stringify(cx.ultimo("fiscal"));
    expect(texto).not.toContain(csd.contrasena);
    expect(texto).not.toContain(Buffer.from(csd.key).toString("base64"));
  });

  it("sí devuelve lo que hace falta para saber si se puede facturar", () => {
    instalar("emp-gonzalo");

    const estado = cx.ultimo("fiscal")!.estado;
    expect(estado.rfc).toBe(RFC);
    expect(estado.no_certificado).toHaveLength(20);
    expect(estado.dias_restantes).toBeGreaterThan(300);
  });
});

// --- Errores que orientan ----------------------------------------------------------------

describe("cuando el CSD no sirve", () => {
  it("explica el problema en vez de fallar en silencio", () => {
    pedir("instalar_csd", "emp-gonzalo", {
      cer: Buffer.from(csd.cer).toString("base64"),
      key: Buffer.from(csd.key).toString("base64"),
      contrasena: "equivocada",
      rfc_emisor: RFC,
    });

    expect(cx.ultimo("fiscal")?.problema).toMatch(/contraseña/i);
    expect(sellador.listo).toBe(false);
  });

  it("avisa si faltan archivos en vez de intentarlo a medias", () => {
    pedir("instalar_csd", "emp-gonzalo", { rfc_emisor: RFC });
    expect(cx.ultimo("fiscal")?.problema).toMatch(/Faltan/);
  });

  it("un Hub sin facturación configurada lo dice", () => {
    const pelado = new Hub({ hub_id: "h3", log, exigirAprobacion: false });
    const otra = new ConexionPrueba("cx-3");
    pelado.conectar(otra);
    pelado.recibir(otra.id, {
      tipo: "hola",
      v: VERSION_PROTOCOLO,
      device_id: "dev-3",
      sucursal_id: SUC,
      desde_seq: 0,
    });
    pelado.recibir(otra.id, { tipo: "fiscal", accion: "estado", empleado_id: "emp-gonzalo" });

    expect(otra.ultimo("error")?.mensaje).toMatch(/facturación/i);
  });
});
