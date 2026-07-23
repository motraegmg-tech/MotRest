/**
 * Adaptador para un PAC con API REST.
 *
 * Es deliberadamente delgado. Todo lo que decide si el restaurante factura o no
 * —la cola, los reintentos, la clasificación de errores— vive fuera de aquí y
 * es igual para cualquier proveedor. Esto solo traduce.
 *
 * CÓMO SE CAMBIA DE PAC
 *
 * Ajustando `MapeoDelProveedor`. Todo lo específico de un proveedor está en ese
 * objeto y en ningún otro sitio, que es la única forma de que cambiar de PAC no
 * se convierta en una migración.
 *
 * QUÉ FALTA VERIFICAR
 *
 * Los nombres de campo de abajo son los de una API REST típica de timbrado, y
 * **hay que cotejarlos contra la documentación del PAC que se contrate** antes
 * de facturar de verdad. Lo que sí está probado es todo lo demás: qué hacer con
 * cada respuesta posible. Esa parte no cambia con el proveedor.
 */
import { clasificar, type Pac, type ResultadoTimbrado } from "./pac.js";

export interface MapeoDelProveedor {
  /** Dónde se manda el comprobante. */
  url: string;
  /** Cómo se arma el cuerpo de la petición a partir del XML sellado. */
  cuerpo: (xmlSellado: string) => string;
  encabezados: (token: string) => Record<string, string>;
  /** Dónde vienen el XML timbrado, el código y el mensaje en la respuesta. */
  leerRespuesta: (json: unknown) => { xml?: string; codigo?: string; mensaje?: string };
}

/**
 * Mapeo por omisión: JSON con el XML en base64 y respuesta con `data.cfdi`.
 *
 * Es la forma más común entre los PAC mexicanos con API moderna. Se deja como
 * punto de partida, no como verdad: se confirma contra la documentación del
 * proveedor contratado.
 */
export const MAPEO_REST_COMUN: Omit<MapeoDelProveedor, "url"> = {
  cuerpo: (xml) => JSON.stringify({ xml: Buffer.from(xml, "utf8").toString("base64") }),
  encabezados: (token) => ({
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  }),
  leerRespuesta: (json) => {
    const r = json as {
      data?: { cfdi?: string; xml?: string };
      cfdi?: string;
      xml?: string;
      status?: string;
      codigo?: string;
      code?: string;
      message?: string;
      mensaje?: string;
    };

    const crudo = r.data?.cfdi ?? r.data?.xml ?? r.cfdi ?? r.xml;
    return {
      // Algunos devuelven el XML en base64 y otros en claro; se acepta cualquiera.
      xml: crudo ? destextualizar(crudo) : undefined,
      codigo: r.codigo ?? r.code,
      mensaje: r.mensaje ?? r.message,
    };
  },
};

/** Si viene en base64, se decodifica; si ya es XML, se deja como está. */
function destextualizar(valor: string): string {
  if (valor.trimStart().startsWith("<")) return valor;
  try {
    const texto = Buffer.from(valor, "base64").toString("utf8");
    return texto.trimStart().startsWith("<") ? texto : valor;
  } catch {
    return valor;
  }
}

export interface OpcionesPacHttp {
  nombre: string;
  token: string;
  mapeo: MapeoDelProveedor;
  /**
   * Cuánto se espera antes de darlo por caído.
   *
   * Corto a propósito: una factura que tarda se reintenta sola, pero una
   * petición colgada bloquea la cola entera detrás de ella.
   */
  tiempoLimiteMs?: number;
}

export class PacHttp implements Pac {
  readonly nombre: string;

  constructor(private opciones: OpcionesPacHttp) {
    this.nombre = opciones.nombre;
  }

  async timbrar(xmlSellado: string): Promise<ResultadoTimbrado> {
    const { mapeo, token, tiempoLimiteMs = 20_000 } = this.opciones;
    const corte = AbortSignal.timeout(tiempoLimiteMs);

    let respuesta: Response;
    try {
      respuesta = await fetch(mapeo.url, {
        method: "POST",
        headers: mapeo.encabezados(token),
        body: mapeo.cuerpo(xmlSellado),
        signal: corte,
      });
    } catch (error) {
      // Red, DNS o tiempo agotado: nada que interpretar, se reintenta.
      return {
        estado: "reintentable",
        motivo: error instanceof Error ? error.message : String(error),
      };
    }

    const texto = await respuesta.text();

    /*
     * Un 5xx es del PAC y se reintenta. Un 4xx suele ser del comprobante, pero
     * NO se decide aquí: el cuerpo trae el código del SAT, que es quien sabe si
     * esto tiene arreglo. Un 401 por token vencido, por ejemplo, se arregla solo
     * en cuanto alguien renueve la credencial.
     */
    if (respuesta.status >= 500) {
      return { estado: "reintentable", motivo: `El PAC respondió ${respuesta.status}.` };
    }

    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return {
        estado: "reintentable",
        motivo: `Respuesta ilegible del PAC (${respuesta.status}): ${texto.slice(0, 200)}`,
      };
    }

    return clasificar(mapeo.leerRespuesta(json));
  }
}
