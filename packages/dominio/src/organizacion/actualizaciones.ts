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
 * falta confiar en GitHub: si alguien tomara la cuenta, sin la **llave privada**
 * no podría colar un instalador.
 *
 * Esa última frase era FALSA hasta la migración a Ed25519. Con HMAC, la llave
 * que verificaba era la misma que firmaba, y se instalaba en cada restaurante:
 * cualquier cliente podía publicar para toda la flota. Ahora en los Hubs solo va
 * la pública, y da igual que se filtre. Ver `comun/firma.ts`.
 */
import { contenidoFirmableDe, firmar, verificar } from "../comun/firma.js";
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
  /**
   * Por debajo de esta versión, lo instalado ya no se considera bueno.
   *
   * Permite invalidar una versión vulnerable sin depender de poder alcanzar a
   * cada Hub: el propio Hub sabe que lo suyo caducó en cuanto ve un manifiesto
   * que lo dice.
   */
  version_minima_soportada?: string;
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

/**
 * Lo que se firma: el manifiesto ENTERO, canónicamente.
 *
 * Antes era `[version, url, sha256, publicado_ts, obligatoria].join("|")` — y
 * **`notas` quedaba fuera**. Quien controlara el release sin tener la llave
 * podía reescribir el único texto que el restaurantero lee para decidir:
 * cambiar «mejoras menores» por «actualización de seguridad crítica, instale de
 * inmediato» y forzar un reinicio en horario de servicio.
 *
 * El defecto de fondo era la lista blanca a mano: cualquier campo que se
 * añadiera después quedaba fuera en silencio. Con el objeto entero, no puede
 * volver a pasar.
 */
export function contenidoFirmableVersion(v: Omit<VersionDisponible, "firma">): string {
  return contenidoFirmableDe(v);
}

/** Firma un manifiesto. Solo MOTRAE, que es quien tiene la llave privada. */
export async function firmarVersion(
  datos: Omit<VersionDisponible, "firma">,
  llavePrivada: string,
): Promise<VersionDisponible> {
  return { ...datos, firma: await firmar(llavePrivada, contenidoFirmableVersion(datos)) };
}

/**
 * ¿Este manifiesto lo publicó MOTRAE?
 *
 * Se comprueba ANTES de descargar el instalador. Y ahora la llave que llevan los
 * Hubs es solo la **pública**: si alguien la extrae de un restaurante, no puede
 * firmar nada. Antes era el mismo secreto con el que se firmaba, así que un
 * cliente comprometido comprometía a toda la flota.
 */
export async function verificarVersion(
  version: VersionDisponible,
  llaveDeVerificacion: string,
): Promise<boolean> {
  const { firma, ...sinFirma } = version;
  return verificar(llaveDeVerificacion, contenidoFirmableVersion(sinFirma), firma);
}

// --- Reversión y frescura -----------------------------------------------------------------------

/** Cuánto puede tener un manifiesto antes de considerarse rancio. */
export const FRESCURA_MAX_MS = 90 * 86_400_000;

export interface MemoriaDeCanal {
  /** El `publicado_ts` más nuevo que se ha aceptado. */
  ultimo_publicado_ts?: number;
  /** Última vez que el Hub aceptó un manifiesto del canal. */
  ultima_consulta_ts?: number;
}

export type VeredictoManifiesto =
  | { aceptar: true; instalada_por_debajo_del_minimo: boolean }
  | { aceptar: false; razon: string };

/** Cuánto reloj adelantado se tolera antes de sospechar de la hora del equipo. */
export const RELOJ_ADELANTADO_MAX_MS = 24 * 60 * 60 * 1000;

/** Dice si la versión instalada ya quedó por debajo del piso de seguridad. */
export function instaladaPorDebajoDelMinimo(
  instalada: string,
  version_minima_soportada?: string,
): boolean {
  return Boolean(
    version_minima_soportada && compararVersiones(instalada, version_minima_soportada) < 0,
  );
}

/**
 * ¿Se acepta este manifiesto, más allá de que la firma cuadre?
 *
 * Una firma válida dice **quién** lo publicó, no **cuándo**. Sin esto, un
 * manifiesto legítimo de MOTRAE vale para siempre, y eso abre dos huecos:
 *
 *   1. **Congelación.** Quien controle la resolución de `api.github.com` para un
 *      local —su DNS, su router— puede seguir sirviéndole indefinidamente el
 *      manifiesto genuino de la versión que ya tiene, y dejarlo sin recibir
 *      jamás un parche de seguridad. Y en silencio.
 *   2. **Reversión.** Un manifiesto viejo, firmado de verdad, que apunta a una
 *      versión que MOTRAE ya sabe que es vulnerable.
 *
 * Se exige que el `publicado_ts` **avance** respecto al último aceptado, y que
 * no sea absurdamente viejo.
 */
export function aceptarManifiesto(
  version: VersionDisponible,
  memoria: MemoriaDeCanal,
  versionInstalada: string,
  ahora: number,
): VeredictoManifiesto {
  if (!Number.isFinite(version.publicado_ts) || version.publicado_ts <= 0) {
    return { aceptar: false, razon: "El manifiesto no trae una fecha de publicación válida" };
  }

  if (version.publicado_ts > ahora + RELOJ_ADELANTADO_MAX_MS) {
    return {
      aceptar: false,
      razon: "El manifiesto parece venir del futuro; revisa el reloj de este equipo",
    };
  }

  if (ahora - version.publicado_ts > FRESCURA_MAX_MS) {
    return {
      aceptar: false,
      razon: "El manifiesto es demasiado viejo. Puede que alguien esté sirviendo uno rancio",
    };
  }

  if (memoria.ultimo_publicado_ts && version.publicado_ts < memoria.ultimo_publicado_ts) {
    return {
      aceptar: false,
      razon: "Este manifiesto es anterior al último aceptado: podría ser una reversión",
    };
  }

  /* Un piso no puede apuntar por delante de la versión que lo anuncia. */
  if (
    version.version_minima_soportada &&
    compararVersiones(version.version, version.version_minima_soportada) < 0
  ) {
    return {
      aceptar: false,
      razon: "La versión mínima es posterior a la que el propio manifiesto ofrece",
    };
  }

  if (!hayNovedad(versionInstalada, version.version)) {
    return { aceptar: false, razon: "No es más nueva que la instalada" };
  }

  return {
    aceptar: true,
    instalada_por_debajo_del_minimo: instaladaPorDebajoDelMinimo(
      versionInstalada,
      version.version_minima_soportada,
    ),
  };
}

/** Cuántos días sin poder consultar antes de decirlo en voz alta. */
export const DIAS_SIN_CONSULTAR_AVISO = 7;

/**
 * ¿Hay que avisar de que llevamos demasiado sin saber del canal?
 *
 * Los fallos de red no se registran —en un restaurante son normales y llenarían
 * la bitácora— pero **el silencio prolongado sí importa**: es exactamente lo que
 * se ve desde dentro cuando alguien está congelando el canal.
 */
export function llevaDemasiadoSinConsultar(
  estado: EstadoActualizacion,
  ahora: number,
): boolean {
  if (!estado.revisada_ts) return false;
  return ahora - estado.revisada_ts > DIAS_SIN_CONSULTAR_AVISO * 86_400_000;
}

/** El stream donde el Hub deja constancia de lo que instaló. */
export function streamActualizaciones(sucursal_id: ID): ID {
  return `actualizaciones:${sucursal_id}`;
}
