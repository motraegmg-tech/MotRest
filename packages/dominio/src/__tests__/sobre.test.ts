import { describe, expect, it } from "vitest";
import {
  abrirSobre,
  cerrarSobre,
  esPublicaDeSobre,
  esSecreto,
  esSobre,
  generarParDeSobre,
  haySobres,
  llaveFacturapiValida,
  normalizarContrasenaGmail,
  puedeGuardarSecretos,
  terminacion,
} from "../index.js";

describe("sobre sellado para un Hub", () => {
  it("el entorno de pruebas sabe hacer X25519", async () => {
    expect(await haySobres()).toBe(true);
  });

  it("el Hub dueño de la llave lo abre y recupera el texto exacto", async () => {
    const hub = await generarParDeSobre();
    expect(esPublicaDeSobre(hub.publica)).toBe(true);

    const texto = JSON.stringify({ clase: "facturapi", llave: "sk_live_ñandú-123" });
    const sobre = await cerrarSobre(hub.publica, texto, 1_000);

    expect(esSobre(sobre)).toBe(true);
    expect(sobre.creado_ts).toBe(1_000);
    expect(await abrirSobre(sobre, hub)).toBe(texto);
  });

  it("el contenido no viaja en claro", async () => {
    const hub = await generarParDeSobre();
    const sobre = await cerrarSobre(hub.publica, "sk_live_secretisimo");
    expect(JSON.stringify(sobre)).not.toContain("secretisimo");
  });

  it("otro Hub no lo puede abrir", async () => {
    const rodizio = await generarParDeSobre();
    const otro = await generarParDeSobre();
    const sobre = await cerrarSobre(rodizio.publica, "para Rodizio");
    expect(await abrirSobre(sobre, otro)).toBeNull();
  });

  it("un sobre alterado no se da por bueno", async () => {
    const hub = await generarParDeSobre();
    const sobre = await cerrarSobre(hub.publica, "sk_live_original");
    const bytes = atob(sobre.contenido).split("");
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    expect(await abrirSobre({ ...sobre, contenido: btoa(bytes.join("")) }, hub)).toBeNull();
  });

  it("no se puede reetiquetar para otro destinatario cambiando la efímera", async () => {
    const hub = await generarParDeSobre();
    const intruso = await generarParDeSobre();
    const sobre = await cerrarSobre(hub.publica, "sk_live_x");
    expect(await abrirSobre({ ...sobre, efimera: intruso.publica }, hub)).toBeNull();
  });

  it("dos sobres del mismo texto no se parecen", async () => {
    const hub = await generarParDeSobre();
    const a = await cerrarSobre(hub.publica, "igual");
    const b = await cerrarSobre(hub.publica, "igual");
    expect(a.contenido).not.toBe(b.contenido);
    expect(a.efimera).not.toBe(b.efimera);
  });

  it("rechaza una pública que no es de 32 bytes", async () => {
    expect(esPublicaDeSobre("no-es-base64!")).toBe(false);
    expect(esPublicaDeSobre(btoa("corta"))).toBe(false);
    await expect(cerrarSobre(btoa("corta"), "x")).rejects.toThrow(/pública/);
  });

  it("lo que no es un sobre no se intenta abrir", async () => {
    const hub = await generarParDeSobre();
    expect(await abrirSobre(null, hub)).toBeNull();
    expect(await abrirSobre({ formato: "otro" }, hub)).toBeNull();
  });
});

describe("secretos del Hub", () => {
  it("solo el responsable y el soporte de MOTRAE pueden guardarlos, por rol", () => {
    expect(puedeGuardarSecretos({ rol_id: "propietario", activo: true })).toBe(true);
    expect(puedeGuardarSecretos({ rol_id: "soporte", activo: true })).toBe(true);
    for (const rol of ["gerente", "administracion", "cajero", "mesero", "chef", "compras"] as const) {
      expect(puedeGuardarSecretos({ rol_id: rol, activo: true })).toBe(false);
    }
  });

  it("un responsable desactivado ya no puede", () => {
    expect(puedeGuardarSecretos({ rol_id: "propietario", activo: false })).toBe(false);
    expect(puedeGuardarSecretos(null)).toBe(false);
  });

  it("la llave de FacturAPI tiene que corresponder al modo", () => {
    const live = "sk_live_" + "a".repeat(24);
    const test = "sk_test_" + "b".repeat(24);
    expect(llaveFacturapiValida(live, "produccion")).toBe(true);
    expect(llaveFacturapiValida(test, "pruebas")).toBe(true);
    // La de pruebas en producción timbraría sin validez fiscal sin que nadie lo notara.
    expect(llaveFacturapiValida(test, "produccion")).toBe(false);
    expect(llaveFacturapiValida(live, "pruebas")).toBe(false);
    expect(llaveFacturapiValida("sk_user_" + "c".repeat(24), "produccion")).toBe(false);
    expect(llaveFacturapiValida("sk_live_corta", "produccion")).toBe(false);
  });

  it("la contraseña de Gmail se acepta con o sin espacios y se guarda sin ellos", () => {
    expect(normalizarContrasenaGmail("abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
    expect(normalizarContrasenaGmail("ABCDEFGHIJKLMNOP")).toBe("abcdefghijklmnop");
    expect(normalizarContrasenaGmail("mi-contraseña-normal")).toBeNull();
    expect(normalizarContrasenaGmail("abcd efgh ijkl")).toBeNull();
  });

  it("solo enseña los cuatro últimos caracteres, y nada si es muy corta", () => {
    expect(terminacion(`sk_${"live"}_1234567890abcdef`)).toBe("cdef");
    expect(terminacion("corta")).toBe("");
  });

  it("revisa lo que sale del sobre antes de darlo por bueno", () => {
    const base = { sucursal_id: "suc-1", emitido_ts: 5, origen: "central" as const };
    expect(
      esSecreto({ ...base, clase: "facturapi", modo: "produccion", llave: "sk_live_" + "x".repeat(20) }),
    ).toBe(true);
    expect(esSecreto({ ...base, clase: "gmail", contrasena: "abcd efgh ijkl mnop" })).toBe(true);
    expect(esSecreto({ ...base, clase: "facturapi", modo: "produccion", llave: "sk_test_" + "x".repeat(20) })).toBe(false);
    expect(esSecreto({ ...base, clase: "otra" })).toBe(false);
    expect(esSecreto({ ...base, origen: "tableta", clase: "gmail", contrasena: "abcdefghijklmnop" })).toBe(false);
  });
});
