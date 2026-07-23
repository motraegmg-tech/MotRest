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
  cifrar,
  derivarClaves,
  descifrar,
  generarClaveLocal,
  type Catalogo,
  type ClavesCanal,
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
/** Clave bajo la que se guarda el secreto del local. */
const CLAVE_SECRETO = "clave_local";

/**
 * Secreto del local: con él se cifra todo lo que viaja por la red.
 *
 * Se genera una sola vez, al instalar el Hub, y se guarda con el event log. Es
 * la credencial que se entrega al emparejar una terminal — quien no la tiene no
 * puede ni leer ni escribir en el canal.
 */
const claveLocal =
  (await almacen.estado.cargar<string>(CLAVE_SECRETO)) ??
  (await (async () => {
    const nueva = generarClaveLocal();
    await almacen.estado.guardar(CLAVE_SECRETO, nueva);
    registrar("info", "Clave del local generada. Se usa para cifrar el canal.");
    return nueva;
  })());

const clavesHub: ClavesCanal = await derivarClaves(claveLocal, "hub");

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

/*
 * HTTP: SOLO diagnóstico.
 *
 * Listar terminales y autorizarlas viajaba antes por aquí, y era un error: por
 * una ruta en claro cualquiera en la red del local podía leer los
 * identificadores de las terminales y usar uno autorizado para colarse. Toda
 * la administración se movió al canal cifrado, donde sin la clave del local ni
 * siquiera se puede formular la petición.
 *
 * Lo que queda aquí no revela nada que sirva para entrar: cuántos eventos lleva
 * el local y cuántas terminales están conectadas. Es lo que se necesita para
 * saber, desde fuera, si el servicio está vivo.
 */
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
      cifrado: "AES-256-GCM",
      ts: Date.now(),
    });
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
      if (socket.readyState !== socket.OPEN) return;
      void cifrar(clavesHub.envio, mensaje)
        .then((sobre) => socket.send(sobre))
        .catch((causa) => registrar("error", `No se pudo cifrar la respuesta: ${String(causa)}`));
    },
    cerrar: () => socket.close(),
  };

  hub.conectar(conexion);

  /** Cuántos mensajes ilegibles lleva esta conexión. */
  let ilegibles = 0;

  socket.on("message", (datos) => {
    void descifrar<MensajeCliente>(clavesHub.recepcion, datos.toString()).then((mensaje) => {
      if (!mensaje) {
        /*
         * No se pudo descifrar: o es una terminal sin la clave del local, o
         * alguien probando por el puerto. No se responde nada —decirle qué
         * falló le diría por dónde va bien— y se corta tras unos pocos
         * intentos, para no dejar abierto un canal por el que insistir.
         */
        ilegibles += 1;
        if (ilegibles >= 3) {
          registrar("aviso", `Conexión ${id} cerrada: mensajes que no se pueden descifrar`);
          socket.close();
        }
        return;
      }

      ilegibles = 0;
      try {
        hub.recibir(id, mensaje);
      } catch (causa) {
        registrar("error", `Fallo al procesar ${mensaje.tipo}: ${String(causa)}`);
      }
    });
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
      console.log(
        `    http://${ip}:${PUERTO_POS}/?hub=ws://${ip}:${PUERTO}/sync&k=${claveLocal}`,
      );
    }
    console.log("");
    console.log("  Este enlace LLEVA LA CLAVE del local: trátalo como una contraseña.");
    console.log("");
  }

  if (!EXIGIR_APROBACION) {
    registrar("aviso", "MODO ABIERTO: cualquier dispositivo de la red puede sincronizar.");
  }
  registrar("info", "Canal CIFRADO con la clave del local (AES-256-GCM).");
  registrar("aviso", "PENDIENTE de la etapa 12: descubrimiento mDNS y QR de emparejamiento.");
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
