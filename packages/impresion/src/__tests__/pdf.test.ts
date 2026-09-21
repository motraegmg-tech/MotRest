/**
 * El PDF: que sea un archivo válido, no solo que no truene al generarse.
 *
 * Un PDF mal armado no da error en Node: da un archivo que el lector rechaza
 * cuando el contador intenta abrirlo, tres días después y en otra computadora.
 * Por eso lo que se prueba aquí es la estructura del archivo —los offsets del
 * `xref`, sobre todo—, que es lo único que decide si abre.
 */
import { describe, expect, it } from "vitest";
import {
  DIFERENCIA_ENTRE_UTILIDADES,
  UTILIDAD_CONTABLE,
  UTILIDAD_EN_EFECTIVO,
  type Centavos,
  type EstadoFinanciero,
} from "@motrest/dominio";
import { CARTA, DocumentoPdf, anchoDeTexto, recortar } from "../pdf.js";
import {
  estadoFinancieroPdf,
  importe,
  nombreArchivoEstado,
  partirEnRenglones,
} from "../estado-financiero-pdf.js";

const c = (n: number) => n as Centavos;

/** Lee el archivo como texto latin-1, que es como está escrito. */
function comoTexto(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * Comprueba que cada offset del `xref` apunta de verdad al inicio de su objeto.
 *
 * Es LA prueba de este archivo. Un offset corrido por un byte —lo que pasaría
 * si una `á` se colara como UTF-8— produce un PDF que abre en unos lectores y
 * en otros no, que es la peor forma posible de fallar.
 */
function offsetsCuadran(bytes: Uint8Array): boolean {
  const texto = comoTexto(bytes);
  const inicio = texto.lastIndexOf("xref");
  const tabla = texto.slice(inicio);

  const renglones = tabla.split("\n").slice(2);
  for (let numero = 1; numero < renglones.length; numero += 1) {
    const renglon = renglones[numero - 1 + 1];
    if (!renglon || !/^\d{10} \d{5} n/.test(renglon)) break;

    const offset = Number(renglon.slice(0, 10));
    if (!texto.startsWith(`${numero} 0 obj`, offset)) return false;
  }
  return true;
}

// --- El generador -----------------------------------------------------------------------

describe("documento PDF", () => {
  it("produce un archivo con cabecera, xref y fin", () => {
    const doc = new DocumentoPdf("Prueba");
    doc.nuevaPagina().texto(60, 60, "Hola");
    const texto = comoTexto(doc.bytes());

    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(texto).toContain("/Type /Catalog");
    expect(texto.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("los offsets del xref apuntan a sus objetos", () => {
    const doc = new DocumentoPdf("Prueba");
    doc.nuevaPagina().texto(60, 60, "Primera");
    doc.nuevaPagina().texto(60, 60, "Segunda");
    expect(offsetsCuadran(doc.bytes())).toBe(true);
  });

  it("los acentos NO corren los offsets", () => {
    // Es el error que este diseño evita: en UTF-8 «ñ» ocuparía dos bytes y toda
    // la tabla de posiciones quedaría desplazada.
    const doc = new DocumentoPdf("Año");
    doc.nuevaPagina().texto(60, 60, "Piña, jamón y albahaca · 1 250 g — ¡listo!");
    const bytes = doc.bytes();

    expect(offsetsCuadran(bytes)).toBe(true);
    // La eñe sale como UN byte de WinAnsi (0xF1), no como dos de UTF-8.
    expect([...bytes]).toContain(0xf1);
  });

  it("escapa los paréntesis, que delimitan las cadenas del PDF", () => {
    const doc = new DocumentoPdf("Prueba");
    doc.nuevaPagina().texto(60, 60, "Gas (tanque) 50%");
    const texto = comoTexto(doc.bytes());
    expect(texto).toContain("Gas \\(tanque\\) 50%");
    expect(offsetsCuadran(doc.bytes())).toBe(true);
  });

  it("cuenta las páginas que se le pidieron", () => {
    const doc = new DocumentoPdf("Prueba");
    doc.nuevaPagina();
    doc.nuevaPagina();
    doc.nuevaPagina();
    expect(doc.cuantasPaginas).toBe(3);
    expect(comoTexto(doc.bytes())).toContain("/Count 3");
  });
});

// --- Medidas -----------------------------------------------------------------------------

describe("medir texto", () => {
  it("Courier es de ancho fijo: dos cifras del mismo largo miden igual", () => {
    // De esto depende que los importes queden alineados en columna.
    expect(anchoDeTexto("$1,234.56", "cifra", 9)).toBe(anchoDeTexto("$9,999.99", "cifra", 9));
  });

  it("recorta lo que no cabe y deja constancia con puntos suspensivos", () => {
    const recortado = recortar("Compra de mercancía al proveedor de siempre", "normal", 9, 60);
    expect(recortado.endsWith("…")).toBe(true);
    expect(anchoDeTexto(recortado, "normal", 9)).toBeLessThanOrEqual(60);
  });

  it("no toca lo que ya cabe", () => {
    expect(recortar("Gas", "normal", 9, 200)).toBe("Gas");
  });

  it("parte un párrafo en renglones que caben, sin perder ni cortar palabras", () => {
    // La maqueta no reparte texto: si un renglón no cabe, se sale del papel.
    const ancho = CARTA.ancho - 54 * 2;
    const renglones = partirEnRenglones(DIFERENCIA_ENTRE_UTILIDADES, "normal", 7.5, ancho);

    expect(renglones.length).toBeGreaterThan(1);
    for (const r of renglones) {
      expect(anchoDeTexto(r, "normal", 7.5)).toBeLessThanOrEqual(ancho);
    }
    expect(renglones.join(" ")).toBe(DIFERENCIA_ENTRE_UTILIDADES);
  });
});

// --- Importes ------------------------------------------------------------------------------

describe("formato de importe", () => {
  it("separa los miles y siempre pone dos decimales", () => {
    expect(importe(c(123_456))).toBe("$1,234.56");
    expect(importe(c(100))).toBe("$1.00");
    expect(importe(c(0))).toBe("$0.00");
  });

  it("el signo va antes del peso, como se lee", () => {
    expect(importe(c(-45_000))).toBe("-$450.00");
  });

  it("aguanta cifras grandes sin perder un centavo", () => {
    expect(importe(c(123_456_789))).toBe("$1,234,567.89");
  });
});

// --- El informe completo ---------------------------------------------------------------------

/** Un mes con lo justo para que todas las secciones tengan algo que dibujar. */
function estadoDePrueba(gastos: number): EstadoFinanciero {
  const desde = new Date("2026-09-01T06:00:00Z").getTime();
  const hasta = new Date("2026-10-01T06:00:00Z").getTime();

  return {
    desde,
    hasta,
    local: "Rodizio Pizzas y Pasta",
    emitido_ts: hasta,
    ventas: {
      desde,
      hasta,
      cuentas: 412,
      // Un socio consumió en el mes: entró al local, pero no es venta (1.5.6).
      consumo_socios: c(1_200_00),
      subtotal: c(38_000_00),
      iva: c(6_080_00),
      ieps: c(0),
      total: c(44_080_00),
      propinas: c(3_100_00),
      descuentos: c(900_00),
      cortesias: c(250_00),
      por_forma_pago: [
        { forma: "efectivo", etiqueta: "Efectivo", cuentas: 240, importe: c(26_000_00) },
        { forma: "tarjeta_credito", etiqueta: "Crédito", cuentas: 172, importe: c(18_080_00) },
      ],
      cfdi_timbrados: 12,
      cfdi_total: c(9_400_00),
      cfdi_iva: c(1_296_55),
      cfdi_cancelados: 1,
      sin_facturar: c(34_680_00),
      egresos: c(21_000_00),
      cuentas_reabiertas: 2,
    },
    gastos: [
      {
        categoria: "insumos",
        nombre: "Compra de insumos",
        afectaResultado: false,
        total: c(14_000_00),
        renglones: Array.from({ length: gastos }, (_, i) => ({
          ts: desde + i * 86_400_000,
          concepto: `Pedido de quesos y embutidos número ${i + 1}`,
          proveedor: "Lácteos del Bajío",
          forma_pago: "transferencia",
          monto: c(1_400_00),
          pagado: i % 5 !== 0,
          folio_comprobante: `A-${1000 + i}`,
        })),
      },
      {
        categoria: "servicios",
        nombre: "Servicios",
        afectaResultado: true,
        total: c(7_000_00),
        renglones: [
          {
            ts: desde + 3 * 86_400_000,
            concepto: "Luz (CFE) — bimestre julio-agosto",
            forma_pago: "efectivo",
            monto: c(7_000_00),
            pagado: true,
          },
        ],
      },
    ],
    total_gastos: c(21_000_00),
    resultado: {
      ingreso: c(38_000_00),
      costo: c(11_780_00),
      margen_bruto: c(26_220_00),
      egresos_operativos: c(7_000_00),
      resultado: c(19_220_00),
      compras: c(14_000_00),
      salida_total: c(21_000_00),
      // 38 000 de venta sin IVA − 21 000 de todo lo que salió.
      utilidad_efectivo: c(17_000_00),
      por_categoria: [
        { categoria: "servicios", nombre: "Servicios", monto: c(7_000_00), afectaResultado: true },
        { categoria: "insumos", nombre: "Compra de insumos", monto: c(14_000_00), afectaResultado: false },
      ],
      food_cost: 0.31,
    },
    flujo: {
      desde,
      hasta,
      inicial: { efectivo: c(12_000_00), banco: c(48_000_00), total: c(60_000_00) },
      final: { efectivo: c(31_000_00), banco: c(52_080_00), total: c(83_080_00) },
      entradas: c(44_080_00),
      salidas: c(21_000_00),
      neto: c(23_080_00),
      movimientos: Array.from({ length: gastos * 2 }, (_, i) => ({
        id: `mov-${i}`,
        ts: desde + i * 3_600_000,
        cuenta: i % 2 === 0 ? ("efectivo" as const) : ("banco" as const),
        origen: "venta" as const,
        concepto: `Cuenta A1B2C3D${i} · Efectivo`,
        monto: c(500_00),
        saldo: c(12_500_00 + i * 500_00),
        justificacion: i === 3 ? "Ajuste por el faltante del viernes, autorizado por Gonzalo" : undefined,
      })),
    },
    por_pagar: c(4_200_00),
    documentos_por_pagar: 3,
    historial_retirado_hasta: 0,
    periodo_incompleto: false,
    cortes: {
      turnos: 26,
      turnos_abiertos: 1,
      declarado: c(24_950_00),
      esperado: c(25_000_00),
      diferencia: c(-50_00),
    },
  };
}

describe("estado financiero en PDF", () => {
  it("sale un archivo válido y con varias páginas", () => {
    const bytes = estadoFinancieroPdf(estadoDePrueba(20));
    const texto = comoTexto(bytes);

    expect(texto.startsWith("%PDF-1.4")).toBe(true);
    expect(offsetsCuadran(bytes)).toBe(true);
    // Con veinte gastos y cuarenta movimientos no cabe en una hoja.
    expect(texto).not.toContain("/Count 1 ");
  });

  it("un mes con cien gastos NO se sale del papel: pagina solo", () => {
    const bytes = estadoFinancieroPdf(estadoDePrueba(100));
    const texto = comoTexto(bytes);
    const paginas = Number(/\/Count (\d+)/.exec(texto)?.[1] ?? 0);

    expect(paginas).toBeGreaterThan(4);
    expect(offsetsCuadran(bytes)).toBe(true);
  });

  it("deja escrito por qué las compras no restan a la utilidad", () => {
    // Sin ese párrafo, quien lea el informe creerá que la cuenta está mal.
    const texto = comoTexto(estadoFinancieroPdf(estadoDePrueba(3)));
    expect(texto).toContain("NO se restan");
  });

  /*
   * LAS DOS UTILIDADES, con el mismo nombre que en la pantalla del día y la
   * del mes. Los nombres vienen del dominio: si alguien los cambia ahí, el
   * papel cambia con ellos, y si alguien los teclea aquí a mano, esto falla.
   */
  it("enseña las dos utilidades con su nombre y su cifra", () => {
    const texto = comoTexto(estadoFinancieroPdf(estadoDePrueba(3)));

    expect(texto).toContain(UTILIDAD_CONTABLE);
    expect(texto).toContain(UTILIDAD_EN_EFECTIVO);
    // La contable (19 220) y la de efectivo (17 000), tal como llegan del dominio.
    expect(texto).toContain(importe(c(19_220_00)));
    expect(texto).toContain(importe(c(17_000_00)));
  });

  it("dice en qué se diferencian las dos utilidades", () => {
    const texto = comoTexto(estadoFinancieroPdf(estadoDePrueba(3)));
    // El párrafo se parte en renglones; basta con su arranque.
    expect(texto).toContain("La contable resta los insumos cuando se venden");
    expect(DIFERENCIA_ENTRE_UTILIDADES.startsWith("La contable resta los insumos")).toBe(true);
  });

  it("una utilidad de siete cifras no rompe el papel", () => {
    // Con cinco tarjetas en la hoja, la cifra baja de tamaño para caber en la suya.
    const base = estadoDePrueba(3);
    const bytes = estadoFinancieroPdf({
      ...base,
      resultado: { ...base.resultado, utilidad_efectivo: c(-1_234_567_89) },
    });
    expect(offsetsCuadran(bytes)).toBe(true);
    expect(comoTexto(bytes)).toContain("-$1,234,567.89");
  });

  it("nombra el archivo con el mes y el local, sin acentos ni espacios", () => {
    const nombre = nombreArchivoEstado(estadoDePrueba(1));
    expect(nombre).toBe("estado-financiero-2026-09-rodizio-pizzas-y-pasta.pdf");
  });

  it("al quitar los acentos del nombre NO se come dígitos ni letras", () => {
    /*
     * La expresión estaba escrita sin las `\u` y quitaba los caracteres 0, 3,
     * 6 y f en vez de las marcas de acento: «La Fonda 360» salía «la-onda».
     */
    const nombre = nombreArchivoEstado({ ...estadoDePrueba(1), local: "La Fonda 360 · Café" });
    expect(nombre).toBe("estado-financiero-2026-09-la-fonda-360-cafe.pdf");
  });

  it("un mes al que le retiraron historial lo dice ARRIBA, no al pie", () => {
    /*
     * Es el papel que alguien le entrega a su contador. Un informe al que le
     * faltan cuentas no sale con error: sale con números pequeños, y eso se
     * firma sin sospechar. El aviso tiene que estar antes de las cifras.
     */
    const base = estadoDePrueba(3);
    const texto = comoTexto(
      estadoFinancieroPdf({
        ...base,
        historial_retirado_hasta: base.desde - 5 * 86_400_000,
        periodo_incompleto: true,
      }),
    );

    expect(texto).toContain("Informe incompleto");
    // Y lo repite en la cabecera de las hojas siguientes: un informe se fotocopia.
    expect(texto).toContain("INCOMPLETO");
  });

  it("un mes completo NO lleva el aviso", () => {
    // Un aviso que sale siempre deja de leerse.
    expect(comoTexto(estadoFinancieroPdf(estadoDePrueba(3)))).not.toContain("Informe incompleto");
  });

  it("los renglones del aviso caben en la hoja", () => {
    /*
     * La maqueta escribe donde se le dice: no reparte texto ni corta. Una
     * línea de más se saldría del papel sin que nada fallara, y el aviso
     * quedaría a medias justo en el documento donde más importa.
     */
    const base = estadoDePrueba(1);
    const util = CARTA.ancho - 54 * 2 - 24;
    const lineas = [
      `Las cuentas anteriores al 30 de septiembre de 2026 se retiraron de esta`,
      "computadora por la política de retención elegida. La venta y los gastos de abajo son",
      "solo los que siguen guardados. El dinero al cierre sí es correcto.",
      "Informe incompleto: a este período le falta historial",
    ];

    for (const linea of lineas) {
      expect(anchoDeTexto(linea, "normal", 9.5)).toBeLessThan(util);
    }
    expect(base.periodo_incompleto).toBe(false);
  });

  it("un mes sin nada tampoco rompe el papel", () => {
    const vacio = estadoDePrueba(0);
    const bytes = estadoFinancieroPdf({
      ...vacio,
      gastos: [],
      total_gastos: c(0),
      flujo: { ...vacio.flujo, movimientos: [] },
      cortes: { turnos: 0, turnos_abiertos: 0, declarado: c(0), esperado: c(0), diferencia: c(0) },
    });
    expect(offsetsCuadran(bytes)).toBe(true);
    expect(comoTexto(bytes)).toContain("No se registr");
  });
});
