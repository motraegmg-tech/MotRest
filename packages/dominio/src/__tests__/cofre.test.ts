/**
 * El cofre con el que las llaves de MOTRAE salen de la máquina de Gonzalo.
 *
 * Lo que se prueba aquí es lo que hace útil al respaldo: que abra en otra parte
 * con la contraseña correcta, que no abra de ninguna otra forma, y que el
 * archivo no lleve nada legible dentro. Un respaldo que solo abre en la máquina
 * que se perdió no es un respaldo — para eso ya está DPAPI.
 */
import { describe, expect, it } from "vitest";
import { abrirCofre, cerrarCofre, esCofre, MINIMO_CONTRASENA_COFRE } from "../comun/cofre.js";

const CONTRASENA = "una-contrasena-larga-de-motrae";
const SECRETO = JSON.stringify({ licencias: { privada: "privadisima", publica: "publica" } });

describe("el cofre de las llaves", () => {
  it("lo que se cierra con una contraseña se abre con esa contraseña", async () => {
    const cofre = await cerrarCofre(SECRETO, CONTRASENA);
    expect(await abrirCofre(cofre, CONTRASENA)).toBe(SECRETO);
  });

  /* Es el archivo que se guarda fuera de la máquina: no puede llevar nada en claro. */
  it("no deja rastro legible de lo que guarda", async () => {
    const cofre = await cerrarCofre(SECRETO, CONTRASENA);
    const enDisco = JSON.stringify(cofre);

    expect(enDisco).not.toContain("privadisima");
    expect(enDisco).not.toContain(CONTRASENA);
  });

  it("con la contraseña equivocada no abre", async () => {
    const cofre = await cerrarCofre(SECRETO, CONTRASENA);
    expect(await abrirCofre(cofre, "otra-contrasena-larguisima")).toBeNull();
  });

  /*
   * AES-GCM autentica: si alguien tocó un byte, el descifrado falla igual que
   * con una contraseña mala. La única respuesta honesta es que ese contenido no
   * se puede dar por bueno.
   */
  it("un cofre alterado no abre aunque la contraseña sea la buena", async () => {
    const cofre = await cerrarCofre(SECRETO, CONTRASENA);
    /* Un carácter DISTINTO del que había: poner siempre "A" no altera nada si ya era "A". */
    const otro = cofre.contenido.startsWith("A") ? "B" : "A";
    const manipulado = { ...cofre, contenido: otro + cofre.contenido.slice(1) };

    expect(await abrirCofre(manipulado, CONTRASENA)).toBeNull();
  });

  it("dos cofres del mismo secreto salen distintos", async () => {
    const uno = await cerrarCofre(SECRETO, CONTRASENA);
    const otro = await cerrarCofre(SECRETO, CONTRASENA);

    /* Sal e IV aleatorios: sin esto, dos respaldos iguales delatarían que nada cambió. */
    expect(uno.contenido).not.toBe(otro.contenido);
    expect(uno.sal).not.toBe(otro.sal);
    expect(await abrirCofre(otro, CONTRASENA)).toBe(SECRETO);
  });

  /* Esta contraseña abre la firma de todos los restaurantes; no es un PIN. */
  it("rechaza una contraseña corta antes de cifrar nada", async () => {
    await expect(cerrarCofre(SECRETO, "corta")).rejects.toThrow(
      String(MINIMO_CONTRASENA_COFRE),
    );
  });

  it("lo que no es un cofre no se intenta abrir", async () => {
    expect(esCofre({ formato: "otra-cosa" })).toBe(false);
    expect(await abrirCofre({ formato: "otra-cosa" }, CONTRASENA)).toBeNull();
    expect(await abrirCofre(null, CONTRASENA)).toBeNull();
  });
});
