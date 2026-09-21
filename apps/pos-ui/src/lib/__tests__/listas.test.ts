/**
 * «Ver más» y «Ordenar», las dos herramientas de las listas largas (1.5.6).
 */
import { describe, expect, it } from "vitest";
import { Paginado, PASO, PRIMEROS, ordenar, ordenesComunes } from "../listas/listas.svelte";

const cien = Array.from({ length: 100 }, (_, i) => i);

describe("Ver más", () => {
  it("al entrar se ven 10 renglones, como pidió Gonzalo", () => {
    const pag = new Paginado();
    expect(PRIMEROS).toBe(10);
    expect(pag.de(cien)).toHaveLength(10);
    expect(pag.restantes(cien)).toBe(90);
  });

  it("cada «Ver más» trae 15 más, mientras quede algo", () => {
    const pag = new Paginado();
    expect(PASO).toBe(15);
    pag.verMas();
    expect(pag.de(cien)).toHaveLength(25);
    pag.verMas();
    expect(pag.de(cien)).toHaveLength(40);
  });

  it("una lista corta no ofrece «Ver más»", () => {
    const pag = new Paginado();
    expect(pag.restantes([1, 2, 3])).toBe(0);
    expect(pag.de([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("al cambiar de filtro vuelve a los 10 primeros", () => {
    const pag = new Paginado();
    pag.verMas();
    pag.verMas();
    pag.reiniciar();
    expect(pag.de(cien)).toHaveLength(10);
  });
});

describe("Ordenar", () => {
  const platillos = [
    { nombre: "Ñoquis", alta: 3 },
    { nombre: "Ensalada", alta: 1 },
    { nombre: "Nabo asado", alta: 2 },
    { nombre: "ábaco", alta: 4 },
  ];
  const opciones = ordenesComunes<(typeof platillos)[number]>({
    nombre: (p) => p.nombre,
    fecha: (p) => p.alta,
  });
  const por = (id: string) => opciones.find((o) => o.id === id);

  it("de la A a la Z en español: los acentos no desordenan y la Ñ va tras la N", () => {
    expect(ordenar(platillos, por("az")).map((p) => p.nombre)).toEqual([
      "ábaco",
      "Ensalada",
      "Nabo asado",
      "Ñoquis",
    ]);
  });

  it("de la Z a la A es exactamente al revés", () => {
    expect(ordenar(platillos, por("za")).map((p) => p.nombre)).toEqual([
      "Ñoquis",
      "Nabo asado",
      "Ensalada",
      "ábaco",
    ]);
  });

  it("por fecha, en los dos sentidos", () => {
    expect(ordenar(platillos, por("recientes")).map((p) => p.alta)).toEqual([4, 3, 2, 1]);
    expect(ordenar(platillos, por("antiguos")).map((p) => p.alta)).toEqual([1, 2, 3, 4]);
  });

  it("sin fecha, no se ofrecen las opciones de fecha", () => {
    const soloNombre = ordenesComunes<{ nombre: string }>({ nombre: (x) => x.nombre });
    expect(soloNombre.map((o) => o.id)).toEqual(["az", "za"]);
  });

  it("no toca la lista original", () => {
    const original = [...platillos];
    ordenar(platillos, por("az"));
    expect(platillos).toEqual(original);
  });
});
