/**
 * Qué se manda de verdad en el pulso, y qué se queda en el local.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El pulso es un `upsert` de una fila entera: si un
 * solo campo no le cuadra a Postgres, se rechaza el parte COMPLETO. El local
 * sigue vendiendo sin enterarse y en el panel aparece como «nunca reportó», que
 * es exactamente igual a como se ve un restaurante caído. Ya pasó dos veces
 * seguidas con el primer local que conectó: primero por una columna que faltaba,
 * después por una fecha mandada como número.
 *
 * Es un fallo caro y silencioso, así que la forma de la fila se fija aquí en vez
 * de descubrirse otra vez en un restaurante.
 */
import { describe, expect, it } from "vitest";
import { filaDelPulso } from "../enlace-supabase.js";

const SUC = "suc-rodizio";

describe("la fila del pulso", () => {
  it("manda la fecha del respaldo en ISO, no en milisegundos", () => {
    // Tal cual lo entrega `listarRespaldos`: `mtimeMs`, con decimales.
    const fila = filaDelPulso({ version: "1.3.9", respaldo_ts: 1_788_535_280_453.7085 }, SUC);

    expect(fila.respaldo_ts).toBe(new Date(1_788_535_280_453.7085).toISOString());
    expect(typeof fila.respaldo_ts).toBe("string");
  });

  it("y esa fecha vuelve intacta al convertirla como la convierte Central", () => {
    // Central lee la columna con `new Date(String(fila.respaldo_ts)).getTime()`.
    // La ida y la vuelta tienen que dar el mismo instante, al milisegundo.
    const cuando = Date.now();
    const fila = filaDelPulso({ version: "1.3.9", respaldo_ts: cuando }, SUC);

    expect(new Date(String(fila.respaldo_ts)).getTime()).toBe(cuando);
  });

  it("pone el local de la credencial y no el que venga en el parte", () => {
    // Un Hub autenticado no es un Hub de fiar: si pudiera elegir el
    // `sucursal_id`, reportaría en nombre del restaurante de al lado.
    const fila = filaDelPulso({ sucursal_id: "suc-del-vecino", version: "1.3.9" }, SUC);

    expect(fila.sucursal_id).toBe(SUC);
  });

  it("no manda la hora: la pone el servidor", () => {
    // El reloj de una caja puede estar en cualquier año, y un pulso fechado en
    // 2019 desordena el panel entero.
    const fila = filaDelPulso({ ts: 0, version: "1.3.9" }, SUC);

    expect("ts" in fila).toBe(false);
  });

  it("omite el respaldo si el local no tiene ninguno, en vez de mandar nulo", () => {
    // `listarRespaldos` devuelve vacío en un local recién instalado. La columna
    // acepta nulo, pero omitirla deja claro que no se sabe, no que sea cero.
    const fila = filaDelPulso({ version: "1.3.9" }, SUC);

    expect("respaldo_ts" in fila).toBe(false);
  });

  it("deja pasar el resto del parte tal cual", () => {
    // Los topes los aplica la base (constraints) y el saneo del trigger. Aquí no
    // se recorta nada más: lo que se filtre de más son datos que el soporte
    // echaría en falta justo cuando hay una avería.
    const fila = filaDelPulso(
      {
        version: "1.3.9",
        terminales: 3,
        eventos: 12_345,
        ventas_dia: 987_650,
        arranque_automatico: false,
        problemas: ["El Hub no arranca solo al encender el equipo"],
      },
      SUC,
    );

    expect(fila).toMatchObject({
      version: "1.3.9",
      terminales: 3,
      eventos: 12_345,
      ventas_dia: 987_650,
      arranque_automatico: false,
      problemas: ["El Hub no arranca solo al encender el equipo"],
    });
  });
});
