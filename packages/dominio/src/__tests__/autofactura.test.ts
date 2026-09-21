/**
 * El portal de autofactura, del lado del dominio (1.5.6).
 *
 * Lo que se fija aquí lo tienen que decidir IGUAL la caja, el Hub, el portal y
 * Central: qué ticket se puede pedir por internet, que su código no se adivine
 * y no sirva para otra cosa, qué se acepta de lo que teclea el comensal, y cómo
 * se propone la clave de un local.
 */
import { describe, expect, it } from "vitest";
import { firmarCuenta } from "../clientes/acceso.js";
import { armarAvisoDeFacturaRechazada, configuracionVacia } from "../clientes/correo.js";
import { pesos, type Centavos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda, FormaPago } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";
import type { Comprobante } from "../fiscal/comprobante.js";
import type { RegistroCfdi } from "../fiscal/eventos.js";
import {
  VIGENCIA_AUTOFACTURA_MS,
  codigoDeAutofactura,
  direccionLegible,
  leerSolicitudDeAutofactura,
  motivoParaNoAutofacturar,
  proponerClaveDeAutofactura,
  ticketAutofacturable,
  urlDeAutofactura,
} from "../fiscal/autofactura.js";

const CTX = { device_id: "d1", empleado_id: "usr-1", sucursal_id: "s1" };
const COBRO = new Date("2026-09-19T21:30:00").getTime();

function renglon(precio: number): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p", descripcion: "Pizza", cantidad: 1,
    precio_unitario: pesos(precio), costo_unitario: pesos(1), impuesto: snapshotTasas(IVA_16),
    estado: "entregado",
  };
}

/** Una cuenta cobrada; con `formas` se reparte el total entre varias formas de pago. */
function cobrada(precio: number, formas: FormaPago[] = ["efectivo"]): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "m1", abierta_ts: COBRO - 3_600_000 }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: renglon(precio) }),
  ];
  const total = totalesComanda(proyectarComanda(eventos)).total;
  const parte = Math.floor(total / formas.length);
  formas.forEach((forma, i) => {
    const monto = i === formas.length - 1 ? total - parte * (formas.length - 1) : parte;
    eventos.push(f.crear("pago_registrado", orden_id, { orden_id, monto: monto as Centavos, forma }));
  });
  eventos.push({ ...f.crear("cuenta_cerrada", orden_id, { orden_id }), ts: COBRO });
  return proyectarComanda(eventos);
}

function registro(orden_id: string, estado: RegistroCfdi["estado"]): RegistroCfdi {
  return {
    cfdi_id: uuidv7(), orden_id, serie: "A", folio: "1", comprobante: {} as Comprobante,
    estado, intentos: 0, generado_ts: 0,
  };
}

describe("El código del QR", () => {
  it("son 16 caracteres del alfabeto que no se confunde al dictar, y siempre el mismo", async () => {
    const orden = uuidv7();
    const uno = await codigoDeAutofactura(orden, "secreto-del-local");
    expect(uno).toMatch(/^[2-9A-HJKMNP-TV-Z]{16}$/);
    expect(await codigoDeAutofactura(orden, "secreto-del-local")).toBe(uno);
  });

  it("otro local, otro código: el secreto sale de la clave de cada uno", async () => {
    const orden = uuidv7();
    expect(await codigoDeAutofactura(orden, "local-a")).not.toBe(await codigoDeAutofactura(orden, "local-b"));
  });

  it("con su propio secreto, no coincide con la firma del enlace de la encuesta", async () => {
    const orden = uuidv7();
    expect(await codigoDeAutofactura(orden, "secreto-de-factura")).not.toBe(
      await firmarCuenta(orden, "secreto-de-encuesta"),
    );
  });
});

describe("La dirección del QR", () => {
  it("lleva clave, folio y código, sin doble barra aunque el ajuste traiga una al final", () => {
    expect(urlDeAutofactura("https://motrest-factura.vercel.app/", "RODIZIO", "A1B2C3D4", "ABCDEFGHJKMNPQRS")).toBe(
      "https://motrest-factura.vercel.app/r/RODIZIO/A1B2C3D4?t=ABCDEFGHJKMNPQRS",
    );
  });

  it("para teclear a mano se imprime sin https://", () => {
    expect(direccionLegible("https://motrest-factura.vercel.app/")).toBe("motrest-factura.vercel.app");
  });
});

describe("Qué ticket se puede pedir por internet", () => {
  it("una cuenta cobrada normal, con su folio de 8 y 72 horas de vigencia", () => {
    const c = cobrada(116);
    const t = ticketAutofacturable(c)!;
    expect(t.folio).toMatch(/^[0-9A-Z]{8}$/);
    expect(t.total).toBe(totalesComanda(c).total);
    expect(t.vence_ts - t.cerrada_ts).toBe(VIGENCIA_AUTOFACTURA_MS);
  });

  it("el consumo de un socio no: no fue una venta al público (1.5.6)", () => {
    expect(ticketAutofacturable(cobrada(116, ["socio"]))).toBeNull();
    // Ni una cuenta mixta: parte la cubrió la bolsa del socio.
    expect(ticketAutofacturable(cobrada(116, ["socio", "efectivo"]))).toBeNull();
  });

  it("una cuenta en $0 no tiene nada que facturar", () => {
    expect(ticketAutofacturable(cobrada(0))).toBeNull();
  });
});

describe("Cuándo el Hub se niega a timbrar", () => {
  const base = { cfdis: [] as RegistroCfdi[], enGlobal: false, ahora: COBRO + 3_600_000 };

  it("un ticket en regla se puede", () => {
    expect(motivoParaNoAutofacturar({ ...base, cuenta: cobrada(116) })).toBeNull();
  });

  it("uno que el Hub no conoce, no", () => {
    expect(motivoParaNoAutofacturar({ ...base, cuenta: undefined })).toMatch(/no encuentra/);
  });

  it("pasadas las 72 horas, no", () => {
    const c = cobrada(116);
    expect(motivoParaNoAutofacturar({ ...base, cuenta: c, ahora: COBRO + VIGENCIA_AUTOFACTURA_MS + 1 })).toMatch(
      /72 horas/,
    );
  });

  it("si ya tiene factura —aunque sea la que sigue en cola—, no: una venta, un comprobante", () => {
    const c = cobrada(116);
    for (const estado of ["generado", "timbrado"] as const) {
      expect(motivoParaNoAutofacturar({ ...base, cuenta: c, cfdis: [registro(c.orden_id, estado)] })).toMatch(
        /ya tiene su factura/,
      );
    }
  });

  it("una factura RECHAZADA no la ampara: el comensal corrige y se vuelve a pedir", () => {
    const c = cobrada(116);
    expect(motivoParaNoAutofacturar({ ...base, cuenta: c, cfdis: [registro(c.orden_id, "rechazado")] })).toBeNull();
  });

  it("si ya va en una global, no", () => {
    expect(motivoParaNoAutofacturar({ ...base, cuenta: cobrada(116), enGlobal: true })).toMatch(/global/);
  });
});

describe("Lo que llega del portal", () => {
  const bueno = {
    rfc: "pelj800101ab1",
    nombre: "  juan   perez lopez ",
    regimen_fiscal: "612",
    codigo_postal: "44650",
    uso_cfdi: "g03",
    correo: " Juan@Correo.MX ",
  };

  it("se normaliza como lo compara el SAT: mayúsculas, sin espacios de más, correo en minúsculas", () => {
    const r = leerSolicitudDeAutofactura(JSON.stringify(bueno));
    expect(r).toEqual({
      ok: true,
      solicitud: {
        receptor: {
          rfc: "PELJ800101AB1",
          nombre: "JUAN PEREZ LOPEZ",
          regimen_fiscal: "612",
          codigo_postal: "44650",
          uso_cfdi: "G03",
        },
        correo: "juan@correo.mx",
      },
    });
  });

  it("rechaza con un motivo que se entiende lo que el SAT rechazaría", () => {
    const casos: [Partial<typeof bueno>, RegExp][] = [
      [{ rfc: "MALO" }, /RFC/i],
      [{ regimen_fiscal: "999" }, /régimen/i],
      [{ codigo_postal: "4465" }, /5 dígitos/],
      [{ uso_cfdi: "ZZZ" }, /uso del CFDI/i],
      [{ correo: "sin-arroba" }, /correo/i],
      [{ nombre: "J" }, /razón social/i],
    ];
    for (const [cambio, motivo] of casos) {
      const r = leerSolicitudDeAutofactura(JSON.stringify({ ...bueno, ...cambio }));
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(motivo);
    }
  });

  it("un sobre que no es JSON no revienta al Hub", () => {
    expect(leerSolicitudDeAutofactura("{{{").ok).toBe(false);
    expect(leerSolicitudDeAutofactura("null").ok).toBe(false);
  });
});

describe("La clave que se propone para un local", () => {
  it("la palabra que lo distingue, en mayúsculas y sin acentos", () => {
    expect(proponerClaveDeAutofactura("Rodizio Pizzas y Pasta")).toBe("RODIZIO");
    expect(proponerClaveDeAutofactura("Pizzería La Toscana")).toBe("TOSCANA");
    expect(proponerClaveDeAutofactura("Café Ñandú")).toBe("NANDU");
  });

  it("si queda muy corta, pega la siguiente palabra", () => {
    expect(proponerClaveDeAutofactura("Don Taco")).toBe("DONTACO");
  });

  it("si otro local ya la tiene, le pone número", () => {
    expect(proponerClaveDeAutofactura("Rodizio Centro", ["RODIZIO"])).toBe("RODIZIO-2");
    expect(proponerClaveDeAutofactura("Rodizio Sur", ["RODIZIO", "RODIZIO-2"])).toBe("RODIZIO-3");
  });

  it("siempre cumple la forma de la tabla de la nube", () => {
    for (const nombre of ["", "   ", "La", "El Bar", "Restaurante de la Esquina", "12"]) {
      expect(proponerClaveDeAutofactura(nombre)).toMatch(/^[A-Z0-9-]{3,20}$/);
    }
  });
});

describe("El aviso de que la factura no salió", () => {
  const config = { ...configuracionVacia("Rodizio"), remitente: "Rodizio <facturas@rodizio.mx>" };
  const aviso = () =>
    armarAvisoDeFacturaRechazada("juan@correo.mx", config, {
      folio: "A1B2C3D4",
      motivo: "El código postal <script>alert(1)</script> no coincide",
      enlace: "https://motrest-factura.vercel.app/r/RODIZIO/A1B2C3D4?t=ABCDEFGHJKMNPQRS",
    });

  it("es transaccional: sin pie de baja, porque lo pidió el comensal", () => {
    const a = aviso();
    expect(a.html).not.toMatch(/BAJA|baja/);
    expect(a.texto).not.toMatch(/BAJA|baja/);
  });

  it("dice el motivo del SAT escapado, y lleva el enlace para corregir", () => {
    const a = aviso();
    expect(a.html).not.toContain("<script>");
    expect(a.html).toContain("&lt;script&gt;");
    expect(a.html).toContain("Corregir mis datos");
    expect(a.texto).toContain("https://motrest-factura.vercel.app/r/RODIZIO/A1B2C3D4");
    expect(a.asunto).toBe("Tu factura de Rodizio no salió: revisa tus datos");
  });

  it("un enlace que no es web no se vuelve botón", () => {
    const a = armarAvisoDeFacturaRechazada("juan@correo.mx", config, {
      folio: "A1B2C3D4",
      motivo: "No coincide",
      enlace: "javascript:alert(1)",
    });
    expect(a.html).not.toContain("javascript:");
  });
});
