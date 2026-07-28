/**
 * Series por terminal y folios consecutivos.
 *
 * Lo que se prueba es la invariante fiscal: dos terminales NUNCA emiten el mismo
 * identificador, ni estando ambas sin red. Es lo que separa un consecutivo de un
 * problema con el SAT.
 */
import { describe, expect, it } from "vitest";
import { serieDeTerminal, siguienteFolio } from "../fiscal/series.js";

const CAJA = "0192f3a1-7b2c-7000-8000-aaaaaaaaaaaa";
const TABLET = "0192f3a1-9d4e-7000-8000-bbbbbbbbbbbb";

describe("serie por terminal", () => {
  it("cada dispositivo saca la suya", () => {
    expect(serieDeTerminal("A", CAJA)).not.toBe(serieDeTerminal("A", TABLET));
  });

  it("la misma terminal saca siempre la misma", () => {
    // Sobrevive a una reinstalación: el identificador del dispositivo se conserva.
    expect(serieDeTerminal("A", CAJA)).toBe(serieDeTerminal("A", CAJA));
  });

  it("conserva la serie base del local", () => {
    expect(serieDeTerminal("A", CAJA)).toMatch(/^A[A-Z]{2}$/);
    expect(serieDeTerminal("FAC", CAJA)).toMatch(/^FAC[A-Z]{2}$/);
  });

  /* Va impresa en la factura del cliente: que no forme palabras por accidente. */
  it("el sufijo no lleva vocales", () => {
    const muestra = Array.from({ length: 300 }, (_, i) =>
      serieDeTerminal("A", `device-${i}`).slice(1),
    ).join("");
    expect(muestra).not.toMatch(/[AEIOU]/);
  });

  it("reparte: no manda todas las terminales a la misma serie", () => {
    const series = new Set(
      Array.from({ length: 200 }, (_, i) => serieDeTerminal("A", `0192f3a1-${i}-7000`)),
    );
    expect(series.size).toBeGreaterThan(100);
  });
});

describe("folio consecutivo", () => {
  it("arranca en 1001 cuando no hay nada", () => {
    expect(siguienteFolio([], "AKP")).toBe("1001");
  });

  it("sigue el consecutivo de su propia serie", () => {
    const registros = [
      { serie: "AKP", folio: "1001" },
      { serie: "AKP", folio: "1002" },
    ];
    expect(siguienteFolio(registros, "AKP")).toBe("1003");
  });

  /*
   * EL CASO QUE JUSTIFICA TODO EL MÓDULO. La tablet no debe correr su folio por
   * lo que facturó la caja, ni al revés: cada serie lleva su cuenta.
   */
  it("los comprobantes de otra terminal no corren este consecutivo", () => {
    const registros = [
      { serie: "AKP", folio: "1001" }, // caja
      { serie: "AWZ", folio: "1001" }, // tablet
      { serie: "AWZ", folio: "1002" },
      { serie: "AWZ", folio: "1003" },
    ];
    expect(siguienteFolio(registros, "AKP")).toBe("1002");
    expect(siguienteFolio(registros, "AWZ")).toBe("1004");
  });

  it("dos terminales sin red no colisionan", () => {
    const serieCaja = serieDeTerminal("A", CAJA);
    const serieTablet = serieDeTerminal("A", TABLET);

    // Ninguna ha visto lo de la otra: ambas emiten su 1001.
    const idCaja = `${serieCaja}-${siguienteFolio([], serieCaja)}`;
    const idTablet = `${serieTablet}-${siguienteFolio([], serieTablet)}`;

    expect(idCaja).not.toBe(idTablet);
  });

  it("ignora folios que no son un número", () => {
    const registros = [
      { serie: "AKP", folio: "1001" },
      { serie: "AKP", folio: "s/n" },
    ];
    expect(siguienteFolio(registros, "AKP")).toBe("1002");
  });
});
