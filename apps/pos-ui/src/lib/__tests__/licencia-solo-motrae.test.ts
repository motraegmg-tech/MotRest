/**
 * La seccion de licencia solo la ve la cuenta de MOTRAE.
 *
 * Cambiar la licencia de un local decide hasta cuando abre el restaurante y con
 * que credenciales habla con MOTRAE. No es una tarea de restaurante: el
 * propietario no debe verla siquiera, porque un panel visible que no se puede
 * usar solo invita a pedir que alguien lo use.
 *
 * Esto NO es la defensa -- el Hub verifica la firma Ed25519 contra su publica
 * compilada antes de escribir nada. Es para que no estorbe y para que nadie
 * intente algo que no le toca.
 */
import { describe, expect, it } from "vitest";
import { esSoporte, USUARIO_SOPORTE_ID } from "@motrest/dominio";
import { MODULOS } from "../nav/modulos";

const administracion = MODULOS.find((m) => m.clave === "administracion")!;
const licencia = administracion.secciones.find((s) => s.clave === "licencia");

describe("quien ve la seccion de licencia", () => {
  it("la seccion existe dentro de Administracion", () => {
    expect(licencia).toBeTruthy();
    expect(licencia!.titulo).toBe("Licencia del local");
  });

  it("esta marcada como solo para MOTRAE", () => {
    expect(licencia!.soloMotrae).toBe(true);
  });

  it("ninguna otra seccion de administracion lo esta", () => {
    const otras = administracion.secciones.filter((s) => s.clave !== "licencia");
    expect(otras.every((s) => !s.soloMotrae)).toBe(true);
  });

  /*
   * El filtro del menu es `sesion.puedeVer(permiso) && (!soloMotrae ||
   * esSoporte(usuario))`. Se reproduce aqui para que la regla quede fijada
   * aunque alguien reordene la condicion en el Sidebar.
   */
  const seVe = (s: { soloMotrae?: boolean }, usuario: { id: string } | null) =>
    !s.soloMotrae || esSoporte(usuario);

  it("el propietario del restaurante NO la ve", () => {
    expect(seVe(licencia!, { id: "usr-gonzalo" })).toBe(false);
  });

  it("un gerente tampoco, por mucho permiso de administracion que tenga", () => {
    expect(seVe(licencia!, { id: "usr-01a02211-e48e-7924-a698-a6599ff30016" })).toBe(false);
  });

  it("sin nadie en sesion, tampoco", () => {
    expect(seVe(licencia!, null)).toBe(false);
  });

  it("la cuenta de soporte de MOTRAE si", () => {
    expect(seVe(licencia!, { id: USUARIO_SOPORTE_ID })).toBe(true);
  });
});
