/**
 * La cola de timbrado, que es como el restaurante factura sin internet.
 *
 * Se prueba contra un SQLite real en memoria y un PAC de mentira al que se le
 * dice qué contestar. Lo que se verifica no es que sepa llamar a un proveedor
 * —eso es un adaptador de veinte líneas— sino lo que pasa cuando el proveedor
 * falla, tarda, o contesta algo raro.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as TipoDb } from "node:sqlite";
import { ColaDeTimbrado, esperaTrasIntentos } from "../fiscal/cola-timbrado.js";
import { clasificar, type Pac, type ResultadoTimbrado } from "../fiscal/pac.js";

const requerir = createRequire(import.meta.url);
const { DatabaseSync } = requerir("node:sqlite") as { DatabaseSync: typeof TipoDb };

const MINUTO = 60_000;
const HORA = 3_600_000;

function xmlTimbrado(uuid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="A" Folio="1">
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-07-23T20:00:00" SelloCFD="abc" NoCertificadoSAT="00001000000504465028" SelloSAT="def" RfcProvCertif="AAA010101AAA" />
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/** PAC de mentira: contesta lo que se le indique, y cuenta las llamadas. */
class PacFalso implements Pac {
  readonly nombre = "PAC de prueba";
  llamadas = 0;
  xmlRecibidos: string[] = [];

  constructor(private responder: (llamada: number) => ResultadoTimbrado) {}

  async timbrar(xml: string): Promise<ResultadoTimbrado> {
    this.llamadas += 1;
    this.xmlRecibidos.push(xml);
    return this.responder(this.llamadas);
  }
}

const exito = (uuid = "11111111-2222-3333-4444-555555555555") =>
  clasificar({ xml: xmlTimbrado(uuid) });
const caido = (): ResultadoTimbrado => ({ estado: "reintentable", motivo: "sin conexión" });
const selloMalo = (): ResultadoTimbrado => clasificar({ codigo: "302", mensaje: "Sello inválido" });

let db: TipoDb;
let avisos: string[];

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  avisos = [];
});
afterEach(() => db.close());

function cola(pac: Pac | null): ColaDeTimbrado {
  return new ColaDeTimbrado(db, pac, (nivel, mensaje) => avisos.push(`${nivel}: ${mensaje}`));
}

function encolar(c: ColaDeTimbrado, ordenId = "ord-1", folio = "1"): void {
  c.encolar({
    orden_id: ordenId,
    serie: "A",
    folio,
    total: 58000,
    xml: `<cfdi:Comprobante Folio="${folio}" />`,
  });
}

// --- El camino feliz ---------------------------------------------------------------------

describe("timbrar cuando todo funciona", () => {
  it("timbra lo encolado y guarda el UUID", async () => {
    const pac = new PacFalso(() => exito());
    const c = cola(pac);
    encolar(c);

    expect(await c.procesar()).toMatchObject({ timbradas: 1, pendientes: 0 });
    expect(c.facturaDe("ord-1")?.uuid).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("guarda el XML timbrado, que es el documento fiscal", async () => {
    const c = cola(new PacFalso(() => exito()));
    encolar(c);
    await c.procesar();

    expect(c.facturaDe("ord-1")?.xml).toContain("TimbreFiscalDigital");
  });

  it("una vez timbrada no se vuelve a mandar al PAC", async () => {
    const pac = new PacFalso(() => exito());
    const c = cola(pac);
    encolar(c);

    await c.procesar();
    await c.procesar();
    await c.procesar();

    expect(pac.llamadas).toBe(1);
  });
});

// --- Sin internet ------------------------------------------------------------------------

describe("cuando no hay internet", () => {
  /*
   * El requisito de fondo: el restaurante sigue vendiendo. La factura espera,
   * no se pierde y no bloquea nada.
   */
  it("la factura queda pendiente en vez de perderse", async () => {
    const c = cola(new PacFalso(caido));
    encolar(c);

    expect(await c.procesar()).toMatchObject({ timbradas: 0, pendientes: 1 });
    expect(c.resumen().pendientes).toBe(1);
  });

  it("al volver la conexión se timbra sola", async () => {
    let hayRed = false;
    const c = cola(new PacFalso(() => (hayRed ? exito() : caido())));
    encolar(c);

    const ahora = Date.now();
    await c.procesar(20, ahora);
    hayRed = true;
    // Pasado el tiempo de espera, el siguiente intento entra.
    await c.procesar(20, ahora + 10 * MINUTO);

    expect(c.resumen()).toMatchObject({ pendientes: 0, timbradas: 1 });
  });

  /*
   * Sin la espera creciente, un PAC caído recibiría un intento por minuto por
   * cada factura pendiente durante todo el turno.
   */
  it("espera antes de reintentar, y cada vez un poco más", async () => {
    const pac = new PacFalso(caido);
    const c = cola(pac);
    encolar(c);

    const ahora = Date.now();
    await c.procesar(20, ahora);
    expect(pac.llamadas).toBe(1);

    // Enseguida no se reintenta.
    await c.procesar(20, ahora + 1000);
    expect(pac.llamadas).toBe(1);

    // Pasado el primer minuto, sí.
    await c.procesar(20, ahora + MINUTO + 1);
    expect(pac.llamadas).toBe(2);
  });

  it("la espera crece pero tiene tope, para que la cola no se duerma", () => {
    expect(esperaTrasIntentos(1)).toBe(MINUTO);
    expect(esperaTrasIntentos(2)).toBe(2 * MINUTO);
    expect(esperaTrasIntentos(3)).toBe(4 * MINUTO);
    expect(esperaTrasIntentos(50)).toBe(30 * MINUTO);
  });

  it("sin PAC configurado no se pierde nada: solo espera", async () => {
    const c = cola(null);
    encolar(c);
    expect(await c.procesar()).toMatchObject({ timbradas: 0, pendientes: 1 });
  });

  /*
   * El adaptador de un PAC puede reventar de mil formas. Cualquier excepción se
   * trata como pasajera a propósito: descartar una factura por un error que no
   * se supo interpretar es peor que reintentarla de más.
   */
  it("una excepción del adaptador no descarta la factura", async () => {
    const c = cola({
      nombre: "roto",
      timbrar: () => {
        throw new Error("ECONNRESET");
      },
    });
    encolar(c);

    expect(await c.procesar()).toMatchObject({ pendientes: 1 });
    expect(c.listar("pendiente")[0]!.problema).toContain("ECONNRESET");
  });
});

// --- Rechazos ----------------------------------------------------------------------------

describe("cuando el PAC rechaza de verdad", () => {
  /*
   * Reintentar un sello inválido mil veces no lo arregla: hace falta que alguien
   * intervenga. Y cada intento quema saldo de timbres.
   */
  it("un sello inválido no se reintenta", async () => {
    const pac = new PacFalso(selloMalo);
    const c = cola(pac);
    encolar(c);

    const ahora = Date.now();
    await c.procesar(20, ahora);
    await c.procesar(20, ahora + HORA);
    await c.procesar(20, ahora + 10 * HORA);

    expect(pac.llamadas).toBe(1);
    expect(c.resumen().rechazadas).toBe(1);
  });

  it("el rechazo queda anotado con su código, para saber qué arreglar", async () => {
    const c = cola(new PacFalso(selloMalo));
    encolar(c);
    await c.procesar();

    expect(c.listar("rechazado")[0]!.problema).toContain("302");
    expect(avisos.some((a) => a.startsWith("error:"))).toBe(true);
  });

  /*
   * Reencolar es deliberadamente manual. Automatizarlo dejaría al sistema
   * reintentando en círculo el error que un humano tiene que resolver.
   */
  it("se puede reintentar a mano después de arreglar la causa", async () => {
    let arreglado = false;
    const c = cola(new PacFalso(() => (arreglado ? exito() : selloMalo())));
    encolar(c);
    await c.procesar();
    expect(c.resumen().rechazadas).toBe(1);

    arreglado = true;
    c.reintentar("ord-1");
    await c.procesar();

    expect(c.resumen()).toMatchObject({ rechazadas: 0, timbradas: 1 });
  });
});

// --- El folio no se reusa ----------------------------------------------------------------

describe("el folio no se reusa", () => {
  /*
   * Reencolar la misma orden sobrescribiría el XML de una factura que quizá ya
   * se timbró, y saldrían dos comprobantes para una venta.
   */
  it("encolar dos veces la misma orden no la duplica", async () => {
    const c = cola(new PacFalso(() => exito()));
    encolar(c, "ord-1", "1");
    encolar(c, "ord-1", "999");

    expect(c.listar()).toHaveLength(1);
    expect(c.listar()[0]!.folio).toBe("1");
  });

  it("se reintenta EL MISMO XML, no uno nuevo", async () => {
    const pac = new PacFalso((n) => (n === 1 ? caido() : exito()));
    const c = cola(pac);
    encolar(c);

    const ahora = Date.now();
    await c.procesar(20, ahora);
    await c.procesar(20, ahora + 2 * MINUTO);

    expect(pac.xmlRecibidos).toHaveLength(2);
    expect(pac.xmlRecibidos[0]).toBe(pac.xmlRecibidos[1]);
  });
});

// --- El reloj del SAT --------------------------------------------------------------------

describe("el plazo del SAT", () => {
  /*
   * El SAT da 72 horas desde la emisión. Avisar a las 24 deja margen para
   * resolverlo en horario hábil, cuando se puede llamar al PAC o al contador.
   */
  it("avisa de las facturas que llevan más de un día sin timbrar", async () => {
    const c = cola(new PacFalso(caido));
    encolar(c);

    await c.procesar(20, Date.now() + 30 * HORA);

    expect(avisos.some((a) => a.includes("72 horas"))).toBe(true);
  });

  it("no alarma por una factura recién encolada", async () => {
    const c = cola(new PacFalso(caido));
    encolar(c);
    await c.procesar();

    expect(avisos.some((a) => a.includes("72 horas"))).toBe(false);
  });
});

// --- Lo que ve la pantalla ---------------------------------------------------------------

describe("el resumen para la pantalla de facturación", () => {
  it("cuenta cada estado por separado", async () => {
    const c = cola(new PacFalso((n) => (n === 1 ? exito() : n === 2 ? selloMalo() : caido())));
    encolar(c, "ord-1", "1");
    encolar(c, "ord-2", "2");
    encolar(c, "ord-3", "3");
    await c.procesar();

    expect(c.resumen()).toEqual({ timbradas: 1, rechazadas: 1, pendientes: 1 });
  });

  it("una orden sin timbrar todavía no tiene factura que entregar", () => {
    const c = cola(new PacFalso(caido));
    encolar(c);
    expect(c.facturaDe("ord-1")).toBeNull();
  });
});
