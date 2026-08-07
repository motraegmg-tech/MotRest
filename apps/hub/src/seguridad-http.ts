/**
 * Defensas compartidas de la superficie HTTP del Hub.
 *
 * Este archivo no arranca el Hub. Las reglas que sí deben poder probarse —Host,
 * origen, ritmo, rutas estáticas y cabeceras— viven aquí para que una prueba no
 * tenga que abrir una base de datos, puertos ni WebSockets.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ConfiguracionHostHub {
  /** Puerto de la escucha que recibió la petición. */
  puerto: number;
  /** HTTPS en la red; HTTP únicamente en el loopback de la caja. */
  seguro: boolean;
  /** Nombre anunciado por mDNS, sin el sufijo `.local`. */
  nombreRed: string;
  /** Direcciones IPv4 que el Hub anunció al arrancar. */
  direccionesLan: readonly string[];
  /** Solo se obtiene del socket, nunca de una cabecera del cliente. */
  esLocal: boolean;
}

export interface AutoridadHub {
  host: string;
  puerto: number;
  /** Host canónico, con puerto solo cuando no es el predeterminado del esquema. */
  autoridad: string;
}

/**
 * Valida que el Host corresponde realmente a este Hub.
 *
 * Sin este candado, un sitio con DNS rebind puede apuntar a 127.0.0.1 y pedir
 * el POS con `Host: atacante.example`: el navegador lo considera mismo origen y
 * puede leer la clave de canal que se inyecta solo en la caja.
 */
export function autoridadDelHub(
  valor: string | undefined,
  configuracion: ConfiguracionHostHub,
): AutoridadHub | null {
  if (!valor || valor.length > 255 || valor.trim() !== valor || /[\s/?#@\\]/.test(valor)) {
    return null;
  }

  const protocolo = configuracion.seguro ? "https" : "http";
  let url: URL;
  try {
    url = new URL(`${protocolo}://${valor}`);
  } catch {
    return null;
  }

  // `Host` es una autoridad, no una URL. Esta comprobación hace explícito que
  // no se acepta una ruta, credenciales ni cualquier otra parte de URL.
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    return null;
  }

  const puertoPredeterminado = configuracion.seguro ? 443 : 80;
  const puerto = url.port ? Number(url.port) : puertoPredeterminado;
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65_535 || puerto !== configuracion.puerto) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const permitidos = new Set(
    [
      `${configuracion.nombreRed}.local`,
      ...configuracion.direccionesLan,
    ].map((candidato) => candidato.toLowerCase()),
  );

  // `localhost` solo es una autoridad válida para quien ya viene del loopback.
  // Aceptarlo desde la LAN volvería a abrir la inyección de clave a un visitante
  // que mande un Host fabricado.
  if (configuracion.esLocal) {
    permitidos.add("localhost");
    permitidos.add("127.0.0.1");
    permitidos.add("[::1]");
  }

  if (!permitidos.has(host)) return null;

  return {
    host,
    puerto,
    autoridad: puerto === puertoPredeterminado ? host : `${host}:${puerto}`,
  };
}

/** El origen propio exacto para CORS y para bloquear CSRF entre puertos locales. */
export function origenDelHub(seguro: boolean, autoridad: AutoridadHub): string {
  return `${seguro ? "https" : "http"}://${autoridad.autoridad}`;
}

/**
 * Un navegador sin Origin es una navegación normal o una herramienta local; no
 * se rechaza. Si lo declara, tiene que ser exactamente el origen del Hub.
 */
export function esOrigenDelHub(
  origen: string | undefined,
  seguro: boolean,
  autoridad: AutoridadHub,
): boolean {
  if (!origen) return true;
  if (origen.length > 255) return false;

  try {
    return new URL(origen).origin === origenDelHub(seguro, autoridad);
  } catch {
    return false;
  }
}

/**
 * Cabeceras para páginas, JSON y archivos estáticos servidos por el Hub.
 *
 * `style-src-attr` deja funcionar los valores de estilo que calcula Svelte,
 * mientras `script-src` queda sin `unsafe-inline`. La caja añade un nonce a la
 * única etiqueta inline que lleva su emparejamiento automático.
 */
export function encabezadosDeSeguridad(
  seguro: boolean,
  autoridad: AutoridadHub,
  nonce?: string,
  conexionesAdicionales: readonly string[] = [],
): Record<string, string> {
  const websocket = `${seguro ? "wss" : "ws"}://${autoridad.autoridad}`;
  const script = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
  const encabezados: Record<string, string> = {
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      script,
      "script-src-attr 'none'",
      "style-src 'self'",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${websocket} ${conexionesAdicionales.join(" ")}`.trim(),
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "geolocation=(), microphone=(), payment=(), usb=()",
  };
  if (seguro) encabezados["strict-transport-security"] = "max-age=31536000";
  return encabezados;
}

/**
 * Resuelve una ruta URL dentro de una carpeta estática.
 *
 * `startsWith(carpeta)` no basta: `C:\\poscopia` comparte el prefijo de
 * `C:\\pos`. `relative()` conserva el separador de directorio y rechaza ese
 * hermano, además de los `..` tradicionales.
 */
export function archivoDentroDe(carpeta: string, ruta: string): string | null {
  if (!ruta.startsWith("/") || ruta.includes("\0")) return null;

  const raiz = resolve(carpeta);
  // El punto vuelve relativa una ruta URL que empieza con `/`.
  const candidato = resolve(raiz, `.${ruta}`);
  const desdeRaiz = relative(raiz, candidato);
  const dentro =
    desdeRaiz === "" ||
    (!desdeRaiz.startsWith(`..${sep}`) && desdeRaiz !== ".." && !isAbsolute(desdeRaiz));

  return dentro ? candidato : null;
}

/** Identifica al cliente desde el socket; nunca se acepta X-Forwarded-For. */
export function clienteHttp(direccion: string | undefined): string {
  const normalizada = direccion?.trim() || "desconocido";
  return normalizada.startsWith("::ffff:") ? normalizada.slice("::ffff:".length) : normalizada;
}

export const LIMITE_GLOBAL_HTTP_POR_MINUTO = 240;

export interface PoliticaDeRitmoHttp {
  clave: string;
  limite: number;
}

/** Las ocho puertas HTTP se clasifican antes de aplicar su cuota específica. */
export function politicaDeRitmoHttp(ruta: string, metodo: string | undefined): PoliticaDeRitmoHttp {
  if (ruta === "/arranque-automatico") return { clave: "arranque", limite: 10 };
  if (ruta === "/imprimir") return { clave: "impresion", limite: 120 };
  if (ruta === "/licencia") return { clave: "licencia", limite: 20 };
  if (ruta === "/salud") return { clave: "salud", limite: 60 };

  if (ruta.startsWith("/portal/api/")) {
    if (metodo === "GET" && ruta.startsWith("/portal/api/cuenta/")) {
      return { clave: "portal-cuenta", limite: 30 };
    }
    return { clave: "portal-mutacion", limite: 10 };
  }

  if (ruta === "/kiosco" || ruta === "/kiosco/" || ruta.startsWith("/kiosco/")) {
    return metodo === "POST"
      ? { clave: "kiosco-pedido", limite: 12 }
      : { clave: "kiosco-lectura", limite: 60 };
  }

  if (ruta === "/portal" || ruta.startsWith("/portal/")) {
    return { clave: "portal-estatico", limite: 180 };
  }

  return { clave: "pos-estatico", limite: 180 };
}

export type VeredictoDeRitmo =
  | { permitido: true }
  | { permitido: false; reintentarEnSegundos: number };

interface CubetaDeRitmo {
  inicio: number;
  usadas: number;
}

/**
 * Ventana fija, local al proceso y con memoria acotada.
 *
 * No pretende sustituir un WAF de Internet: el Hub vive en la LAN. Sí evita que
 * una tablet, un teléfono o un script llene el registro de ventas antes de que
 * alguien pueda atender el problema.
 */
export class LimitadorDeRitmo {
  private readonly cubetas = new Map<string, CubetaDeRitmo>();
  private ultimoBarrido = 0;

  constructor(
    private readonly ventanaMs = 60_000,
    private readonly maxEntradas = 10_000,
  ) {}

  permitir(clave: string, limite: number, ahora = Date.now()): VeredictoDeRitmo {
    if (!Number.isInteger(limite) || limite < 1) {
      throw new Error("El límite de ritmo debe ser un entero positivo");
    }

    const inicio = Math.floor(ahora / this.ventanaMs) * this.ventanaMs;
    let cubeta = this.cubetas.get(clave);
    if (!cubeta || cubeta.inicio !== inicio) {
      this.limpiar(ahora);
      if (this.cubetas.size >= this.maxEntradas) {
        const masAntigua = this.cubetas.keys().next().value;
        if (masAntigua !== undefined) this.cubetas.delete(masAntigua);
      }
      cubeta = { inicio, usadas: 0 };
      this.cubetas.set(clave, cubeta);
    }

    if (cubeta.usadas >= limite) {
      return {
        permitido: false,
        reintentarEnSegundos: Math.max(1, Math.ceil((inicio + this.ventanaMs - ahora) / 1000)),
      };
    }

    cubeta.usadas += 1;
    return { permitido: true };
  }

  private limpiar(ahora: number): void {
    if (this.cubetas.size < this.maxEntradas && ahora - this.ultimoBarrido < this.ventanaMs) return;
    this.ultimoBarrido = ahora;
    for (const [clave, cubeta] of this.cubetas) {
      if (cubeta.inicio + this.ventanaMs <= ahora) this.cubetas.delete(clave);
    }
  }
}
