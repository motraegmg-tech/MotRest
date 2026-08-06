/**
 * El Hub recibiendo pedidos del kiosco.
 *
 * Quien habla con estas rutas es una tablet montada en la pared de un
 * restaurante: un aparato al que cualquiera puede llegar y que nadie vigila. Lo
 * que se prueba aquí es qué pasa cuando esa tablet miente.
 */
import { describe, expect, it, vi } from "vitest";
import { registrarPedido, type DepsKiosco, type PlatilloDeKiosco } from "../kiosco.js";

const CARTA: PlatilloDeKiosco[] = [
  { id: "p-margarita", nombre: "Margarita", precio: 24_900, categoria: "Pizzas" },
  { id: "p-agua", nombre: "Agua", precio: 3_500, categoria: "Bebidas" },
];

function deps(publicar = vi.fn()): DepsKiosco & { publicar: ReturnType<typeof vi.fn> } {
  return {
    carta: () => CARTA,
    consecutivo: () => 41,
    sucursal_id: () => "suc-rodizio",
    publicar,
  };
}

describe("un pedido normal", () => {
  it("entra y devuelve un número que se pueda gritar", () => {
    const d = deps();
    const r = registrarPedido(
      { modalidad: "comer_aqui", renglones: [{ producto_id: "p-margarita", cantidad: 2 }] },
      d,
    );

    expect(r.ok).toBe(true);
    expect(r.ok && (r.datos as { folio: string }).folio).toBe("042");
    expect(d.publicar).toHaveBeenCalledOnce();
  });

  /*
   * EL CANDADO QUE JUSTIFICA EL ARCHIVO. Si el importe viniera de la tablet,
   * cambiar un número en su navegador sería pedir una pizza a un peso. El precio
   * se recalcula SIEMPRE contra la carta del Hub.
   */
  it("el precio sale de la carta del Hub, no de lo que mandó la tablet", () => {
    const d = deps();
    registrarPedido(
      {
        renglones: [
          { producto_id: "p-margarita", cantidad: 1, precio_unitario: 1 } as never,
        ],
      },
      d,
    );

    const eventos = d.publicar.mock.calls[0]![0] as { precio_unitario?: number }[];
    const item = eventos.find((e) => e.precio_unitario !== undefined)!;
    expect(item.precio_unitario).toBe(24_900);
  });

  it("queda constancia de que lo pidió el kiosco y no un mesero", () => {
    const d = deps();
    registrarPedido({ renglones: [{ producto_id: "p-agua", cantidad: 1 }] }, d);

    const eventos = d.publicar.mock.calls[0]![0] as { empleado_id: string }[];
    expect(eventos.every((e) => e.empleado_id === "kiosco")).toBe(true);
  });

  it("para llevar se distingue de comer aquí", () => {
    const d = deps();
    registrarPedido(
      { modalidad: "para_llevar", renglones: [{ producto_id: "p-agua", cantidad: 1 }] },
      d,
    );
    const apertura = (d.publicar.mock.calls[0]![0] as { canal?: string }[])[0]!;
    expect(apertura.canal).toBe("para_llevar");
  });
});

describe("cuando la tablet manda basura", () => {
  it("un pedido vacío no entra", () => {
    const d = deps();
    expect(registrarPedido({ renglones: [] }, d).ok).toBe(false);
    expect(registrarPedido({}, d).ok).toBe(false);
    expect(d.publicar).not.toHaveBeenCalled();
  });

  /*
   * Un platillo que ya no está se RECHAZA, no se ignora. Ignorarlo dejaría pasar
   * un pedido incompleto que el comensal ya pagó y que en cocina sale distinto
   * de lo que pidió.
   */
  it("un platillo que no está en la carta tumba el pedido entero", () => {
    const d = deps();
    const r = registrarPedido(
      {
        renglones: [
          { producto_id: "p-agua", cantidad: 1 },
          { producto_id: "p-inventado", cantidad: 1 },
        ],
      },
      d,
    );

    expect(r.ok).toBe(false);
    expect(d.publicar).not.toHaveBeenCalled();
  });

  /* Una tablet manipulada no debe poder tumbar la cocina ni llenar el registro. */
  it("no admite cantidades absurdas ni pedidos infinitos", () => {
    const d = deps();
    expect(registrarPedido({ renglones: [{ producto_id: "p-agua", cantidad: 9999 }] }, d).ok).toBe(false);
    expect(registrarPedido({ renglones: [{ producto_id: "p-agua", cantidad: 0 }] }, d).ok).toBe(false);
    expect(registrarPedido({ renglones: [{ producto_id: "p-agua", cantidad: -3 }] }, d).ok).toBe(false);

    const muchos = Array.from({ length: 100 }, () => ({ producto_id: "p-agua", cantidad: 1 }));
    expect(registrarPedido({ renglones: muchos }, d).ok).toBe(false);
  });

  it("cantidades con decimales se redondean o se rechazan, nunca se cuelan", () => {
    const d = deps();
    const r = registrarPedido({ renglones: [{ producto_id: "p-agua", cantidad: 2.7 }] }, d);
    expect(r.ok).toBe(true);
    const eventos = d.publicar.mock.calls[0]![0] as { cantidad?: number }[];
    expect(eventos.find((e) => e.cantidad !== undefined)!.cantidad).toBe(2);
  });
});
