/**
 * El buzón de licencias del relay.
 *
 * Lo que se prueba aquí es lo que hace que «Renovar licencia» sea de fiar: que
 * una renovación sobreviva a un local apagado, que no se dé por entregada antes
 * de que el Hub confirme, y que el relay no acepte cualquier cosa como licencia.
 * Una renovación que se pierde en silencio es un restaurante bloqueado un lunes.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Licencias, pareceLicencia } from "../licencias.js";

const LLAVE = Buffer.alloc(32, 7);
let carpetas: string[] = [];

afterEach(() => {
  for (const c of carpetas) rmSync(c, { recursive: true, force: true });
  carpetas = [];
});

function almacen(): { buzon: Licencias; ruta: string } {
  const carpeta = mkdtempSync(join(tmpdir(), "motrest-licencias-"));
  carpetas.push(carpeta);
  const ruta = join(carpeta, "licencias.json");
  return { buzon: new Licencias(ruta, LLAVE), ruta };
}

function licencia(sucursal = "suc-rodizio", vence = 2_000_000) {
  return { sucursal_id: sucursal, nombre: "Rodizio", vence_ts: vence, firma: "firma-de-motrae" };
}

describe("qué se acepta como licencia", () => {
  it("acepta un documento firmado dirigido a ese local", () => {
    expect(pareceLicencia(licencia(), "suc-rodizio")).toBe(true);
  });

  /*
   * El destinatario manda. Si el cuerpo pudiera decir una sucursal y el
   * documento otra, se depositaría en el buzón de un local una licencia que su
   * Hub va a rechazar, y en Central se vería como enviada.
   */
  it("rechaza una licencia que dice ser de otro local", () => {
    expect(pareceLicencia(licencia("suc-otro"), "suc-rodizio")).toBe(false);
  });

  it("rechaza lo que no lleva firma ni vencimiento", () => {
    expect(pareceLicencia({ sucursal_id: "suc-rodizio" }, "suc-rodizio")).toBe(false);
    expect(pareceLicencia({ sucursal_id: "suc-rodizio", firma: "" }, "suc-rodizio")).toBe(false);
    expect(pareceLicencia(null, "suc-rodizio")).toBe(false);
    expect(pareceLicencia("licencia", "suc-rodizio")).toBe(false);
  });
});

describe("el buzón de renovaciones", () => {
  it("guarda una licencia para un local que todavía no la ha recogido", () => {
    const { buzon } = almacen();
    buzon.depositar("suc-rodizio", licencia());

    expect(buzon.total).toBe(1);
    expect(buzon.de("suc-rodizio")?.licencia.vence_ts).toBe(2_000_000);
  });

  /*
   * SOBREVIVE A QUE SE REINICIE EL RELAY. Es la mitad del valor de todo esto:
   * renovar a un local apagado tiene que funcionar aunque el relay se despliegue
   * esa misma noche.
   */
  it("sigue ahí después de reiniciar el relay", () => {
    const { buzon, ruta } = almacen();
    buzon.depositar("suc-rodizio", licencia());

    const otroArranque = new Licencias(ruta, LLAVE);

    expect(otroArranque.de("suc-rodizio")?.licencia.vence_ts).toBe(2_000_000);
  });

  /* El disco del relay se respalda y se copia: ahí no va nada en claro. */
  it("no deja la licencia legible en disco", () => {
    const { buzon, ruta } = almacen();
    buzon.depositar("suc-rodizio", licencia());

    expect(readFileSync(ruta, "utf8")).not.toContain("firma-de-motrae");
  });

  /*
   * Si Gonzalo corrige el vencimiento antes de que el Hub se conecte, lo que
   * tiene que llegar es lo último que firmó — no una cola de versiones
   * intermedias que el local iría aplicando en orden.
   */
  it("una renovación nueva sustituye a la que no se había recogido", () => {
    const { buzon } = almacen();
    buzon.depositar("suc-rodizio", licencia("suc-rodizio", 1_000));
    buzon.depositar("suc-rodizio", licencia("suc-rodizio", 9_000));

    expect(buzon.total).toBe(1);
    expect(buzon.de("suc-rodizio")?.licencia.vence_ts).toBe(9_000);
  });

  /*
   * NO SE VACÍA AL MANDARLA, SOLO AL CONFIRMAR. Un `send()` que no revienta no
   * significa que el Hub la haya escrito en disco: el socket puede caerse justo
   * en medio, y una renovación dada por entregada sin estarlo es un restaurante
   * bloqueado sin que nadie lo vea venir.
   */
  it("intentar entregarla no la borra: solo la confirmación", () => {
    const { buzon } = almacen();
    buzon.depositar("suc-rodizio", licencia());

    buzon.anotarIntento("suc-rodizio");
    buzon.anotarIntento("suc-rodizio");

    expect(buzon.de("suc-rodizio")?.intentos).toBe(2);
    expect(buzon.total).toBe(1);

    expect(buzon.confirmar("suc-rodizio")).toBe(true);
    expect(buzon.total).toBe(0);
  });

  it("confirmar algo que no estaba pendiente no rompe nada", () => {
    const { buzon } = almacen();
    expect(buzon.confirmar("suc-fantasma")).toBe(false);
  });

  it("un local dado de baja deja de tener buzón", () => {
    const { buzon } = almacen();
    buzon.depositar("suc-rodizio", licencia());

    buzon.olvidar("suc-rodizio");

    expect(buzon.total).toBe(0);
  });

  it("lista lo pendiente con lo más reciente primero", () => {
    const { buzon } = almacen();
    buzon.depositar("suc-uno", licencia("suc-uno"), 1_000);
    buzon.depositar("suc-dos", licencia("suc-dos"), 5_000);

    expect(buzon.lista().map((p) => p.sucursal_id)).toEqual(["suc-dos", "suc-uno"]);
  });

  /*
   * Un buzón ilegible no puede impedir que el relay arranque: una licencia
   * perdida se vuelve a depositar con un clic, pero un relay que no levanta deja
   * a todos los restaurantes sin WhatsApp.
   */
  it("un archivo corrupto no impide arrancar", () => {
    const { buzon, ruta } = almacen();
    buzon.depositar("suc-rodizio", licencia());
    writeFileSync(ruta, "esto no es un sobre", "utf8");

    const avisos: string[] = [];
    const otro = new Licencias(ruta, LLAVE, (t) => avisos.push(t));

    expect(otro.total).toBe(0);
    expect(avisos).toHaveLength(1);
  });
});
