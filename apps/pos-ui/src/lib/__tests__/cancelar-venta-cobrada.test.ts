/**
 * La mesa que se quedó a medias, y cómo se arregla desde Finanzas.
 *
 * Reproduce la avería real de la mesa 8 de Rodizio (15/08/2026) con el POS
 * completo, no solo con el dominio: se cobra, se reabre, se cancelan los
 * renglones y la mesa queda ocupada con saldo negativo. Después se cancela la
 * venta —que es el botón nuevo— y se comprueba que la mesa se libera, el saldo
 * vuelve a cero y la venta desaparece del reporte del día.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cuentasCerradasEn, totalesComanda } from "@motrest/dominio";
import { catalogo } from "../catalogo";
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

/** Sienta la mesa, pide dos cosas y la cobra en efectivo. */
async function cobrarUnaMesa(mesaId: string): Promise<string> {
  pos.seleccionarMesa(mesaId);
  const ordenId = pos.abrirMesa(mesaId);
  await pos.agregarSimple(productoVendible());
  await pos.agregarSimple(productoVendible());
  await pos.cobrarTodo("efectivo");
  return ordenId;
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("los tickets cobrados en Finanzas", () => {
  it("lista lo que se cobró, de lo más reciente a lo más viejo", async () => {
    const mesa = plano.todasLasMesas[0]!.id;
    const ordenId = await cobrarUnaMesa(mesa);

    const ticket = pos.ticketsCobrados[0];
    expect(ticket?.orden_id).toBe(ordenId);
    expect(ticket?.pagos).toHaveLength(1);
  });

  /*
   * La mesa liberada sin consumo no es un ticket: no hubo cobro ni papel. Antes
   * de este filtro, cada mesa abierta por error habría ensuciado la lista con
   * una venta de cero pesos y un botón de cancelar que no hace nada.
   */
  it("no lista las mesas liberadas sin consumo", async () => {
    const mesa = plano.todasLasMesas[1]!.id;
    pos.seleccionarMesa(mesa);
    const ordenId = pos.abrirMesa(mesa);
    await pos.liberarMesa();

    expect(pos.estadoMesa(mesa)).toBe("libre");
    expect(pos.ticketsCobrados.some((t) => t.orden_id === ordenId)).toBe(false);
  });
});

describe("la avería de la mesa 8", () => {
  let mesa = "";
  let ordenId = "";

  it("cobrar, reabrir y cancelar los renglones deja saldo negativo y la mesa ocupada", async () => {
    mesa = plano.todasLasMesas[2]!.id;
    ordenId = await cobrarUnaMesa(mesa);
    const cobrado = totalesComanda(pos.comandaDeMesa(mesa)!).pagado;

    expect(await pos.reabrirCuenta("mal cobrado")).toBe(true);
    for (const renglon of [...pos.renglones]) await pos.cancelar(renglon.id);

    const rota = pos.comandaDeMesa(mesa)!;
    const t = totalesComanda(rota);
    expect(t.total).toBe(0);
    expect(t.saldo).toBe(-cobrado);
    expect(rota.cerrada).toBe(false);
    // Y por eso la mesa no se puede dar a nadie más.
    expect(pos.estadoMesa(mesa)).not.toBe("libre");
  });

  /*
   * La cuenta rota TIENE que aparecer en la lista de Finanzas aunque esté
   * abierta: es exactamente el ticket que hay que encontrar. Filtrar la lista
   * por «cerrada» la habría escondido justo cuando hace falta verla.
   */
  it("aparece en los tickets cobrados aunque esté abierta", () => {
    expect(pos.ticketsCobrados.some((t) => t.orden_id === ordenId)).toBe(true);
  });

  it("cancelar la venta libera la mesa y deja el saldo en cero", async () => {
    expect(await pos.cancelarVenta(ordenId, "Se cobró la mesa equivocada")).toBe(true);

    const arreglada = pos.comandaDeMesa(mesa)!;
    expect(arreglada.cancelada).toBe(true);
    expect(totalesComanda(arreglada).saldo).toBe(0);
    expect(pos.estadoMesa(mesa)).toBe("libre");
  });

  it("la venta cancelada sale del reporte del día", () => {
    const enReportes = cuentasCerradasEn(pos.todasLasComandas).map((c) => c.orden_id);
    expect(enReportes).not.toContain(ordenId);
  });

  it("no se puede cancelar dos veces", async () => {
    expect(await pos.cancelarVenta(ordenId, "Otra vez")).toBe(false);
  });

  it("exige un motivo: queda en la bitácora", async () => {
    const otra = plano.todasLasMesas[3]!.id;
    const orden = await cobrarUnaMesa(otra);
    expect(await pos.cancelarVenta(orden, "  ")).toBe(false);
    expect(pos.comandaDeMesa(otra)!.cancelada).toBeUndefined();
  });
});
