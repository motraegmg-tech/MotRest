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
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  Centavos,
  EleccionActualizacion,
  EstadoActualizacion,
  EventoBase,
  EventoMensajeria,
  EventoOpinion,
  MemoriaDeCanal,
  PulsoCliente,
  TerminalReportada,
} from "@motrest/dominio";
import {
  CERO,
  aplazar,
  configuracionVacia,
  debeInstalar,
  enHorarioDeServicio,
  estadoInicial,
  hayTurnoAbierto,
  marcarInstalada,
  pideBaja,
  puedeInstalarse,
  registrarDisponible,
  streamIdentidad,
  streamMensajeria,
  uuidv7,
} from "@motrest/dominio";
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
import {
  LLAVE_PUBLICA_ACTUALIZACIONES,
  LLAVE_PUBLICA_LICENCIAS,
  REPOSITORIO_ACTUALIZACIONES,
} from "./llaves-motrae.js";
import { registrarPedido, type PlatilloDeKiosco } from "./kiosco.js";
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
import {
  enviarAUsb,
  impresorasDelSistema,
  instalarImpresoraEnPuerto,
} from "./impresion/transporte-usb.js";
import { buscarImpresoras } from "./impresion/buscador.js";
import { enMegas, evaluarCrecimiento } from "./crecimiento.js";
import {
  INTERVALO_RESPALDO_MS,
  crearRespaldo,
  listarRespaldos,
  rotarRespaldos,
} from "./respaldo.js";
import {
  archivoDentroDe,
  autoridadDelHub,
  clienteHttp,
  encabezadosDeSeguridad,
  esOrigenDelHub,
  LIMITE_GLOBAL_HTTP_POR_MINUTO,
  LimitadorDeRitmo,
  origenDelHub,
  politicaDeRitmoHttp,
  type AutoridadHub,
} from "./seguridad-http.js";
import { manejarSubidaFoto, rutaFotoSegura } from "./fotos-http.js";
import type { DatabaseSync as TipoDatabaseSync } from "node:sqlite";

/** La versión se incrusta al crear el ejecutable SEA del Hub. */
declare const __MOTREST_VERSION__: string;

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
/** Estado persistente que impide aceptar un release firmado pero más viejo. */
const CLAVE_MEMORIA_ACTUALIZACIONES = "actualizaciones_memoria";
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
 * Qué versión hay pendiente y qué contestó el restaurante.
 *
 * Vive AQUÍ y no en la terminal. Antes cada tablet guardaba la decisión en su
 * propio almacén, así que «instalar a las 23:00» solo lo sabía la pantalla en la
 * que alguien lo pulsó —y quien instala es el Hub—. La consecuencia era que la
 * respuesta del restaurante no llegaba a ninguna parte.
 */
const CLAVE_ESTADO_ACTUALIZACION = "actualizacion_estado";
let estadoActualizacion: EstadoActualizacion = estadoInicial();
/** Evita que dos vueltas del reloj lancen dos veces el mismo instalador. */
let instalandoActualizacion = false;

/**
 * Cuántos pedidos lleva el kiosco. Alimenta el número que se grita para recoger.
 *
 * Arranca en cero en cada reinicio del Hub, y da igual: `folioDeKiosco` vuelve a
 * empezar cada 999 de todas formas, y dos pedidos con el mismo número separados
 * por un reinicio no se cruzan en el mostrador.
 */
let pedidosDeKioscoHoy = 0;

/** Dónde se guarda la identidad del local, junto a la base y no al ejecutable. */
const RUTA_SUCURSAL = join(dirname(RUTA_DB), "sucursal.txt");

/**
 * Marca de que la identidad del local **todavía no la confirmó MOTRAE**.
 *
 * Un equipo recién instalado se pone un identificador para poder arrancar, pero
 * ese no es el restaurante: es un apaño. Mientras exista este archivo, la
 * licencia que se active puede sustituirlo por el de verdad — que es lo que
 * convierte «pegar la licencia» en «dar de alta el restaurante».
 *
 * Su AUSENCIA significa identidad firme, y por eso es lo correcto para los
 * locales instalados antes de que esto existiera: llevan tiempo operando con su
 * identificador y toda su historia está sellada con él.
 */
const RUTA_SUCURSAL_PROVISIONAL = join(dirname(RUTA_DB), "sucursal-provisional");

/** ¿La identidad de este equipo es todavía un apaño del primer arranque? */
function identidadProvisional(): boolean {
  return existsSync(RUTA_SUCURSAL_PROVISIONAL);
}

function marcarProvisional(esProvisional: boolean): void {
  try {
    if (esProvisional) {
      mkdirSync(dirname(RUTA_SUCURSAL_PROVISIONAL), { recursive: true });
      writeFileSync(RUTA_SUCURSAL_PROVISIONAL, "", { encoding: "utf8", mode: 0o600 });
    } else if (existsSync(RUTA_SUCURSAL_PROVISIONAL)) {
      rmSync(RUTA_SUCURSAL_PROVISIONAL);
    }
  } catch (causa) {
    registrar("aviso", `No se pudo anotar el estado de la identidad: ${String(causa)}`);
  }
}

/**
 * A qué sucursal pertenece este Hub. **Se fija una vez y no vuelve a cambiar.**
 *
 * ## Por qué esto necesitaba arreglo
 *
 * Antes se APRENDÍA del registro mirando los últimos 5 eventos, con caída al
 * literal `"suc-local"`. Tres consecuencias, todas malas y ninguna visible:
 *
 *   1. **Dos Hubs recién instalados colisionaban entre sí**: ambos se anunciaban
 *      al relay como `suc-local` y el segundo desplazaba al primero.
 *   2. El stream de identidad (donde el Hub va a leer quién puede hacer qué)
 *      apuntaría al sitio equivocado mientras el log estuviera vacío.
 *   3. La atribución de reservas del portal cambiaba según lo último que hubiera
 *      pasado en el local.
 *
 * Ahora se resuelve UNA vez —del archivo, del entorno, o del propio registro— y
 * se persiste. Un identificador que cambia solo no es un identificador.
 */
let sucursalFijada: string | null = null;

function sucursalDelLocal(): string {
  if (sucursalFijada) return sucursalFijada;

  // 1. Lo ya decidido para este equipo. Manda sobre todo lo demás.
  if (existsSync(RUTA_SUCURSAL)) {
    const guardada = readFileSync(RUTA_SUCURSAL, "utf8").trim();
    if (guardada) {
      sucursalFijada = guardada;
      return guardada;
    }
  }

  // 2. Lo que dijo quien instaló.
  // 3. Lo que diga el registro, si el local ya operó.
  const ultimos = almacen.log.desde(Math.max(0, hub.seqActual - 5), 5);
  const aprendida = process.env.MOTREST_SUCURSAL_ID ?? ultimos.at(-1)?.sucursal_id;

  /*
   * SIN NINGUNA DE LAS TRES NO SE INVENTA UNA. Antes se devolvía `"suc-local"`,
   * y ese literal es el que hacía colisionar dos instalaciones nuevas. Se
   * genera uno único y se guarda: es feo de leer, pero es de este equipo y de
   * ningún otro. En cuanto llegue el alta real, se sustituye.
   */
  const identidad = aprendida ?? `suc-${randomUUID().slice(0, 8)}`;

  try {
    mkdirSync(dirname(RUTA_SUCURSAL), { recursive: true });
    writeFileSync(RUTA_SUCURSAL, identidad, { encoding: "utf8", mode: 0o600 });
  } catch (causa) {
    // Si no se puede escribir se sigue operando con la identidad en memoria:
    // un disco lleno no puede impedir que el restaurante abra.
    registrar("aviso", `No se pudo fijar la identidad del local: ${String(causa)}`);
  }

  sucursalFijada = identidad;
  if (!aprendida) {
    // Provisional: es un apaño para poder arrancar, no el restaurante. La
    // licencia que se active lo sustituye por el de verdad.
    marcarProvisional(true);
    registrar("aviso", `Local sin identificador asignado. Se generó ${identidad} de momento.`);
    registrar("aviso", "Al activar la licencia quedará con el identificador que emita MOTRAE.");
  }
  return identidad;
}

/**
 * Fija la identidad del local con la que trae su licencia. **Es el alta.**
 *
 * Gonzalo da de alta el restaurante en MotRest Central, Central emite el archivo
 * firmado, y ese archivo se pega en la caja. A partir de ahí el equipo sabe qué
 * restaurante es, sin que nadie teclee un identificador ni lo lleve el código.
 *
 * Se niega en dos casos, y los dos son el mismo principio —no pisar una
 * identidad que ya significa algo—:
 *
 *   - El local ya tiene identidad firme: una licencia ajena no puede
 *     apropiárselo. Sin esto, la licencia de un restaurante que paga valdría
 *     para todos los demás.
 *   - Quien instaló la impuso con `MOTREST_SUCURSAL_ID`.
 */
function fijarSucursalPorLicencia(sucursalId: string): boolean {
  if (process.env.MOTREST_SUCURSAL_ID) return false;
  if (!identidadProvisional()) return sucursalFijada === sucursalId;

  if (sucursalFijada !== sucursalId) {
    escribirSucursal(sucursalId);
    /*
     * Lo que ya se hubiera registrado quedó sellado con el identificador
     * anterior. En el camino previsto no hay nada —el local no opera hasta
     * estar licenciado— pero si lo hay, se dice: un dato que cambia de dueño
     * en silencio es peor que uno que se pierde a la vista.
     */
    if (hub.seqActual > 0) {
      registrar(
        "aviso",
        `${hub.seqActual} evento(s) quedaron registrados como ${sucursalFijada}. Revísalos antes de operar.`,
      );
    }
    sucursalFijada = sucursalId;
    hub.cargarIdentidad(sucursalId, []);
  }

  marcarProvisional(false);
  return true;
}

/** Deja la identidad escrita junto a la base, para que sobreviva al reinicio. */
function escribirSucursal(sucursalId: string): void {
  try {
    mkdirSync(dirname(RUTA_SUCURSAL), { recursive: true });
    writeFileSync(RUTA_SUCURSAL, sucursalId, { encoding: "utf8", mode: 0o600 });
  } catch (causa) {
    // Sin poder escribirlo se opera igual, en memoria: el restaurante tiene
    // que poder abrir hoy. Se volverá a resolver en el siguiente arranque.
    registrar("aviso", `No se pudo fijar la identidad del local: ${String(causa)}`);
  }
}

/**
 * Toma como identidad del local la que trae su primera terminal.
 *
 * El Hub solo pregunta esto con el registro EN BLANCO. Hasta ese momento el
 * identificador que tiene es uno inventado en el primer arranque, y rechazar
 * con él a las terminales dejaba el local incapaz de abrir: sin terminales no
 * hay eventos, y sin eventos el identificador inventado no se corrige nunca.
 *
 * Se niega en un solo caso: que quien instaló haya dicho explícitamente cuál es
 * la sucursal. Esa decisión es de MOTRAE y no la pisa una terminal.
 */
function adoptarSucursal(sucursalId: string): boolean {
  if (process.env.MOTREST_SUCURSAL_ID) return false;
  if (sucursalFijada === sucursalId) return true;

  escribirSucursal(sucursalId);
  sucursalFijada = sucursalId;
  /*
   * SIGUE SIENDO PROVISIONAL. Lo dijo una terminal, no MOTRAE: sirve para que
   * el local pueda abrir hoy, y la licencia lo sustituirá por el identificador
   * de verdad cuando se active.
   */
  marcarProvisional(true);
  registrar("info", `Identidad del local fijada de momento: ${sucursalId}.`);
  return true;
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
const VERSION =
  typeof __MOTREST_VERSION__ === "string"
    ? __MOTREST_VERSION__
    : (createRequire(import.meta.url)("../package.json").version as string);

mkdirSync(dirname(RUTA_DB), { recursive: true });
const almacen = almacenSqlite(RUTA_DB);

/**
 * ¿Se enseña la clave del local en la salida del arranque?
 *
 * Apagado por omisión. Esa clave cifra y autoriza TODO el canal de la LAN, y la
 * salida del Hub acaba en sitios que sobreviven al arranque: un archivo de
 * registro, la captura de un panel de soporte, el mensaje de un ticket. El
 * camino normal es el QR de Administración → Hub, que se muestra bajo demanda y
 * no se queda escrito en ninguna parte.
 */
const MOSTRAR_CLAVE = process.env.MOTREST_MOSTRAR_CLAVE === "1";

/** Oculta el `k=` de un enlace de emparejamiento, salvo que se pida verlo. */
function paraLaConsola(url: string): string {
  return MOSTRAR_CLAVE ? url : url.replace(/([?&]k=)[^&]+/, "$1————————");
}

/** Dónde caen los renglones del Hub. Junto a la base, no junto al ejecutable. */
const RUTA_REGISTRO = join(dirname(RUTA_DB), "registro");
/** Cuánto puede crecer un archivo antes de empezar otro. */
const MAX_REGISTRO_BYTES = 5 * 1024 * 1024;
/** Cuántos días se conservan. Pasado esto, un incidente ya se investigó o no. */
const DIAS_REGISTRO = 30;

/**
 * El registro del Hub.
 *
 * ## Por qué necesitaba destino
 *
 * Antes esto era un único `console.log`. En la aplicación instalada el Hub corre
 * como proceso hijo y su salida **se descartaba**, así que todo lo que registra
 * desaparecía: «dispositivo sin aprobar intentó sincronizar», «terminal
 * autorizada por», «conexión cerrada: mensajes que no se pueden descifrar».
 *
 * Sin destino no hay forensia. Si mañana aparece una terminal escribiendo en el
 * registro de ventas, no había absolutamente nada que revisar.
 *
 * ## Tres decisiones
 *
 * - **`0o600` y junto a los datos.** Aquí acaban nombres de terminales, rutas y
 *   detalles de fallos: no es material público. (En Windows la protección real
 *   son las ACL de `%LOCALAPPDATA%`, no el modo — ver `docs/SEGURIDAD.md`.)
 * - **Los errores a `stderr`.** Antes todo iba a `stdout`, así que un servicio
 *   que solo capture la salida de error no veía ni un fallo.
 * - **Nunca tumba al Hub.** Si el disco está lleno, se pierde el renglón y el
 *   restaurante sigue vendiendo. Un registro que puede parar la caja es peor
 *   que no tener registro.
 */
function registrar(nivel: "info" | "aviso" | "error", mensaje: string): void {
  const ahora = new Date();
  const marca = ahora.toISOString();
  const prefijo = nivel === "error" ? "ERROR" : nivel === "aviso" ? "AVISO" : "INFO ";
  const linea = `${marca} ${prefijo} ${mensaje}`;

  if (nivel === "error") console.error(linea);
  else console.log(linea);

  try {
    mkdirSync(RUTA_REGISTRO, { recursive: true });
    const archivo = join(RUTA_REGISTRO, `hub-${marca.slice(0, 10)}.log`);

    // Rotación por tamaño DENTRO del día: un local con mucho movimiento no debe
    // dejar un archivo de cientos de megas que nadie puede abrir.
    let destino = archivo;
    if (existsSync(archivo) && statSync(archivo).size > MAX_REGISTRO_BYTES) {
      destino = join(RUTA_REGISTRO, `hub-${marca.slice(0, 10)}-${ahora.getTime()}.log`);
    }

    appendFileSync(destino, `${linea}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Disco lleno, permisos, carpeta borrada. Se pierde el renglón, no la venta.
  }
}

/** Borra los registros viejos. Se llama al arrancar, no en cada renglón. */
function limpiarRegistrosViejos(): void {
  try {
    if (!existsSync(RUTA_REGISTRO)) return;
    const limite = Date.now() - DIAS_REGISTRO * 86_400_000;
    for (const nombre of readdirSync(RUTA_REGISTRO)) {
      const ruta = join(RUTA_REGISTRO, nombre);
      if (statSync(ruta).mtimeMs < limite) rmSync(ruta, { force: true });
    }
  } catch {
    // Que no se pueda limpiar no es motivo para no arrancar.
  }
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
/** Estado publicado solo por el Hub; nunca llega desde una terminal. */
const CLAVE_CATALOGOS_INTERNOS = "catalogos_hub";
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
  // El enlace lleva también de QUÉ local es. Sin eso, la tablet sellaría sus
  // eventos con el identificador que trajera de fábrica y el Hub se los
  // rechazaría por ser de otra sucursal.
  const enlace = (host: string) =>
    `https://${host}:${PUERTO}/?hub=wss://${host}:${PUERTO}/sync&k=${claveLocal}` +
    `&s=${encodeURIComponent(sucursalDelLocal())}`;

  /*
   * LA IP VA PRIMERO, y el nombre después.
   *
   * Estaba al revés, con buen motivo: `motrest.local` sobrevive a que el router
   * cambie la IP del equipo, que rompería el emparejamiento de todas las
   * terminales a la vez. Pero `.local` es mDNS, y **el navegador de Android no
   * lo resuelve**: la tablet escaneaba el QR y respondía «no se puede acceder a
   * este sitio», que es donde se quedaba el montaje de un local.
   *
   * Un enlace que no abre no protege de nada. La IP conecta hoy; el nombre
   * queda de alternativa para cuando la IP cambie, que es cuando sirve.
   */
  return [
    ...direccionesLan().map((ip) => ({ etiqueta: ip, url: enlace(ip) })),
    { etiqueta: `${NOMBRE_RED}.local`, url: enlace(`${NOMBRE_RED}.local`) },
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
  adoptarSucursal,
  registrar,
  alIngerir: (eventos) => avisarPorLoQuePaso(eventos),
  fiscal: { sellador, cola: colaTimbrado, facturador, cancelador, nombrePac: pac?.nombre },
  guardarCatalogo: (catalogo, origen) => {
    // Se guardan por origen: una terminal jamás puede dejar persistido un
    // estado que solo le corresponde anunciar al proceso del Hub.
    const claveDeEstado = origen === "hub" ? CLAVE_CATALOGOS_INTERNOS : CLAVE_CATALOGOS;
    void almacen.estado.cargar<Catalogo[]>(claveDeEstado).then((previos) => {
      const resto = (previos ?? []).filter((c) => c.clave !== catalogo.clave);
      void almacen.estado.guardar(claveDeEstado, [...resto, catalogo]);
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

/** Una cuota por cliente y superficie; vive solo mientras vive el Hub. */
const limiteHttp = new LimitadorDeRitmo();

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

/**
 * Decodifica un trozo de ruta sin poder tumbar el proceso.
 *
 * `decodeURIComponent("%")` lanza `URIError`. Como el manejador de peticiones es
 * SÍNCRONO, esa excepción no la captura Node: sube a `uncaughtException` y mata
 * el Hub — la caja, las tablets y la cocina de golpe, con una petición de tres
 * caracteres y sin necesidad de la clave del local.
 */
function decodificar(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return null;
  }
}

/** HTTPS en la LAN; HTTP solamente en el puerto ligado al loopback. */
function esConexionSegura(peticion: IncomingMessage): boolean {
  return (peticion.socket as { encrypted?: boolean }).encrypted === true;
}

/** Añade las defensas que toda respuesta HTTP del Hub debe llevar. */
function aplicarEncabezadosDeSeguridad(
  respuesta: ServerResponse,
  seguro: boolean,
  autoridad: AutoridadHub,
  nonce?: string,
  conexionesAdicionales?: readonly string[],
): void {
  for (const [nombre, valor] of Object.entries(
    encabezadosDeSeguridad(seguro, autoridad, nonce, conexionesAdicionales),
  )) {
    respuesta.setHeader(nombre, valor);
  }
}

/**
 * El portal se sirve desde este mismo Hub. Si un navegador declara Origin, no
 * hay motivo para aceptar otro: no se refleja ni se abre con `*`.
 */
function permitirOrigenDelPortal(
  peticion: IncomingMessage,
  respuesta: ServerResponse,
  seguro: boolean,
  autoridad: AutoridadHub,
): boolean {
  if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) return false;

  if (peticion.headers.origin) {
    respuesta.setHeader("access-control-allow-origin", origenDelHub(seguro, autoridad));
    respuesta.setHeader("access-control-allow-headers", "content-type");
    respuesta.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    respuesta.setHeader("vary", "origin");
  }
  return true;
}

/** Toda puerta HTTP tiene cuota global y cuota específica por cliente. */
function permitirRitmoHttp(
  peticion: IncomingMessage,
  url: URL,
  respuesta: ServerResponse,
  json: (codigo: number, cuerpo: unknown) => void,
): boolean {
  const cliente = clienteHttp(peticion.socket.remoteAddress);
  const global = limiteHttp.permitir(`global:${cliente}`, LIMITE_GLOBAL_HTTP_POR_MINUTO);
  const politica = politicaDeRitmoHttp(url.pathname, peticion.method);
  const especifica = global.permitido
    ? limiteHttp.permitir(`${politica.clave}:${cliente}`, politica.limite)
    : global;

  if (especifica.permitido) return true;

  respuesta.setHeader("retry-after", String(especifica.reintentarEnSegundos));
  json(429, { error: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo." });
  return false;
}

/**
 * El manejador de peticiones, con la red de seguridad puesta.
 *
 * TODO EL TRABAJO ESTÁ EN `atenderInterno`. Esta envoltura existe solo para que
 * ninguna excepción del camino de una petición pueda apagar el restaurante:
 * antes bastaba un `Host` malformado o un `%` suelto.
 *
 * Se responde 400 y se anota. Lo que NO se hace es devolver el detalle del
 * error: describiría por dentro el sistema a quien está probando.
 */
function atender(peticion: IncomingMessage, respuesta: ServerResponse): void {
  try {
    atenderInterno(peticion, respuesta);
  } catch (causa) {
    registrar("aviso", `Petición inválida (${peticion.method} ${peticion.url}): ${String(causa)}`);
    try {
      if (!respuesta.headersSent) {
        respuesta.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      }
      respuesta.end(JSON.stringify({ error: "Petición inválida" }));
    } catch {
      // El socket ya se cerró. Da igual: lo que importa es no morir.
    }
  }
}

function atenderInterno(peticion: IncomingMessage, respuesta: ServerResponse): void {
  /*
   * El `Host` lo pone el cliente y puede ser cualquier cosa. `new URL` con un
   * host inválido lanza `TypeError`, que era el tercer vector para tumbar el
   * Hub. Se normaliza a algo inofensivo: la ruta es lo único que se usa.
   */
  const url = new URL(peticion.url ?? "/", "https://motrest.local");
  // Quien pide desde el propio equipo ya tiene acceso al archivo de la clave,
  // así que entregársela en la página no le da nada que no tuviera.
  const esLocal = esPeticionLocal(peticion);
  const seguro = esConexionSegura(peticion);

  const json = (codigo: number, cuerpo: unknown): void => {
    respuesta.writeHead(codigo, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    respuesta.end(JSON.stringify(cuerpo, null, 2));
  };

  /*
   * El Host también lo manda el cliente. Solo se acepta el nombre mDNS o una
   * IP que este Hub anunció; localhost únicamente desde el loopback. Así un
   * DNS rebinding no puede pedir el HTML de la caja bajo el origen de un sitio
   * ajeno y leer su clave de sincronización.
   */
  const autoridad = autoridadDelHub(peticion.headers.host, {
    puerto: peticion.socket.localPort || (seguro ? PUERTO : PUERTO_LOCAL),
    seguro,
    nombreRed: NOMBRE_RED,
    direccionesLan: lan,
    esLocal,
  });
  if (!autoridad) {
    json(400, { error: "Host no autorizado" });
    return;
  }

  aplicarEncabezadosDeSeguridad(respuesta, seguro, autoridad);
  if (!permitirRitmoHttp(peticion, url, respuesta, json)) return;

  /*
   * Impresión ESC/POS: la caja manda los bytes ya armados y el Hub los pone en
   * el cable de la impresora. Es lo que el navegador no puede hacer.
   *
   * SOLO desde este mismo equipo. La página de la caja la sirve el propio Hub,
   * por lo que no necesita CORS; además, un Origin declarado debe coincidir
   * exactamente. Una terminal de la red no puede abrir un socket hacia una
   * impresora interna que le pida un desconocido de la wifi.
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
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
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
    if (!permitirOrigenDelPortal(peticion, respuesta, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }
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

  /*
   * Fotos de productos.
   * La subida va con CORS porque ocurre desde la terminal (que corre bajo un
   * file://, o desde otra IP en tablet). Se pide permiso `cat.producto.editar`.
   * El servicio de fotos usa GET público pero está protegido contra path traversal.
   */
  if (url.pathname.startsWith("/foto/")) {
    if (peticion.method !== "GET") {
      json(405, { error: "Usa GET" });
      return;
    }
    const rutaSegura = rutaFotoSegura(dirname(RUTA_DB), url.pathname);
    if (!rutaSegura) {
      json(400, { error: "Nombre de foto inválido" });
      return;
    }
    if (!existsSync(rutaSegura)) {
      json(404, { error: "Foto no encontrada" });
      return;
    }
    const tipo = TIPOS[extname(rutaSegura).toLowerCase()] ?? "application/octet-stream";
    respuesta.writeHead(200, {
      "content-type": tipo,
      "cache-control": "public, max-age=31536000, immutable",
    });
    createReadStream(rutaSegura).pipe(respuesta);
    return;
  }

  if (url.pathname === "/api/fotos/producto") {
    if (peticion.method === "OPTIONS") {
      respuesta.setHeader("access-control-allow-origin", "*");
      respuesta.setHeader("access-control-allow-methods", "POST, OPTIONS");
      respuesta.setHeader("access-control-allow-headers", "content-type");
      respuesta.writeHead(204);
      respuesta.end();
      return;
    }

    if (peticion.method !== "POST") {
      json(405, { error: "Usa POST" });
      return;
    }

    respuesta.setHeader("access-control-allow-origin", "*");

    void (async () => {
      try {
        const cuerpo = await leerCuerpo(peticion);
        const contentType = peticion.headers["content-type"] || "";
        const nombre = manejarSubidaFoto(dirname(RUTA_DB), contentType, cuerpo);
        json(200, { ok: true, nombre });
      } catch (error) {
        json(400, { error: String(error) });
      }
    })();
    return;
  }

  if (url.pathname === "/imprimir") {
    if (!esLocal) {
      json(403, { error: "La impresión solo se acepta desde el propio equipo" });
      return;
    }
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
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
   * Las impresoras que Windows tiene dadas de alta, para que la configuración
   * las ofrezca en una lista. Se protege igual que `/imprimir`: es la caja
   * preguntando por su propio equipo, y el inventario de impresoras del local
   * no es algo que deba poder leer cualquiera desde la wifi.
   */
  if (url.pathname === "/impresoras-sistema") {
    if (!esLocal) {
      json(403, { error: "Solo desde la caja" });
      return;
    }
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }
    if (peticion.method !== "GET") {
      json(405, { error: "Usa GET" });
      return;
    }
    void impresorasDelSistema().then((impresoras) => json(200, { impresoras }));
    return;
  }

  /*
   * Buscar impresoras: las de Windows y, si se pide, las que contestan en la red
   * del local.
   *
   * Se protege igual que `/imprimir`: solo desde la caja y solo desde el origen
   * del propio Hub. El barrido no admite que le digan qué red mirar —sale de las
   * interfaces de este equipo y solo cubre rangos privados—, así que nadie puede
   * usar al Hub para escanear una red ajena. Ver `impresion/buscador.ts`.
   */
  if (url.pathname === "/impresoras-detectadas") {
    if (!esLocal) {
      json(403, { error: "Solo desde la caja" });
      return;
    }
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }
    if (peticion.method !== "GET") {
      json(405, { error: "Usa GET" });
      return;
    }
    // Sin `red=1` solo se consulta el spooler: es instantáneo y es lo que se
    // pide al abrir la pantalla. El barrido tarda segundos y va a botón.
    const conRed = url.searchParams.get("red") === "1";
    void buscarImpresoras({ conRed }).then((resultado) => json(200, resultado));
    return;
  }

  /*
   * Dar de alta en Windows una impresora que está enchufada y sin cola.
   *
   * Solo desde la caja, igual que la búsqueda: crea una cola de impresión en el
   * equipo, y eso no lo pide una tablet del salón por la wifi.
   */
  if (url.pathname === "/instalar-impresora") {
    if (!esLocal) {
      json(403, { error: "Solo desde la caja" });
      return;
    }
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }
    if (peticion.method !== "POST") {
      json(405, { error: "Usa POST" });
      return;
    }
    void leerCuerpo(peticion)
      .then(async (crudo) => {
        const datos = JSON.parse(crudo.toString("utf8") || "{}") as {
          nombre?: unknown;
          puerto?: unknown;
        };
        const nombre = typeof datos.nombre === "string" ? datos.nombre.trim() : "";
        const puerto = typeof datos.puerto === "string" ? datos.puerto.trim() : "";
        // El puerto se acota a lo que Windows nombra así: no se le pasa a
        // PowerShell cualquier cosa que llegue por el cuerpo de la petición.
        if (!nombre || !/^USB\d{3,}$/i.test(puerto)) {
          json(400, { error: "Hace falta el nombre y un puerto USB válido" });
          return;
        }
        const r = await instalarImpresoraEnPuerto(nombre, puerto);
        if (!r.ok) {
          registrar("aviso", `No se pudo dar de alta ${nombre} en ${puerto}: ${r.error}`);
          json(500, {
            error: r.error,
            // El caso más común, dicho para que se pueda resolver sin llamar.
            pista: "Windows pide permisos de administrador para dar de alta una impresora.",
          });
          return;
        }
        registrar("info", `Impresora ${nombre} dada de alta en ${puerto}`);
        json(200, { ok: true });
      })
      .catch(() => json(400, { error: "Cuerpo ilegible" }));
    return;
  }

  /*
   * El kiosco de autoservicio (F4).
   *
   * Va sin autenticación y es correcto: quien está delante del kiosco está
   * físicamente dentro del restaurante, igual que quien se acerca al mostrador.
   * Lo que lo protege no es una credencial sino que aquí solo se puede pedir de
   * la carta, y que los precios los pone el Hub.
   */
  if (url.pathname === "/kiosco" || url.pathname === "/kiosco/") {
    // La interfaz del kiosco vive en el paquete ligero del portal. Antes esta
    // ruta caía en el fallback del POS, que no es una interfaz de kiosco y
    // convertía una ruta pública en una puerta accidental hacia la caja.
    if (peticion.method === "GET" || peticion.method === "HEAD") {
      respuesta.writeHead(308, { location: "/portal/#/kiosco", "cache-control": "no-store" });
      respuesta.end();
    } else {
      json(405, { error: "Usa GET" });
    }
    return;
  }

  if (url.pathname.startsWith("/kiosco/")) {
    void atenderKiosco(peticion, url, json);
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
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }

    if (peticion.method === "GET") {
      const v = licencia?.veredicto();
      json(200, {
        ...(licencia?.paraTerminales(true) ?? { licencia: null, verificada: false }),
        situacion: v?.situacion ?? null,
        sucursal_id: sucursalDelLocal(),
        /*
         * true = este equipo todavía no está asignado a ningún restaurante.
         * La pantalla lo usa para pedir el alta en vez de hablar de un servicio
         * suspendido: no es lo mismo un local que dejó de pagar que uno que se
         * acaba de instalar y aún no tiene dueño.
         */
        sin_asignar: identidadProvisional(),
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

  /*
   * LA RESPUESTA DEL RESTAURANTE AL AVISO DE ACTUALIZACIÓN.
   *
   * Este es el cable que faltaba: el POS recogía la decisión y la guardaba en el
   * almacén de su propia terminal, donde no la veía nadie. Quien instala es el
   * Hub, así que la decisión tiene que llegar hasta aquí.
   *
   * Solo desde la propia caja y con el origen del Hub, igual que `/licencia`:
   * reiniciar el sistema del restaurante no es algo que deba poder pedir
   * cualquiera que esté en la wifi del local.
   */
  if (url.pathname === "/actualizacion") {
    if (!esLocal) {
      json(403, { error: "Solo desde la caja" });
      return;
    }
    if (!esOrigenDelHub(peticion.headers.origin, seguro, autoridad)) {
      json(403, { error: "Origen no autorizado" });
      return;
    }

    if (peticion.method === "GET") {
      json(200, estadoActualizacion);
      return;
    }

    if (peticion.method !== "POST") {
      json(405, { error: "Usa GET o POST" });
      return;
    }

    void (async () => {
      try {
        const cuerpo = JSON.parse((await leerCuerpo(peticion, 4 * 1024)).toString("utf8")) as {
          cuando?: unknown;
          hora?: unknown;
        };

        const eleccion = eleccionValida(cuerpo);
        if (!eleccion) {
          json(400, { error: "Elección no reconocida" });
          return;
        }
        if (!estadoActualizacion.disponible) {
          json(409, { error: "No hay ninguna actualización pendiente" });
          return;
        }

        await decidirActualizacion(eleccion);
        json(200, estadoActualizacion);
      } catch (causa) {
        json(400, { error: `No se pudo registrar la decisión: ${String(causa)}` });
      }
    })();
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

  servirPos(url.pathname, respuesta, json, esLocal, seguro, autoridad);
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

/**
 * La carta y los pedidos del kiosco.
 *
 * La carta sale del mismo catálogo que usa el POS, RECORTADA: nombre, precio y
 * categoría. Ni costos, ni márgenes, ni recetas. Si alguien desmonta la tablet y
 * mira el tráfico, se lleva la carta que ya está en la pared.
 */
async function atenderKiosco(
  peticion: IncomingMessage,
  url: URL,
  json: (codigo: number, cuerpo: unknown) => void,
): Promise<void> {
  const cartaDelLocal = (): PlatilloDeKiosco[] => {
    const guardado = hub.catalogoDe("menu_local") as
      | { productos?: { id: string; nombre: string; precio: number; categoria_id?: string; disponible?: boolean }[]; categorias?: { id: string; nombre: string }[] }
      | undefined;
    if (!guardado?.productos) return [];

    const nombreCategoria = new Map((guardado.categorias ?? []).map((c) => [c.id, c.nombre]));
    return guardado.productos
      // Lo que está agotado no se ofrece: es peor cobrarlo y no tenerlo.
      .filter((p) => p.disponible !== false)
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        categoria: nombreCategoria.get(p.categoria_id ?? "") ?? "Otros",
      }));
  };

  if (peticion.method === "GET" && url.pathname === "/kiosco/carta") {
    json(200, cartaDelLocal());
    return;
  }

  if (peticion.method === "POST" && url.pathname === "/kiosco/pedido") {
    try {
      const cuerpo = JSON.parse((await leerCuerpo(peticion, 16 * 1024)).toString("utf8"));
      const r = registrarPedido(cuerpo, {
        carta: cartaDelLocal,
        consecutivo: () => pedidosDeKioscoHoy++,
        sucursal_id: sucursalDelLocal,
        publicar: (eventos) => hub.recibirDelSistema(eventos as EventoBase[]),
      });
      if (r.ok) json(200, r.datos);
      else json(r.codigo, { error: r.error });
    } catch {
      json(400, { error: "No se pudo leer el pedido" });
    }
    return;
  }

  json(404, { error: "No existe" });
}

/**
 * Imprime, por red o por USB.
 *
 * El POS dice por dónde: `modo: "usb"` con el nombre de la impresora del
 * sistema, o red con host y puerto. Sin `modo` se asume red, que es como
 * hablaban las versiones anteriores — una terminal a medio actualizar sigue
 * imprimiendo en vez de quedarse muda.
 */
async function atenderImpresion(
  peticion: IncomingMessage,
  json: (codigo: number, cuerpo: unknown) => void,
): Promise<void> {
  try {
    const cuerpo = await leerCuerpo(peticion);
    const datos = JSON.parse(cuerpo.toString("utf8")) as {
      modo?: unknown;
      host?: unknown;
      puerto?: unknown;
      dispositivo?: unknown;
      titulo?: unknown;
      datos_base64?: unknown;
    };

    if (typeof datos.datos_base64 !== "string") {
      json(400, { error: "Falta datos_base64" });
      return;
    }
    const bytes = Buffer.from(datos.datos_base64, "base64");
    const titulo = typeof datos.titulo === "string" ? datos.titulo.slice(0, 80) : "MotRest";

    if (datos.modo === "usb") {
      if (typeof datos.dispositivo !== "string") {
        json(400, { error: "Falta el dispositivo de la impresora USB" });
        return;
      }
      const resultado = await enviarAUsb(datos.dispositivo, bytes, titulo);
      json(resultado.ok ? 200 : 502, resultado);
      return;
    }

    if (typeof datos.host !== "string" || typeof datos.puerto !== "number") {
      json(400, { error: "Faltan host o puerto" });
      return;
    }

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

  // Misma defensa que en el POS: no basta comparar prefijos porque
  // `<portal>copia` comparte texto con `<portal>`. La resolución comprueba el
  // separador real de directorio antes de abrir nada.
  const limpia = decodificar(ruta);
  const pedido = limpia === null ? null : archivoDentroDe(RUTA_PORTAL, limpia);
  const archivo =
    pedido !== null && existsSync(pedido) && statSync(pedido).isFile()
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
  seguro: boolean,
  autoridad: AutoridadHub,
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
   * La ruta resuelta tiene que seguir dentro de la carpeta del POS. Se compara
   * por segmento, no por prefijo textual: sin eso `poscopia` pasaría como si
   * estuviera dentro de `pos`, además de los `..` tradicionales.
   */
  const limpia = decodificar(ruta);
  const pedido = limpia === null ? null : archivoDentroDe(RUTA_POS, limpia);
  const archivo =
    pedido !== null && existsSync(pedido) && statSync(pedido).isFile() ? pedido : indice;

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
    const nonce = randomBytes(18).toString("base64");
    // El emparejamiento de la caja siempre usa localhost aunque el navegador
    // haya llegado por 127.0.0.1; se declara de forma explícita en el CSP.
    aplicarEncabezadosDeSeguridad(respuesta, seguro, autoridad, nonce, [
      `ws://localhost:${PUERTO_LOCAL}`,
    ]);
    const html = readFileSync(indice, "utf8").replace(
      "</head>",
      `  <script nonce="${nonce}">
       window.__MOTREST_HUB__ = ${JSON.stringify({
         url: `ws://localhost:${PUERTO_LOCAL}/sync`,
         clave: claveLocal,
         // De qué restaurante es esta caja. Lo dice el Hub —que lo tomó de la
         // licencia firmada— y no una constante del POS, que era la misma en
         // todas las instalaciones.
         sucursal_id: sucursalDelLocal(),
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

function alConectar(socket: WebSocket, esLocal = false): void {
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

  hub.conectar(conexion, esLocal);

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

  // Antes de aceptar una sola terminal, el Hub ya conoce quién puede hacer
  // qué. Leer el stream evita recorrer el log completo por cada tipo.
  const sucursalId = sucursalDelLocal();
  const eventosIdentidad = await almacen.eventos.leerStream(streamIdentidad(sucursalId));
  hub.cargarIdentidad(sucursalId, eventosIdentidad);

  const catalogosDeTerminal = await almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS);
  if (catalogosDeTerminal && catalogosDeTerminal.length > 0) {
    hub.cargarCatalogos(catalogosDeTerminal);
    registrar("info", `Catálogos replicados evaluados: ${catalogosDeTerminal.length}.`);
  }
  const catalogosInternos = await almacen.estado.cargar<Catalogo[]>(CLAVE_CATALOGOS_INTERNOS);
  if (catalogosInternos && catalogosInternos.length > 0) {
    hub.cargarCatalogosInternos(catalogosInternos);
    registrar("info", `Catálogos internos cargados: ${catalogosInternos.length}.`);
  }

  servidor = createServer({ cert: tls.cert, key: tls.key }, atender);
  servidorLocal = createServerHttp(atender);

  // Un cliente que abre una conexión y no termina cabeceras o cuerpo ocupa un
  // socket que la caja necesita. Los cuerpos válidos son pequeños y las rutas
  // no hacen streaming de subida, por lo que estos topes no afectan operación.
  for (const servidorHttp of [servidor, servidorLocal]) {
    servidorHttp.headersTimeout = 15_000;
    servidorHttp.requestTimeout = 30_000;
    servidorHttp.keepAliveTimeout = 5_000;
    servidorHttp.maxHeadersCount = 100;
  }

  wss = new WebSocketServer({ server: servidor, path: "/sync" });
  wssLocal = new WebSocketServer({ server: servidorLocal, path: "/sync" });
  wss.on("connection", (socket) => alConectar(socket, false));
  wssLocal.on("connection", (socket) => alConectar(socket, true));

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
 * La llave pública de licencias viaja compilada dentro del Hub. Puede leerse de
 * un instalador sin daño: no permite firmar. La privada se queda en Central.
 */
async function prepararLicencia(): Promise<void> {
  licencia = new GestorLicencia(
    RUTA_LICENCIA,
    // Se PREGUNTA cada vez: la identidad puede cambiar debajo, justo cuando la
    // licencia que se está comprobando es la que la fija.
    () => sucursalDelLocal(),
    LLAVE_PUBLICA_LICENCIAS,
    registrar,
    fijarSucursalPorLicencia,
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
 * Busca versiones nuevas, avisa a las terminales y —cuando el restaurante lo
 * pide y el momento es seguro— instala.
 *
 * NO INSTALA NADA POR SU CUENTA. Quien decide cuándo es el restaurante, y quien
 * comprueba que el momento sea seguro es el dominio (`puedeInstalarse`). Un Hub
 * que se actualiza solo a las nueve de la noche del viernes es exactamente lo
 * que no puede pasar.
 *
 * El reloj de un minuto es lo que hace que «a las 23:00» signifique algo: nadie
 * tiene que estar delante de la pantalla a esa hora para que ocurra.
 */
async function prepararActualizaciones(): Promise<void> {
  /*
   * El repositorio viaja incrustado en el binario junto a las llaves públicas.
   * Antes solo se leía del entorno, y como nada lo escribía —ni el instalador ni
   * Tauri al lanzar el Hub—, el canal venía apagado en cada instalación: los
   * locales no llegaban ni a preguntar si había versión nueva. La variable de
   * entorno sigue mandando, para poder apuntar un equipo a un repo de pruebas.
   */
  const repositorio = process.env.MOTREST_ACTUALIZACIONES_REPO || REPOSITORIO_ACTUALIZACIONES;

  estadoActualizacion =
    (await almacen.estado.cargar<EstadoActualizacion>(CLAVE_ESTADO_ACTUALIZACION)) ??
    estadoInicial();
  if (estadoActualizacion.disponible) {
    versionDisponible = estadoActualizacion.disponible;
    difundirActualizacion();
  }

  if (!repositorio || !LLAVE_PUBLICA_ACTUALIZACIONES) {
    // Un local sin canal de actualización es un caso normal —se actualiza a
    // mano— y no un error que haya que gritar en cada arranque.
    registrar("info", `MotRest ${VERSION}. Sin canal de actualizaciones configurado.`);
    return;
  }

  const memoria =
    (await almacen.estado.cargar<MemoriaDeCanal>(CLAVE_MEMORIA_ACTUALIZACIONES)) ?? {};

  actualizador = new Actualizaciones(
    {
      repositorio,
      llaveDeFirma: LLAVE_PUBLICA_ACTUALIZACIONES,
      token: process.env.MOTREST_ACTUALIZACIONES_TOKEN,
    },
    VERSION,
    registrar,
    fetch,
    memoria,
    async (nuevaMemoria) => {
      await almacen.estado.guardar(CLAVE_MEMORIA_ACTUALIZACIONES, nuevaMemoria);
    },
    sucursalDelLocal(),
  );

  const revisar = async () => {
    try {
      const encontrada = await actualizador!.buscar();
      if (!encontrada || encontrada.version === versionDisponible?.version) return;

      versionDisponible = encontrada;
      estadoActualizacion = registrarDisponible(estadoActualizacion, encontrada, Date.now());
      await guardarEstadoActualizacion();
    } catch (causa) {
      registrar("aviso", `No se pudo revisar si hay versión nueva: ${String(causa)}`);
    }
  };

  await revisar();
  setInterval(() => void revisar(), ACTUALIZAR_CADA_MS).unref?.();
  setInterval(() => void evaluarActualizacion(), 60_000).unref?.();
  registrar("info", `MotRest ${VERSION}. Actualizaciones desde ${repositorio}.`);
}

/**
 * Cada cuánto el local le cuenta a MOTRAE cómo está.
 *
 * Un día. Central da por «sin señal» a las 30 horas (`HORAS_SIN_SENAL`), así que
 * un pulso diario deja margen para un reinicio o una tarde sin internet sin
 * disparar una alarma falsa.
 */
const PULSO_CADA_MS = 24 * 60 * 60 * 1000;

/**
 * El parte que este local manda a MOTRAE.
 *
 * QUÉ NO VA AQUÍ: ventas por producto, clientes, recetas, nada del negocio del
 * restaurante. Van cifras gruesas del último corte porque sirven para detectar
 * una avería —un local que cierra en cero un viernes tiene un problema—, no para
 * husmear. La operación vive en el local y esa es una ventaja del producto.
 */
function pulsoDelLocal(): PulsoCliente {
  const copias = listarRespaldos(RUTA_RESPALDOS);
  const crecimiento = evaluarCrecimiento(hub.seqActual, tamanoDelRegistro());
  const corte = ultimoCorteCerrado();

  const problemas: string[] = [];
  if (!arranqueAutomatico.activo && INSTALACION_REAL) {
    problemas.push("El Hub no arranca solo al encender el equipo");
  }
  if (crecimiento.nivel !== "sano") {
    problemas.push(`El registro del local va por ${crecimiento.eventos} eventos`);
  }
  if (licencia?.veredicto().situacion.estado === "gracia") {
    problemas.push("La licencia está en periodo de gracia");
  }

  return {
    sucursal_id: sucursalDelLocal(),
    ts: Date.now(),
    version: VERSION,
    terminales: hub.conectados,
    dispositivos: terminalesDelLocal(),
    hub_id: HUB_ID,
    plataforma: `${process.platform} ${process.arch}`,
    arranque_automatico: arranqueAutomatico.activo,
    eventos: hub.seqActual,
    ...(copias[0] ? { respaldo_ts: copias[0].ts } : {}),
    ...(corte ? { ventas_dia: corte.ventas, cuentas_dia: corte.cuentas } : {}),
    ...(problemas.length > 0 ? { problemas } : {}),
  };
}

/**
 * El inventario de terminales del local, para el parte de MOTRAE.
 *
 * SE CONSTRUYE CAMPO A CAMPO Y ESO NO ES ESTILO. `dispositivos()` devuelve
 * también el `token` de emparejamiento de cada terminal: la credencial con la
 * que se sincroniza contra este Hub. Mandarlo por el relay —aunque el relay sea
 * de MOTRAE y el enlace vaya cifrado— sería sacar del restaurante la llave de su
 * propio canal, y un `...dispositivo` lo haría sin que nadie lo notara.
 *
 * El `device_id` va recortado por la misma razón por la que se manda: sirve para
 * reconocer la terminal al teléfono, no para nada más.
 */
function terminalesDelLocal(): TerminalReportada[] {
  return almacen.log.dispositivos().map((d) => ({
    device_id: d.device_id.slice(0, 24),
    aprobado: d.aprobado,
    visto_ts: d.visto_ts,
    ...(d.nombre ? { nombre: d.nombre.slice(0, 48) } : {}),
  }));
}

/** Las cifras del último turno que se cerró, para el pulso. */
function ultimoCorteCerrado(): { ventas: Centavos; cuentas: number } | null {
  const cierres = almacen.log.porTipo("caja_cerrada", 0, 20_000) as unknown as {
    resumen?: { total_vendido?: Centavos; cuentas_cerradas?: number };
  }[];
  const ultimo = cierres[cierres.length - 1];
  if (!ultimo?.resumen) return null;
  return {
    ventas: ultimo.resumen.total_vendido ?? CERO,
    cuentas: ultimo.resumen.cuentas_cerradas ?? 0,
  };
}

function reportarPulso(): void {
  if (!enlaceRelay?.conectado()) return;
  try {
    enlaceRelay.reportarPulso(pulsoDelLocal() as unknown as Record<string, unknown>);
  } catch (causa) {
    // Que no se pueda reportar no puede tumbar nada: es información para
    // MOTRAE, no para el restaurante, y el local sigue vendiendo igual.
    registrar("aviso", `No se pudo reportar el estado del local: ${String(causa)}`);
  }
}

/** Guarda el estado y se lo cuenta a todas las terminales a la vez. */
async function guardarEstadoActualizacion(): Promise<void> {
  difundirActualizacion();
  try {
    await almacen.estado.guardar(CLAVE_ESTADO_ACTUALIZACION, estadoActualizacion);
  } catch (causa) {
    registrar("aviso", `No se pudo guardar el estado de la actualización: ${String(causa)}`);
  }
}

function difundirActualizacion(): void {
  hub.publicarCatalogo("actualizacion_estado", estadoActualizacion);
}

/**
 * Traduce lo que llega por HTTP a una de las tres respuestas del diálogo.
 *
 * Se acepta cualquier hora del día, no solo las de madrugada que ofrece el POS.
 * Elegir las 14:00 no adelanta nada —`puedeInstalarse` seguirá negándose en
 * horario de servicio— pero tampoco hace daño, y rechazarlo obligaría a que esta
 * lista y la del diálogo no se separaran nunca.
 */
function eleccionValida(cuerpo: { cuando?: unknown; hora?: unknown }): EleccionActualizacion | null {
  if (cuerpo.cuando === "ahora") return { cuando: "ahora" };
  if (cuerpo.cuando === "mas_tarde") return { cuando: "mas_tarde" };
  if (
    cuerpo.cuando === "a_las" &&
    typeof cuerpo.hora === "number" &&
    Number.isInteger(cuerpo.hora) &&
    cuerpo.hora >= 0 &&
    cuerpo.hora <= 23
  ) {
    return { cuando: "a_las", hora: cuerpo.hora };
  }
  return null;
}

/**
 * Lo que contestó el restaurante en el diálogo.
 *
 * Llega por `POST /actualizacion` desde la caja. El Hub no se fía de que la
 * terminal haya mirado el reloj o la caja: guarda la elección y deja que
 * `evaluarActualizacion` decida si este momento sirve.
 */
async function decidirActualizacion(eleccion: EleccionActualizacion): Promise<void> {
  estadoActualizacion = aplazar(estadoActualizacion, eleccion, Date.now());
  await guardarEstadoActualizacion();
  await evaluarActualizacion();
}

/**
 * ¿Hay algo que instalar, ya toca, y es seguro hacerlo ahora mismo?
 *
 * Se llama cada minuto y en cuanto el restaurante contesta. Las tres respuestas
 * negativas son distintas y se tratan distinto: «todavía no toca» calla, «la
 * caja está abierta» se anota una vez para que se entienda la espera, y un fallo
 * de descarga se anota y se reintenta en la siguiente vuelta.
 */
async function evaluarActualizacion(ahora = Date.now()): Promise<void> {
  if (instalandoActualizacion || !actualizador) return;

  const version = estadoActualizacion.disponible;
  if (!version || !debeInstalar(estadoActualizacion, ahora)) return;

  const veredicto = puedeInstalarse(turnoDeCajaAbierto(), enHorarioDeServicio(ahora));
  if (!veredicto.puede) {
    /*
     * Se dice UNA vez por motivo, no una por minuto. Un Hub que espera ocho
     * horas a que cierre la caja llenaría la bitácora con la misma línea 480
     * veces y taparía todo lo demás.
     */
    if (motivoDeEsperaAnotado !== veredicto.motivo) {
      motivoDeEsperaAnotado = veredicto.motivo;
      registrar("info", `MotRest ${version.version}: ${veredicto.razon}`);
    }
    return;
  }
  motivoDeEsperaAnotado = null;

  instalandoActualizacion = true;
  try {
    const instalador = await actualizador.descargar(version);
    /*
     * Se marca instalada ANTES de lanzar el instalador, no después: el relevo
     * cierra este mismo proceso a los pocos segundos, y si el estado no está
     * escrito para entonces, al volver a arrancar el Hub creería que sigue
     * pendiente y volvería a descargar los mismos cien megas.
     */
    estadoActualizacion = marcarInstalada(estadoActualizacion, version.version);
    versionDisponible = null;
    await guardarEstadoActualizacion();

    await actualizador.instalar(instalador, version, appDeEscritorio());
  } catch (causa) {
    registrar("error", `No se pudo instalar MotRest ${version.version}: ${String(causa)}`);
    // Vuelve a quedar pendiente: el fallo casi siempre es de red y el siguiente
    // intento funciona. Lo que no puede pasar es que desaparezca sin instalarse.
    estadoActualizacion = registrarDisponible(estadoActualizacion, version, ahora);
    versionDisponible = version;
    await guardarEstadoActualizacion();
  } finally {
    instalandoActualizacion = false;
  }
}

/** El último motivo por el que se está esperando, para no repetirlo cada minuto. */
let motivoDeEsperaAnotado: string | null = null;

/**
 * ¿Queda algún turno de caja sin cerrar?
 *
 * Se proyecta del propio registro. El tope existe porque esto se consulta cada
 * minuto mientras haya algo pendiente: 20 000 turnos son más de veinte años de
 * operación, y si alguna vez se alcanzara, **se asume que hay caja abierta**.
 * Ante la duda no se reinicia la caja de un restaurante.
 */
function turnoDeCajaAbierto(): boolean {
  const TOPE = 20_000;
  const aperturas = almacen.log.porTipo("caja_abierta", 0, TOPE) as unknown as {
    sesion_id: string;
  }[];
  if (aperturas.length >= TOPE) return true;

  const cierres = almacen.log.porTipo("caja_cerrada", 0, TOPE) as unknown as {
    sesion_id: string;
  }[];
  return hayTurnoAbierto(aperturas, cierres);
}

/**
 * Dónde está el MotRest que hay que volver a abrir después de instalar.
 *
 * El Hub corre como sidecar dentro de la carpeta de la instalación, así que la
 * aplicación es su vecina. En desarrollo no hay tal cosa: se devuelve `undefined`
 * y el instalador —que tampoco existe— no tendría a quién relanzar.
 */
function appDeEscritorio(): string | undefined {
  if (!INSTALADO) return undefined;
  const candidata = join(dirname(process.execPath), "MotRest.exe");
  return existsSync(candidata) ? candidata : undefined;
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
 * Enlaza con el relay de MOTRAE.
 *
 * EL ENLACE NO DEPENDE DE WHATSAPP, y antes sí. La dirección y la clave del
 * relay vivían únicamente en la configuración de la mensajería, así que un local
 * sin WhatsApp no montaba el enlace — y de ese enlace cuelga el **pulso**, el
 * latido con el que MotRest Central sabe que un restaurante está vivo. El
 * resultado se vio en Rodizio: operando con normalidad y pintado de rojo en
 * Central como CAÍDO, que es la alarma más urgente del panel. Una alarma que
 * suena siempre deja de significar nada.
 *
 * Ahora la dirección sale de la LICENCIA firmada —que ya se pega en cada caja al
 * darla de alta— y la mensajería es lo opcional: si hay credenciales de Meta se
 * añaden, y si no, el enlace sirve igual para reportar el pulso.
 *
 * Un local sin relay sigue siendo un caso normal: opera con el portal, que es
 * gratis y no depende de nadie. Solo que entonces Central no puede verlo, y eso
 * se dice en la bitácora en vez de dejarlo a que se note en el panel.
 */
async function conectarAlRelay(): Promise<void> {
  const config = await almacen.estado.cargar<{
    url?: string;
    clave?: string;
    phone_number_id?: string;
    token?: string;
    nombre?: string;
  }>(CLAVE_WHATSAPP);

  // Orden deliberado: lo que diga quien instala manda —para apuntar un equipo a
  // un relay de pruebas—, después el documento firmado por MOTRAE, y de último
  // lo que hubiera en la configuración de WhatsApp, que es de donde salía antes
  // y sigue valiendo para los locales ya montados.
  const delaLicencia = licencia?.enlaceRelay ?? null;
  const url = process.env.MOTREST_RELAY_URL ?? delaLicencia?.url ?? config?.url;
  const clave = process.env.MOTREST_RELAY_CLAVE ?? delaLicencia?.clave ?? config?.clave;
  if (!url || !clave) {
    registrar(
      "aviso",
      "Sin enlace con MOTRAE: este local no reportará su pulso y aparecerá sin señal en Central. " +
        "Se corrige reemitiendo la licencia con los datos del relay.",
    );
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
    alConectar: () => {
      avisos?.alReconectar();
      // En cuanto hay enlace, MOTRAE sabe qué versión corre este local. Es el
      // momento útil: justo después de una actualización, el Hub reconecta.
      reportarPulso();
    },
    alLlegarMensaje: (mensaje) => atenderMensajeDelComensal(mensaje),
  });

  avisos = new Avisos(
    enlaceRelay,
    () => almacen.log.porTipo("mensaje_recibido", 0, 2000) as unknown as EventoMensajeria[],
    registrar,
  );

  enlaceRelay.conectar();

  /*
   * El pulso diario. `alConectar` ya manda el primero; este es el que sostiene
   * la señal en un local que lleva semanas encendido sin reiniciarse — que es
   * justo el que se quiere vigilar.
   */
  setInterval(() => reportarPulso(), PULSO_CADA_MS).unref?.();
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
    limpiarRegistrosViejos();
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
      `    ${paraLaConsola(`http://localhost:${PUERTO_LOCAL}/?hub=ws://localhost:${PUERTO_LOCAL}/sync&k=${claveLocal}`)}`,
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
        console.log(`    ${paraLaConsola(url)}`);
      }
      console.log("");
      console.log("    La primera vez el navegador avisará del certificado. En Chrome:");
      console.log("    «Configuración avanzada» o «Help me understand» → «Continuar a…».");
      console.log("    Es el certificado de este Hub; sin él no se puede cifrar nada.");
    }

    console.log("");
    if (MOSTRAR_CLAVE) {
      console.log("  Estos enlaces LLEVAN LA CLAVE del local: trátalos como contraseñas.");
    } else {
      console.log("  La clave va oculta. El camino normal es el QR de Administración → Hub.");
      console.log("  Para verla aquí (y dejarla escrita donde caiga esta salida):");
      console.log("      MOTREST_MOSTRAR_CLAVE=1");
    }
    console.log("");

    if (!EXIGIR_APROBACION) {
      /*
       * Cartel, no una línea suelta.
       *
       * El modo abierto es una salida para el primer arranque y las pruebas;
       * dejarlo puesto en un local real deja que cualquier equipo de la wifi
       * escriba en el registro de ventas sin que nadie lo autorice.
       *
       * PERO UN CARTEL EN LA CONSOLA NO BASTA, y esa era la falla: en la
       * aplicación instalada no hay consola que mirar. El aviso se publica
       * además como catálogo, para que el POS lo pinte donde sí se ve.
       */
      const linea = "═".repeat(64);
      console.log(`\n${linea}`);
      registrar("aviso", "MODO ABIERTO ACTIVO (MOTREST_HUB_ABIERTO=1)");
      registrar("aviso", "Cualquier equipo con la clave sincroniza SIN autorización.");
      registrar("aviso", "En un local real, QUITA esta variable de entorno.");
      console.log(`${linea}\n`);
    }
    // Se publica SIEMPRE, también cuando está apagado: así una terminal que se
    // enciende después recibe el estado real en vez de quedarse con el anterior.
    hub.publicarCatalogo("modo_abierto", { activo: !EXIGIR_APROBACION });
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

/*
 * LA RED DE SEGURIDAD DE ÚLTIMO RECURSO, y la decisión de no morir.
 *
 * Node, por omisión, mata el proceso ante una excepción no capturada. Para casi
 * cualquier programa eso es lo correcto: un estado desconocido es peligroso y
 * más vale reiniciar. Aquí NO lo es, y la diferencia está en quién paga el
 * reinicio.
 *
 * Este proceso es el registro de ventas de un restaurante lleno. Si muere, la
 * caja no cobra, las tablets no mandan a cocina y nadie puede cerrar el turno —
 * y no vuelve solo hasta que alguien cierre y reabra MotRest. Un fallo aislado
 * en una petición rara no justifica ese precio: el event log está en disco y
 * cada petición es independiente de las demás.
 *
 * Así que se anota con todo el detalle y se sigue vendiendo. Lo que NO se hace
 * es callar: sin el renglón en la bitácora esto se convierte en un Hub que se
 * degrada en silencio, que es peor que uno que se muere.
 */
process.on("uncaughtException", (causa) => {
  registrar("error", `Excepción no capturada (el Hub sigue): ${causa.stack ?? String(causa)}`);
});
process.on("unhandledRejection", (causa) => {
  registrar("error", `Promesa sin manejar (el Hub sigue): ${String(causa)}`);
});

arrancar().catch((causa) => {
  // Si el arranque falla no hay Hub, y quedarse en silencio dejaría al
  // restaurante creyendo que está encendido. Se dice y se sale con error.
  registrar("error", `No se pudo arrancar el Hub: ${String(causa)}`);
  process.exit(1);
});
