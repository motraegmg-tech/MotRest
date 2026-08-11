/**
 * El transporte USB entrega los bytes al spooler de Windows y, sobre todo, no
 * deja que el nombre de una impresora se convierta en un comando.
 *
 * Los envíos de verdad se prueban contra «OneNote (Desktop)», que en Windows
 * escribe al puerto `nul:`: recorre el camino entero —PowerShell, winspool,
 * RAW— sin gastar papel. Donde esa impresora no exista, esas pruebas se saltan
 * solas en vez de fallar por el entorno.
 */
import { describe, expect, it } from "vitest";
import { enviarAUsb, esDispositivoValido, impresorasDelSistema } from "../impresion/transporte-usb.js";

const EN_WINDOWS = process.platform === "win32";
const TICKET = new Uint8Array([0x1b, 0x40, 0x48, 0x6f, 0x6c, 0x61, 0x0a, 0x1d, 0x56, 0x00]);

describe("validación del nombre de impresora", () => {
  it("acepta los nombres que Windows sí usa", () => {
    expect(esDispositivoValido("BIXOLON SRP-350plus")).toBe(true);
    expect(esDispositivoValido("Caja")).toBe(true);
    expect(esDispositivoValido("Impresora de Cocina (80mm)")).toBe(true);
  });

  it("rechaza lo que Windows nunca admite en el nombre de una cola", () => {
    expect(esDispositivoValido("")).toBe(false);
    expect(esDispositivoValido("ruta\\con\\barras")).toBe(false);
    expect(esDispositivoValido("con,coma")).toBe(false);
    expect(esDispositivoValido("con!admiracion")).toBe(false);
    expect(esDispositivoValido("salto\nde linea")).toBe(false);
    expect(esDispositivoValido("x".repeat(221))).toBe(false);
  });
});

/*
 * MÁS TIEMPO QUE EL DEL PROPIO TRANSPORTE, Y POR ESO EXACTAMENTE.
 *
 * `enviarAUsb` se rinde a los 10 s, pero el límite por defecto de vitest son 5,
 * así que bajo carga —varias pruebas arrancando PowerShell a la vez— el corredor
 * mataba la prueba ANTES de que el transporte pudiera contestar y el fallo salía
 * intermitente, sin nada roto detrás. Un límite por debajo del que se está
 * probando no mide el código: mide la máquina.
 */
const ESPERA_SPOOLER_MS = 20_000;

describe.runIf(EN_WINDOWS)("envío al spooler", () => {
  /** ¿Está la impresora de pruebas en este equipo? */
  async function hayOneNote(): Promise<boolean> {
    const lista = await impresorasDelSistema();
    return lista.some((i) => i.nombre === "OneNote (Desktop)");
  }

  it("lista las impresoras del sistema", async () => {
    const lista = await impresorasDelSistema();
    expect(Array.isArray(lista)).toBe(true);
    for (const i of lista) {
      expect(typeof i.nombre).toBe("string");
      expect(i.nombre.length).toBeGreaterThan(0);
    }
  }, ESPERA_SPOOLER_MS);

  it("entrega un trabajo a una impresora instalada", async ({ skip }) => {
    if (!(await hayOneNote())) skip();
    const r = await enviarAUsb("OneNote (Desktop)", TICKET, "MotRest prueba");
    expect(r.ok).toBe(true);
  }, ESPERA_SPOOLER_MS);

  it("acepta un ticket largo: los bytes van por la entrada estándar", async ({ skip }) => {
    if (!(await hayOneNote())) skip();
    // 40 KB no caben en una línea de comandos de Windows. Si algún día alguien
    // mueve los datos a los argumentos, esta prueba lo caza.
    const r = await enviarAUsb("OneNote (Desktop)", new Uint8Array(40_000).fill(0x41));
    expect(r.ok).toBe(true);
  }, ESPERA_SPOOLER_MS);

  it("avisa cuando la impresora no existe, en vez de darla por impresa", async () => {
    const r = await enviarAUsb("Impresora Que No Existe MotRest", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("No existe una impresora");
  }, ESPERA_SPOOLER_MS);

  /*
   * La prueba que justifica el diseño: el nombre viaja por variable de entorno
   * y nunca se interpola en el guion. Si alguien lo pegara dentro del texto del
   * comando, esto ejecutaría lo inyectado y el resultado dejaría de ser un
   * «no existe».
   */
  it("trata un nombre con comillas como nombre, no como comando", async () => {
    const nombre = 'rara"; echo INYECTADO #';
    const r = await enviarAUsb(nombre, TICKET);

    expect(r.ok).toBe(false);
    /*
     * La prueba es que el nombre ENTERO se cita como una sola cosa que no
     * existe. Si el guion lo hubiera interpretado, `rara` y el `echo` habrían
     * sido dos comandos distintos y el mensaje no podría contener el nombre
     * completo entrecomillado.
     */
    expect(r.error).toBe(`No existe una impresora llamada '${nombre}' en este equipo`);
  }, ESPERA_SPOOLER_MS);

  it("rechaza un nombre inválido sin llegar a arrancar PowerShell", async () => {
    const r = await enviarAUsb("con\\barra", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no válido");
  });
});

describe.runIf(!EN_WINDOWS)("fuera de Windows", () => {
  it("lo dice en vez de fingir que imprimió", async () => {
    const r = await enviarAUsb("Cualquiera", TICKET);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("solo está disponible en Windows");
  });
});
