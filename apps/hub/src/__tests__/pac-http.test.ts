/**
 * El adaptador HTTP, contra un servidor de verdad.
 *
 * Se levanta un HTTP real en vez de sustituir `fetch`: lo que hay que verificar
 * es justo lo que ocurre en el transporte —un 500, un cuerpo que no es JSON, un
 * servidor que no contesta— y eso un doble de `fetch` no lo reproduce.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { MAPEO_REST_COMUN, PacHttp } from "../fiscal/pac-http.js";

const UUID = "11111111-2222-3333-4444-555555555555";
const XML_TIMBRADO = `<cfdi:Comprobante><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${UUID}" FechaTimbrado="2026-07-23T20:00:00" /></cfdi:Complemento></cfdi:Comprobante>`;

let servidor: Server | null = null;

afterEach(() => {
  servidor?.close();
  servidor = null;
});

/** Levanta un PAC de mentira que responde lo que se le indique. */
async function pacEn(
  responder: (cuerpo: string) => { estado: number; cuerpo: string },
): Promise<PacHttp> {
  servidor = createServer((peticion, respuesta) => {
    let cuerpo = "";
    peticion.on("data", (trozo) => (cuerpo += trozo));
    peticion.on("end", () => {
      const r = responder(cuerpo);
      respuesta.writeHead(r.estado, { "content-type": "application/json" });
      respuesta.end(r.cuerpo);
    });
  });

  await new Promise<void>((listo) => servidor!.listen(0, "127.0.0.1", listo));
  const puerto = (servidor!.address() as { port: number }).port;

  return new PacHttp({
    nombre: "PAC de prueba",
    token: "token-de-prueba",
    mapeo: { ...MAPEO_REST_COMUN, url: `http://127.0.0.1:${puerto}/timbrar` },
    tiempoLimiteMs: 2000,
  });
}

describe("hablar con el PAC", () => {
  it("timbra y devuelve el UUID", async () => {
    const pac = await pacEn(() => ({
      estado: 200,
      cuerpo: JSON.stringify({ data: { cfdi: Buffer.from(XML_TIMBRADO).toString("base64") } }),
    }));

    const r = await pac.timbrar("<cfdi:Comprobante />");
    expect(r.estado).toBe("timbrado");
    expect(r.estado === "timbrado" && r.timbrado.timbre.uuid).toBe(UUID);
  });

  it("acepta el XML en claro además de en base64", async () => {
    const pac = await pacEn(() => ({
      estado: 200,
      cuerpo: JSON.stringify({ cfdi: XML_TIMBRADO }),
    }));

    expect((await pac.timbrar("<cfdi:Comprobante />")).estado).toBe("timbrado");
  });

  it("manda el comprobante y la credencial", async () => {
    let recibido = "";
    const pac = await pacEn((cuerpo) => {
      recibido = cuerpo;
      return { estado: 200, cuerpo: JSON.stringify({ cfdi: XML_TIMBRADO }) };
    });

    await pac.timbrar("<cfdi:Comprobante Folio='7' />");
    const enviado = JSON.parse(recibido) as { xml: string };
    expect(Buffer.from(enviado.xml, "base64").toString("utf8")).toContain("Folio='7'");
  });
});

describe("cuando el PAC falla", () => {
  it("un 500 se reintenta: es problema del proveedor", async () => {
    const pac = await pacEn(() => ({ estado: 503, cuerpo: "{}" }));
    const r = await pac.timbrar("<cfdi:Comprobante />");
    expect(r.estado).toBe("reintentable");
  });

  /*
   * Un 4xx NO se decide por el código HTTP. El cuerpo trae el código del SAT,
   * que es quien sabe si tiene arreglo: un 401 por credencial vencida se
   * resuelve solo en cuanto alguien la renueve.
   */
  it("un 4xx se decide por el código del SAT, no por el HTTP", async () => {
    const definitivo = await pacEn(() => ({
      estado: 400,
      cuerpo: JSON.stringify({ code: "302", message: "Sello inválido" }),
    }));
    expect((await definitivo.timbrar("<x/>")).estado).toBe("rechazado");

    const pasajero = await pacEn(() => ({
      estado: 401,
      cuerpo: JSON.stringify({ message: "Token expirado" }),
    }));
    expect((await pasajero.timbrar("<x/>")).estado).toBe("reintentable");
  });

  it("una respuesta que no es JSON no revienta el Hub", async () => {
    const pac = await pacEn(() => ({ estado: 200, cuerpo: "<html>Error 502</html>" }));
    const r = await pac.timbrar("<cfdi:Comprobante />");

    expect(r.estado).toBe("reintentable");
    expect(r.estado === "reintentable" && r.motivo).toContain("ilegible");
  });

  it("un servidor inalcanzable se reintenta en vez de perder la factura", async () => {
    const pac = new PacHttp({
      nombre: "PAC apagado",
      token: "x",
      // Puerto cerrado a propósito.
      mapeo: { ...MAPEO_REST_COMUN, url: "http://127.0.0.1:1/timbrar" },
      tiempoLimiteMs: 1500,
    });

    expect((await pac.timbrar("<x/>")).estado).toBe("reintentable");
  });

  /*
   * Una petición colgada bloquea la cola entera detrás de ella, así que el
   * corte por tiempo importa tanto como el reintento.
   */
  it("corta por tiempo en vez de quedarse colgado", async () => {
    servidor = createServer(() => {
      // Nunca responde.
    });
    await new Promise<void>((listo) => servidor!.listen(0, "127.0.0.1", listo));
    const puerto = (servidor!.address() as { port: number }).port;

    const pac = new PacHttp({
      nombre: "PAC lento",
      token: "x",
      mapeo: { ...MAPEO_REST_COMUN, url: `http://127.0.0.1:${puerto}/timbrar` },
      tiempoLimiteMs: 300,
    });

    const desde = Date.now();
    const r = await pac.timbrar("<x/>");

    expect(r.estado).toBe("reintentable");
    expect(Date.now() - desde).toBeLessThan(2000);
  });
});
