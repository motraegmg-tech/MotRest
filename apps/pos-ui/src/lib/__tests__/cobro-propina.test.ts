import { beforeAll, describe, expect, it } from "vitest";
import { pesos, totalesComanda } from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { impresion } from "../impresion.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

function productoVendible(): string {
  const producto = [...catalogo.productos.values()].find((p) => p.disponible && p.precio > 0);
  if (!producto) throw new Error("La carta de prueba no tiene productos vendibles");
  return producto.id;
}

async function cuentaEn(mesaId: string): Promise<string> {
  pos.seleccionarMesa(mesaId);
  const ordenId = pos.abrirMesa(mesaId);
  await pos.agregarSimple(productoVendible());
  return ordenId;
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion(
    "usr-gonzalo",
    credencialesDeDemostracion().contrasena,
  );
});

describe("el cierre que espera la decisión de propina", () => {
  it("libera la mesa y asienta monto y medio antes de imprimir el interno", async () => {
    const mesa = plano.todasLasMesas[0]!.id;
    const ordenId = await cuentaEn(mesa);
    const total = pos.totales!.total;

    await pos.cobrarTodo("efectivo");

    expect(pos.comanda?.cerrada).toBe(true);
    expect(pos.propinaPendiente).toEqual({ mesa_id: mesa, orden_id: ordenId });
    expect(pos.estadoMesa(mesa)).toBe("libre");

    expect(pos.resolverPropinaPosterior(pesos(50), "tarjeta_credito")).toBe(true);
    const cerrada = pos.comandaDeMesa(mesa)!;
    const totales = totalesComanda(cerrada);
    expect(totales.propina).toBe(pesos(50));
    expect(totales.saldo).toBe(0);
    expect(cerrada.pagos).toEqual([
      expect.objectContaining({ forma: "efectivo", monto: total }),
      expect.objectContaining({ forma: "tarjeta_credito", monto: pesos(50) }),
    ]);
    expect(pos.propinaPendiente).toBeNull();
    expect(impresion.trabajos.some((t) => t.documento === "ticket_interno")).toBe(true);
  });

  it("permite confirmar que no dejó propina", async () => {
    const mesa = plano.todasLasMesas[1]!.id;
    await cuentaEn(mesa);
    await pos.cobrarTodo("tarjeta_debito");

    expect(pos.propinaPendiente).not.toBeNull();
    expect(pos.resolverPropinaPosterior(pesos(0))).toBe(true);
    expect(pos.propinaPendiente).toBeNull();
    expect(pos.comandaDeMesa(mesa)?.propina).toBe(0);
  });
});

describe("cortesía total", () => {
  it("cierra con $0, libera la mesa e imprime cliente e interno", async () => {
    const mesa = plano.todasLasMesas[2]!.id;
    await cuentaEn(mesa);
    await pos.alternarCortesia(undefined, "Cortesía de la casa");
    expect(pos.totales?.total).toBe(0);
    const antes = impresion.trabajos.length;

    await pos.cobrarTodo("efectivo");

    expect(pos.comanda?.cerrada).toBe(true);
    expect(pos.comanda?.pagos).toHaveLength(0);
    expect(pos.estadoMesa(mesa)).toBe("libre");
    expect(pos.propinaPendiente).toBeNull();
    const documentos = impresion.trabajos.slice(antes).map((t) => t.documento);
    expect(documentos).toContain("precuenta");
    expect(documentos).toContain("ticket_interno");
  });
});
