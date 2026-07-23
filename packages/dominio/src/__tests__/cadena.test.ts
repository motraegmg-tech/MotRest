import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { cadenaOriginal } from "../fiscal/cadena.js";
import type { Comprobante } from "../fiscal/comprobante.js";

/**
 * Una factura de restaurante típica: dos platillos al 16 %, sin descuento.
 * Es el caso que Rodizio emitirá cien veces al día.
 */
function comprobante(extra: Partial<Comprobante> = {}): Comprobante {
  return {
    version: "4.0",
    serie: "A",
    folio: "123",
    fecha: "2026-07-22T21:15:00",
    forma_pago: "01",
    metodo_pago: "PUE",
    lugar_expedicion: "06000",
    moneda: "MXN",
    tipo_comprobante: "I",
    exportacion: "01",
    subtotal: pesos(516),
    descuento: pesos(0) as never,
    total: pesos(598.56),
    no_certificado: "30001000000400002434",
    emisor: {
      rfc: "XAXX010101000",
      nombre: "RODIZIO SA DE CV",
      regimen_fiscal: "601",
      codigo_postal: "06000",
    },
    receptor: {
      rfc: "XEXX010101000",
      nombre: "PUBLICO EN GENERAL",
      regimen_fiscal: "616",
      codigo_postal: "06000",
      uso_cfdi: "S01",
    },
    conceptos: [
      {
        clave_prod_serv: "90101501",
        cantidad: 2,
        clave_unidad: "E48",
        descripcion: "Pizza familiar",
        valor_unitario: pesos(249),
        importe: pesos(498),
        descuento: pesos(0) as never,
        objeto_imp: "02",
        traslados: [
          {
            base: pesos(498),
            impuesto: "002",
            tipo_factor: "Tasa",
            tasa_o_cuota: 0.16,
            importe: pesos(79.68),
          },
        ],
      },
    ],
    traslados: [
      {
        base: pesos(516),
        impuesto: "002",
        tipo_factor: "Tasa",
        tasa_o_cuota: 0.16,
        importe: pesos(82.56),
      },
    ],
    total_impuestos_trasladados: pesos(82.56),
    orden_id: "ord-1",
    ...extra,
  };
}

describe("estructura de la cadena original", () => {
  it("empieza y termina con doble barra", () => {
    const cadena = cadenaOriginal(comprobante());
    expect(cadena.startsWith("||")).toBe(true);
    expect(cadena.endsWith("||")).toBe(true);
  });

  it("los datos del comprobante van en el orden del Anexo 20", () => {
    const cadena = cadenaOriginal(comprobante());
    // Version|Serie|Folio|Fecha|FormaPago|NoCertificado|...
    expect(cadena).toContain(
      "||4.0|A|123|2026-07-22T21:15:00|01|30001000000400002434|",
    );
  });

  it("FormaPago va ANTES que NoCertificado", () => {
    /*
     * Es contraintuitivo —en el XML aparecen al revés— y es el error clásico.
     * Invertirlos produce una cadena que el PAC no reproduce, y entonces
     * rechaza TODAS las facturas con "sello inválido".
     */
    const cadena = cadenaOriginal(comprobante());
    expect(cadena.indexOf("|01|30001000000400002434|")).toBeGreaterThan(0);
  });

  it("el emisor va después del comprobante y antes del receptor", () => {
    const cadena = cadenaOriginal(comprobante());
    const emisor = cadena.indexOf("RODIZIO SA DE CV");
    const receptor = cadena.indexOf("PUBLICO EN GENERAL");
    expect(emisor).toBeGreaterThan(0);
    expect(receptor).toBeGreaterThan(emisor);
  });

  it("el total de impuestos trasladados va al final, tras su detalle", () => {
    const cadena = cadenaOriginal(comprobante());
    expect(cadena.endsWith("|82.56||")).toBe(true);
  });
});

describe("atributos opcionales ausentes", () => {
  it("se OMITEN, no dejan un campo vacío", () => {
    const cadena = cadenaOriginal(comprobante());
    /*
     * Si un opcional ausente dejara un campo vacío habría `||` en medio de la
     * cadena, y ahí ya no cuadraría con la del PAC. Los únicos `||` legítimos
     * son el del principio y el del final.
     */
    const enMedio = cadena.slice(2, -2);
    expect(enMedio).not.toContain("||");
  });

  it("un descuento en cero no aparece", () => {
    const cadena = cadenaOriginal(comprobante());
    // Subtotal seguido directo de la moneda: sin descuento en medio.
    expect(cadena).toContain("|516.00|MXN|");
  });

  it("un descuento real sí aparece, entre el subtotal y la moneda", () => {
    const cadena = cadenaOriginal(comprobante({ descuento: pesos(50) }));
    expect(cadena).toContain("|516.00|50.00|MXN|");
  });
});

describe("normalización de los valores", () => {
  it("recorta los espacios de los extremos", () => {
    const cadena = cadenaOriginal(
      comprobante({
        receptor: { ...comprobante().receptor, nombre: "  JUAN PEREZ  " },
      }),
    );
    expect(cadena).toContain("|JUAN PEREZ|");
  });

  it("colapsa los espacios internos repetidos", () => {
    /*
     * Un nombre capturado con dos espacios daría una cadena distinta a la que
     * calcula el PAC leyendo el XML, y la factura se rechazaría por algo que
     * nadie relacionaría con la captura.
     */
    const cadena = cadenaOriginal(
      comprobante({
        receptor: { ...comprobante().receptor, nombre: "JUAN   PEREZ  LOPEZ" },
      }),
    );
    expect(cadena).toContain("|JUAN PEREZ LOPEZ|");
  });
});

describe("conceptos", () => {
  it("incluye el detalle de impuestos de cada concepto", () => {
    const cadena = cadenaOriginal(comprobante());
    expect(cadena).toContain("|90101501|2|E48|Pizza familiar|249.00|498.00|02|");
    expect(cadena).toContain("|498.00|002|Tasa|0.160000|79.68|");
  });

  it("un concepto exento no arrastra traslados", () => {
    const base = comprobante();
    const cadena = cadenaOriginal({
      ...base,
      conceptos: [{ ...base.conceptos[0]!, objeto_imp: "01", traslados: [] }],
    });
    expect(cadena).toContain("|Pizza familiar|249.00|498.00|01|");
  });

  it("varios conceptos van uno tras otro", () => {
    const base = comprobante();
    const cadena = cadenaOriginal({
      ...base,
      conceptos: [
        base.conceptos[0]!,
        { ...base.conceptos[0]!, descripcion: "Limonada", cantidad: 1 },
      ],
    });
    expect(cadena).toContain("Pizza familiar");
    expect(cadena).toContain("Limonada");
    expect(cadena.indexOf("Limonada")).toBeGreaterThan(cadena.indexOf("Pizza familiar"));
  });
});

describe("la tasa se escribe como la exige el SAT", () => {
  it("con seis decimales", () => {
    // 0.16 tiene que salir como "0.160000": "0.16" a secas se rechaza.
    expect(cadenaOriginal(comprobante())).toContain("|0.160000|");
  });
});

describe("sin número de certificado", () => {
  it("se niega a construir la cadena en vez de producir una inválida", () => {
    /*
     * Devolver una cadena sin NoCertificado sería peor que fallar: se firmaría,
     * se mandaría al PAC y volvería rechazada sin que nadie supiera por qué.
     */
    expect(() => cadenaOriginal(comprobante({ no_certificado: undefined }))).toThrow(
      /certificado/i,
    );
  });
});
