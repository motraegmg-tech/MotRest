/**
 * Cuánta gente cabe y dónde se sienta un grupo.
 *
 * Las dos preguntas que el salón no sabía contestar antes de la 1.3.5. Importan
 * juntas: la capacidad sola no sirve de nada si al pedir mesa para diez el
 * sistema propone juntar la terraza con el fondo del salón.
 */
import { describe, expect, it } from "vitest";
import {
  DISTANCIA_MAX_UNION,
  MAX_MESAS_UNIDAS,
  acomodosParaGrupo,
  capacidadDe,
  capacidadDeMesas,
  type Mesa,
} from "../catalogo/areas.js";

function mesa(parcial: Partial<Mesa> = {}): Mesa {
  return {
    id: "m1",
    nombre: "1",
    area_id: "salon",
    columna: 0,
    fila: 0,
    ancho: 2,
    alto: 2,
    forma: "cuadrada",
    activa: true,
    ...parcial,
  };
}

describe("cuántos comensales caben en una mesa", () => {
  it("manda lo que fijó el restaurante, no la estimación", () => {
    expect(capacidadDe(mesa({ ancho: 2, alto: 2, capacidad: 6 }))).toBe(6);
  });

  it("sin dato fijado, se estima a una plaza por celda", () => {
    expect(capacidadDe(mesa({ ancho: 2, alto: 2 }))).toBe(4);
    expect(capacidadDe(mesa({ ancho: 3, alto: 2 }))).toBe(6);
  });

  /*
   * Los planos de los locales que ya operan no traen capacidad. Si la ausencia
   * se tradujera en cero, el día de la actualización ninguna mesa serviría para
   * sentar a nadie y el salón entero quedaría inutilizable.
   */
  it("una mesa diminuta nunca baja de dos plazas", () => {
    expect(capacidadDe(mesa({ ancho: 1, alto: 1 }))).toBe(2);
  });

  it("un valor absurdo se acota al techo del dominio", () => {
    expect(capacidadDe(mesa({ capacidad: 999 }))).toBe(20);
  });

  it("suma varias mesas", () => {
    expect(
      capacidadDeMesas([mesa({ id: "a", capacidad: 4 }), mesa({ id: "b", capacidad: 6 })]),
    ).toBe(10);
  });
});

describe("dónde sentar a un grupo", () => {
  const chica = mesa({ id: "chica", nombre: "1", capacidad: 2, columna: 0, fila: 0 });
  const mediana = mesa({ id: "mediana", nombre: "2", capacidad: 4, columna: 3, fila: 0 });
  const grande = mesa({ id: "grande", nombre: "3", capacidad: 8, columna: 6, fila: 0 });

  it("propone la mesa que menos plazas desperdicia", () => {
    const [mejor] = acomodosParaGrupo([grande, mediana, chica], 4);
    expect(mejor?.mesas).toEqual(["mediana"]);
    expect(mejor?.sobran).toBe(0);
    expect(mejor?.unida).toBe(false);
  });

  /*
   * Juntar mesas mueve muebles y molesta a quien ya está sentado al lado. No se
   * propone mientras haya una mesa que resuelva sola: la versión anterior
   * ofrecía combinaciones incluso con la mesa perfecta libre, y el mesero tenía
   * que leerse veinte opciones para descartarlas todas.
   */
  it("no propone juntar nada si una mesa sola alcanza", () => {
    const opciones = acomodosParaGrupo([chica, mediana, grande], 6);
    expect(opciones.length).toBeGreaterThan(0);
    expect(opciones.every((o) => !o.unida)).toBe(true);
  });

  it("junta mesas cuando ninguna alcanza sola", () => {
    const [mejor] = acomodosParaGrupo([chica, mediana, grande], 10);
    expect(mejor?.unida).toBe(true);
    expect(mejor?.capacidad).toBeGreaterThanOrEqual(10);
    expect(mejor?.mesas.length).toBeLessThanOrEqual(MAX_MESAS_UNIDAS);
  });

  it("nunca junta mesas de áreas distintas", () => {
    const terraza = mesa({ id: "terraza", nombre: "9", area_id: "terraza", capacidad: 8 });
    const opciones = acomodosParaGrupo([grande, terraza], 14);
    expect(opciones).toEqual([]);
  });

  /*
   * Correcta en la aritmética, absurda en el piso: dos mesas en extremos
   * opuestos del salón suman las plazas que hagan falta y no se pueden juntar.
   */
  it("nunca junta mesas separadas por medio salón", () => {
    const izquierda = mesa({ id: "izq", nombre: "1", capacidad: 6, columna: 0, fila: 0 });
    const derecha = mesa({
      id: "der",
      nombre: "2",
      capacidad: 6,
      columna: DISTANCIA_MAX_UNION + 8,
      fila: 0,
    });
    expect(acomodosParaGrupo([izquierda, derecha], 12)).toEqual([]);
  });

  it("prefiere juntar las mesas que están más cerca", () => {
    const a = mesa({ id: "a", nombre: "1", capacidad: 4, columna: 0, fila: 0 });
    const pegada = mesa({ id: "pegada", nombre: "2", capacidad: 4, columna: 2, fila: 0 });
    const lejana = mesa({ id: "lejana", nombre: "3", capacidad: 4, columna: 5, fila: 0 });

    const [mejor] = acomodosParaGrupo([a, lejana, pegada], 8);
    expect(mejor?.mesas).toEqual(["a", "pegada"]);
  });

  it("ignora las mesas dadas de baja", () => {
    const apagada = mesa({ id: "apagada", capacidad: 20, activa: false });
    expect(acomodosParaGrupo([apagada], 10)).toEqual([]);
  });

  it("devuelve vacío cuando el grupo no cabe ni juntando", () => {
    expect(acomodosParaGrupo([chica, mediana], 40)).toEqual([]);
  });

  /*
   * El defecto que traía la versión anterior: con cincuenta mesas y un grupo de
   * ocho generaba casi veinte mil opciones y recalculaba en cada render. Aquí se
   * comprueba que ni el tiempo ni el número de opciones se disparen.
   */
  it("con un salón grande sigue siendo instantáneo y no devuelve un catálogo", () => {
    const muchas = Array.from({ length: 50 }, (_, i) =>
      mesa({
        id: `m${i}`,
        nombre: String(i + 1),
        capacidad: 2,
        columna: (i % 10) * 2,
        fila: Math.floor(i / 10) * 2,
      }),
    );

    const inicio = Date.now();
    const opciones = acomodosParaGrupo(muchas, 8);
    const tardo = Date.now() - inicio;

    expect(tardo).toBeLessThan(150);
    expect(opciones.length).toBeLessThanOrEqual(8);
    expect(opciones.every((o) => o.mesas.length <= MAX_MESAS_UNIDAS)).toBe(true);
  });

  it("respeta el límite de cuántas se piden", () => {
    const varias = Array.from({ length: 12 }, (_, i) =>
      mesa({ id: `m${i}`, nombre: String(i + 1), capacidad: 6, columna: i, fila: 0 }),
    );
    expect(acomodosParaGrupo(varias, 4, 3)).toHaveLength(3);
  });
});
