/**
 * La ficha 360° del comensal.
 *
 * Lo que hay que probar es que CRUCE BIEN lo que ya estaba en el log —cuentas,
 * opiniones, reservas— y que no invente lo que no sabe: una periodicidad con
 * una sola visita, o un "se está yendo" de quien vino una vez.
 *
 * Y sobre todo, que reconozca a la misma persona entre visitas. Fallar ahí
 * parte a un cliente en tres fichas y el CRM entero deja de servir.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { FabricaEventos } from "../evento.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import type { Opinion } from "../clientes/opinion.js";
import type { Reserva } from "../clientes/reservas.js";
import {
  comensalesConocidos,
  enRiesgoDePerderse,
  fichaDe,
  identidadDe,
} from "../clientes/ficha360.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = 24 * 60 * 60 * 1000;
const TEL = "3311223344";

function renglon(producto: string, descripcion: string, precio: number, cantidad = 1): RenglonComanda {
  return {
    id: uuidv7(), producto_id: producto, descripcion, cantidad,
    precio_unitario: pesos(precio), costo_unitario: pesos(30),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

function visita(opciones: {
  cerrada_ts: number;
  renglones: RenglonComanda[];
  telefono?: string;
  nombre?: string;
  propina?: number;
}): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden, { orden_id: orden, mesa_id: "mesa-1", abierta_ts: opciones.cerrada_ts - 3_600_000 }),
    ...opciones.renglones.map((r) => f.crear("item_agregado", orden, { orden_id: orden, renglon: r })),
    f.crear("orden_identificada", orden, {
      orden_id: orden,
      a_nombre_de: opciones.nombre ?? "Familia Ramírez",
      telefono: opciones.telefono,
    }),
  ];

  if (opciones.propina) {
    eventos.push(f.crear("propina_registrada", orden, { orden_id: orden, monto: pesos(opciones.propina) }));
  }

  const cierre = f.crear("cuenta_cerrada", orden, { orden_id: orden });
  (cierre as { ts: number }).ts = opciones.cerrada_ts;
  eventos.push(cierre);

  return proyectarComanda(eventos);
}

// --- Reconocer a la misma persona ---------------------------------------------------------

describe("reconocer a un comensal entre visitas", () => {
  it("el teléfono manda sobre el nombre", () => {
    const a = identidadDe({ telefono: "+52 33 1122-3344", nombre: "Ramírez" });
    const b = identidadDe({ telefono: "3311223344", nombre: "familia ramirez" });
    expect(a).toBe(b);
  });

  /*
   * EL MISMO CLIENTE, TRES FORMATOS. En la mesa lo dicta sin lada, el portal lo
   * manda con +52 y WhatsApp lo entrega como 521…. Si cada uno diera una ficha
   * distinta, el CRM no serviría para nada.
   */
  it("da igual con qué lada llegue el mismo número", () => {
    const formas = ["3311223344", "+52 33 1122 3344", "5213311223344", "044 33 1122 3344"];
    const identidades = new Set(formas.map((t) => identidadDe({ telefono: t })));
    expect(identidades.size).toBe(1);
  });

  /* "Familia Ramírez" y "familia ramirez" son la misma gente. */
  it("sin teléfono, cae al nombre sin acentos ni mayúsculas", () => {
    expect(identidadDe({ nombre: "Familia Ramírez" })).toBe(
      identidadDe({ nombre: "  familia ramirez " }),
    );
  });

  it("el cliente registrado manda sobre todo lo demás", () => {
    expect(identidadDe({ cliente_id: "cli-9", telefono: TEL })).toBe("cli:cli-9");
  });

  /* Un nombre de dos letras o un teléfono a medias no identifican a nadie. */
  it("no inventa una identidad con datos insuficientes", () => {
    expect(identidadDe({})).toBeNull();
    expect(identidadDe({ nombre: "Jo" })).toBeNull();
    expect(identidadDe({ telefono: "331" })).toBeNull();
  });
});

// --- La ficha -----------------------------------------------------------------------------

describe("lo que el local ya sabía de un cliente", () => {
  const fuentes = () => ({
    comandas: [
      visita({ cerrada_ts: AHORA - 60 * DIA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249)], propina: 30 }),
      visita({ cerrada_ts: AHORA - 30 * DIA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249), renglon("p2", "Limonada", 45)] }),
      visita({ cerrada_ts: AHORA - 10 * DIA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249)], propina: 50 }),
      // Otra persona: no debe mezclarse.
      visita({ cerrada_ts: AHORA - 5 * DIA, telefono: "3399887766", nombre: "Otro", renglones: [renglon("p3", "Pasta", 180)] }),
    ],
    opiniones: [] as Opinion[],
    reservas: [] as Reserva[],
    ahora: AHORA,
  });

  const yo = identidadDe({ telefono: TEL })!;

  it("suma sus visitas y su gasto, y no el de otros", () => {
    const f = fichaDe(yo, fuentes());
    expect(f.visitas).toBe(3);
    expect(f.gastado).toBeGreaterThan(0);
    expect(f.propinas).toBe(pesos(80));
  });

  it("sabe cuándo vino la primera vez y la última", () => {
    const f = fichaDe(yo, fuentes());
    expect(f.primera_visita).toBe(AHORA - 60 * DIA);
    expect(f.ultima_visita).toBe(AHORA - 10 * DIA);
    expect(f.dias_sin_venir).toBe(10);
  });

  /* El promedio entre visitas, no desde la primera. */
  it("calcula cada cuánto vuelve", () => {
    // 50 días entre la primera y la última, 2 intervalos → 25 días.
    expect(fichaDe(yo, fuentes()).cada_cuantos_dias).toBe(25);
  });

  /* Con una sola visita no hay intervalo que medir. */
  it("con una sola visita no inventa una periodicidad", () => {
    const f = fichaDe(yo, {
      ...fuentes(),
      comandas: [visita({ cerrada_ts: AHORA - DIA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249)] })],
    });
    expect(f.visitas).toBe(1);
    expect(f.cada_cuantos_dias).toBeNull();
  });

  it("de alguien que nunca ha venido no dice nada raro", () => {
    const f = fichaDe("tel:0000000000", fuentes());
    expect(f.visitas).toBe(0);
    expect(f.dias_sin_venir).toBeNull();
    expect(f.favoritos).toEqual([]);
  });

  /* Lo que convierte a un mesero en alguien que se acuerda de ti. */
  it("saca lo que pide siempre", () => {
    const f = fichaDe(yo, fuentes());
    expect(f.favoritos[0]).toMatchObject({ descripcion: "Pizza", veces: 3 });
  });

  it("el ticket promedio sale de sus visitas, no del total del local", () => {
    const f = fichaDe(yo, fuentes());
    expect(f.ticket_promedio).toBe(Math.round(f.gastado / 3));
  });
});

// --- Cómo lo trataron ---------------------------------------------------------------------

describe("sus opiniones y sus reservas", () => {
  it("cruza las opiniones por la cuenta a la que pertenecen", () => {
    const suya = visita({ cerrada_ts: AHORA - DIA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249)] });
    const ajena = visita({ cerrada_ts: AHORA - DIA, telefono: "3300000000", nombre: "Otro", renglones: [renglon("p1", "Pizza", 249)] });

    const f = fichaDe(identidadDe({ telefono: TEL })!, {
      comandas: [suya, ajena],
      opiniones: [
        { opinion_id: "o1", orden_id: suya.orden_id, calificacion: "mal", motivos: ["espera"], ts: AHORA } as Opinion,
        { opinion_id: "o2", orden_id: ajena.orden_id, calificacion: "bien", motivos: [], ts: AHORA } as Opinion,
      ],
      reservas: [],
      ahora: AHORA,
    });

    expect(f.opiniones).toBe(1);
    expect(f.malas).toBe(1);
  });

  /* El dato con el que se decide si se le vuelve a apartar mesa un viernes. */
  it("cuenta las veces que plantó", () => {
    const reservas: Reserva[] = [
      { id: "r1", nombre: "Ramírez", telefono: TEL, personas: 4, para_ts: AHORA - 10 * DIA, duracion_min: 90, origen: "casa", estado: "no_llego", creada_ts: 0 },
      { id: "r2", nombre: "Ramírez", telefono: TEL, personas: 2, para_ts: AHORA - 5 * DIA, duracion_min: 90, origen: "comensal", estado: "sentada", creada_ts: 0 },
    ];
    const f = fichaDe(identidadDe({ telefono: TEL })!, {
      comandas: [], opiniones: [], reservas, ahora: AHORA,
    });
    expect(f.reservas).toBe(2);
    expect(f.plantones).toBe(1);
  });
});

// --- Quién se está yendo ------------------------------------------------------------------

describe("los que se están yendo", () => {
  const cliente = (dias_sin_venir: number, cada: number, gastado: number, visitas = 5) =>
    ({
      nombre: `c${dias_sin_venir}`, visitas, gastado: pesos(gastado),
      dias_sin_venir, cada_cuantos_dias: cada,
    }) as never;

  /*
   * Un cliente diario y uno mensual no se pierden al mismo ritmo. El umbral
   * sale de SU periodicidad, no de un número fijo para todos.
   */
  it("el umbral depende de cada cuánto venía", () => {
    const enRiesgo = enRiesgoDePerderse([
      cliente(50, 15, 5000), // venía cada 15 días, lleva 50 → se está yendo
      cliente(20, 15, 3000), // lleva 20 de 15 → todavía es normal
      cliente(60, 30, 9000), // cada 30, lleva 60 → justo en el límite, no entra
    ]);
    expect(enRiesgo.map((f) => f.nombre)).toEqual(["c50"]);
  });

  /* Quien vino una vez no se está yendo: nunca llegó. */
  it("no señala a quien solo vino una vez", () => {
    expect(enRiesgoDePerderse([cliente(200, 10, 500, 1)])).toEqual([]);
  });

  it("ordena por lo que gastaba: primero el que más duele perder", () => {
    const enRiesgo = enRiesgoDePerderse([cliente(90, 10, 2000), cliente(90, 10, 8000)]);
    expect(enRiesgo[0]!.gastado).toBe(pesos(8000));
  });
});

describe("a quién conoce el local", () => {
  it("junta a los de las cuentas y a los de las reservas, sin repetir", () => {
    const conocidos = comensalesConocidos({
      comandas: [visita({ cerrada_ts: AHORA, telefono: TEL, renglones: [renglon("p1", "Pizza", 249)] })],
      opiniones: [],
      reservas: [
        { id: "r1", nombre: "Ramírez", telefono: TEL, personas: 2, para_ts: AHORA, duracion_min: 90, origen: "casa", estado: "apartada", creada_ts: 0 },
        { id: "r2", nombre: "Nuevo Cliente", telefono: "3355667788", personas: 2, para_ts: AHORA, duracion_min: 90, origen: "comensal", estado: "solicitada", creada_ts: 0 },
      ],
      ahora: AHORA,
    });
    expect(conocidos).toHaveLength(2);
  });
});
