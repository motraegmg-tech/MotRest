/**
 * La API pública del restaurante.
 *
 * Lo que se prueba aquí es lo que pasa cuando un token se filtra — que se
 * filtran— y lo que la API le deja hacer a quien lo tenga. Un token de la
 * agencia de la página no puede acabar leyendo los teléfonos de los comensales.
 */
import { describe, expect, it } from "vitest";
import {
  ALCANCES,
  LIMITE_POR_MINUTO,
  autorizarApi,
  buscarToken,
  generarToken,
  hashDeToken,
  resumirTokens,
  type TokenApi,
} from "../organizacion/api-publica.js";

const AHORA = new Date(2026, 6, 24, 12, 0).getTime();
const DIA = 86_400_000;

function token(extra: Partial<TokenApi> = {}): TokenApi {
  return {
    id: "tok-1", nombre: "Contador", hash: "abc", alcances: ["ventas"],
    creado_ts: AHORA - 30 * DIA, revocado: false, ...extra,
  };
}

describe("qué deja leer un token", () => {
  it("lee lo suyo", () => {
    expect(autorizarApi(token(), "ventas", 0, AHORA).permitido).toBe(true);
  });

  /*
   * EL CANDADO. El token de la agencia que hace la página web lee el menú, y no
   * puede acabar sacando los teléfonos de los comensales. Un token que lo lee
   * todo es el que termina pegado en una hoja de cálculo compartida.
   */
  it("no lee lo que no es suyo", () => {
    const v = autorizarApi(token({ alcances: ["menu"] }), "clientes", 0, AHORA);
    expect(v.permitido).toBe(false);
    expect(v.permitido === false && v.codigo).toBe(403);
  });

  it("un token revocado no sirve para nada", () => {
    const v = autorizarApi(token({ revocado: true }), "ventas", 0, AHORA);
    expect(v.permitido === false && v.codigo).toBe(401);
  });

  /* Un token sin caducidad sobrevive a la relación que lo justificó. */
  it("un token caducado tampoco", () => {
    const v = autorizarApi(token({ expira_ts: AHORA - 1 }), "ventas", 0, AHORA);
    expect(v.permitido === false && v.razon).toContain("caducado");
  });

  it("sin token, 401", () => {
    expect(autorizarApi(undefined, "menu", 0, AHORA).permitido).toBe(false);
  });
});

describe("el límite de peticiones", () => {
  it("frena al que se pasa", () => {
    const v = autorizarApi(token(), "ventas", LIMITE_POR_MINUTO, AHORA);
    expect(v.permitido === false && v.codigo).toBe(429);
  });

  /*
   * EL LÍMITE VA ANTES DEL ALCANCE, y eso no es un detalle de orden. Quien
   * prueba alcances a ciegas con un token robado consume peticiones igual;
   * frenarlo aquí evita que use la API como oráculo para averiguar qué puede
   * hacer con él.
   */
  it("frena incluso al que pide algo que no le corresponde", () => {
    const v = autorizarApi(token({ alcances: ["menu"] }), "clientes", LIMITE_POR_MINUTO, AHORA);
    expect(v.permitido === false && v.codigo).toBe(429);
  });
});

describe("los tokens en sí", () => {
  /*
   * El prefijo `mrt_` es para que los buscadores de secretos que revisan
   * repositorios lo detecten. Un token en un repositorio público conviene que
   * salte a la vista antes que tarde.
   */
  it("nacen con prefijo reconocible y largo suficiente", () => {
    const t = generarToken();
    expect(t.startsWith("mrt_")).toBe(true);
    expect(t.length).toBeGreaterThan(40);
  });

  it("dos tokens nunca salen iguales", () => {
    const muchos = new Set(Array.from({ length: 200 }, () => generarToken()));
    expect(muchos.size).toBe(200);
  });

  it("se reconoce por su hash, nunca guardando el secreto", async () => {
    const secreto = generarToken();
    const guardado = token({ hash: await hashDeToken(secreto) });

    expect(await buscarToken(secreto, [guardado])).toBe(guardado);
    expect(await buscarToken(generarToken(), [guardado])).toBeUndefined();
  });

  it("busca entre varios sin confundirse", async () => {
    const a = generarToken();
    const b = generarToken();
    const lista = [
      token({ id: "a", hash: await hashDeToken(a) }),
      token({ id: "b", hash: await hashDeToken(b) }),
    ];
    expect((await buscarToken(b, lista))!.id).toBe("b");
  });
});

describe("lo que ve el restaurantero", () => {
  it("nunca el secreto, solo para qué es y cómo está", () => {
    const resumen = resumirTokens([token({ hash: "secreto-hasheado" })], AHORA);
    expect(JSON.stringify(resumen)).not.toContain("secreto-hasheado");
    expect(resumen[0]!.alcances).toEqual(["Ventas y cortes"]);
  });

  /*
   * Un token que se creó y nunca se usó suele ser uno que se pidió "por si
   * acaso". Señalarlo es lo que hace que alguien lo apague algún día.
   */
  it("señala los que nadie ha usado nunca", () => {
    expect(resumirTokens([token()], AHORA)[0]!.estado).toBe("sin_usar");
    expect(resumirTokens([token({ usado_ts: AHORA - DIA })], AHORA)[0]!.estado).toBe("activo");
    expect(resumirTokens([token({ revocado: true })], AHORA)[0]!.estado).toBe("revocado");
    expect(resumirTokens([token({ expira_ts: AHORA - 1 })], AHORA)[0]!.estado).toBe("caducado");
  });

  /* Los datos personales se marcan: quien los entrega responde por ellos. */
  it("el alcance de comensales avisa de que son datos personales", () => {
    const clientes = ALCANCES.find((a) => a.alcance === "clientes")!;
    expect(clientes.delicado).toBe(true);
    expect(clientes.descripcion).toContain("datos personales");
  });
});
