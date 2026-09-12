/**
 * El cajón de efectivo: el pulso y cuándo NO se reintenta.
 *
 * ## Cómo se abre un cajón, para quien venga después
 *
 * El cajón no está conectado a la computadora: cuelga de la impresora de
 * tickets por un cable telefónico. Lo que se manda son cinco bytes ESC/POS
 * —`ESC p m t1 t2`— que le dicen a la impresora que cierre ese contacto unos
 * milisegundos, y el solenoide del cajón lo empuja.
 */
import { describe, expect, it } from "vitest";
import { ColaImpresion, Ticket, TransporteSimulado } from "../index.js";
import type { Impresora, ResultadoEnvio, Transporte } from "../index.js";

const CAJA: Impresora = {
  id: "imp-caja",
  nombre: "Caja",
  conexion: "red",
  host: "192.168.1.60",
  puerto: 9100,
  ancho: 42,
  areas: ["caja"],
  corta: true,
  cajon: true,
  activa: true,
};

describe("el pulso que abre el cajón", () => {
  it("termina con los cinco bytes del estándar", () => {
    const bytes = [...new Ticket(42).abrirCajon().construir()];

    /*
     * `ESC p` (0x1B 0x70), pin 0, y las dos duraciones del pulso en unidades
     * de 2 ms: 25 y 250. Es la combinación que acepta prácticamente toda
     * impresora térmica; pulsos más cortos no mueven el solenoide de algunos
     * cajones.
     *
     * Delante va la cabecera que el `Ticket` pone siempre —reiniciar la
     * impresora y fijar la tabla de caracteres—, que es inocua: ni imprime
     * ni avanza papel.
     */
    expect(bytes.slice(-5)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("NO corta el papel", () => {
    /*
     * Es lo que de verdad importa de este flujo. Un corte en cada cobro
     * escupiría un trozo de papel en blanco por cada cuenta: un rollo entero
     * a la basura cada servicio, y un cajero convencido de que la impresora
     * está estropeada.
     */
    const bytes = [...new Ticket(42).abrirCajon().construir()];
    const cortes = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x56);
    expect(cortes).toBe(-1);
  });

  it("es solo comandos: no arrastra un documento detrás", () => {
    /*
     * Diez bytes: cinco de la cabecera que el `Ticket` pone siempre y cinco
     * del pulso. Si algún día esto creciera sería porque alguien le colgó
     * contenido —una línea, un salto, un corte— y el cobro empezaría a
     * escupir papel en blanco.
     */
    expect(new Ticket(42).abrirCajon().construir()).toHaveLength(10);
  });
});

// --- La cola ------------------------------------------------------------------------------

/** Un transporte real que siempre falla, para ver qué hace la cola. */
class TransporteRoto implements Transporte {
  intentos = 0;
  puede(): boolean {
    return true;
  }
  async enviar(): Promise<ResultadoEnvio> {
    this.intentos += 1;
    return { ok: false, error: "La impresora no contesta" };
  }
}

describe("el cajón no se reintenta", () => {
  it("un pulso que falla se rinde a la primera", async () => {
    /*
     * Reintentar tiene sentido con un papel: sale tarde pero sale, y el ticket
     * sigue valiendo. Abrir un cajón es un acto FÍSICO en un sitio donde hay o
     * no hay alguien. Un pulso que se cuela un minuto después abre el cajón
     * cuando el cajero ya se fue a atender otra mesa, y lo deja abierto.
     */
    const roto = new TransporteRoto();
    const cola = new ColaImpresion([roto], () => {});

    cola.encolar({
      id: "t1",
      impresora_id: CAJA.id,
      documento: "cajon",
      datos: new Ticket(42).abrirCajon().construir(),
      vista: "",
    });
    await cola.procesar([CAJA]);

    expect(roto.intentos).toBe(1);
    expect(cola.fallidos).toHaveLength(1);
  });

  it("un ticket que falla SÍ se reintenta: el papel sigue valiendo", async () => {
    const roto = new TransporteRoto();
    const cola = new ColaImpresion([roto], () => {});

    cola.encolar({
      id: "t2",
      impresora_id: CAJA.id,
      documento: "ticket",
      datos: new Uint8Array([1, 2, 3]),
      vista: "",
    });
    await cola.procesar([CAJA]);

    // Sigue pendiente, esperando su turno de reintento.
    expect(cola.fallidos).toHaveLength(0);
    expect(cola.pendientes[0]?.intentos).toBe(1);
  });
});

describe("un transporte simulado no abre ningún cajón", () => {
  it("la cola sabe distinguir el que finge del que habla con el aparato", () => {
    /*
     * Es lo que impide marcar como abierto un cajón que nunca se abrió. Un
     * ticket simulado sigue sirviendo —se lee en pantalla—; un cajón simulado
     * no hizo absolutamente nada.
     */
    const soloSimulado = new ColaImpresion([new TransporteSimulado()], () => {});
    expect(soloSimulado.hayTransporteReal(CAJA)).toBe(false);

    const conReal = new ColaImpresion([new TransporteRoto(), new TransporteSimulado()], () => {});
    expect(conReal.hayTransporteReal(CAJA)).toBe(true);
  });
});
