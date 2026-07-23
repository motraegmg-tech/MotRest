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
import {
  createServer as createServerHttp,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer } from "node:https";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
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
import { carpetaCertificados, certificadoTls } from "./certificado.js";

const PUERTO = Number(process.env.MOTREST_HUB_PUERTO ?? 8787);
/** Puerto de la escucha local sin certificado. Solo responde a 127.0.0.1. */
const PUERTO_LOCAL = Number(process.env.MOTREST_HUB_PUERTO_LOCAL ?? PUERTO + 1);
const RUTA_DB = resolve(process.env.MOTREST_HUB_DB ?? "./datos/hub.sqlite");
/**
 * POS ya compilado. Si está, el Hub lo sirve desde su mismo puerto.
 *
 * Servirlo aquí y no aparte tiene una razón concreta: la aplicación y el canal
 * de sincronización comparten origen y certificado, así que cada terminal
 * acepta el aviso UNA sola vez en vez de dos.
 */
const RUTA_POS = resolve(process.env.MOTREST_POS_DIST ?? "../pos-ui/dist");
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
 * Sirven para dos cosas: componer el enlace de emparejamiento y meterlas en el
 * certificado, para que el navegador no se queje además de que el nombre no
 * coincide.
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
const lan = direccionesLan();
const tls = await certificadoTls(carpetaCertificados(RUTA_DB), lan);

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function atender(peticion: IncomingMessage, respuesta: ServerResponse): void {
  const url = new URL(peticion.url ?? "/", `https://${peticion.headers.host}`);

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
      tls: tls.huella,
      sirve_pos: existsSync(join(RUTA_POS, "index.html")),
      ts: Date.now(),
    });
    return;
  }

  servirPos(url.pathname, respuesta, json);
}

/** Para las terminales de la red: HTTPS, con el certificado del Hub. */
const servidor = createServer({ cert: tls.cert, key: tls.key }, atender);

/**
 * Segunda escucha, en HTTP y **atada a 127.0.0.1**.
 *
 * El equipo donde corre el Hub —la caja— no debería tener que aceptar un aviso
 * de certificado para abrir su propio punto de venta. `localhost` es un
 * contexto seguro por definición del navegador, así que ahí `crypto.subtle`
 * funciona sin TLS y no hay ningún aviso que saltarse.
 *
 * No es un agujero: al atarla a la interfaz de loopback, el tráfico nunca sale
 * de la máquina. Desde la red esta escucha no existe.
 */
const servidorLocal = createServerHttp(atender);

/**
 * Entrega los archivos del POS compilado.
 *
 * Lo que no exista cae a `index.html`, porque la aplicación enruta por hash y
 * cualquier ruta profunda tiene que devolver la misma página.
 */
function servirPos(
  ruta: string,
  respuesta: ServerResponse,
  json: (codigo: number, cuerpo: unknown) => void,
): void {
  const indice = join(RUTA_POS, "index.html");
  if (!existsSync(indice)) {
    json(404, {
      error: "El POS no está compilado en este equipo",
      pista: "Ejecuta: corepack pnpm@9.15.0 --filter pos-ui build",
    });
    return;
  }

  /*
   * `normalize` sobre la ruta pedida y comprobación de que el resultado sigue
   * dentro de la carpeta del POS: sin eso, una petición con `..` podría leer
   * la base de datos del local o la llave privada del certificado.
   */
  const pedido = normalize(join(RUTA_POS, decodeURIComponent(ruta)));
  const dentro = pedido.startsWith(RUTA_POS);
  const archivo =
    dentro && existsSync(pedido) && statSync(pedido).isFile() ? pedido : indice;

  respuesta.writeHead(200, {
    "content-type": TIPOS[extname(archivo).toLowerCase()] ?? "application/octet-stream",
  });
  createReadStream(archivo).pipe(respuesta);
}

// --- WebSocket: el canal de sincronización ----------------------------------------------

/*
 * Un canal por cada escucha: `wss://` para las terminales de la red y `ws://`
 * para la caja en localhost. La página y su WebSocket tienen que compartir
 * origen, así que quien abre por HTTP necesita el canal por HTTP.
 */
const wss = new WebSocketServer({ server: servidor, path: "/sync" });
const wssLocal = new WebSocketServer({ server: servidorLocal, path: "/sync" });
let contador = 0;

function alConectar(socket: WebSocket): void {
  const id = `cx-${++contador}`;

  /*
   * Cola de envío en serie.
   *
   * Cifrar es asíncrono, así que dos `enviar` seguidos podrían salir en orden
   * invertido —y el protocolo depende del orden: la bienvenida va antes que los
   * catálogos y que los eventos—. Encadenar los envíos lo garantiza.
   *
   * También arregla algo que se vio en pruebas: al rechazar una terminal, el
   * `cerrar()` ganaba la carrera al mensaje de error y la terminal se quedaba
   * desconectada sin saber por qué. Ahora el cierre espera a que salga.
   */
  let cola: Promise<void> = Promise.resolve();

  const conexion: Conexion = {
    id,
    enviar: (mensaje: MensajeHub) => {
      cola = cola.then(async () => {
        if (socket.readyState !== socket.OPEN) return;
        try {
          socket.send(await cifrar(clavesHub.envio, mensaje));
        } catch (causa) {
          registrar("error", `No se pudo enviar la respuesta: ${String(causa)}`);
        }
      });
    },
    cerrar: () => {
      void cola.then(() => socket.close());
    },
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
}

wss.on("connection", alConectar);
wssLocal.on("connection", alConectar);

servidor.listen(PUERTO, () => {
  registrar("info", `Hub escuchando en el puerto ${PUERTO} (HTTPS + WSS)`);
  registrar("info", `Base de datos: ${RUTA_DB} · secuencia actual: ${hub.seqActual}`);
  registrar(
    tls.nuevo ? "aviso" : "info",
    `Certificado ${tls.nuevo ? "generado" : "cargado"} · huella ${tls.huella}`,
  );

  if (!existsSync(join(RUTA_POS, "index.html"))) {
    registrar("aviso", `Sin POS compilado en ${RUTA_POS}.`);
    registrar("aviso", "Compílalo con: corepack pnpm@9.15.0 --filter pos-ui build");
  }

  console.log("");
  console.log("  ── EN ESTE EQUIPO (la caja) ─────────────────────────────");
  console.log(`    http://localhost:${PUERTO_LOCAL}/?hub=ws://localhost:${PUERTO_LOCAL}/sync&k=${claveLocal}`);
  console.log("");
  console.log("    Sin avisos: el navegador confía en localhost por definición.");

  if (lan.length > 0) {
    console.log("");
    console.log("  ── EN LAS DEMÁS TERMINALES (tablets, cocina) ────────────");
    for (const ip of lan) {
      console.log(`    https://${ip}:${PUERTO}/?hub=wss://${ip}:${PUERTO}/sync&k=${claveLocal}`);
    }
    console.log("");
    console.log("    La primera vez el navegador avisará del certificado. En Chrome:");
    console.log("    «Configuración avanzada» o «Help me understand» → «Continuar a…».");
    console.log("    Es el certificado de este Hub; sin él no se puede cifrar nada.");
  }

  console.log("");
  console.log("  Estos enlaces LLEVAN LA CLAVE del local: trátalos como contraseñas.");
  console.log("");

  if (!EXIGIR_APROBACION) {
    registrar("aviso", "MODO ABIERTO: cualquier terminal con la clave sincroniza sin autorizar.");
  }
  registrar("info", "Canal CIFRADO con la clave del local (AES-256-GCM).");
  registrar("aviso", "PENDIENTE: descubrimiento mDNS y QR de emparejamiento.");
});

// Atada a loopback: desde la red esta escucha no existe.
servidorLocal.listen(PUERTO_LOCAL, "127.0.0.1", () => {
  registrar("info", `Acceso local sin certificado en el puerto ${PUERTO_LOCAL} (solo 127.0.0.1)`);
});

function apagar(senal: string): void {
  registrar("info", `Señal ${senal}: cerrando el Hub`);
  wss.close();
  wssLocal.close();
  servidorLocal.close();
  servidor.close(() => {
    almacen.cerrar();
    process.exit(0);
  });
}

process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));
