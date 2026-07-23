/**
 * Entender la respuesta del PAC.
 *
 * Enviar la petición es lo fácil. Lo que decide si el restaurante factura o no
 * es distinguir "vuelve a intentarlo" de "esto no se va a arreglar solo", y
 * reconocer el caso en que un error es en realidad un éxito.
 */
import { describe, expect, it } from "vitest";
import { clasificar, esRechazoDefinitivo, YA_TIMBRADO } from "../fiscal/pac.js";

const UUID = "11111111-2222-3333-4444-555555555555";

function conTimbre(uuid = UUID): string {
  return `<cfdi:Comprobante><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" FechaTimbrado="2026-07-23T20:00:00" NoCertificadoSAT="00001000000504465028" /></cfdi:Complemento></cfdi:Comprobante>`;
}

describe("un timbrado exitoso", () => {
  it("se reconoce por el timbre en el XML", () => {
    const r = clasificar({ xml: conTimbre() });
    expect(r.estado).toBe("timbrado");
    expect(r.estado === "timbrado" && r.timbrado.timbre.uuid).toBe(UUID);
  });

  it("conserva el XML completo, que es el documento fiscal", () => {
    const r = clasificar({ xml: conTimbre() });
    expect(r.estado === "timbrado" && r.timbrado.xml).toContain("TimbreFiscalDigital");
  });
});

describe("errores que no se arreglan reintentando", () => {
  it.each([
    ["301", "XML mal formado"],
    ["302", "Sello inválido"],
    ["304", "Certificado revocado"],
    ["401", "El RFC no está en la lista del SAT"],
  ])("el %s se rechaza sin reintentar", (codigo, mensaje) => {
    const r = clasificar({ codigo, mensaje });
    expect(r.estado).toBe("rechazado");
    expect(r.estado === "rechazado" && r.motivo).toBe(mensaje);
  });

  it("el catálogo de rechazos definitivos es explícito", () => {
    expect(esRechazoDefinitivo("302")).toBe(true);
    expect(esRechazoDefinitivo(" 302 ")).toBe(true);
    expect(esRechazoDefinitivo("500")).toBe(false);
  });
});

describe("errores pasajeros", () => {
  /*
   * Ante la duda se reintenta. Una factura que tarda se entrega tarde; una que
   * se descarta por un error mal interpretado, nunca.
   */
  it("un código desconocido se considera pasajero", () => {
    expect(clasificar({ codigo: "999", mensaje: "algo raro" }).estado).toBe("reintentable");
  });

  it("una caída sin código también", () => {
    expect(clasificar({ mensaje: "504 Gateway Timeout" }).estado).toBe("reintentable");
  });

  it("una respuesta vacía no revienta ni inventa un motivo", () => {
    const r = clasificar({});
    expect(r.estado).toBe("reintentable");
    expect(r.estado === "reintentable" && r.motivo).toMatch(/no explicó/);
  });
});

// --- El caso traicionero -----------------------------------------------------------------

describe("CFDI previamente timbrado (307)", () => {
  /*
   * Ocurre cuando la conexión se corta después de que el PAC timbró pero antes
   * de que la respuesta llegara. Al reintentar, el PAC responde 307 porque ese
   * comprobante ya tiene UUID.
   *
   * Tratarlo como fallo sería el peor desenlace: una factura que existe ante el
   * SAT, que el restaurante no puede entregar, y un folio que se volvería a usar.
   */
  it("con el timbre incluido, es un ÉXITO aunque venga como error", () => {
    const r = clasificar({ codigo: YA_TIMBRADO, mensaje: "CFDI previamente timbrado", xml: conTimbre() });
    expect(r.estado).toBe("timbrado");
    expect(r.estado === "timbrado" && r.timbrado.timbre.uuid).toBe(UUID);
  });

  /*
   * Sin el timbre no hay nada que reintentar —siempre dará 307— y hay que
   * recuperarlo del portal del PAC. Lo crítico es que el folio NO se reutilice.
   */
  it("sin el timbre, no se reintenta y se dice dónde buscarlo", () => {
    const r = clasificar({ codigo: YA_TIMBRADO, mensaje: "CFDI previamente timbrado" });
    expect(r.estado).toBe("rechazado");
    expect(r.estado === "rechazado" && r.motivo).toMatch(/portal.*PAC/i);
    expect(r.estado === "rechazado" && r.motivo).toMatch(/NO debe reutilizarse/);
  });
});

describe("respuestas mal formadas del PAC", () => {
  it("un XML sin timbre no cuenta como timbrado", () => {
    const r = clasificar({ xml: "<cfdi:Comprobante Version='4.0' />" });
    expect(r.estado).not.toBe("timbrado");
  });

  it("un timbre sin UUID no cuenta como timbrado", () => {
    const r = clasificar({
      xml: '<tfd:TimbreFiscalDigital FechaTimbrado="2026-07-23T20:00:00" />',
    });
    expect(r.estado).not.toBe("timbrado");
  });
});
