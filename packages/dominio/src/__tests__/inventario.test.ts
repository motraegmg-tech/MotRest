import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { indexar, type CatalogoIndex, type Producto } from "../catalogo/productos.js";
import { costoDesdeInsumo, costoReceta, type Receta } from "../catalogo/recetas.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { FabricaEventos } from "../evento.js";
import {
  MOTIVOS_MANUALES,
  deltaDelMotivo,
  type EventoInventario,
  type MotivoMovimiento,
} from "../inventario/eventos.js";
import { insumosDeRenglon, insumosDeRenglones } from "../inventario/explosion.js";
import { convertir, formatearCantidad, type Insumo } from "../inventario/insumos.js";
import {
  consumoPorMotivo,
  costoMerma,
  enNegativo,
  existenciaDe,
  porReponer,
  proyectarExistencias,
  valorInventario,
} from "../inventario/reducers.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };

const insumos: Insumo[] = [
  { id: "ins-masa", nombre: "Masa madre", unidad_base: "g", costo_unitario: pesos(0.05), stock_minimo: 5000 },
  { id: "ins-mozz", nombre: "Mozzarella", unidad_base: "g", costo_unitario: pesos(0.18), stock_minimo: 3000 },
  { id: "ins-limon", nombre: "Limón", unidad_base: "pz", costo_unitario: pesos(2), stock_minimo: 40 },
];

const recetas: Receta[] = [
  {
    id: "rec-margherita",
    nombre: "Margherita",
    ingredientes: [
      { id: "i1", nombre: "Masa madre", costo: pesos(12.4), insumo_id: "ins-masa", cantidad: 250, unidad: "g" },
      { id: "i2", nombre: "Mozzarella", costo: pesos(17.8), insumo_id: "ins-mozz", cantidad: 120, unidad: "g" },
      // Sin vínculo con el almacén: solo desglosa costo, no descuenta.
      { id: "i3", nombre: "Albahaca", costo: pesos(2.6) },
    ],
  },
  {
    id: "rec-pepperoni",
    nombre: "Pepperoni",
    ingredientes: [
      { id: "i1", nombre: "Masa madre", costo: pesos(12.4), insumo_id: "ins-masa", cantidad: 250, unidad: "g" },
      { id: "i2", nombre: "Mozzarella", costo: pesos(14.2), insumo_id: "ins-mozz", cantidad: 100, unidad: "g" },
    ],
  },
  {
    id: "rec-limonada",
    nombre: "Limonada",
    ingredientes: [
      { id: "i1", nombre: "Limón", costo: pesos(4), insumo_id: "ins-limon", cantidad: 2, unidad: "pz" },
    ],
  },
];

const productos: Producto[] = [
  { id: "var-margherita", nombre: "Margherita", categoria_id: "c1", costo: pesos(42.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-margherita", disponible: false, orden: 1 },
  { id: "var-pepperoni", nombre: "Pepperoni", categoria_id: "c1", costo: pesos(49.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-pepperoni", disponible: false, orden: 2 },
  { id: "prod-pizza", nombre: "Pizza mitad y mitad", categoria_id: "c1", costo: pesos(0),
    precio: pesos(249), impuesto_id: IVA_16.id, disponible: true, orden: 3 },
  { id: "prod-limonada", nombre: "Limonada", categoria_id: "c1", costo: pesos(8),
    precio: pesos(45), impuesto_id: IVA_16.id, receta_id: "rec-limonada", disponible: true, orden: 4 },
  { id: "prod-agua", nombre: "Agua", categoria_id: "c1", costo: pesos(6),
    precio: pesos(38), impuesto_id: IVA_16.id, disponible: true, orden: 5 },
];

const cat: CatalogoIndex = indexar({
  productos,
  categorias: [{ id: "c1", nombre: "Todo", orden: 1 }],
  impuestos: [IVA_16],
  recetas,
});

function renglon(productoId: string, cantidad: number, porciones?: RenglonComanda["porciones"]): RenglonComanda {
  return {
    id: uuidv7(), producto_id: productoId, descripcion: "X", cantidad,
    precio_unitario: pesos(100), costo_unitario: pesos(30),
    impuesto: snapshotTasas(IVA_16), estado: "enviado", porciones,
  };
}

function mov(
  f: FabricaEventos<EventoInventario>,
  insumo_id: string,
  delta: number,
  motivo: MotivoMovimiento,
): EventoInventario {
  return f.crear("movimiento_inventario", `insumo:${insumo_id}`, {
    insumo_id, delta, unidad: "g", motivo,
  });
}

// --- Unidades ---------------------------------------------------------------------

describe("unidades", () => {
  it("convierte dentro del mismo sistema", () => {
    expect(convertir(1.5, "kg", "g")).toBe(1500);
    expect(convertir(500, "g", "kg")).toBe(0.5);
    expect(convertir(2, "l", "ml")).toBe(2000);
  });

  it("no inventa conversiones entre sistemas distintos", () => {
    // Pasar de gramos a mililitros exige una densidad que el software no sabe.
    expect(convertir(100, "g", "ml")).toBeNull();
    expect(convertir(3, "pz", "kg")).toBeNull();
  });

  it("la misma unidad no cambia", () => {
    expect(convertir(7, "pz", "pz")).toBe(7);
  });

  it("formatea escalando cuando conviene", () => {
    expect(formatearCantidad(1500, "g")).toBe("1.50 kg");
    expect(formatearCantidad(250, "g")).toBe("250 g");
    expect(formatearCantidad(2000, "ml")).toBe("2.00 l");
  });
});

// --- Explosión de recetas -----------------------------------------------------------

describe("explosión de lo vendido a insumos", () => {
  it("un producto simple con receta consume sus insumos", () => {
    const consumos = insumosDeRenglon(renglon("prod-limonada", 1), cat);
    expect(consumos).toEqual([{ insumo_id: "ins-limon", cantidad: 2, unidad: "pz" }]);
  });

  it("multiplica por la cantidad del renglón", () => {
    const consumos = insumosDeRenglon(renglon("prod-limonada", 3), cat);
    expect(consumos[0]!.cantidad).toBe(6);
  });

  it("un producto sin receta no consume nada", () => {
    expect(insumosDeRenglon(renglon("prod-agua", 5), cat)).toHaveLength(0);
  });

  it("los ingredientes sin vínculo al almacén no descuentan", () => {
    // La albahaca de la Margherita solo desglosa costo.
    const consumos = insumosDeRenglon(
      renglon("prod-pizza", 1, [
        { ranura_id: "izq", producto_id: "var-margherita", fraccion: 1 },
      ]),
      cat,
    );
    expect(consumos.map((c) => c.insumo_id).sort()).toEqual(["ins-masa", "ins-mozz"]);
  });

  it("una pizza mitad y mitad suma la fracción de cada variedad", () => {
    const consumos = insumosDeRenglon(
      renglon("prod-pizza", 1, [
        { ranura_id: "izq", producto_id: "var-margherita", fraccion: 0.5 },
        { ranura_id: "der", producto_id: "var-pepperoni", fraccion: 0.5 },
      ]),
      cat,
    );
    const masa = consumos.find((c) => c.insumo_id === "ins-masa")!;
    const mozz = consumos.find((c) => c.insumo_id === "ins-mozz")!;
    // Masa: 250×0.5 + 250×0.5 = 250 (una pizza lleva una base)
    expect(masa.cantidad).toBe(250);
    // Mozzarella: 120×0.5 + 100×0.5 = 110
    expect(mozz.cantidad).toBe(110);
  });

  it("agrupa el consumo de varios renglones", () => {
    const consumos = insumosDeRenglones(
      [renglon("prod-limonada", 2), renglon("prod-limonada", 1), renglon("prod-agua", 4)],
      cat,
    );
    expect(consumos).toHaveLength(1);
    expect(consumos[0]!.cantidad).toBe(6);
  });
});

// --- Existencias ---------------------------------------------------------------------

describe("existencias como suma de movimientos", () => {
  function fabrica() {
    return new FabricaEventos<EventoInventario>(CTX);
  }

  it("el stock es la suma de los deltas", () => {
    const f = fabrica();
    const existencias = proyectarExistencias([
      mov(f, "ins-masa", 10000, "recepcion"),
      mov(f, "ins-masa", -250, "consumo_receta"),
      mov(f, "ins-masa", -250, "consumo_receta"),
    ]);
    expect(existenciaDe(existencias, "ins-masa")).toBe(9500);
    expect(existencias.get("ins-masa")!.movimientos).toBe(3);
  });

  it("dos descuentos simultáneos no chocan: ambos cuentan", () => {
    const f = fabrica();
    const existencias = proyectarExistencias([
      mov(f, "ins-mozz", 1000, "recepcion"),
      mov(f, "ins-mozz", -120, "consumo_receta"),
      mov(f, "ins-mozz", -120, "consumo_receta"),
    ]);
    expect(existenciaDe(existencias, "ins-mozz")).toBe(760);
  });

  it("un conteo FIJA la existencia, no la suma", () => {
    const f = fabrica();
    const existencias = proyectarExistencias([
      mov(f, "ins-masa", 10000, "recepcion"),
      f.crear("conteo_registrado", "conteo:suc-1", {
        lineas: [{ insumo_id: "ins-masa", contado: 8700, esperado: 10000 }],
      }),
    ]);
    expect(existenciaDe(existencias, "ins-masa")).toBe(8700);
  });

  it("el stock negativo se señala, NO bloquea", () => {
    const f = fabrica();
    const existencias = proyectarExistencias([
      mov(f, "ins-mozz", 100, "recepcion"),
      mov(f, "ins-mozz", -300, "consumo_receta"),
    ]);
    // El movimiento se registró aunque dejara el saldo en rojo.
    expect(existenciaDe(existencias, "ins-mozz")).toBe(-200);
    expect(enNegativo(existencias)).toHaveLength(1);
  });

  it("un insumo sin movimientos está en cero", () => {
    expect(existenciaDe(proyectarExistencias([]), "ins-masa")).toBe(0);
  });
});

describe("reposición y valor", () => {
  function existenciasDe(pares: [string, number][]) {
    const f = new FabricaEventos<EventoInventario>(CTX);
    return proyectarExistencias(pares.map(([id, n]) => mov(f, id, n, "recepcion")));
  }

  it("lista lo que está por debajo del mínimo, lo más urgente primero", () => {
    const existencias = existenciasDe([
      ["ins-masa", 1000],   // mínimo 5000 → faltan 4000
      ["ins-mozz", 2900],   // mínimo 3000 → faltan 100
      ["ins-limon", 100],   // mínimo 40 → sobra
    ]);
    const lista = porReponer(insumos, existencias);
    expect(lista.map((x) => x.insumo.id)).toEqual(["ins-masa", "ins-mozz"]);
    expect(lista[0]!.faltante).toBe(4000);
  });

  it("valora el inventario a costo, sin contar los negativos", () => {
    const existencias = existenciasDe([["ins-limon", 50], ["ins-mozz", -100]]);
    // 50 limones × $2 = $100; la mozzarella negativa no suma valor.
    expect(valorInventario(insumos, existencias)).toBe(pesos(100));
  });
});

describe("merma", () => {
  it("acumula el consumo por motivo", () => {
    const f = new FabricaEventos<EventoInventario>(CTX);
    const eventos = [
      mov(f, "ins-mozz", -120, "consumo_receta"),
      mov(f, "ins-mozz", -80, "consumo_receta"),
      mov(f, "ins-mozz", -300, "merma"),
    ];
    const consumo = consumoPorMotivo(eventos, "ins-mozz");
    expect(consumo.consumo_receta).toBe(200);
    expect(consumo.merma).toBe(300);
  });

  it("calcula el costo de la merma: la base del cobro por ahorro", () => {
    const f = new FabricaEventos<EventoInventario>(CTX);
    const eventos = [
      mov(f, "ins-mozz", -1000, "merma"),      // 1000 g × $0.18 = $180
      mov(f, "ins-masa", -2000, "merma"),      // 2000 g × $0.05 = $100
      mov(f, "ins-masa", -500, "consumo_receta"), // no es merma
    ];
    expect(costoMerma(eventos, insumos)).toBe(pesos(280));
  });
});

// --- Dirección de los movimientos ------------------------------------------------

describe("el signo del movimiento lo decide el motivo", () => {
  it("las salidas restan aunque se capturen en positivo", () => {
    for (const motivo of [
      "merma",
      "traspaso",
      "devolucion",
      "consumo_receta",
      "utilizacion",
    ] as const) {
      expect(deltaDelMotivo(motivo, 500), motivo).toBe(-500);
      expect(deltaDelMotivo(motivo, -500), motivo).toBe(-500);
    }
  });

  it("las entradas suman aunque se capturen en negativo", () => {
    for (const motivo of ["recepcion", "produccion", "reverso_receta"] as const) {
      expect(deltaDelMotivo(motivo, 500), motivo).toBe(500);
      expect(deltaDelMotivo(motivo, -500), motivo).toBe(500);
    }
  });

  it("el ajuste por conteo respeta el signo: corrige en las dos direcciones", () => {
    expect(deltaDelMotivo("ajuste_conteo", 30)).toBe(30);
    expect(deltaDelMotivo("ajuste_conteo", -30)).toBe(-30);
  });

  it("el consumo por receta no se captura a mano", () => {
    const manuales = MOTIVOS_MANUALES.map((m) => m.valor);
    expect(manuales).not.toContain("consumo_receta");
    expect(manuales).toContain("merma");
    expect(manuales).toContain("recepcion");
  });

  /*
   * La devolución por cancelación la genera el POS al cancelar un platillo ya
   * mandado a cocina. Ofrecerla en el formulario habría dado dos caminos para lo
   * mismo, y uno de ellos sin renglón al que atarse: el almacén no habría podido
   * saber si esa entrada ya estaba contada.
   */
  it("la devolución por cancelación tampoco: la emite el sistema", () => {
    const manuales = MOTIVOS_MANUALES.map((m) => m.valor);
    expect(manuales).not.toContain("reverso_receta");
  });

  it("la utilización sí se captura a mano, y aparece en el formulario", () => {
    const utilizacion = MOTIVOS_MANUALES.find((m) => m.valor === "utilizacion");
    expect(utilizacion).toBeDefined();
    expect(utilizacion!.etiqueta).toBe("Utilización del insumo");
    expect(utilizacion!.direccion).toBe("sale");
  });
});

/*
 * EL COSTO DEL INGREDIENTE SALE DEL ALMACÉN.
 *
 * Era la mitad que le faltaba al vínculo: un ingrediente ya declaraba «250 g de
 * masa» y los descontaba al enviar a cocina, pero su COSTO se tecleaba aparte.
 * Con las dos cifras desconectadas, subir el precio de la harina no cambiaba el
 * costo de ninguna pizza y el food cost seguía diciendo lo de hace seis meses.
 */
describe("costo del ingrediente a partir de su insumo", () => {
  const masa = insumos[0]!; // 5 centavos el gramo
  const limon = insumos[2]!; // 2 pesos la pieza

  it("multiplica el gramaje por lo que cuesta el insumo", () => {
    expect(costoDesdeInsumo({ cantidad: 250, unidad: "g" }, masa)).toBe(pesos(12.5));
    expect(costoDesdeInsumo({ cantidad: 2, unidad: "pz" }, limon)).toBe(pesos(4));
  });

  it("convierte al vuelo dentro del mismo sistema: 1.5 kg de masa son 1500 g", () => {
    expect(costoDesdeInsumo({ cantidad: 1.5, unidad: "kg" }, masa)).toBe(pesos(75));
  });

  it("cierra al centavo: medio centavo no existe", () => {
    // 33 g × 5 centavos = 165 centavos exactos; 33.5 g redondea.
    expect(costoDesdeInsumo({ cantidad: 33.5, unidad: "g" }, masa)).toBe(168);
  });

  /*
   * Los tres casos donde NO se puede calcular devuelven null y no cero, para
   * que quien llama conserve lo tecleado: un cero silencioso convierte un
   * platillo caro en uno que parece regalado.
   */
  it("sin insumo, sin gramaje o con unidades incompatibles devuelve null", () => {
    expect(costoDesdeInsumo({ cantidad: 250, unidad: "g" }, undefined)).toBeNull();
    expect(costoDesdeInsumo({ cantidad: undefined, unidad: "g" }, masa)).toBeNull();
    expect(costoDesdeInsumo({ cantidad: 250, unidad: undefined }, masa)).toBeNull();
    // Gramos contra piezas exigiría saber cuánto pesa un limón.
    expect(costoDesdeInsumo({ cantidad: 250, unidad: "g" }, limon)).toBeNull();
  });

  it("una cantidad negativa no produce un costo negativo", () => {
    expect(costoDesdeInsumo({ cantidad: -10, unidad: "g" }, masa)).toBeNull();
  });

  it("el costo de la receta es la suma de sus ingredientes ya valorados", () => {
    const receta = recetas[2]!; // Limonada: 2 limones
    expect(costoReceta(receta)).toBe(pesos(4));
  });
});
