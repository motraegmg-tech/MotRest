/**
 * El acceso web (1.6.0): la modalidad firmada, la clave remota envuelta con la
 * contraseña, y el secreto que Central manda al Hub.
 *
 * Lo que de verdad importa probar:
 * - que una licencia SIN `web` siga siendo «app» (toda la flota actual);
 * - que el bloque `web` quede dentro de la firma: nadie se enciende la nube
 *   editando un archivo;
 * - que la clave remota solo se desenvuelva con SU contraseña.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generarPar, type ParDeLlaves } from "../comun/firma.js";
import { generarParDeSobre } from "../comun/sobre.js";
import {
  cambioDeModalidadPermitido,
  claveRemotaValida,
  claveRestauranteValida,
  contrasenaWebAceptable,
  correoWebDe,
  desenvolverClaveRemota,
  envolverClaveRemota,
  generarClaveRemota,
  generarContrasenaWeb,
  modalidadDe,
  normalizarClaveRestaurante,
} from "../organizacion/acceso-web.js";
import { emitirLicencia, verificarLicencia, type Licencia } from "../organizacion/licencia.js";
import { esSecreto, esSecretoAccesoWeb } from "../organizacion/secretos.js";

let MOTRAE: ParDeLlaves;
let BUZON: string;

beforeAll(async () => {
  MOTRAE = await generarPar();
  BUZON = (await generarParDeSobre()).publica;
});

const SUC = "suc-rodizio";
const AHORA = new Date(2026, 8, 23, 12, 0).getTime();

function base(): Omit<Licencia, "firma"> {
  return {
    sucursal_id: SUC,
    nombre: "Rodizio",
    plan: "mensual",
    vence_ts: AHORA + 30 * 86_400_000,
    gracia_dias: 3,
    emitida_ts: AHORA,
  };
}

describe("modalidad en la licencia", () => {
  it("una licencia sin bloque web es «app», como toda la flota de antes de la 1.6.0", async () => {
    const lic = await emitirLicencia(base(), MOTRAE.privada);
    expect(modalidadDe(lic)).toBe("app");
    expect(modalidadDe(null)).toBe("app");
  });

  it("el bloque web viaja firmado y verifica con el verificador de siempre", async () => {
    const lic = await emitirLicencia({ ...base(), web: { modalidad: "ambas", buzon_central: BUZON } }, MOTRAE.privada);
    expect(modalidadDe(lic)).toBe("ambas");
    expect(await verificarLicencia(lic, SUC, MOTRAE.publica)).toBe(true);
  });

  it("encenderse la nube editando la licencia rompe la firma", async () => {
    const lic = await emitirLicencia(base(), MOTRAE.privada);
    const trucada = { ...lic, web: { modalidad: "nube" as const, buzon_central: BUZON } };
    expect(await verificarLicencia(trucada, SUC, MOTRAE.publica)).toBe(false);
  });

  it("cambiar el buzón de Central por otro rompe la firma", async () => {
    const lic = await emitirLicencia({ ...base(), web: { modalidad: "ambas", buzon_central: BUZON } }, MOTRAE.privada);
    const otro = (await generarParDeSobre()).publica;
    const trucada = { ...lic, web: { modalidad: "ambas" as const, buzon_central: otro } };
    expect(await verificarLicencia(trucada, SUC, MOTRAE.publica)).toBe(false);
  });

  it("una modalidad desconocida se lee como app, no como nube", () => {
    expect(modalidadDe({ web: { modalidad: "marte" as never, buzon_central: "" } })).toBe("app");
  });
});

describe("cambios de modalidad", () => {
  it("app y ambas se intercambian libremente", () => {
    expect(cambioDeModalidadPermitido("app", "ambas").ok).toBe(true);
    expect(cambioDeModalidadPermitido("ambas", "app").ok).toBe(true);
    expect(cambioDeModalidadPermitido("nube", "nube").ok).toBe(true);
  });

  it("entrar o salir de la nube es una mudanza y todavía se niega", () => {
    expect(cambioDeModalidadPermitido("app", "nube").ok).toBe(false);
    expect(cambioDeModalidadPermitido("ambas", "nube").ok).toBe(false);
    expect(cambioDeModalidadPermitido("nube", "app").ok).toBe(false);
    expect(cambioDeModalidadPermitido("nube", "ambas").ok).toBe(false);
  });
});

describe("clave del restaurante y contraseña", () => {
  it("la clave se normaliza a mayúsculas y sin espacios", () => {
    expect(normalizarClaveRestaurante("  rodizio ")).toBe("RODIZIO");
    expect(claveRestauranteValida("rodizio")).toBe(true);
    expect(claveRestauranteValida("ro")).toBe(false);
    expect(claveRestauranteValida("rodizio!")).toBe(false);
  });

  it("la contraseña generada se lee sin ambigüedades y pasa la regla", () => {
    for (let i = 0; i < 50; i++) {
      const c = generarContrasenaWeb();
      expect(c).toMatch(/^[a-km-z2-9]{4}-[a-km-z2-9]{4}-[a-km-z2-9]{4}$/);
      expect(c).not.toMatch(/[01lo]/);
      expect(contrasenaWebAceptable(c).ok).toBe(true);
    }
  });

  it("la del propietario necesita largo y algo de variedad", () => {
    expect(contrasenaWebAceptable("corta").ok).toBe(false);
    expect(contrasenaWebAceptable("aaaaaaaaaaaa").ok).toBe(false);
    expect(contrasenaWebAceptable("pizza de la casa").ok).toBe(true);
  });

  it("el usuario web va por sucursal y en su propio dominio, no en el de los Hubs", () => {
    expect(correoWebDe(SUC)).toBe("web-suc-rodizio@web.motrae.mx");
  });
});

describe("clave remota envuelta", () => {
  it("tiene la forma de una clave del local", () => {
    expect(claveRemotaValida(generarClaveRemota())).toBe(true);
    expect(claveRemotaValida("corta")).toBe(false);
  });

  it("solo se desenvuelve con su contraseña", async () => {
    const clave = generarClaveRemota();
    const cofre = await envolverClaveRemota(clave, "k7mp-x3qa-9vhe", AHORA);
    expect(await desenvolverClaveRemota(cofre, "k7mp-x3qa-9vhe")).toBe(clave);
    expect(await desenvolverClaveRemota(cofre, "k7mp-x3qa-9vhX")).toBeNull();
    expect(await desenvolverClaveRemota({ basura: 1 }, "k7mp-x3qa-9vhe")).toBeNull();
  });

  it("la envoltura no contiene la clave en claro", async () => {
    const clave = generarClaveRemota();
    const cofre = await envolverClaveRemota(clave, "k7mp-x3qa-9vhe", AHORA);
    expect(JSON.stringify(cofre)).not.toContain(clave);
  });

  it("no envuelve con una contraseña corta ni una clave mal formada", async () => {
    await expect(envolverClaveRemota(generarClaveRemota(), "corta")).rejects.toThrow();
    await expect(envolverClaveRemota("no-es-clave", "k7mp-x3qa-9vhe")).rejects.toThrow();
  });
});

describe("el secreto acceso_web del buzón", () => {
  const valido = () => ({
    clase: "acceso_web",
    sucursal_id: SUC,
    emitido_ts: AHORA,
    origen: "central",
    clave_remota: generarClaveRemota(),
    version: 1,
  });

  it("se reconoce, y no se confunde con FacturAPI ni Gmail", () => {
    expect(esSecretoAccesoWeb(valido())).toBe(true);
    expect(esSecreto(valido())).toBe(false);
  });

  it("solo lo manda Central y con versión positiva", () => {
    expect(esSecretoAccesoWeb({ ...valido(), origen: "local" })).toBe(false);
    expect(esSecretoAccesoWeb({ ...valido(), version: 0 })).toBe(false);
    expect(esSecretoAccesoWeb({ ...valido(), clave_remota: "x" })).toBe(false);
  });
});
