/**
 * Cuánto historial se conserva, y qué se puede tirar sin romper nada.
 *
 * El restaurante ya podía ELEGIR la retención —la opción y su advertencia
 * llevaban tiempo en pantalla— pero nadie borraba: era un ajuste decorativo.
 * Esto es lo que decide qué se retira, y por eso lo que más importa probar no
 * es lo que se borra sino **lo que NO se borra**: una cuenta viva tirada por
 * vieja deja una mesa ocupada para siempre y sin forma de liberarla.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { FabricaEventos } from "../evento.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda } from "../comanda/reducers.js";
import { diasDeHistorial, ordenesPurgables } from "../comanda/retencion.js";
import { dineroDeComandas } from "../finanzas/flujo.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };
const f = () => new FabricaEventos<EventoComanda>(CTX);

const DIA = 86_400_000;
const MES = 30 * DIA;
const HOY = new Date("2026-09-12T20:00:00Z").getTime();

/** Una cuenta con el desenlace y la antigüedad que se le pidan. */
function cuenta(
  id: string,
  haceDias: number,
  desenlace: "cobrada" | "cancelada" | "abierta",
) {
  const cuando = HOY - haceDias * DIA;
  const eventos: EventoComanda[] = [
    { ...f().crear("orden_creada", id, { orden_id: id, mesa_id: "m1", abierta_ts: cuando }), ts: cuando },
    {
      ...f().crear("pago_registrado", id, { orden_id: id, monto: pesos(200), forma: "efectivo" }),
      ts: cuando,
    },
  ];

  if (desenlace === "cobrada") {
    eventos.push({ ...f().crear("cuenta_cerrada", id, { orden_id: id }), ts: cuando });
  }
  if (desenlace === "cancelada") {
    eventos.push({ ...f().crear("cuenta_cerrada", id, { orden_id: id }), ts: cuando });
    eventos.push({
      ...f().crear("venta_cancelada", id, {
        orden_id: id,
        motivo: "Se cobró de más",
        devoluciones: [{ forma: "efectivo", monto: pesos(200) }],
      }),
      ts: cuando,
    });
  }

  return proyectarComanda(eventos);
}

describe("qué se puede retirar del disco", () => {
  it("se va lo cobrado que ya pasó la ventana", () => {
    const viejas = [cuenta("vieja-1", 200, "cobrada"), cuenta("vieja-2", 150, "cobrada")];
    const { ordenes } = ordenesPurgables(viejas, 3, HOY);
    expect(ordenes.sort()).toEqual(["vieja-1", "vieja-2"]);
  });

  it("se queda lo que está DENTRO de la ventana", () => {
    // 3 meses son 90 días: una cuenta de hace 80 se conserva.
    const { ordenes } = ordenesPurgables([cuenta("reciente", 80, "cobrada")], 3, HOY);
    expect(ordenes).toEqual([]);
  });

  it("UNA CUENTA ABIERTA NO SE TOCA, por vieja que sea", () => {
    /*
     * Es la regla que evita el peor daño posible. Un turno que nadie cerró deja
     * mesas abiertas durante días —le pasa a Rodizio— y borrarlas por antiguas
     * dejaría la mesa ocupada para siempre, sin cuenta que cobrar ni forma de
     * liberarla desde ninguna pantalla.
     */
    const { ordenes } = ordenesPurgables([cuenta("olvidada", 400, "abierta")], 3, HOY);
    expect(ordenes).toEqual([]);
  });

  it("una venta cancelada sí se retira: también está terminada", () => {
    const { ordenes } = ordenesPurgables([cuenta("cancelada", 200, "cancelada")], 3, HOY);
    expect(ordenes).toEqual(["cancelada"]);
  });

  it("a más retención, menos se tira", () => {
    const historial = [
      cuenta("de-4-meses", 4 * 30, "cobrada"),
      cuenta("de-8-meses", 8 * 30, "cobrada"),
      cuenta("de-18-meses", 18 * 30, "cobrada"),
    ];
    expect(ordenesPurgables(historial, 3, HOY).ordenes).toHaveLength(3);
    expect(ordenesPurgables(historial, 6, HOY).ordenes).toHaveLength(2);
    expect(ordenesPurgables(historial, 12, HOY).ordenes).toHaveLength(1);
    expect(ordenesPurgables(historial, 24, HOY).ordenes).toHaveLength(0);
  });

  it("una retención por debajo del mínimo NO borra nada", () => {
    /*
     * Ante la duda, conservar. Un valor absurdo —un ajuste corrupto, un dato
     * venido de otra versión— no puede convertirse en un borrado masivo.
     */
    const historial = [cuenta("vieja", 400, "cobrada")];
    expect(ordenesPurgables(historial, 1, HOY).ordenes).toEqual([]);
    expect(ordenesPurgables(historial, 0, HOY).ordenes).toEqual([]);
    expect(ordenesPurgables(historial, Number.NaN, HOY).ordenes).toEqual([]);
  });

  it("dice hasta qué fecha se limpió", () => {
    const { hasta } = ordenesPurgables(
      [cuenta("a", 200, "cobrada"), cuenta("b", 120, "cobrada")],
      3,
      HOY,
    );
    // La más reciente de las que se van: la de 120 días.
    expect(hasta).toBe(HOY - 120 * DIA);
  });

  it("sin nada guardado no revienta", () => {
    expect(ordenesPurgables([], 3, HOY)).toEqual({ ordenes: [], hasta: 0 });
  });
});

describe("cuántos días de historial hay", () => {
  it("cuenta desde la cuenta más vieja", () => {
    const historial = [cuenta("a", 45, "cobrada"), cuenta("b", 10, "cobrada")];
    expect(diasDeHistorial(historial, HOY)).toBe(45);
  });

  it("sin historial, cero", () => {
    expect(diasDeHistorial([], HOY)).toBe(0);
  });
});

describe("la ventana se mide desde el DESENLACE", () => {
  it("una mesa larga cuenta por el día en que se cobró", () => {
    /*
     * Una cuenta que abrió el 1 y se cobró el 2 pertenece al historial del 2:
     * es el día en que el dinero entró y contra el que se cuadró la caja.
     */
    const id = "larga";
    const abierta = HOY - 200 * DIA;
    const cobrada = HOY - 10 * DIA;
    const comanda = proyectarComanda([
      { ...f().crear("orden_creada", id, { orden_id: id, mesa_id: "m1", abierta_ts: abierta }), ts: abierta },
      { ...f().crear("cuenta_cerrada", id, { orden_id: id }), ts: cobrada },
    ]);

    // Abrió hace 200 días pero se cobró hace 10: se conserva.
    expect(ordenesPurgables([comanda], 3, HOY).ordenes).toEqual([]);
  });
});

describe("el dinero retirado no se cuenta dos veces", () => {
  /**
   * La regla que aplica el POS al purgar: solo aporta al arrastre lo que
   * todavía no estaba dentro de él.
   *
   * Existe por un camino real: si el Hub pierde historia —cambian el disco de
   * la caja, restauran un respaldo viejo, ponen otro Hub— la terminal vuelve a
   * pedirlo todo desde cero y las comandas ya retiradas REGRESAN. Al purgarlas
   * otra vez, su dinero se sumaría al arrastre que ya lo contenía.
   */
  const aportanAlArrastre = (comandas: ReturnType<typeof cuenta>[], yaArrastradoHasta: number) =>
    dineroDeComandas(
      comandas.filter((c) => (c.cancelada_ts ?? c.cerrada_ts ?? c.abierta_ts) > yaArrastradoHasta),
    );

  it("la primera purga arrastra todo lo que se lleva", () => {
    const viejas = [cuenta("v-1", 200, "cobrada"), cuenta("v-2", 150, "cobrada")];
    expect(aportanAlArrastre(viejas, 0).efectivo).toBe(pesos(400));
  });

  it("las mismas cuentas de vuelta del Hub NO vuelven a aportar", () => {
    const viejas = [cuenta("v-1", 200, "cobrada"), cuenta("v-2", 150, "cobrada")];
    const { hasta } = ordenesPurgables(viejas, 3, HOY);

    // Segunda purga de lo mismo: su dinero ya está dentro del arrastre.
    expect(aportanAlArrastre(viejas, hasta).efectivo).toBe(pesos(0));
  });

  it("pero una cuenta MÁS NUEVA que lo ya arrastrado sí aporta", () => {
    /*
     * Es lo que evita pasarse de listo y dejar de arrastrar para siempre: el
     * plazo avanza, y la purga del mes que viene se lleva cuentas que la
     * anterior no tocó.
     */
    const viejas = [cuenta("v-1", 200, "cobrada"), cuenta("v-2", 150, "cobrada")];
    const { hasta } = ordenesPurgables(viejas, 3, HOY);
    const nueva = cuenta("v-3", 100, "cobrada");

    expect(aportanAlArrastre([...viejas, nueva], hasta).efectivo).toBe(pesos(200));
  });
});
