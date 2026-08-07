/**
 * El núcleo del relay: verificar, identificar y traducir. Nada más.
 *
 * QUÉ ES Y QUÉ NO ES ESTE SERVICIO
 *
 * Es un cable, no un cerebro. Recibe lo que Meta manda, comprueba que de verdad
 * venga de Meta, averigua a qué restaurante le toca y lo empuja a SU Hub. En
 * sentido contrario, toma lo que un Hub quiere mandar y llama a la API de Meta
 * con las credenciales de ESE restaurante.
 *
 * NO guarda comandas, ni ventas, ni clientes. Deliberadamente: la operación del
 * restaurante vive en su local (TRD R3) y esa es una ventaja del producto, no
 * un accidente. Un relay que acumulara la operación de todos los locales sería
 * el único punto donde un robo lo compromete todo.
 *
 * POR QUÉ EL HUB SE CONECTA HACIA AFUERA Y NO AL REVÉS
 *
 * El Hub vive detrás del módem del restaurante, sin IP fija y sin puertos
 * abiertos — y así debe quedarse. Así que es el Hub quien abre y sostiene la
 * conexión hacia el relay, igual que hace una terminal con el Hub, solo que un
 * escalón más arriba. Nadie tiene que exponer nada a internet.
 *
 * MULTIRRESTAURANTE DESDE EL PRIMER DÍA
 *
 * MotRest no es solo para Rodizio. El relay identifica al restaurante por el
 * `phone_number_id` que Meta incluye en cada mensaje: un solo relay atiende a
 * todos los locales, cada uno con SU número y SUS credenciales.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Lo mínimo para saber a qué restaurante le toca un mensaje entrante. */
export interface Destino {
  /** Sucursal a la que pertenece este número. */
  sucursal_id: string;
}

/** La ficha completa de un restaurante en el padrón del relay. */
export interface Inquilino extends Destino {
  /**
   * El identificador que Meta le da al número del restaurante.
   *
   * **Vacío es normal**: un restaurante se da de alta en el relay antes de
   * conectar su WhatsApp, y puede operar meses solo con el portal. Un inquilino
   * sin número no se indexa para enrutar —si se indexara con la cadena vacía,
   * un webhook sin `phone_number_id` acabaría en el local equivocado.
   */
  phone_number_id: string;
  /** Token del restaurante para llamar a la API. NUNCA sale del relay. */
  token: string;
  /** Nombre visible, solo para los registros. */
  nombre: string;
  /**
   * SHA-256 en hexadecimal de la credencial con la que su Hub se identifica.
   * La credencial en claro **no se guarda en ningún sitio**: se enseña una vez
   * al darla de alta y de ahí en adelante solo vive en el Hub del local.
   */
  credencial_sha256: string;
  /** Cuándo dio MOTRAE de alta a este restaurante. */
  alta_ts: number;
}

// --- Credenciales de los Hubs -------------------------------------------------------

/**
 * Una credencial nueva para el Hub de un restaurante.
 *
 * 32 bytes de `randomBytes` — 256 bits. No es una contraseña que alguien tenga
 * que teclear de memoria: se pega una vez en la configuración del Hub y no se
 * vuelve a ver. Por eso puede ser larga, y por eso conviene que lo sea.
 */
export function generarCredencial(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * La huella de una credencial, que es lo único que guarda el padrón.
 *
 * **SHA-256 a secas, y no scrypt ni PBKDF2, a propósito.** Un KDF lento existe
 * para que un padrón robado no se pueda romper por diccionario; aquí la
 * credencial la genera el relay con 256 bits de azar, así que no hay diccionario
 * que valga y el KDF no compraría nada. Lo que sí costaría es caro: derivar con
 * scrypt en cada saludo convierte un `hola` con basura en 100 ms de CPU y 64 MB
 * de memoria regalados a quien quiera tumbar el relay de todos los restaurantes.
 *
 * La regla, por si algún día se cambia: SHA-256 vale **solo** mientras la
 * credencial la genere `generarCredencial()`. Si alguna vez se deja que un
 * humano elija la credencial, hay que volver a un KDF lento el mismo día.
 */
export function huellaDe(credencial: string): string {
  return createHash("sha256").update(credencial, "utf8").digest("hex");
}

/**
 * ¿Coinciden dos huellas?
 *
 * Se comparan las **huellas**, no las credenciales, así que una fuga por tiempo
 * no le serviría de nada a nadie: para aprovecharla habría que invertir SHA-256.
 * Aun así se usa `timingSafeEqual`, porque cuesta lo mismo y quita la pregunta
 * de encima — la siguiente persona que lea esto no tiene que razonarlo.
 */
export function huellaCoincide(guardada: string, calculada: string): boolean {
  if (guardada.length !== calculada.length) return false;
  try {
    return timingSafeEqual(Buffer.from(guardada, "hex"), Buffer.from(calculada, "hex"));
  } catch {
    // Una huella corrupta en el padrón no autentica a nadie.
    return false;
  }
}

export interface MensajeEntrante {
  sucursal_id: string;
  contacto: string;
  texto: string;
  /** Id del mensaje en Meta: sirve para no procesar dos veces. */
  externo_id: string;
  ts: number;
}

/**
 * ¿Este webhook viene de verdad de Meta?
 *
 * Meta firma cada entrega con HMAC-SHA256 del cuerpo crudo usando el secreto de
 * la aplicación. Sin esta comprobación, cualquiera que descubra la URL puede
 * inyectar mensajes: dar de alta reservas falsas, disparar encuestas, o algo
 * peor. Es la puerta de la calle del relay.
 *
 * La comparación es de tiempo constante, por lo mismo que en el enlace del
 * ticket: comparar con `===` filtra información por cuánto tarda.
 */
export async function firmaValida(
  cuerpoCrudo: string,
  cabecera: string | undefined,
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
 * canal, y un `undefined` inesperado no puede tumbar el relay de todos los
 * restaurantes a la vez.
 */
export function leerWebhook(
  cuerpo: unknown,
  porNumero: ReadonlyMap<string, Destino>,
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
 * Recuerda qué mensajes ya se procesaron.
 *
 * Meta REINTENTA una entrega si no recibe un 200 a tiempo, así que el mismo
 * mensaje llega varias veces. Sin esto, una encuesta se registraría dos veces y
 * una baja podría revertirse por una entrega vieja.
 *
 * Se guarda solo el id y por poco tiempo: no es información del restaurante.
 */
export class YaVistos {
  private vistos = new Map<string, number>();

  constructor(private ventanaMs = 60 * 60 * 1000) {}

  /** true = ya se había procesado. */
  repetido(id: string, ahora = Date.now()): boolean {
    if (!id) return false;
    this.purgar(ahora);
    if (this.vistos.has(id)) return true;
    this.vistos.set(id, ahora);
    return false;
  }

  private purgar(ahora: number): void {
    for (const [id, ts] of this.vistos) {
      if (ahora - ts > this.ventanaMs) this.vistos.delete(id);
    }
  }

  get tamano(): number {
    return this.vistos.size;
  }
}

/** Lo que un Hub le pide al relay que mande. */
export interface PeticionEnvio {
  sucursal_id: string;
  contacto: string;
  /** Texto libre (solo dentro de la ventana de 24 h). */
  texto?: string;
  /** Plantilla aprobada, para fuera de la ventana. */
  plantilla?: { nombre: string; idioma: string; variables?: string[] };
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
