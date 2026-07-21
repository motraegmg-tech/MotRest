/**
 * Verifica que la semilla del salón se ejecute de verdad (que no truene al
 * cargar el POS) y que las cifras visibles sigan cuadrando tras la migración a
 * centavos: la mesa 12 del mockup P1 debe dar $598.56.
 */
import { describe, expect, it } from "vitest";
import {
  FabricaEventos,
  pesos,
  proyectarComanda,
  renglonesActivos,
  tieneEnviados,
  totalesComanda,
  type EventoComanda,
} from "@motrest/dominio";
import { catalogo, impuestos } from "../catalogo";
import { sembrarSalon, type OpcionesSemilla } from "../semilla";

function opciones(): OpcionesSemilla {
  return {
    catalogo,
    impuestoPorDefecto: impuestos[0]!,
    fabrica: new FabricaEventos<EventoComanda>({
      device_id: "dev-prueba",
      empleado_id: "emp-lucia",
      sucursal_id: "suc-rodizio-centro",
    }),
  };
}

describe("semilla del salón", () => {
  it("se ejecuta sin lanzar (todos los ids del catálogo existen)", () => {
    expect(() => sembrarSalon(opciones())).not.toThrow();
  });

  it("la mesa 12 cuadra en $598.56, igual que el mockup P1", () => {
    const logs = sembrarSalon(opciones());
    const t = totalesComanda(proyectarComanda(logs["mesa-12"]!));

    expect(t.subtotal).toBe(pesos(516));
    expect(t.iva).toBe(pesos(82.56));
    expect(t.total).toBe(pesos(598.56));
  });

  it("la mesa 12 trae los 4 renglones del mockup", () => {
    const logs = sembrarSalon(opciones());
    const estado = proyectarComanda(logs["mesa-12"]!);
    expect(renglonesActivos(estado)).toHaveLength(4);
    expect(estado.renglones[0]?.detalle).toBe("½ Margherita · ½ Pepperoni");
  });

  it("las mesas 4 y 10 quedan enviadas a cocina; la 12 no", () => {
    const logs = sembrarSalon(opciones());
    expect(tieneEnviados(proyectarComanda(logs["mesa-4"]!))).toBe(true);
    expect(tieneEnviados(proyectarComanda(logs["mesa-10"]!))).toBe(true);
    expect(tieneEnviados(proyectarComanda(logs["mesa-12"]!))).toBe(false);
  });

  it("las mesas sembradas cubren las del mockup y ninguna repite orden_id", () => {
    const logs = sembrarSalon(opciones());
    const sembradas = Object.keys(logs).sort();
    expect(sembradas).toEqual(
      ["mesa-1", "mesa-10", "mesa-11", "mesa-12", "mesa-3", "mesa-4", "mesa-5", "mesa-7", "mesa-8"].sort(),
    );

    const ordenes = Object.values(logs).map((log) => proyectarComanda(log).orden_id);
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  it("cada renglón nace con snapshot de precio, costo e impuesto", () => {
    const logs = sembrarSalon(opciones());
    for (const renglon of proyectarComanda(logs["mesa-12"]!).renglones) {
      expect(renglon.precio_unitario).toBeGreaterThan(0);
      expect(renglon.costo_unitario).toBeGreaterThanOrEqual(0);
      expect(renglon.impuesto.tasa_iva).toBe(0.16);
      expect(renglon.estado).toBe("capturado");
    }
  });
});

describe("catálogo en modo simple (ADR-16)", () => {
  it("el costo de cada variedad coincide con su receta opcional", () => {
    // Demuestra que la capa de recetas es consistente con el costo capturado,
    // aunque el costeo NO dependa de ella.
    for (const [, producto] of catalogo.productos) {
      if (!producto.receta_id) continue;
      const receta = catalogo.recetas.get(producto.receta_id)!;
      const suma = receta.ingredientes.reduce((a, i) => a + i.costo, 0);
      expect(producto.costo).toBe(suma);
    }
  });

  it("los productos simples funcionan sin receta alguna", () => {
    const agua = catalogo.productos.get("prod-agua")!;
    expect(agua.receta_id).toBeUndefined();
    expect(agua.costo).toBe(pesos(6));
    expect(agua.precio).toBe(pesos(38));
  });
});
