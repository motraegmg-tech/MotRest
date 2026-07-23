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
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  interpretar,
  serializar,
  type Catalogo,
  type MensajeCliente,
  type MensajeHub,
} from "@motrest/protocolo-sync";
import { almacenSqlite } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "./servidor.js";

const PUERTO = Number(process.env.MOTREST_HUB_PUERTO ?? 8787);
/** Solo para imprimir la dirección de emparejamiento; el Hub no sirve el POS. */
const PUERTO_POS = Number(process.env.MOTREST_POS_PUERTO ?? 5173);
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

/**
 * Direcciones IPv4 del equipo en la red del local.
 *
 * Es lo que hay que teclear en cada terminal para emparejarla. Mientras no
 * exista el descubrimiento mDNS (etapa 12), imprimirlas al arrancar evita que
 * quien instala tenga que ir a buscar la IP a la configuración de Windows.
 */
function direccionesLan(): string[] {
  const encontradas: string[] = [];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const red of interfaces ?? []) {
      if (red.family === "IPv4" && !red.internal) encontradas.push(red.address);
    }
  }
  return encontradas;
}

/** Clave bajo la que se guardan los catálogos replicados. */
const CLAVE_CATALOGOS = "catalogos";

const hub = new Hub({
  hub_id: HUB_ID,
  log: almacen.log,
  exigirAprobacion: EXIGIR_APROBACION,
  registrar,
  guardarCatalogo: (catalogo) => {
    // Se guardan todos juntos: son pocos y así el archivo queda consistente.
    void almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS).then((previos) => {
      const resto = (previos ?? []).filter((c) => c.clave !== catalogo.clave);
      void almacen.estado.guardar(CLAVE_CATALOGOS, [...resto, catalogo]);
    });
  },
});

// La carta del local sobrevive al reinicio del servicio.
void almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS).then((guardados) => {
  if (guardados && guardados.length > 0) {
    hub.cargarCatalogos(guardados);
    registrar("info", `Catálogos cargados: ${guardados.map((c) => c.clave).join(", ")}`);
  }
});

// --- HTTP: diagnóstico y administración de dispositivos --------------------------------

const servidor = createServer((peticion: IncomingMessage, respuesta: ServerResponse) => {
  const url = new URL(peticion.url ?? "/", `http://${peticion.headers.host}`);

  /*
   * CORS abierto a la red del local.
   *
   * La pantalla de administración corre en el navegador de una terminal, en
   * otro origen que el Hub, y necesita listar y aprobar dispositivos. Es
   * aceptable porque el Hub vive en la LAN del restaurante y no se expone a
   * internet; cuando llegue el TLS pineado de la etapa 12, el emparejamiento
   * por certificado sustituye a esta apertura.
   */
  respuesta.setHeader("access-control-allow-origin", "*");
  respuesta.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  respuesta.setHeader("access-control-allow-headers", "content-type");

  if (peticion.method === "OPTIONS") {
    respuesta.writeHead(204);
    respuesta.end();
    return;
  }

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
    const por = url.searchParams.get("por");
    if (!deviceId) {
      json(400, { error: "Falta device_id" });
      return;
    }

    /*
     * Solo una terminal YA autorizada puede autorizar a otra.
     *
     * Sin esta regla, cualquiera que alcance la red del local podría darse de
     * alta a sí mismo y escribir en el registro de ventas — que es justo lo que
     * la aprobación pretende impedir. No sustituye al emparejamiento por
     * certificado de la etapa 12, pero cierra la puerta obvia.
     */
    const avalista = por ? almacen.log.dispositivo(por) : null;
    if (!avalista?.aprobado) {
      registrar("aviso", `Intento de autorizar ${deviceId} sin una terminal de confianza`);
      json(403, {
        error: "La autorización tiene que venir de una terminal ya autorizada del local",
      });
      return;
    }

    almacen.log.aprobarDispositivo(deviceId);
    registrar("info", `Terminal ${deviceId} autorizada por ${por}`);
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
  registrar("info", `Hub escuchando en el puerto ${PUERTO}`);
  registrar("info", `Base de datos: ${RUTA_DB} · secuencia actual: ${hub.seqActual}`);

  const lan = direccionesLan();
  if (lan.length === 0) {
    registrar("aviso", "Sin red detectada: solo se podrá conectar desde este mismo equipo.");
  } else {
    console.log("");
    console.log("  Para emparejar una terminal, ábrela con esta dirección:");
    for (const ip of lan) {
      console.log(`    http://${ip}:${PUERTO_POS}/?hub=ws://${ip}:${PUERTO}/sync`);
    }
    console.log("");
  }

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
