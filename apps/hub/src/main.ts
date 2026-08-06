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
import type { EventoBase, EventoMensajeria, EventoOpinion } from "@motrest/dominio";
import { configuracionVacia, pideBaja, streamMensajeria, uuidv7 } from "@motrest/dominio";
import type { ConfiguracionCorreo } from "@motrest/dominio";
import {
  cifrar,
  derivarClaves,
  derivarSecretoPortal,
  descifrar,
  generarClaveLocal,
  type Catalogo,
  type ClavesCanal,
  type MensajeCliente,
  type MensajeHub,
} from "@motrest/protocolo-sync";
import { almacenSqlite } from "@motrest/protocolo-sync/sqlite";
import { Hub, type Conexion } from "./servidor.js";
import * as autoarranque from "./autoarranque.js";
import { GestorLicencia } from "./licencia.js";
import { Actualizaciones, CADA_MS as ACTUALIZAR_CADA_MS } from "./actualizaciones.js";
import { registrarOpinion, solicitarReserva, verCuenta } from "./portal.js";
import { Avisos, avisoReservaConfirmada } from "./avisos.js";
import { Correo } from "./correo.js";
import { EnlaceRelayWs, type MensajeDelComensal } from "./relay.js";
import { carpetaCertificados, certificadoTls, type CertificadoTls } from "./certificado.js";
import { anunciarEnLaRed } from "./descubrimiento.js";
import { Sellador, carpetaDelCsd } from "./fiscal/sellador.js";
import { ColaDeTimbrado } from "./fiscal/cola-timbrado.js";
import { Facturador } from "./fiscal/facturador.js";
import { Cancelador } from "./fiscal/cancelador.js";
import { MAPEO_REST_COMUN, PacHttp, consultaPorFolio } from "./fiscal/pac-http.js";
import { enviarARed } from "./impresion/transporte-red.js";
import { enMegas, evaluarCrecimiento } from "./crecimiento.js";
import {
  INTERVALO_RESPALDO_MS,
  crearRespaldo,
  listarRespaldos,
  rotarRespaldos,
} from "./respaldo.js";
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
 * ¿Es la instalación de verdad, o un ensayo?
 *
 * Un ensayo levanta el MISMO ejecutable sobre una base temporal. No debe
 * registrarse en el arranque de Windows: dejaría el Hub apuntando a una carpeta
 * que se borra al terminar la prueba.
 */
const INSTALACION_REAL = INSTALADO && process.env.MOTREST_HUB_DB === undefined;

/** Cómo quedó el arranque automático con Windows. Se reporta en /salud. */
let arranqueAutomatico: autoarranque.EstadoAutoarranque = { soportado: false, activo: false };

/**
 * Con qué se firman los enlaces del portal del comensal.
 *
 * Se deriva de la clave del local con HKDF y su propia etiqueta, igual que en
 * cada terminal: por eso el Hub puede verificar un QR que imprimió una tablet
 * sin haber hablado con ella.
 */
let secretoPortal = "";

/** El enlace con el relay y la cola de avisos. Nulos si el local no usa WhatsApp. */
let enlaceRelay: EnlaceRelayWs | null = null;
let avisos: Avisos | null = null;

/**
 * El correo del restaurante. A diferencia de WhatsApp, NO necesita relay: es
 * una llamada de salida que el Hub hace desde el propio local.
 */
let correo: Correo | null = null;
/** Clave bajo la que vive la configuración de correo del local. */
const CLAVE_CORREO = "correo_config";
let configCorreo: ConfiguracionCorreo = configuracionVacia();
/** Llave de Resend, o contraseña de aplicación de Gmail según el modo. */
let llaveResend = "";

/** La licencia de este local. Se carga al arrancar y no vuelve a pedir permiso a nadie. */
let licencia: GestorLicencia | null = null;
/** El buscador de versiones nuevas, si MOTRAE configuró el canal. */
let actualizador: Actualizaciones | null = null;
/** Lo último que se encontró publicado, para contárselo a las terminales. */
let versionDisponible: import("@motrest/dominio").VersionDisponible | null = null;

/**
 * A qué sucursal pertenece este Hub.
 *
 * No se configura: se APRENDE del propio registro, porque cada evento la trae.
 * Un Hub recién instalado todavía no lo sabe, y hasta que llegue el primer
 * evento el portal no tiene a quién atribuir una reserva — que es correcto: un
 * local sin operación tampoco tiene comensales.
 */
function sucursalDelLocal(): string {
  const ultimos = almacen.log.desde(Math.max(0, hub.seqActual - 5), 5);
  return ultimos.at(-1)?.sucursal_id ?? process.env.MOTREST_SUCURSAL_ID ?? "suc-local";
}

/**
 * Dónde se guardan las copias del registro del local.
 *
 * Por defecto, junto a la base. Eso salva de una corrupción o de un borrado,
 * pero NO de que el disco se muera: para eso hay que apuntar
 * `MOTREST_RESPALDOS` a una unidad externa o a una carpeta sincronizada. El
 * estado se reporta en `/salud` para poder comprobar que de verdad se respalda.
 */
const RUTA_RESPALDOS = resolve(
  process.env.MOTREST_RESPALDOS ?? join(dirname(RUTA_DB), "respaldos"),
);

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
/** El portal del comensal compilado. Viaja junto al POS en la instalación. */
const RUTA_PORTAL = resolve(
  process.env.MOTREST_PORTAL_DIST ??
    (INSTALADO ? join(dirname(process.execPath), "portal") : "../portal/dist"),
);

const HUB_ID = process.env.MOTREST_HUB_ID ?? "hub-local";
/** Nombre con el que el Hub se anuncia en la red: `<nombre>.local`. */
const NOMBRE_RED = process.env.MOTREST_HUB_NOMBRE ?? "motrest";
// Por omisión SÍ se exige aprobación: es la postura segura. Se relaja solo si
// quien instala lo pide explícitamente.
const EXIGIR_APROBACION = process.env.MOTREST_HUB_ABIERTO !== "1";

/**
 * La licencia vive JUNTO A LA BASE DE DATOS, no junto al ejecutable.
 *
 * Es lo que hace que una actualización no la borre: los archivos de programa se
 * reemplazan enteros al instalar una versión nueva, y una licencia que viviera
 * ahí desaparecería con cada actualización. Este es el error que deja a un
 * restaurante bloqueado la mañana después de actualizar.
 */
const RUTA_LICENCIA = join(dirname(RUTA_DB), "licencia.json");

/** La versión instalada. Se compara contra lo que se publique en GitHub. */
const VERSION = createRequire(import.meta.url)("../package.json").version as string;

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
/** Configuración de WhatsApp de este restaurante, si la tiene. */
const CLAVE_WHATSAPP = "whatsapp";
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
  { hub_id: HUB_ID, nombrePac: pac?.nombre },
);

const cancelador = new Cancelador(almacen.log, sellador, almacenFiscal, pac, registrar, HUB_ID);

/**
 * Un ciclo completo de facturación: sellar lo nuevo, timbrar, devolver el
 * resultado al registro del local, y atender las cancelaciones pedidas.
 *
 * Los pasos van juntos siempre. Timbrar sin publicar dejaría el folio fiscal
 * encerrado en la base del Hub, y la caja no podría entregar la factura.
 */
async function cicloFiscal(): Promise<void> {
  facturador.procesar();
  await colaTimbrado.procesar();
  facturador.publicarResultados();
  await cancelador.procesar();
}

const hub = new Hub({
  hub_id: HUB_ID,
  log: almacen.log,
  exigirAprobacion: EXIGIR_APROBACION,
  enlaces: enlacesEmparejamiento,
  registrar,
  alIngerir: (eventos) => avisarPorLoQuePaso(eventos),
  fiscal: { sellador, cola: colaTimbrado, facturador, cancelador, nombrePac: pac?.nombre },
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
  void cicloFiscal().catch((error: unknown) => {
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

  /*
   * Impresión ESC/POS: la caja manda los bytes ya armados y el Hub los pone en
   * el cable de la impresora. Es lo que el navegador no puede hacer.
   *
   * SOLO desde este mismo equipo. La caja (su webview vive en tauri.localhost)
   * llega por aquí; una terminal de la red, no —abrir un socket a un host que
   * pida un desconocido de la wifi sería un relay hacia la red interna del
   * local—. El transporte, además, solo marca a IPs privadas y puertos de
   * impresora. El CORS se abre nada más para el origen de la propia caja.
   */
  /*
   * Encender o apagar el arranque automático con Windows.
   *
   * Solo desde este mismo equipo: es una decisión sobre ESTA computadora, y
   * nadie en la wifi del local tiene por qué poder tocar qué arranca en la caja.
   */
  if (url.pathname === "/arranque-automatico") {
    if (!esLocal) {
      json(403, { error: "Solo se configura desde el propio equipo" });
      return;
    }
    permitirCorsCaja(peticion, respuesta);
    if (peticion.method === "OPTIONS") {
      respuesta.writeHead(204);
      respuesta.end();
      return;
    }
    if (peticion.method !== "POST") {
      json(405, { error: "Usa POST" });
      return;
    }

    void leerCuerpo(peticion)
      .then(async (crudo) => {
        const texto = crudo.toString("utf8") || "{}";
        const quiere = (JSON.parse(texto) as { activo?: unknown }).activo === true;
        arranqueAutomatico = quiere
          ? await autoarranque.activar()
          : await autoarranque.desactivar();
        registrar(
          "info",
          `Arranque automático ${arranqueAutomatico.activo ? "activado" : "desactivado"}.`,
        );
        json(200, arranqueAutomatico);
      })
      .catch((causa) => json(400, { error: String(causa) }));
    return;
  }

  /*
   * EL PORTAL DEL COMENSAL.
   *
   * Es lo único del Hub que atiende a un dispositivo que NO es del restaurante:
   * el teléfono de quien acabó de comer, conectado al wifi del local. Por eso
   * NO se exige `esLocal` —el teléfono no es la caja— y por eso cada ruta
   * verifica por su cuenta el enlace firmado.
   *
   * Lo que protege esta puerta no es de dónde viene la petición: es que sin la
   * firma del local no se abre ninguna cuenta.
   */
  if (url.pathname.startsWith("/portal/api/")) {
    respuesta.setHeader("access-control-allow-origin", "*");
    respuesta.setHeader("access-control-allow-headers", "content-type");
    respuesta.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (peticion.method === "OPTIONS") {
      respuesta.writeHead(204);
      respuesta.end();
      return;
    }
    void atenderPortal(url, peticion, json);
    return;
  }

  if (url.pathname === "/portal" || url.pathname.startsWith("/portal/")) {
    servirPortal(url.pathname.slice("/portal".length) || "/", respuesta, json);
    return;
  }

  if (url.pathname === "/imprimir") {
    if (!esLocal) {
      json(403, { error: "La impresión solo se acepta desde el propio equipo" });
      return;
    }
    permitirCorsCaja(peticion, respuesta);
    if (peticion.method === "OPTIONS") {
      respuesta.writeHead(204);
      respuesta.end();
      return;
    }
    if (peticion.method !== "POST") {
      json(405, { error: "Usa POST" });
      return;
    }
    void atenderImpresion(peticion, json);
    return;
  }

  /*
   * La licencia. Solo desde la propia caja: instalar una licencia es una acción
   * de administración, y cualquiera en la wifi del local no tiene por qué poder
   * intentarlo ni leer el estado de cobro del restaurante.
   */
  if (url.pathname === "/licencia") {
    if (!esLocal) {
      json(403, { error: "Solo desde la caja" });
      return;
    }

    if (peticion.method === "GET") {
      const v = licencia?.veredicto();
      json(200, {
        ...(licencia?.paraTerminales(true) ?? { licencia: null, verificada: false }),
        situacion: v?.situacion ?? null,
        version: VERSION,
      });
      return;
    }

    if (peticion.method === "POST") {
      void (async () => {
        try {
          const cuerpo = await leerCuerpo(peticion, 32 * 1024);
          const r = await licencia!.instalar(JSON.parse(cuerpo.toString("utf8")));
          if (!r.ok) {
            json(400, { error: r.error });
            return;
          }
          // Las terminales se enteran al momento: si estaban bloqueadas, se
          // desbloquean sin que nadie tenga que reiniciar nada.
          difundirLicencia();
          json(200, { ok: true, situacion: licencia!.veredicto().situacion });
        } catch (causa) {
          json(400, { error: `No se pudo leer la licencia: ${String(causa)}` });
        }
      })();
      return;
    }

    json(405, { error: "Usa GET o POST" });
    return;
  }

  if (url.pathname === "/salud") {
    /*
     * Por la red se responde lo MÍNIMO: que el servicio vive y sirve el POS.
     *
     * El detalle —secuencia, terminales conectadas, huella del certificado— solo
     * se entrega a quien pregunta desde este mismo equipo. Cualquiera en la wifi
     * del local podía leer cuántas ventas lleva el Hub y con qué certificado
     * opera; no es catastrófico, pero es información que no tiene por qué salir.
     */
    if (esLocal) {
      // El último respaldo se informa para que se pueda COMPROBAR que existe,
      // en vez de suponerlo. Un respaldo que nadie mira es el que falla.
      const copias = listarRespaldos(RUTA_RESPALDOS);
      json(200, {
        hub_id: HUB_ID,
        seq: hub.seqActual,
        conectados: hub.conectados,
        registro: (() => {
          const c = evaluarCrecimiento(hub.seqActual, tamanoDelRegistro());
          return { eventos: c.eventos, bytes: c.bytes, nivel: c.nivel };
        })(),
        respaldo: copias[0]
          ? { ultimo: copias[0].ts, copias: copias.length, carpeta: RUTA_RESPALDOS }
          : { ultimo: null, copias: 0, carpeta: RUTA_RESPALDOS },
        arranque_automatico: arranqueAutomatico,
        version: VERSION,
        // Los días restantes van en `/salud` para poder verlos desde
        // Administración → Hub sin abrir otra pantalla.
        licencia: licencia?.veredicto().situacion ?? null,
        actualizacion: versionDisponible
          ? { version: versionDisponible.version, notas: versionDisponible.notas }
          : null,
        exige_aprobacion: EXIGIR_APROBACION,
        cifrado: "AES-256-GCM",
        tls: tls.huella,
        sirve_pos: existsSync(join(RUTA_POS, "index.html")),
        ts: Date.now(),
      });
    } else {
      json(200, { ok: true, sirve_pos: existsSync(join(RUTA_POS, "index.html")) });
    }
    return;
  }

  servirPos(url.pathname, respuesta, json, esLocal);
}

/**
 * CORS solo para el origen de la propia caja.
 *
 * La webview de Tauri sirve el POS desde `tauri.localhost` y esta escucha vive
 * en `localhost:8788`: son orígenes distintos, así que sin estas cabeceras la
 * webview no puede leer la respuesta del Hub y no sabría si la comanda se
 * imprimió. Se refleja el origen en vez de abrir `*`, y solo para localhost y
 * tauri; como la escucha está atada al loopback, esto no amplía nada hacia la red.
 */
function permitirCorsCaja(peticion: IncomingMessage, respuesta: ServerResponse): void {
  const origen = peticion.headers.origin ?? "";
  const permitido =
    origen === "http://tauri.localhost" ||
    origen === "https://tauri.localhost" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen);
  if (!permitido) return;
  respuesta.setHeader("access-control-allow-origin", origen);
  respuesta.setHeader("access-control-allow-methods", "POST, OPTIONS");
  respuesta.setHeader("access-control-allow-headers", "content-type");
  respuesta.setHeader("vary", "origin");
}

/** Lee el cuerpo de una petición, con un tope para no tragarse memoria. */
function leerCuerpo(peticion: IncomingMessage, maxBytes = 512 * 1024): Promise<Buffer> {
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
    peticion.on("end", () => resolver(Buffer.concat(trozos)));
    peticion.on("error", rechazar);
  });
}

/**
 * Recibe un trabajo de impresión de la caja y lo manda a la impresora.
 *
 * El cuerpo trae `{ host, puerto, datos_base64 }`. El transporte valida el
 * destino (IP privada, puerto de impresora) antes de abrir el socket.
 */
/**
 * Las rutas del portal del comensal.
 *
 * Cada una verifica el enlace firmado por su cuenta; ninguna confía en la
 * anterior. Las opiniones previas se leen del registro en cada llamada en vez
 * de mantenerlas en memoria: son pocas por cuenta, y una copia en memoria que
 * se desincronice permitiría calificar dos veces.
 */
async function atenderPortal(
  url: URL,
  peticion: IncomingMessage,
  json: (codigo: number, cuerpo: unknown) => void,
): Promise<void> {
  const deps = {
    leerStream: (streamId: string) => almacen.eventos.leerStream(streamId),
    ingerir: (eventos: readonly EventoBase[]) => hub.inyectar(eventos),
    secreto: () => secretoPortal,
    sucursalId: sucursalDelLocal(),
  };

  const opinionesPrevias = () =>
    almacen.log.porTipo("opinion_registrada", 0, 5000) as unknown as EventoOpinion[];

  const responder = (r: { ok: boolean; codigo?: number; error?: string; datos?: unknown }): void => {
    if (r.ok) json(200, r.datos);
    else json(r.codigo ?? 400, { error: r.error });
  };

  try {
    // GET /portal/api/cuenta/<codigo>
    if (peticion.method === "GET" && url.pathname.startsWith("/portal/api/cuenta/")) {
      const codigo = decodeURIComponent(url.pathname.slice("/portal/api/cuenta/".length));
      responder(await verCuenta(codigo, deps, opinionesPrevias()));
      return;
    }

    if (peticion.method !== "POST") {
      json(405, { error: "Usa POST" });
      return;
    }

    const cuerpo = JSON.parse((await leerCuerpo(peticion, 16 * 1024)).toString("utf8")) as Record<
      string,
      never
    >;

    if (url.pathname === "/portal/api/opinion") {
      const codigo = String(cuerpo.codigo ?? "");
      responder(await registrarOpinion(codigo, cuerpo as never, deps, opinionesPrevias()));
      return;
    }

    if (url.pathname === "/portal/api/reserva") {
      responder(solicitarReserva(cuerpo as never, deps));
      return;
    }

    json(404, { error: "No existe" });
  } catch (causa) {
    // Nunca se devuelve el detalle: un mensaje de error interno le describe a
    // quien prueba cómo está hecho el sistema por dentro.
    registrar("aviso", `Portal: ${String(causa)}`);
    json(400, { error: "No se pudo procesar la petición" });
  }
}

async function atenderImpresion(
  peticion: IncomingMessage,
  json: (codigo: number, cuerpo: unknown) => void,
): Promise<void> {
  try {
    const cuerpo = await leerCuerpo(peticion);
    const datos = JSON.parse(cuerpo.toString("utf8")) as {
      host?: unknown;
      puerto?: unknown;
      datos_base64?: unknown;
    };

    if (typeof datos.host !== "string" || typeof datos.puerto !== "number" || typeof datos.datos_base64 !== "string") {
      json(400, { error: "Faltan host, puerto o datos_base64" });
      return;
    }

    const bytes = Buffer.from(datos.datos_base64, "base64");
    const resultado = await enviarARed(datos.host, datos.puerto, bytes);
    json(resultado.ok ? 200 : 502, resultado);
  } catch (causa) {
    json(400, { error: causa instanceof Error ? causa.message : "Petición inválida" });
  }
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
 * Entrega el portal del comensal.
 *
 * Va aparte del POS a propósito, y no solo por orden: son dos aplicaciones con
 * públicos distintos. El POS lleva la operación del restaurante; el portal es
 * 40 KB que abre un teléfono ajeno. Compartir el paquete significaría mandarle
 * a cada comensal el código de la caja.
 *
 * Se sirve desde el Hub para que funcione con el internet del local caído: el
 * teléfono solo necesita estar en su wifi.
 */
function servirPortal(
  ruta: string,
  respuesta: ServerResponse,
  json: (codigo: number, cuerpo: unknown) => void,
): void {
  const indice = join(RUTA_PORTAL, "index.html");
  if (!existsSync(indice)) {
    json(404, {
      error: "El portal del comensal no está compilado en este equipo",
      pista: "Ejecuta: corepack pnpm@9.15.0 --filter @motrest/portal build",
    });
    return;
  }

  // Misma defensa que en el POS: sin comprobar que la ruta resuelta sigue
  // dentro de la carpeta, un `..` leería la base del local.
  const pedido = normalize(join(RUTA_PORTAL, decodeURIComponent(ruta)));
  const archivo =
    pedido.startsWith(RUTA_PORTAL) && existsSync(pedido) && statSync(pedido).isFile()
      ? pedido
      : indice;

  respuesta.writeHead(200, {
    "content-type": TIPOS[extname(archivo).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheDe(archivo, indice),
  });
  createReadStream(archivo).pipe(respuesta);
}

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
  secretoPortal = await derivarSecretoPortal(claveLocal);
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

  /*
   * Que la próxima vez encienda solo.
   *
   * Se hace DESPUÉS de que todo lo demás salió bien: registrar en el arranque
   * de Windows un Hub que no logra levantar sería garantizar que falle todas
   * las mañanas en vez de una sola vez.
   */
  arranqueAutomatico = await autoarranque.asegurarAlArrancar(INSTALACION_REAL);
  if (arranqueAutomatico.activo) {
    registrar("info", "El Hub arrancará solo al entrar a Windows.");
  } else if (arranqueAutomatico.motivo) {
    registrar("aviso", arranqueAutomatico.motivo);
  }

  await prepararLicencia();
  await prepararActualizaciones();
  await prepararCorreo();
  await conectarAlRelay();

  escuchar();
}

/**
 * El Hub avisa por WhatsApp cuando pasa algo que el comensal necesita saber.
 *
 * Se engancha a lo que ENTRA AL REGISTRO, no a quien lo hizo. Así una tablet
 * que confirma una reserva dispara el mensaje sin saber que el relay existe, y
 * mañana un canal nuevo no obliga a tocar cada pantalla.
 *
 * Solo dos cosas mandan mensaje, y las dos son utilidades que el comensal
 * espera. Todo lo demás vive en el portal, que es gratis.
 */
function avisarPorLoQuePaso(eventos: readonly EventoBase[]): void {
  for (const ev of eventos as unknown as Record<string, unknown>[]) {
    if (ev.tipo !== "reserva_confirmada") continue;

    /*
     * El correo y el teléfono están en la reserva original, no en la
     * confirmación: hay que reconstruirla del propio registro. Es el precio de
     * que un evento diga solo lo que cambió, y es el correcto — duplicar los
     * datos del comensal en cada evento haría que un cambio de correo dejara
     * copias viejas por todo el log.
     */
    const original = almacen.log
      .porTipo("reserva_creada", 0, 5000)
      .find((e) => (e as unknown as { reserva_id?: string }).reserva_id === ev.reserva_id) as
      | unknown as
      | { telefono?: string; correo?: string; nombre?: string; para_ts?: number }
      | undefined;

    if (!original) continue;

    const cuando = new Date(original.para_ts ?? Date.now()).toLocaleString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    /*
     * EL CORREO PRIMERO. No cuesta por mensaje, no exige trámite con Meta y
     * llega igual de bien para algo que no es urgente. WhatsApp queda para lo
     * que el correo no puede: alcanzar a alguien que está de pie en la puerta.
     */
    if (correo && original.correo) {
      void correo
        .mandar({
          tipo: "reserva_confirmada",
          para: original.correo,
          datos: { nombre: original.nombre, cuando, personas: undefined },
        })
        .then((r) => {
          if (!r.enviado) registrar("info", `Reserva confirmada sin correo: ${r.razon}`);
        });
      continue;
    }

    // Sin correo, se intenta por WhatsApp si el local lo tiene configurado.
    if (avisos && original.telefono) {
      const r = avisos.mandar(
        avisoReservaConfirmada(original.telefono, original.nombre ?? "", original.para_ts ?? Date.now()),
      );
      if (!r.enviado) registrar("info", `Reserva confirmada sin aviso: ${r.razon}`);
    }
  }
}

/**
 * Prepara el correo del restaurante.
 *
 * La llave de Resend se queda AQUÍ y no viaja a las terminales: una credencial
 * que puede mandar correo en nombre del restaurante no tiene por qué estar en
 * el teléfono de un mesero.
 */
/**
 * Carga la licencia y se la cuenta a las terminales.
 *
 * `MOTREST_LICENCIA_LLAVE` es la llave de verificación, y la pone el instalador.
 * Nunca va al repositorio: es el secreto con el que MOTRAE firma, y quien lo
 * tenga puede emitirse licencias gratis.
 */
async function prepararLicencia(): Promise<void> {
  licencia = new GestorLicencia(
    RUTA_LICENCIA,
    sucursalDelLocal(),
    process.env.MOTREST_LICENCIA_LLAVE ?? "",
    registrar,
  );
  await licencia.cargar();
  difundirLicencia();

  /*
   * Se revisa cada hora, y no es por si cambia el archivo: es porque el tiempo
   * pasa. Una licencia que vence a medianoche tiene que empezar a avisar sin
   * que nadie reinicie nada — un Hub de restaurante lleva semanas encendido.
   */
  setInterval(() => difundirLicencia(), 60 * 60 * 1000).unref?.();
}

/** Manda el veredicto a todas las terminales. Sin la credencial de soporte. */
function difundirLicencia(): void {
  if (!licencia) return;
  hub.publicarCatalogo("licencia_estado", licencia.paraTerminales(false));
}

/**
 * Busca versiones nuevas y avisa a las terminales.
 *
 * NO INSTALA NADA POR SU CUENTA. Aquí solo se descubre y se avisa; quien decide
 * cuándo es el restaurante, y quien comprueba que el momento sea seguro es el
 * dominio (`puedeInstalarse`). Un Hub que se actualiza solo a las nueve de la
 * noche del viernes es exactamente lo que no puede pasar.
 */
async function prepararActualizaciones(): Promise<void> {
  const repositorio = process.env.MOTREST_ACTUALIZACIONES_REPO;
  const llave = process.env.MOTREST_ACTUALIZACIONES_LLAVE;

  if (!repositorio || !llave) {
    // Un local sin canal de actualización es un caso normal —se actualiza a
    // mano— y no un error que haya que gritar en cada arranque.
    registrar("info", `MotRest ${VERSION}. Sin canal de actualizaciones configurado.`);
    return;
  }

  actualizador = new Actualizaciones(
    { repositorio, llaveDeFirma: llave, token: process.env.MOTREST_ACTUALIZACIONES_TOKEN },
    VERSION,
    registrar,
  );

  const revisar = async () => {
    try {
      const encontrada = await actualizador!.buscar();
      if (!encontrada || encontrada.version === versionDisponible?.version) return;

      versionDisponible = encontrada;
      hub.publicarCatalogo("actualizacion_estado", {
        disponible: encontrada,
        revisada_ts: Date.now(),
      });
    } catch (causa) {
      registrar("aviso", `No se pudo revisar si hay versión nueva: ${String(causa)}`);
    }
  };

  await revisar();
  setInterval(() => void revisar(), ACTUALIZAR_CADA_MS).unref?.();
  registrar("info", `MotRest ${VERSION}. Actualizaciones desde ${repositorio}.`);
}

async function prepararCorreo(): Promise<void> {
  const guardada = await almacen.estado.cargar<ConfiguracionCorreo & { llave?: string }>(
    CLAVE_CORREO,
  );
  if (guardada) {
    configCorreo = guardada;
    llaveResend = process.env.MOTREST_RESEND_KEY ?? guardada.llave ?? "";
  } else {
    llaveResend = process.env.MOTREST_RESEND_KEY ?? "";
  }

  correo = new Correo(
    () => configCorreo,
    () => llaveResend,
    registrar,
  );

  if (!llaveResend) {
    registrar("info", "Sin llave de Resend: el local no manda correos todavía.");
    return;
  }

  // Se reintenta lo pendiente cada pocos minutos: es lo que hace que una caída
  // de internet a media noche no pierda las confirmaciones del día.
  setInterval(() => void correo?.vaciarCola(), 5 * 60 * 1000).unref?.();
  registrar("info", `Correo listo. Remitente: ${configCorreo.remitente || "sin configurar"}`);
}

/**
 * Enlaza con el relay, si este restaurante tiene WhatsApp configurado.
 *
 * Un local SIN WhatsApp es un caso normal y no un error: opera con el portal,
 * que es gratis y no depende de nadie. Por eso no se avisa como problema —
 * simplemente no hay nada que enlazar.
 */
async function conectarAlRelay(): Promise<void> {
  const config = await almacen.estado.cargar<{
    url?: string;
    clave?: string;
    phone_number_id?: string;
    token?: string;
    nombre?: string;
  }>(CLAVE_WHATSAPP);

  const url = process.env.MOTREST_RELAY_URL ?? config?.url;
  const clave = process.env.MOTREST_RELAY_CLAVE ?? config?.clave;
  if (!url || !clave) {
    registrar("info", "Sin WhatsApp configurado: el local opera con el portal.");
    return;
  }

  enlaceRelay = new EnlaceRelayWs({
    url,
    clave,
    sucursal_id: sucursalDelLocal(),
    credenciales:
      config?.phone_number_id && config.token
        ? {
            phone_number_id: config.phone_number_id,
            token: config.token,
            nombre: config.nombre ?? "Restaurante",
          }
        : undefined,
    registrar,
    alConectar: () => avisos?.alReconectar(),
    alLlegarMensaje: (mensaje) => atenderMensajeDelComensal(mensaje),
  });

  avisos = new Avisos(
    enlaceRelay,
    () => almacen.log.porTipo("mensaje_recibido", 0, 2000) as unknown as EventoMensajeria[],
    registrar,
  );

  enlaceRelay.conectar();
}

/**
 * Llegó un mensaje de WhatsApp de un comensal.
 *
 * Se guarda SIEMPRE como evento, aunque no se conteste: es lo que abre la
 * ventana de 24 horas, y sin ese registro el Hub no sabría después si puede
 * responder con texto libre o necesita plantilla.
 *
 * Y si pide la baja, se corta el marketing de inmediato. Sin excepciones y sin
 * "un último mensaje": es lo que separa a un negocio de un spammer, y Meta lo
 * mide.
 */
function atenderMensajeDelComensal(mensaje: MensajeDelComensal): void {
  const sucursal = sucursalDelLocal();
  const base = {
    sucursal_id: sucursal,
    device_id: "relay",
    empleado_id: "comensal",
    ts: mensaje.ts,
    orden_local: 0,
    v: 1,
    stream_id: streamMensajeria(sucursal),
    contacto: mensaje.contacto,
    canal: "whatsapp" as const,
  };

  const eventos: EventoBase[] = [
    { ...base, id: uuidv7(), tipo: "mensaje_recibido", texto: mensaje.texto } as unknown as EventoBase,
  ];

  if (pideBaja(mensaje.texto)) {
    eventos.push({
      ...base,
      id: uuidv7(),
      tipo: "consentimiento_retirado",
      motivo: mensaje.texto.trim().slice(0, 40),
    } as unknown as EventoBase);
    registrar("info", `Baja de marketing solicitada por ${mensaje.contacto}`);
  }

  hub.inyectar(eventos);
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

/**
 * Respalda el registro del local, rota las copias viejas y lo reporta.
 *
 * Corre al arrancar y una vez al día: nadie en un restaurante se va a acordar
 * de respaldar un viernes a las once de la noche. Si falla, se avisa fuerte —un
 * respaldo que se cree que existe y no existe es peor que no tener ninguno—
 * pero NO se tumba el Hub: quedarse sin vender por no poder copiar un archivo
 * sería un remedio peor que la enfermedad.
 */
/** Cuánto pesa el registro del local en disco, con su WAL. */
function tamanoDelRegistro(): number {
  let total = 0;
  for (const sufijo of ["", "-wal", "-shm"]) {
    try {
      total += statSync(`${RUTA_DB}${sufijo}`).size;
    } catch {
      // El -wal y el -shm pueden no existir; no es un error.
    }
  }
  return total;
}

/**
 * Revisa cuánto ha crecido el registro y avisa con tiempo.
 *
 * El log es append-only por diseño y crece para siempre; cada terminal lo carga
 * entero al arrancar. No se compacta todavía —hacerlo mal es perder historia
 * fiscal— pero sí se mide, para que la decisión se tome con datos y no el día
 * en que la caja ya tarda en abrir.
 */
function revisarCrecimiento(): void {
  const c = evaluarCrecimiento(hub.seqActual, tamanoDelRegistro());
  if (c.nivel === "sano") return;
  registrar(
    c.nivel === "critico" ? "error" : "aviso",
    `Registro del local: ${c.eventos.toLocaleString("es-MX")} eventos · ${enMegas(c.bytes)}. ${c.recomendacion}`,
  );
}

function respaldar(): void {
  const r = crearRespaldo(RUTA_DB, RUTA_RESPALDOS);
  if (!r.ok) {
    registrar("error", `No se pudo respaldar el registro del local: ${r.error}`);
    registrar("error", `Revisa que exista y se pueda escribir en ${RUTA_RESPALDOS}.`);
    return;
  }

  const borrados = rotarRespaldos(RUTA_RESPALDOS);
  const kb = Math.round((r.bytes ?? 0) / 1024);
  registrar(
    "info",
    `Respaldo verificado: ${r.ruta} (${kb} KB)` +
      (borrados > 0 ? ` · ${borrados} copia(s) antigua(s) borrada(s)` : ""),
  );
}

function iniciarRespaldos(): void {
  respaldar();
  // `unref` para que este temporizador no impida que el proceso termine.
  setInterval(respaldar, INTERVALO_RESPALDO_MS).unref();
}

function escuchar(): void {
  servidor.on("error", (causa: NodeJS.ErrnoException) => alFallarEscucha(causa, PUERTO));
  servidorLocal.on("error", (causa: NodeJS.ErrnoException) =>
    alFallarEscucha(causa, PUERTO_LOCAL),
  );

  servidor.listen(PUERTO, () => {
    registrar("info", `Hub escuchando en el puerto ${PUERTO} (HTTPS + WSS)`);
    registrar("info", `Base de datos: ${RUTA_DB} · secuencia actual: ${hub.seqActual}`);
    iniciarRespaldos();
    revisarCrecimiento();
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
      /*
       * Cartel, no una línea suelta.
       *
       * El modo abierto es una salida para el primer arranque y las pruebas;
       * dejarlo puesto en un local real deja que cualquier equipo de la wifi
       * escriba en el registro de ventas sin que nadie lo autorice. Un aviso de
       * una línea se pierde en el arranque, así que va en marco.
       */
      const linea = "═".repeat(64);
      console.log(`\n${linea}`);
      registrar("aviso", "MODO ABIERTO ACTIVO (MOTREST_HUB_ABIERTO=1)");
      registrar("aviso", "Cualquier equipo con la clave sincroniza SIN autorización.");
      registrar("aviso", "En un local real, QUITA esta variable de entorno.");
      console.log(`${linea}\n`);
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
