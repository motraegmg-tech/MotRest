/**
 * Comparar un restaurante con los que se le parecen (F5).
 *
 * QUÉ CONTESTA. "¿Mi food cost del 34 % está bien?" Un dueño no tiene con qué
 * responderse eso: sabe sus números pero no los de nadie más, y las cifras que
 * circulan en internet son de cadenas gringas. Con varios MotRest operando,
 * MOTRAE sí puede decirle dónde está respecto a locales parecidos.
 *
 * ES LA FUNCIÓN QUE SOLO EXISTE SI HAY RED, y por eso es de las últimas: con
 * tres restaurantes no significa nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PARTE DELICADA NO ES EL CÁLCULO. ES QUE ESTO NO FILTRE LO DE NADIE.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Un restaurante que comparte sus números para compararse NO está aceptando que
 * su competencia de enfrente los lea. Si con el comparativo se puede deducir
 * cuánto vende el vecino, MOTRAE dejó de ser proveedor y pasó a ser una fuga.
 * Tres reglas, y ninguna es negociable:
 *
 *   1. **NUNCA se devuelve un dato individual.** Ni el mejor, ni el peor, ni
 *      "un local de tu zona". Solo medianas y percentiles del grupo.
 *
 *   2. **MÍNIMO DE PARTICIPANTES.** Con menos de cinco, la mediana de un grupo
 *      es casi el dato de alguien. Con cuatro locales y sabiendo el propio, se
 *      despeja el resto con una resta. Por debajo del mínimo no se contesta.
 *
 *   3. **NO SE DEVUELVEN EXTREMOS.** El máximo de un grupo ES el dato de un
 *      local concreto. Los percentiles 25 y 75 no lo son.
 *
 * Y una cuarta que es de trato, no de matemáticas: **solo participa quien
 * acepta**. Un restaurante que no comparte no aparece en la muestra de nadie, y
 * tampoco recibe comparativo. Es lo justo y es lo que hace que quien participa
 * confíe.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

/**
 * Con quién tiene sentido compararse.
 *
 * Un taquería de barrio y un restaurante de mantel largo no se comparan aunque
 * estén en la misma calle: sus márgenes no tienen nada que ver, y decirle a la
 * taquería que su ticket promedio es bajo es ruido.
 */
export type TipoDeLocal =
  | "comida_corrida"
  | "pizzeria"
  | "taqueria"
  | "cafeteria"
  | "restaurante_completo"
  | "bar";

/** Tamaño por número de mesas, que es el que el propio local conoce. */
export type TamanoLocal = "chico" | "mediano" | "grande";

export interface PerfilComparable {
  tipo: TipoDeLocal;
  tamano: TamanoLocal;
  /** Estado de la República. Más fino que esto ya identifica. */
  estado: string;
}

/** Lo que un local aporta a la muestra. Sin nombre, sin id, sin dirección. */
export interface AporteAnonimo {
  perfil: PerfilComparable;
  /** Ticket promedio del periodo. */
  ticket_promedio: Centavos;
  /** Costo de insumos sobre venta, como fracción. */
  food_cost: number;
  /** Nómina sobre venta, como fracción. */
  costo_nomina: number;
  /** Merma sobre costo, como fracción. */
  merma: number;
  /** Cuentas atendidas por hora de servicio. */
  rotacion: number;
  /** Propina sobre venta, como fracción. */
  propina: number;
}

/** Con menos de esto, la mediana del grupo es casi el dato de alguien. */
export const MINIMO_PARTICIPANTES = 5;

export type IndicadorComparable =
  | "ticket_promedio"
  | "food_cost"
  | "costo_nomina"
  | "merma"
  | "rotacion"
  | "propina";

export interface DefinicionIndicador {
  id: IndicadorComparable;
  etiqueta: string;
  /** true = más alto es mejor. false = más bajo es mejor (costos). */
  masEsMejor: boolean;
  formato: "dinero" | "porcentaje" | "numero";
}

export const INDICADORES: DefinicionIndicador[] = [
  { id: "ticket_promedio", etiqueta: "Ticket promedio", masEsMejor: true, formato: "dinero" },
  { id: "food_cost", etiqueta: "Costo de insumos", masEsMejor: false, formato: "porcentaje" },
  { id: "costo_nomina", etiqueta: "Costo de nómina", masEsMejor: false, formato: "porcentaje" },
  { id: "merma", etiqueta: "Merma", masEsMejor: false, formato: "porcentaje" },
  { id: "rotacion", etiqueta: "Cuentas por hora", masEsMejor: true, formato: "numero" },
  { id: "propina", etiqueta: "Propina", masEsMejor: true, formato: "porcentaje" },
];

export interface PosicionIndicador {
  indicador: IndicadorComparable;
  etiqueta: string;
  /** Lo del local que pregunta. */
  propio: number;
  /** La mediana del grupo. */
  mediana: number;
  /** Percentil 25 y 75. NUNCA el mínimo ni el máximo. */
  p25: number;
  p75: number;
  /** En qué cuarto cae, ya interpretado: 1 = el mejor. */
  cuartil: 1 | 2 | 3 | 4;
  /** Qué decirle, en una línea. */
  lectura: string;
}

export type ResultadoBenchmark =
  | { hay: true; participantes: number; posiciones: PosicionIndicador[] }
  | { hay: false; participantes: number; razon: string };

function percentil(ordenados: readonly number[], p: number): number {
  if (ordenados.length === 0) return 0;
  const posicion = (ordenados.length - 1) * p;
  const bajo = Math.floor(posicion);
  const alto = Math.ceil(posicion);
  if (bajo === alto) return ordenados[bajo]!;
  // Interpolado: con muestras pequeñas, tomar el vecino más cercano hace que la
  // mediana coincida con el dato de alguien más veces de lo que debería.
  return ordenados[bajo]! + (ordenados[alto]! - ordenados[bajo]!) * (posicion - bajo);
}

/** ¿Este aporte pertenece al mismo grupo comparable? */
function mismoGrupo(a: PerfilComparable, b: PerfilComparable): boolean {
  return a.tipo === b.tipo && a.tamano === b.tamano && a.estado === b.estado;
}

/**
 * Dónde está este local respecto a los que se le parecen.
 *
 * `muestra` NO debe incluir al propio local: quien llama la arma. Incluirse
 * desplaza la mediana hacia uno mismo y el comparativo se vuelve autocomplaciente.
 */
export function compararConElMercado(
  propio: AporteAnonimo,
  muestra: readonly AporteAnonimo[],
): ResultadoBenchmark {
  const pares = muestra.filter((m) => mismoGrupo(m.perfil, propio.perfil));

  /*
   * EL CANDADO DE PRIVACIDAD. Con cuatro locales y sabiendo el propio, se
   * despeja el resto con una resta. Por debajo del mínimo NO se contesta, aunque
   * el dueño insista: es exactamente cuando el comparativo se convierte en una
   * fuga de los números del vecino.
   */
  if (pares.length < MINIMO_PARTICIPANTES) {
    return {
      hay: false,
      participantes: pares.length,
      razon:
        `Todavía no hay suficientes locales parecidos al suyo (${pares.length} de ${MINIMO_PARTICIPANTES}). ` +
        "Con menos, la comparación revelaría los números de restaurantes concretos.",
    };
  }

  const posiciones = INDICADORES.map((def) => {
    const valores = pares.map((p) => p[def.id] as number).sort((a, b) => a - b);
    const mediana = percentil(valores, 0.5);
    const p25 = percentil(valores, 0.25);
    const p75 = percentil(valores, 0.75);
    const valor = propio[def.id] as number;

    /*
     * El cuartil se calcula "1 = el mejor" SIEMPRE, invirtiendo cuando menos es
     * mejor. Sin eso, un food cost bajo saldría como cuartil 4 y el dueño leería
     * que está mal justo cuando está bien.
     */
    const bruto = valor <= p25 ? 1 : valor <= mediana ? 2 : valor <= p75 ? 3 : 4;
    const cuartil = (def.masEsMejor ? 5 - bruto : bruto) as 1 | 2 | 3 | 4;

    return {
      indicador: def.id,
      etiqueta: def.etiqueta,
      propio: valor,
      mediana,
      p25,
      p75,
      cuartil,
      lectura: leerCuartil(def, cuartil),
    };
  });

  return { hay: true, participantes: pares.length, posiciones };
}

/**
 * Qué decirle al restaurantero de cada indicador.
 *
 * En su idioma y sin regañar. "Estás en el cuartil 4 de food cost" no significa
 * nada para nadie; "gastas más en insumos que la mayoría de locales como el
 * tuyo" es accionable.
 */
function leerCuartil(def: DefinicionIndicador, cuartil: 1 | 2 | 3 | 4): string {
  const que = def.etiqueta.toLowerCase();
  switch (cuartil) {
    case 1:
      return `Su ${que} está entre los mejores de los locales como el suyo.`;
    case 2:
      return `Su ${que} está mejor que la mitad de los locales como el suyo.`;
    case 3:
      return `Su ${que} está por debajo de la mitad de los locales como el suyo.`;
    case 4:
      return def.masEsMejor
        ? `Su ${que} está entre los más bajos. Es donde más hay que ganar.`
        : `Su ${que} está entre los más altos. Es donde más hay que ganar.`;
  }
}

/**
 * Dónde conviene meter mano primero.
 *
 * Ordena por lo que está peor, y se queda con tres. Una lista de seis cosas que
 * arreglar no se arregla: se ignora entera.
 */
export function dondeGanarMas(resultado: ResultadoBenchmark): PosicionIndicador[] {
  if (!resultado.hay) return [];
  return [...resultado.posiciones].sort((a, b) => b.cuartil - a.cuartil).slice(0, 3);
}

/** Lo que un local acepta al participar. Sin esto no entra ni recibe nada. */
export interface ConsentimientoBenchmark {
  sucursal_id: ID;
  /** false = ni aporta ni recibe. Es el estado de fábrica. */
  participa: boolean;
  aceptado_ts?: number;
}

export function consentimientoInicial(sucursal_id: ID): ConsentimientoBenchmark {
  // NO participa de fábrica. Compartir los números de un restaurante es una
  // decisión suya y tiene que ser explícita.
  return { sucursal_id, participa: false };
}

/**
 * ¿Este local puede recibir el comparativo?
 *
 * Quien no aporta no recibe. No es castigo: es lo único que hace sostenible la
 * muestra, y es lo que se le promete a quien sí comparte.
 */
export function puedeRecibirComparativo(
  consentimiento: ConsentimientoBenchmark,
): { puede: boolean; razon?: string } {
  if (!consentimiento.participa) {
    return {
      puede: false,
      razon:
        "Para ver cómo está su restaurante frente a otros hay que compartir sus " +
        "propios números, siempre de forma anónima. Se activa y se desactiva cuando quiera.",
    };
  }
  return { puede: true };
}
