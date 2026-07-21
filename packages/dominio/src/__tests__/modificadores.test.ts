import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { IVA_16 } from "../comun/impuestos.js";
import {
  costoModificadores,
  precioModificadores,
  requiereConfiguracion,
  seleccionPorDefecto,
  unidadesDe,
  validarSeleccion,
  type GrupoModificadores,
  type SeleccionModificador,
} from "../catalogo/modificadores.js";
import { indexar, type CatalogoIndex, type Producto } from "../catalogo/productos.js";
import { construirRenglon, validarConfiguracion } from "../costeo/configuracion.js";

// --- Catálogo de prueba ------------------------------------------------------------

const termino: GrupoModificadores = {
  id: "g-termino", nombre: "Término", seleccion: "uno",
  min: 1, max: 1, incluidas_gratis: 0, ambito: "renglon", orden: 1,
  opciones: [
    { id: "o-medio", nombre: "Medio", precio_delta: CERO, costo_delta: CERO,
      max_repeticiones: 1, disponible: true, por_defecto: true, orden: 1 },
    { id: "o-cocido", nombre: "Bien cocido", precio_delta: CERO, costo_delta: CERO,
      max_repeticiones: 1, disponible: true, por_defecto: false, orden: 2 },
  ],
};

const extras: GrupoModificadores = {
  id: "g-extras", nombre: "Extras", seleccion: "varios",
  min: 0, max: 3, incluidas_gratis: 0, ambito: "renglon", orden: 2,
  opciones: [
    { id: "o-queso", nombre: "Extra queso", precio_delta: pesos(25), costo_delta: pesos(9),
      max_repeticiones: 2, disponible: true, por_defecto: false, orden: 1 },
    { id: "o-tocino", nombre: "Tocino", precio_delta: pesos(30), costo_delta: pesos(11),
      max_repeticiones: 1, disponible: true, por_defecto: false, orden: 2 },
    { id: "o-agotado", nombre: "Trufa", precio_delta: pesos(90), costo_delta: pesos(60),
      max_repeticiones: 1, disponible: false, por_defecto: false, orden: 3 },
  ],
};

const aderezos: GrupoModificadores = {
  id: "g-aderezo", nombre: "Aderezos", seleccion: "varios",
  min: 0, max: 4, incluidas_gratis: 2, ambito: "renglon", orden: 3,
  opciones: ["cesar", "ranch", "balsamico", "miel"].map((n, i) => ({
    id: `o-${n}`, nombre: n, precio_delta: pesos(12), costo_delta: pesos(4),
    max_repeticiones: 1, disponible: true, por_defecto: false, orden: i + 1,
  })),
};

const productos: Producto[] = [
  { id: "p-carne", nombre: "Rib eye", categoria_id: "c1", costo: pesos(180), precio: pesos(429),
    impuesto_id: IVA_16.id, disponible: true, orden: 1,
    grupos_modificadores: ["g-termino", "g-extras"] },
  { id: "p-ensalada", nombre: "Ensalada", categoria_id: "c1", costo: pesos(38), precio: pesos(129),
    impuesto_id: IVA_16.id, disponible: true, orden: 2, grupos_modificadores: ["g-aderezo"] },
  { id: "p-cafe", nombre: "Café", categoria_id: "c1", costo: pesos(7), precio: pesos(42),
    impuesto_id: IVA_16.id, disponible: true, orden: 3 },
];

const cat: CatalogoIndex = indexar({
  productos,
  categorias: [{ id: "c1", nombre: "Todo", orden: 1 }],
  impuestos: [IVA_16],
  grupos: [termino, extras, aderezos],
});

function sel(
  grupo: GrupoModificadores,
  opcionId: string,
  cantidad = 1,
): SeleccionModificador {
  const o = grupo.opciones.find((x) => x.id === opcionId)!;
  return {
    grupo_id: grupo.id, grupo_nombre: grupo.nombre,
    opcion_id: o.id, opcion_nombre: o.nombre,
    precio_delta: o.precio_delta, costo_delta: o.costo_delta,
    cantidad,
  };
}

// --- Validación -----------------------------------------------------------------------

describe("validación de modificadores", () => {
  it("un grupo obligatorio sin elegir se reporta", () => {
    const problemas = validarSeleccion([termino], []);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]!.tipo).toBe("min_no_cumplido");
  });

  it("cumplir el mínimo deja la selección válida", () => {
    expect(validarSeleccion([termino], [sel(termino, "o-medio")])).toHaveLength(0);
  });

  it("excederse del máximo se reporta", () => {
    const problemas = validarSeleccion(
      [extras],
      [sel(extras, "o-queso", 2), sel(extras, "o-tocino", 2)],
    );
    expect(problemas.some((p) => p.tipo === "max_excedido")).toBe(true);
  });

  it("una opción agotada se reporta", () => {
    const problemas = validarSeleccion([extras], [sel(extras, "o-agotado")]);
    expect(problemas.some((p) => p.tipo === "opcion_no_disponible")).toBe(true);
  });

  it("repetir más de lo permitido se reporta", () => {
    const problemas = validarSeleccion([extras], [sel(extras, "o-tocino", 3)]);
    expect(problemas.some((p) => p.tipo === "repeticiones_excedidas")).toBe(true);
  });

  it("cuenta las unidades contando repeticiones", () => {
    expect(unidadesDe([sel(extras, "o-queso", 2), sel(extras, "o-tocino")], "g-extras")).toBe(3);
  });
});

describe("selección por defecto", () => {
  it("toma las opciones marcadas por defecto", () => {
    const inicial = seleccionPorDefecto([termino, extras]);
    expect(inicial).toHaveLength(1);
    expect(inicial[0]!.opcion_id).toBe("o-medio");
  });

  it("la selección por defecto ya es válida", () => {
    expect(validarSeleccion([termino], seleccionPorDefecto([termino]))).toHaveLength(0);
  });
});

describe("qué productos obligan a configurar", () => {
  it("un producto con grupo obligatorio sí", () => {
    expect(requiereConfiguracion([termino], false)).toBe(true);
  });

  it("un producto con porciones sí", () => {
    expect(requiereConfiguracion([], true)).toBe(true);
  });

  it("un producto simple no", () => {
    expect(requiereConfiguracion([extras], false)).toBe(false);
  });
});

// --- Precio y costo -----------------------------------------------------------------------

describe("precio de los modificadores", () => {
  it("suma los deltas de precio", () => {
    const precio = precioModificadores([extras], [sel(extras, "o-queso"), sel(extras, "o-tocino")]);
    expect(precio).toBe(pesos(55));
  });

  it("multiplica por las repeticiones", () => {
    expect(precioModificadores([extras], [sel(extras, "o-queso", 2)])).toBe(pesos(50));
  });

  it("respeta las opciones incluidas sin costo", () => {
    // Dos aderezos incluidos: los dos primeros no se cobran.
    const dos = [sel(aderezos, "o-cesar"), sel(aderezos, "o-ranch")];
    expect(precioModificadores([aderezos], dos)).toBe(CERO);

    // El tercero ya se cobra.
    const tres = [...dos, sel(aderezos, "o-balsamico")];
    expect(precioModificadores([aderezos], tres)).toBe(pesos(12));

    const cuatro = [...tres, sel(aderezos, "o-miel")];
    expect(precioModificadores([aderezos], cuatro)).toBe(pesos(24));
  });

  it("los términos sin cargo no suman", () => {
    expect(precioModificadores([termino], [sel(termino, "o-cocido")])).toBe(CERO);
  });
});

describe("costo de los modificadores", () => {
  it("el costo SÍ cuenta aunque el precio esté incluido", () => {
    // Dos aderezos gratis para el comensal, pero al restaurante le cuestan.
    const dos = [sel(aderezos, "o-cesar"), sel(aderezos, "o-ranch")];
    expect(precioModificadores([aderezos], dos)).toBe(CERO);
    expect(costoModificadores(dos)).toBe(pesos(8));
  });

  it("multiplica el costo por las repeticiones", () => {
    expect(costoModificadores([sel(extras, "o-queso", 2)])).toBe(pesos(18));
  });
});

// --- Renglón completo ----------------------------------------------------------------------

describe("construir el renglón desde la configuración", () => {
  it("un producto simple no necesita nada", () => {
    const r = construirRenglon({ producto_id: "p-cafe", cantidad: 2 }, cat, IVA_16);
    expect(r.precio_unitario).toBe(pesos(42));
    expect(r.costo_unitario).toBe(pesos(7));
    expect(r.cantidad).toBe(2);
    expect(r.estado).toBe("capturado");
    expect(r.detalle).toBeUndefined();
  });

  it("suma los modificadores al precio y al costo", () => {
    const r = construirRenglon(
      {
        producto_id: "p-carne",
        cantidad: 1,
        modificadores: [sel(termino, "o-cocido"), sel(extras, "o-queso"), sel(extras, "o-tocino")],
      },
      cat,
      IVA_16,
    );
    expect(r.precio_unitario).toBe(pesos(429 + 25 + 30));
    expect(r.costo_unitario).toBe(pesos(180 + 9 + 11));
  });

  it("arma un detalle legible con la configuración y las notas", () => {
    const r = construirRenglon(
      {
        producto_id: "p-carne",
        cantidad: 1,
        modificadores: [sel(termino, "o-cocido"), sel(extras, "o-queso", 2)],
        notas: "Sin sal",
      },
      cat,
      IVA_16,
    );
    expect(r.detalle).toBe("Bien cocido · 2× Extra queso · Sin sal");
  });

  it("congela el snapshot de impuesto", () => {
    const r = construirRenglon({ producto_id: "p-cafe", cantidad: 1 }, cat, IVA_16);
    expect(r.impuesto.tasa_iva).toBe(0.16);
  });

  it("valida la configuración contra los grupos del producto", () => {
    const sinTermino = validarConfiguracion({ producto_id: "p-carne", cantidad: 1 }, cat);
    expect(sinTermino.some((p) => p.tipo === "min_no_cumplido")).toBe(true);

    const conTermino = validarConfiguracion(
      { producto_id: "p-carne", cantidad: 1, modificadores: [sel(termino, "o-medio")] },
      cat,
    );
    expect(conTermino).toHaveLength(0);
  });
});
