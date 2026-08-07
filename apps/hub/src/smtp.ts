/**
 * Cliente SMTP mínimo, para mandar desde el Gmail del restaurante.
 *
 * POR QUÉ ESTO Y NO UNA LIBRERÍA. El Hub se empaqueta como un solo binario y sus
 * dependencias de producción son dos (`selfsigned` y `ws`). Meter un cliente de
 * correo completo para hablar veinte líneas de un protocolo de 1982 engorda el
 * instalador y agranda la superficie que hay que vigilar por seguridad. Lo que
 * de verdad se necesita cabe aquí y se puede leer entero.
 *
 * LAS DOS DECISIONES QUE EVITAN LOS BUGS CLÁSICOS DEL CORREO:
 *
 *   1. **TLS directo al puerto 465**, no STARTTLS en el 587. STARTTLS empieza en
 *      claro y sube a cifrado a mitad de la conversación; si algo se cae en ese
 *      salto, la credencial puede acabar viajando sin cifrar. En el 465 la
 *      conexión nace cifrada y no hay salto que pueda fallar.
 *
 *   2. **Todo el cuerpo en base64.** La alternativa (quoted-printable) obliga a
 *      partir líneas largas y a escapar acentos a mano, y ahí es donde salen los
 *      correos con "Ã©" en lugar de "é" y el HTML roto por un salto de línea a
 *      los 78 caracteres. Base64 no tiene ninguno de esos casos: el alfabeto es
 *      ASCII puro y las líneas las corta uno donde quiera.
 *
 * LA CONTRASEÑA NO ES LA DEL CORREO. Google exige una **contraseña de
 * aplicación**: 16 letras que se generan aparte, solo sirven para SMTP y se
 * revocan sin cambiar la del dueño de la cuenta. Requiere verificación en dos
 * pasos activa. Nunca se le pide al restaurante su contraseña real.
 */
import { connect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";

export interface DestinoSmtp {
  host: string;
  puerto: number;
  usuario: string;
  /** Contraseña de aplicación. Nunca la contraseña de la cuenta. */
  contrasena: string;
}

export interface MensajeSmtp {
  de: string;
  para: string;
  responder_a?: string;
  asunto: string;
  html: string;
  texto: string;
}

/** Cuánto se espera a que el servidor conteste antes de darlo por perdido. */
const ESPERA_MS = 20_000;

export class ErrorSmtp extends Error {
  constructor(
    message: string,
    /** Código SMTP. Un 5xx es definitivo; un 4xx se puede reintentar. */
    readonly codigo: number,
  ) {
    super(message);
    this.name = "ErrorSmtp";
  }

  /**
   * ¿Vale la pena reintentarlo?
   *
   * Distinguirlo importa mucho: un 535 (contraseña de aplicación mala) no se
   * arregla reintentando, y meterlo en la cola llena de basura lo que debería
   * tener solo lo que sí puede salir. Un 421 (demasiados envíos seguidos) sí se
   * resuelve solo con esperar.
   */
  get reintentable(): boolean {
    return this.codigo >= 400 && this.codigo < 500;
  }
}

/** Convierte texto a base64 partido en líneas, como manda el MIME. */
function base64Lineas(texto: string): string {
  const crudo = Buffer.from(texto, "utf8").toString("base64");
  return (crudo.match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * Aplana lo que va a acabar dentro de una cabecera.
 *
 * EN EL CORREO, UN SALTO DE LÍNEA ES UNA CABECERA NUEVA. Una reserva a nombre
 * de `Juan\r\nBcc: quien-sea@ejemplo.com` no es un nombre raro: es un `Bcc:`
 * real, y el restaurante manda una copia de la confirmación a quien el atacante
 * quiera. El nombre viene del portal público, donde cualquiera con el QR
 * escribe lo que quiera y **no hay filtro de caracteres**, solo de longitud.
 *
 * Se aplana en vez de rechazar a propósito: el correo tiene que salir igual. Un
 * nombre con un salto pegado de otro sitio no puede costarle al comensal su
 * confirmación de reserva, y aplanado no hace daño ninguno.
 *
 * Se van también el resto de los caracteres de control —incluido `\0`, que en
 * algunos servidores trunca la línea— y las tabulaciones al principio, que es
 * como se continúa una cabecera plegada (RFC 5322 §2.2.3).
 */
export function sinSaltos(texto: string): string {
  return (
    texto
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]+/g, " ")
      .trim()
  );
}

/**
 * Codifica una cabecera que lleve acentos (RFC 2047).
 *
 * "Café Rodizio" en un `From:` sin codificar llega como "CafÃ© Rodizio" o hace
 * que el servidor rechace el mensaje entero. Solo se codifica si hace falta:
 * envolver texto ASCII sin necesidad ensucia el remitente en algunos clientes.
 *
 * **El aplanado va ANTES de decidir si se codifica**, y ese orden es el arreglo.
 * `\r` y `\n` viven dentro de `\x00-\x7F`, así que un asunto con un salto
 * inyectado pasaba por "no hace falta codificar" y salía tal cual a la cabecera.
 * Un asunto con acentos se salvaba de rebote —el base64 se traga el salto—, que
 * es la clase de protección accidental que un día desaparece.
 */
function cabecera(texto: string): string {
  const limpio = sinSaltos(texto);
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(limpio)) return limpio;
  return `=?UTF-8?B?${Buffer.from(limpio, "utf8").toString("base64")}?=`;
}

/**
 * Codifica un remitente `Nombre <dir@ección>` respetando la dirección.
 *
 * La dirección NUNCA se codifica —tiene que quedar legible para el servidor—;
 * el nombre de delante sí, que es donde caben los acentos.
 *
 * Se aplana antes de intentar partirlo: `.` no casa saltos de línea, así que un
 * valor con `\r\n` **no casaba el patrón** y se devolvía entero y sin tocar.
 * El camino de "no lo entiendo, lo dejo como está" era justo el del ataque.
 */
function remitente(valor: string): string {
  const limpio = sinSaltos(valor);
  const partes = limpio.match(/^(.*?)\s*<([^>]+)>$/);
  if (!partes) return limpio;
  const [, nombre = "", direccion = ""] = partes;
  return nombre ? `${cabecera(nombre)} <${direccion}>` : `<${direccion}>`;
}

/**
 * Solo la parte `dir@ección`, que es lo que entiende `MAIL FROM`.
 *
 * **Aquí sí se falla en seco**, y es el único sitio de este archivo donde se
 * hace. En `MAIL FROM:<…>` y `RCPT TO:<…>` la dirección no va dentro de una
 * cabecera: va dentro de un **comando SMTP**. Un salto de línea ahí no añade un
 * `Bcc:`, añade un comando entero —otro `RCPT TO`, un `DATA`— y eso es tomar
 * prestada la conversación con el servidor de correo del restaurante.
 *
 * Y aplanarlo tampoco valdría: una dirección aplanada es otra dirección, y
 * mandarle el correo de un comensal a otra parte es peor que no mandarlo.
 */
export function soloDireccion(valor: string): string {
  /*
   * El rechazo va sobre el valor CRUDO, antes de sacar lo de entre `<>`, y esa
   * es la parte que no se puede mover de sitio. `<([^>]+)>` casa en cualquier
   * parte de la cadena: `cliente@correo.mx\r\nRCPT TO:<otro@ejemplo.com>`
   * devolvía `otro@ejemplo.com`, que es una dirección perfectamente válida.
   * Validar después de extraer no habría dado ningún error — habría entregado
   * el correo del comensal a quien escribió el ataque, y sin dejar rastro.
   */
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(valor)) {
    throw new ErrorSmtp("Dirección de correo no válida: lleva saltos de línea", 550);
  }

  const direccion = (valor.match(/<([^>]+)>/)?.[1] ?? valor).trim();
  if (!/^[^\s<>@,;:"\\]+@[^\s<>@,;:"\\]+$/.test(direccion)) {
    throw new ErrorSmtp(`Dirección de correo no válida: ${JSON.stringify(direccion)}`, 550);
  }
  return direccion;
}

/** Fecha en el formato que pide el correo (RFC 5322). */
function fechaCorreo(ahora: Date): string {
  return ahora.toUTCString().replace(/GMT$/, "+0000");
}

/**
 * Arma el mensaje MIME completo, listo para el `DATA`.
 *
 * El `id` se recibe como `string` y no como UUID: solo sirve para componer el
 * `Message-ID` y la frontera del multipart, y atarlo al tipo de `randomUUID`
 * obligaría a las pruebas a inventar UUID de mentira para leer un asunto.
 */
export function armarMime(
  mensaje: MensajeSmtp,
  ahora = new Date(),
  id: string = randomUUID(),
): string {
  const frontera = `motrest-${id}`;
  const dominio = soloDireccion(mensaje.de).split("@")[1] ?? "motrest";

  const cabeceras = [
    `From: ${remitente(mensaje.de)}`,
    `To: ${remitente(mensaje.para)}`,
    ...(mensaje.responder_a ? [`Reply-To: ${remitente(mensaje.responder_a)}`] : []),
    `Subject: ${cabecera(mensaje.asunto)}`,
    `Message-ID: <${id}@${dominio}>`,
    `Date: ${fechaCorreo(ahora)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${frontera}"`,
  ];

  /*
   * El orden importa y no es cosmético: en `multipart/alternative` el cliente de
   * correo enseña la ÚLTIMA parte que sabe leer. El texto va primero y el HTML
   * después, para que quien pueda ver HTML lo vea.
   */
  const cuerpo = [
    `--${frontera}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lineas(mensaje.texto),
    `--${frontera}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lineas(mensaje.html),
    `--${frontera}--`,
  ];

  return [...cabeceras, "", ...cuerpo].join("\r\n");
}

/**
 * Protege el cuerpo del final de `DATA`.
 *
 * Una línea que sea solo un punto termina el mensaje; si el contenido trae una,
 * el resto del correo se interpretaría como comandos SMTP. Con base64 no puede
 * pasar —su alfabeto no incluye el punto— pero la protección se queda porque el
 * día que alguien cambie la codificación, esto es lo que evita el agujero.
 */
function protegerPuntos(cuerpo: string): string {
  return cuerpo.replace(/^\./gm, "..");
}

/** Una conversación SMTP, del saludo al `QUIT`. */
class Conversacion {
  private pendiente = "";
  private esperando: ((linea: string) => void) | null = null;
  private fallo: ((causa: Error) => void) | null = null;

  constructor(private readonly socket: TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (trozo: string) => this.recibir(trozo));
    socket.on("error", (causa) => this.romper(causa));
    socket.on("close", () => this.romper(new ErrorSmtp("El servidor cerró la conexión", 421)));
  }

  private romper(causa: Error): void {
    this.fallo?.(causa);
    this.esperando = null;
    this.fallo = null;
  }

  /**
   * Junta lo que llega hasta tener una respuesta completa.
   *
   * SMTP contesta en varias líneas (`250-` sigue, `250 ` termina) y TCP puede
   * partirlas donde se le antoje. Sin este ensamblado, un `EHLO` con muchas
   * capacidades se lee como varias respuestas y toda la conversación se
   * desincroniza — el bug clásico de escribir un cliente SMTP a mano.
   */
  private recibir(trozo: string): void {
    this.pendiente += trozo;
    const lineas = this.pendiente.split("\r\n");
    for (let i = 0; i < lineas.length - 1; i++) {
      const linea = lineas[i]!;
      // `250-` es continuación; `250 ` (o cualquier no-guión) cierra.
      if (/^\d{3}[- ]/.test(linea) && linea[3] !== "-") {
        this.pendiente = lineas.slice(i + 1).join("\r\n");
        const responder = this.esperando;
        this.esperando = null;
        this.fallo = null;
        responder?.(linea);
        return;
      }
    }
    this.pendiente = lineas[lineas.length - 1]!;
  }

  /** Manda un comando y espera la respuesta, comprobando el código. */
  async decir(comando: string | null, esperado: number): Promise<string> {
    const respuesta = await new Promise<string>((resolver, rechazar) => {
      const reloj = setTimeout(
        () => rechazar(new ErrorSmtp("El servidor de correo no contestó a tiempo", 421)),
        ESPERA_MS,
      );
      this.esperando = (linea) => {
        clearTimeout(reloj);
        resolver(linea);
      };
      this.fallo = (causa) => {
        clearTimeout(reloj);
        rechazar(causa);
      };
      if (comando !== null) this.socket.write(comando + "\r\n");
    });

    const codigo = Number(respuesta.slice(0, 3));
    if (codigo !== esperado) {
      throw new ErrorSmtp(`SMTP respondió "${respuesta.trim()}"`, codigo);
    }
    return respuesta;
  }

  cerrar(): void {
    try {
      this.socket.write("QUIT\r\n");
    } catch {
      // Da igual: el mensaje ya está entregado y el servidor cierra igual.
    }
    this.socket.destroy();
  }
}

/**
 * Entrega un correo. Devuelve el `Message-ID` para poder rastrear una queja.
 *
 * Abre una conexión por correo en vez de reutilizarla. Es más lento y es a
 * propósito: una conexión que se queda abierta con la credencial cargada, en una
 * computadora de restaurante que puede estar horas encendida sin mandar nada, es
 * más riesgo del que ahorra. Aquí se mandan decenas de correos al día, no miles.
 */
export async function entregarPorSmtp(
  destino: DestinoSmtp,
  mensaje: MensajeSmtp,
  ahora = new Date(),
): Promise<string> {
  const id = randomUUID();
  const socket = await new Promise<TLSSocket>((resolver, rechazar) => {
    const s = connect(
      { host: destino.host, port: destino.puerto, servername: destino.host },
      () => {
        /*
         * Si el certificado no es de quien dice ser, se corta. Sin esto,
         * cualquiera en la red del restaurante podría hacerse pasar por Google y
         * quedarse con la contraseña de aplicación.
         */
        if (!s.authorized) {
          s.destroy();
          rechazar(new ErrorSmtp(`Certificado no confiable: ${s.authorizationError}`, 500));
          return;
        }
        resolver(s);
      },
    );
    s.setTimeout(ESPERA_MS);
    s.once("timeout", () => {
      s.destroy();
      rechazar(new ErrorSmtp("No se pudo conectar con el servidor de correo", 421));
    });
    s.once("error", (causa) => rechazar(new ErrorSmtp(String(causa), 421)));
  });

  const charla = new Conversacion(socket);
  try {
    await charla.decir(null, 220); // Saludo del servidor.
    await charla.decir("EHLO motrest", 250);

    // AUTH LOGIN: el servidor pide usuario y contraseña por separado, en base64.
    await charla.decir("AUTH LOGIN", 334);
    await charla.decir(Buffer.from(destino.usuario, "utf8").toString("base64"), 334);
    await charla.decir(Buffer.from(destino.contrasena, "utf8").toString("base64"), 235);

    await charla.decir(`MAIL FROM:<${soloDireccion(mensaje.de)}>`, 250);
    await charla.decir(`RCPT TO:<${soloDireccion(mensaje.para)}>`, 250);
    await charla.decir("DATA", 354);
    await charla.decir(protegerPuntos(armarMime(mensaje, ahora, id)) + "\r\n.", 250);

    return `<${id}@${soloDireccion(mensaje.de).split("@")[1] ?? "motrest"}>`;
  } finally {
    charla.cerrar();
  }
}
