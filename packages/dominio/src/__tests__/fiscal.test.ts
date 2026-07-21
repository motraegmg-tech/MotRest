import { describe, expect, it } from "vitest";
import { pesos, sumar } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { indexar, type CatalogoIndex, type Producto } from "../catalogo/productos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { FabricaEventos } from "../evento.js";
import { RECEPTOR_PUBLICO_GENERAL, RFC_PUBLICO_GENERAL } from "../fiscal/claves.js";
import {
  construirComprobante,
  fechaSat,
  formaPagoSat,
  importeSat,
  tasaSat,
  type DatosEmisor,
  type DatosReceptor,
} from "../fiscal/comprobante.js";
import {
  colaDeTimbrado,
  proyectarCfdis,
  requierenAtencion,
  type EventoFiscal,
} from "../fiscal/eventos.js";
import { codigoPostalValido, problemaRfc, rfcValido, tipoPersonaDe } from "../fiscal/rfc.js";
import { listoParaTimbrar, validarComprobante } from "../fiscal/validacion.js";
import { comprobanteAXml, escaparXml } from "../fiscal/xml.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };

const EMISOR: DatosEmisor = {
  rfc: "MOT210101AB1",
  nombre: "MOTRAE SA DE CV",
  regimen_fiscal: "601",
  codigo_postal: "44100",
  nombre_comercial: "Rodizio Centro",
};

const RECEPTOR: DatosReceptor = {
  rfc: "GODE561231GR8",
  nombre: "JUAN PEREZ LOPEZ",
  regimen_fiscal: "612",
  codigo_postal: "44650",
  uso_cfdi: "G03",
};

const productos: Producto[] = [
  { id: "p1", nombre: "Pizza familiar", categoria_id: "c1", costo: pesos(45), precio: pesos(249),
    impuesto_id: IVA_16.id, disponible: true, orden: 1, clave_prod_serv: "90101501" },
  { id: "p2", nombre: "Limonada", categoria_id: "c1", costo: pesos(8), precio: pesos(45),
    impuesto_id: IVA_16.id, disponible: true, orden: 2 },
];

const cat: CatalogoIndex = indexar({
  productos,
  categorias: [{ id: "c1", nombre: "Todo", orden: 1 }],
  impuestos: [IVA_16],
});

function renglon(productoId: string, precio: number, cantidad: number, nombre: string): RenglonComanda {
  return {
    id: uuidv7(), producto_id: productoId, descripcion: nombre, cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(10),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

/** Cuenta cerrada: pizza 249 + 2 limonadas de 45 = 339 antes de IVA. */
function cuentaCerrada(extra: EventoComanda[] = []) {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: Date.now() }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("p1", 249, 1, "Pizza familiar") }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("p2", 45, 2, "Limonada") }),
    ...extra,
    f.crear("pago_registrado", orden_id, { orden_id, monto: pesos(393.24), forma: "tarjeta_credito" }),
    f.crear("cuenta_cerrada", orden_id, { orden_id }),
  ];
  return { f, orden_id, estado: proyectarComanda(eventos) };
}

// --- RFC ---------------------------------------------------------------------------

describe("validación de RFC", () => {
  it("acepta RFC de persona moral (12) y física (13)", () => {
    expect(rfcValido("MOT210101AB1")).toBe(true);
    expect(rfcValido("GODE561231GR8")).toBe(true);
  });

  it("distingue el tipo de persona", () => {
    expect(tipoPersonaDe("MOT210101AB1")).toBe("moral");
    expect(tipoPersonaDe("GODE561231GR8")).toBe("fisica");
  });

  it("acepta el RFC genérico de público en general", () => {
    expect(rfcValido(RFC_PUBLICO_GENERAL)).toBe(true);
  });

  it("normaliza espacios, guiones y minúsculas", () => {
    expect(rfcValido("gode 561231-gr8")).toBe(true);
  });

  it("rechaza longitudes y formatos inválidos", () => {
    expect(rfcValido("ABC")).toBe(false);
    expect(rfcValido("1234561231GR8")).toBe(false);
    expect(problemaRfc("")).toBe("Escribe el RFC");
    expect(problemaRfc("ABC")).toContain("12 dígitos");
  });

  it("rechaza una fecha que no existe dentro del RFC", () => {
    expect(rfcValido("GODE561331GR8")).toBe(false); // mes 13
    expect(rfcValido("GODE560231GR8")).toBe(false); // 31 de febrero
  });

  it("valida el código postal", () => {
    expect(codigoPostalValido("44100")).toBe(true);
    expect(codigoPostalValido("441")).toBe(false);
    expect(codigoPostalValido("abcde")).toBe(false);
  });
});

// --- Construcción del comprobante --------------------------------------------------

describe("comprobante CFDI 4.0", () => {
  const { estado, orden_id } = cuentaCerrada();
  const cfdi = construirComprobante(estado, cat, {
    serie: "A", folio: "1001", emisor: EMISOR, receptor: RECEPTOR,
  });

  it("lleva los datos obligatorios de la versión 4.0", () => {
    expect(cfdi.version).toBe("4.0");
    expect(cfdi.tipo_comprobante).toBe("I");
    expect(cfdi.exportacion).toBe("01");
    expect(cfdi.moneda).toBe("MXN");
    expect(cfdi.metodo_pago).toBe("PUE");
    expect(cfdi.lugar_expedicion).toBe(EMISOR.codigo_postal);
    expect(cfdi.orden_id).toBe(orden_id);
  });

  it("toma la forma de pago de lo que realmente se cobró", () => {
    // Se pagó con tarjeta de crédito → clave 04.
    expect(cfdi.forma_pago).toBe("04");
  });

  it("genera un concepto por renglón, con su clave del SAT", () => {
    expect(cfdi.conceptos).toHaveLength(2);
    expect(cfdi.conceptos[0]!.clave_prod_serv).toBe("90101501");
    // El que no la declara toma la de consumo en restaurante.
    expect(cfdi.conceptos[1]!.clave_prod_serv).toBe("90101501");
    expect(cfdi.conceptos[1]!.cantidad).toBe(2);
  });

  it("cuadra subtotal, impuestos y total", () => {
    // 249 + 90 = 339 de base; IVA 54.24; total 393.24
    expect(cfdi.subtotal).toBe(pesos(339));
    expect(cfdi.total_impuestos_trasladados).toBe(pesos(54.24));
    expect(cfdi.total).toBe(pesos(393.24));
  });

  it("la suma de los conceptos es el subtotal", () => {
    expect(sumar(...cfdi.conceptos.map((c) => c.importe))).toBe(cfdi.subtotal);
  });

  it("agrupa los traslados por impuesto y tasa", () => {
    expect(cfdi.traslados).toHaveLength(1);
    expect(cfdi.traslados[0]!.impuesto).toBe("002");
    expect(cfdi.traslados[0]!.tasa_o_cuota).toBe(0.16);
    expect(cfdi.traslados[0]!.importe).toBe(pesos(54.24));
  });

  it("está listo para timbrar", () => {
    expect(validarComprobante(cfdi)).toHaveLength(0);
    expect(listoParaTimbrar(cfdi)).toBe(true);
  });
});

describe("comprobante con descuento", () => {
  it("prorratea el descuento entre conceptos sin perder centavos", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const eventos: EventoComanda[] = [
      f.crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: 1 }),
      f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("p1", 249, 1, "Pizza") }),
      f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("p2", 45, 2, "Limonada") }),
      f.crear("descuento_aplicado", orden_id, {
        orden_id, alcance: "cuenta", modo: "porcentaje", valor: 0.1, motivo: "Promo",
      }),
    ];
    const cfdi = construirComprobante(proyectarComanda(eventos), cat, {
      serie: "A", folio: "1002", emisor: EMISOR, receptor: RECEPTOR,
    });

    // El descuento del comprobante es la suma de los de sus conceptos.
    expect(sumar(...cfdi.conceptos.map((c) => c.descuento))).toBe(cfdi.descuento);
    expect(listoParaTimbrar(cfdi)).toBe(true);
  });
});

describe("público en general", () => {
  it("acepta el RFC genérico sin código postal, con uso S01", () => {
    const { estado } = cuentaCerrada();
    const cfdi = construirComprobante(estado, cat, {
      serie: "A", folio: "1003", emisor: EMISOR,
      receptor: { ...RECEPTOR_PUBLICO_GENERAL },
    });
    expect(validarComprobante(cfdi)).toHaveLength(0);
  });

  it("rechaza el genérico con un uso distinto de S01", () => {
    const { estado } = cuentaCerrada();
    const cfdi = construirComprobante(estado, cat, {
      serie: "A", folio: "1004", emisor: EMISOR,
      receptor: { ...RECEPTOR_PUBLICO_GENERAL, uso_cfdi: "G03" },
    });
    expect(validarComprobante(cfdi).some((p) => p.campo === "receptor.uso")).toBe(true);
  });
});

describe("validación previa al timbrado", () => {
  const { estado } = cuentaCerrada();

  it("señala el código postal faltante del cliente", () => {
    const cfdi = construirComprobante(estado, cat, {
      serie: "A", folio: "1", emisor: EMISOR,
      receptor: { ...RECEPTOR, codigo_postal: "" },
    });
    const problemas = validarComprobante(cfdi);
    expect(problemas.some((p) => p.campo === "receptor.cp")).toBe(true);
    expect(problemas[0]!.mensaje).toContain("CFDI 4.0");
  });

  it("señala el RFC del emisor inválido", () => {
    const cfdi = construirComprobante(estado, cat, {
      serie: "A", folio: "1", emisor: { ...EMISOR, rfc: "MAL" }, receptor: RECEPTOR,
    });
    expect(validarComprobante(cfdi).some((p) => p.campo === "emisor.rfc")).toBe(true);
  });

  it("señala un régimen fiscal inexistente", () => {
    const cfdi = construirComprobante(estado, cat, {
      serie: "A", folio: "1", emisor: EMISOR,
      receptor: { ...RECEPTOR, regimen_fiscal: "999" },
    });
    expect(validarComprobante(cfdi).some((p) => p.campo === "receptor.regimen")).toBe(true);
  });
});

// --- XML ------------------------------------------------------------------------------

describe("serialización a XML", () => {
  const { estado } = cuentaCerrada();
  const cfdi = construirComprobante(estado, cat, {
    serie: "A", folio: "1001", emisor: EMISOR, receptor: RECEPTOR,
    fecha: new Date(2026, 6, 21, 20, 41, 30),
  });
  const xml = comprobanteAXml(cfdi);

  it("declara los espacios de nombres del SAT", () => {
    expect(xml).toContain('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"');
    expect(xml).toContain('Version="4.0"');
  });

  it("incluye emisor y receptor con sus campos obligatorios", () => {
    expect(xml).toContain(`Rfc="${EMISOR.rfc}"`);
    expect(xml).toContain('RegimenFiscal="601"');
    expect(xml).toContain(`DomicilioFiscalReceptor="${RECEPTOR.codigo_postal}"`);
    expect(xml).toContain('RegimenFiscalReceptor="612"');
    expect(xml).toContain('UsoCFDI="G03"');
  });

  it("escribe los importes con dos decimales y las tasas con seis", () => {
    expect(xml).toContain('SubTotal="339.00"');
    expect(xml).toContain('Total="393.24"');
    expect(xml).toContain('TasaOCuota="0.160000"');
  });

  it("usa la fecha en el formato del SAT, sin zona horaria", () => {
    expect(xml).toContain('Fecha="2026-07-21T20:41:30"');
    expect(fechaSat(new Date(2026, 0, 5, 9, 3, 7))).toBe("2026-01-05T09:03:07");
  });

  it("NO lleva sello ni certificado: los agrega quien tiene el CSD", () => {
    expect(xml).not.toContain("Sello=");
    expect(xml).not.toContain("Certificado=");
    expect(xml).not.toContain("TimbreFiscalDigital");
  });

  it("cierra todas las etiquetas que abre", () => {
    expect(xml).toContain("<cfdi:Comprobante ");
    expect(xml).toContain("</cfdi:Comprobante>");
    const abiertos = (xml.match(/<cfdi:Concepto /g) ?? []).length;
    const cerrados =
      (xml.match(/<\/cfdi:Concepto>/g) ?? []).length + (xml.match(/\/>/g) ?? []).length;
    expect(abiertos).toBeGreaterThan(0);
    expect(cerrados).toBeGreaterThanOrEqual(abiertos);
  });

  it("escapa los caracteres especiales del XML", () => {
    expect(escaparXml('Café "especial" & <compañía>')).toBe(
      "Café &quot;especial&quot; &amp; &lt;compañía&gt;",
    );
  });

  it("formatea importes y tasas de forma estable", () => {
    expect(importeSat(pesos(1234.5))).toBe("1234.50");
    expect(tasaSat(0.16)).toBe("0.160000");
  });
});

describe("forma de pago del SAT", () => {
  it("traduce cada forma interna a su clave", () => {
    expect(formaPagoSat("efectivo")).toBe("01");
    expect(formaPagoSat("transferencia")).toBe("03");
    expect(formaPagoSat("tarjeta_credito")).toBe("04");
    expect(formaPagoSat("tarjeta_debito")).toBe("28");
    expect(formaPagoSat("vale")).toBe("29");
  });
});

// --- Cola de timbrado ---------------------------------------------------------------

describe("cola de timbrado offline", () => {
  const { estado } = cuentaCerrada();
  const cfdi = construirComprobante(estado, cat, {
    serie: "A", folio: "1", emisor: EMISOR, receptor: RECEPTOR,
  });

  function fabrica() {
    return new FabricaEventos<EventoFiscal>(CTX);
  }

  it("un comprobante generado entra a la cola", () => {
    const f = fabrica();
    const registros = proyectarCfdis([
      f.crear("cfdi_generado", "fiscal:suc-1", {
        cfdi_id: "c1", orden_id: cfdi.orden_id, serie: "A", folio: "1", comprobante: cfdi,
      }),
    ]);
    expect(registros).toHaveLength(1);
    expect(registros[0]!.estado).toBe("generado");
    expect(colaDeTimbrado(registros)).toHaveLength(1);
  });

  it("al timbrar sale de la cola y guarda el UUID fiscal", () => {
    const f = fabrica();
    const registros = proyectarCfdis([
      f.crear("cfdi_generado", "fiscal:suc-1", {
        cfdi_id: "c1", orden_id: cfdi.orden_id, serie: "A", folio: "1", comprobante: cfdi,
      }),
      f.crear("cfdi_timbrado", "fiscal:suc-1", {
        cfdi_id: "c1",
        uuid: "A1B2C3D4-0000-0000-0000-000000000001",
        fecha_timbrado: "2026-07-21T20:45:00",
        pac: "PAC de prueba",
      }),
    ]);
    expect(registros[0]!.estado).toBe("timbrado");
    expect(registros[0]!.uuid).toContain("A1B2C3D4");
    expect(colaDeTimbrado(registros)).toHaveLength(0);
  });

  it("un rechazo lo devuelve a la cola y cuenta el intento", () => {
    const f = fabrica();
    const registros = proyectarCfdis([
      f.crear("cfdi_generado", "fiscal:suc-1", {
        cfdi_id: "c1", orden_id: cfdi.orden_id, serie: "A", folio: "1", comprobante: cfdi,
      }),
      f.crear("cfdi_rechazado", "fiscal:suc-1", {
        cfdi_id: "c1", codigo: "CFDI40147", motivo: "RFC del receptor no registrado",
      }),
    ]);
    expect(registros[0]!.estado).toBe("rechazado");
    expect(registros[0]!.intentos).toBe(1);
    expect(registros[0]!.error).toContain("CFDI40147");
    expect(colaDeTimbrado(registros)).toHaveLength(1);
  });

  it("tras agotar los reintentos deja de reintentarse solo", () => {
    const f = fabrica();
    const eventos: EventoFiscal[] = [
      f.crear("cfdi_generado", "fiscal:suc-1", {
        cfdi_id: "c1", orden_id: cfdi.orden_id, serie: "A", folio: "1", comprobante: cfdi,
      }),
    ];
    for (let i = 0; i < 5; i++) {
      eventos.push(
        f.crear("cfdi_rechazado", "fiscal:suc-1", {
          cfdi_id: "c1", codigo: "E", motivo: "Sin conexión",
        }),
      );
    }
    const registros = proyectarCfdis(eventos);
    expect(colaDeTimbrado(registros)).toHaveLength(0);
    expect(requierenAtencion(registros)).toHaveLength(1);
  });

  it("no duplica un comprobante generado dos veces", () => {
    const f = fabrica();
    const alta = f.crear("cfdi_generado", "fiscal:suc-1", {
      cfdi_id: "c1", orden_id: cfdi.orden_id, serie: "A", folio: "1", comprobante: cfdi,
    });
    expect(proyectarCfdis([alta, alta])).toHaveLength(1);
  });
});
