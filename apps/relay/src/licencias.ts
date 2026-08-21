/**
 * El buzón de licencias: cómo una renovación llega sola al restaurante.
 *
 * EL PROBLEMA QUE RESUELVE. La licencia es un archivo firmado, y hasta ahora la
 * única puerta de entrada era `POST /licencia` en el Hub, que solo acepta
 * peticiones de la propia caja. Traducido: cada renovación de cada local exigía
 * que alguien estuviera físicamente en ese restaurante —o entrara por remoto— y
 * pegara un JSON. Un restaurantero operando su punto de venta a base de pegar
 * código es un fallo de producto, y con treinta clientes es además el cuello de
 * botella de la empresa.
 *
 * EL RELAY NO PUEDE FALSIFICAR NADA, y por eso puede hacer de cartero. La
 * licencia va firmada con la Ed25519 privada de MOTRAE, que no sale de Central;
 * el Hub la verifica contra la pública que lleva compilada dentro
 * (`GestorLicencia.instalar`). Un relay comprometido puede dejar de entregar, o
 * entregar tarde —eso se ve—, pero no puede fabricar una licencia ni alargar la
 * de nadie. Aquí solo viaja un sobre que ya venía cerrado y sellado.
 *
 * POR QUÉ SE GUARDA Y NO SE MANDA Y YA. Un Hub puede estar apagado a las once de
 * la noche, sin internet, o reiniciándose justo en ese segundo. Si la entrega
 * fuera «se manda si está conectado», renovar un local apagado no haría nada y
 * Gonzalo se enteraría el lunes por una llamada. La licencia se queda en el
 * buzón hasta que ESE Hub confirma que la instaló.
 *
 * ES UN BUZÓN, NO UN HISTORIAL. Solo la última licencia pendiente de cada local,
 * y se borra en cuanto llega. El relay sigue sin ser el sitio donde vive nada
 * del negocio (TRD R3).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cifrar, descifrar, type SobreCifrado } from "./sobre.js";

/**
 * Tope del documento que se acepta.
 *
 * Una licencia ronda el kilobyte. Treinta y dos mil es el mismo límite que usa
 * el Hub en su propio `POST /licencia`, y sirve para lo mismo: que nadie con la
 * clave de administración —o que la robe— pueda llenar el disco del relay de
 * todos los restaurantes mandando un «documento» de diez megas.
 */
export const MAX_LICENCIA_BYTES = 32 * 1024;

export interface LicenciaPendiente {
  sucursal_id: string;
  /** El documento firmado, tal cual salió de Central. */
  licencia: Record<string, unknown>;
  /** Cuándo la depositó Central. */
  depositada_ts: number;
  /** Cuántas veces se ha intentado entregar. Un número que sube es un problema. */
  intentos: number;
}

/**
 * ¿Esto se parece siquiera a una licencia?
 *
 * NO se comprueba la firma aquí, y es deliberado: el relay no tiene la llave
 * pública de MOTRAE ni debe tenerla. Quien verifica es el Hub, que es el único
 * que puede hacerlo de forma que signifique algo. Esto solo evita guardar basura
 * y que un `sucursal_id` del cuerpo contradiga al del destinatario.
 */
export function pareceLicencia(valor: unknown, sucursalId: string): boolean {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const licencia = valor as Record<string, unknown>;
  return (
    licencia.sucursal_id === sucursalId &&
    typeof licencia.firma === "string" &&
    licencia.firma.length > 0 &&
    typeof licencia.vence_ts === "number" &&
    Number.isFinite(licencia.vence_ts)
  );
}

export class Licencias {
  private pendientes = new Map<string, LicenciaPendiente>();

  constructor(
    private ruta: string,
    private llave: Buffer,
    private avisar: (texto: string) => void = () => {},
  ) {
    this.cargar();
  }

  private cargar(): void {
    if (!existsSync(this.ruta)) return;
    try {
      const sobre = JSON.parse(readFileSync(this.ruta, "utf8")) as SobreCifrado;
      const lista = JSON.parse(descifrar(sobre, this.llave)) as LicenciaPendiente[];
      for (const pendiente of lista) {
        if (pendiente?.sucursal_id) this.pendientes.set(pendiente.sucursal_id, pendiente);
      }
    } catch (causa) {
      /*
       * Igual que con los pulsos: esto nunca puede impedir que el relay arranque.
       * Una licencia perdida se vuelve a depositar desde Central con un clic; un
       * relay que no levanta deja a todos los restaurantes sin WhatsApp.
       */
      this.avisar(`No se pudieron leer las licencias pendientes: ${String(causa)}`);
    }
  }

  /**
   * Central deja una licencia para un local.
   *
   * Sustituye a la que hubiera pendiente para esa sucursal: si Gonzalo corrige
   * el vencimiento antes de que el Hub se conecte, lo que tiene que llegar es lo
   * último que firmó, no una cola de versiones intermedias que el local iría
   * aplicando en orden.
   */
  depositar(sucursalId: string, licencia: Record<string, unknown>, ahora = Date.now()): LicenciaPendiente {
    const pendiente: LicenciaPendiente = {
      sucursal_id: sucursalId,
      licencia,
      depositada_ts: ahora,
      intentos: 0,
    };
    this.pendientes.set(sucursalId, pendiente);
    this.guardar();
    return pendiente;
  }

  de(sucursalId: string): LicenciaPendiente | undefined {
    return this.pendientes.get(sucursalId);
  }

  /** Deja constancia de que se intentó entregar, para poder ver una que se atasca. */
  anotarIntento(sucursalId: string): void {
    const pendiente = this.pendientes.get(sucursalId);
    if (!pendiente) return;
    pendiente.intentos += 1;
    this.guardar();
  }

  /**
   * El Hub confirmó que la instaló: el buzón se vacía.
   *
   * Solo aquí. Mientras no llegue esta confirmación la licencia sigue pendiente,
   * porque un `send()` que no revienta no significa que el otro lado lo haya
   * escrito en disco: el socket puede caerse justo en medio.
   */
  confirmar(sucursalId: string): boolean {
    if (!this.pendientes.delete(sucursalId)) return false;
    this.guardar();
    return true;
  }

  /** Un local dado de baja deja de existir también aquí. */
  olvidar(sucursalId: string): void {
    if (this.pendientes.delete(sucursalId)) this.guardar();
  }

  /** Lo que Central pregunta para saber qué renovaciones no han llegado. */
  lista(): LicenciaPendiente[] {
    return [...this.pendientes.values()].sort((a, b) => b.depositada_ts - a.depositada_ts);
  }

  get total(): number {
    return this.pendientes.size;
  }

  /** Temporal + `rename`, como el padrón: o está el archivo entero o el viejo. */
  private guardar(): void {
    const carpeta = dirname(this.ruta);
    try {
      mkdirSync(carpeta, { recursive: true, mode: 0o700 });
      const temporal = join(carpeta, `.licencias-${process.pid}-${Date.now()}.tmp`);
      try {
        writeFileSync(temporal, cifrar(JSON.stringify([...this.pendientes.values()]), this.llave), {
          encoding: "utf8",
          mode: 0o600,
        });
        renameSync(temporal, this.ruta);
        chmodSync(this.ruta, 0o600);
      } catch (causa) {
        if (existsSync(temporal)) unlinkSync(temporal);
        throw causa;
      }
    } catch (causa) {
      // Se sigue con lo que hay en memoria: que no se pueda escribir el buzón no
      // puede tumbar el enrutado de mensajes, que es para lo que existe el relay.
      this.avisar(`No se pudieron guardar las licencias pendientes: ${String(causa)}`);
    }
  }
}
