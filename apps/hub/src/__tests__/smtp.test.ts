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

/**
 * INYECCIÓN DE CABECERAS (CN-011).
 *
 * En el correo, un salto de línea es una cabecera nueva. El nombre de una
 * reserva viene del portal público —cualquiera con el QR de la mesa— y acaba en
 * el asunto de la confirmación. `Juan\r\nBcc: quien-sea@ejemplo.com` no era un
 * nombre raro: era un `Bcc:` de verdad.
 *
 * El agujero estaba en el orden. `cabecera()` solo codificaba en base64 si había
 * caracteres fuera de ASCII, y `\r` y `\n` están DENTRO de ASCII: un asunto en
 * español sin acentos salía tal cual. Uno con acentos se salvaba de rebote,
 * porque el base64 se traga el salto — protección accidental, de la que un día
 * desaparece sola.
 */
describe("nadie mete cabeceras de su cosecha", () => {
  /**
   * Las líneas de cabecera: lo que va antes del primer renglón vacío.
   *
   * Se comprueba sobre LÍNEAS y no con `toContain`, porque el texto "Bcc:"
   * aplanado dentro del asunto es inofensivo y aparece igual en el mensaje. Lo
   * que importa es si existe un renglón que EMPIECE por `Bcc:` — eso es lo que
   * un servidor de correo obedece.
   */
  function cabeceras(crudo: string): string[] {
    return crudo.split("\r\n\r\n")[0]!.split("\r\n");
  }

  function nombresDeCabecera(crudo: string): string[] {
    return cabeceras(crudo)
      .map((l) => l.match(/^([A-Za-z-]+):/)?.[1] ?? "")
      .filter(Boolean);
  }

  it("un nombre con salto de línea no añade un Bcc", () => {
    const crudo = mime({ asunto: "Reserva de Juan\r\nBcc: quien-sea@ejemplo.com" });

    expect(nombresDeCabecera(crudo)).not.toContain("Bcc");
    // El asunto entero queda en un solo renglón, con el ataque de texto muerto.
    expect(cabeceras(crudo)).toContain("Subject: Reserva de Juan Bcc: quien-sea@ejemplo.com");
  });

  /**
   * Con el remitente no se aplana: no sale el correo.
   *
   * Parece más duro de lo necesario —el salto está en el nombre de delante, no
   * en la dirección— hasta que se mira cómo se saca la dirección. `<([^>]+)>`
   * casa en CUALQUIER parte de la cadena, así que un nombre puede colar una
   * dirección entera y ganarle a la de verdad. Y el remitente no lo escribe un
   * comensal: es configuración del restaurante, donde un salto de línea es
   * corrupción o es un ataque, nunca un nombre.
   */
  it("un remitente con salto de línea no manda nada", () => {
    expect(() => mime({ de: "Rodizio\r\nBcc: quien-sea@ejemplo.com <rodizio@gmail.com>" })).toThrow(
      /no válida/,
    );
    // Y esta es la razón: la dirección que gana es la del atacante.
    expect(
      "Rodizio\r\nBcc: <yo@ataque.example> <rodizio@gmail.com>".match(/<([^>]+)>/)?.[1],
    ).toBe("yo@ataque.example");
  });

  it("tampoco desde el destinatario ni el Reply-To", () => {
    const crudo = mime({
      para: "Ana\r\nX-Cualquiera: si <cliente@correo.mx>",
      responder_a: "Rodizio\r\nX-Otra: si <rodizio@gmail.com>",
    });

    expect(nombresDeCabecera(crudo)).not.toContain("X-Cualquiera");
    expect(nombresDeCabecera(crudo)).not.toContain("X-Otra");
    expect(cabeceras(crudo).filter((l) => l.startsWith("To:"))).toHaveLength(1);
  });

  /** Un `\0` trunca la línea en algunos servidores: cuenta como salto. */
  it("los demás caracteres de control tampoco pasan", () => {
    const crudo = mime({ asunto: "Reserva\u0000de\u000bJuan\u007f" });
    expect(cabeceras(crudo).filter((l) => l.startsWith("Subject:"))).toHaveLength(1);
    expect(crudo).toContain("Subject: Reserva de Juan");
  });

  /**
   * Lo que NO puede pasar: que el arreglo rompa los acentos. Un asunto con
   * acentos sigue teniendo que salir codificado en RFC 2047.
   */
  it("los acentos siguen saliendo bien", () => {
    expect(mime({ asunto: "Su reserva en Café Rodizio" })).toContain("Subject: =?UTF-8?B?");
  });

  /**
   * En `MAIL FROM:<…>` la dirección va dentro de un COMANDO SMTP, no dentro de
   * una cabecera. Un salto ahí no añade un `Bcc:`: añade otro `RCPT TO`. Por eso
   * aquí se falla en seco — y aplanar tampoco valdría, porque una dirección
   * aplanada es otra dirección.
   */
  it("una dirección con salto de línea no se manda a ningún lado", () => {
    /*
     * Este caso es el que enseña por qué el rechazo va sobre el valor crudo y no
     * sobre lo extraído: `<([^>]+)>` casa en cualquier parte de la cadena, así
     * que aquí sacaba `otro@ejemplo.com` —una dirección válida— y el correo del
     * comensal se entregaba a quien escribió el ataque, sin un solo error.
     */
    expect(() => soloDireccion("cliente@correo.mx\r\nRCPT TO:<otro@ejemplo.com>")).toThrow(
      /no válida/,
    );
    expect(() => soloDireccion("Ana <ana@correo.mx\r\nDATA>")).toThrow(/no válida/);
    expect(() => soloDireccion("esto no es un correo")).toThrow(/no válida/);
    expect(() => soloDireccion("")).toThrow(/no válida/);
  });
});
