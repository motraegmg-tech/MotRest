/**
 * La firma asimétrica.
 *
 * LO QUE HAY QUE PROBAR AQUÍ ES LA ASIMETRÍA, que es todo el punto del cambio:
 * que tener la llave que **verifica** no permita **firmar**. Con HMAC —lo que
 * había antes— era la misma llave, y por eso cualquier restaurante podía firmar
 * actualizaciones para toda la flota.
 */
import { describe, expect, it } from "vitest";
import {
  contenidoCanonico,
  firmar,
  generarPar,
  hayFirmaAsimetrica,
  publicaDe,
  verificar,
} from "../comun/firma.js";

describe("el par de llaves", () => {
  it("el entorno sabe hacer Ed25519", async () => {
    expect(await hayFirmaAsimetrica()).toBe(true);
  });

  it("lo que firma la privada lo verifica su pública", async () => {
    const par = await generarPar();
    const firma = await firmar(par.privada, "el contenido");
    expect(await verificar(par.publica, "el contenido", firma)).toBe(true);
  });

  /*
   * EL CANDADO QUE JUSTIFICA TODO EL CAMBIO. La pública se instala en cada
   * restaurante; si sirviera para firmar, estaríamos donde estábamos.
   */
  it("la pública NO sirve para firmar", async () => {
    const par = await generarPar();
    // Intentar firmar con la pública ni siquiera importa la llave.
    await expect(firmar(par.publica, "algo")).rejects.toThrow();
  });

  it("la pública de un par no verifica lo que firmó otro", async () => {
    const mio = await generarPar();
    const ajeno = await generarPar();
    const firma = await firmar(ajeno.privada, "contenido");

    expect(await verificar(mio.publica, "contenido", firma)).toBe(false);
  });

  it("dos pares nunca salen iguales", async () => {
    const a = await generarPar();
    const b = await generarPar();
    expect(a.publica).not.toBe(b.publica);
    expect(a.privada).not.toBe(b.privada);
  });

  /* La pública es corta a propósito: cabe en un renglón y se pega sin errores. */
  it("la pública es corta y pegable", async () => {
    const par = await generarPar();
    expect(par.publica.length).toBeLessThan(70);
    expect(par.publica).not.toContain("\n");
  });
});

describe("derivar la pública de la privada", () => {
  /*
   * Hace falta para que el CLI verifique lo que acaba de emitir —comprobación
   * que existe para atrapar una llave pegada con un salto de línea— sin tener
   * que guardar la pública aparte.
   */
  it("da exactamente la misma pública", async () => {
    const par = await generarPar();
    expect(await publicaDe(par.privada)).toBe(par.publica);
  });

  it("la derivada verifica lo que firmó su privada", async () => {
    const par = await generarPar();
    const firma = await firmar(par.privada, "x");
    expect(await verificar(await publicaDe(par.privada), "x", firma)).toBe(true);
  });
});

describe("una firma que no cuadra", () => {
  it("cambiar el contenido la invalida", async () => {
    const par = await generarPar();
    const firma = await firmar(par.privada, "original");
    expect(await verificar(par.publica, "alterado", firma)).toBe(false);
  });

  /*
   * Nunca lanza: quien llama solo necesita saber si puede confiar, y una
   * excepción a mitad del arranque de un Hub sería peor que un `false`.
   */
  it("basura de entrada devuelve false, no revienta", async () => {
    const par = await generarPar();
    for (const firma of ["", "no-es-hex", "ab", "z".repeat(128), "00".repeat(64)]) {
      expect(await verificar(par.publica, "x", firma)).toBe(false);
    }
    expect(await verificar("no-es-una-llave", "x", "ab".repeat(64))).toBe(false);
  });

  it("una firma con espacios o mayúsculas se acepta igual", async () => {
    const par = await generarPar();
    const firma = await firmar(par.privada, "x");
    expect(await verificar(par.publica, "x", `  ${firma.toUpperCase()}  `)).toBe(true);
  });
});

// --- La serialización canónica ------------------------------------------------------------------

describe("el texto que se firma", () => {
  /*
   * EL DEFECTO DE FONDO QUE ESTO ARREGLA. Antes se firmaba una lista de campos
   * escrita a mano, así que cualquier campo nuevo quedaba fuera EN SILENCIO. Es
   * lo que pasó con `notas`: el único texto que el restaurantero lee para
   * decidir si instala, y se podía reescribir sin invalidar la firma.
   */
  it("un campo nuevo entra en la firma sin que nadie lo añada a una lista", () => {
    const antes = contenidoCanonico({ version: "1.0.0" });
    const despues = contenidoCanonico({ version: "1.0.0", notas: "instale ya" });
    expect(antes).not.toBe(despues);
  });

  /* El orden en que se escriban las claves no puede cambiar la firma. */
  it("el orden de las claves no importa", () => {
    expect(contenidoCanonico({ a: 1, b: 2 })).toBe(contenidoCanonico({ b: 2, a: 1 }));
  });

  it("ordena también dentro de objetos anidados", () => {
    expect(contenidoCanonico({ x: { p: 1, q: 2 } })).toBe(contenidoCanonico({ x: { q: 2, p: 1 } }));
  });

  /*
   * ANTES: `join("|")` sin escape. Un `nombre` con `|` podía producir la misma
   * cadena firmable que otro objeto distinto.
   */
  it("un valor con separadores ya no puede colisionar", () => {
    const uno = contenidoCanonico({ nombre: "Rodizio|Centro", plan: "mensual" });
    const otro = contenidoCanonico({ nombre: "Rodizio", plan: "Centro|mensual" });
    expect(uno).not.toBe(otro);
  });

  /* Ausente y `undefined` son lo mismo: al viajar como JSON los dos llegan ausentes. */
  it("undefined y ausente firman igual", () => {
    expect(contenidoCanonico({ a: 1, b: undefined })).toBe(contenidoCanonico({ a: 1 }));
  });

  /* Pero ausente y vacío NO: antes los dos daban la misma cadena. */
  it("ausente y vacío NO firman igual", () => {
    expect(contenidoCanonico({ soporte: undefined })).not.toBe(
      contenidoCanonico({ soporte: { sal: "", hash: "", iteraciones: 0 } }),
    );
  });

  it("los arreglos conservan su orden, que sí significa algo", () => {
    expect(contenidoCanonico({ x: [1, 2] })).not.toBe(contenidoCanonico({ x: [2, 1] }));
  });

  it("firmar el canónico detecta cualquier cambio del objeto", async () => {
    const par = await generarPar();
    const objeto = { version: "1.5.0", url: "https://…", notas: "menores", obligatoria: false };
    const firma = await firmar(par.privada, contenidoCanonico(objeto));

    for (const alterado of [
      { ...objeto, version: "1.6.0" },
      { ...objeto, url: "https://sitio-de-un-atacante.mx/virus.exe" },
      { ...objeto, notas: "ACTUALIZACIÓN CRÍTICA, instale de inmediato" },
      { ...objeto, obligatoria: true },
    ]) {
      expect(await verificar(par.publica, contenidoCanonico(alterado), firma)).toBe(false);
    }
  });
});
