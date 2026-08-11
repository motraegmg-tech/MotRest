/**
 * El relevo cuando la caja se muere a media cena.
 *
 * TODO ESTE ARCHIVO EXISTE POR UN CASO: LA RED PARTIDA EN DOS.
 *
 * Con dos Hubs asignando secuencia, el registro del local se parte en dos
 * historias que no se pueden volver a unir: los mismos números apuntando a
 * ventas distintas, dos folios 1043, dos cortes. Ningún beneficio del relevo
 * compensa eso — y es un caso que jamás se va a poder reproducir en un
 * restaurante de verdad, así que o se prueba aquí o no se prueba nunca.
 */
import { describe, expect, it } from "vitest";
import {
  ESPERA_RELEVO_MS,
  TERMINAL_VIVA_MS,
  avisoParaElPersonal,
  decidirFailover,
  mayoriaDe,
  puedeCerrarTurno,
  type EstadoLocal,
  type TerminalDelLocal,
} from "../organizacion/failover.js";

const AHORA = new Date(2026, 6, 24, 21, 30).getTime();

function terminal(
  id: string,
  papel: TerminalDelLocal["papel"],
  prioridad: number,
  vistoHace = 0,
): TerminalDelLocal {
  return { device_id: id, papel, prioridad, visto_ts: AHORA - vistoHace };
}

/** Un local de cuatro: la caja y tres tablets, dos de ellas suplentes. */
const CENSO: TerminalDelLocal[] = [
  terminal("caja", "titular", 0),
  terminal("tablet-1", "suplente", 1),
  terminal("tablet-2", "suplente", 2),
  terminal("tablet-3", "terminal", 9),
];

function estado(extra: Partial<EstadoLocal> = {}): EstadoLocal {
  return {
    yo: CENSO[1]!,
    censo: CENSO,
    titular_visto_ts: AHORA,
    soy_hub: false,
    ...extra,
  };
}

// --- La mayoría --------------------------------------------------------------------------------

describe("cuántas terminales hacen mayoría", () => {
  /*
   * ESTRICTA. Con cuatro hacen falta tres, no dos: con dos y dos, las dos
   * mitades se proclamarían y el registro se partiría, que es justo lo que se
   * está evitando.
   */
  it("más de la mitad, nunca la mitad exacta", () => {
    expect(mayoriaDe(4)).toBe(3);
    expect(mayoriaDe(2)).toBe(2);
    expect(mayoriaDe(3)).toBe(2);
    expect(mayoriaDe(5)).toBe(3);
    expect(mayoriaDe(1)).toBe(1);
  });
});

// --- Operación normal --------------------------------------------------------------------------

describe("con la caja funcionando", () => {
  it("no pasa nada y no se avisa de nada", () => {
    const d = decidirFailover(estado(), AHORA);
    expect(d.situacion).toBe("normal");
    expect(avisoParaElPersonal(d)).toBe("");
  });

  /* Un hueco de segundos entre latidos es lo normal en una wifi de restaurante. */
  it("un hueco de segundos entre latidos es normalidad, no una alarma", () => {
    const d = decidirFailover(estado({ titular_visto_ts: AHORA - 20_000 }), AHORA);
    expect(d.situacion).toBe("normal");
    expect(avisoParaElPersonal(d)).toBe("");
  });

  /*
   * LA FRANJA INTERMEDIA, QUE ES LA QUE HACE FALTA. Sin dos umbrales, este
   * estado no existe: el sistema pasaría de la normalidad al cambio de mando sin
   * avisar a nadie, y el personal se enteraría cuando ya pasó. Aquí se sabe que
   * algo va mal, se le dice, y todavía no se toca el mando — que es exactamente
   * lo que ocurre mientras una computadora se reinicia.
   */
  it("pasado el primer umbral avisa, pero NO releva todavía", () => {
    const d = decidirFailover(estado({ titular_visto_ts: AHORA - 45_000 }), AHORA);
    expect(d.situacion).toBe("esperando");
    expect(avisoParaElPersonal(d)).toContain("Siga vendiendo");
  });

  /* Y el aviso llega también a las tablets que nunca van a mandar. */
  it("el aviso es para todos, no solo para las suplentes", () => {
    const d = decidirFailover(
      estado({ titular_visto_ts: AHORA - 45_000, yo: CENSO[3]! }),
      AHORA,
    );
    expect(d.situacion).toBe("esperando");
  });
});

// --- El relevo ----------------------------------------------------------------------------------

describe("cuando la caja lleva rato sin responder", () => {
  const caida = { titular_visto_ts: AHORA - ESPERA_RELEVO_MS - 1_000 };

  it("la suplente de mayor prioridad toma el mando", () => {
    const d = decidirFailover(estado(caida), AHORA);
    expect(d.situacion).toBe("relevar");
    expect(avisoParaElPersonal(d)).toContain("llevando el control");
  });

  it("la segunda suplente aguanta: le toca a la primera", () => {
    const d = decidirFailover(estado({ ...caida, yo: CENSO[2]! }), AHORA);
    expect(d.situacion).toBe("aguantar");
    expect(d.motivo).toContain("más prioridad");
  });

  /* Si la primera también está caída, entra la segunda. */
  it("si la primera suplente no está, entra la siguiente", () => {
    const censo = [
      CENSO[0]!,
      terminal("tablet-1", "suplente", 1, TERMINAL_VIVA_MS + 5_000),
      CENSO[2]!,
      CENSO[3]!,
    ];
    const d = decidirFailover({ ...estado(caida), yo: censo[2]!, censo }, AHORA);
    expect(d.situacion).toBe("relevar");
  });

  it("una tablet que no es suplente nunca manda", () => {
    const d = decidirFailover(estado({ ...caida, yo: CENSO[3]! }), AHORA);
    expect(d.situacion).toBe("aguantar");
    expect(d.motivo).toContain("no es suplente");
  });

  it("si nunca se supo del titular, también releva", () => {
    expect(decidirFailover(estado({ titular_visto_ts: null }), AHORA).situacion).toBe("relevar");
  });
});

// --- La red partida en dos ----------------------------------------------------------------------

describe("cuando la red se parte en dos mitades", () => {
  /*
   * EL CANDADO MÁS IMPORTANTE DEL PROYECTO EN ESTE ARCHIVO. Ninguna mitad
   * alcanza mayoría, así que ninguna se proclama. Las dos siguen en isla: es
   * incómodo pero recuperable. Dos Hubs a la vez NO lo es.
   */
  it("NINGUNA mitad se proclama Hub", () => {
    // Solo se ven dos de cuatro: la propia y una más.
    const censo = [
      terminal("caja", "titular", 0, ESPERA_RELEVO_MS + 5_000),
      terminal("tablet-1", "suplente", 1),
      terminal("tablet-2", "suplente", 2, TERMINAL_VIVA_MS + 5_000),
      terminal("tablet-3", "terminal", 9),
    ];

    const d = decidirFailover(
      {
        yo: censo[1]!,
        censo,
        titular_visto_ts: AHORA - ESPERA_RELEVO_MS - 1_000,
        soy_hub: false,
      },
      AHORA,
    );

    expect(d.situacion).toBe("aguantar");
    expect(d.motivo).toContain("partiría el registro del local en dos");
    expect(d.visibles).toBe(2);
    expect(d.necesarias).toBe(3);
  });

  /* Y se le dice al personal en su idioma, no en jerga. */
  it("al personal se le dice qué hacer, sin jerga", () => {
    const aviso = avisoParaElPersonal({
      situacion: "aguantar",
      motivo: "",
      visibles: 2,
      necesarias: 3,
    });
    expect(aviso).toContain("Siga vendiendo");
    expect(aviso).toContain("Avise al encargado");
    expect(aviso).not.toMatch(/isla|failover|Hub|mayoría/i);
  });
});

// --- El titular vuelve ---------------------------------------------------------------------------

describe("cuando la caja vuelve", () => {
  /*
   * EL TITULAR SIEMPRE GANA. Sin esta regla habría negociación, y una
   * negociación entre dos que se creen Hub es la forma más rápida de acabar con
   * dos Hubs de verdad.
   */
  it("la suplente devuelve el mando sin discutir", () => {
    const d = decidirFailover(estado({ soy_hub: true, titular_visto_ts: AHORA }), AHORA);
    expect(d.situacion).toBe("devolver");
    expect(avisoParaElPersonal(d)).toContain("vuelve a la normalidad");
  });

  it("mientras no vuelva, la suplente sigue de Hub aunque pierda mayoría", () => {
    // Ya es Hub: quitarle el mando a media cena sería peor que mantenerlo.
    const d = decidirFailover(
      estado({ soy_hub: true, titular_visto_ts: AHORA - ESPERA_RELEVO_MS - 1_000 }),
      AHORA,
    );
    expect(d.situacion).toBe("relevar");
  });
});

// --- Lo que no se puede hacer sin la caja ---------------------------------------------------------

describe("cerrar el turno sin la caja", () => {
  /*
   * NO SE PUEDE, y no es una limitación: el corte cuadra el dinero FÍSICO del
   * cajón contra lo vendido, y el cajón está en la computadora que no responde.
   * Un corte desde una tablet cuadraría contra un efectivo que nadie contó.
   */
  it("vender sí, cerrar el día no", () => {
    const relevando = decidirFailover(estado({ titular_visto_ts: null }), AHORA);
    const v = puedeCerrarTurno(relevando);

    expect(v.puede).toBe(false);
    expect(v.razon).toContain("con el efectivo contado delante");
  });

  it("con la caja de vuelta, el corte se hace normal", () => {
    expect(puedeCerrarTurno(decidirFailover(estado(), AHORA)).puede).toBe(true);
    expect(
      puedeCerrarTurno(decidirFailover(estado({ soy_hub: true }), AHORA)).puede,
    ).toBe(true);
  });
});
