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
  estadosDeCorreo,
  esCuentaGmail,
  problemasDeRemitente,
  puedeMandarCorreo,
  remitenteGmail,
  type ConfiguracionCorreo,
  type EventoCorreo,
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
    /*
     * Sin «Responder a» desde la 1.5.5: el remitente ya ES el restaurante, así
     * que la respuesta le llega sola. Añadir otro solo abría la puerta a que las
     * respuestas fueran a una dirección vieja que nadie mira.
     */
    expect(c.responder_a).toBeUndefined();
  });

  /*
   * …salvo en modo MOTRAE, donde el correo sale de un buzón compartido que nadie
   * lee. Ahí quitarlo perdería cualquier respuesta, incluida una baja.
   */
  it("en modo MOTRAE el «Responder a» se conserva", () => {
    const c = armarCorreo(
      "reserva_confirmada",
      "a@b.mx",
      { ...CONFIG, modo: "motrae", remitente: "rodizio@avisos.motrest.mx" },
      { cuando: "hoy" },
    );
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
 * De dónde sale el correo. Hay tres caminos y el de fábrica es el más barato:
 * la propia cuenta de Gmail del restaurante, entregada por Google.
 */
describe("de dónde sale el correo", () => {
  /*
   * EL CAMINO DE FÁBRICA. Cero costo, cero trámite: el restaurante ya tiene su
   * Gmail. No se verifica un dominio —eso es lo que exige Resend y lo que un
   * @gmail.com nunca puede cumplir—: se entra a la cuenta por SMTP y Google
   * entrega firmando con su propio DKIM.
   */
  it("una cuenta de Gmail queda lista con solo el remitente", () => {
    expect(
      problemasDeRemitente({
        ...CONFIG,
        modo: "gmail",
        remitente: "Rodizio <rodizio.gdl@gmail.com>",
        cuenta_gmail: "rodizio.gdl@gmail.com",
      }),
    ).toEqual([]);
  });

  /*
   * EL ERROR QUE NO SE VE. Google entrega SIEMPRE desde la cuenta con la que uno
   * se autenticó: si el remitente dice otra cosa, la reescribe. El correo sale,
   * nadie ve un error, y llega con una dirección que no es la que el restaurante
   * puso. Por eso se avisa aquí y no cuando ya salieron doscientos.
   */
  it("avisa si el remitente no es la cuenta con la que se entra", () => {
    const problemas = problemasDeRemitente({
      ...CONFIG,
      modo: "gmail",
      remitente: "Rodizio <reservas@rodizio.mx>",
      cuenta_gmail: "rodizio.gdl@gmail.com",
    });
    expect(problemas.some((x) => x.includes("tiene que ser la cuenta @gmail.com"))).toBe(true);
  });

  it("el arranque de fábrica es Gmail, que no cuesta nada", () => {
    expect(configuracionVacia("Rodizio").modo).toBe("gmail");
  });

  it("reconoce las cuentas de Google, con nombre delante o sin él", () => {
    expect(esCuentaGmail("rodizio@gmail.com")).toBe(true);
    expect(esCuentaGmail("Rodizio <rodizio@GoogleMail.com>")).toBe(true);
    expect(esCuentaGmail("reservas@rodizio.mx")).toBe(false);
  });

  /* El nombre delante es lo que hace que el comensal lea "Rodizio". */
  it("el remitente de Gmail lleva el nombre del restaurante", () => {
    expect(remitenteGmail("Rodizio", "rodizio@gmail.com")).toBe("Rodizio <rodizio@gmail.com>");
  });

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

/**
 * El asunto acaba siendo una cabecera de correo, y en una cabecera un salto de
 * línea abre otra cabecera. `{{nombre}}` sale de una reserva del portal público:
 * cualquiera con el QR de la mesa escribe lo que quiera.
 *
 * `smtp.ts` lo vuelve a aplanar antes de armar el MIME, y esa repetición es a
 * propósito: esta capa protege también al camino de Resend, que no pasa por
 * allá, y la de allá protege aunque un día alguien arme un asunto sin pasar por
 * aquí. Ninguna de las dos sobra por existir la otra.
 */
describe("lo que se interpola en el asunto", () => {
  it("un nombre con salto de línea sale en una sola línea", () => {
    const c = armarCorreo(
      "reserva_confirmada",
      "a@b.mx",
      { ...CONFIG, asuntos: { reserva_confirmada: "Reserva de {{nombre}}" } },
      { nombre: "Ana\r\nBcc: quien-sea@ejemplo.com" },
    );

    expect(c.asunto).not.toMatch(/[\r\n]/);
    expect(c.asunto).toBe("Reserva de Ana Bcc: quien-sea@ejemplo.com");
  });

  it("tampoco cuela por el nombre del local ni por la fecha", () => {
    const c = armarCorreo(
      "reserva_confirmada",
      "a@b.mx",
      { ...CONFIG, local: "Rodizio\r\nBcc: x@y.z", asuntos: { reserva_confirmada: "{{local}} · {{cuando}}" } },
      { cuando: "viernes\r\nX-Cualquiera: si" },
    );

    expect(c.asunto).not.toMatch(/[\r\n]/);
  });

  it("un asunto normal no se toca", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, { nombre: "Familia Ramírez" });
    expect(c.asunto).toBe("Su reserva en Rodizio quedó confirmada");
  });
});

/**
 * LA BAJA DE LA PUBLICIDAD, AUNQUE NO HAYA PÁGINA DE BAJA.
 *
 * El pie solo salía `if (datos.baja)`, y la página pública de baja nunca
 * existió. Así que toda campaña se habría ido sin ninguna forma de darse de
 * baja: contra la ley de datos personales, y camino directo a los reportes de
 * spam que dejan la cuenta del restaurante sin entregar nada.
 */
describe("la publicidad siempre lleva su baja", () => {
  const MARKETING = { ...CONFIG, activos: { cupon: true, te_extranamos: true } };

  it("sin página de baja, pide responder BAJA", () => {
    const c = armarCorreo("cupon", "a@b.mx", MARKETING, { mensaje: "2×1 los martes" });
    expect(c.html).toContain("responda <b>BAJA</b>");
    expect(c.texto).toContain("responda BAJA");
  });

  it("con página de baja, usa el enlace", () => {
    const c = armarCorreo("cupon", "a@b.mx", MARKETING, {
      mensaje: "2×1",
      baja: "https://motrest.mx/baja/x",
    });
    expect(c.html).toContain("https://motrest.mx/baja/x");
    expect(c.html).not.toContain("responda <b>BAJA</b>");
  });

  it("lo de «hace mucho que no viene» también la lleva", () => {
    const c = armarCorreo("te_extranamos", "a@b.mx", MARKETING, { mensaje: "Lo extrañamos" });
    expect(c.html).toContain("BAJA");
  });

  /* Lo que el comensal provocó NO lleva baja: darse de baja de SU reserva no tiene sentido. */
  it("lo transaccional no lleva baja", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, { cuando: "hoy" });
    expect(c.html).not.toContain("BAJA");
  });
});

/**
 * LA ENCUESTA APUNTA AL ENLACE DEL RESTAURANTE.
 *
 * Estaba pensada para el portal público, que nunca salió a internet: el correo
 * preguntaba «¿nos ayuda con una pregunta rápida?» sin ningún botón. Ahora
 * apunta a lo que el local configure —sus reseñas de Google o un formulario— y
 * sin ese enlace no sale.
 */
describe("la encuesta y su enlace", () => {
  const CON_ENLACE = { ...CONFIG, enlace_encuesta: "https://g.page/r/rodizio/review" };

  it("lleva el enlace del restaurante como botón que dice qué hace", () => {
    const c = armarCorreo("encuesta", "a@b.mx", CON_ENLACE, {});
    expect(c.html).toContain("https://g.page/r/rodizio/review");
    expect(c.html).toContain("Dejar mi opinión");
    expect(c.html).not.toContain(">Abrir<");
  });

  it("sin enlace no se manda: preguntaría sin dejar contestar", () => {
    const v = puedeMandarCorreo("encuesta", "a@b.mx", CONFIG, false);
    expect(v.puede).toBe(false);
    if (!v.puede) expect(v.razon).toContain("enlace de la encuesta");
  });

  it("con enlace sí se manda", () => {
    expect(puedeMandarCorreo("encuesta", "a@b.mx", CON_ENLACE, false).puede).toBe(true);
  });
});

/**
 * EL IDA Y VUELTA DE UN CORREO PEDIDO A MANO.
 *
 * `correo_enviado` y `correo_rechazado` existían y nadie los emitía. Ahora son la
 * respuesta del Hub a un `correo_solicitado`, atados por `solicitud_id`, y de
 * aquí sale lo que la ficha del comensal enseña.
 */
describe("el estado de un correo pedido", () => {
  const base = { sucursal_id: "suc-1", device_id: "caja", empleado_id: "usr-1", orden_local: 0, v: 1, stream_id: "correo:suc-1" };
  const pedido = (id: string, ts: number): EventoCorreo => ({
    ...base, id: `p-${id}`, ts, tipo: "correo_solicitado", solicitud_id: id,
    clase_correo: "gracias", correo: "a@b.mx", cliente_id: "cli-1", datos: {}, acepta_marketing: false,
  } as EventoCorreo);

  it("recién pedido queda pendiente", () => {
    const e = estadosDeCorreo([pedido("s1", 100)]);
    expect(e.get("s1")?.estado).toBe("pendiente");
  });

  it("cuando el Hub lo manda, queda enviado", () => {
    const e = estadosDeCorreo([
      pedido("s1", 100),
      { ...base, id: "r1", ts: 200, tipo: "correo_enviado", correo: "a@b.mx", clase_correo: "gracias", solicitud_id: "s1" } as EventoCorreo,
    ]);
    expect(e.get("s1")?.estado).toBe("enviado");
  });

  it("si el Hub lo rechaza, queda el motivo a la vista", () => {
    const e = estadosDeCorreo([
      pedido("s1", 100),
      { ...base, id: "r1", ts: 200, tipo: "correo_rechazado", correo: "a@b.mx", clase_correo: "gracias", solicitud_id: "s1", motivo: "Falta la contraseña de Gmail" } as EventoCorreo,
    ]);
    const s = e.get("s1");
    expect(s?.estado).toBe("rechazado");
    if (s?.estado === "rechazado") expect(s.motivo).toContain("Gmail");
  });

  /* La respuesta puede llegar antes que la petición si el Hub las entrega en lote desordenado. */
  it("no importa el orden en que lleguen", () => {
    const e = estadosDeCorreo([
      { ...base, id: "r1", ts: 200, tipo: "correo_enviado", correo: "a@b.mx", clase_correo: "gracias", solicitud_id: "s1" } as EventoCorreo,
      pedido("s1", 100),
    ]);
    expect(e.get("s1")?.estado).toBe("enviado");
  });
});
