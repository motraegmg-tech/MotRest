/**
 * Lo que una terminal anota tiene que SALIR de ella, sin que nadie pulse F5.
 *
 * ## El defecto que estas pruebas cierran
 *
 * Gonzalo: «que no se tenga que estar actualizando o dando clic en F5 para que
 * lleguen los cambios que hagan los dispositivos conectados al hub».
 *
 * No era la recepción —el WebSocket conecta y el Hub difunde el log completo—:
 * era el ENVÍO. `sync.empujar()` se llamaba desde un solo sitio de toda la
 * operación, las comandas. Otros trece almacenes escribían su evento en la
 * bandeja de salida y ahí se quedaba: caja, checador, tesorería, egresos,
 * inventario, compras, clientes, prenómina, opiniones, reservas, socios, fiscal
 * y las altas de usuario.
 *
 * Una tableta que registraba una checada la guardaba y no la mandaba. Si después
 * tomaba una comanda, lo pendiente viajaba de golpe con ella —de ahí que «a
 * veces sí llegara»—; y si no, esperaba a la siguiente reconexión. Recargar la
 * página ES una reconexión: por eso el F5 «funcionaba».
 *
 * La prueba no mira un almacén concreto a propósito. Mira la REGLA: todo lo que
 * se anota sale. Escrita contra `asistencia` habría pasado en verde el día que
 * alguien añadiera el almacén número catorce sin empujar.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FabricaEventos, type EventoBase } from "@motrest/dominio";

/**
 * Una copia fiel de lo que hace `conEmpujeAutomatico` en el arranque.
 *
 * Se replica en vez de importarse porque esa función vive dentro del módulo de
 * arranque, que al importarse abre IndexedDB y monta la aplicación entera. Es el
 * mismo motivo por el que las pruebas del Hub replican la forma de `main.ts`.
 * Lo que sí se comprueba contra el archivo de verdad, más abajo, es que el
 * arranque siga envolviendo el almacén: una réplica no puede demostrar que el
 * cable está puesto, y el defecto original era justamente un cable que faltaba.
 */
const RETARDO_EMPUJE_MS = 120;

function conEmpujeAutomatico(
  eventos: { anexar: (e: readonly EventoBase[]) => Promise<void> },
  empujar: () => void,
) {
  const anexarOriginal = eventos.anexar.bind(eventos);
  let programado: ReturnType<typeof setTimeout> | null = null;

  eventos.anexar = async (lote: readonly EventoBase[]) => {
    await anexarOriginal(lote);
    const naceAqui = lote.some((e) => e.seq === undefined);
    if (!naceAqui || programado) return;
    programado = setTimeout(() => {
      programado = null;
      empujar();
    }, RETARDO_EMPUJE_MS);
  };

  return eventos;
}

const CTX = { device_id: "tablet-salon", empleado_id: "usr-mesero", sucursal_id: "suc-1" };

/** Un evento cualquiera nacido en esta terminal: sin `seq`, como todos. */
function nacidoAqui(tipo: string): EventoBase {
  return new FabricaEventos<EventoBase & { tipo: string }>(CTX).crear(
    tipo as never,
    "stream-1",
    {} as never,
  );
}

/** Lo que llega del Hub ya viene numerado. */
function venidoDelHub(tipo: string, seq: number): EventoBase {
  return { ...nacidoAqui(tipo), seq };
}

describe("todo lo que se anota sale de la terminal", () => {
  let guardados: EventoBase[];
  let empujones: number;
  let almacen: { anexar: (e: readonly EventoBase[]) => Promise<void> };

  beforeEach(() => {
    vi.useFakeTimers();
    guardados = [];
    empujones = 0;
    almacen = {
      anexar: async (lote) => {
        guardados.push(...lote);
      },
    };
    conEmpujeAutomatico(almacen, () => {
      empujones += 1;
    });
  });

  /*
   * LA PRUEBA QUE IMPORTA. Trece familias distintas, ninguna de comandas. Antes,
   * las trece se guardaban y ninguna salía.
   */
  it.each([
    "checada_registrada",
    "caja_abierta",
    "caja_cerrada",
    "egreso_registrado",
    "traspaso_registrado",
    "movimiento_inventario",
    "orden_compra_creada",
    "cliente_registrado",
    "tarifa_asignada",
    "opinion_registrada",
    "reserva_confirmada",
    "socio_registrado",
    "cfdi_timbrado",
    "usuario_creado",
  ])("un %s se manda solo, sin tocar una comanda", async (tipo) => {
    await almacen.anexar([nacidoAqui(tipo)]);

    expect(guardados).toHaveLength(1);
    expect(empujones).toBe(0); // todavía no: se agrupa

    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS);
    expect(empujones).toBe(1);
  });

  /*
   * Un cobro escribe varios eventos seguidos. Sin agrupar saldrían tres mensajes
   * en el mismo suspiro, y con doce tabletas eso es ruido que no compra nada.
   */
  it("una ráfaga de eventos sale en un solo empujón", async () => {
    await almacen.anexar([nacidoAqui("pago_registrado")]);
    await almacen.anexar([nacidoAqui("orden_cerrada")]);
    await almacen.anexar([nacidoAqui("movimiento_inventario")]);

    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS);

    expect(guardados).toHaveLength(3);
    expect(empujones).toBe(1);
  });

  /*
   * EL LAZO QUE HABRÍA QUE EVITAR. Lo que llega del Hub trae `seq`; devolvérselo
   * sería un ida y vuelta perpetuo entre dos terminales encendidas.
   */
  it("lo que llega del Hub NO se reenvía", async () => {
    await almacen.anexar([venidoDelHub("orden_creada", 41), venidoDelHub("item_agregado", 42)]);

    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS * 5);

    expect(guardados).toHaveLength(2);
    expect(empujones).toBe(0);
  });

  /* Un lote mezclado sí sale: dentro va algo que nació aquí. */
  it("un lote mezclado empuja una vez", async () => {
    await almacen.anexar([venidoDelHub("orden_creada", 43), nacidoAqui("checada_registrada")]);

    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS);
    expect(empujones).toBe(1);
  });

  /* Dos ráfagas separadas son dos empujones: la segunda no se queda dentro. */
  it("después de empujar, la siguiente ráfaga vuelve a empujar", async () => {
    await almacen.anexar([nacidoAqui("checada_registrada")]);
    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS);
    expect(empujones).toBe(1);

    await almacen.anexar([nacidoAqui("caja_cerrada")]);
    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS);
    expect(empujones).toBe(2);
  });

  /* Anexar un lote vacío no despierta a nadie. */
  it("un lote vacío no empuja", async () => {
    await almacen.anexar([]);
    await vi.advanceTimersByTimeAsync(RETARDO_EMPUJE_MS * 5);
    expect(empujones).toBe(0);
  });
});

/**
 * EL CABLE, leyendo el archivo de verdad.
 *
 * Lo de arriba prueba la conducta sobre una réplica, y una réplica no puede
 * demostrar que el arranque la use — que es exactamente lo que faltaba antes: la
 * lógica de empujar existía, y no estaba conectada. Es el mismo motivo por el que
 * la prueba del enlace en caliente del Hub lee `main.ts` como texto.
 */
describe("el arranque envuelve el almacén de verdad", () => {
  const fuente = readFileSync(
    new URL("../persistencia/arranque.svelte.ts", import.meta.url),
    "utf8",
  );

  it("el almacén pasa por conEmpujeAutomatico al iniciar", () => {
    expect(fuente).toMatch(/this\.almacen = conEmpujeAutomatico\(this\.almacen\)/);
  });

  it("y esa función envuelve anexar, no otra cosa", () => {
    expect(fuente).toMatch(/almacen\.eventos\.anexar = async/);
    expect(fuente).toMatch(/e\.seq === undefined/);
  });

  /*
   * Las dos omisiones que iban con esto. `reserva_confirmada` faltaba en el
   * filtro —y como el mismo filtro rige la hidratación, ni el F5 lo arreglaba— y
   * el reparto en vivo no tenía rama fiscal, así que un CFDI recién timbrado se
   * guardaba sin pintarse.
   */
  it("reserva_confirmada está en el filtro de reservas", () => {
    expect(fuente).toMatch(/"reserva_confirmada"/);
  });

  it("el reparto en vivo tiene rama fiscal", () => {
    expect(fuente).toMatch(/fiscal\.integrar\(/);
  });
});
