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
  ARRANQUES_DE_CORREO,
  CATALOGO_CORREOS,
  EJEMPLOS_DE_CORREO,
  TOPES_CORREO,
  armarCorreo,
  catalogoDeCorreos,
  configuracionVacia,
  correoPlausible,
  definicionCorreo,
  esEnlaceSeguro,
  esTipoPropio,
  estaEditado,
  estadosDeCorreo,
  esCuentaGmail,
  limpiarBorrador,
  marcadoresDe,
  pideMensaje,
  plantillaDe,
  problemasDeRemitente,
  problemasDelBorrador,
  propiosDe,
  puedeMandarCorreo,
  remitenteGmail,
  type ConfiguracionCorreo,
  type CorreoPropio,
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

// --- Los correos que escribe el restaurante (1.5.6) -----------------------------------------

/**
 * LOS SEIS SE PUEDEN EDITAR, Y SE PUEDEN CREAR MÁS.
 *
 * Gonzalo: «que los restauranteros puedan escribir ellos mismos cómo quieren
 * que sea ese tipo de correo», y que puedan crear los suyos, que nacen ya
 * redactados. Lo que el restaurante escribe son PALABRAS dentro del diseño de la
 * casa: se escapan como lo que escribe un comensal, y la baja la sigue poniendo
 * `armarCorreo`, no la plantilla.
 */
describe("los seis de fábrica, editados por el restaurante", () => {
  const AVISOS = { ...CONFIG, activos: { ...CONFIG.activos, gracias: true } };

  /*
   * EL EJEMPLO ES EL CORREO DE SIEMPRE. Un restaurante que nunca toca «Editar»
   * tiene que seguir mandando exactamente lo que mandaba el código de antes, con
   * las mismas negritas.
   */
  it("sin editar, sale el mismo correo que antes de la 1.5.6", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, {
      nombre: "Familia Ramírez",
      cuando: "viernes 24 de julio a las 21:00",
      personas: 4,
    });
    expect(c.html).toContain('<h1 style="font-size:20px;margin:0 0 16px">Rodizio</h1>');
    expect(c.html).toContain("Su reserva en <b>Rodizio</b> quedó confirmada.");
    expect(c.html).toContain("<b>viernes 24 de julio a las 21:00</b>");
    expect(c.html).toContain("Para 4 personas.");
    expect(c.html).toContain("Si necesita cambiarla o cancelarla");
    expect(estaEditado("reserva_confirmada", CONFIG)).toBe(false);
  });

  it("«1 persona», no «1 personas»", () => {
    const c = armarCorreo("reserva_confirmada", "a@b.mx", CONFIG, { cuando: "hoy", personas: 1 });
    expect(c.html).toContain("Para 1 persona.");
  });

  it("una plantilla editada es la que sale, en el HTML y en el texto", () => {
    const editada: ConfiguracionCorreo = {
      ...AVISOS,
      asuntos: { gracias: "Gracias, {{nombre}}" },
      plantillas: {
        gracias: {
          titulo: "¡Qué gusto, {{nombre}}!",
          texto: "Fue un placer tenerlo en {{local}}.\n\nLa próxima, el café va por nuestra cuenta.",
        },
      },
    };
    const c = armarCorreo("gracias", "a@b.mx", editada, { nombre: "Ana" });

    expect(c.asunto).toBe("Gracias, Ana");
    expect(c.html).toContain(">¡Qué gusto, Ana!</h1>");
    expect(c.html).toContain("Fue un placer tenerlo en <b>Rodizio</b>.");
    expect(c.html).toContain("La próxima, el café va por nuestra cuenta.");
    // Dos párrafos, no uno: la línea en blanco separa.
    expect(c.html.match(/line-height:1\.6/g)).toHaveLength(2);
    expect(c.html).not.toContain("Lo esperamos pronto");
    expect(c.texto).toContain("Fue un placer tenerlo en Rodizio.");
    // Las marcas internas de las negritas no se cuelan en la versión de texto.
    expect(c.texto).not.toMatch(/[\u0001-\u0003]/);
    expect(estaEditado("gracias", editada)).toBe(true);
  });

  it("lo que no se editó sigue saliendo del ejemplo, campo por campo", () => {
    const soloTitulo: ConfiguracionCorreo = {
      ...AVISOS,
      plantillas: { gracias: { titulo: "Gracias de parte de todo {{local}}" } },
    };
    const p = plantillaDe("gracias", soloTitulo)!;
    expect(p.titulo).toBe("Gracias de parte de todo {{local}}");
    expect(p.texto).toBe(EJEMPLOS_DE_CORREO.gracias.texto);
    expect(p.asunto).toBe(definicionCorreo("gracias")!.asuntoPorDefecto);
  });

  /*
   * «VOLVER AL EJEMPLO» ES BORRAR LO SUYO. Un campo vacío no manda un correo
   * vacío: vuelve el ejemplo.
   */
  it("volver al ejemplo: sin lo suyo, o con campos vacíos, sale el de fábrica", () => {
    const vacia: ConfiguracionCorreo = {
      ...AVISOS,
      asuntos: { gracias: "  " },
      plantillas: { gracias: { titulo: "", texto: "   ", boton: "" } },
    };
    const c = armarCorreo("gracias", "a@b.mx", vacia, { nombre: "Ana" });
    expect(c.asunto).toBe("Gracias por su visita a Rodizio");
    expect(c.html).toContain("Gracias por venir a <b>Rodizio</b>. Lo esperamos pronto.");
    expect(estaEditado("gracias", vacia)).toBe(false);
  });

  it("los marcadores se sustituyen por los datos de verdad", () => {
    const editada: ConfiguracionCorreo = {
      ...CONFIG,
      asuntos: { reserva_confirmada: "{{nombre}}, lo esperamos {{cuando}}" },
      plantillas: {
        reserva_confirmada: {
          texto: "{{nombre}}: su mesa para {{personas}} en {{local}} está lista para el {{cuando}}.",
        },
      },
    };
    const c = armarCorreo("reserva_confirmada", "a@b.mx", editada, {
      nombre: "Ana",
      cuando: "viernes a las 21:00",
      personas: 4,
    });
    expect(c.asunto).toBe("Ana, lo esperamos viernes a las 21:00");
    expect(c.html).toContain(
      "Ana: su mesa para 4 personas en <b>Rodizio</b> está lista para el <b>viernes a las 21:00</b>.",
    );
    expect(c.html).not.toContain("{{");
    expect(c.texto).not.toContain("{{");
  });

  it("un dato que no viene se lleva su renglón; el nombre, solo su puntuación", () => {
    const editada: ConfiguracionCorreo = {
      ...CONFIG,
      asuntos: { reserva_confirmada: "¡Nos vemos en {{local}}, {{nombre}}!" },
      plantillas: {
        reserva_confirmada: {
          texto: "Hola {{nombre}}, qué gusto.\nPara {{personas}}.\n{{cuando}}\nLo esperamos.",
        },
      },
    };
    const c = armarCorreo("reserva_confirmada", "a@b.mx", editada, {});
    expect(c.asunto).toBe("¡Nos vemos en Rodizio!");
    expect(c.html).toContain("Hola, qué gusto.<br>Lo esperamos.");
    expect(c.html).not.toContain("Para .");
  });

  /*
   * LO QUE ESCRIBE EL RESTAURANTE SE ESCAPA IGUAL QUE LO DEL COMENSAL. Una
   * tableta manipulada, o un texto pegado de una página web, no pueden meter
   * etiquetas en el correo que sale con el nombre del restaurante.
   */
  it("el texto malicioso del restaurante sale escapado, en todos los campos", () => {
    const maliciosa: ConfiguracionCorreo = {
      ...CONFIG,
      enlace_encuesta: "https://g.page/r/rodizio/review",
      activos: { encuesta: true },
      asuntos: { encuesta: "Hola\r\nBcc: espia@ejemplo.com" },
      plantillas: {
        encuesta: {
          titulo: '<img src=x onerror="alert(1)">',
          texto: '<script>alert("x")</script>\n\n<a href="javascript:alert(1)">aquí</a>',
          boton: '"><script>alert(2)</script>',
        },
      },
    };
    const c = armarCorreo("encuesta", "a@b.mx", maliciosa, { nombre: "Ana" });

    expect(c.html).not.toMatch(/<script|<img|<a href="javascript/i);
    expect(c.html).toContain("&lt;script&gt;");
    expect(c.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(c.asunto).not.toMatch(/[\r\n]/);
  });

  it("un enlace de datos que no es web ya no se vuelve botón", () => {
    const c = armarCorreo("gracias", "a@b.mx", AVISOS, { enlace: "javascript:alert(1)" });
    expect(c.html).not.toContain("javascript:");
  });

  it("el botón de la encuesta dice lo que escribió el restaurante", () => {
    const c = armarCorreo(
      "encuesta",
      "a@b.mx",
      {
        ...CONFIG,
        enlace_encuesta: "https://g.page/r/rodizio/review",
        plantillas: { encuesta: { boton: "Calificarnos en Google" } },
      },
      {},
    );
    expect(c.html).toContain(">Calificarnos en Google</a>");
    expect(c.texto).toContain("Calificarnos en Google: https://g.page/r/rodizio/review");
  });

  /*
   * El cupón de fábrica es solo `{{mensaje}}`: pide mensaje al mandarlo, como
   * siempre. Si el restaurante lo deja escrito, ya no.
   */
  it("el cupón pide mensaje mientras su texto lo lleve", () => {
    expect(pideMensaje("cupon", CONFIG)).toBe(true);
    expect(pideMensaje("gracias", CONFIG)).toBe(false);
    const escrito = { ...CONFIG, plantillas: { cupon: { texto: "2×1 todos los martes." } } };
    expect(pideMensaje("cupon", escrito)).toBe(false);
    const c = armarCorreo("cupon", "a@b.mx", escrito, {});
    expect(c.html).toContain("2×1 todos los martes.");
    expect(c.html).toContain("responda <b>BAJA</b>");
  });

  it("el mensaje de varios renglones respeta sus párrafos", () => {
    const c = armarCorreo("cupon", "a@b.mx", CONFIG, { mensaje: "2×1 en pizzas.\n\nSolo el martes." });
    expect(c.html.match(/line-height:1\.6/g)).toHaveLength(2);
  });
});

describe("los correos nuevos del restaurante", () => {
  const EVENTO: CorreoPropio = {
    tipo: "propio:evento-1",
    nombre: "Noche italiana",
    asunto: "Una noche italiana en {{local}}",
    titulo: "Lo invitamos, {{nombre}}",
    texto: "El viernes preparamos una noche italiana en {{local}}.\n\nLo esperamos.",
    boton: "Apartar mi lugar",
    enlace: "https://rodizio.mx/noche-italiana",
    activo: true,
  };
  const CON_EVENTO: ConfiguracionCorreo = { ...CONFIG, propios: [EVENTO] };

  /* LA DECISIÓN DE GONZALO: los nuevos son siempre publicidad. */
  it("son publicidad siempre, hasta sin la configuración a mano", () => {
    expect(esTipoPropio("propio:evento-1")).toBe(true);
    expect(esTipoPropio("propio:")).toBe(false);
    expect(esTipoPropio("cupon")).toBe(false);
    expect(definicionCorreo("propio:evento-1")!.clase).toBe("marketing");
    expect(definicionCorreo("propio:evento-1", CON_EVENTO)!.etiqueta).toBe("Noche italiana");
    expect(definicionCorreo("propio:borrado", CON_EVENTO)!.clase).toBe("marketing");
  });

  it("aparecen en el catálogo detrás de los seis", () => {
    const catalogo = catalogoDeCorreos(CON_EVENTO);
    expect(catalogo).toHaveLength(7);
    expect(catalogo[6]!.tipo).toBe("propio:evento-1");
    expect(catalogoDeCorreos(CONFIG)).toHaveLength(6);
  });

  it("solo llegan a quien aceptó promociones", () => {
    const sin = puedeMandarCorreo("propio:evento-1", "a@b.mx", CON_EVENTO, false);
    expect(sin.puede).toBe(false);
    if (!sin.puede) expect(sin.razon).toContain("no aceptó recibir promociones");
    expect(puedeMandarCorreo("propio:evento-1", "a@b.mx", CON_EVENTO, true).puede).toBe(true);
  });

  it("apagado no sale, y borrado se rechaza diciendo que ya no existe", () => {
    const apagado = { ...CONFIG, propios: [{ ...EVENTO, activo: false }] };
    const v1 = puedeMandarCorreo("propio:evento-1", "a@b.mx", apagado, true);
    expect(v1.puede).toBe(false);
    if (!v1.puede) expect(v1.razon).toContain("apagado");

    const v2 = puedeMandarCorreo("propio:evento-1", "a@b.mx", CONFIG, true);
    expect(v2.puede).toBe(false);
    if (!v2.puede) expect(v2.razon).toContain("ya no existe");
  });

  it("se arma con su texto, su botón y SIEMPRE su baja", () => {
    const c = armarCorreo("propio:evento-1", "a@b.mx", CON_EVENTO, { nombre: "Ana" });
    expect(c.asunto).toBe("Una noche italiana en Rodizio");
    expect(c.html).toContain(">Lo invitamos, Ana</h1>");
    expect(c.html).toContain("El viernes preparamos una noche italiana en <b>Rodizio</b>.");
    expect(c.html).toContain('href="https://rodizio.mx/noche-italiana"');
    expect(c.html).toContain(">Apartar mi lugar</a>");
    expect(c.html).toContain("responda <b>BAJA</b>");
    expect(c.texto).toContain("Para no recibir más, responda BAJA");
  });

  it("ni escribiendo sobre la baja se quita: el pie va después de todo lo suyo", () => {
    const tramposo = {
      ...CONFIG,
      propios: [{ ...EVENTO, texto: 'Oferta.\n\n<p style="display:none">' }],
    };
    const c = armarCorreo("propio:evento-1", "a@b.mx", tramposo, {});
    expect(c.html).not.toContain('<p style="display:none">');
    expect(c.html.indexOf("responda <b>BAJA</b>")).toBeGreaterThan(c.html.indexOf("Oferta."));
  });

  /*
   * SOLO `https://`. Se comprueba al guardar y otra vez al armar: una
   * configuración que llegue por otro camino no pone un `javascript:` en un
   * botón con el nombre del restaurante encima.
   */
  it("el enlace del botón solo puede ser https", () => {
    expect(esEnlaceSeguro("https://rodizio.mx/menu")).toBe(true);
    for (const malo of [
      "http://rodizio.mx/menu",
      "javascript:alert(1)",
      "data:text/html,hola",
      "rodizio.mx/menu",
      "https://banco.mx@otro.sitio/",
      "https://localhost/",
      "https://rodizio.mx/ con espacio",
      `https://rodizio.mx/${"x".repeat(TOPES_CORREO.enlace)}`,
    ]) {
      expect(esEnlaceSeguro(malo), malo).toBe(false);
    }

    const conJs = { ...CONFIG, propios: [{ ...EVENTO, enlace: "javascript:alert(1)" }] };
    const c = armarCorreo("propio:evento-1", "a@b.mx", conJs, {});
    expect(c.html).not.toContain("javascript:");
    expect(c.html).not.toContain("Apartar mi lugar");
  });

  it("con {{mensaje}}, lo que se escribe al mandarlo va en su lugar", () => {
    const delDia = {
      ...CONFIG,
      propios: [{ ...EVENTO, texto: "{{mensaje}}\n\nVálido solo hoy." }],
    };
    expect(pideMensaje("propio:evento-1", delDia)).toBe(true);
    const c = armarCorreo("propio:evento-1", "a@b.mx", delDia, { mensaje: "Lasaña al 2×1" });
    expect(c.html).toContain("Lasaña al 2×1");
    expect(c.html).toContain("Válido solo hoy.");
  });

  /*
   * Un catálogo inflado o mal formado —una tableta vieja, un respaldo editado a
   * mano— no puede colar más correos de los que caben ni tumbar la pantalla.
   */
  it("la lista se sanea: sin basura, sin repetidos y hasta el tope", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ ...EVENTO, tipo: `propio:p${i}` as const }));
    const sucia = {
      ...CONFIG,
      propios: [
        null,
        { tipo: "cupon", nombre: "x", asunto: "x", texto: "x" },
        { ...EVENTO, texto: 5 },
        EVENTO,
        EVENTO,
        ...muchos,
      ] as unknown as CorreoPropio[],
    };
    const sanos = propiosDe(sucia);
    expect(sanos).toHaveLength(TOPES_CORREO.propios);
    expect(sanos[0]!.tipo).toBe("propio:evento-1");
    expect(new Set(sanos.map((p) => p.tipo)).size).toBe(sanos.length);
  });

  it("un texto enorme que llegue por otro camino se corta al armar", () => {
    const enorme = { ...CONFIG, propios: [{ ...EVENTO, texto: "a".repeat(50_000) }] };
    const c = armarCorreo("propio:evento-1", "a@b.mx", enorme, {});
    expect(c.html.length).toBeLessThan(TOPES_CORREO.texto + 3_000);
  });
});

describe("lo que no deja guardar el editor", () => {
  const bien = { asunto: "Gracias", titulo: "{{local}}", texto: "Gracias por venir, {{nombre}}." };

  it("un correo bien escrito no tiene problemas", () => {
    expect(problemasDelBorrador("gracias", bien)).toEqual([]);
  });

  it("falta el asunto o el texto: se dice, marcado como vacío", () => {
    const p = problemasDelBorrador("gracias", { asunto: " ", titulo: "", texto: "" });
    expect(p.map((x) => x.campo)).toEqual(["asunto", "texto"]);
    expect(p.every((x) => x.vacio)).toBe(true);
  });

  it("un marcador que no aplica, uno inventado y el mensaje fuera del texto", () => {
    const p = problemasDelBorrador("gracias", {
      asunto: "Su reserva {{cuando}}",
      titulo: "{{nombre_completo}}",
      texto: "{{mensaje}}",
    });
    expect(p.find((x) => x.campo === "asunto")?.mensaje).toContain("no aplica");
    expect(p.find((x) => x.campo === "titulo")?.mensaje).toContain("no es un dato");
    // `{{mensaje}}` no aplica a «gracias», que no se escribe al mandarlo.
    expect(p.find((x) => x.campo === "texto")?.mensaje).toContain("no aplica");

    const enAsunto = problemasDelBorrador("cupon", { asunto: "{{mensaje}}", titulo: "", texto: "{{mensaje}}" });
    expect(enAsunto).toHaveLength(1);
    expect(enAsunto[0]!.mensaje).toContain("solo puede ir en el texto");
  });

  it("los marcadores que ofrece cada correo son los que puede llenar", () => {
    expect(marcadoresDe("gracias").map((m) => m.clave)).toEqual(["nombre", "local"]);
    expect(marcadoresDe("reserva_recordatorio").map((m) => m.clave)).toEqual([
      "nombre",
      "local",
      "cuando",
      "personas",
    ]);
    expect(marcadoresDe("propio:x").map((m) => m.clave)).toContain("mensaje");
  });

  it("demasiado largo no se guarda", () => {
    const p = problemasDelBorrador("gracias", { ...bien, texto: "a".repeat(TOPES_CORREO.texto + 1) });
    expect(p[0]!.mensaje).toContain("demasiado largo");
  });

  it("un propio necesita nombre, y su enlace tiene que ser https", () => {
    const p = problemasDelBorrador("propio:x", {
      ...bien,
      nombre: "",
      boton: "Ver",
      enlace: "http://rodizio.mx",
    });
    expect(p.map((x) => x.campo)).toEqual(["nombre", "enlace"]);
    expect(p[1]!.mensaje).toContain("https://");
  });

  it("un botón sin enlace se avisa", () => {
    const p = problemasDelBorrador("propio:x", { ...bien, nombre: "X", boton: "Ver el menú", enlace: "" });
    expect(p[0]!.mensaje).toContain("necesita a dónde llevar");
  });

  it("limpia lo que se pega de otro programa", () => {
    const l = limpiarBorrador({
      nombre: "  Evento \t",
      asunto: "Hola\r\nmundo",
      titulo: " x ",
      texto: "  uno\r\n\r\ndos\u0007  ",
    });
    expect(l).toEqual({ nombre: "Evento", asunto: "Hola mundo", titulo: "x", texto: "uno\n\ndos" });
  });
});

/**
 * LOS CORREOS NUEVOS NACEN ESCRITOS. Cada arranque es un correo completo; lo
 * único que no dejan guardar son los huecos entre corchetes, que es lo que solo
 * sabe el restaurante.
 */
describe("los arranques de un correo nuevo", () => {
  it("están los que pidió el plan, y uno en blanco", () => {
    const ids = ARRANQUES_DE_CORREO.map((a) => a.id);
    expect(ids).toEqual(["evento", "temporada", "aniversario", "promocion-del-dia", "en-blanco"]);
  });

  it("solo les falta lo que va entre corchetes, y el enlace si traen botón", () => {
    for (const a of ARRANQUES_DE_CORREO.filter((x) => x.id !== "en-blanco")) {
      const problemas = problemasDelBorrador("propio:nuevo", a.borrador);
      for (const p of problemas) {
        expect(p.mensaje, `${a.id}: ${p.mensaje}`).toMatch(/entre corchetes|necesita a dónde llevar/);
      }
    }
  });

  it("con los huecos llenos, se guardan", () => {
    const evento = ARRANQUES_DE_CORREO.find((a) => a.id === "evento")!;
    const lleno = {
      ...evento.borrador,
      texto: evento.borrador.texto
        .replace("[día]", "viernes 3 de octubre")
        .replace("[hora]", "las 20:00")
        .replace("[qué habrá esa noche]", "música en vivo"),
    };
    expect(problemasDelBorrador("propio:nuevo", lleno)).toEqual([]);
  });

  it("la promoción del día pide su mensaje al mandarla", () => {
    const promo = ARRANQUES_DE_CORREO.find((a) => a.id === "promocion-del-dia")!;
    expect(problemasDelBorrador("propio:nuevo", promo.borrador)).toEqual([]);
    expect(promo.borrador.texto).toContain("{{mensaje}}");
  });
});
