/**
 * Anuncio del Hub en la red del local (mDNS).
 *
 * QUÉ PROBLEMA RESUELVE
 *
 * Hoy el enlace de emparejamiento lleva la IP del equipo. El router del
 * restaurante la reparte por DHCP y puede cambiarla —tras un apagón, al
 * reiniciar el módem, o simplemente cuando caduca la concesión—. El día que
 * cambie, todas las terminales dejan de encontrar el Hub y hay que reemparejar
 * una por una en plena operación.
 *
 * Con esto el Hub se anuncia como `motrest.local`, un nombre que no cambia. Las
 * terminales lo usan en lugar de la IP y sobreviven a un cambio de dirección.
 *
 * SE IMPLEMENTA A MANO, sin dependencias
 *
 * mDNS es DNS normal enviado por multidifusión a 224.0.0.251:5353. Lo que hace
 * falta aquí es responder a las consultas por nuestro nombre, y eso son unas
 * pocas decenas de líneas. Una biblioteca completa traería descubrimiento de
 * servicios, caché y reintentos que este caso no usa.
 *
 * LÍMITE CONOCIDO: Windows y macOS resuelven `.local` de fábrica; Android lo
 * hace desde la versión 12. En un dispositivo que no lo soporte hay que seguir
 * usando la IP, y por eso el enlace con IP se mantiene.
 */
import { createSocket, type Socket } from "node:dgram";

const GRUPO = "224.0.0.251";
const PUERTO_MDNS = 5353;

/** Tipos de registro DNS que se atienden. */
const TIPO_A = 1;
const CLASE_IN = 1;

/** Vida del registro en segundos. Corta a propósito: la IP puede cambiar. */
const TTL = 120;

export interface AnuncioMdns {
  nombre: string;
  detener(): void;
}

/**
 * Anuncia el Hub como `<nombre>.local` y responde a quien pregunte por él.
 *
 * Devuelve `null` si no se pudo abrir el socket —otro servicio ocupando el
 * puerto, permisos, una red rara—. No es un fallo que deba impedir arrancar: el
 * Hub sigue siendo alcanzable por IP.
 */
export function anunciarEnLaRed(
  nombreCorto: string,
  direcciones: readonly string[],
  registrar?: (nivel: "info" | "aviso", mensaje: string) => void,
): AnuncioMdns | null {
  if (direcciones.length === 0) return null;

  const nombre = `${nombreCorto}.local`;
  let socket: Socket;

  try {
    socket = createSocket({ type: "udp4", reuseAddr: true });
  } catch (causa) {
    registrar?.("aviso", `No se pudo anunciar en la red: ${String(causa)}`);
    return null;
  }

  socket.on("error", (causa) => {
    registrar?.("aviso", `Anuncio en la red detenido: ${causa.message}`);
    socket.close();
  });

  socket.on("message", (mensaje, origen) => {
    const preguntas = leerPreguntas(mensaje);
    // Solo interesa quien pregunta por NUESTRO nombre.
    if (!preguntas.some((p) => p.tipo === TIPO_A && p.nombre.toLowerCase() === nombre)) return;

    const respuesta = componerRespuestaA(nombre, direcciones);
    // Se responde en unidifusión al que preguntó: es lo que espera un
    // resolvedor normal y evita ruido en toda la red.
    socket.send(respuesta, origen.port, origen.address);
  });

  try {
    socket.bind(PUERTO_MDNS, () => {
      try {
        socket.addMembership(GRUPO);
        registrar?.("info", `Anunciado en la red como ${nombre}`);
      } catch (causa) {
        registrar?.("aviso", `Sin anuncio en la red: ${String(causa)}`);
      }
    });
  } catch (causa) {
    registrar?.("aviso", `No se pudo anunciar en la red: ${String(causa)}`);
    return null;
  }

  return {
    nombre,
    detener: () => {
      try {
        socket.close();
      } catch {
        // Ya estaba cerrado; no hay nada que hacer ni que reportar.
      }
    },
  };
}

interface Pregunta {
  nombre: string;
  tipo: number;
}

/** Extrae las preguntas de un paquete DNS. Devuelve vacío si no se entiende. */
function leerPreguntas(paquete: Buffer): Pregunta[] {
  try {
    if (paquete.length < 12) return [];
    const cuantas = paquete.readUInt16BE(4);
    const preguntas: Pregunta[] = [];
    let cursor = 12;

    for (let i = 0; i < cuantas && cursor < paquete.length; i += 1) {
      const partes: string[] = [];
      // Un nombre DNS son etiquetas con su longitud delante, hasta un cero.
      while (cursor < paquete.length) {
        const largo = paquete[cursor]!;
        cursor += 1;
        if (largo === 0) break;
        // Puntero de compresión: no aparece en preguntas, y seguirlo aquí
        // abriría la puerta a un bucle infinito con un paquete manipulado.
        if ((largo & 0xc0) === 0xc0) return preguntas;
        partes.push(paquete.subarray(cursor, cursor + largo).toString("utf8"));
        cursor += largo;
      }

      if (cursor + 4 > paquete.length) break;
      const tipo = paquete.readUInt16BE(cursor);
      cursor += 4;
      preguntas.push({ nombre: partes.join("."), tipo });
    }

    return preguntas;
  } catch {
    // Por el puerto llega de todo. Un paquete ilegible se ignora.
    return [];
  }
}

/** Arma una respuesta DNS con un registro A por cada dirección. */
function componerRespuestaA(nombre: string, direcciones: readonly string[]): Buffer {
  const cabecera = Buffer.alloc(12);
  // 0x8400 = respuesta autoritativa.
  cabecera.writeUInt16BE(0x8400, 2);
  cabecera.writeUInt16BE(direcciones.length, 6);

  const registros = direcciones.map((ip) => {
    const etiquetas = nombre.split(".");
    const partes: Buffer[] = [];
    for (const etiqueta of etiquetas) {
      partes.push(Buffer.from([etiqueta.length]), Buffer.from(etiqueta, "utf8"));
    }
    partes.push(Buffer.from([0]));

    const cola = Buffer.alloc(10);
    cola.writeUInt16BE(TIPO_A, 0);
    cola.writeUInt16BE(CLASE_IN, 2);
    cola.writeUInt32BE(TTL, 4);
    cola.writeUInt16BE(4, 8);

    const octetos = Buffer.from(ip.split(".").map((n) => Number(n)));
    return Buffer.concat([...partes, cola, octetos]);
  });

  return Buffer.concat([cabecera, ...registros]);
}
