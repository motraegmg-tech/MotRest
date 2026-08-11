/**
 * El último parte de vida de cada restaurante.
 *
 * POR QUÉ ESTO ESTÁ EN EL RELAY Y NO EN UN SERVICIO NUEVO
 *
 * MOTRAE necesita saber qué versión de MotRest corre cada local —publicar una
 * actualización a ciegas es publicar y rezar— y si alguno lleva días caído. El
 * relay ya es la única pieza de MOTRAE conectada a internet, ya tiene a cada Hub
 * autenticado con su propia credencial y ya está diseñado para no guardar la
 * operación. Montar otro servicio sería otro sitio que proteger y pagar.
 *
 * SOLO EL ÚLTIMO, Y NADA MÁS
 *
 * No es una serie temporal: cada pulso sustituye al anterior. Lo que hay que
 * contestar es «¿cómo está hoy Rodizio?», no «¿cómo estuvo el martes?». Guardar
 * el histórico convertiría el relay en el sitio donde vive la operación de toda
 * la cartera, que es exactamente lo que no puede ser (TRD R3).
 *
 * EL `sucursal_id` NO LO PONE EL HUB
 *
 * Lo pone quien llama a `registrar`, con la identidad que salió de la credencial
 * del saludo. Si el Hub pudiera declararlo, un local podría reportar en nombre
 * de otro —o pisarle su pulso— y el panel de MOTRAE mostraría a un restaurante
 * sano que en realidad está caído.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PulsoCliente, TerminalReportada } from "@motrest/dominio";
import { cifrar, descifrar, type SobreCifrado } from "./sobre.js";

/**
 * Topes de lo que se acepta en un pulso.
 *
 * Un Hub está autenticado, pero autenticado no es de fiar: una versión con un
 * fallo, o un local comprometido, podrían mandar un `problemas` de diez megas en
 * bucle y llenar el disco del relay de TODOS los restaurantes. Se recorta en vez
 * de rechazar — un pulso con un campo raro sigue diciendo que el local vive.
 */
const MAX_PROBLEMAS = 10;
const MAX_TEXTO = 200;
const MAX_VERSION = 32;
/**
 * Topes del inventario de terminales.
 *
 * Un restaurante grande tiene diez o quince aparatos; cuarenta es ya un local
 * que arrastra tabletas viejas que nunca se revocaron, y verlo recortado dice
 * exactamente lo mismo que verlo entero. El `device_id` se recorta a lo que
 * sirve para reconocerla en un soporte y nada más.
 */
const MAX_DISPOSITIVOS = 40;
const MAX_NOMBRE = 48;
const MAX_DEVICE_ID = 24;
const MAX_HUB_ID = 64;
const MAX_PLATAFORMA = 32;

function numeroSano(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : undefined;
}

function recortar(texto: unknown, max: number): string {
  return typeof texto === "string" ? texto.slice(0, max) : "";
}

/**
 * El inventario de terminales, campo a campo.
 *
 * Un `token` de emparejamiento entre estos datos sería la credencial con la que
 * cualquiera sincroniza contra el Hub de ese local. Por eso no se copia el
 * objeto entrante: se construye lo que el panel sabe leer y se tira el resto,
 * aunque el Hub un día mande de más por un descuido.
 */
function sanearDispositivos(crudo: unknown): TerminalReportada[] {
  if (!Array.isArray(crudo)) return [];

  const lista: TerminalReportada[] = [];
  for (const entrada of crudo.slice(0, MAX_DISPOSITIVOS)) {
    if (!entrada || typeof entrada !== "object") continue;
    const dato = entrada as Record<string, unknown>;

    const device_id = recortar(dato.device_id, MAX_DEVICE_ID);
    if (!device_id) continue;

    const nombre = recortar(dato.nombre, MAX_NOMBRE);
    lista.push({
      device_id,
      aprobado: dato.aprobado === true,
      visto_ts: numeroSano(dato.visto_ts) ?? 0,
      ...(nombre ? { nombre } : {}),
    });
  }
  return lista;
}

/**
 * Deja el pulso en lo que el panel de MOTRAE sabe leer, y nada más.
 *
 * Se construye campo a campo a propósito: copiar el objeto entrante con `...`
 * dejaría entrar cualquier cosa que el Hub añadiera, hoy o en tres versiones, y
 * acabaría persistida y servida sin que nadie lo hubiera decidido.
 */
export function sanearPulso(sucursalId: string, crudo: unknown, ahora = Date.now()): PulsoCliente | null {
  if (!crudo || typeof crudo !== "object") return null;
  const dato = crudo as Record<string, unknown>;

  const version = recortar(dato.version, MAX_VERSION);
  if (!version) return null;

  const problemas = Array.isArray(dato.problemas)
    ? dato.problemas
        .slice(0, MAX_PROBLEMAS)
        .map((p) => recortar(p, MAX_TEXTO))
        .filter((p) => p.length > 0)
    : [];

  const ventas = numeroSano(dato.ventas_dia);
  const cuentas = numeroSano(dato.cuentas_dia);
  const terminales = numeroSano(dato.terminales);
  const respaldo = numeroSano(dato.respaldo_ts);
  const eventos = numeroSano(dato.eventos);
  const dispositivos = sanearDispositivos(dato.dispositivos);
  const hub_id = recortar(dato.hub_id, MAX_HUB_ID);
  const plataforma = recortar(dato.plataforma, MAX_PLATAFORMA);

  return {
    sucursal_id: sucursalId,
    /* La hora la pone el relay: el reloj del local puede estar en cualquier año. */
    ts: ahora,
    version,
    ...(ventas !== undefined ? { ventas_dia: ventas as PulsoCliente["ventas_dia"] } : {}),
    ...(cuentas !== undefined ? { cuentas_dia: cuentas } : {}),
    ...(terminales !== undefined ? { terminales } : {}),
    ...(dispositivos.length > 0 ? { dispositivos } : {}),
    ...(hub_id ? { hub_id } : {}),
    ...(plataforma ? { plataforma } : {}),
    ...(typeof dato.arranque_automatico === "boolean"
      ? { arranque_automatico: dato.arranque_automatico }
      : {}),
    ...(respaldo !== undefined ? { respaldo_ts: respaldo } : {}),
    ...(eventos !== undefined ? { eventos } : {}),
    ...(problemas.length > 0 ? { problemas } : {}),
  };
}

export class Pulsos {
  private ultimos = new Map<string, PulsoCliente>();

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
      const lista = JSON.parse(descifrar(sobre, this.llave)) as PulsoCliente[];
      for (const pulso of lista) {
        if (pulso?.sucursal_id) this.ultimos.set(pulso.sucursal_id, pulso);
      }
    } catch (causa) {
      /*
       * Perder los pulsos no es perder nada del restaurante: en cuanto su Hub
       * reconecte volverá a reportar. Nunca puede impedir que el relay arranque
       * y deje a los locales sin WhatsApp por un archivo de telemetría.
       */
      this.avisar(`No se pudieron leer los pulsos de los locales: ${String(causa)}`);
    }
  }

  /** Anota el parte de un local. El `sucursal_id` lo pone quien autenticó. */
  registrar(sucursalId: string, crudo: unknown, ahora = Date.now()): PulsoCliente | null {
    const pulso = sanearPulso(sucursalId, crudo, ahora);
    if (!pulso) return null;

    this.ultimos.set(sucursalId, pulso);
    this.guardar();
    return pulso;
  }

  /** Lo que ve MotRest Central. El más reciente primero. */
  lista(): PulsoCliente[] {
    return [...this.ultimos.values()].sort((a, b) => b.ts - a.ts);
  }

  de(sucursalId: string): PulsoCliente | undefined {
    return this.ultimos.get(sucursalId);
  }

  /** Un local dado de baja deja de existir también aquí. */
  olvidar(sucursalId: string): void {
    if (this.ultimos.delete(sucursalId)) this.guardar();
  }

  /** Temporal + `rename`, como el padrón: o está el archivo entero o el viejo. */
  private guardar(): void {
    const carpeta = dirname(this.ruta);
    try {
      mkdirSync(carpeta, { recursive: true, mode: 0o700 });
      const temporal = join(carpeta, `.pulsos-${process.pid}-${Date.now()}.tmp`);
      try {
        writeFileSync(temporal, cifrar(JSON.stringify([...this.ultimos.values()]), this.llave), {
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
      // Se sigue con los pulsos en memoria: que no se puedan escribir no puede
      // tumbar el enrutado de mensajes, que es para lo que existe el relay.
      this.avisar(`No se pudieron guardar los pulsos: ${String(causa)}`);
    }
  }

  get total(): number {
    return this.ultimos.size;
  }
}
