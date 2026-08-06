/**
 * Actualizaciones remotas: MOTRAE publica, los restaurantes se enteran (F4).
 *
 * CÓMO SE PUBLICA. Un repositorio de GitHub con **Releases**. Es gratis, sirve
 * por HTTPS con la disponibilidad de GitHub detrás, y no hay que montar ni pagar
 * un servidor de descargas. Se sube el instalador firmado a un release, y en la
 * siguiente comprobación los Hubs lo ven.
 *
 * LO QUE NO SE PUEDE HACER, Y ES LO IMPORTANTE: **empujar una actualización a
 * media cena.** Un restaurante que se reinicia a las nueve de la noche del
 * viernes pierde el servicio, y eso es peor que cualquier mejora que traiga la
 * versión. De ahí las tres reglas que gobiernan este archivo:
 *
 *   1. **El restaurante decide cuándo.** Se le avisa y él elige: ahora, más
 *      tarde, o a una hora concreta. No se instala nada a sus espaldas.
 *   2. **Nunca con la caja abierta.** Un turno abierto es dinero contado a
 *      medias; reiniciar ahí deja un arqueo que no cuadra y nadie sabe por qué.
 *   3. **Aplazar no es olvidar.** El aviso se queda puesto en el software hasta
 *      que se instale. Una actualización que se pospone y desaparece es una
 *      actualización que nunca se instala.
 *
 * LA FIRMA ES LO QUE HACE QUE ESTO SEA SEGURO. Un canal de actualización es la
 * llave maestra de todas las instalaciones: quien pueda publicar por él, manda
 * en todos los restaurantes a la vez. Por eso el manifiesto va firmado por
 * MOTRAE y el Hub verifica la firma ANTES de descargar nada. Ni siquiera hace
 * falta confiar en GitHub: si alguien tomara la cuenta, sin el secreto de firma
 * no podría colar un instalador.
 */
import type { ID } from "../comun/ids.js";

/** Lo que MOTRAE publica en el manifiesto de un release. */
export interface VersionDisponible {
  /** "1.4.0". Se compara como número de versión, no como texto. */
  version: string;
  /** Qué trae, escrito para el restaurantero y no para el programador. */
  notas: string;
  /** De dónde se baja el instalador. */
  url: string;
  /** Huella del archivo: si no coincide, la descarga se tira. */
  sha256: string;
  publicado_ts: number;
  /**
   * true = no se puede aplazar.
   *
   * Reservado para lo que de verdad no admite espera: un fallo de seguridad o
   * un cambio del SAT con fecha. Usarlo para cualquier mejora convierte el
   * "obligatoria" en ruido y el restaurante deja de distinguir.
   */
  obligatoria?: boolean;
  /** Firma de MOTRAE sobre todo lo anterior. */
  firma: string;
}

/** Qué contestó el restaurante al aviso. */
export type EleccionActualizacion =
  /** Instalar en este momento. */
  | { cuando: "ahora" }
  /** Recordármelo en un rato. */
  | { cuando: "mas_tarde" }
  /** A esta hora del día (0–23). Para instalar al cerrar. */
  | { cuando: "a_las"; hora: number };

/**
 * Cuánto dura un "más tarde".
 *
 * Dos horas: lo que dura un servicio. Menos y el aviso vuelve en plena comida,
 * que es justo lo que el restaurante quiso evitar al posponerlo.
 */
export const MAS_TARDE_MS = 2 * 60 * 60 * 1000;

const DIA_MS = 86_400_000;

/** Lo que el Hub guarda entre arranques. Serializable a propósito. */
export interface EstadoActualizacion {
  /** La versión que hay para instalar, o null si está al día. */
  disponible: VersionDisponible | null;
  /** Si el restaurante la aplazó, cuándo se le vuelve a preguntar. */
  aplazada_hasta?: number;
  /** Qué eligió, para poder decírselo ("se instalará a las 23:00"). */
  eleccion?: EleccionActualizacion;
  /** Última vez que se preguntó a GitHub, para no preguntar de más. */
  revisada_ts?: number;
}

export function estadoInicial(): EstadoActualizacion {
  return { disponible: null };
}

/**
 * Compara dos versiones tipo "1.10.2".
 *
 * Por partes numéricas y NO como texto: en orden alfabético "1.10.0" es menor
 * que "1.9.0", y el restaurante se quedaría clavado en la versión vieja sin que
 * nadie entendiera por qué.
 */
export function compararVersiones(a: string, b: string): number {
  const partes = (v: string) => v.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const [ai, bi] = [partes(a), partes(b)];
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const diferencia = (ai[i] ?? 0) - (bi[i] ?? 0);
    if (diferencia !== 0) return diferencia < 0 ? -1 : 1;
  }
  return 0;
}

/** ¿Lo publicado es más nuevo que lo instalado? */
export function hayNovedad(instalada: string, disponible: string): boolean {
  return compararVersiones(disponible, instalada) > 0;
}

/**
 * Cuándo vuelve a aparecer el aviso según lo que eligió el restaurante.
 *
 * Para "a las 23:00": si ya pasaron las once de hoy, es la de mañana. Sin eso,
 * quien elige una hora que ya pasó ve el aviso reaparecer al instante, que se
 * siente como si el sistema no le hubiera hecho caso.
 */
export function cuandoRecordar(
  eleccion: EleccionActualizacion,
  ahora: number,
): number {
  if (eleccion.cuando === "ahora") return ahora;
  if (eleccion.cuando === "mas_tarde") return ahora + MAS_TARDE_MS;

  const objetivo = new Date(ahora);
  objetivo.setHours(eleccion.hora, 0, 0, 0);
  const ts = objetivo.getTime();
  return ts > ahora ? ts : ts + DIA_MS;
}

/** Registra lo que eligió el restaurante. */
export function aplazar(
  estado: EstadoActualizacion,
  eleccion: EleccionActualizacion,
  ahora: number,
): EstadoActualizacion {
  return { ...estado, eleccion, aplazada_hasta: cuandoRecordar(eleccion, ahora) };
}

/** Guarda una versión recién descubierta, sin pisar lo que el usuario decidió. */
export function registrarDisponible(
  estado: EstadoActualizacion,
  version: VersionDisponible,
  ahora: number,
): EstadoActualizacion {
  /*
   * Una versión NUEVA borra el aplazamiento de la anterior. Si no, quien pospone
   * hasta mañana la 1.4 no vería la 1.5 que salió por un fallo grave — el
   * aplazamiento era para aquella versión, no para todas las futuras.
   */
  const esOtra = estado.disponible?.version !== version.version;
  return {
    ...estado,
    disponible: version,
    revisada_ts: ahora,
    ...(esOtra ? { aplazada_hasta: undefined, eleccion: undefined } : {}),
  };
}

/** Se instaló: se limpia todo y se queda esperando la siguiente. */
export function marcarInstalada(
  estado: EstadoActualizacion,
  version: string,
): EstadoActualizacion {
  if (estado.disponible && compararVersiones(estado.disponible.version, version) > 0) {
    return estado;
  }
  return { disponible: null, revisada_ts: estado.revisada_ts };
}

/** ¿Hay que enseñarle el diálogo AHORA? */
export function debeAvisar(estado: EstadoActualizacion, ahora: number): boolean {
  if (!estado.disponible) return false;
  // Lo obligatorio no se puede posponer, así que se avisa siempre.
  if (estado.disponible.obligatoria) return true;
  return (estado.aplazada_hasta ?? 0) <= ahora;
}

/**
 * ¿Se queda el aviso puesto en el software?
 *
 * Sí, mientras haya algo pendiente — aunque esté aplazado. Es lo que pidió
 * Gonzalo y es lo correcto: un aviso que desaparece al posponerlo es un aviso
 * que nadie vuelve a ver.
 */
export function hayPendiente(estado: EstadoActualizacion): boolean {
  return estado.disponible !== null;
}

export type MotivoEspera = "turno_abierto" | "horario_de_servicio";

export type VeredictoInstalacion =
  | { puede: true }
  | { puede: false; motivo: MotivoEspera; razon: string };

/**
 * ¿Se puede instalar en este momento?
 *
 * Lo comprueba el sistema aunque el restaurante haya dicho "ahora": quien elige
 * "sí, instala" a las nueve de la noche del viernes casi nunca está pensando en
 * que eso reinicia la caja con doce mesas abiertas.
 */
export function puedeInstalarse(
  hayTurnoAbierto: boolean,
  enHorarioDeServicio: boolean,
): VeredictoInstalacion {
  if (hayTurnoAbierto) {
    return {
      puede: false,
      motivo: "turno_abierto",
      razon: "Hay un turno de caja abierto. Se instalará al cerrarlo.",
    };
  }
  if (enHorarioDeServicio) {
    return {
      puede: false,
      motivo: "horario_de_servicio",
      razon: "Estamos en horario de servicio. Se instalará al cerrar.",
    };
  }
  return { puede: true };
}

/** Cómo se le resume al restaurantero lo que va a pasar. */
export function resumenDeEleccion(estado: EstadoActualizacion): string {
  if (!estado.disponible) return "";
  if (!estado.eleccion) return `MotRest ${estado.disponible.version} está lista para instalarse.`;

  switch (estado.eleccion.cuando) {
    case "ahora":
      return `Instalando MotRest ${estado.disponible.version}…`;
    case "mas_tarde":
      return `Se le recordará más tarde. MotRest ${estado.disponible.version} sigue pendiente.`;
    case "a_las": {
      const hora = String(estado.eleccion.hora).padStart(2, "0");
      return `MotRest ${estado.disponible.version} se instalará a las ${hora}:00.`;
    }
  }
}

// --- La firma del manifiesto ---------------------------------------------------------------

/** Lo que se firma. Cualquier cambio de un campo invalida la firma. */
export function contenidoFirmableVersion(v: Omit<VersionDisponible, "firma">): string {
  return [v.version, v.url, v.sha256, v.publicado_ts, v.obligatoria ? "1" : "0"].join("|");
}

async function hmacHex(secreto: string, texto: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", llave, new TextEncoder().encode(texto)),
  );
  return [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Firma un manifiesto. Solo MOTRAE, que es quien tiene el secreto. */
export async function firmarVersion(
  datos: Omit<VersionDisponible, "firma">,
  secreto: string,
): Promise<VersionDisponible> {
  return { ...datos, firma: await hmacHex(secreto, contenidoFirmableVersion(datos)) };
}

/**
 * ¿Este manifiesto lo publicó MOTRAE?
 *
 * Se comprueba ANTES de descargar el instalador. Sin esto, quien tomara la
 * cuenta de GitHub podría publicar cualquier ejecutable y los Hubs lo
 * instalarían solos en todos los restaurantes a la vez.
 */
export async function verificarVersion(
  version: VersionDisponible,
  llave: string,
): Promise<boolean> {
  try {
    const esperada = await hmacHex(llave, contenidoFirmableVersion(version));
    const recibida = version.firma.toLowerCase();
    if (recibida.length !== esperada.length) return false;

    let diferencia = 0;
    for (let i = 0; i < esperada.length; i++) {
      diferencia |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
    }
    return diferencia === 0;
  } catch {
    return false;
  }
}

/** El stream donde el Hub deja constancia de lo que instaló. */
export function streamActualizaciones(sucursal_id: ID): ID {
  return `actualizaciones:${sucursal_id}`;
}
