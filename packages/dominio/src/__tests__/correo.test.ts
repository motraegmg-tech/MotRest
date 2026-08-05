/**
 * Los correos al comensal.
 *
 * Lo que hay que probar es lo que protege el dominio del restaurante: que un
 * correo de marketing NO salga sin permiso y SIEMPRE lleve baja. Un reporte de
 * spam mancha el dominio para todo, incluidas las confirmaciones de reserva —
 * y entonces el restaurante deja de entregar nada.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOGO_CORREOS,
  armarCorreo,
  configuracionVacia,
  correoPlausible,
  definicionCorreo,
  problemasDeRemitente,
  puedeMandarCorreo,
  type ConfiguracionCorreo,
} from "../clientes/correo.js";

const CONFIG: ConfiguracionCorreo = {
  remitente: "Rodizio <reservas@rodizio.mx>",
  responder_a: "hola@rodizio.mx",
  telefono: "33 1122 3344",
  local: "Rodizio",
  activos: {
    reserva_confirmada: true,
    encuesta: true,
    cupon: true,
  },
};

describe("el catálogo que ve el restaurantero", () => {
  it("no tiene tipos repetidos", () => {
    const tipos = CATALOGO_CORREOS.map((d) => d.tipo);
    expect(new Set(tipos).size).toBe(tipos.length);
  });

  it("cada correo dice para qué sirve y cuándo sale", () => {
    for (const d of CATALOGO_CORREOS) {
      expect(d.etiqueta.length).toBeGreaterThan(3);
      expect(d.descripcion.length).toBeGreaterThan(10);
      expect(d.cuando.length).toBeGreaterThan(5);
    }
  });

  /* La clase decide si hace falta permiso: equivocarla es lo caro. */
  it("los cupones son marketing y las confirmaciones no", () => {
    expect(definicionCorreo("cupon")!.clase).toBe("marketing");
    expect(definicionCorreo("te_extranamos")!.clase).toBe("marketing");
    expect(definicionCorreo("reserva_confirmada")!.clase).toBe("transaccional");
    expect(definicionCorreo("encuesta")!.clase).toBe("transaccional");
  });
});

describe("qué es un correo con el que se puede intentar", () => {
  it("acepta los normales", () => {
    for (const c of ["a@b.mx", "gonzalo.mtz+reservas@rodizio.com.mx"]) {
      expect(correoPlausible(c)).toBe(true);
    }
  });

  it("descarta lo que seguro no lo es", () => {
    for (const c of ["", "sinarroba", "a@b", "dos@@arrobas.mx", "con espacio@b.mx", undefined]) {
      expect(correoPlausible(c)).toBe(false);
    }
  });
});

// --- La puerta ----------------------------------------------------------------------------

describe("a quién se le puede mandar qué", () => {
  it("una confirmación de reserva sale sin pedir permiso", () => {
    // El comensal la provocó: reservó. Pedirle permiso para confirmarle no
    // tiene sentido.
    expect(puedeMandarCorreo("reserva_confirmada", "a@b.mx", CONFIG, false).puede).toBe(true);
  });

  /* EL CANDADO. Marketing sin consentimiento es lo que mancha el dominio. */
  it("un cupón NO sale sin consentimiento", () => {
    const v = puedeMandarCorreo("cupon", "a@b.mx", CONFIG, false);
    expect(v.puede).toBe(false);
    if (!v.puede) expect(v.razon).toContain("promociones");
  });

  it("con consentimiento, el cupón sí sale", () => {
    expect(puedeMandarCorreo("cupon", "a@b.mx", CONFIG, true).puede).toBe(true);
  });

  /* Lo que el restaurantero apagó, no se manda. Es su decisión, no la nuestra. */
  it("un tipo apagado no se manda ni siendo transaccional", () => {
    const v = puedeMandarCorreo("gracias", "a@b.mx", CONFIG, true);
    expect(v.puede).toBe(false);
    if (!v.puede) expect(v.razon).toContain("apagado");
  });

  it("sin remitente configurado no sale nada", () => {
    const v = puedeMandarCorreo("reserva_confirmada", "a@b.mx", configuracionVacia(), false);
    expect(v.puede).toBe(false);
  });

  it("sin el correo del comensal tampoco", () => {
    expect(puedeMandarCorreo("reserva_confirmada", undefined, CONFIG, false).puede).toBe(false);
    expect(puedeMandarCorreo("reserva_confirmada", "no-es-correo", CONFIG, false).puede).toBe(false);
  });
});

// --- Cómo se ve ---------------------------------------------------------------------------

describe("el correo que llega", () => {
  it("la confirmación dice cuándo, para cuántos y cómo llamar", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, {
      nombre: "Familia Ramírez",
      cuando: "viernes 24 de julio a las 21:00",
      personas: 4,
    });

    expect(c.asunto).toBe("Su reserva en Rodizio quedó confirmada");
    expect(c.html).toContain("viernes 24 de julio");
    expect(c.html).toContain("4 personas");
    // El botón de llamar es lo que convierte un correo en una vía de contacto.
    expect(c.html).toContain("tel:3311223344");
    expect(c.responder_a).toBe("hola@rodizio.mx");
  });

  /* Un correo solo-HTML puntúa peor en los filtros, y hay quien lee sin él. */
  it("siempre trae versión de texto", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, { cuando: "hoy" });
    expect(c.texto).toContain("Rodizio");
    expect(c.texto).not.toContain("<");
  });

  /*
   * Los clientes de correo —Outlook sobre todo— tiran el <style>. Con estilos
   * aparte, el correo llegaría desarmado.
   */
  it("los estilos van en línea, no en una hoja", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, {});
    expect(c.html).not.toContain("<style");
    expect(c.html).toContain("style=");
  });

  /*
   * Esconder la baja en letra chica es lo que convierte una queja en un reporte
   * de spam, y un reporte mancha el dominio para TODOS los correos del
   * restaurante, incluidas las confirmaciones.
   */
  it("todo lo de marketing lleva su baja, visible", () => {
    const c = armarCorreo("cupon", "a@b.mx", CONFIG, {
      mensaje: "2x1 los martes",
      baja: "https://rodizio.mx/baja?t=abc",
    });
    expect(c.html).toContain("Darse de baja");
    expect(c.html).toContain("baja?t=abc");
    expect(c.texto).toContain("Darse de baja");
  });

  it("lo transaccional NO lleva baja", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, { baja: "https://x/baja" });
    expect(c.html).not.toContain("Darse de baja");
  });

  /* Un nombre con < o " rompería el HTML del correo, o algo peor. */
  it("escapa lo que escribió una persona", () => {
    const c = armarCorreo("cupon", "a@b.mx", CONFIG, {
      mensaje: '<script>alert("x")</script>',
      baja: "https://x",
    });
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;");
  });

  it("el restaurante puede cambiar el asunto", () => {
    const propio: ConfiguracionCorreo = {
      ...CONFIG,
      asuntos: { reserva_confirmada: "¡Nos vemos en {{local}}, {{nombre}}!" },
    };
    const c = armarCorreo("reserva_confirmada", "a@b.mx", propio, { nombre: "Ana" });
    expect(c.asunto).toBe("¡Nos vemos en Rodizio, Ana!");
  });

  it("sin teléfono configurado, no ofrece llamar", () => {
    const sinTel = { ...CONFIG, telefono: undefined };
    const c = armarCorreo("reserva_confirmada", "a@b.mx", sinTel, {});
    expect(c.html).not.toContain("tel:");
  });
});

// --- De qué dominio sale ------------------------------------------------------------------

/*
 * Nadie puede mandar correo "como" una dirección cuyo dominio no controla. Un
 * restaurante con Gmail no puede mandar desde ahí, así que hay dos caminos: su
 * propio dominio, o un subdominio de MOTRAE con respuesta redirigida a su Gmail
 * de siempre.
 */
describe("de qué dominio sale el correo", () => {
  it("con dominio propio basta el remitente", () => {
    expect(
      problemasDeRemitente({ ...CONFIG, modo: "propio", responder_a: undefined }),
    ).toEqual([]);
  });

  /*
   * EL CANDADO DEL MODO COMPARTIDO. El correo sale de un dominio de MOTRAE: si
   * el comensal contesta —y contesta— su mensaje llegaría a un buzón que nadie
   * lee, y el restaurante ni se entera de que le escribieron.
   */
  it("con el dominio de MOTRAE, el correo de respuesta es obligatorio", () => {
    const problemas = problemasDeRemitente({
      ...CONFIG,
      modo: "motrae",
      remitente: "Rodizio <rodizio@avisos.motrest.mx>",
      responder_a: undefined,
    });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("no le llega a nadie");
  });

  it("con respuesta puesta, el modo compartido queda listo", () => {
    expect(
      problemasDeRemitente({
        ...CONFIG,
        modo: "motrae",
        remitente: "Rodizio <rodizio@avisos.motrest.mx>",
        // Su Gmail de siempre: no hace falta que compre nada.
        responder_a: "rodizio@gmail.com",
      }),
    ).toEqual([]);
  });

  it("sin remitente, lo dice y no sigue revisando", () => {
    const problemas = problemasDeRemitente(configuracionVacia());
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("Falta el remitente");
  });

  it("señala un correo de respuesta mal escrito", () => {
    const problemas = problemasDeRemitente({ ...CONFIG, responder_a: "no-es-correo" });
    expect(problemas.some((p) => p.includes("respuesta"))).toBe(true);
  });
});
