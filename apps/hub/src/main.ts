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
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
import { carpetaCertificados, certificadoTls, type CertificadoTls } from "./certificado.js";
import { anunciarEnLaRed } from "./descubrimiento.js";
import { Sellador, carpetaDelCsd } from "./fiscal/sellador.js";
import { ColaDeTimbrado } from "./fiscal/cola-timbrado.js";
import { Facturador } from "./fiscal/facturador.js";
import { MAPEO_REST_COMUN, PacHttp, consultaPorFolio } from "./fiscal/pac-http.js";
import type { DatabaseSync as TipoDatabaseSync } from "node:sqlite";

const PUERTO = Number(process.env.MOTREST_HUB_PUERTO ?? 8787);
/** Puerto de la escucha local sin certificado. Solo responde a 127.0.0.1. */
const PUERTO_LOCAL = Number(process.env.MOTREST_HUB_PUERTO_LOCAL ?? PUERTO + 1);

/** ¿Corre desde el instalador, o desde el repositorio en desarrollo? */
const INSTALADO = esEjecutableEmpaquetado();

function esEjecutableEmpaquetado(): boolean {
  try {
    // `node:sea` solo existe cuando el código va incrustado en un ejecutable.
    return (createRequire(import.meta.url)("node:sea") as { isSea(): boolean }).isSea();
  } catch {
    return false;
  }
}

/**
 * Dónde vive el registro del local.
 *
 * Instalado, va a los datos del usuario y NUNCA junto al ejecutable: Windows
 * protege `Program Files` contra escritura, así que el Hub no podría ni crear
 * su base y el restaurante se quedaría sin caja el primer día. En desarrollo se
 * queda junto al código, que es donde conviene tenerlo a la vista.
 */
function carpetaDeDatos(): string {
  if (!INSTALADO) return "./datos/hub.sqlite";
  const base =
    process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.env.HOME ?? ".";
  return join(base, "MotRest", "datos", "hub.sqlite");
}

const RUTA_DB = resolve(process.env.MOTREST_HUB_DB ?? carpetaDeDatos());

/**
 * POS ya compilado. Si está, el Hub lo sirve desde su mismo puerto.
 *
 * Servirlo aquí y no aparte tiene una razón concreta: la aplicación y el canal
 * de sincronización comparten origen y certificado, así que cada terminal
 * acepta el aviso UNA sola vez en vez de dos.
 *
 * Instalado, el POS viaja junto al ejecutable —de solo lectura, que es lo
 * correcto para archivos de programa—.
 */
const RUTA_POS = resolve(
  process.env.MOTREST_POS_DIST ??
    (INSTALADO ? join(dirname(process.execPath), "pos") : "../pos-ui/dist"),
);
const HUB_ID = process.env.MOTREST_HUB_ID ?? "hub-local";
/** Nombre con el que el Hub se anuncia en la red: `<nombre>.local`. */
const NOMBRE_RED = process.env.MOTREST_HUB_NOMBRE ?? "motrest";
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
async function resolverClaveLocal(): Promise<string> {
  const guardada = await almacen.estado.cargar<string>(CLAVE_SECRETO);
  if (guardada) return guardada;

  const nueva = generarClaveLocal();
  await almacen.estado.guardar(CLAVE_SECRETO, nueva);
  registrar("info", "Clave del local generada. Se usa para cifrar el canal.");
  return nueva;
}

/*
 * Lo que hace falta antes de escuchar, resuelto en `arrancar()` y no en el
 * cuerpo del módulo.
 *
 * No es estilo: al empaquetar el Hub en un ejecutable, el `await` de nivel
 * superior no está permitido. Tenerlo aquí impedía que el Hub llegara al
 * instalador, que es lo que lo convierte en un producto.
 */
let claveLocal = "";
let clavesHub: ClavesCanal;

/**
 * Enlaces para emparejar otra terminal, uno por dirección del Hub.
 *
 * Se componen aquí porque solo el Hub conoce sus direcciones en la red. Van al
 * QR que se muestra en la caja: la tablet lo escanea y queda enlazada, sin que
 * nadie teclee una IP ni 43 caracteres de clave.
 */
function enlacesEmparejamiento(): { etiqueta: string; url: string }[] {
  const enlace = (host: string) =>
    `https://${host}:${PUERTO}/?hub=wss://${host}:${PUERTO}/sync&k=${claveLocal}`;

  return [
    // El nombre va PRIMERO: sobrevive a que el router cambie la IP del equipo,
    // que es lo que rompería el emparejamiento de todas las terminales a la vez.
    { etiqueta: `${NOMBRE_RED}.local`, url: enlace(`${NOMBRE_RED}.local`) },
    ...direccionesLan().map((ip) => ({ etiqueta: ip, url: enlace(ip) })),
  ];
}

/*
 * Facturación.
 *
 * La base fiscal va aparte de la del event log a propósito: la cola de
 * timbrado es estado de infraestructura —cuántos intentos lleva, cuándo toca
 * el siguiente—, no hechos del negocio. El log es la bitácora y no se ensucia
 * con reintentos.
 *
 * El PAC se configura por variables de entorno porque su credencial es un
 * secreto y los secretos no van al repositorio. Sin ellas el Hub arranca igual:
 * sella y encola, y timbra en cuanto haya proveedor.
 */
// Por `require` y no con un import estático: el empaquetador le quita el
// prefijo `node:` y se pone a buscar un paquete "sqlite" que no existe.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof TipoDatabaseSync;
};

const almacenFiscal = new DatabaseSync(join(dirname(RUTA_DB), "fiscal.sqlite"));
const sellador = new Sellador(carpetaDelCsd(dirname(RUTA_DB)));
const pac = pacDelEntorno();
const colaTimbrado = new ColaDeTimbrado(almacenFiscal, pac, registrar);
const facturador = new Facturador(
  almacen.log,
  sellador,
  colaTimbrado,
  almacenFiscal,
  registrar,
);

const hub = new Hub({
  hub_id: HUB_ID,
  log: almacen.log,
  exigirAprobacion: EXIGIR_APROBACION,
  enlaces: enlacesEmparejamiento,
  registrar,
  fiscal: { sellador, cola: colaTimbrado, facturador, nombrePac: pac?.nombre },
  guardarCatalogo: (catalogo) => {
    // Se guardan todos juntos: son pocos y así el archivo queda consistente.
    void almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS).then((previos) => {
      const resto = (previos ?? []).filter((c) => c.clave !== catalogo.clave);
      void almacen.estado.guardar(CLAVE_CATALOGOS, [...resto, catalogo]);
    });
  },
});

/**
 * Arma el PAC desde el entorno, si está configurado.
 *
 * `MOTREST_PAC_URL` y `MOTREST_PAC_TOKEN`. La credencial NUNCA va al
 * repositorio ni a la base: es la llave para gastar el saldo de timbres del
 * restaurante.
 */
function pacDelEntorno(): PacHttp | null {
  const url = process.env.MOTREST_PAC_URL;
  const token = process.env.MOTREST_PAC_TOKEN;
  if (!url || !token) return null;

  /*
   * `MOTREST_PAC_URL_CONSULTA` es opcional pero conviene ponerla: es lo que
   * permite recuperar sola una factura que el PAC ya timbró y cuyo acuse se
   * perdió por un corte. Sin ella, ese caso acaba en una búsqueda manual en el
   * portal del proveedor.
   */
  const urlConsulta = process.env.MOTREST_PAC_URL_CONSULTA;
  if (!urlConsulta) {
    registrar(
      "aviso",
      "Sin MOTREST_PAC_URL_CONSULTA: si una factura se timbra y el acuse se pierde, habrá que recuperarla a mano.",
    );
  }

  return new PacHttp({
    nombre: process.env.MOTREST_PAC_NOMBRE ?? "PAC",
    token,
    mapeo: {
      ...MAPEO_REST_COMUN,
      url,
      ...(urlConsulta ? { recuperacion: consultaPorFolio(urlConsulta) } : {}),
    },
  });
}

/**
 * Reintenta lo pendiente cada pocos minutos.
 *
 * El intervalo es corto comparado con las 72 horas que da el SAT, y la espera
 * creciente de la propia cola evita que esto se convierta en insistencia: si el
 * PAC está caído, la mayoría de las facturas ni siquiera se tocarán.
 */
const CADA_CINCO_MINUTOS = 300_000;
const relojDeTimbrado = setInterval(() => {
  void colaTimbrado.procesar().catch((error: unknown) => {
    registrar("error", `Fallo al procesar la cola de timbrado: ${String(error)}`);
  });
}, CADA_CINCO_MINUTOS);
// Que este reloj no sea la razón por la que el proceso no termina.
relojDeTimbrado.unref();

if (sellador.listo) {
  const estado = sellador.estado();
  registrar("info", `CSD cargado: RFC ${estado.rfc}, vence en ${estado.dias_restantes} días.`);
  if ((estado.dias_restantes ?? 0) < 30) {
    registrar(
      "aviso",
      `El CSD vence en ${estado.dias_restantes} días. Tramita la renovación en el portal del SAT.`,
    );
  }
  // Lo que se cobró mientras el Hub estaba apagado se sella ahora.
  facturador.procesar(1000);
} else {
  const esperando = facturador.esperandoCsd();
  registrar(
    "info",
    esperando > 0
      ? `Sin CSD: se puede vender, todavía no facturar. Hay ${esperando} comprobante(s) esperando certificado.`
      : "Sin CSD: se puede vender, todavía no facturar.",
  );
}

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
/** Se resuelve en `arrancar()`, junto con el resto de lo asíncrono. */
let tls: CertificadoTls;

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
  // Quien pide desde el propio equipo ya tiene acceso al archivo de la clave,
  // así que entregársela en la página no le da nada que no tuviera.
  const esLocal = esPeticionLocal(peticion);

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

  servirPos(url.pathname, respuesta, json, esLocal);
}

/**
 * ¿La petición viene de este mismo equipo?
 *
 * Solo a esas se les entrega el emparejamiento ya hecho. Una terminal de la red
 * tiene que emparejarse con el QR, como cualquier otra: si el Hub repartiera su
 * clave a quien la pidiera por la red, el cifrado no protegería de nada.
 */
function esPeticionLocal(peticion: IncomingMessage): boolean {
  const origen = peticion.socket.remoteAddress ?? "";
  return origen === "127.0.0.1" || origen === "::1" || origen === "::ffff:127.0.0.1";
}

/**
 * Los dos servidores. Se crean en `arrancar()` porque el de la red necesita el
 * certificado, que se carga o se genera de forma asíncrona.
 *
 * El segundo va en HTTP y **atado a 127.0.0.1**: el equipo donde corre el Hub
 * —la caja— no debería tener que aceptar un aviso de certificado para abrir su
 * propio punto de venta. `localhost` es un contexto seguro por definición del
 * navegador, así que ahí `crypto.subtle` funciona sin TLS. No es un agujero: al
 * atarlo al loopback, desde la red esa escucha no existe.
 */
let servidor: ReturnType<typeof createServer>;
let servidorLocal: ReturnType<typeof createServerHttp>;

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
  esLocal: boolean,
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

  /*
   * La caja se empareja sola con su propio Hub.
   *
   * Sin esto, la terminal del equipo donde corre el Hub quedaba SIN emparejar:
   * guardaba la operación en el almacenamiento de su navegador y el registro
   * del local se quedaba vacío. Dos almacenes que no se hablan — al reinstalar
   * se perdía todo, y otra terminal que se conectara no encontraba nada.
   *
   * Solo se inyecta a quien pide desde este mismo equipo. Por la red, cada
   * terminal se empareja con el QR.
   */
  if (archivo === indice && esLocal) {
    const html = readFileSync(indice, "utf8").replace(
      "</head>",
      `  <script>
      window.__MOTREST_HUB__ = ${JSON.stringify({
        url: `ws://localhost:${PUERTO_LOCAL}/sync`,
        clave: claveLocal,
      })};
    </script>
  </head>`,
    );
    respuesta.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    respuesta.end(html);
    return;
  }

  respuesta.writeHead(200, {
    "content-type": TIPOS[extname(archivo).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheDe(archivo, indice),
  });
  createReadStream(archivo).pipe(respuesta);
}

/**
 * Cuánto puede guardar el navegador cada archivo.
 *
 * Sin esto —que es como estaba— el navegador aplica su propia heurística y
 * puede quedarse con un `index.html` viejo indefinidamente. El síntoma es
 * desconcertante: el Hub sirve la versión nueva, pero la terminal sigue
 * mostrando la anterior y ninguna función nueva aparece. Le pasó a Gonzalo con
 * la pantalla del QR.
 *
 * La regla es la estándar para una aplicación con archivos versionados por
 * nombre: el índice se revalida SIEMPRE, y los assets —que llevan un hash en el
 * nombre— se guardan para siempre, porque un cambio produce otro nombre.
 */
function cacheDe(archivo: string, indice: string): string {
  if (archivo === indice) return "no-cache";
  return archivo.includes("assets") ? "public, max-age=31536000, immutable" : "no-cache";
}

// --- WebSocket: el canal de sincronización ----------------------------------------------

/*
 * Un canal por cada escucha: `wss://` para las terminales de la red y `ws://`
 * para la caja en localhost. La página y su WebSocket tienen que compartir
 * origen, así que quien abre por HTTP necesita el canal por HTTP.
 */
let wss: WebSocketServer;
let wssLocal: WebSocketServer;
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

/**
 * Arranque del Hub.
 *
 * Todo lo asíncrono vive aquí y no en el cuerpo del módulo. No es estilo: al
 * empaquetar el Hub en un ejecutable para el instalador, el `await` de nivel
 * superior no está permitido, y tenerlo impedía que llegara al producto.
 */
async function arrancar(): Promise<void> {
  claveLocal = await resolverClaveLocal();
  clavesHub = await derivarClaves(claveLocal, "hub");
  tls = await certificadoTls(carpetaCertificados(RUTA_DB), lan, `${NOMBRE_RED}.local`);

  const guardados = await almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS);
  if (guardados && guardados.length > 0) {
    hub.cargarCatalogos(guardados);
    registrar("info", `Catálogos cargados: ${guardados.map((c) => c.clave).join(", ")}`);
  }

  servidor = createServer({ cert: tls.cert, key: tls.key }, atender);
  servidorLocal = createServerHttp(atender);

  wss = new WebSocketServer({ server: servidor, path: "/sync" });
  wssLocal = new WebSocketServer({ server: servidorLocal, path: "/sync" });
  wss.on("connection", alConectar);
  wssLocal.on("connection", alConectar);

  escuchar();
}

/**
 * Explica un fallo al ocupar un puerto, en vez de volcar la pila.
 *
 * El caso real es abrir la caja dos veces: el segundo arranque encuentra el
 * puerto tomado y hasta ahora moría con un volcado de Node que no le dice nada
 * a quien abre un restaurante.
 */
function alFallarEscucha(causa: NodeJS.ErrnoException, puerto: number): void {
  if (causa.code === "EADDRINUSE") {
    registrar("error", `El puerto ${puerto} ya está ocupado.`);
    registrar("error", "Probablemente el Hub ya está corriendo en este equipo.");
    registrar("error", "Ciérralo antes, o usa MOTREST_HUB_PUERTO para otro puerto.");
  } else if (causa.code === "EACCES") {
    registrar("error", `Sin permiso para usar el puerto ${puerto}.`);
  } else {
    registrar("error", `No se pudo escuchar en el puerto ${puerto}: ${causa.message}`);
  }
  process.exit(1);
}

function escuchar(): void {
  servidor.on("error", (causa: NodeJS.ErrnoException) => alFallarEscucha(causa, PUERTO));
  servidorLocal.on("error", (causa: NodeJS.ErrnoException) =>
    alFallarEscucha(causa, PUERTO_LOCAL),
  );

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
    console.log(
      `    http://localhost:${PUERTO_LOCAL}/?hub=ws://localhost:${PUERTO_LOCAL}/sync&k=${claveLocal}`,
    );
    console.log("");
    console.log("    Sin avisos: el navegador confía en localhost por definición.");

    if (lan.length > 0) {
      console.log("");
      console.log("  ── EN LAS DEMÁS TERMINALES (tablets, cocina) ────────────");
      console.log("    Lo más cómodo: Administración → Hub del local → Mostrar código,");
      console.log("    y escanear el QR con la cámara de la tablet.");
      console.log("");
      for (const { url } of enlacesEmparejamiento()) {
        console.log(`    ${url}`);
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
  });

  // Atada a loopback: desde la red esta escucha no existe.
  servidorLocal.listen(PUERTO_LOCAL, "127.0.0.1", () => {
    registrar("info", `Acceso local sin certificado en el puerto ${PUERTO_LOCAL} (solo 127.0.0.1)`);
  });

  /*
   * Anuncio en la red. Si falla no pasa nada: el Hub sigue siendo alcanzable
   * por IP y el enlace con IP se mantiene por eso.
   */
  anuncio = anunciarEnLaRed(NOMBRE_RED, lan, registrar);
}

let anuncio: ReturnType<typeof anunciarEnLaRed> = null;

function apagar(senal: string): void {
  registrar("info", `Señal ${senal}: cerrando el Hub`);
  anuncio?.detener();
  wss?.close();
  wssLocal?.close();
  servidorLocal?.close();
  if (!servidor) process.exit(0);
  servidor.close(() => {
    almacen.cerrar();
    process.exit(0);
  });
}

process.on("SIGINT", () => apagar("SIGINT"));
process.on("SIGTERM", () => apagar("SIGTERM"));

arrancar().catch((causa) => {
  // Si el arranque falla no hay Hub, y quedarse en silencio dejaría al
  // restaurante creyendo que está encendido. Se dice y se sale con error.
  registrar("error", `No se pudo arrancar el Hub: ${String(causa)}`);
  process.exit(1);
});
