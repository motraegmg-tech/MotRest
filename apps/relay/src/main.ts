/**
 * El relay: la única parte de MotRest conectada a internet.
 *
 * Hace tres cosas y ninguna más:
 *
 *   1. Recibe los webhooks de Meta, comprueba que vengan de verdad de Meta y
 *      averigua a qué restaurante le tocan.
 *   2. Se los empuja al Hub de ESE restaurante, que está conectado hacia afuera.
 *   3. Cuando un Hub quiere mandar algo, llama a la API de Meta con las
 *      credenciales de ese local.
 *
 * Lo que NO hace: guardar la operación. Ni una comanda, ni una venta, ni un
 * cliente. Todo eso vive en el restaurante y ahí se queda.
 *
 * Variables de entorno (ninguna va al repositorio). Estas cinco son TODAS las
 * que el relay lee, y las tres primeras son obligatorias:
 *
 *   MOTREST_META_APP_SECRET      firma de los webhooks — sin esto no arranca
 *   MOTREST_META_VERIFY_TOKEN    el que se teclea en el panel de Meta
 *   MOTREST_RELAY_LLAVE_PADRON   32 bytes en base64: cifra el padrón en reposo
 *   MOTREST_RELAY_CLAVE_ADMIN    para consultar /salud/detalle (opcional)
 *   MOTREST_RELAY_PUERTO         puerto de escucha (8080)
 *   MOTREST_RELAY_PADRON         dónde se guarda el padrón (./datos/…)
 *
 * `MOTREST_RELAY_CLAVE_HUB` YA NO EXISTE. Era una sola clave para todos los
 * Hubs; ahora cada restaurante tiene la suya, se la da MOTRAE al darlo de alta
 * (`padron alta`) y de ella se deriva su identidad.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Inquilinos, llaveDelPadron } from "./inquilinos.js";
import {
  YaVistos,
  cuerpoDeEnvio,
  firmaValida,
  leerWebhook,
  type Inquilino,
  type PeticionEnvio,
} from "./nucleo.js";

const PUERTO = Number(process.env.MOTREST_RELAY_PUERTO ?? 8080);
const APP_SECRET = process.env.MOTREST_META_APP_SECRET ?? "";
const VERIFY_TOKEN = process.env.MOTREST_META_VERIFY_TOKEN ?? "";
const CLAVE_ADMIN = process.env.MOTREST_RELAY_CLAVE_ADMIN ?? "";
const PADRON = process.env.MOTREST_RELAY_PADRON ?? "./datos/restaurantes.json";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Cuánto aguanta un socket sin presentarse antes de que se le cierre. */
const ESPERA_SALUDO_MS = 10_000;
/** Cada cuánto se comprueba que un Hub conectado siga vivo de verdad. */
const LATIDO_MS = 30_000;
/** Saludos fallidos desde una IP antes de dejarla fuera un rato. */
const FALLOS_PARA_CASTIGO = 5;
const CASTIGO_MS = 15 * 60 * 1000;

function registrar(nivel: "info" | "aviso" | "error", texto: string): void {
  const linea = `[${new Date().toISOString()}] ${nivel.toUpperCase()} ${texto}`;
  if (nivel === "error") console.error(linea);
  else console.log(linea);
}

/**
 * Sin secretos no se arranca.
 *
 * Es a propósito: un relay sin `APP_SECRET` aceptaría cualquier webhook, y eso
 * es peor que no tener relay. Fallar aquí es ruidoso; fallar en producción con
 * la puerta abierta es silencioso.
 */
function comprobarConfiguracion(): void {
  const faltan = [
    !APP_SECRET && "MOTREST_META_APP_SECRET",
    !VERIFY_TOKEN && "MOTREST_META_VERIFY_TOKEN",
    !process.env.MOTREST_RELAY_LLAVE_PADRON && "MOTREST_RELAY_LLAVE_PADRON",
  ].filter(Boolean);

  if (faltan.length > 0) {
    registrar("error", `Faltan variables de entorno: ${faltan.join(", ")}`);
    registrar("error", "El relay no arranca sin ellas: aceptaría webhooks falsos.");
    registrar("error", "Genera la llave del padrón con: pnpm --filter @motrest/relay padron llave");
    process.exit(1);
  }

  // Quien despliegue con la configuración vieja tiene que enterarse, porque el
  // síntoma —ningún Hub conecta— no apunta a la variable que sobra.
  if (process.env.MOTREST_RELAY_CLAVE_HUB) {
    registrar(
      "aviso",
      "MOTREST_RELAY_CLAVE_HUB ya no se usa: cada restaurante tiene su credencial. " +
        "Dalos de alta con: pnpm --filter @motrest/relay padron alta <sucursal> <nombre>",
    );
  }
  if (!CLAVE_ADMIN) {
    registrar("aviso", "Sin MOTREST_RELAY_CLAVE_ADMIN: /salud/detalle queda cerrado.");
  }
}

const inquilinos = new Inquilinos(PADRON, llaveDelPadron(process.env.MOTREST_RELAY_LLAVE_PADRON), (t) =>
  registrar("aviso", t),
);
const vistos = new YaVistos();

/**
 * Cuántas veces ha fallado el saludo cada IP.
 *
 * Sin esto, la credencial de 256 bits solo se defiende por su tamaño: nada
 * impedía abrir sockets y probar en bucle, ni gastarle el CPU al relay de todos
 * los restaurantes. Se recuerda en memoria a propósito — al reiniciar se
 * perdona, y eso está bien: el castigo es para frenar un ataque en curso, no
 * para llevar un historial de nadie.
 */
class Cerrojo {
  private fallos = new Map<string, { n: number; hasta: number }>();

  permitido(ip: string, ahora = Date.now()): boolean {
    const f = this.fallos.get(ip);
    if (!f) return true;
    if (f.hasta > ahora) return false;
    this.fallos.delete(ip);
    return true;
  }

  fallo(ip: string, ahora = Date.now()): void {
    const f = this.fallos.get(ip) ?? { n: 0, hasta: 0 };
    f.n += 1;
    if (f.n >= FALLOS_PARA_CASTIGO) f.hasta = ahora + CASTIGO_MS;
    this.fallos.set(ip, f);
  }

  perdonar(ip: string): void {
    this.fallos.delete(ip);
  }
}

const cerrojo = new Cerrojo();

/** ¿Es esta la clave de administración? Comparación de tiempo constante. */
function esClaveAdmin(recibida: string): boolean {
  if (!CLAVE_ADMIN || recibida.length !== CLAVE_ADMIN.length) return false;
  return timingSafeEqual(Buffer.from(recibida, "utf8"), Buffer.from(CLAVE_ADMIN, "utf8"));
}

/** La IP del otro extremo, para el cerrojo. */
function ipDe(peticion: IncomingMessage): string {
  return peticion.socket.remoteAddress ?? "desconocida";
}

function leerCuerpo(peticion: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const trozos: Buffer[] = [];
    let total = 0;
    peticion.on("data", (trozo: Buffer) => {
      total += trozo.length;
      if (total > maxBytes) {
        rechazar(new Error("Cuerpo demasiado grande"));
        peticion.destroy();
        return;
      }
      trozos.push(trozo);
    });
    peticion.on("end", () => resolver(Buffer.concat(trozos).toString("utf8")));
    peticion.on("error", rechazar);
  });
}

/** Llama a la API de Meta con las credenciales del restaurante que toca. */
async function enviarPorMeta(inquilino: Inquilino, peticion: PeticionEnvio): Promise<boolean> {
  try {
    const respuesta = await fetch(`${GRAPH}/${inquilino.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${inquilino.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cuerpoDeEnvio(peticion)),
    });

    if (!respuesta.ok) {
      // El detalle de Meta se registra porque sus errores son crípticos y sin
      // el cuerpo no hay forma de saber si fue la plantilla, el token o la hora.
      registrar("aviso", `Meta rechazó un envío de ${inquilino.nombre}: ${await respuesta.text()}`);
      return false;
    }
    return true;
  } catch (causa) {
    registrar("error", `No se pudo hablar con Meta: ${String(causa)}`);
    return false;
  }
}

async function atender(peticion: IncomingMessage, respuesta: ServerResponse): Promise<void> {
  const url = new URL(peticion.url ?? "/", `http://localhost:${PUERTO}`);

  const json = (codigo: number, cuerpo: unknown): void => {
    respuesta.writeHead(codigo, { "content-type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify(cuerpo));
  };

  /*
   * Meta comprueba el webhook con un GET antes de mandar nada. Si el token no
   * coincide se responde 403: confirmarle a quien prueba que la URL existe es
   * regalarle la mitad del trabajo.
   */
  if (url.pathname === "/webhook/whatsapp" && peticion.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const reto = url.searchParams.get("hub.challenge");

    if (modo === "subscribe" && token === VERIFY_TOKEN && reto) {
      registrar("info", "Meta verificó el webhook.");
      respuesta.writeHead(200, { "content-type": "text/plain" });
      respuesta.end(reto);
      return;
    }
    respuesta.writeHead(403);
    respuesta.end();
    return;
  }

  if (url.pathname === "/webhook/whatsapp" && peticion.method === "POST") {
    const crudo = await leerCuerpo(peticion);

    // LA PUERTA DE LA CALLE. Se comprueba sobre el cuerpo CRUDO: volver a
    // serializar el JSON cambia los bytes y la firma deja de cuadrar.
    if (!(await firmaValida(crudo, peticion.headers["x-hub-signature-256"] as string, APP_SECRET))) {
      registrar("aviso", "Webhook con firma inválida: descartado");
      respuesta.writeHead(401);
      respuesta.end();
      return;
    }

    /*
     * Se contesta 200 CUANTO ANTES. Meta reintenta si tarda, y un reintento es
     * el mismo mensaje otra vez: se acepta primero y se procesa después.
     */
    respuesta.writeHead(200);
    respuesta.end();

    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(crudo);
    } catch {
      return;
    }

    for (const mensaje of leerWebhook(cuerpo, inquilinos.mapa)) {
      if (vistos.repetido(mensaje.externo_id)) continue;

      const enlace = inquilinos.enlaceDe(mensaje.sucursal_id);
      if (!enlace) {
        // El Hub de ese local está apagado. No se encola: cuando encienda, el
        // comensal ya habrá seguido su vida. Se registra para poder verlo.
        registrar("aviso", `Mensaje para ${mensaje.sucursal_id} sin Hub conectado`);
        continue;
      }
      enlace.enviar({ tipo: "mensaje_entrante", mensaje });
    }
    return;
  }

  /*
   * Salud en dos niveles, y la razón está en el segundo.
   *
   * Este endpoint contestaba, sin pedir nada a nadie, cuántos restaurantes tiene
   * MOTRAE y cuántos están conectados ahora mismo. Eso es la cartera de clientes
   * de la empresa y el horario de sus locales, servidos en abierto a cualquiera
   * que encuentre el dominio. Lo que un monitor de disponibilidad necesita es
   * saber si el proceso responde; para lo demás hay clave.
   */
  if (url.pathname === "/salud") {
    json(200, { relay: "motrest", ts: Date.now() });
    return;
  }

  if (url.pathname === "/salud/detalle") {
    const cabecera = peticion.headers.authorization ?? "";
    if (!esClaveAdmin(cabecera.replace(/^Bearer /i, ""))) {
      respuesta.writeHead(401);
      respuesta.end();
      return;
    }
    json(200, {
      relay: "motrest",
      restaurantes: inquilinos.total,
      hubs_conectados: inquilinos.conectados,
      ts: Date.now(),
    });
    return;
  }

  respuesta.writeHead(404);
  respuesta.end();
}

/**
 * El Hub de cada restaurante se conecta HACIA AFUERA y sostiene el enlace.
 *
 * Es lo que evita abrir un puerto en el restaurante: el local no necesita IP
 * fija, ni redirección en el módem, ni exponer nada. Igual que una terminal se
 * conecta al Hub, solo que un escalón más arriba.
 */
function alConectarHub(socket: WebSocket, peticion: IncomingMessage): void {
  const ip = ipDe(peticion);
  /**
   * La sucursal, una vez y para siempre en esta conexión.
   *
   * **Era reasignable**, y ese era el fallo peor del relay: un Hub se presentaba
   * como el local A, mandaba, volvía a decir `hola` como el local B y seguía en
   * el mismo socket. Ahora sale de la credencial y el segundo saludo cierra la
   * conexión — un Hub legítimo no saluda dos veces.
   */
  let inquilino: Inquilino | null = null;
  let enlace: { sucursal_id: string; enviar(m: unknown): void; cerrar(): void } | null = null;
  let vivo = true;

  const cerrarPor = (razon: string, codigo = 1008): void => {
    registrar("aviso", `Hub rechazado (${ip}): ${razon}`);
    socket.close(codigo, razon);
  };

  // Quien abre un socket y no dice nada no es un Hub. Sin este plazo, sostener
  // conexiones mudas es gratis y el relay se queda sin descriptores.
  const plazoSaludo = setTimeout(() => {
    if (!inquilino) cerrarPor("no se presentó a tiempo");
  }, ESPERA_SALUDO_MS);

  socket.on("pong", () => {
    vivo = true;
  });

  socket.on("message", async (crudo) => {
    let mensaje: Record<string, unknown>;
    try {
      mensaje = JSON.parse(String(crudo)) as Record<string, unknown>;
    } catch {
      cerrarPor("mensaje ilegible");
      return;
    }

    /*
     * Primero se presenta, con SU credencial. La sucursal NO viene en el
     * mensaje: se deriva de la credencial, que es lo único que el Hub no puede
     * elegir. Antes bastaba una clave compartida por todos los locales y
     * declarar el `sucursal_id` que uno quisiera.
     */
    if (mensaje.tipo === "hola") {
      if (inquilino) {
        cerrarPor("se presentó dos veces");
        return;
      }
      const credencial = typeof mensaje.credencial === "string" ? mensaje.credencial : "";
      const encontrado = inquilinos.porCredencial(credencial);
      if (!encontrado) {
        cerrojo.fallo(ip);
        cerrarPor("credencial no reconocida");
        return;
      }

      const suyo = {
        sucursal_id: encontrado.sucursal_id,
        enviar: (m: unknown) => socket.send(JSON.stringify(m)),
        cerrar: () => socket.close(1000, "enlace relevado"),
      };
      if (!inquilinos.conectar(suyo)) {
        // No se cuenta como fallo del cerrojo: la credencial era buena. Lo que
        // hay es un Hub duplicado, y el que ya estaba se queda.
        cerrarPor(`${encontrado.sucursal_id} ya tiene un Hub conectado`);
        return;
      }

      inquilino = encontrado;
      enlace = suyo;
      clearTimeout(plazoSaludo);
      cerrojo.perdonar(ip);
      registrar("info", `Hub conectado: ${encontrado.sucursal_id}`);
      socket.send(JSON.stringify({ tipo: "bienvenida", ts: Date.now() }));
      return;
    }

    if (!inquilino) {
      cerrarPor("habló antes de presentarse");
      return;
    }
    const sucursalId = inquilino.sucursal_id;

    /* El Hub publica el número de WhatsApp de SU restaurante. */
    if (mensaje.tipo === "credenciales") {
      const { phone_number_id, token, nombre } = mensaje as Record<string, string>;
      if (!phone_number_id || !token) return;

      const resultado = inquilinos.publicarWhatsApp(sucursalId, { phone_number_id, token, nombre });
      if (resultado === "ajeno") {
        // Reclamar el número de otro local es quedarse con sus mensajes
        // entrantes. Se rechaza y se deja constancia: esto no pasa por error.
        registrar("aviso", `${sucursalId} intentó reclamar el número ${phone_number_id}`);
        socket.send(JSON.stringify({ tipo: "credenciales_rechazadas", razon: "número de otro local" }));
        return;
      }
      if (resultado === "actualizado") {
        registrar("info", `Credenciales de WhatsApp actualizadas: ${sucursalId}`);
      }
      return;
    }

    /*
     * El Hub pide mandar un mensaje. Las reglas de a quién y cuándo YA las
     * comprobó el Hub con el dominio (`clientes/mensajeria.ts`): aquí solo se
     * obedece. Duplicar la regla en dos sitios es garantizar que un día
     * discrepen.
     */
    if (mensaje.tipo === "enviar") {
      // Se relee del padrón: entre el saludo y ahora pudo cambiar el token.
      const actual = inquilinos.de(sucursalId);
      if (!actual?.phone_number_id) {
        socket.send(JSON.stringify({ tipo: "envio_fallido", razon: "sin credenciales" }));
        return;
      }
      const peticion = mensaje.peticion as PeticionEnvio;
      const ok = await enviarPorMeta(actual, peticion);
      socket.send(JSON.stringify({ tipo: ok ? "envio_ok" : "envio_fallido", id: mensaje.id }));
    }
  });

  socket.on("close", () => {
    clearTimeout(plazoSaludo);
    if (!inquilino || !enlace) return;
    // Se suelta SOLO si el enlace vivo es este. Antes, un socket que se caía
    // borraba el enlace de la sucursal aunque el registrado fuera otro.
    inquilinos.desconectar(inquilino.sucursal_id, enlace);
    registrar("info", `Hub desconectado: ${inquilino.sucursal_id}`);
  });

  socket.on("error", (causa) => registrar("aviso", `Error de socket: ${causa.message}`));

  /*
   * Latido.
   *
   * Hace falta por culpa de la regla de "un solo enlace por sucursal": si al
   * restaurante se le va la luz del módem, el relay no se entera —el TCP puede
   * tardar horas en morir— y el Hub que vuelve se encuentra su propio sitio
   * ocupado por un fantasma. El ping lo destapa en un minuto.
   */
  const latido = setInterval(() => {
    if (!vivo) {
      socket.terminate();
      return;
    }
    vivo = false;
    socket.ping();
  }, LATIDO_MS);
  socket.on("close", () => clearInterval(latido));
}

/**
 * Levanta el relay y devuelve con qué apagarlo.
 *
 * Se separa del arranque para que una prueba pueda encenderlo de verdad,
 * conectarse con un WebSocket de verdad y comprobar a quién deja entrar. Eso es
 * lo único que demuestra que el saludo autentica: leer el código no lo
 * demuestra, y esta parte del sistema es la que da a la calle.
 */
export function arrancar(puerto = PUERTO): {
  puerto: number;
  listo: Promise<void>;
  cerrar(): Promise<void>;
} {
  const servidor = createServer((peticion, respuesta) => {
    void atender(peticion, respuesta).catch((causa) => {
      registrar("error", `Fallo atendiendo ${peticion.url}: ${String(causa)}`);
      if (!respuesta.headersSent) respuesta.writeHead(500);
      respuesta.end();
    });
  });

  const ws = new WebSocketServer({
    server: servidor,
    path: "/hub",
    /*
     * El filtro se aplica ANTES de completar el apretón de manos, que es donde
     * tiene que estar: un socket rechazado aquí no llega a existir.
     *
     * Dos reglas:
     *
     * 1. Una IP castigada no abre. Si no, el cerrojo se saltaría abriendo un
     *    socket nuevo por intento.
     * 2. Nada con cabecera `Origin`. Un Hub es un proceso de Node y no la manda;
     *    quien la manda es un navegador, y un navegador conectándose aquí solo
     *    puede ser una página de internet usando a quien la visita como puente.
     */
    verifyClient: ({ req, origin }, aceptar) => {
      if (origin) {
        registrar("aviso", `Handshake con Origin rechazado (${origin})`);
        aceptar(false, 403, "Prohibido");
        return;
      }
      if (!cerrojo.permitido(ipDe(req))) {
        aceptar(false, 429, "Demasiados intentos");
        return;
      }
      aceptar(true);
    },
  });
  ws.on("connection", alConectarHub);

  const listo = new Promise<void>((arriba) => {
    servidor.listen(puerto, () => {
      registrar("info", `Relay escuchando en :${(servidor.address() as AddressInfo).port}`);
      registrar("info", `${inquilinos.total} restaurante(s) en el padrón`);
      arriba();
    });
  });

  return {
    get puerto(): number {
      return (servidor.address() as AddressInfo)?.port ?? puerto;
    },
    listo,
    cerrar: () =>
      new Promise<void>((listo) => {
        for (const cliente of ws.clients) cliente.terminate();
        ws.close(() => servidor.close(() => listo()));
      }),
  };
}

/*
 * Solo se arranca cuando el relay se corre como programa.
 *
 * Si se arrancara también al importarlo, cada prueba que toque este archivo
 * abriría un puerto de verdad y dejaría el proceso colgado al terminar.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  comprobarConfiguracion();
  arrancar();
}
