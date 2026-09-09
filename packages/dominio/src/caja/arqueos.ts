/**
 * Qué dicen los arqueos cuando se miran juntos.
 *
 * Un corte suelto responde «¿cuadró hoy?». Cincuenta cortes seguidos responden
 * otra pregunta, que es la que de verdad importa y que hasta ahora no se podía
 * hacer: **¿a quién le falta dinero siempre?**
 *
 * ## Por qué un faltante aislado no dice nada
 *
 * Todo el mundo se equivoca dando cambio. Un faltante de cincuenta pesos un
 * martes es ruido, y tratarlo como una acusación es la forma más rápida de que
 * el equipo empiece a «cuadrar» el cajón antes de declararlo — que es
 * exactamente lo que no se quiere.
 *
 * Lo que sí dice algo es el PATRÓN. Quien cuadra unas veces de más y otras de
 * menos está cometiendo errores; quien falta sistemáticamente y nunca sobra, no
 * se está equivocando. Por eso aquí se cuentan las dos direcciones por separado
 * en vez de sumarlas: un cajero con +300 y −300 tiene diferencia neta cero y
 * seiscientos pesos de desorden, y la suma sola lo escondería.
 *
 * ## Lo que este módulo NO hace
 *
 * No acusa a nadie ni bloquea nada. Ordena y cuenta. La conversación con la
 * persona la tiene el dueño, con los números delante.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EstadoCaja } from "./reducers.js";

/** El desempeño de un cajero en los arqueos de un período. */
export interface DesempenoCajero {
  cajero_id: ID;
  turnos: number;
  /** Turnos que cerraron exactos. */
  cuadrados: number;
  /** Cuántas veces faltó dinero, y cuánto en total (en positivo). */
  veces_faltante: number;
  total_faltante: Centavos;
  /** Cuántas veces sobró, y cuánto. */
  veces_sobrante: number;
  total_sobrante: Centavos;
  /** Faltantes menos sobrantes. Negativo = en conjunto falta dinero. */
  neto: Centavos;
  /**
   * Cuánto se movió el cajón en total, sin importar la dirección.
   *
   * Es la medida del DESORDEN, y es la que no se puede maquillar: un cajero que
   * alterna +300 y −300 tiene neto cero y seiscientos de descuadre.
   */
  descuadre_total: Centavos;
  /** Fracción de turnos que cuadraron exactos. 1 = siempre. */
  precision: number;
  /** El faltante más grande de un solo turno, en positivo. */
  peor_faltante: Centavos;
}

/**
 * Agrupa los cortes cerrados por cajero.
 *
 * Solo entran los turnos CERRADOS: un turno abierto no tiene arqueo, y contarlo
 * como diferencia cero le regalaría precisión a quien todavía no ha contado.
 */
export function desempenoDeCajeros(
  sesiones: readonly EstadoCaja[],
  rango?: { desde: number; hasta: number },
): DesempenoCajero[] {
  const enRango = sesiones.filter((s) => {
    if (!s.cerrada) return false;
    if (!rango) return true;
    return s.abierta_ts >= rango.desde && s.abierta_ts < rango.hasta;
  });

  const porCajero = new Map<ID, EstadoCaja[]>();
  for (const s of enRango) {
    const suyos = porCajero.get(s.cajero_id) ?? [];
    suyos.push(s);
    porCajero.set(s.cajero_id, suyos);
  }

  const filas: DesempenoCajero[] = [];

  for (const [cajero_id, turnos] of porCajero) {
    const diferencias = turnos.map((t) => t.diferencia ?? CERO);

    const faltantes = diferencias.filter((d) => d < 0);
    const sobrantes = diferencias.filter((d) => d > 0);
    const cuadrados = diferencias.filter((d) => d === 0).length;

    const total_faltante = sumar(...faltantes.map((d) => -d as Centavos));
    const total_sobrante = sumar(...sobrantes);

    filas.push({
      cajero_id,
      turnos: turnos.length,
      cuadrados,
      veces_faltante: faltantes.length,
      total_faltante,
      veces_sobrante: sobrantes.length,
      total_sobrante,
      neto: sumar(...diferencias),
      descuadre_total: sumar(total_faltante, total_sobrante),
      precision: turnos.length > 0 ? cuadrados / turnos.length : 0,
      peor_faltante: faltantes.length > 0
        ? (Math.max(...faltantes.map((d) => -d)) as Centavos)
        : CERO,
    });
  }

  // El mayor descuadre primero: es lo que se viene a mirar.
  return filas.sort((a, b) => b.descuadre_total - a.descuadre_total);
}

// --- El turno que nadie cerró -------------------------------------------------------

/**
 * Cuántas horas puede llevar abierto un turno antes de que sea un olvido.
 *
 * Dieciséis horas cubre de sobra el servicio más largo —abrir a las once de la
 * mañana y cerrar a las tres de la madrugada son dieciséis justas— sin dejar
 * pasar el turno que se quedó abierto desde el jueves.
 */
export const HORAS_TURNO_OLVIDADO = 16;

export interface TurnoOlvidado {
  sesion: EstadoCaja;
  /** Cuántas horas lleva abierto. */
  horas: number;
}

/**
 * ¿Hay un turno que se quedó abierto de un día anterior?
 *
 * ## Por qué hace falta avisarlo
 *
 * En Rodizio la caja NUNCA se cierra: hay cero cortes cerrados en la base. No
 * es mala fe, es que nadie se acuerda a las dos de la mañana — y como el
 * sistema no dice nada, el turno del jueves sigue abierto el lunes acumulando
 * la venta de cuatro días. Ese corte ya no se puede arquear contra nada: nadie
 * va a contar el cajón de hace cuatro noches.
 *
 * El aviso no bloquea el cobro. Bloquearlo dejaría al restaurante sin poder
 * atender por un botón que nadie pulsó anoche, que es un remedio mucho peor
 * que la enfermedad.
 */
export function turnoOlvidado(
  sesiones: readonly EstadoCaja[],
  ahora: number = Date.now(),
): TurnoOlvidado | null {
  const abierta = sesiones.find((s) => !s.cerrada);
  if (!abierta) return null;

  const horas = (ahora - abierta.abierta_ts) / 3_600_000;
  return horas >= HORAS_TURNO_OLVIDADO ? { sesion: abierta, horas: Math.floor(horas) } : null;
}
