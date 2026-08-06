/**
 * El armado del mensaje que sale por SMTP.
 *
 * Lo que hay que probar aquí no es "que mande": es que el correo LLEGUE BIEN
 * ESCRITO. Un acento mal codificado no rompe nada visiblemente —el correo sale,
 * el sistema dice que todo bien— y el comensal recibe "CafÃ© Rodizio". Ese es el
 * bug que solo se descubre cuando ya salieron doscientos.
 */
import { describe, expect, it } from "vitest";
import { armarMime, soloDireccion } from "../smtp.js";

const FECHA = new Date(Date.UTC(2026, 6, 24, 21, 0, 0));

function mime(extra: Partial<Parameters<typeof armarMime>[0]> = {}): string {
  return armarMime(
    {
      de: "Rodizio <rodizio@gmail.com>",
      para: "cliente@correo.mx",
      asunto: "Su reserva quedó confirmada",
      html: "<p>Su reserva quedó confirmada.</p>",
      texto: "Su reserva quedó confirmada.",
      ...extra,
    },
    FECHA,
    "id-fijo",
  );
}

/** Devuelve el contenido de una parte MIME ya descifrado del base64. */
function parte(crudo: string, tipo: string): string {
  const trozos = crudo.split(/--motrest-id-fijo(?:--)?\r\n/);
  const buscado = trozos.find((t) => t.includes(`Content-Type: ${tipo}`));
  const cuerpo = buscado?.split("\r\n\r\n")[1] ?? "";
  return Buffer.from(cuerpo.replaceAll("\r\n", ""), "base64").toString("utf8");
}

describe("el mensaje que se entrega", () => {
  /*
   * EL CANDADO DE LOS ACENTOS. Todo el cuerpo va en base64 justamente para que
   * esto no pueda fallar: el alfabeto de base64 es ASCII puro, así que da igual
   * lo que traiga el texto.
   */
  it("los acentos sobreviven al viaje, en texto y en HTML", () => {
    const crudo = mime();
    expect(parte(crudo, "text/plain")).toContain("quedó confirmada");
    expect(parte(crudo, "text/html")).toContain("<p>Su reserva quedó confirmada.</p>");
  });

  /*
   * Un asunto con acentos SIN codificar hace que algunos servidores rechacen el
   * mensaje entero y que otros lo entreguen ilegible.
   */
  it("el asunto con acentos va codificado (RFC 2047)", () => {
    const cabecera = mime().split("\r\n").find((l) => l.startsWith("Subject:"))!;
    expect(cabecera).toMatch(/^Subject: =\?UTF-8\?B\?/);
    const codificado = cabecera.slice("Subject: =?UTF-8?B?".length, -2);
    expect(Buffer.from(codificado, "base64").toString("utf8")).toBe("Su reserva quedó confirmada");
  });

  /* Y un asunto sin acentos NO se codifica: envolverlo sin necesidad se ve peor. */
  it("un asunto normal se deja tal cual", () => {
    const crudo = mime({ asunto: "Gracias por su visita" });
    expect(crudo).toContain("Subject: Gracias por su visita");
  });

  it("el nombre del restaurante se codifica, la dirección nunca", () => {
    const crudo = mime({ de: "Café Rodizio <rodizio@gmail.com>" });
    const de = crudo.split("\r\n").find((l) => l.startsWith("From:"))!;
    expect(de).toContain("=?UTF-8?B?");
    // La dirección tiene que quedar legible o el servidor no sabe a quién creer.
    expect(de).toContain("<rodizio@gmail.com>");
  });

  /*
   * En `multipart/alternative` el cliente enseña la ÚLTIMA parte que entiende.
   * Con el orden al revés, todo el mundo vería el texto plano y el HTML no se
   * mostraría nunca.
   */
  it("el HTML va después del texto, que es como se elige el HTML", () => {
    const crudo = mime();
    expect(crudo.indexOf("text/plain")).toBeLessThan(crudo.indexOf("text/html"));
  });

  it("lleva las dos alternativas y cierra la frontera", () => {
    const crudo = mime();
    expect(crudo).toContain('Content-Type: multipart/alternative; boundary="motrest-id-fijo"');
    expect(crudo.trimEnd().endsWith("--motrest-id-fijo--")).toBe(true);
  });

  /* Sin `Date` y `Message-ID` propios, varios filtros lo puntúan como spam. */
  it("trae fecha en formato de correo y un Message-ID único", () => {
    const crudo = mime();
    expect(crudo).toContain("Date: Fri, 24 Jul 2026 21:00:00 +0000");
    expect(crudo).toContain("Message-ID: <id-fijo@gmail.com>");
  });

  it("el Reply-To solo aparece si se pidió", () => {
    expect(mime()).not.toContain("Reply-To:");
    expect(mime({ responder_a: "hola@rodizio.mx" })).toContain("Reply-To: hola@rodizio.mx");
  });
});

describe("sacar la dirección de un remitente", () => {
  /*
   * `MAIL FROM` solo entiende la dirección pelada. Mandarle "Rodizio <x@y>"
   * completo es un error de sintaxis y el servidor corta la conversación.
   */
  it("quita el nombre y deja la dirección", () => {
    expect(soloDireccion("Rodizio <rodizio@gmail.com>")).toBe("rodizio@gmail.com");
    expect(soloDireccion("rodizio@gmail.com")).toBe("rodizio@gmail.com");
    expect(soloDireccion("  espaciada@correo.mx  ")).toBe("espaciada@correo.mx");
  });
});
