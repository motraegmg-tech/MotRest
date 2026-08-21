/**
 * El transporte Bluetooth escribe al puerto COM directamente, sin spooler.
 *
 * Lo que de verdad se prueba aquí es que NUNCA diga que imprimió cuando no
 * imprimió. Ese es el fallo que costó cuatro días de comandas en Rodizio: el
 * camino por el spooler aceptaba los trabajos de una impresora que no estaba, y
 * el POS los cantaba como impresos.
 *
 * No hay forma de imprimir de verdad en una máquina de compilación —haría falta
 * una térmica Bluetooth emparejada—, así que lo que se comprueba es el
 * contrato: qué se rechaza antes de arrancar nada, y que un puerto que no
 * responde se reporte como fallo con el puerto por delante.
 */
import { describe, expect, it } from "vitest";
import { enviarABluetooth, esPuertoValido } from "../impresion/transporte-bluetooth.js";

const EN_WINDOWS = process.platform === "win32";
const TICKET = new Uint8Array([0x1b, 0x40, 0x48, 0x6f, 0x6c, 0x61, 0x0a, 0x1d, 0x56, 0x00]);

/*
 * Por encima del tiempo del propio transporte, por la misma razón que en
 * `transporte-usb.test.ts`: `enviarABluetooth` se rinde a los 15 s y el límite
 * por defecto de vitest son 5. Un límite por debajo del que se prueba no mide el
 * código, mide la máquina.
 */
const ESPERA_COM_MS = 25_000;

/** Un COM que no existe en ninguna máquina de compilación razonable. */
const PUERTO_INEXISTENTE = "COM231";

describe("validación del puerto", () => {
  it("acepta los puertos que Windows sí asigna", () => {
    expect(esPuertoValido("COM1")).toBe(true);
    expect(esPuertoValido("COM5")).toBe(true);
    expect(esPuertoValido("COM10")).toBe(true);
    expect(esPuertoValido("COM256")).toBe(true);
    // Windows los escribe en mayúsculas, pero nadie teclea así a las once de la
    // noche.
    expect(esPuertoValido("com4")).toBe(true);
    expect(esPuertoValido("  COM4  ")).toBe(true);
  });

  it("rechaza lo que no es un puerto", () => {
    expect(esPuertoValido("")).toBe(false);
    expect(esPuertoValido("COM")).toBe(false);
    expect(esPuertoValido("COM0")).toBe(false);
    expect(esPuertoValido("COM257")).toBe(false);
    // El bug que esto cierra: `startsWith("COM")` daba por bueno cualquier
    // palabra que empezara igual.
    expect(esPuertoValido("COMANDA")).toBe(false);
    expect(esPuertoValido("COM4 extra")).toBe(false);
    // Lo que Windows enseña en el administrador de dispositivos, pegado tal cual.
    expect(esPuertoValido("Serie estándar sobre el vínculo Bluetooth (COM4)")).toBe(false);
    // Una impresora de red mal puesta en el campo de Bluetooth.
    expect(esPuertoValido("192.168.100.60")).toBe(false);
  });
});

describe("lo que se rechaza antes de arrancar PowerShell", () => {
  it("un puerto inválido no llega a abrir un proceso", async () => {
    const r = await enviarABluetooth("COMANDA", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no es un puerto COM");
  });

  it("dice el valor recibido, para poder corregirlo sin adivinar", async () => {
    const r = await enviarABluetooth("COM4)", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("COM4)");
  });
});

describe.runIf(EN_WINDOWS)("envío al puerto COM", () => {
  /*
   * LA PRUEBA QUE JUSTIFICA TODO EL TRANSPORTE.
   *
   * Una impresora Bluetooth ausente tiene que ser un fallo AHORA. Por el camino
   * viejo —cola de Windows sobre el COM— esto habría devuelto éxito: el spooler
   * acepta el trabajo, lo encola, y la comanda no sale nunca.
   */
  it("un puerto que no existe es un fallo, no un éxito", async () => {
    const r = await enviarABluetooth(PUERTO_INEXISTENTE, TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }, ESPERA_COM_MS);

  it("nombra el puerto en el error, para saber cuál revisar", async () => {
    const r = await enviarABluetooth(PUERTO_INEXISTENTE, TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(PUERTO_INEXISTENTE);
  }, ESPERA_COM_MS);

  /*
   * Un puerto con comillas es un puerto con comillas, no un comando.
   *
   * La validación lo ataja antes de arrancar nada, que es la defensa que se
   * quiere: el mensaje CITA el valor recibido —para eso está— así que buscar la
   * palabra inyectada en el texto no prueba nada. Lo que prueba que no se
   * ejecutó es que el fallo sea el del filtro y no el de un puerto que se
   * intentó abrir.
   */
  it("no deja que un puerto se convierta en un comando", async () => {
    const r = await enviarABluetooth('COM4"; echo INYECTADO #', TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no es un puerto COM");
  });
});

describe.runIf(!EN_WINDOWS)("fuera de Windows", () => {
  it("lo dice en vez de fingir que imprimió", async () => {
    const r = await enviarABluetooth("COM4", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("solo está disponible en Windows");
  });
});
