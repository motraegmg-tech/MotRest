/**
 * El descuento que pone quien cobra, y cómo se deshace.
 *
 * Dos huecos que dolían en el local. El primero: solo se podía rebajar por
 * PORCENTAJE, así que un «quítale 150 por la espera» obligaba a calcular a mano
 * qué porcentaje era eso y el ticket acababa diciendo una cifra distinta de la
 * que se le había prometido al comensal. El segundo: la barra solo sabía retirar
 * descuentos venidos de una promoción —filtraba por `promocion_id`—, así que un
 * 25 % pulsado por error no se podía deshacer más que cancelando la cuenta
 * entera y recapturándola delante de la mesa.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { pesos, totalesComanda } from "@motrest/dominio";
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

/** Dos platillos, para que el descuento de cuenta tenga que prorratearse. */
async function cuentaEn(mesaId: string): Promise<void> {
  pos.seleccionarMesa(mesaId);
  pos.abrirMesa(mesaId);
  await pos.agregarSimple(productoVendible());
  await pos.agregarSimple(productoVendible());
}

beforeAll(async () => {
  await arranque.iniciar();
  // Propietario: autoriza cualquier acción, así que el descuento no se queda
  // esperando el PIN de nadie y la prueba ejercita el camino completo.
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("un descuento de monto fijo", () => {
  it("rebaja exactamente lo tecleado y queda firmado por quien lo aplicó", async () => {
    const mesa = plano.todasLasMesas[0]!.id;
    await cuentaEn(mesa);

    const antes = totalesComanda(pos.comanda!);
    const rebaja = pesos(50);
    expect(antes.total).toBeGreaterThan(rebaja);

    await pos.aplicarDescuentoMonto(rebaja, "Se tardó el platillo");

    const despues = totalesComanda(pos.comanda!);
    // Al centavo, no «alrededor de»: es dinero y sale en el papel del cliente.
    expect(despues.descuentos).toBe(rebaja);
    expect(despues.total).toBeLessThan(antes.total);

    const puestos = pos.descuentosManuales;
    expect(puestos).toHaveLength(1);
    expect(puestos[0]).toMatchObject({
      modo: "monto",
      valor: rebaja,
      importe: rebaja,
      motivo: "Se tardó el platillo",
    });

    /*
     * NUNCA COMO «SISTEMA». Un evento que saca dinero del negocio tiene que
     * decir quién respondió por él, o la bitácora no sirve para nada.
     */
    const registrado = pos.comanda!.descuentos[0]!;
    expect(registrado.autorizador_id).toBe("usr-gonzalo");
  });

  it("no se aplica si el monto no es positivo", async () => {
    const mesa = plano.todasLasMesas[2]!.id;
    await cuentaEn(mesa);

    await pos.aplicarDescuentoMonto(pesos(0), "Nada");
    expect(pos.descuentosManuales).toHaveLength(0);
  });
});

describe("quitar un descuento puesto a mano", () => {
  it("devuelve la cuenta a su total, sin cancelarla", async () => {
    const mesa = plano.todasLasMesas[1]!.id;
    await cuentaEn(mesa);

    const original = totalesComanda(pos.comanda!).total;
    await pos.aplicarDescuento(0.25, "Descuento de 25%");
    expect(totalesComanda(pos.comanda!).total).toBeLessThan(original);

    const puesto = pos.descuentosManuales[0]!;
    expect(puesto.modo).toBe("porcentaje");
    /*
     * El porcentual NO trae importe en pesos, y es a propósito: lo que rebaja
     * se prorratea entre los renglones vivos al calcular los totales y no
     * existe en ninguna parte como cifra suelta. La pantalla pinta el
     * porcentaje antes que inventar un importe.
     */
    expect(puesto.importe).toBeNull();

    pos.retirarDescuento(puesto.id);

    expect(pos.descuentosManuales).toHaveLength(0);
    expect(totalesComanda(pos.comanda!).total).toBe(original);
    expect(pos.comandaAbierta).toBe(true);
  });

  it("quita el que se le pide y deja el otro en su sitio", async () => {
    const mesa = plano.todasLasMesas[3]!.id;
    await cuentaEn(mesa);

    await pos.aplicarDescuentoMonto(pesos(30), "Vaso roto");
    await pos.aplicarDescuento(0.1, "Descuento de 10%");
    expect(pos.descuentosManuales).toHaveLength(2);

    const primero = pos.descuentosManuales[0]!;
    pos.retirarDescuento(primero.id);

    const quedan = pos.descuentosManuales;
    expect(quedan).toHaveLength(1);
    expect(quedan[0]!.id).not.toBe(primero.id);
    expect(quedan[0]!.motivo).toBe("Descuento de 10%");
  });
});
