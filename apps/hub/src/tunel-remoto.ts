/**
 * El lado del Hub del túnel de la web (modalidad «ambas», 1.6.0).
 *
 * La web no puede llegar al Hub: el Hub nunca abre un puerto a internet
 * (ADR-23). Los dos sí pueden hablar por un canal broadcast PRIVADO de Supabase
 * Realtime (`tunel:<sucursal>`). Aquí cada navegador que dice `abrir` se vuelve
 * una `Conexion` más del Hub, igual que una tableta del salón, con dos
 * diferencias que importan:
 *
 * - **Se cifra con la CLAVE REMOTA, no con la del local.** La web nunca conoce
 *   la clave de la red del salón.
 * - **Entra como `remoto`, nunca como `esLocal`.** `esLocal` aprueba sola a la
 *   terminal y abre lo exclusivo de la caja (licencia, respaldo, impresión). La
 *   web se aprueba sola la primera vez —la credencial fue la contraseña del
 *   restaurante—, pero queda anotada como «Web» y se puede revocar.
 *
 * No sabe nada de Supabase: recibe sobres con `recibir` y los manda con la
 * función que se le da. Así se prueba sin red.
 */
import {
  ExtremoTunel,
  cifrar,
  descifrar,
  esControl,
  esSobreTunel,
  type ClavesCanal,
  type MensajeCliente,
  type MensajeHub,
  type SobreTunel,
} from "@motrest/protocolo-sync";
import type { Conexion } from "./servidor.js";

/** Lo que el túnel necesita del Hub. */
export interface HubParaTunel {
  conectar(conexion: Conexion, esLocal: boolean, remoto: boolean): void;
  recibir(conexionId: string, mensaje: MensajeCliente): void;
  desconectar(conexionId: string): void;
}

export interface OpcionesTunelRemoto {
  hub: HubParaTunel;
  /** Las llaves del canal del lado del Hub: `derivarClaves(claveRemota, "hub")`. */
  claves: ClavesCanal;
  /** Manda un sobre por el canal broadcast. */
  enviar: (sobre: SobreTunel) => void;
  registrar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
  /** Cuántas sesiones web a la vez. Un restaurante no necesita más. */
  maximo?: number;
  ahora?: () => number;
}

const MAXIMO_POR_DEFECTO = 10;

interface SesionWeb {
  extremo: ExtremoTunel;
  conexionId: string;
}

export class TunelRemoto {
  private sesiones = new Map<string, SesionWeb>();

  constructor(private o: OpcionesTunelRemoto) {}

  get abiertas(): number {
    return this.sesiones.size;
  }

  /** Un sobre que llegó por el canal. Todo lo que no sea válido se ignora. */
  recibir(payload: unknown): void {
    if (!esSobreTunel(payload) || payload.d !== "c") return;
    const sesion = this.sesiones.get(payload.s);

    if (!sesion) {
      // Solo un `abrir` crea sesión: fragmentos de una sesión desconocida son
      // de una que ya se cerró, o de alguien probando. No se contesta nada.
      if (esControl(payload) && payload.k === "abrir") this.abrir(payload.s);
      return;
    }
    if (esControl(payload) && payload.k === "abrir") {
      // El navegador no oyó el `abierta` y repite: se le vuelve a decir.
      sesion.extremo.control("abierta");
      return;
    }
    sesion.extremo.recibir(payload);
  }

  private abrir(id: string): void {
    const maximo = this.o.maximo ?? MAXIMO_POR_DEFECTO;
    if (this.sesiones.size >= maximo) {
      this.o.enviar({
        s: id,
        d: "h",
        k: "cerrar",
        motivo: "Hay demasiadas sesiones web abiertas en este restaurante. Cierra alguna e inténtalo de nuevo.",
      });
      this.o.registrar?.("aviso", `Sesión web rechazada: ya hay ${maximo} abiertas.`);
      return;
    }

    const extremo = new ExtremoTunel(id, "h", this.o.enviar, this.o.ahora);
    const conexionId = `web-${id.slice(0, 10)}`;

    /*
     * DOS COLAS, una por sentido. Cifrar y descifrar son asíncronos y el
     * protocolo depende del orden —la bienvenida antes que los catálogos, el
     * saludo antes que todo—; sin encadenar, dos mensajes seguidos podrían
     * salir al revés.
     */
    let salida: Promise<void> = Promise.resolve();
    let entrada: Promise<void> = Promise.resolve();
    let ilegibles = 0;

    const conexion: Conexion = {
      id: conexionId,
      enviar: (mensaje: MensajeHub) => {
        salida = salida.then(async () => {
          if (!extremo.abierto) return;
          extremo.enviar(await cifrar(this.o.claves.envio, mensaje));
        });
      },
      cerrar: () => {
        void salida.then(() => extremo.cerrar("El restaurante cerró esta sesión."));
      },
    };

    extremo.alMensaje = (texto) => {
      entrada = entrada.then(async () => {
        const mensaje = await descifrar<MensajeCliente>(this.o.claves.recepcion, texto);
        if (!mensaje) {
          /*
           * No abre con la clave remota: o la contraseña cambió y el navegador
           * trae la vieja, o alguien habla por el canal sin tenerla. No se le
           * dice qué falló; tres intentos y fuera.
           */
          ilegibles += 1;
          if (ilegibles >= 3) extremo.cerrar("Vuelve a entrar con la contraseña de tu restaurante.");
          return;
        }
        ilegibles = 0;
        try {
          this.o.hub.recibir(conexionId, mensaje);
        } catch (causa) {
          this.o.registrar?.("error", `Fallo al procesar ${mensaje.tipo} de la web: ${String(causa)}`);
        }
      });
    };
    extremo.alCerrar = (motivo) => {
      this.sesiones.delete(id);
      this.o.hub.desconectar(conexionId);
      this.o.registrar?.("info", `Sesión web cerrada (${motivo}).`);
    };

    this.sesiones.set(id, { extremo, conexionId });
    this.o.hub.conectar(conexion, false, true);
    extremo.control("abierta");
    this.o.registrar?.("info", `Sesión web abierta por el túnel (${this.sesiones.size} en total).`);
  }

  /** Llamar cada `LATIDO_MS`: late y cierra las sesiones que callaron. */
  latir(): void {
    for (const { extremo } of [...this.sesiones.values()]) extremo.latir();
  }

  /** Cierra todas: cambió la contraseña, se apagó el acceso, o se desmonta. */
  cerrarTodas(motivo: string): void {
    for (const { extremo } of [...this.sesiones.values()]) extremo.cerrar(motivo);
  }
}
