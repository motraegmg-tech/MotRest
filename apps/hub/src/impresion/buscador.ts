/**
 * Encontrar las impresoras del restaurante sin que nadie teclee una IP.
 *
 * ## El problema que resuelve
 *
 * Poner en marcha un local exigía saber tres cosas que un restaurantero no
 * tiene por qué saber: la dirección IP de cada impresora de red, el nombre
 * exacto con el que Windows dio de alta la de USB —«BIXOLON SRP-350plus», letra
 * por letra— y qué puerto usa cada una. Cualquiera de las tres mal puesta deja a
 * la cocina sin comandas, y el síntoma aparece el primer viernes.
 *
 * Aquí se buscan solas: las de cable salen del spooler de Windows y las
 * inalámbricas o de red se encuentran barriendo la LAN del propio local. Lo
 * único que queda por decidir es lo que sí es una decisión del negocio: qué
 * imprime cada una.
 *
 * ## Por qué el barrido es como es
 *
 * - **Solo redes privadas y solo las del propio equipo.** Se sacan de las
 *   interfaces de la máquina, no de un parámetro: nadie puede pedirle al Hub que
 *   escanee una red ajena.
 * - **Solo el puerto 9100.** Es el estándar de impresión directa y lo usa la
 *   práctica totalidad de las térmicas. Barrer también 9101–9103 triplicaría el
 *   tiempo para cubrir el caso raro del servidor de impresión de varios puertos,
 *   que se puede añadir a mano.
 * - **Solo /24.** Una red doméstica o de restaurante son 254 direcciones. Si la
 *   máscara es más ancha se reduce igualmente al /24 propio: barrer un /16 son
 *   65 000 sondeos y nadie espera eso mirando una pantalla.
 * - **Se abre y se cierra el socket, nada más.** No se manda un byte a la
 *   impresora: descubrirla no puede gastarle papel.
 */
import { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import {
  impresorasDelSistema,
  puertosSinCola,
  type ImpresoraDelSistema,
} from "./transporte-usb.js";

export interface ImpresoraDetectada {
  /** Cómo llegaría el papel: por el cable USB del equipo, o por la red. */
  origen: "usb" | "red";
  /** Cómo se le llama en pantalla. */
  nombre: string;
  /** Frase corta que ayuda a reconocerla físicamente. */
  detalle: string;
  /** Solo red. */
  host?: string;
  puerto?: number;
  /** Solo USB: el nombre EXACTO de la cola de Windows. */
  dispositivo?: string;
  /**
   * true = no es una impresora de papel (PDF, XPS, fax…).
   *
   * No se esconden: se marcan. Un local puede tener dada de alta una térmica con
   * un nombre rarísimo, y filtrar por listas de nombres acabaría ocultando justo
   * la que se busca. Se ordenan al final y la pantalla las agrupa aparte.
   */
  virtual?: boolean;
  /** Solo USB sin dar de alta: el puerto de Windows donde está enchufada. */
  puerto_sistema?: string;
  /**
   * true = está conectada pero Windows no le creó la cola de impresión.
   *
   * No se puede imprimir todavía; hay que darla de alta primero. Se ofrece
   * hacerlo desde la propia pantalla en vez de mandar a nadie al panel de
   * control de Windows.
   */
  sin_instalar?: boolean;
  /** Ancho de papel probable, deducido del nombre. 42 = 80 mm, 32 = 58 mm. */
  ancho: 32 | 42;
}

export interface ResultadoBusqueda {
  impresoras: ImpresoraDetectada[];
  /** Las redes que se barrieron, para poder decirlo en pantalla. */
  redes: string[];
  /** true = el barrido de red no se pidió o no había ninguna red privada. */
  sin_red: boolean;
}

/** Cuánto se espera a que una dirección conteste. */
const TIMEOUT_SONDEO_MS = 400;
/** Cuántas direcciones se sondean a la vez. */
const EN_PARALELO = 48;
/** El puerto estándar de impresión directa. */
export const PUERTO_IMPRESION = 9100;

/**
 * Nombres que Windows da a las impresoras que no son de papel.
 *
 * Se comparan en minúsculas y como fragmento. Solo sirven para ORDENAR y
 * agrupar, nunca para esconder: ver `virtual` arriba.
 */
const SENAS_VIRTUALES = [
  "microsoft print to pdf",
  "microsoft xps document writer",
  "onenote",
  "fax",
  "adobe pdf",
  "pdf24",
  "cutepdf",
  "imprimir en pdf",
  "escribir documentos xps",
  // Las que instalan las herramientas de acceso remoto para imprimir en el otro
  // extremo. Aparecen en muchas cajas —MOTRAE misma entra por ahí a dar soporte—
  // y colarlas entre las térmicas confunde justo a quien está montando el local.
  "anydesk",
  "teamviewer",
];

function esVirtual(nombre: string): boolean {
  const bajo = nombre.toLowerCase();
  return SENAS_VIRTUALES.some((sena) => bajo.includes(sena));
}

/**
 * Ancho de papel probable a partir del nombre.
 *
 * Un acierto ahorra el paso de configurarlo y un fallo se corrige con un clic,
 * así que conviene intentarlo: casi todas las térmicas llevan el milimetraje en
 * el nombre del modelo. Sin pistas se supone 80 mm, que es lo normal en caja.
 */
export function anchoProbable(nombre: string): 32 | 42 {
  return /\b(58|58mm|5[·.]8|mini)\b/i.test(nombre) ? 32 : 42;
}

/**
 * Las redes /24 privadas a las que está conectado este equipo.
 *
 * Devuelve el prefijo sin el último octeto: "192.168.1". Se descartan las
 * interfaces internas (loopback) y todo lo que no sea IPv4 privada — una
 * impresora nunca está en una IP pública.
 */
export function redesLocales(): string[] {
  const redes = new Set<string>();

  for (const interfaces of Object.values(networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.internal) continue;
      // `family` es "IPv4" en Node moderno y 4 en versiones antiguas embebidas.
      if (iface.family !== "IPv4" && (iface.family as unknown as number) !== 4) continue;
      if (!esIpv4Privada(iface.address)) continue;

      const octetos = iface.address.split(".");
      if (octetos.length !== 4) continue;
      redes.add(octetos.slice(0, 3).join("."));
    }
  }

  return [...redes];
}

function esIpv4Privada(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (o[0] === 10) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true;
  // 169.254/16 es autoasignada: una impresora sin DHCP acaba justo ahí, y es
  // uno de los casos en los que más ayuda encontrarla sola.
  if (o[0] === 169 && o[1] === 254) return true;
  return false;
}

/**
 * ¿Hay algo escuchando ahí?
 *
 * Se conecta y se desconecta sin escribir un solo byte. Un `ECONNREFUSED`
 * rápido significa que la dirección existe pero no imprime; un tiempo agotado,
 * que no hay nadie. Los dos son un "no" y no se distinguen.
 */
export function sondear(
  host: string,
  puerto: number,
  timeoutMs = TIMEOUT_SONDEO_MS,
): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = new Socket();
    let resuelto = false;

    const terminar = (abierto: boolean): void => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolver(abierto);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => terminar(true));
    socket.once("timeout", () => terminar(false));
    socket.once("error", () => terminar(false));
    socket.connect(puerto, host);
  });
}

/** Barre una red /24 buscando quién contesta en el puerto de impresión. */
async function barrerRed(
  prefijo: string,
  puerto: number,
  timeoutMs: number,
): Promise<string[]> {
  const encontrados: string[] = [];
  const direcciones = Array.from({ length: 254 }, (_, i) => `${prefijo}.${i + 1}`);

  for (let i = 0; i < direcciones.length; i += EN_PARALELO) {
    const tanda = direcciones.slice(i, i + EN_PARALELO);
    const respuestas = await Promise.all(
      tanda.map(async (host) => ((await sondear(host, puerto, timeoutMs)) ? host : null)),
    );
    for (const host of respuestas) {
      if (host) encontrados.push(host);
    }
  }

  return encontrados;
}

/** Traduce lo que dice Windows a una impresora detectada. */
export function desdeElSistema(impresora: ImpresoraDelSistema): ImpresoraDetectada {
  const virtual = esVirtual(impresora.nombre);
  const puerto = impresora.puerto.trim();

  /*
   * El puerto de Windows es la mejor pista de cómo está conectada: `USB001` es
   * cable, `WSD-…` o una IP es red aunque el spooler la trate como local. Se
   * dice tal cual porque es lo que el usuario ve en «Impresoras y escáneres» y
   * le permite emparejar la fila con el aparato que tiene delante.
   */
  const comoEsta = puerto.startsWith("USB")
    ? "Conectada por cable USB"
    : /^\d+\.\d+\.\d+\.\d+/.test(puerto) || /^(WSD|IP_)/i.test(puerto)
      ? "En red, instalada en Windows"
      : puerto
        ? `Puerto ${puerto}`
        : "Instalada en Windows";

  return {
    origen: "usb",
    nombre: impresora.nombre,
    dispositivo: impresora.nombre,
    detalle: impresora.estado && impresora.estado !== "Normal"
      ? `${comoEsta} · ${impresora.estado}`
      : comoEsta,
    ancho: anchoProbable(impresora.nombre),
    ...(virtual ? { virtual: true } : {}),
  };
}

/**
 * Busca todas las impresoras que este equipo puede alcanzar.
 *
 * Las de Windows salen siempre —es una consulta instantánea—; el barrido de red
 * es opcional porque tarda unos segundos y no hace falta repetirlo cada vez que
 * se abre la pantalla.
 */
export async function buscarImpresoras(
  opciones: { conRed?: boolean; timeoutMs?: number; puerto?: number } = {},
): Promise<ResultadoBusqueda> {
  const puerto = opciones.puerto ?? PUERTO_IMPRESION;
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_SONDEO_MS;

  const delSistema = (await impresorasDelSistema()).map(desdeElSistema);

  /*
   * Las que están enchufadas pero Windows no terminó de dar de alta.
   *
   * Van en la MISMA lista, no en un apartado técnico aparte: para quien monta
   * el local es una impresora que está ahí, conectada, y lo único que la
   * distingue es que hay que pulsar un botón más. Esconderla en «avanzado»
   * reproduce el problema que esto viene a resolver — en Rodizio la impresora
   * llevaba horas enchufada y encendida, y el asistente decía que no había
   * ninguna.
   */
  const sinCola: ImpresoraDetectada[] = (await puertosSinCola()).map((p) => ({
    origen: "usb" as const,
    nombre: (p.descripcion || p.puerto).trim(),
    detalle: `Conectada por cable, falta darla de alta en Windows (${p.puerto})`,
    puerto_sistema: p.puerto,
    sin_instalar: true,
    ancho: anchoProbable(p.descripcion),
  }));

  if (opciones.conRed === false) {
    return { impresoras: ordenar([...delSistema, ...sinCola]), redes: [], sin_red: true };
  }

  const redes = redesLocales();
  const porRed: ImpresoraDetectada[] = [];

  for (const prefijo of redes) {
    for (const host of await barrerRed(prefijo, puerto, timeoutMs)) {
      porRed.push({
        origen: "red",
        nombre: `Impresora en ${host}`,
        host,
        puerto,
        detalle: `Responde en ${host}:${puerto} · imprime una prueba para saber cuál es`,
        // Sin nombre no hay pista del modelo: se supone el ancho de caja.
        ancho: 42,
      });
    }
  }

  return {
    impresoras: ordenar([...delSistema, ...porRed]),
    redes,
    sin_red: redes.length === 0,
  };
}

/** Primero las de papel, y las virtuales al final. */
function ordenar(lista: ImpresoraDetectada[]): ImpresoraDetectada[] {
  return [...lista].sort((a, b) => {
    if (!!a.virtual !== !!b.virtual) return a.virtual ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });
}
