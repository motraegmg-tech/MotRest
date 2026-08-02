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
 * Variables de entorno (ninguna va al repositorio):
 *
 *   MOTREST_META_APP_SECRET    firma de los webhooks — sin esto no arranca
 *   MOTREST_META_VERIFY_TOKEN  el que se teclea en el panel de Meta
 *   MOTREST_RELAY_PUERTO       puerto de escucha (8080)
 *   MOTREST_RELAY_PADRON       dónde se guarda el padrón de restaurantes
 *   MOTREST_RELAY_CLAVE_HUB    clave con que un Hub se identifica al conectarse
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Inquilinos } from "./inquilinos.js";
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
const CLAVE_HUB = process.env.MOTREST_RELAY_CLAVE_HUB ?? "";
const PADRON = process.env.MOTREST_RELAY_PADRON ?? "./datos/restaurantes.json";

const GRAPH = "https://graph.facebook.com/v21.0";

const inquilinos = new Inquilinos(PADRON);
const vistos = new YaVistos();

function registrar(nivel: "info" | "aviso" | "error", texto: string): void {
  console.log(`[${new Date().toISOString()}] ${nivel.toUpperCase()} ${texto}`);
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
    !CLAVE_HUB && "MOTREST_RELAY_CLAVE_HUB",
  ].filter(Boolean);

  if (faltan.length > 0) {
    registrar("error", `Faltan variables de entorno: ${faltan.join(", ")}`);
    registrar("error", "El relay no arranca sin ellas: aceptaría webhooks falsos.");
    process.exit(1);
  }
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

  if (url.pathname === "/salud") {
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
function alConectarHub(socket: WebSocket): void {
  let sucursalId: string | null = null;

  const cerrarPor = (razon: string): void => {
    registrar("aviso", `Hub rechazado: ${razon}`);
    socket.close();
  };

  socket.on("message", async (crudo) => {
    let mensaje: Record<string, unknown>;
    try {
      mensaje = JSON.parse(String(crudo)) as Record<string, unknown>;
    } catch {
      cerrarPor("mensaje ilegible");
      return;
    }

    // Primero se presenta, con la clave del relay. Sin saludo no se hace nada.
    if (mensaje.tipo === "hola") {
      if (mensaje.clave !== CLAVE_HUB || typeof mensaje.sucursal_id !== "string") {
        cerrarPor("clave o sucursal inválidas");
        return;
      }
      sucursalId = mensaje.sucursal_id;
      inquilinos.conectar({
        sucursal_id: sucursalId,
        enviar: (m) => socket.send(JSON.stringify(m)),
      });
      registrar("info", `Hub conectado: ${sucursalId}`);
      socket.send(JSON.stringify({ tipo: "bienvenida", ts: Date.now() }));
      return;
    }

    if (!sucursalId) {
      cerrarPor("habló antes de presentarse");
      return;
    }

    /* El Hub da de alta o actualiza sus credenciales de WhatsApp. */
    if (mensaje.tipo === "credenciales") {
      const { phone_number_id, token, nombre } = mensaje as Record<string, string>;
      if (!phone_number_id || !token) return;
      inquilinos.registrar({
        sucursal_id: sucursalId,
        phone_number_id,
        token,
        nombre: nombre ?? sucursalId,
      });
      registrar("info", `Credenciales de WhatsApp actualizadas: ${sucursalId}`);
      return;
    }

    /*
     * El Hub pide mandar un mensaje. Las reglas de a quién y cuándo YA las
     * comprobó el Hub con el dominio (`clientes/mensajeria.ts`): aquí solo se
     * obedece. Duplicar la regla en dos sitios es garantizar que un día
     * discrepen.
     */
    if (mensaje.tipo === "enviar") {
      const inquilino = inquilinos.de(sucursalId);
      if (!inquilino) {
        socket.send(JSON.stringify({ tipo: "envio_fallido", razon: "sin credenciales" }));
        return;
      }
      const peticion = mensaje.peticion as PeticionEnvio;
      const ok = await enviarPorMeta(inquilino, peticion);
      socket.send(JSON.stringify({ tipo: ok ? "envio_ok" : "envio_fallido", id: mensaje.id }));
    }
  });

  socket.on("close", () => {
    if (sucursalId) {
      inquilinos.desconectar(sucursalId);
      registrar("info", `Hub desconectado: ${sucursalId}`);
    }
  });

  socket.on("error", (causa) => registrar("aviso", `Error de socket: ${causa.message}`));
}

comprobarConfiguracion();

const servidor = createServer((peticion, respuesta) => {
  void atender(peticion, respuesta).catch((causa) => {
    registrar("error", `Fallo atendiendo ${peticion.url}: ${String(causa)}`);
    if (!respuesta.headersSent) respuesta.writeHead(500);
    respuesta.end();
  });
});

new WebSocketServer({ server: servidor, path: "/hub" }).on("connection", alConectarHub);

servidor.listen(PUERTO, () => {
  registrar("info", `Relay escuchando en :${PUERTO}`);
  registrar("info", `${inquilinos.total} restaurante(s) en el padrón`);
});
