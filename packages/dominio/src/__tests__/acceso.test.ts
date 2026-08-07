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
  aBase32,
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

/**
 * EL SESGO DEL ALFABETO (CN-043).
 *
 * 256 no es múltiplo de 30. Con `byte % 30`, los valores 0..15 salían nueve
 * veces de cada 256 y los 16..29 solo ocho: media alfabeto aparecía un 12 % más
 * a menudo que la otra mitad. No rompe nada por sí solo —siguen siendo 78 bits
 * que adivinar— pero es entropía regalada, y la clase de defecto que se hereda
 * sin que nadie lo revise el día que alguien copie esta función a otro sitio.
 *
 * SE PRUEBA POR ENUMERACIÓN COMPLETA, NO POR MUESTREO.
 *
 * La primera versión de esta prueba firmaba mil enlaces y miraba si el reparto
 * salía plano. Pasaba, pero tardaba casi un segundo y **fallaba de vez en
 * cuando** al correr toda la suite en paralelo: no por el sesgo, por el tiempo.
 * Una prueba que falla a veces es peor que no tenerla — enseña a ignorar los
 * fallos rojos.
 *
 * Los bytes posibles son 256 y caben todos: se le pasan los 256 y se cuenta.
 * Con el descarte, cada letra sale EXACTAMENTE ocho veces (240 ÷ 30). Sin
 * márgenes, sin azar, y en un milisegundo.
 */
describe("la firma no favorece a unas letras sobre otras", () => {
  const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

  it("los 256 bytes posibles se reparten exactos entre las 30 letras", () => {
    const todos = new Uint8Array(256).map((_, i) => i);
    const salida = aBase32(todos, 240);

    const cuenta = new Map<string, number>();
    for (const c of salida) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);

    expect(salida).toHaveLength(240);
    expect(cuenta.size).toBe(ALFABETO.length);
    // Ocho veces cada una. Con el `%` de antes salían nueve y ocho.
    expect([...cuenta.values()]).toEqual(Array(ALFABETO.length).fill(8));
  });

  it("descarta los bytes altos en vez de doblarlos sobre las primeras letras", () => {
    /*
     * 240..255 son justo los que sesgaban: 240 % 30 = 0, 241 % 30 = 1… es decir,
     * repetían las primeras letras del alfabeto. Aquí el 240 se salta y el
     * resultado sale del 5, no del 240.
     */
    expect(aBase32(new Uint8Array([240, 5]), 1)).toBe(ALFABETO[5]);
    expect(aBase32(new Uint8Array([241, 255, 12]), 1)).toBe(ALFABETO[12]);
  });

  it("nunca devuelve una firma corta, aunque todos los bytes se descarten", () => {
    // Una firma corta rompería el enlace de esa cuenta para siempre. En la
    // práctica no puede pasar con 32 bytes de HMAC; el respaldo existe igual.
    const todosAltos = new Uint8Array(32).fill(250);
    expect(aBase32(todosAltos, 16)).toHaveLength(16);
  });

  it("sigue siendo determinista, que es de lo que depende abrir la cuenta", async () => {
    const una = await firmarCuenta("orden-fija" as never, "secreto");
    const otra = await firmarCuenta("orden-fija" as never, "secreto");

    expect(una).toBe(otra);
    expect(una).toHaveLength(16);
    expect([...una].every((c) => ALFABETO.includes(c))).toBe(true);
  });
});
