/**
 * Verificar, leer y traducir lo de Meta. Nada más.
 *
 * Portado de apps/relay/src/nucleo.ts, que se retira cuando Fly se apague. La
 * lógica NO se reescribió: `firmaValida` ya estaba escrita con `crypto.subtle`
 * —Web Crypto— así que corre en Deno igual que corría en Node, y las otras dos
 * son funciones puras sobre el JSON de Meta.
 *
 * Eso importa más de lo que parece: la verificación de la firma es la puerta de
 * la calle de todo el sistema, y reescribirla al mudarse habría sido la forma
 * más fácil de introducir un fallo justo ahí.
 */

export interface MensajeEntrante {
  sucursal_id: string;
  contacto: string;
  texto: string;
  /** Id del mensaje en Meta: sirve para no procesar dos veces. */
  externo_id: string;
  ts: number;
}

/** Lo que un Hub pide que se mande. */
export interface PeticionEnvio {
  contacto: string;
  /** Texto libre (solo dentro de la ventana de 24 h). */
  texto?: string;
  /** Plantilla aprobada, para fuera de la ventana. */
  plantilla?: { nombre: string; idioma: string; variables?: string[] };
}

/**
 * ¿Este webhook viene de verdad de Meta?
 *
 * Meta firma cada entrega con HMAC-SHA256 del cuerpo crudo usando el secreto de
 * la aplicación. Sin esta comprobación, cualquiera que descubra la URL puede
 * inyectar mensajes: dar de alta reservas falsas, disparar encuestas, o algo
 * peor. **Es la puerta de la calle.**
 *
 * Se comprueba sobre el cuerpo CRUDO: volver a serializar el JSON cambia los
 * bytes y la firma deja de cuadrar.
 *
 * La comparación es de tiempo constante — comparar con `===` filtra información
 * por cuánto tarda.
 */
export async function firmaValida(
  cuerpoCrudo: string,
  cabecera: string | undefined | null,
  secretoApp: string,
): Promise<boolean> {
  if (!cabecera?.startsWith("sha256=")) return false;

  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretoApp),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpoCrudo)),
  );

  const esperada = [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recibida = cabecera.slice("sha256=".length).toLowerCase();
  if (recibida.length !== esperada.length) return false;

  let diferencia = 0;
  for (let i = 0; i < esperada.length; i++) {
    diferencia |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
  }
  return diferencia === 0;
}

/**
 * Saca los mensajes de un webhook de Meta.
 *
 * El formato viene anidado y con partes opcionales: se navega a la defensiva
 * porque Meta manda también recibos de entrega y cambios de estado por el mismo
 * canal, y un `undefined` inesperado no puede tumbar la nube de todos los
 * restaurantes a la vez.
 */
export function leerWebhook(
  cuerpo: unknown,
  porNumero: ReadonlyMap<string, { sucursal_id: string }>,
): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];
  const raiz = cuerpo as { entry?: unknown[] };
  if (!Array.isArray(raiz?.entry)) return salida;

  for (const entrada of raiz.entry) {
    const cambios = (entrada as { changes?: unknown[] })?.changes;
    if (!Array.isArray(cambios)) continue;

    for (const cambio of cambios) {
      const valor = (cambio as { value?: Record<string, unknown> })?.value;
      const numeroId = (valor?.metadata as { phone_number_id?: string })?.phone_number_id;
      if (!numeroId) continue;

      // Un número que no es de ningún restaurante nuestro se ignora en silencio:
      // responder algo le confirmaría a quien prueba que la URL existe.
      const inquilino = porNumero.get(numeroId);
      if (!inquilino) continue;

      const mensajes = valor?.messages;
      if (!Array.isArray(mensajes)) continue;

      for (const m of mensajes as Record<string, unknown>[]) {
        const texto =
          (m.text as { body?: string })?.body ??
          // Los botones de una encuesta llegan por otro camino que el texto.
          (m.interactive as { button_reply?: { title?: string } })?.button_reply?.title ??
          (m.interactive as { list_reply?: { title?: string } })?.list_reply?.title;

        if (typeof m.from !== "string" || typeof texto !== "string") continue;

        salida.push({
          sucursal_id: inquilino.sucursal_id,
          contacto: m.from,
          texto,
          externo_id: String(m.id ?? ""),
          // Meta manda el sello en segundos; aquí todo va en milisegundos.
          ts: Number(m.timestamp) * 1000 || Date.now(),
        });
      }
    }
  }

  return salida;
}

/**
 * Arma la llamada a la API de Meta.
 *
 * Se separa de la llamada en sí para poder probar el cuerpo sin red — es donde
 * se cometen los errores que Meta rechaza con mensajes crípticos.
 */
export function cuerpoDeEnvio(peticion: PeticionEnvio): Record<string, unknown> {
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: peticion.contacto,
  };

  if (peticion.plantilla) {
    return {
      ...base,
      type: "template",
      template: {
        name: peticion.plantilla.nombre,
        language: { code: peticion.plantilla.idioma },
        components: peticion.plantilla.variables?.length
          ? [
              {
                type: "body",
                parameters: peticion.plantilla.variables.map((v) => ({ type: "text", text: v })),
              },
            ]
          : undefined,
      },
    };
  }

  return { ...base, type: "text", text: { preview_url: false, body: peticion.texto ?? "" } };
}
