/**
 * Router propio, por hash (ADR-14).
 *
 * No usamos SvelteKit ni History API: el enrutado por rutas reales es frágil
 * bajo los protocolos personalizados con los que Tauri y Capacitor sirven la
 * aplicación empaquetada. El hash funciona igual en las cuatro plataformas.
 *
 * Forma de la ruta:  #/modulo/seccion?clave=valor
 * Ejemplos:          #/venta/salon   ·   #/administracion/usuarios
 */

export interface Ruta {
  modulo: string;
  seccion: string;
  params: Record<string, string>;
}

const RUTA_INICIAL: Ruta = { modulo: "venta", seccion: "salon", params: {} };

function analizar(hash: string): Ruta {
  const limpio = hash.replace(/^#\/?/, "");
  if (limpio === "") return { ...RUTA_INICIAL };

  const [ruta = "", consulta = ""] = limpio.split("?");
  const [modulo = "", seccion = ""] = ruta.split("/");

  const params: Record<string, string> = {};
  for (const [clave, valor] of new URLSearchParams(consulta)) params[clave] = valor;

  return {
    modulo: modulo || RUTA_INICIAL.modulo,
    seccion: seccion || "",
    params,
  };
}

function componer(modulo: string, seccion?: string, params?: Record<string, string>): string {
  const consulta = params && Object.keys(params).length > 0
    ? `?${new URLSearchParams(params).toString()}`
    : "";
  return `#/${modulo}${seccion ? `/${seccion}` : ""}${consulta}`;
}

class Rutas {
  actual = $state<Ruta>(
    typeof location === "undefined" ? { ...RUTA_INICIAL } : analizar(location.hash),
  );

  constructor() {
    if (typeof window === "undefined") return;
    window.addEventListener("hashchange", () => {
      this.actual = analizar(location.hash);
    });
    // Normaliza la barra de direcciones al arrancar.
    if (!location.hash) {
      location.hash = componer(RUTA_INICIAL.modulo, RUTA_INICIAL.seccion);
    }
  }

  ir(modulo: string, seccion?: string, params?: Record<string, string>): void {
    const destino = componer(modulo, seccion, params);
    if (location.hash === destino) return;
    location.hash = destino;
  }

  /** ¿Está activo este módulo? */
  enModulo(modulo: string): boolean {
    return this.actual.modulo === modulo;
  }
}

export const rutas = new Rutas();
