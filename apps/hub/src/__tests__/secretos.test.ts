/**
 * Las llaves del Hub: el par, los sobres de Central, la caja y quién gana.
 *
 * Lo que no puede fallar: que un sobre ajeno —de otro Hub, de otro local, más
 * viejo que lo vigente— se aplique; que la caja pueda guardar una llave que
 * FacturAPI no reconoce; y que el valor aparezca en cualquier cosa que se
 * enseñe.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import {
  cerrarSobre,
  generarParDeSobre,
  permisosDePlantilla,
  type RolId,
  type Secreto,
  type Usuario,
} from "@motrest/dominio";
import { VERSION_PROTOCOLO, type MensajeHub } from "@motrest/protocolo-sync";
import { LogHub } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "../servidor.js";
import { ColaDeTimbrado } from "../fiscal/cola-timbrado.js";
import { Sellador } from "../fiscal/sellador.js";
import { probarLlaveFacturapi } from "../fiscal/facturapi.js";
import {
  SecretosDelHub,
  type AlmacenDeSecretos,
  type FacturapiGuardada,
  type GmailGuardada,
} from "../secretos.js";
import { FacturapiFalsa, LLAVE_PRUEBA, LLAVE_VIVA } from "./facturapi-falsa.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const SUC = "suc-rodizio";
const CONTRASENA = "abcd efgh ijkl mnop";

class AlmacenEnMemoria implements AlmacenDeSecretos {
  facturapi: FacturapiGuardada | null = null;
  gmail: GmailGuardada | null = null;
  async leerFacturapi() {
    return this.facturapi;
  }
  async guardarFacturapi(d: FacturapiGuardada) {
    this.facturapi = structuredClone(d);
  }
  async leerGmail() {
    return this.gmail;
  }
  async guardarGmail(d: GmailGuardada) {
    this.gmail = structuredClone(d);
  }
}

let carpeta: string;
let api: FacturapiFalsa;
let almacen: AlmacenEnMemoria;
let cambios: string[];
let bitacora: string[];

function nuevos(): SecretosDelHub {
  return new SecretosDelHub({
    almacen,
    rutaPar: join(carpeta, "sobre-hub.json"),
    sucursal: () => SUC,
    probarFacturapi: (llave) => probarLlaveFacturapi(llave, { fetch: api.fetch }),
    alCambiar: (clase) => cambios.push(clase),
    registrar: (_n, m) => bitacora.push(m),
  });
}

function secretoFacturapi(extra: Partial<Secreto> = {}): Secreto {
  return {
    clase: "facturapi",
    llave: LLAVE_VIVA,
    modo: "produccion",
    sucursal_id: SUC,
    emitido_ts: 1_000,
    origen: "central",
    ...extra,
  } as Secreto;
}

beforeEach(() => {
  carpeta = mkdtempSync(join(tmpdir(), "motrest-secretos-"));
  api = new FacturapiFalsa();
  almacen = new AlmacenEnMemoria();
  cambios = [];
  bitacora = [];
});

afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

describe("el par del Hub", () => {
  it("se genera una vez, se guarda junto a la base y se reutiliza", async () => {
    const a = nuevos();
    await a.cargar();
    const publica = a.llavePublica();
    expect(publica).toHaveLength(44);
    expect(existsSync(join(carpeta, "sobre-hub.json"))).toBe(true);

    const b = nuevos();
    await b.cargar();
    expect(b.llavePublica()).toBe(publica);
  });

  it("si el archivo se daña, genera otro y lo dice", async () => {
    const a = nuevos();
    await a.cargar();
    const ruta = join(carpeta, "sobre-hub.json");
    requerir("node:fs").writeFileSync(ruta, "basura");
    const b = nuevos();
    await b.cargar();
    expect(b.llavePublica()).not.toBe(a.llavePublica());
    expect(bitacora.some((l) => /dañado/.test(l))).toBe(true);
  });
});

describe("recibir de Central", () => {
  it("abre su sobre, prueba la llave y la aplica", async () => {
    const s = nuevos();
    await s.cargar();
    const sobre = await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi()));
    const r = await s.recibirDeLaNube({ clase: "facturapi", sobre });
    expect(r).toEqual({ ok: true, aplicado: true });
    expect(s.estado().facturapi).toMatchObject({
      configurada: true,
      modo: "produccion",
      origen: "central",
      termina_en: "9876",
      razon_social: "RODIZIO",
      rfc: "AAA010101AAA",
      lista: true,
    });
    expect(s.facturapiVigente()?.llave).toBe(LLAVE_VIVA);
    expect(cambios).toEqual(["facturapi"]);
  });

  it("un sobre cerrado para otro Hub no se abre", async () => {
    const s = nuevos();
    await s.cargar();
    const otro = await generarParDeSobre();
    const sobre = await cerrarSobre(otro.publica, JSON.stringify(secretoFacturapi()));
    const r = await s.recibirDeLaNube({ clase: "facturapi", sobre });
    expect(r.aplicado).toBe(false);
    expect(r.problema).toMatch(/no se pudo abrir/);
    expect(s.estado().facturapi.configurada).toBe(false);
  });

  it("un secreto de otro restaurante se rechaza", async () => {
    const s = nuevos();
    await s.cargar();
    const sobre = await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi({ sucursal_id: "suc-otro" })));
    const r = await s.recibirDeLaNube({ clase: "facturapi", sobre });
    expect(r).toMatchObject({ ok: false, aplicado: false });
    expect(r.problema).toMatch(/otro restaurante/);
  });

  it("uno más viejo que el vigente no gana, y se dice por qué", async () => {
    const s = nuevos();
    await s.cargar();
    await s.recibirDeLaNube({
      clase: "facturapi",
      sobre: await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi({ emitido_ts: 5_000 }))),
    });
    const viejo = await cerrarSobre(
      s.llavePublica(),
      JSON.stringify(
        secretoFacturapi({ emitido_ts: 4_000, llave: `sk_${"live"}_VIEJAVIEJAVIEJAVIEJA0000` }),
      ),
    );
    const r = await s.recibirDeLaNube({ clase: "facturapi", sobre: viejo });
    expect(r).toMatchObject({ ok: true, aplicado: false });
    expect(r.problema).toMatch(/más reciente/);
    expect(s.facturapiVigente()?.llave).toBe(LLAVE_VIVA);
  });

  it("sin internet para comprobarla, la de Central se acepta y queda por verificar", async () => {
    const s = nuevos();
    await s.cargar();
    api.caida = true;
    const r = await s.recibirDeLaNube({
      clase: "facturapi",
      sobre: await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi())),
    });
    expect(r.aplicado).toBe(true);
    expect(s.estado().facturapi.error).toMatch(/sin internet/);

    api.caida = false;
    await s.verificar();
    expect(s.estado().facturapi.error).toBeUndefined();
    expect(s.estado().facturapi.razon_social).toBe("RODIZIO");
  });

  it("una llave que FacturAPI no reconoce no se aplica ni desde Central", async () => {
    const s = nuevos();
    await s.cargar();
    api.llaves.clear();
    const r = await s.recibirDeLaNube({
      clase: "facturapi",
      sobre: await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi())),
    });
    expect(r.aplicado).toBe(false);
    expect(r.problema).toMatch(/no reconoce/);
  });
});

describe("guardar desde la caja", () => {
  it("la llave se prueba ANTES de guardarse; sin red, se dice a quien la pegó", async () => {
    const s = nuevos();
    await s.cargar();
    api.caida = true;
    const sinRed = await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_PRUEBA });
    expect(sinRed.ok).toBe(false);
    expect(sinRed.problema).toMatch(/internet/);

    api.caida = false;
    const bien = await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_PRUEBA });
    expect(bien.ok).toBe(true);
    expect(s.estado().facturapi).toMatchObject({ configurada: true, modo: "pruebas", origen: "local" });
  });

  it("una llave mal copiada no llega ni a FacturAPI", async () => {
    const s = nuevos();
    await s.cargar();
    const r = await s.guardarDesdeCaja({ clase: "facturapi", valor: "sk_live_corta", modo: "produccion" });
    expect(r.problema).toMatch(/sk_live_/);
    expect(api.peticiones).toHaveLength(0);
  });

  it("la caja gana aunque su reloj vaya atrás del de Central", async () => {
    const s = nuevos();
    await s.cargar();
    const futuro = Date.now() + 3_600_000;
    await s.recibirDeLaNube({
      clase: "facturapi",
      sobre: await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi({ emitido_ts: futuro }))),
    });
    const r = await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_PRUEBA });
    expect(r.aplicado).toBe(true);
    expect(s.facturapiVigente()?.llave).toBe(LLAVE_PRUEBA);
  });

  it("quitar deja una lápida: un sobre viejo que llega tarde no la resucita", async () => {
    const s = nuevos();
    await s.cargar();
    await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_PRUEBA });
    await s.quitarDesdeCaja("facturapi");
    expect(s.facturapiVigente()).toBeNull();

    const r = await s.recibirDeLaNube({
      clase: "facturapi",
      sobre: await cerrarSobre(s.llavePublica(), JSON.stringify(secretoFacturapi({ emitido_ts: 1_000 }))),
    });
    expect(r.aplicado).toBe(false);
    expect(s.facturapiVigente()).toBeNull();
  });

  it("Gmail: 16 letras con o sin espacios, y el remitente junto", async () => {
    const s = nuevos();
    await s.cargar();
    expect((await s.guardarDesdeCaja({ clase: "gmail", valor: "corta" })).ok).toBe(false);
    const r = await s.guardarDesdeCaja({ clase: "gmail", valor: CONTRASENA, remitente: "rodizio@gmail.com" });
    expect(r.ok).toBe(true);
    expect(almacen.gmail?.contrasena).toBe("abcdefghijklmnop");
    expect(s.estado().gmail).toMatchObject({ configurada: true, termina_en: "mnop", remitente: "rodizio@gmail.com" });
  });

  it("ni el estado ni la bitácora llevan el valor", async () => {
    const s = nuevos();
    await s.cargar();
    await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_VIVA });
    await s.guardarDesdeCaja({ clase: "gmail", valor: CONTRASENA });
    const visible = JSON.stringify(s.estado()) + bitacora.join("\n");
    expect(visible).not.toContain(LLAVE_VIVA);
    expect(visible).not.toContain("abcdefghijklmnop");
    // La privada del par tampoco sale del archivo.
    expect(readFileSync(join(carpeta, "sobre-hub.json"), "utf8")).toContain("privada");
  });
});

// --- Por el canal cifrado, con el permiso POR ROL --------------------------------------

class ConexionPrueba implements Conexion {
  recibidos: MensajeHub[] = [];
  constructor(public id: string) {}
  enviar(m: MensajeHub): void {
    this.recibidos.push(m);
  }
  cerrar(): void {}
  ultimo<T extends MensajeHub["tipo"]>(tipo: T): Extract<MensajeHub, { tipo: T }> | undefined {
    return [...this.recibidos].reverse().find((m) => m.tipo === tipo) as never;
  }
}

function usuario(id: string, rol_id: RolId, activo = true, permisos = permisosDePlantilla(rol_id)): Usuario {
  return { id, nombre: id, iniciales: "U", rol_id, puesto: rol_id, sucursal_id: SUC, permisos, activo };
}

describe("el mensaje «secreto» del canal", () => {
  const USUARIOS: Record<string, Usuario> = {
    "emp-dueno": usuario("emp-dueno", "propietario"),
    "usr-motrae-soporte": usuario("usr-motrae-soporte", "soporte" as RolId),
    // Un gerente con TODOS los permisos del dueño, dados a mano: sigue sin poder.
    "emp-gerente": usuario("emp-gerente", "gerente", true, permisosDePlantilla("propietario")),
    "emp-mesero": usuario("emp-mesero", "mesero"),
    "emp-baja": usuario("emp-baja", "propietario", false),
  };
  let log: LogHub;
  let db: TipoDb;
  let cx: ConexionPrueba;
  let hub: Hub;
  let s: SecretosDelHub;

  beforeEach(async () => {
    log = new LogHub(":memory:");
    db = new DatabaseSync(":memory:");
    s = nuevos();
    await s.cargar();
    hub = new Hub({
      hub_id: "hub",
      log,
      exigirAprobacion: false,
      usuarioDe: (id) => USUARIOS[id],
      fiscal: { sellador: new Sellador(join(carpeta, "csd")), cola: new ColaDeTimbrado(db, null) },
      secretos: s,
    });
    cx = new ConexionPrueba("cx");
    hub.conectar(cx);
    hub.recibir(cx.id, { tipo: "hola", v: VERSION_PROTOCOLO, device_id: "dev-caja", sucursal_id: SUC, desde_seq: 0 });
  });

  afterEach(() => {
    log.cerrar();
    db.close();
  });

  const pedir = async (m: Record<string, unknown>) => {
    hub.recibir(cx.id, { tipo: "secreto", ...m } as never);
    // Guardar prueba la llave contra FacturAPI: se espera a que conteste.
    for (let i = 0; i < 20 && !cx.recibidos.some((r) => r.tipo === "secreto"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const r = cx.ultimo("secreto");
    cx.recibidos = [];
    return r!;
  };

  it("consultar lo puede cualquiera del local, y no trae la llave", async () => {
    await s.guardarDesdeCaja({ clase: "facturapi", valor: LLAVE_VIVA });
    const r = await pedir({ accion: "consultar", empleado_id: "emp-mesero" });
    expect(r.ok).toBe(true);
    expect(r.estado.facturapi.configurada).toBe(true);
    expect(JSON.stringify(r)).not.toContain(LLAVE_VIVA);
  });

  it("guardar: el responsable y el soporte sí; nadie más, ni con permisos a mano", async () => {
    for (const quien of ["emp-mesero", "emp-gerente", "emp-baja", "emp-desconocido"]) {
      const r = await pedir({ accion: "guardar", empleado_id: quien, clase: "facturapi", valor: LLAVE_PRUEBA });
      expect(r.ok, quien).toBe(false);
      expect(r.problema).toMatch(/responsable/);
    }
    expect(s.estado().facturapi.configurada).toBe(false);

    const dueno = await pedir({ accion: "guardar", empleado_id: "emp-dueno", clase: "facturapi", valor: LLAVE_PRUEBA });
    expect(dueno.ok).toBe(true);
    expect(dueno.estado.facturapi).toMatchObject({ configurada: true, modo: "pruebas", origen: "local" });

    const soporte = await pedir({ accion: "quitar", empleado_id: "usr-motrae-soporte", clase: "facturapi" });
    expect(soporte.ok).toBe(true);
    expect(soporte.estado.facturapi.configurada).toBe(false);
  });

  it("una llave rechazada por FacturAPI vuelve con el motivo", async () => {
    api.llaves.clear();
    const r = await pedir({ accion: "guardar", empleado_id: "emp-dueno", clase: "facturapi", valor: LLAVE_PRUEBA });
    expect(r.ok).toBe(false);
    expect(r.problema).toMatch(/no reconoce/);
  });

  it("una terminal sin aprobar no consulta nada", async () => {
    log.revocarDispositivo("dev-caja");
    hub.recibir(cx.id, { tipo: "secreto", accion: "consultar", empleado_id: "emp-dueno" });
    await new Promise((r) => setTimeout(r, 5));
    expect(cx.ultimo("error")?.codigo).toBe("permiso_denegado");
    expect(cx.ultimo("secreto")).toBeUndefined();
  });
});
