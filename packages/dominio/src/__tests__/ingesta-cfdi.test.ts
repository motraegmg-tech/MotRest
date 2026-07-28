/**
 * Ingesta de la factura XML del proveedor.
 *
 * Lo que más importa probar es el FACTOR de conversión: el proveedor factura
 * «1 bolsa» de 5 kg y el almacén lleva gramos. Sin el factor entrarían 1 gramo
 * al inventario en vez de 5 000, y eso contamina el costeo, el centinela de
 * mermas y la lista de reposición a la vez.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import {
  leerFacturaProveedor,
  proponerRecepcion,
  yaIngerida,
  type EquivalenciaInsumo,
} from "../compras/ingesta-cfdi.js";
import { equivalenciasVigentes } from "../compras/reducers.js";
import type { EventoCompra } from "../compras/eventos.js";
import { FabricaEventos } from "../evento.js";

const RFC_RODIZIO = "ROD230101AB1";
const RFC_LACTEOS = "LAC900101XY2";

/** Un CFDI 4.0 de proveedor, como lo emite cualquier PAC. */
const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"
  Serie="A" Folio="4821" Fecha="2026-07-20T11:32:00" SubTotal="3400.00" Total="3944.00">
  <cfdi:Emisor Rfc="${RFC_LACTEOS}" Nombre="LACTEOS DEL NORTE SA DE CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${RFC_RODIZIO}" Nombre="RODIZIO SA DE CV" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto NoIdentificacion="MOZ-5K" Descripcion="QUESO MOZZARELLA BOLA 5KG"
      Cantidad="4" ClaveUnidad="XBG" ValorUnitario="600.00" Importe="2400.00"/>
    <cfdi:Concepto NoIdentificacion="HAR-25" Descripcion="HARINA TRIGO SACO 25KG"
      Cantidad="2" ClaveUnidad="XBG" ValorUnitario="500.00" Importe="1000.00"/>
  </cfdi:Conceptos>
  <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital11"
    UUID="A1B2C3D4-1111-2222-3333-444455556666" FechaTimbrado="2026-07-20T11:35:00"/>
</cfdi:Comprobante>`;

describe("leer la factura", () => {
  it("saca quién la emite, su folio y sus totales", () => {
    const r = leerFacturaProveedor(FACTURA);
    expect(r.ok).toBe(true);
    expect(r.factura).toMatchObject({
      emisor_rfc: RFC_LACTEOS,
      emisor_nombre: "LACTEOS DEL NORTE SA DE CV",
      serie: "A",
      folio: "4821",
      total: pesos(3944),
    });
  });

  it("lee los renglones con su cantidad e importe", () => {
    const { factura } = leerFacturaProveedor(FACTURA);
    expect(factura!.conceptos).toHaveLength(2);
    expect(factura!.conceptos[0]).toMatchObject({
      clave: "MOZ-5K",
      descripcion: "QUESO MOZZARELLA BOLA 5KG",
      cantidad: 4,
      importe: pesos(2400),
    });
  });

  /* El UUID es lo que permite no capturar dos veces la misma factura. */
  it("saca el UUID del timbre", () => {
    const { factura } = leerFacturaProveedor(FACTURA);
    expect(factura!.uuid).toBe("A1B2C3D4-1111-2222-3333-444455556666");
  });

  it("acepta un CFDI sin prefijo de espacio de nombres", () => {
    const sinPrefijo = FACTURA.replace(/cfdi:/g, "");
    expect(leerFacturaProveedor(sinPrefijo).ok).toBe(true);
  });
});

describe("lo que se rechaza", () => {
  it("un archivo que no es un CFDI", () => {
    const r = leerFacturaProveedor("<html><body>no soy una factura</body></html>");
    expect(r.ok).toBe(false);
    expect(r.problema).toBe("no_es_cfdi");
  });

  it("un CFDI sin renglones que capturar", () => {
    const vacio = FACTURA.replace(/<cfdi:Concepto\b[\s\S]*?\/>/g, "");
    expect(leerFacturaProveedor(vacio).problema).toBe("sin_conceptos");
  });

  /*
   * Ingerir la factura de otro contribuyente metería compras ajenas al
   * inventario y al gasto del restaurante.
   */
  it("una factura que no viene a nombre del restaurante", () => {
    const r = leerFacturaProveedor(FACTURA, "OTRO010101XXX");
    expect(r.ok).toBe(false);
    expect(r.problema).toBe("no_es_para_este_rfc");
    expect(r.detalle).toContain(RFC_RODIZIO);
  });

  it("pero sí acepta la que viene a su nombre", () => {
    expect(leerFacturaProveedor(FACTURA, RFC_RODIZIO).ok).toBe(true);
    // Y da igual cómo se escriba el RFC.
    expect(leerFacturaProveedor(FACTURA, "rod230101ab1").ok).toBe(true);
  });
});

// --- El factor de conversión ------------------------------------------------------------------

describe("proponer la recepción", () => {
  const EQUIVALENCIAS: EquivalenciaInsumo[] = [
    // Una BOLSA de 5 kg son 5 000 g en el almacén.
    { emisor_rfc: RFC_LACTEOS, clave_proveedor: "MOZ-5K", insumo_id: "ins-mozz", factor: 5000 },
  ];

  it("convierte a la unidad base del almacén", () => {
    const { factura } = leerFacturaProveedor(FACTURA);
    const [mozzarella] = proponerRecepcion(factura!, EQUIVALENCIAS);

    // 4 bolsas × 5 000 g = 20 000 g. NO 4.
    expect(mozzarella!.cantidad_base).toBe(20_000);
    expect(mozzarella!.requiere_mapeo).toBe(false);
  });

  it("calcula el costo por unidad BASE, que es el que usa el almacén", () => {
    const { factura } = leerFacturaProveedor(FACTURA);
    const [mozzarella] = proponerRecepcion(factura!, EQUIVALENCIAS);

    // $2 400 entre 20 000 g = $0.12 por gramo = 12 centavos.
    expect(mozzarella!.costo_unitario).toBe(12);
  });

  /*
   * Lo que no se ha enseñado NO se adivina. Un insumo mal identificado mete
   * cantidades equivocadas al inventario y contamina el costeo: es peor que no
   * capturar nada.
   */
  it("lo que no se ha enseñado se marca, no se adivina", () => {
    const { factura } = leerFacturaProveedor(FACTURA);
    const harina = proponerRecepcion(factura!, EQUIVALENCIAS)[1]!;

    expect(harina.requiere_mapeo).toBe(true);
    expect(harina.insumo_id).toBeUndefined();
    expect(harina.cantidad_base).toBeNull();
  });

  /* Dos proveedores pueden usar la misma clave para cosas distintas. */
  it("una equivalencia de otro proveedor no aplica", () => {
    const deOtro: EquivalenciaInsumo[] = [
      { ...EQUIVALENCIAS[0]!, emisor_rfc: "OTRO010101XXX" },
    ];
    const { factura } = leerFacturaProveedor(FACTURA);
    expect(proponerRecepcion(factura!, deOtro)[0]!.requiere_mapeo).toBe(true);
  });

  it("un factor inválido se trata como si no hubiera equivalencia", () => {
    const malo: EquivalenciaInsumo[] = [{ ...EQUIVALENCIAS[0]!, factor: 0 }];
    const { factura } = leerFacturaProveedor(FACTURA);
    expect(proponerRecepcion(factura!, malo)[0]!.requiere_mapeo).toBe(true);
  });
});

describe("no capturar dos veces", () => {
  it("reconoce una factura ya ingerida por su UUID", () => {
    const uuid = "A1B2C3D4-1111-2222-3333-444455556666";
    expect(yaIngerida(uuid, [uuid])).toBe(true);
    expect(yaIngerida(uuid.toLowerCase(), [uuid])).toBe(true);
    expect(yaIngerida(uuid, ["OTRO-UUID"])).toBe(false);
  });

  it("una factura sin timbre no se puede dar por repetida", () => {
    // Sin UUID no hay identidad fiscal: bloquearla escondería una compra real.
    expect(yaIngerida(undefined, ["cualquiera"])).toBe(false);
  });
});

// --- Aprender la equivalencia ----------------------------------------------------------------

describe("la segunda factura entra sola", () => {
  it("lo enseñado se recuerda y aplica a la siguiente factura", () => {
    const f = new FabricaEventos<EventoCompra>({
      device_id: "d1", empleado_id: "e1", sucursal_id: "s1",
    });
    const aprendidas = equivalenciasVigentes([
      f.crear("equivalencia_aprendida", "compras:s1", {
        emisor_rfc: RFC_LACTEOS, clave_proveedor: "MOZ-5K",
        insumo_id: "ins-mozz", factor: 5000,
      }),
    ]);

    const { factura } = leerFacturaProveedor(FACTURA);
    const [mozzarella] = proponerRecepcion(factura!, aprendidas);
    expect(mozzarella!.requiere_mapeo).toBe(false);
    expect(mozzarella!.cantidad_base).toBe(20_000);
  });

  /* Si el proveedor cambia de bolsa de 5 kg a una de 10, se reenseña. */
  it("reaprender corrige la equivalencia anterior", () => {
    const f = new FabricaEventos<EventoCompra>({
      device_id: "d1", empleado_id: "e1", sucursal_id: "s1",
    });
    const base = { emisor_rfc: RFC_LACTEOS, clave_proveedor: "MOZ-5K", insumo_id: "ins-mozz" };
    const aprendidas = equivalenciasVigentes([
      f.crear("equivalencia_aprendida", "compras:s1", { ...base, factor: 5000 }),
      f.crear("equivalencia_aprendida", "compras:s1", { ...base, factor: 10_000 }),
    ]);

    expect(aprendidas).toHaveLength(1);
    expect(aprendidas[0]!.factor).toBe(10_000);
  });
});
