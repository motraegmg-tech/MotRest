/**
 * El acceso web desde Central (1.6.0), contra una nube simulada.
 *
 * Lo que tiene que quedar garantizado:
 * - el usuario web lleva `sucursal_web` y NUNCA `sucursal_id` (heredaría los
 *   permisos del Hub en todas las tablas);
 * - lo que se deja en la nube es la clave remota ENVUELTA, que se abre con la
 *   contraseña y con nada más;
 * - la modalidad viaja firmada en la licencia, con la pública del buzón;
 * - Gonzalo puede ver la contraseña, incluso la que eligió el propietario.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cerrarSobre,
  desenvolverClaveRemota,
  modalidadDe,
  pesos,
  verificarLicencia,
} from "@motrest/dominio";
import { crearCentralParaPruebas, type StoreCentral } from "../central.svelte";

let central: StoreCentral;
const originalFetch = global.fetch;

interface Llamada {
  ruta: string;
  metodo: string;
  cuerpo: string;
}

let llamadas: Llamada[];
/** Filas de `accesos_web` que la nube «tiene», para la recogida. */
let filasAccesos: unknown[];

function respuesta(estado: number, cuerpo: unknown = ""): Response {
  return {
    ok: estado < 300,
    status: estado,
    text: async () => (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)),
    headers: { get: () => null },
  } as unknown as Response;
}

beforeEach(async () => {
  llamadas = [];
  filasAccesos = [];
  global.fetch = vi.fn(async (url: string | URL | Request, opciones?: RequestInit) => {
    const ruta = String(url).replace("https://ixt.supabase.co", "");
    const metodo = opciones?.method ?? "GET";
    llamadas.push({ ruta, metodo, cuerpo: String(opciones?.body ?? "") });
    if (ruta === "/auth/v1/admin/users" && metodo === "POST") {
      const email = (JSON.parse(String(opciones?.body)) as { email: string }).email;
      return respuesta(200, { id: email.startsWith("web-") ? "usuario-web-1" : "usuario-hub-1" });
    }
    if (ruta.startsWith("/rest/v1/accesos_web?select=")) return respuesta(200, filasAccesos);
    return respuesta(200, "");
  }) as unknown as typeof fetch;

  central = crearCentralParaPruebas();
  central.clientes = [];
  central.pulsos = [];
  await central.generarPares();
  await central.guardarConfiguracion({
    repositorio: "motrae/motrest",
    nube_url: "https://ixt.supabase.co",
    nube_servicio: "sb_secret_de_prueba",
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

async function altaRodizio() {
  const r = await central.alta({ nombre: "Rodizio", sufijo: "Centro", contacto: "Dueño", plan: "mensual", cuota: pesos(1_500) });
  return r.cliente!.id;
}

const cuerpoDe = (predicado: (l: Llamada) => boolean) =>
  JSON.parse(llamadas.find(predicado)!.cuerpo) as Record<string, unknown>;

describe("encender el acceso web", () => {
  it("crea un usuario web con sucursal_web, nunca con sucursal_id", async () => {
    const id = await altaRodizio();
    const r = await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "rodizio" });
    expect(r.ok).toBe(true);

    const usuario = cuerpoDe((l) => l.ruta === "/auth/v1/admin/users" && l.cuerpo.includes("web-"));
    expect(usuario.email).toBe(`web-${id}@web.motrae.mx`);
    expect(usuario.app_metadata).toEqual({ sucursal_web: id });
  });

  it("deja en la nube la clave remota envuelta, que abre solo con la contraseña", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "rodizio" });

    const fila = cuerpoDe((l) => l.ruta.startsWith("/rest/v1/accesos_web?on_conflict"));
    expect(fila).toMatchObject({ sucursal_id: id, clave: "RODIZIO", modalidad: "nube", usuario_id: "usuario-web-1", activo: true });

    const contrasena = central.verContrasenaWeb(id)!;
    expect(contrasena).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(await desenvolverClaveRemota(fila.envoltura, contrasena)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await desenvolverClaveRemota(fila.envoltura, "otra-contrasena")).toBeNull();
    // La contraseña no viaja en claro a ninguna tabla.
    expect(llamadas.filter((l) => l.ruta.startsWith("/rest/")).some((l) => l.cuerpo.includes(contrasena))).toBe(false);
  });

  it("la contraseña y la clave remota nunca llegan a la cartera ni al respaldo de la cartera", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "rodizio" });
    const contrasena = central.verContrasenaWeb(id)!;
    expect(central.exportar()).not.toContain(contrasena);
    expect(JSON.stringify(central.secretos)).not.toContain(contrasena);
  });

  it("la licencia sale con la modalidad y el buzón, dentro de la firma", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "rodizio" });
    const r = await central.emitir(id);
    expect(r.ok).toBe(true);
    expect(modalidadDe(r.licencia)).toBe("nube");
    expect(r.licencia!.web!.buzon_central).toMatch(/^[A-Za-z0-9+/=]{44}$/);
    expect(await verificarLicencia(r.licencia!, id, central.secretos.licencias!.publica)).toBe(true);
  });

  it("un local en app emite licencias sin bloque web, como siempre", async () => {
    const id = await altaRodizio();
    const r = await central.emitir(id);
    expect(r.licencia!.web).toBeUndefined();
  });

  it("rechaza una clave con forma rara y avisa si la tiene otro", async () => {
    const id = await altaRodizio();
    expect((await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "ro!" })).ok).toBe(false);

    global.fetch = vi.fn(async (url: string | URL | Request, opciones?: RequestInit) =>
      String(url).includes("/rest/v1/accesos_web")
        ? respuesta(409, "duplicate")
        : String(url).endsWith("/auth/v1/admin/users") && opciones?.method === "POST"
          ? respuesta(200, { id: "u" })
          : respuesta(200, ""),
    ) as unknown as typeof fetch;
    const r = await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "RODIZIO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("otro restaurante");
    expect(central.verContrasenaWeb(id)).toBeNull();
  });
});

describe("cambiar de modalidad", () => {
  it("a un local sin licencia emitida se le pone cualquier modalidad", async () => {
    const id = await altaRodizio();
    expect((await central.configurarAccesoWeb(id, { modalidad: "nube" })).ok).toBe(true);
  });

  it("con licencia emitida, pasar de app a nube es una mudanza y se niega", async () => {
    const id = await altaRodizio();
    await central.emitir(id);
    const r = await central.configurarAccesoWeb(id, { modalidad: "nube" });
    expect(r.ok).toBe(false);
  });

  it("de app a ambas y de vuelta, sin tocar la contraseña", async () => {
    const id = await altaRodizio();
    await central.emitir(id);
    expect((await central.configurarAccesoWeb(id, { modalidad: "ambas", clave: "RODIZIO" })).ok).toBe(true);
    const contrasena = central.verContrasenaWeb(id);

    llamadas = [];
    expect((await central.configurarAccesoWeb(id, { modalidad: "app" })).ok).toBe(true);
    const apagado = cuerpoDe((l) => l.ruta.startsWith("/rest/v1/accesos_web?sucursal_id=eq.") && l.metodo === "PATCH");
    expect(apagado.activo).toBe(false);
    expect(llamadas.some((l) => l.ruta === "/rest/v1/rpc/cerrar_sesiones_web")).toBe(true);
    expect(central.estadoAccesoWeb(id).modalidad).toBe("app");

    expect((await central.configurarAccesoWeb(id, { modalidad: "ambas" })).ok).toBe(true);
    expect(central.verContrasenaWeb(id)).toBe(contrasena);
  });
});

describe("la contraseña", () => {
  it("regenerarla sube la versión, reenvuelve y cierra sesiones", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube", clave: "RODIZIO" });
    const antes = central.verContrasenaWeb(id);

    llamadas = [];
    expect((await central.regenerarContrasenaWeb(id)).ok).toBe(true);
    const nueva = central.verContrasenaWeb(id)!;
    expect(nueva).not.toBe(antes);

    const parche = cuerpoDe((l) => l.metodo === "PATCH" && l.ruta.startsWith("/rest/v1/accesos_web"));
    expect(parche.version).toBe(2);
    expect(await desenvolverClaveRemota(parche.envoltura, nueva)).not.toBeNull();
    expect(llamadas.some((l) => l.ruta === "/rest/v1/rpc/cerrar_sesiones_web")).toBe(true);
    expect(central.estadoAccesoWeb(id).version).toBe(2);
  });

  it("una contraseña escrita a mano tiene que ser aceptable", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube" });
    expect((await central.fijarContrasenaWeb(id, "corta")).ok).toBe(false);
    expect((await central.fijarContrasenaWeb(id, "pizza de la casa")).ok).toBe(true);
    expect(central.verContrasenaWeb(id)).toBe("pizza de la casa");
  });

  it("recoge la que eligió el propietario, sellada para el buzón de Central", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube" });
    const licencia = (await central.emitir(id)).licencia!;

    // Lo que haría el restaurante: sellar la nueva con la pública de la licencia.
    const sobre = await cerrarSobre(licencia.web!.buzon_central, "la del propietario 2026");
    filasAccesos = [
      { sucursal_id: id, version: 2, contrasena_para_central: sobre, cambiada_por_restaurante_ts: "2026-09-23T20:00:00Z" },
    ];

    const r = await central.recogerContrasenasDelRestaurante();
    expect(r).toEqual({ ok: true, recogidas: 1 });
    expect(central.verContrasenaWeb(id)).toBe("la del propietario 2026");
    expect(central.estadoAccesoWeb(id).cambiada_por_restaurante_ts).toBe(Date.parse("2026-09-23T20:00:00Z"));

    // Una segunda pasada con la misma versión no hace nada.
    expect(await central.recogerContrasenasDelRestaurante()).toEqual({ ok: true, recogidas: 0 });
  });

  it("un sobre sellado para otro buzón no se aplica", async () => {
    const id = await altaRodizio();
    await central.configurarAccesoWeb(id, { modalidad: "nube" });
    const { generarParDeSobre } = await import("@motrest/dominio");
    const ajeno = await generarParDeSobre();
    filasAccesos = [{ sucursal_id: id, version: 5, contrasena_para_central: await cerrarSobre(ajeno.publica, "x") }];
    const antes = central.verContrasenaWeb(id);
    expect(await central.recogerContrasenasDelRestaurante()).toEqual({ ok: true, recogidas: 0 });
    expect(central.verContrasenaWeb(id)).toBe(antes);
  });
});

describe("Encender Local en la Nube (restaurante ya contratado)", () => {
  async function contratado() {
    const id = await altaRodizio();
    const primera = await central.emitir(id);
    return { id, vence: primera.licencia!.vence_ts };
  }

  it("enciende en «ambas» con la contraseña elegida y reemite con el MISMO vencimiento", async () => {
    const { id, vence } = await contratado();
    const r = await central.encenderLocalEnLaNube(id, { clave: "rodizio", contrasena: "pizza de la casa" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.clave).toBe("RODIZIO");
    expect(central.verContrasenaWeb(id)).toBe("pizza de la casa");

    const cliente = central.clientes.find((c) => c.id === id)!;
    expect(cliente.modalidad).toBe("ambas");
    expect(cliente.licencia!.vence_ts).toBe(vence);
    expect(modalidadDe(cliente.licencia)).toBe("ambas");

    // La licencia fue a la nube (licencias_pendientes) y la fila del acceso se creó en «ambas».
    expect(llamadas.some((l) => l.ruta.startsWith("/rest/v1/licencias_pendientes"))).toBe(true);
    const fila = cuerpoDe((l) => l.ruta.startsWith("/rest/v1/accesos_web?on_conflict"));
    expect(fila.modalidad).toBe("ambas");
    expect(await desenvolverClaveRemota(fila.envoltura, "pizza de la casa")).not.toBeNull();
  });

  it("sin licencia emitida no enciende: la modalidad viaja dentro de ella", async () => {
    const id = await altaRodizio();
    const r = await central.encenderLocalEnLaNube(id, { clave: "RODIZIO", contrasena: "pizza de la casa" });
    expect(r.ok).toBe(false);
  });

  it("rechaza una contraseña floja antes de tocar la nube", async () => {
    const { id } = await contratado();
    llamadas = [];
    const r = await central.encenderLocalEnLaNube(id, { clave: "RODIZIO", contrasena: "corta" });
    expect(r.ok).toBe(false);
    expect(llamadas.some((l) => l.ruta.includes("accesos_web"))).toBe(false);
  });

  it("avisa si la caja nunca dio señal (no sabe si tiene la 1.6.0)", async () => {
    const { id } = await contratado();
    const r = await central.encenderLocalEnLaNube(id, { clave: "RODIZIO", contrasena: "pizza de la casa" });
    expect(r.ok && r.avisos.some((a) => /nunca ha dado señal/.test(a))).toBe(true);
  });

  it("cambiar la contraseña al volver a encender sube la versión y corta sesiones", async () => {
    const { id } = await contratado();
    await central.encenderLocalEnLaNube(id, { clave: "RODIZIO", contrasena: "pizza de la casa" });
    llamadas = [];
    const r = await central.configurarAccesoWeb(id, { modalidad: "ambas", contrasena: "otra pizza distinta" });
    expect(r.ok).toBe(true);
    expect(central.estadoAccesoWeb(id).version).toBe(2);
    expect(llamadas.some((l) => l.ruta === "/rest/v1/rpc/cerrar_sesiones_web")).toBe(true);
  });
});
