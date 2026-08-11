/**
 * Failover automático: qué pasa si la caja se muere a media cena (F5).
 *
 * EL PROBLEMA REAL. El Hub vive en la computadora de la caja. Si esa máquina se
 * apaga —se fue la luz, se cayó Windows, alguien la desconectó— las tablets del
 * salón se quedan en modo isla: siguen vendiendo, pero **cada una con su propia
 * copia**. Dos meseros pueden abrir la misma mesa sin verse, y al reconectar
 * aparecen dos cuentas para la mesa 7.
 *
 * El modo isla salva la venta, que es lo primero. Esto salva la coherencia, que
 * es lo segundo.
 *
 * CÓMO. Una de las tablets toma el relevo como Hub temporal. No es magia: el
 * protocolo ya replica el log completo a cada terminal, así que cualquiera tiene
 * los datos. Lo único que hay que resolver es **quién manda**, y resolverlo mal
 * es peor que no hacer nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE ORDENA TODO: DOS HUBS A LA VEZ ES PEOR QUE NINGUNO.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Con dos Hubs asignando secuencia, el registro del local se parte en dos
 * historias que no se pueden volver a unir: los mismos números de secuencia
 * apuntando a ventas distintas, dos folios 1043, dos cortes. Ningún beneficio
 * del relevo compensa eso. De ahí las tres defensas:
 *
 *   1. **Mayoría.** Solo toma el relevo quien ve a más de la mitad de las
 *      terminales del local. Si la red se parte en dos mitades, ninguna alcanza
 *      mayoría y ninguna se proclama — las dos siguen en isla, que es correcto.
 *
 *   2. **Espera antes de proclamarse.** Una caja que se reinicia vuelve en un
 *      minuto. Relevarla a los diez segundos provoca un cambio de mando por cada
 *      parpadeo de la red.
 *
 *   3. **El titular siempre gana.** Cuando la caja vuelve, el suplente se retira
 *      sin discutir. No hay elección: hay un titular y sustitutos.
 */
import type { ID } from "../comun/ids.js";

export type PapelHub =
  /** La caja: el Hub de siempre. */
  | "titular"
  /** Puede tomar el relevo si el titular no está. */
  | "suplente"
  /** Solo terminal. Nunca manda. */
  | "terminal";

export interface TerminalDelLocal {
  device_id: ID;
  papel: PapelHub;
  /**
   * Prioridad para el relevo. Menor = antes.
   *
   * Se fija al emparejar y no se negocia en caliente: elegir por "quién tiene
   * mejor batería" o "quién arrancó antes" produce empates y cambios de mando
   * en cadena. Un orden fijo se resuelve solo.
   */
  prioridad: number;
  /** Última vez que se supo de ella. */
  visto_ts: number;
}

/**
 * HACEN FALTA DOS UMBRALES, y con uno solo esto no funciona.
 *
 * Con un único umbral, "la caja no responde pero todavía es pronto" no existe:
 * o está viva o hay que relevarla, y el sistema pasa de la normalidad al cambio
 * de mando sin avisar a nadie. El personal se entera cuando ya pasó.
 *
 * Con dos, hay una franja en la que se sabe que algo va mal, se le dice al
 * personal que siga vendiendo, y todavía no se toca el mando — que es lo que
 * ocurre de verdad cuando una computadora se reinicia.
 */
/** A partir de aquí, la caja NO está respondiendo. Se avisa, no se releva. */
export const SIN_RESPUESTA_MS = 30_000;
/** A partir de aquí sí se considera el relevo. */
export const ESPERA_RELEVO_MS = 90_000;
/** A partir de aquí una terminal se considera desconectada. */
export const TERMINAL_VIVA_MS = 30_000;

export type SituacionFailover =
  /** El titular está. Nada que hacer. */
  | "normal"
  /** No se sabe del titular, pero todavía es pronto. */
  | "esperando"
  /** Esta terminal debe tomar el relevo. */
  | "relevar"
  /**
   * El titular no está y esta terminal NO debe relevarlo.
   *
   * Puede ser porque le toca a otra, o —lo importante— porque no ve a la
   * mayoría del local y proclamarse partiría el registro en dos.
   */
  | "aguantar"
  /** Esta terminal está haciendo de Hub y el titular volvió: hay que retirarse. */
  | "devolver";

export interface DecisionFailover {
  situacion: SituacionFailover;
  /** Por qué, dicho para poder leerlo en la bitácora meses después. */
  motivo: string;
  /** Cuántas terminales ve, incluida ella misma. */
  visibles: number;
  /** Cuántas hacen mayoría. */
  necesarias: number;
}

export interface EstadoLocal {
  /** Yo. */
  yo: TerminalDelLocal;
  /** Todas las terminales emparejadas del local. */
  censo: readonly TerminalDelLocal[];
  /** Última señal del titular. `null` = nunca o hace mucho. */
  titular_visto_ts: number | null;
  /** true = esta terminal ya está haciendo de Hub. */
  soy_hub: boolean;
}

/**
 * Cuántas terminales hacen mayoría.
 *
 * Estricta: más de la mitad. Con cuatro terminales hacen falta tres, no dos —
 * con dos y dos, las dos mitades se proclamarían y el registro se partiría, que
 * es exactamente lo que se está evitando.
 */
export function mayoriaDe(total: number): number {
  return Math.floor(total / 2) + 1;
}

/**
 * ¿Qué debe hacer esta terminal ahora mismo?
 *
 * Función pura, sin red y sin relojes propios: así se puede probar el caso de la
 * red partida en dos, que es el único que de verdad importa y el que jamás se va
 * a poder reproducir en un restaurante.
 */
export function decidirFailover(estado: EstadoLocal, ahora: number): DecisionFailover {
  const censo = estado.censo;
  const necesarias = mayoriaDe(censo.length);
  const visibles = censo.filter((t) => ahora - t.visto_ts <= TERMINAL_VIVA_MS).length;

  const silencio = estado.titular_visto_ts === null ? Infinity : ahora - estado.titular_visto_ts;
  /** Responde con normalidad. */
  const titularVivo = silencio <= SIN_RESPUESTA_MS;
  /** Lleva lo suficiente callado como para plantearse el relevo. */
  const titularPerdido = silencio > ESPERA_RELEVO_MS;

  /*
   * EL TITULAR SIEMPRE GANA. Si volvió, el suplente se retira sin discutir. No
   * hay elección ni negociación: hay un titular y hay sustitutos.
   */
  if (estado.soy_hub && titularVivo) {
    return {
      situacion: "devolver",
      motivo: "La caja volvió. Se le devuelve el mando.",
      visibles,
      necesarias,
    };
  }

  if (titularVivo) {
    return { situacion: "normal", motivo: "La caja está operando.", visibles, necesarias };
  }

  if (estado.soy_hub) {
    return {
      situacion: "relevar",
      motivo: "Esta terminal sigue haciendo de caja.",
      visibles,
      necesarias,
    };
  }

  /*
   * La franja intermedia: no responde, pero todavía es pronto. Se avisa al
   * personal y NO se toca el mando — una computadora que se reinicia vuelve en
   * este rato, y relevarla provocaría un cambio de mando por cada parpadeo.
   *
   * Va antes de comprobar el papel a propósito: el aviso es para todos, también
   * para las tablets que nunca van a mandar.
   */
  if (!titularPerdido) {
    return {
      situacion: "esperando",
      motivo: "La caja lleva poco sin responder. Una que se reinicia vuelve enseguida.",
      visibles,
      necesarias,
    };
  }

  // Solo los suplentes entran al relevo. Una tablet de mesero no manda nunca.
  if (estado.yo.papel !== "suplente") {
    return {
      situacion: "aguantar",
      motivo: "Esta terminal no es suplente: sigue vendiendo en modo isla.",
      visibles,
      necesarias,
    };
  }

  /*
   * EL CANDADO QUE EVITA PARTIR EL REGISTRO. Si la red se parte en dos mitades,
   * ninguna alcanza mayoría y ninguna se proclama. Las dos siguen en isla, que
   * es incómodo pero recuperable — dos Hubs a la vez no lo es.
   */
  if (visibles < necesarias) {
    return {
      situacion: "aguantar",
      motivo:
        `Solo se ven ${visibles} de ${censo.length} terminales y hacen falta ${necesarias}. ` +
        "Tomar el mando sin mayoría partiría el registro del local en dos.",
      visibles,
      necesarias,
    };
  }

  // Con mayoría, releva el suplente de menor prioridad que esté vivo.
  const candidatos = censo
    .filter((t) => t.papel === "suplente" && ahora - t.visto_ts <= TERMINAL_VIVA_MS)
    .sort((a, b) => a.prioridad - b.prioridad);

  const elegido = candidatos[0];
  if (elegido?.device_id !== estado.yo.device_id) {
    return {
      situacion: "aguantar",
      motivo: elegido
        ? "Le toca a otra terminal con más prioridad."
        : "No hay ninguna suplente disponible.",
      visibles,
      necesarias,
    };
  }

  return {
    situacion: "relevar",
    motivo: `La caja lleva ${Math.round(silencio / 1000)} s sin responder y hay mayoría.`,
    visibles,
    necesarias,
  };
}

/**
 * Lo que hay que decirle al personal cuando la caja no está.
 *
 * Nunca en jerga. «Modo isla» y «failover» no significan nada para un mesero a
 * media cena; lo que necesita saber es si puede seguir cobrando y si tiene que
 * llamar a alguien.
 */
export function avisoParaElPersonal(decision: DecisionFailover): string {
  /*
   * SE DICE «LA COMPUTADORA», NO «LA CAJA».
   *
   * En un restaurante «la caja» es el cajón del dinero, o el turno que se
   * cuadra al cerrar. Aquí significaba otra cosa —el equipo donde corre el
   * Hub— y el mensaje se leía como un problema con el dinero. Lo confundió
   * hasta quien conoce el sistema por dentro; un mesero a media cena no tiene
   * ninguna posibilidad.
   */
  switch (decision.situacion) {
    case "normal":
      return "";
    case "esperando":
      return "Sin conexión con la computadora del restaurante. Siga vendiendo con normalidad.";
    case "relevar":
      return "Esta terminal está llevando el control mientras la computadora vuelve. Todo funciona.";
    case "devolver":
      return "La computadora del restaurante volvió. Todo vuelve a la normalidad.";
    case "aguantar":
      return (
        "Esta terminal perdió la conexión con la computadora del restaurante. " +
        "Siga vendiendo: se guarda todo y se junta al reconectar. Avise al encargado."
      );
  }
}

/**
 * ¿Se puede cerrar el turno de caja sin el titular?
 *
 * NO. El corte es lo que cuadra el dinero físico del cajón contra lo vendido, y
 * el cajón está en la computadora que no responde. Un corte hecho desde una
 * tablet suplente cuadraría contra un efectivo que nadie contó.
 *
 * Vender sí; cerrar el día no. Es la distinción que mantiene el arqueo honesto.
 */
export function puedeCerrarTurno(decision: DecisionFailover): { puede: boolean; razon?: string } {
  if (decision.situacion === "normal" || decision.situacion === "devolver") return { puede: true };
  return {
    puede: false,
    razon:
      "El corte se hace desde la caja, con el efectivo contado delante. " +
      "Mientras la computadora no responda, se puede vender y cobrar, pero no cerrar el día.",
  };
}
