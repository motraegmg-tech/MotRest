/**
 * La cortesía por producto (sep-2026).
 *
 * Antes el botón «Cortesía» regalaba la cuenta entera o nada. Gonzalo pidió
 * poder elegir QUÉ se regala —y de un renglón de varias piezas, cuántas— para
 * llevar el control de qué se puede regalar y qué no. La ventana entrega su
 * selección a `pos.fijarCortesias`, que emite solo la diferencia con lo puesto.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cortesiaDeRenglon, totalesComanda } from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

function vendibles(): string[] {
  const productos = [...catalogo.productos.values()].filter((p) => p.disponible && p.precio > 0);
  if (productos.length < 2) throw new Error("La carta de prueba no tiene dos productos vendibles");
  return [productos[0]!.id, productos[1]!.id];
}

/** Dos renglones distintos en la mesa: el que se regala y el que se cobra. */
async function cuentaEn(indiceMesa: number) {
  const mesa = plano.todasLasMesas[indiceMesa]!.id;
  pos.seleccionarMesa(mesa);
  pos.abrirMesa(mesa);
  const [a, b] = vendibles();
  await pos.agregarSimple(a!);
  await pos.agregarSimple(b!);
  const [primero, segundo] = pos.renglones;
  return { primero: primero!, segundo: segundo! };
}

beforeAll(async () => {
  await arranque.iniciar();
  // Propietario: autoriza cualquier acción, así que la cortesía no espera el PIN de nadie.
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("regalar solo algunos productos", () => {
  it("regala el renglón elegido y cobra el otro", async () => {
    const { primero, segundo } = await cuentaEn(0);
    const antes = totalesComanda(pos.comanda!);

    const ok = await pos.fijarCortesias(
      { toda: false, renglones: [{ renglon_id: primero.id, cantidad: primero.cantidad }] },
      "Cumpleaños",
    );
    expect(ok).toBe(true);

    const cortesias = pos.comanda!.cortesias;
    expect(cortesias).toHaveLength(1);
    expect(cortesias[0]).toMatchObject({ renglon_id: primero.id, motivo: "Cumpleaños" });
    // Todas las piezas = el renglón entero, sin `cantidad`.
    expect(cortesias[0]!.cantidad).toBeUndefined();
    // Nunca como «sistema»: queda quién respondió por el regalo.
    expect(cortesias[0]!.autorizador_id).toBe("usr-gonzalo");

    const t = totalesComanda(pos.comanda!);
    expect(t.cortesias).toBe(cortesiaDeRenglon(pos.comanda!, primero));
    expect(t.cortesias).toBeGreaterThan(0);
    expect(t.total).toBeLessThan(antes.total);
    expect(cortesiaDeRenglon(pos.comanda!, segundo)).toBe(0);
  });

  it("de un renglón de tres piezas regala solo las que se digan", async () => {
    const { primero } = await cuentaEn(1);
    await pos.cambiarCantidad(primero.id, 2);
    const renglon = pos.renglones.find((r) => r.id === primero.id)!;
    expect(renglon.cantidad).toBe(3);

    await pos.fijarCortesias({ toda: false, renglones: [{ renglon_id: renglon.id, cantidad: 1 }] }, "x");

    expect(pos.comanda!.cortesias[0]!.cantidad).toBe(1);
    const regalado = cortesiaDeRenglon(pos.comanda!, renglon);
    const entero = cortesiaDeRenglon({ ...pos.comanda!, cortesias: [{ motivo: "x" }] }, renglon);
    expect(Math.abs(regalado * 3 - entero)).toBeLessThanOrEqual(2);
  });

  it("aplicar otra vez lo mismo no repite la cortesía", async () => {
    const { primero } = await cuentaEn(2);
    const eleccion = { toda: false as const, renglones: [{ renglon_id: primero.id, cantidad: 1 }] };
    await pos.fijarCortesias(eleccion, "x");
    /*
     * Se cuentan los eventos de la mesa, que es lo que llega a la bitácora. La
     * comanda se proyecta en cada lectura, así que compararla no diría nada.
     */
    const eventosDeLaMesa = () =>
      (pos as unknown as { logs: Record<string, readonly unknown[]> }).logs[pos.mesaActiva]!.length;
    const antes = eventosDeLaMesa();
    expect(await pos.fijarCortesias(eleccion, "x")).toBe(true);
    expect(eventosDeLaMesa()).toBe(antes);
    expect(pos.comanda!.cortesias).toHaveLength(1);
  });

  it("pasar a toda la cuenta retira las de producto", async () => {
    const { primero, segundo } = await cuentaEn(3);
    await pos.fijarCortesias(
      {
        toda: false,
        renglones: [
          { renglon_id: primero.id, cantidad: 1 },
          { renglon_id: segundo.id, cantidad: 1 },
        ],
      },
      "x",
    );
    expect(pos.comanda!.cortesias).toHaveLength(2);

    await pos.fijarCortesias({ toda: true }, "Invitación");
    const cortesias = pos.comanda!.cortesias;
    expect(cortesias).toHaveLength(1);
    expect(cortesias[0]!.renglon_id).toBeUndefined();
    expect(totalesComanda(pos.comanda!).total).toBe(0);
  });

  it("sin nada marcado se retira toda la cortesía", async () => {
    const { primero } = await cuentaEn(4);
    const original = totalesComanda(pos.comanda!).total;
    await pos.fijarCortesias({ toda: false, renglones: [{ renglon_id: primero.id, cantidad: 1 }] }, "x");
    await pos.fijarCortesias({ toda: false, renglones: [] }, "x");
    expect(pos.comanda!.cortesias).toHaveLength(0);
    expect(totalesComanda(pos.comanda!).total).toBe(original);
  });
});
