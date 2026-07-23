import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import { minutosEnCocina, type RenglonComanda } from "../comanda/renglon.js";
import {
  estacionesPorDefecto,
  semaforoDe,
  semaforoPeor,
  type EstacionKds,
} from "../cocina/estaciones.js";
import { cargaPorEstacion, proyectarTablero } from "../cocina/tablero.js";
import { indexar } from "../catalogo/productos.js";
import { construirRenglon } from "../costeo/configuracion.js";
import { FabricaEventos } from "../evento.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const ESTACIONES = estacionesPorDefecto();
const HORNO = ESTACIONES.find((e) => e.id === "est-horno")!;
const BARRA = ESTACIONES.find((e) => e.id === "est-barra")!;

const MINUTO = 60_000;
const T0 = 1_700_000_000_000;

function renglon(descripcion: string, estacion: string): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p1", descripcion, cantidad: 1,
    precio_unitario: pesos(100), costo_unitario: pesos(30),
    impuesto: snapshotTasas(IVA_16), estado: "capturado", estacion_id: estacion,
  };
}

/** Comanda con una pizza (horno) y una limonada (barra), ambas enviadas en T0. */
function comandaEnviada() {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const pizza = renglon("Pizza familiar", "est-horno");
  const bebida = renglon("Limonada", "est-barra");

  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-5", abierta_ts: T0 }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: pizza }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: bebida }),
    f.crear("items_enviados", orden_id, {
      orden_id, renglon_ids: [pizza.id, bebida.id],
    }),
  ];
  // El sello real lo pone la fábrica; para las pruebas se fija en T0.
  const enviado = eventos[3]!;
  (enviado as { ts: number }).ts = T0;

  return { f, orden_id, pizza, bebida, eventos };
}

// --- Semáforo -------------------------------------------------------------------

describe("semáforo por estación", () => {
  it("cada estación tiene su propio umbral", () => {
    // 5 minutos: normal en el horno, ya demorado en la barra.
    expect(semaforoDe(5, HORNO, false)).toBe("normal");
    expect(semaforoDe(5, BARRA, false)).toBe("advertencia");
    expect(semaforoDe(7, BARRA, false)).toBe("demorado");
  });

  it("pasa a advertencia al llegar al objetivo", () => {
    expect(semaforoDe(11, HORNO, false)).toBe("normal");
    expect(semaforoDe(12, HORNO, false)).toBe("advertencia");
    expect(semaforoDe(18, HORNO, false)).toBe("demorado");
  });

  it("un platillo listo ya no se marca demorado", () => {
    expect(semaforoDe(45, HORNO, true)).toBe("listo");
  });

  it("el ticket toma el semáforo de su peor platillo", () => {
    expect(semaforoPeor(["normal", "advertencia"])).toBe("advertencia");
    expect(semaforoPeor(["normal", "demorado", "advertencia"])).toBe("demorado");
    expect(semaforoPeor(["listo", "listo"])).toBe("listo");
    expect(semaforoPeor(["normal", "listo"])).toBe("normal");
  });
});

// --- Cronómetro -------------------------------------------------------------------

describe("cronómetro del platillo", () => {
  it("cuenta desde que salió a cocina", () => {
    const r = { ...renglon("X", "est-horno"), enviado_ts: T0 };
    expect(minutosEnCocina(r, T0 + 7 * MINUTO)).toBe(7);
  });

  it("se detiene cuando el platillo queda listo", () => {
    const r = {
      ...renglon("X", "est-horno"),
      enviado_ts: T0,
      listo_ts: T0 + 9 * MINUTO,
    };
    // Aunque pasen 40 minutos más, el cronómetro quedó en 9.
    expect(minutosEnCocina(r, T0 + 50 * MINUTO)).toBe(9);
  });

  it("un platillo sin enviar no tiene cronómetro", () => {
    expect(minutosEnCocina(renglon("X", "est-horno"), T0 + MINUTO)).toBe(0);
  });
});

// --- Tablero --------------------------------------------------------------------------

describe("tablero de cocina", () => {
  it("los tiempos se sellan al enviar, poner en marcha y marcar listo", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_en_marcha", orden_id, {
        orden_id, renglon_id: pizza.id, estacion_id: "est-horno",
      }),
      f.crear("item_listo", orden_id, { orden_id, renglon_id: pizza.id }),
    ]);

    const final = estado.renglones.find((r) => r.id === pizza.id)!;
    expect(final.enviado_ts).toBeDefined();
    expect(final.en_marcha_ts).toBeDefined();
    expect(final.listo_ts).toBeDefined();
    expect(final.estado).toBe("listo");
  });

  it("filtra los platillos por estación", () => {
    const estado = proyectarComanda(comandaEnviada().eventos);

    const horno = proyectarTablero([estado], {
      estacion_id: "est-horno", ahora: T0, estaciones: ESTACIONES,
    });
    expect(horno).toHaveLength(1);
    expect(horno[0]!.renglones).toHaveLength(1);
    expect(horno[0]!.renglones[0]!.descripcion).toBe("Pizza familiar");

    const barra = proyectarTablero([estado], {
      estacion_id: "est-barra", ahora: T0, estaciones: ESTACIONES,
    });
    expect(barra[0]!.renglones[0]!.descripcion).toBe("Limonada");
  });

  it("sin filtro muestra todas las estaciones en un solo ticket", () => {
    const estado = proyectarComanda(comandaEnviada().eventos);
    const tablero = proyectarTablero([estado], { ahora: T0, estaciones: ESTACIONES });
    expect(tablero).toHaveLength(1);
    expect(tablero[0]!.renglones).toHaveLength(2);
  });

  it("lo que aún no se envía NO aparece en cocina", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const estado = proyectarComanda([
      f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: T0 }),
      f.crear("item_agregado", orden_id, { orden_id, renglon: renglon("Pizza", "est-horno") }),
    ]);
    expect(proyectarTablero([estado], { ahora: T0, estaciones: ESTACIONES })).toHaveLength(0);
  });

  it("lo entregado sale del tablero, salvo en la vista de recall", () => {
    const { f, orden_id, pizza, bebida, eventos } = comandaEnviada();
    const log = [
      ...eventos,
      f.crear("item_listo", orden_id, { orden_id, renglon_id: pizza.id }),
      f.crear("item_entregado", orden_id, { orden_id, renglon_id: pizza.id }),
      f.crear("item_listo", orden_id, { orden_id, renglon_id: bebida.id }),
      f.crear("item_entregado", orden_id, { orden_id, renglon_id: bebida.id }),
    ];
    const estado = proyectarComanda(log);

    expect(proyectarTablero([estado], { ahora: T0, estaciones: ESTACIONES })).toHaveLength(0);
    expect(
      proyectarTablero([estado], { ahora: T0, estaciones: ESTACIONES, incluirEntregados: true }),
    ).toHaveLength(1);
  });

  it("ordena los tickets por antigüedad, no por mesa", () => {
    const vieja = comandaEnviada();
    const nueva = comandaEnviada();
    (nueva.eventos[3] as { ts: number }).ts = T0 + 10 * MINUTO;

    const tablero = proyectarTablero(
      [proyectarComanda(nueva.eventos), proyectarComanda(vieja.eventos)],
      { ahora: T0 + 20 * MINUTO, estaciones: ESTACIONES },
    );
    expect(tablero[0]!.orden_id).toBe(vieja.orden_id);
  });

  it("marca el ticket como completo cuando todo está listo", () => {
    const { f, orden_id, pizza, bebida, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_listo", orden_id, { orden_id, renglon_id: pizza.id }),
      f.crear("item_listo", orden_id, { orden_id, renglon_id: bebida.id }),
    ]);
    const ticket = proyectarTablero([estado], { ahora: T0, estaciones: ESTACIONES })[0]!;
    expect(ticket.completo).toBe(true);
    expect(ticket.semaforo).toBe("listo");
  });

  it("cuenta la carga pendiente de cada estación", () => {
    const estado = proyectarComanda(comandaEnviada().eventos);
    const carga = cargaPorEstacion([estado]);
    expect(carga.get("est-horno")).toBe(1);
    expect(carga.get("est-barra")).toBe(1);
    expect(carga.get("est-parrilla")).toBeUndefined();
  });

  it("las estaciones de arranque cubren las del catálogo de demostración", () => {
    const ids = ESTACIONES.map((e) => e.id);
    for (const esperada of ["est-horno", "est-pastas", "est-parrilla", "est-barra", "est-fria", "est-postres"]) {
      expect(ids).toContain(esperada);
    }
  });

  it("cada estación tiene su límite por encima de su objetivo", () => {
    for (const e of ESTACIONES) {
      expect(e.minutos_limite, e.nombre).toBeGreaterThan(e.minutos_objetivo);
    }
  });
});

describe("estación sin configurar", () => {
  it("usa umbrales razonables por omisión", () => {
    const desconocida: EstacionKds | undefined = undefined;
    expect(semaforoDe(5, desconocida, false)).toBe("normal");
    expect(semaforoDe(12, desconocida, false)).toBe("advertencia");
    expect(semaforoDe(20, desconocida, false)).toBe("demorado");
  });
});

/**
 * El ruteo por estación es una cadena de tres eslabones: el producto la declara,
 * el renglón la hereda al capturarse y el evento la transporta hasta el KDS. Si
 * cualquiera se rompe, la cocina ve todas sus pestañas en cero sin más aviso.
 */
describe("ruteo de la estación, del catálogo al KDS", () => {
  const cat = indexar({
    productos: [
      {
        id: "prod-pizza", nombre: "Pizza margherita", categoria_id: "cat-pizzas",
        costo: pesos(45), precio: pesos(189), impuesto_id: IVA_16.id,
        disponible: true, orden: 1, estacion_id: "est-horno",
      },
      {
        id: "prod-agua", nombre: "Agua natural", categoria_id: "cat-bebidas",
        costo: pesos(4), precio: pesos(35), impuesto_id: IVA_16.id,
        disponible: true, orden: 2,
      },
    ],
    categorias: [
      { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
      { id: "cat-bebidas", nombre: "Bebidas", orden: 2 },
    ],
    impuestos: [IVA_16],
  });

  it("el renglón hereda la estación del producto", () => {
    const r = construirRenglon({ producto_id: "prod-pizza", cantidad: 1 }, cat, IVA_16);
    expect(r.estacion_id).toBe("est-horno");
  });

  it("un producto sin estación no rutea a ninguna", () => {
    const r = construirRenglon({ producto_id: "prod-agua", cantidad: 1 }, cat, IVA_16);
    expect(r.estacion_id).toBeUndefined();
  });

  it("la estación sobrevive al viaje por el event log", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const pizza = construirRenglon({ producto_id: "prod-pizza", cantidad: 1 }, cat, IVA_16);

    const estado = proyectarComanda([
      f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-3", abierta_ts: T0 }),
      f.crear("item_agregado", orden_id, { orden_id, renglon: pizza }),
      f.crear("items_enviados", orden_id, { orden_id, renglon_ids: [pizza.id] }),
    ]);

    expect(cargaPorEstacion([estado]).get("est-horno")).toBe(1);
    const enHorno = proyectarTablero([estado], {
      estacion_id: "est-horno", ahora: T0, estaciones: ESTACIONES,
    });
    expect(enHorno).toHaveLength(1);
    expect(enHorno[0]!.renglones[0]!.descripcion).toBe("Pizza margherita");
  });
});

// --- Indicaciones que cambian sobre la marcha ---------------------------------------

/**
 * El caso real: el comensal pide una hamburguesa y, cuando el mesero ya la
 * capturó, dice que la quiere sin tomate.
 *
 * Lo delicado no es guardar el texto —eso es fácil— sino que llegue a quien ya
 * leyó el ticket. Un cocinero mira la comanda una vez; si el cambio entra en
 * silencio, la hamburguesa sale con tomate y se regresa entera.
 */
describe("cambiar la indicación de un platillo", () => {
  it("una nota puesta al capturar NO se marca como cambio", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const conNota = proyectarComanda([
      ...eventos.slice(0, 3),
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin aceitunas",
      }),
      eventos[3]!,
    ]);

    const renglon = conNota.renglones.find((r) => r.id === pizza.id)!;
    expect(renglon.notas).toBe("Sin aceitunas");
    // Se pidió así desde el principio: no hay nada que avisar.
    expect(renglon.notas_cambiadas_ts).toBeUndefined();
  });

  it("cambiarla DESPUÉS de mandarla a cocina sí se marca", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
    ]);

    const renglon = estado.renglones.find((r) => r.id === pizza.id)!;
    expect(renglon.notas).toBe("Sin tomate");
    expect(renglon.notas_cambiadas_ts).toBeDefined();
  });

  it("el tablero de cocina lo transporta para poder señalarlo", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
    ]);

    const [ticket] = proyectarTablero([estado], { ahora: T0 + MINUTO, estaciones: ESTACIONES });
    const enPantalla = ticket!.renglones.find((r) => r.renglon_id === pizza.id)!;

    expect(enPantalla.notas).toBe("Sin tomate");
    expect(enPantalla.notas_cambiadas).toBe(true);
  });

  /*
   * Encender la alarma por nada enseña a ignorarla, que es peor que no tenerla.
   */
  it("reenviar la MISMA nota no cuenta como cambio", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
      f.crear("cambio_visto", orden_id, { orden_id, renglon_id: pizza.id }),
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
    ]);

    expect(estado.renglones.find((r) => r.id === pizza.id)!.notas_cambiadas_ts).toBeUndefined();
  });

  it("cambiar solo la cantidad no enciende la alarma de indicaciones", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, { orden_id, renglon_id: pizza.id, cantidad: 3 }),
    ]);

    const renglon = estado.renglones.find((r) => r.id === pizza.id)!;
    expect(renglon.cantidad).toBe(3);
    expect(renglon.notas_cambiadas_ts).toBeUndefined();
  });

  it("cocina la da por vista y la alarma se apaga", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
      f.crear("cambio_visto", orden_id, { orden_id, renglon_id: pizza.id }),
    ]);

    const renglon = estado.renglones.find((r) => r.id === pizza.id)!;
    // La indicación se queda; lo que se apaga es el aviso de que cambió.
    expect(renglon.notas).toBe("Sin tomate");
    expect(renglon.notas_cambiadas_ts).toBeUndefined();
  });

  /*
   * Un plato terminado ya no puede incorporar el cambio. Dejar la alarma
   * encendida solo estorbaría al siguiente que mire el tablero.
   */
  it("marcar el platillo listo también apaga la alarma", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const estado = proyectarComanda([
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
      f.crear("item_listo", orden_id, { orden_id, renglon_id: pizza.id }),
    ]);

    expect(estado.renglones.find((r) => r.id === pizza.id)!.notas_cambiadas_ts).toBeUndefined();
  });

  it("quitar la indicación también es un cambio que cocina debe ver", () => {
    const { f, orden_id, pizza, eventos } = comandaEnviada();
    const conNota = [
      ...eventos,
      f.crear("item_modificado", orden_id, {
        orden_id, renglon_id: pizza.id, notas: "Sin tomate",
      }),
      f.crear("cambio_visto", orden_id, { orden_id, renglon_id: pizza.id }),
    ];
    const estado = proyectarComanda([
      ...conNota,
      f.crear("item_modificado", orden_id, { orden_id, renglon_id: pizza.id, notas: "" }),
    ]);

    const renglon = estado.renglones.find((r) => r.id === pizza.id)!;
    expect(renglon.notas).toBe("");
    expect(renglon.notas_cambiadas_ts).toBeDefined();
  });
});
