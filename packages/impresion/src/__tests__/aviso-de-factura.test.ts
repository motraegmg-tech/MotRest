/**
 * El aviso de factura sobre el QR (1.5.7): es una frase entera, no un rótulo, y
 * tiene que partirse en renglones que quepan en el papel. Debajo del QR van la
 * dirección escrita y la clave con el folio.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "@motrest/dominio";
import { precuenta } from "../plantillas.js";

const AVISO =
  "¿Necesita factura? Escanee este código QR y facture desde su celular en las próximas 72 horas, o pídala a su mesero antes de irse.";

function ticket(columnas: 32 | 42) {
  return precuenta(
    {
      folio: "A1B2C3D4",
      ts: new Date(2026, 8, 23, 21).getTime(),
      local: { nombre: "Rodizio" },
      mesa: "7",
      mesero: "Lucía",
      renglones: [{ cantidad: 1, descripcion: "Pizza", importe: pesos(289) }],
      suma: pesos(289),
      descuentos: pesos(0),
      cortesias: pesos(0),
      total: pesos(289),
      qrs: [
        {
          leyenda: AVISO,
          url: "https://mot-rest-portal.vercel.app/r/PRUEBA/A1B2C3D4?t=ABCDEFGHJKMNPQRS",
          pie: ["mot-rest-portal.vercel.app", "Clave: PRUEBA   Folio: A1B2C3D4"],
          esFactura: true,
        },
      ],
    },
    columnas,
  ).aTexto();
}

describe("el aviso de factura sobre el QR", () => {
  for (const columnas of [32, 42] as const) {
    it(`se parte en renglones que caben en ${columnas} columnas`, () => {
      const texto = ticket(columnas);
      for (const linea of texto.split("\n")) expect(linea.length).toBeLessThanOrEqual(columnas);
      expect(texto.replace(/\s+/g, " ")).toContain("próximas 72 horas");
    });
  }

  it("debajo del QR va la dirección escrita y luego la clave con el folio", () => {
    const texto = ticket(42);
    expect(texto.indexOf("mot-rest-portal.vercel.app")).toBeLessThan(texto.indexOf("Clave: PRUEBA"));
    expect(texto.indexOf("antes de irse")).toBeLessThan(texto.indexOf("mot-rest-portal.vercel.app"));
  });
});
