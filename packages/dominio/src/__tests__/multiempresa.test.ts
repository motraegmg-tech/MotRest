/**
 * Varias razones sociales y franquicias.
 *
 * Lo que se prueba aquí tiene consecuencias fuera del software: un consolidado
 * de tres RFC presentado como si fuera uno produce una declaración mal armada,
 * y eso se paga con multas. Y una regalía calculada sobre el IVA rompe
 * contratos de franquicia.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import {
  calcularRegalia,
  consolidarPorEmpresa,
  localesSinEmpresa,
  puedeEditarProducto,
  type AsignacionLocal,
  type Empresa,
  type Franquicia,
  type VentaDeLocal,
} from "../organizacion/multiempresa.js";

const EMPRESAS: Empresa[] = [
  { id: "e-centro", razon_social: "Rodizio Centro SA de CV", rfc: "RCE010101AA1", nombre_corto: "Rodizio Centro", regimen_fiscal: "601", activa: true },
  { id: "e-norte", razon_social: "Operadora Norte SA de CV", rfc: "ONO020202BB2", nombre_corto: "Operadora Norte", regimen_fiscal: "601", activa: true },
  { id: "e-cerrada", razon_social: "Vieja SA", rfc: "VIE030303CC3", nombre_corto: "Vieja", regimen_fiscal: "601", activa: false },
];

const ASIGNACIONES: AsignacionLocal[] = [
  { sucursal_id: "suc-centro", empresa_id: "e-centro" },
  { sucursal_id: "suc-zapopan", empresa_id: "e-centro" },
  { sucursal_id: "suc-norte", empresa_id: "e-norte" },
];

function venta(sucursal: string, monto: number): VentaDeLocal {
  return { sucursal_id: sucursal, ventas: pesos(monto), impuestos: pesos(monto * 0.16) };
}

// --- Multiempresa ----------------------------------------------------------------------------

describe("juntar las ventas de varias razones sociales", () => {
  it("agrupa cada local bajo su RFC", () => {
    const c = consolidarPorEmpresa(EMPRESAS, ASIGNACIONES, [
      venta("suc-centro", 100_000),
      venta("suc-zapopan", 60_000),
      venta("suc-norte", 40_000),
    ]);

    expect(c.renglones).toHaveLength(2);
    const centro = c.renglones.find((r) => r.rfc === "RCE010101AA1")!;
    expect(centro.ventas).toBe(pesos(160_000));
    expect(centro.locales).toHaveLength(2);
  });

  /*
   * EL CANDADO QUE JUSTIFICA EL ARCHIVO. Un dueño que ve "$200 000 del mes" y se
   * lo pasa a su contador sin decir que son dos empresas provoca una declaración
   * mal armada. La advertencia no es relleno legal: es lo que evita eso.
   */
  it("con varios RFC, el total sale ADVERTIDO de que no es fiscal", () => {
    const c = consolidarPorEmpresa(EMPRESAS, ASIGNACIONES, [
      venta("suc-centro", 100_000),
      venta("suc-norte", 40_000),
    ]);

    expect(c.varias_empresas).toBe(true);
    expect(c.ventas).toBe(pesos(140_000));
    expect(c.advertencia).toContain("NO para declarar");
    expect(c.advertencia).toContain("2 razones sociales");
  });

  it("con una sola empresa no estorba con advertencias", () => {
    const c = consolidarPorEmpresa(EMPRESAS, ASIGNACIONES, [venta("suc-centro", 100_000)]);
    expect(c.varias_empresas).toBe(false);
    expect(c.advertencia).toBeUndefined();
  });

  /*
   * Un local sin razón social asignada se IGNORA. Meterlo en cualquier RFC —o en
   * un cajón de "otros" que después alguien suma— es justo el error que esta
   * pantalla existe para evitar.
   */
  it("un local sin empresa asignada no se cuela en ningún RFC", () => {
    const c = consolidarPorEmpresa(EMPRESAS, ASIGNACIONES, [
      venta("suc-centro", 100_000),
      venta("suc-huerfano", 50_000),
    ]);

    expect(c.ventas).toBe(pesos(100_000));
    expect(localesSinEmpresa(["suc-centro", "suc-huerfano"], ASIGNACIONES)).toEqual(["suc-huerfano"]);
  });

  it("las empresas dadas de baja no aparecen", () => {
    const c = consolidarPorEmpresa(
      EMPRESAS,
      [...ASIGNACIONES, { sucursal_id: "suc-vieja", empresa_id: "e-cerrada" }],
      [venta("suc-centro", 10_000), venta("suc-vieja", 99_000)],
    );
    expect(c.renglones.every((r) => r.rfc !== "VIE030303CC3")).toBe(true);
  });

  it("una empresa sin ventas no ocupa un renglón vacío", () => {
    const c = consolidarPorEmpresa(EMPRESAS, ASIGNACIONES, [venta("suc-norte", 40_000)]);
    expect(c.renglones).toHaveLength(1);
  });
});

// --- Franquicias ------------------------------------------------------------------------------

describe("lo que debe un franquiciatario", () => {
  const base: Franquicia = {
    sucursal_id: "suc-franquicia",
    relacion: "franquiciado",
    regalia: 0.05,
    fondo_publicidad: 0.01,
    desde_ts: 0,
  };

  it("saca el porcentaje sobre la venta del periodo", () => {
    const c = calcularRegalia(base, pesos(500_000));
    expect(c.regalia).toBe(pesos(25_000));
    expect(c.publicidad).toBe(pesos(5_000));
    expect(c.total).toBe(pesos(30_000));
    expect(c.por_minimo).toBe(false);
  });

  /*
   * LA BASE ES LA VENTA SIN IVA, y no es un detalle. El IVA no es del
   * restaurante: es del SAT pasando por su caja. Cobrar regalías sobre él sería
   * cobrarle un porcentaje de un dinero que nunca fue suyo, y es la discusión
   * que rompe contratos de franquicia.
   */
  it("la base es SIN IVA: quien pasa la venta con IVA cobra de más", () => {
    const sinIva = calcularRegalia(base, pesos(500_000)).regalia;
    const conIva = calcularRegalia(base, pesos(580_000)).regalia;
    expect(conIva).toBeGreaterThan(sinIva);
    // La diferencia es exactamente el 5 % del IVA: $4 000 de más al mes.
    expect(conIva - sinIva).toBe(pesos(4_000));
  });

  /*
   * El mínimo existe para que el franquiciante no dependa de que el local venda.
   * Se cobra el MAYOR de los dos, nunca la suma: cobrar ambos sería cobrar dos
   * veces por lo mismo.
   */
  it("con un mes flojo se cobra el mínimo, no el porcentaje", () => {
    const c = calcularRegalia({ ...base, minimo_mensual: pesos(15_000) }, pesos(100_000));
    expect(c.regalia).toBe(pesos(15_000));
    expect(c.por_minimo).toBe(true);
  });

  it("con un mes bueno manda el porcentaje, y el mínimo no suma", () => {
    const c = calcularRegalia({ ...base, minimo_mensual: pesos(15_000) }, pesos(500_000));
    expect(c.regalia).toBe(pesos(25_000));
    expect(c.por_minimo).toBe(false);
  });

  it("un local propio no paga nada", () => {
    const c = calcularRegalia({ ...base, relacion: "propio" }, pesos(500_000));
    expect(c.total).toBe(CERO);
  });

  it("sin fondo de publicidad, solo la regalía", () => {
    const c = calcularRegalia({ ...base, fondo_publicidad: undefined }, pesos(500_000));
    expect(c.publicidad).toBe(CERO);
    expect(c.total).toBe(pesos(25_000));
  });
});

// --- El catálogo estándar ----------------------------------------------------------------------

describe("qué puede tocar un franquiciatario de la carta", () => {
  const estandar = { producto_id: "p-1", bloqueado: true, precio_fijo: true };

  it("lo del estándar no se renombra ni se le cambia la receta", () => {
    expect(puedeEditarProducto(estandar, "nombre").puede).toBe(false);
    expect(puedeEditarProducto(estandar, "receta").puede).toBe(false);
    expect(puedeEditarProducto(estandar, "precio").puede).toBe(false);
  });

  /* Muchas franquicias dejan el precio libre por plaza: no cuesta lo mismo en cada ciudad. */
  it("con precio libre, el local sí lo ajusta", () => {
    const v = puedeEditarProducto({ ...estandar, precio_fijo: false }, "precio");
    expect(v.puede).toBe(true);
  });

  /*
   * LA DISPONIBILIDAD SIEMPRE ES DEL LOCAL, incluso en lo estándar. Si se
   * quedaron sin producto tienen que poder agotarlo — obligarles a seguir
   * vendiéndolo produce comandas que la cocina no puede sacar.
   */
  it("agotar un producto se puede siempre, aunque sea estándar", () => {
    expect(puedeEditarProducto(estandar, "disponibilidad").puede).toBe(true);
  });

  it("lo que no es del estándar es del local", () => {
    expect(puedeEditarProducto(undefined, "nombre").puede).toBe(true);
    expect(puedeEditarProducto({ producto_id: "p-2", bloqueado: false }, "precio").puede).toBe(true);
  });
});
