/**
 * El núcleo del relay.
 *
 * Lo que hay que probar es la puerta de la calle: que un webhook sin la firma
 * de Meta NO entre, que un mensaje repetido no se procese dos veces, y que un
 * número que no es de ningún restaurante nuestro se ignore sin decir nada.
 *
 * Este servicio es el único de MotRest expuesto a internet. Todo lo demás vive
 * en el local, y así debe seguir.
 */
import { describe, expect, it } from "vitest";
import { YaVistos, cuerpoDeEnvio, firmaValida, leerWebhook, type Inquilino } from "../nucleo.js";

const SECRETO = "secreto-de-la-app-de-motrae";

const RODIZIO: Inquilino = {
  sucursal_id: "suc-rodizio",
  phone_number_id: "111222333",
  token: "token-de-rodizio",
  nombre: "Rodizio",
};
const FONDA: Inquilino = {
  sucursal_id: "suc-fonda",
  phone_number_id: "999888777",
  token: "token-de-la-fonda",
  nombre: "La Fonda",
};

const INQUILINOS = new Map([
  [RODIZIO.phone_number_id, RODIZIO],
  [FONDA.phone_number_id, FONDA],
]);

/** Firma un cuerpo como lo haría Meta. */
async function firmar(cuerpo: string, secreto = SECRETO): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpo)),
  );
  return `sha256=${[...firma].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function webhook(numeroId: string, texto: string, id = "wamid.1"): unknown {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: numeroId },
              messages: [
                { from: "5213311223344", id, timestamp: "1785000000", text: { body: texto } },
              ],
            },
          },
        ],
      },
    ],
  };
}

// --- La puerta de la calle ----------------------------------------------------------------

describe("solo entra lo que de verdad manda Meta", () => {
  it("acepta un cuerpo bien firmado", async () => {
    const cuerpo = JSON.stringify(webhook(RODIZIO.phone_number_id, "hola"));
    expect(await firmaValida(cuerpo, await firmar(cuerpo), SECRETO)).toBe(true);
  });

  /*
   * Sin esta comprobación, cualquiera que descubra la URL puede inyectar
   * mensajes: dar de alta reservas falsas, disparar encuestas, o algo peor.
   */
  it("rechaza un cuerpo manipulado", async () => {
    const original = JSON.stringify(webhook(RODIZIO.phone_number_id, "hola"));
    const firma = await firmar(original);
    const alterado = JSON.stringify(webhook(RODIZIO.phone_number_id, "otra cosa"));
    expect(await firmaValida(alterado, firma, SECRETO)).toBe(false);
  });

  it("rechaza una firma hecha con otro secreto", async () => {
    const cuerpo = JSON.stringify(webhook(RODIZIO.phone_number_id, "hola"));
    expect(await firmaValida(cuerpo, await firmar(cuerpo, "otro"), SECRETO)).toBe(false);
  });

  it("rechaza cuando no hay cabecera o viene basura", async () => {
    expect(await firmaValida("{}", undefined, SECRETO)).toBe(false);
    expect(await firmaValida("{}", "basura", SECRETO)).toBe(false);
    expect(await firmaValida("{}", "sha256=abc", SECRETO)).toBe(false);
  });
});

// --- A qué restaurante le toca ------------------------------------------------------------

describe("enrutar al restaurante correcto", () => {
  it("identifica el local por el número de Meta", () => {
    const [m] = leerWebhook(webhook(RODIZIO.phone_number_id, "quiero reservar"), INQUILINOS);
    expect(m!.sucursal_id).toBe("suc-rodizio");
    expect(m!.contacto).toBe("5213311223344");
    expect(m!.texto).toBe("quiero reservar");
  });

  it("cada número va a su propio local", () => {
    const [m] = leerWebhook(webhook(FONDA.phone_number_id, "hola"), INQUILINOS);
    expect(m!.sucursal_id).toBe("suc-fonda");
  });

  /* Contestar algo le confirmaría a quien prueba la URL que el relay existe. */
  it("un número desconocido se ignora en silencio", () => {
    expect(leerWebhook(webhook("000", "hola"), INQUILINOS)).toEqual([]);
  });

  it("convierte el sello de Meta a milisegundos", () => {
    const [m] = leerWebhook(webhook(RODIZIO.phone_number_id, "hola"), INQUILINOS);
    expect(m!.ts).toBe(1785000000 * 1000);
  });

  /*
   * Por el mismo canal llegan recibos de entrega y cambios de estado. Un
   * `undefined` inesperado no puede tumbar el relay de todos los restaurantes.
   */
  it("no se cae con lo que no son mensajes", () => {
    const entregas = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: RODIZIO.phone_number_id },
                statuses: [{ id: "wamid.9", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(leerWebhook(entregas, INQUILINOS)).toEqual([]);
    expect(leerWebhook({}, INQUILINOS)).toEqual([]);
    expect(leerWebhook(null, INQUILINOS)).toEqual([]);
  });

  /* Una encuesta se contesta con botones, no escribiendo. */
  it("entiende la respuesta de un botón", () => {
    const conBoton = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: RODIZIO.phone_number_id },
                messages: [
                  {
                    from: "521331",
                    id: "wamid.2",
                    timestamp: "1785000000",
                    interactive: { button_reply: { title: "Muy bien" } },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(leerWebhook(conBoton, INQUILINOS)[0]!.texto).toBe("Muy bien");
  });
});

// --- Meta reintenta -----------------------------------------------------------------------

describe("no procesar dos veces lo mismo", () => {
  /*
   * Meta REINTENTA si no recibe un 200 a tiempo. Sin esto, una encuesta se
   * registraría dos veces y una baja podría revertirse por una entrega vieja.
   */
  it("reconoce un mensaje repetido", () => {
    const vistos = new YaVistos();
    expect(vistos.repetido("wamid.1")).toBe(false);
    expect(vistos.repetido("wamid.1")).toBe(true);
    expect(vistos.repetido("wamid.2")).toBe(false);
  });

  it("olvida los viejos para no crecer sin fin", () => {
    const vistos = new YaVistos(1000);
    const t0 = Date.now();
    vistos.repetido("wamid.1", t0);
    expect(vistos.repetido("wamid.1", t0 + 5000)).toBe(false);
    expect(vistos.tamano).toBe(1);
  });

  it("un mensaje sin id no bloquea nada", () => {
    const vistos = new YaVistos();
    expect(vistos.repetido("")).toBe(false);
    expect(vistos.repetido("")).toBe(false);
  });
});

// --- Lo que se le manda a Meta ------------------------------------------------------------

describe("armar el envío", () => {
  it("texto libre, para dentro de la ventana de 24 h", () => {
    const cuerpo = cuerpoDeEnvio({
      sucursal_id: "suc-rodizio",
      contacto: "521331",
      texto: "Su mesa está lista",
    });
    expect(cuerpo).toMatchObject({
      messaging_product: "whatsapp",
      type: "text",
      text: { body: "Su mesa está lista" },
    });
  });

  it("plantilla con variables, para fuera de la ventana", () => {
    const cuerpo = cuerpoDeEnvio({
      sucursal_id: "suc-rodizio",
      contacto: "521331",
      plantilla: { nombre: "mesa_lista", idioma: "es_MX", variables: ["Ramírez", "5"] },
    }) as { template: { components: { parameters: { text: string }[] }[] } };

    expect(cuerpo.template.components[0]!.parameters.map((p) => p.text)).toEqual(["Ramírez", "5"]);
  });

  it("una plantilla sin variables no manda componentes vacíos", () => {
    const cuerpo = cuerpoDeEnvio({
      sucursal_id: "s",
      contacto: "1",
      plantilla: { nombre: "encuesta", idioma: "es_MX" },
    }) as { template: { components?: unknown } };
    expect(cuerpo.template.components).toBeUndefined();
  });
});
