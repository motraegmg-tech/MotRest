/**
 * El enlace firmado con que un comensal entra a SU cuenta.
 *
 * Es la puerta que se le abre a un teléfono ajeno, así que lo que hay que
 * probar es que NO se pueda forzar: ni fabricando una firma, ni cambiando el
 * orden_id, ni usando el enlace de la mesa de al lado.
 */
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../comun/ids.js";
import {
  VIGENCIA_ENLACE_MS,
  abrirCuenta,
  codigoDeCuenta,
  enlaceVigente,
  firmarCuenta,
} from "../clientes/acceso.js";

const SECRETO = "secreto-del-hub-de-rodizio";

describe("el enlace de una cuenta", () => {
  it("abre la orden que firmó", async () => {
    const orden = uuidv7();
    const codigo = await codigoDeCuenta(orden, SECRETO);
    expect(await abrirCuenta(codigo, SECRETO)).toBe(orden);
  });

  it("es estable: el mismo ticket reimpreso lleva el mismo código", async () => {
    const orden = uuidv7();
    expect(await firmarCuenta(orden, SECRETO)).toBe(await firmarCuenta(orden, SECRETO));
  });

  /* Tener el enlace de tu mesa no puede dar el de la de al lado. */
  it("cada cuenta tiene su propia firma", async () => {
    const a = await firmarCuenta(uuidv7(), SECRETO);
    const b = await firmarCuenta(uuidv7(), SECRETO);
    expect(a).not.toBe(b);
  });

  it("cambiar el orden_id invalida el enlace", async () => {
    const codigo = await codigoDeCuenta(uuidv7(), SECRETO);
    const manipulado = `${uuidv7()}~${codigo.split("~")[1]}`;
    expect(await abrirCuenta(manipulado, SECRETO)).toBeNull();
  });

  it("una firma inventada no abre nada", async () => {
    expect(await abrirCuenta(`${uuidv7()}~AAAAAAAAAAAAAAAA`, SECRETO)).toBeNull();
  });

  /* Sin el secreto del Hub no se puede firmar: es lo que sostiene todo. */
  it("otro secreto no abre la cuenta", async () => {
    const orden = uuidv7();
    const codigo = await codigoDeCuenta(orden, SECRETO);
    expect(await abrirCuenta(codigo, "otro-secreto")).toBeNull();
  });

  it("un código mal formado no rompe nada", async () => {
    for (const basura of ["", "~", "sin-firma", "~solo-firma", "a~b"]) {
      expect(await abrirCuenta(basura, SECRETO)).toBeNull();
    }
  });

  /* El QR se lee mal y alguien lo teclea: no debe importar cómo lo escriba. */
  it("da igual en mayúsculas o minúsculas", async () => {
    const orden = uuidv7();
    const codigo = await codigoDeCuenta(orden, SECRETO);
    expect(await abrirCuenta(codigo.toLowerCase(), SECRETO)).toBe(orden.toLowerCase());
  });
});

describe("hasta cuándo sirve", () => {
  it("vale los primeros tres días", () => {
    const ahora = Date.now();
    expect(enlaceVigente(ahora, ahora)).toBe(true);
    expect(enlaceVigente(ahora - VIGENCIA_ENLACE_MS + 1000, ahora)).toBe(true);
  });

  /* Un enlace vivo para siempre es una puerta que nadie vuelve a mirar. */
  it("se cierra después", () => {
    const ahora = Date.now();
    expect(enlaceVigente(ahora - VIGENCIA_ENLACE_MS - 1000, ahora)).toBe(false);
  });
});
