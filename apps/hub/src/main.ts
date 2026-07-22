/**
 * Arranque del Hub: WebSocket sobre HTTP, más un par de rutas de servicio.
 *
 * Se usa `ws` directo en vez de un framework: el Hub tiene un canal WebSocket y
 * dos endpoints de diagnóstico. Meter Fastify para eso serían más dependencias
 * que instalar y actualizar en la máquina de un restaurante, a cambio de nada.
 *
 * Corre con `tsx` durante el desarrollo. Para la instalación real (etapa 12) se
 * compila a JavaScript: un servicio de producción no debería transpilar en cada
 * arranque.
 *
 * TLS y mDNS quedan explícitamente PENDIENTES; están anotados abajo en vez de
 * dar por buena una seguridad que no existe.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { interpretar, serializar, type MensajeCliente, type MensajeHub } from "@motrest/protocolo-sync";
import { almacenSqlite } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "./servidor.js";

const PUERTO = Number(process.env.MOTREST_HUB_PUERTO ?? 8787);
const RUTA_DB = resolve(process.env.MOTREST_HUB_DB ?? "./datos/hub.sqlite");
const HUB_ID = process.env.MOTREST_HUB_ID ?? "hub-local";
// Por omisión SÍ se exige aprobación: es la postura segura. Se relaja solo si
// quien instala lo pide explícitamente.
const EXIGIR_APROBACION = process.env.MOTREST_HUB_ABIERTO !== "1";

mkdirSync(dirname(RUTA_DB), { recursive: true });
const almacen = almacenSqlite(RUTA_DB);

function registrar(nivel: "info" | "aviso" | "error", mensaje: string): void {
  const marca = new Date().toISOString();
  const prefijo = nivel === "error" ? "ERROR" : nivel === "aviso" ? "AVISO" : "INFO ";
  console.log(`${marca} ${prefijo} ${mensaje}`);
}

const hub = new Hub({
  hub_id: HUB_ID,
  log: almacen.log,
  exigirAprobacion: EXIGIR_APROBACION,
  registrar,
});

// --- HTTP: diagnóstico y administración de dispositivos --------------------------------

const servidor = createServer((peticion: IncomingMessage, respuesta: ServerResponse) => {
  const url = new URL(peticion.url ?? "/", `http://${peticion.headers.host}`);

  const json = (codigo: number, cuerpo: unknown): void => {
    respuesta.writeHead(codigo, { "content-type": "application/json; charset=utf-8" });
    respuesta.end(JSON.stringify(cuerpo, null, 2));
  };

  if (url.pathname === "/salud") {
    json(200, {
      hub_id: HUB_ID,
      seq: hub.seqActual,
      conectados: hub.conectados,
      exige_aprobacion: EXIGIR_APROBACION,
      ts: Date.now(),
    });
    return;
  }

  if (url.pathname === "/dispositivos") {
    json(200, almacen.log.dispositivos());
    return;
  }

  if (url.pathname === "/aprobar" && peticion.method === "POST") {
    const deviceId = url.searchParams.get("device_id");
    if (!deviceId) {
      json(400, { error: "Falta device_id" });
      return;
    }
    almacen.log.aprobarDispositivo(deviceId);
    registrar("info", `Dispositivo aprobado: ${deviceId}`);
    json(200, { ok: true, device_id: deviceId });
    return;
  }

  json(404, { error: "No encontrado" });
});

// --- WebSocket: el canal de sincronización ----------------------------------------------

const wss = new WebSocketServer({ server: servidor, path: "/sync" });
let contador = 0;

wss.on("connection", (socket: WebSocket) => {
  const id = `cx-${++contador}`;

  const conexion: Conexion = {
    id,
    enviar: (mensaje: MensajeHub) => {
      if (socket.readyState === socket.OPEN) socket.send(serializar(mensaje));
    },
    cerrar: () => socket.close(),
  };

  hub.conectar(conexion);

  socket.on("message", (datos) => {
    const mensaje = interpretar<MensajeCliente>(datos.toString());
    // Un mensaje ilegible se ignora: por el puerto puede llegar cualquier cosa
    // y tumbar la conexión dejaría sin sincronizar a una terminal que sí trabaja.
    if (!mensaje) return;
    try {
      hub.recibir(id, mensaje);
    } catch (causa) {
      registrar("error", `Fallo al procesar ${mensaje.tipo}: ${String(causa)}`);
    }
  });

  socket.on("close", () => hub.desconectar(id));
  socket.on("error", (causa) => {
    registrar("aviso", `Error de socket ${id}: ${causa.message}`);
    hub.desconectar(id);
  });
});

servidor.listen(PUERTO, () => {
  registrar("info", `Hub escuchando en http://0.0.0.0:${PUERTO}`);
  registrar("info", `Canal de sincronización: ws://<ip-del-local>:${PUERTO}/sync`);
  registrar("info", `Base de datos: ${RUTA_DB} · secuencia actual: ${hub.seqActual}`);
  if (!EXIGIR_APROBACION) {
    registrar("aviso", "MODO ABIERTO: cualquier dispositivo de la red puede sincronizar.");
  }
  registrar(
    "aviso",
    "PENDIENTE de la etapa 12: TLS pineado y descubrimiento mDNS. Hoy el canal viaja en claro por la LAN.",
  );
});

function apagar(senal: string): void {
  registrar("info", `Señal ${senal}: cerrando el Hub`);
  wss.close();
  servidor.close(() => {
    almacen.cerrar();
    process.exit(0);
  });
}

process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));
