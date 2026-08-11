import { describe, expect, it } from "vitest";
import { pesos, type Centavos } from "@motrest/dominio";
import { Ticket, aCP437 } from "../escpos.js";
import { comandaCocina, corteCaja, precuenta, ticketVenta } from "../plantillas.js";
import { sellarCorte, verificarSello, type CifrasCorte } from "../sello.js";
import {
  ColaImpresion,
  MAX_INTENTOS_IMPRESION,
  TransporteSimulado,
  esperaReintento,
  impresoraPara,
  type Impresora,
  type ResultadoEnvio,
  type Transporte,
} from "../cola.js";

const T0 = new Date(2026, 6, 22, 21, 15).getTime();

// --- Codificación -------------------------------------------------------------------

describe("codificación para impresoras térmicas", () => {
  it("el ASCII pasa tal cual", () => {
    expect(aCP437("Pizza")).toEqual([80, 105, 122, 122, 97]);
  });

  it("los acentos y la eñe usan CP437, no UTF-8", () => {
    // En UTF-8 la "ñ" ocuparía dos bytes y la impresora escupiría dos símbolos.
    expect(aCP437("ñ")).toEqual([0xa4]);
    expect(aCP437("á")).toEqual([0xa0]);
    expect(aCP437("¿")).toEqual([0xa8]);
    expect(aCP437("Piña")).toHaveLength(4);
  });

  it("lo que no existe en CP437 se degrada a su letra sin acento", () => {
    // Vale más "Cafe" que "Caf?".
    expect(aCP437("ç")).toEqual([99]);
    expect(aCP437("—")).toEqual([45]);
  });

  it("un símbolo sin byte propio NO se mapea al de una letra existente", () => {
    // Regresión: el euro apuntaba al byte de la "E", así que al releer el
    // ticket "Esperado en cajon" se mostraba como "€sperado en cajon".
    const t = new Ticket(42).linea("Esperado");
    expect(t.aTexto()).toContain("Esperado");
    expect(t.aTexto()).not.toContain("€");
  });

  it("un carácter desconocido no rompe la impresión", () => {
    expect(aCP437("日")).toEqual([0x20]);
  });
});

describe("armado del ticket", () => {
  it("alinea concepto e importe a los extremos del papel", () => {
    const t = new Ticket(32);
    t.columnasDobles("Subtotal", "$516.00");
    const linea = t.aTexto().split("\n")[0]!;
    expect(linea).toHaveLength(32);
    expect(linea.startsWith("Subtotal")).toBe(true);
    expect(linea.endsWith("$516.00")).toBe(true);
  });

  it("si no cabe, recorta el concepto y NUNCA el importe", () => {
    const t = new Ticket(32);
    t.columnasDobles("Pizza familiar mitad y mitad con orilla rellena", "$1,249.00");
    const linea = t.aTexto().split("\n")[0]!;
    expect(linea.endsWith("$1,249.00")).toBe(true);
    expect(linea.length).toBeLessThanOrEqual(32);
  });

  it("el separador ocupa exactamente el ancho del papel", () => {
    expect(new Ticket(42).separador().aTexto()).toHaveLength(42);
  });

  it("produce bytes, no texto", () => {
    const bytes = new Ticket(32).linea("Hola").construir();
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Arranca con ESC @ (inicializar impresora).
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it("el estilo se revierte tras cada línea, para no contagiar a la siguiente", () => {
    const bytes = [...new Ticket(32).linea("FUERTE", { negrita: true }).construir()];
    // ESC E 1 … ESC E 0
    const enciende = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 1);
    const apaga = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 0);
    expect(enciende).toBeGreaterThanOrEqual(0);
    expect(apaga).toBeGreaterThan(enciende);
  });
});

// --- Plantillas ---------------------------------------------------------------------

describe("comanda de cocina", () => {
  const datos = {
    orden_id: "ord-abc123456789",
    mesa: "12",
    mesero: "Lucía",
    estacion: "HORNO",
    ts: T0,
    renglones: [
      { cantidad: 2, descripcion: "Pizza familiar", detalle: "½ Margherita · ½ Pepperoni" },
      { cantidad: 1, descripcion: "Ensalada César", notas: "SIN ADEREZO - alergia" },
    ],
  };

  it("lleva la mesa y la estación bien visibles", () => {
    const texto = comandaCocina(datos).aTexto();
    expect(texto).toContain("HORNO");
    expect(texto).toContain("MESA 12");
  });

  it("NO lleva precios: a la cocina no le sirven", () => {
    expect(comandaCocina(datos).aTexto()).not.toContain("$");
  });

  it("resalta las notas, que es lo que más caro cuesta pasar por alto", () => {
    expect(comandaCocina(datos).aTexto()).toContain(">> SIN ADEREZO - alergia");
  });

  it("una reimpresión se identifica como tal", () => {
    const texto = comandaCocina({ ...datos, reimpresion: 1 }).aTexto();
    expect(texto).toContain("REIMPRESION #1");
  });

  it("conserva los acentos del mesero", () => {
    expect(comandaCocina(datos).aTexto()).toContain("Lucía");
  });
});

describe("pre-cuenta", () => {
  /*
   * Precios de carta a $498 y $45 SIN IVA incluido (perfil IVA_16 de Rodizio).
   * Con el 16 % dentro, los renglones son 577.68 y 52.20, que suman 629.88.
   */
  const datos = {
    folio: "A1B2C3D4",
    ts: T0,
    local: { nombre: "Rodizio", direccion: "Av. Central 100", telefono: "55 1234 5678" },
    mesa: "12",
    mesero: "Lucía",
    renglones: [
      { cantidad: 2, descripcion: "Pizza familiar", importe: pesos(577.68) },
      { cantidad: 1, descripcion: "Limonada", importe: pesos(52.2) },
    ],
    suma: pesos(629.88),
    descuentos: pesos(0) as Centavos,
    cortesias: pesos(0) as Centavos,
    total: pesos(629.88),
  };

  it("imprime cada renglón con el impuesto dentro", () => {
    const texto = precuenta(datos).aTexto();
    expect(texto).toContain("$577.68");
    expect(texto).toContain("$52.20");
  });

  it("los renglones suman el total: es lo que el comensal hace con el dedo", () => {
    const suma = datos.renglones.reduce((a, r) => a + r.importe, 0);
    expect(suma).toBe(datos.total);
  });

  it("se declara como lo que es, y no como un comprobante", () => {
    const texto = precuenta(datos).aTexto();
    expect(texto).toContain("CUENTA");
    expect(texto).toContain("NO ES COMPROBANTE DE PAGO");
    expect(texto).toContain("Precios con IVA incluido");
  });

  it("no lleva RFC: un papel con RFC parece una factura", () => {
    expect(precuenta(datos).aTexto()).not.toContain("RFC");
  });

  /*
   * Nada de lo que solo existe después de pagar. Si algún día alguien reusa la
   * plantilla del ticket para esto, estas tres líneas lo cazan.
   */
  it("no lleva forma de pago, ni cambio, ni QR de factura", () => {
    const texto = precuenta(datos).aTexto();
    expect(texto).not.toContain("Efectivo");
    expect(texto).not.toContain("Cambio");
    expect(texto).not.toContain("Factura tu consumo");
  });

  it("sin rebajas no repite el total dos veces bajo nombres distintos", () => {
    expect(precuenta(datos).aTexto()).not.toContain("Suma");
  });

  it("con descuento enseña la suma, la rebaja y el total, y cuadran", () => {
    const conRebaja = {
      ...datos,
      descuentos: pesos(29.88),
      total: pesos(600),
    };
    const texto = precuenta(conRebaja).aTexto();
    expect(texto).toContain("Suma");
    expect(texto).toContain("-$29.88");
    expect(texto).toContain("$600.00");
    expect(conRebaja.suma - conRebaja.descuentos - conRebaja.cortesias).toBe(conRebaja.total);
  });
});

describe("ticket de venta", () => {
  const datos = {
    folio: "A-000123",
    ts: T0,
    local: { nombre: "Rodizio", direccion: "Av. Central 100", rfc: "XAXX010101000" },
    mesa: "12",
    mesero: "Lucía",
    renglones: [
      { cantidad: 2, descripcion: "Pizza familiar", importe: pesos(498) },
      { cantidad: 1, descripcion: "Limonada", importe: pesos(45) },
    ],
    subtotal: pesos(543),
    descuentos: pesos(27),
    cortesias: pesos(0) as Centavos,
    iva: pesos(82.56),
    ieps: pesos(0) as Centavos,
    total: pesos(598.56),
    propina: pesos(60),
    pagos: [{ forma: "Efectivo", monto: pesos(700) }],
    cambio: pesos(41.44),
  };

  it("imprime los datos fiscales del local", () => {
    const texto = ticketVenta(datos).aTexto();
    expect(texto).toContain("Rodizio");
    expect(texto).toContain("RFC: XAXX010101000");
  });

  it("desglosa impuestos y total", () => {
    const texto = ticketVenta(datos).aTexto();
    expect(texto).toContain("$543.00");
    expect(texto).toContain("$82.56");
    expect(texto).toContain("$598.56");
  });

  it("imprime el descuento aplicado: el comensal tiene derecho a verlo", () => {
    expect(ticketVenta(datos).aTexto()).toContain("-$27.00");
  });

  it("omite las líneas que valen cero, para no ensuciar el ticket", () => {
    const texto = ticketVenta(datos).aTexto();
    expect(texto).not.toContain("Cortesias");
    expect(texto).not.toContain("IEPS");
  });

  it("separa la propina del total, sin mezclarlas", () => {
    const texto = ticketVenta(datos).aTexto();
    expect(texto).toContain("Propina");
    expect(texto).toContain("$658.56"); // 598.56 + 60
  });

  it("imprime el cambio cuando lo hay", () => {
    expect(ticketVenta(datos).aTexto()).toContain("$41.44");
  });

  it("incluye el QR de autofactura si se pide", () => {
    const conQr = ticketVenta({ ...datos, url_autofactura: "https://f.motrest.mx/A-000123" });
    expect(conQr.aTexto()).toContain("Factura tu consumo");
    // El QR va como comando gráfico, no como texto.
    expect(conQr.aTexto()).not.toContain("https://");
    expect(conQr.construir().length).toBeGreaterThan(conQr.aTexto().length);
  });
});

// --- Sello del corte ------------------------------------------------------------------

describe("sello del corte de caja", () => {
  const cifras: CifrasCorte = {
    sesion_id: "ses-1",
    cajero_id: "emp-lucia",
    abierta_ts: T0 - 8 * 3_600_000,
    cerrada_ts: T0,
    fondo_inicial: pesos(1500),
    total_vendido: pesos(24_350),
    efectivo_esperado: pesos(9_800),
    declarado: pesos(9_800),
    diferencia: pesos(0),
    propinas: pesos(1_240),
    cuentas_cerradas: 47,
  };

  it("es estable: las mismas cifras dan el mismo sello", async () => {
    expect(await sellarCorte(cifras)).toBe(await sellarCorte(cifras));
  });

  it("se puede cotejar a ojo entre el papel y la pantalla", async () => {
    const sello = await sellarCorte(cifras);
    expect(sello).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });

  it("cambiar UN PESO del corte cambia el sello", async () => {
    const alterado = { ...cifras, declarado: pesos(9_700) };
    expect(await sellarCorte(alterado)).not.toBe(await sellarCorte(cifras));
  });

  it("detecta que las cifras se alteraron después del cierre", async () => {
    const sello = await sellarCorte(cifras);
    expect(await verificarSello(cifras, sello)).toBe(true);

    // Alguien "corrige" el faltante en el registro, después de firmar el papel.
    const manipulado = { ...cifras, diferencia: pesos(-500) };
    expect(await verificarSello(manipulado, sello)).toBe(false);
  });

  it("un sello con otra forma no se acepta", async () => {
    expect(await verificarSello(cifras, "no-es-un-sello")).toBe(false);
  });

  it("el comprobante impreso lleva el sello", async () => {
    const sello = await sellarCorte(cifras);
    const texto = corteCaja({
      folio: "C-0007",
      local: "Rodizio",
      cajero: "Lucía",
      abierta_ts: cifras.abierta_ts,
      cerrada_ts: cifras.cerrada_ts,
      fondo_inicial: cifras.fondo_inicial,
      ventas: [
        { forma: "Efectivo", monto: pesos(8_300) },
        { forma: "Tarjeta", monto: pesos(16_050) },
      ],
      total_vendido: cifras.total_vendido,
      efectivo_ventas: pesos(8_300),
      movimientos: pesos(0) as Centavos,
      efectivo_esperado: cifras.efectivo_esperado,
      declarado: cifras.declarado,
      diferencia: cifras.diferencia,
      propinas: cifras.propinas,
      cuentas_cerradas: cifras.cuentas_cerradas,
      sello,
    }).aTexto();

    expect(texto).toContain("CORTE DE CAJA");
    expect(texto).toContain(sello);
    expect(texto).toContain("Cuadra");
    expect(texto).toContain("Firma:");
  });

  it("nombra la diferencia como faltante o sobrante, no como un número suelto", () => {
    const base = {
      folio: "C-1", local: "Rodizio", cajero: "Lucía",
      abierta_ts: T0, cerrada_ts: T0, fondo_inicial: pesos(0) as Centavos,
      ventas: [], total_vendido: pesos(0) as Centavos, efectivo_ventas: pesos(0) as Centavos,
      movimientos: pesos(0) as Centavos, efectivo_esperado: pesos(1000),
      propinas: pesos(0) as Centavos, cuentas_cerradas: 0, sello: "AAAA-BBBB-CCCC-DDDD",
    };

    expect(corteCaja({ ...base, declarado: pesos(900), diferencia: pesos(-100) }).aTexto())
      .toContain("Faltante");
    expect(corteCaja({ ...base, declarado: pesos(1100), diferencia: pesos(100) }).aTexto())
      .toContain("Sobrante");
  });
});

// --- Ruteo y cola -----------------------------------------------------------------------

const impresora = (id: string, areas: string[]): Impresora => ({
  id,
  nombre: id,
  conexion: "red",
  host: "192.168.1.60",
  puerto: 9100,
  ancho: 42,
  areas,
  corta: true,
  cajon: false,
  activa: true,
});

describe("ruteo por área", () => {
  const impresoras = [
    impresora("imp-caja", ["caja"]),
    impresora("imp-cocina", ["est-horno", "est-pastas"]),
    { ...impresora("imp-barra", ["est-barra"]), activa: false },
  ];

  it("manda cada área a su impresora", () => {
    expect(impresoraPara(impresoras, "est-horno")?.id).toBe("imp-cocina");
    expect(impresoraPara(impresoras, "caja")?.id).toBe("imp-caja");
  });

  /*
   * REGRESIÓN DE RODIZIO (ago-2026): la caja escupía las comandas de cocina.
   *
   * Estas dos pruebas afirmaban lo contrario —que un área huérfana «cae a caja,
   * mejor mal ubicada que no impresa»— y describían el defecto, no la regla. En
   * el restaurante eso significaba que apagar la impresora de cocina no dejaba
   * de imprimir comandas: las mandaba todas al rollo de la caja, y no había
   * forma de detenerlo salvo desactivar también la impresora de la caja, con lo
   * que se perdían los tickets. Una configuración que no se puede apagar no es
   * una configuración.
   */
  it("un área sin impresora asignada no se imprime en ningún lado", () => {
    expect(impresoraPara(impresoras, "est-postres")).toBeUndefined();
  });

  it("apagar la impresora de un área NO manda su papel a la caja", () => {
    expect(impresoraPara(impresoras, "est-barra")).toBeUndefined();
    // Y la caja sigue imprimiendo lo suyo, que es lo que no debía cambiar.
    expect(impresoraPara(impresoras, "caja")?.id).toBe("imp-caja");
  });

  it("sin ninguna impresora no revienta: devuelve nada", () => {
    expect(impresoraPara([], "caja")).toBeUndefined();
  });
});

describe("cola de impresión", () => {
  const trabajo = (id: string, impresoraId = "imp-caja") => ({
    id,
    impresora_id: impresoraId,
    documento: "ticket" as const,
    datos: new Uint8Array([1, 2, 3]),
    vista: "ticket de prueba",
  });

  it("encolar es inmediato: imprimir no bloquea la venta", () => {
    const cola = new ColaImpresion([new TransporteSimulado()]);
    const t = cola.encolar(trabajo("t1"));
    expect(t.estado).toBe("pendiente");
    expect(cola.pendientes).toHaveLength(1);
  });

  it("imprime en orden de llegada", async () => {
    const transporte = new TransporteSimulado();
    const cola = new ColaImpresion([transporte]);
    cola.encolar({ ...trabajo("t1"), datos: new Uint8Array([1]) });
    cola.encolar({ ...trabajo("t2"), datos: new Uint8Array([2]) });

    await cola.procesar([impresora("imp-caja", ["caja"])]);

    expect(transporte.impresos.map((i) => i.datos[0])).toEqual([1, 2]);
    expect(cola.pendientes).toHaveLength(0);
  });

  it("un fallo NO pierde el trabajo: se reintenta", async () => {
    let intentos = 0;
    const inestable: Transporte = {
      puede: () => true,
      async enviar(): Promise<ResultadoEnvio> {
        intentos += 1;
        return { ok: false, error: "Sin papel" };
      },
    };

    const cola = new ColaImpresion([inestable]);
    cola.encolar(trabajo("t1"));
    await cola.procesar([impresora("imp-caja", ["caja"])]);

    expect(intentos).toBe(1);
    // Sigue pendiente, con el error a la vista.
    expect(cola.pendientes).toHaveLength(1);
    expect(cola.pendientes[0]!.ultimo_error).toBe("Sin papel");
  });

  it("tras agotar los intentos queda fallido y visible, no desaparece", async () => {
    const roto: Transporte = {
      puede: () => true,
      async enviar(): Promise<ResultadoEnvio> {
        return { ok: false, error: "Impresora apagada" };
      },
    };

    const cola = new ColaImpresion([roto]);
    cola.encolar(trabajo("t1"));
    for (let i = 0; i < MAX_INTENTOS_IMPRESION; i += 1) {
      await cola.procesar([impresora("imp-caja", ["caja"])]);
    }

    expect(cola.fallidos).toHaveLength(1);
    expect(cola.pendientes).toHaveLength(0);
  });

  it("un trabajo fallido se puede reintentar tras arreglar la impresora", async () => {
    const transporte = new TransporteSimulado();
    const cola = new ColaImpresion([transporte]);
    cola.encolar(trabajo("t1", "imp-fantasma"));
    await cola.procesar([]);
    expect(cola.fallidos).toHaveLength(1);

    cola.reintentar("t1");
    await cola.procesar([impresora("imp-fantasma", ["caja"])]);
    expect(cola.fallidos).toHaveLength(0);
    expect(transporte.impresos).toHaveLength(1);
  });

  it("la espera entre reintentos crece, pero tiene techo", () => {
    expect(esperaReintento(0)).toBe(2_000);
    expect(esperaReintento(1)).toBe(4_000);
    expect(esperaReintento(10)).toBe(60_000);
  });

  /*
   * El transporte simulado no imprime nada: es el de la demostración y el de
   * las terminales que no son la caja. Que un trabajo suyo se marcara como
   * «impreso» a secas es el fallo más caro de este módulo —la comanda no sale,
   * la cocina no la prepara y la pantalla dice que todo fue bien—, así que el
   * resultado viaja etiquetado hasta la interfaz.
   */
  it("un trabajo simulado queda marcado como tal, no como papel impreso", async () => {
    const cola = new ColaImpresion([new TransporteSimulado()]);
    cola.encolar(trabajo("t1"));
    await cola.procesar([impresora("imp-caja", ["caja"])]);

    const t = cola.todos[0]!;
    expect(t.estado).toBe("impreso");
    expect(t.simulado).toBe(true);
  });

  it("lo que sí llegó a una impresora NO se marca como simulado", async () => {
    const real: Transporte = {
      puede: () => true,
      async enviar(): Promise<ResultadoEnvio> {
        return { ok: true };
      },
    };

    const cola = new ColaImpresion([real]);
    cola.encolar(trabajo("t1"));
    await cola.procesar([impresora("imp-caja", ["caja"])]);

    const t = cola.todos[0]!;
    expect(t.estado).toBe("impreso");
    expect(t.simulado).toBe(false);
  });

  it("limpiar conserva lo pendiente y lo fallido", async () => {
    const cola = new ColaImpresion([new TransporteSimulado()]);
    cola.encolar(trabajo("t1"));
    await cola.procesar([impresora("imp-caja", ["caja"])]);
    cola.encolar(trabajo("t2"));

    cola.limpiarImpresos();
    expect(cola.todos).toHaveLength(1);
    expect(cola.todos[0]!.id).toBe("t2");
  });
});

// --- Representación impresa del CFDI ------------------------------------------------

import { representacionImpresa, type Comprobante, type TimbreFiscal } from "@motrest/dominio";
import { representacionCfdi } from "../plantillas.js";

function comprobanteFiscal(): Comprobante {
  return {
    version: "4.0", serie: "A", folio: "1001", fecha: "2026-07-23T21:15:00",
    forma_pago: "01", metodo_pago: "PUE", lugar_expedicion: "06000", moneda: "MXN",
    tipo_comprobante: "I", exportacion: "01",
    subtotal: pesos(500), descuento: pesos(0) as never, total: pesos(580),
    no_certificado: "30001000000500003416",
    emisor: { rfc: "AAA010101AAA", nombre: "RODIZIO SA DE CV", regimen_fiscal: "601", codigo_postal: "06000" },
    receptor: { rfc: "XEXX010101000", nombre: "PUBLICO EN GENERAL", regimen_fiscal: "616", codigo_postal: "06000", uso_cfdi: "S01" },
    conceptos: [{
      clave_prod_serv: "90101501", cantidad: 1, clave_unidad: "E48", descripcion: "Pizza familiar",
      valor_unitario: pesos(500), importe: pesos(500), descuento: pesos(0) as never, objeto_imp: "02",
      traslados: [{ base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) }],
    }],
    traslados: [{ base: pesos(500), impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: pesos(80) }],
    total_impuestos_trasladados: pesos(80), orden_id: "ord-1",
  } as Comprobante;
}

const timbreFiscal: TimbreFiscal = {
  uuid: "A1B2C3D4-1111-2222-3333-444455556666",
  fecha_timbrado: "2026-07-23T21:20:00",
  sello_cfd: "SELLOCFDbase64muylargoparaenvolver0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ==",
  no_certificado_sat: "00001000000504465028",
  sello_sat: "SELLOSATbase64",
  rfc_pac: "SPR190613I52",
};

describe("representación impresa del CFDI", () => {
  it("imprime emisor, receptor, total y total con letra", () => {
    const texto = representacionCfdi(representacionImpresa(comprobanteFiscal(), timbreFiscal)).aTexto();
    expect(texto).toContain("RODIZIO SA DE CV");
    expect(texto).toContain("AAA010101AAA");
    expect(texto).toContain("PUBLICO EN GENERAL");
    expect(texto).toContain("QUINIENTOS OCHENTA PESOS 00/100 M.N.");
  });

  it("un comprobante timbrado lleva UUID, sellos y leyenda", () => {
    const texto = representacionCfdi(representacionImpresa(comprobanteFiscal(), timbreFiscal)).aTexto();
    expect(texto).toContain("A1B2C3D4-1111-2222-3333-444455556666");
    expect(texto).toContain("TIMBRE FISCAL DIGITAL");
    // La leyenda se envuelve en varias líneas; se normaliza el salto para cotejarla.
    expect(texto.replace(/\s+/g, " ")).toMatch(/representaci.n impresa de un CFDI/i);
  });

  /*
   * El QR es el corazón de esto: si la impresora no recibe el comando GS ( k con
   * la URL del SAT, el comensal no puede verificar la factura. Se comprueba en
   * los BYTES, porque aTexto() salta los comandos.
   */
  it("emite el comando QR con la URL de verificación del SAT", () => {
    const bytes = representacionCfdi(representacionImpresa(comprobanteFiscal(), timbreFiscal)).construir();
    const comoTexto = Array.from(bytes).map((b) => String.fromCharCode(b)).join("");
    expect(comoTexto).toContain("verificacfdi.facturaelectronica.sat.gob.mx");
    expect(comoTexto).toContain("id=A1B2C3D4-1111-2222-3333-444455556666");
  });

  it("un comprobante sin timbrar sale como BORRADOR y sin QR", () => {
    const ticket = representacionCfdi(representacionImpresa(comprobanteFiscal()));
    expect(ticket.aTexto()).toContain("BORRADOR");
    const comoTexto = Array.from(ticket.construir()).map((b) => String.fromCharCode(b)).join("");
    expect(comoTexto).not.toContain("verificacfdi");
  });

  it("envuelve el sello largo en vez de perderlo por el borde", () => {
    // El sello mide más de 42 columnas: tiene que aparecer partido en varias líneas.
    const lineas = representacionCfdi(representacionImpresa(comprobanteFiscal(), timbreFiscal), 42)
      .aTexto()
      .split("\n");
    expect(lineas.every((l) => l.length <= 42)).toBe(true);
  });
});
