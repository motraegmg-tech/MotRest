/**
 * Transporte ESC/POS por red: abre un socket al puerto de la impresora y le
 * escribe los bytes.
 *
 * Esto es lo que el navegador NO puede hacer —no hay sockets TCP crudos en una
 * página—, y por eso vive en el Hub, que es el proceso Node de la caja. La cola
 * y las plantillas ya generaban los bytes; aquí por fin llegan al papel.
 *
 * DEFENSA: aunque el endpoint que lo usa solo escucha en localhost, este módulo
 * no abre una conexión a cualquier host que le pidan. Una petición podría, si no,
 * pedirle al Hub que toque servicios internos de la red por el puerto de una
 * impresora. Se restringe a IPs privadas y a los puertos que de verdad usan las
 * impresoras.
 */
import { Socket } from "node:net";
import { isIPv4 } from "node:net";

/** Puertos de impresión que se permiten. 9100 es el estándar de impresión directa. */
const PUERTOS_IMPRESION = new Set([9100, 9101, 9102, 9103, 515, 631]);

export interface ResultadoImpresionRed {
  ok: boolean;
  error?: string;
}

/**
 * ¿Es un destino de impresión razonable?
 *
 * Solo IPs privadas (la impresora vive en la LAN del local) y puertos de
 * impresión. Un nombre de host, una IP pública o un puerto raro se rechazan: no
 * hay ninguna razón legítima para que una impresora esté fuera de la red local.
 */
export function esDestinoPermitido(host: string, puerto: number): boolean {
  if (!PUERTOS_IMPRESION.has(puerto)) return false;
  return esIpPrivada(host);
}

function esIpPrivada(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "::1") return true;
  if (!isIPv4(host)) return false;

  const o = host.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  // 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12, 169.254.0.0/16
  if (o[0] === 127) return true;
  if (o[0] === 10) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true;
  if (o[0] === 169 && o[1] === 254) return true;
  return false;
}

/**
 * Manda los bytes a la impresora y espera a que salgan por el cable.
 *
 * Se resuelve solo cuando el socket confirmó el envío y se cerró: dar por
 * impreso antes de que los datos salieran dejaría la comanda perdida si la
 * conexión se cae a medias. Un tiempo de espera corta el intento si la impresora
 * no responde —está apagada, sin papel, desconectada—; la cola lo reintentará.
 */
export function enviarARed(
  host: string,
  puerto: number,
  datos: Uint8Array,
  timeoutMs = 5000,
): Promise<ResultadoImpresionRed> {
  if (!esDestinoPermitido(host, puerto)) {
    return Promise.resolve({ ok: false, error: `Destino no permitido: ${host}:${puerto}` });
  }
  return enviarBytes(host, puerto, datos, timeoutMs);
}

/**
 * El envío por socket, sin la lista blanca.
 *
 * Se separa del guardapuestas para poder probar el envío contra un servidor de
 * prueba en un puerto efímero. En producción nunca se llama directo: siempre
 * pasa por `enviarARed`, que valida el destino primero.
 */
export function enviarBytes(
  host: string,
  puerto: number,
  datos: Uint8Array,
  timeoutMs = 5000,
): Promise<ResultadoImpresionRed> {
  return new Promise((resolver) => {
    const socket = new Socket();
    let resuelto = false;

    const terminar = (resultado: ResultadoImpresionRed): void => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolver(resultado);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => terminar({ ok: false, error: "La impresora no respondió a tiempo" }));
    socket.on("error", (causa) => terminar({ ok: false, error: causa.message }));

    socket.connect(puerto, host, () => {
      socket.write(Buffer.from(datos), (causa) => {
        if (causa) {
          terminar({ ok: false, error: causa.message });
          return;
        }
        // `end` vacía el búfer de escritura y cierra; al cerrarse, damos por impreso.
        socket.end();
      });
    });

    socket.on("close", (conError) => {
      if (!conError) terminar({ ok: true });
    });
  });
}
