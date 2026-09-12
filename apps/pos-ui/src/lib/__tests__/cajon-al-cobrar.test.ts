/**
 * Cuándo se abre el cajón de efectivo, y sobre todo cuándo NO.
 *
 * Gonzalo pidió que el cajón se abriera solo al cobrar una cuenta, y eligió que
 * fuera **solo si hubo efectivo**. Esa es la regla que estas pruebas fijan,
 * porque es la que tiene consecuencias: un cajón que se abre en cada cobro con
 * tarjeta queda expuesto varias veces por servicio sin que nadie tenga nada que
 * meter ni sacar de él.
 *
 * Lo que se comprueba aquí es la DECISIÓN, no el hardware. Si de verdad sale el
 * pulso depende de que haya impresora de caja con cajón declarado y de que esta
 * terminal sea la caja; eso lo resuelve el store de impresión y tiene sus
 * propias pruebas.
 */
import { describe, expect, it } from "vitest";
import { esPagoEnEfectivo, type FormaPago } from "@motrest/dominio";

/**
 * La regla, tal como la aplica el POS al cerrar una cuenta pagada.
 *
 * Se mira pago por pago y no «la forma de la cuenta»: una mesa dividida entre
 * tarjeta y efectivo SÍ tiene billetes que guardar, y el cajero necesita el
 * cajón abierto igual que si todo hubiera sido en efectivo.
 */
const abreElCajon = (formas: FormaPago[]) => formas.some((f) => esPagoEnEfectivo(f));

describe("el cajón se abre solo si hubo efectivo", () => {
  it("cobro en efectivo: se abre", () => {
    expect(abreElCajon(["efectivo"])).toBe(true);
  });

  it("cobro con tarjeta: NO se abre", () => {
    // No hay billetes que guardar ni cambio que dar.
    expect(abreElCajon(["tarjeta_credito"])).toBe(false);
    expect(abreElCajon(["tarjeta_debito"])).toBe(false);
  });

  it("transferencia, vale y app: tampoco", () => {
    expect(abreElCajon(["transferencia"])).toBe(false);
    expect(abreElCajon(["vale"])).toBe(false);
    expect(abreElCajon(["agregador"])).toBe(false);
  });

  it("CUENTA DIVIDIDA con una parte en efectivo: sí se abre", () => {
    /*
     * El caso que un «¿cuál fue la forma de pago?» resolvería mal. Tres amigos,
     * uno paga con tarjeta y dos en efectivo: esos billetes hay que meterlos.
     */
    expect(abreElCajon(["tarjeta_credito", "efectivo"])).toBe(true);
    expect(abreElCajon(["efectivo", "transferencia", "vale"])).toBe(true);
  });

  it("cuenta dividida sin nada de efectivo: no se abre", () => {
    expect(abreElCajon(["tarjeta_credito", "transferencia"])).toBe(false);
  });

  it("una cuenta sin pagos —una cortesía— no abre nada", () => {
    expect(abreElCajon([])).toBe(false);
  });

  it("el consumo de socio no es efectivo", () => {
    // Se le carga a su bolsa y se cobra a fin de mes: no entra dinero hoy.
    expect(abreElCajon(["socio"])).toBe(false);
  });
});
