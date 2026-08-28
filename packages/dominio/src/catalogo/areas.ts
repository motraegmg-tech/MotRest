/**
 * Áreas del local (salones, pisos, terrazas) y plano de piso.
 *
 * DECISIÓN DE GONZALO: cada restaurante edita sus propios espacios, y las mesas
 * se colocan sobre una **retícula** para que el plano virtual corresponda al
 * espacio real. Así el mesero reconoce de un vistazo qué mesa es cuál.
 *
 * CUÁNTA GENTE CABE EN CADA MESA (decisión de Gonzalo, 1.3.5). Hasta la 1.3.4 la
 * mesa guardaba identificador, ubicación y forma y **nada más**: el número de
 * comensales se consideraba información del momento, no del mueble. Se revierte
 * porque sin ese dato dos cosas no se pueden hacer bien:
 *
 *  - **Sentar una reserva.** «Somos diez» tiene que poder contestarse con «la 7
 *    o la 3 con la 4», y eso exige saber de cuántos es cada mesa.
 *  - **Juntar mesas.** Una unión sin capacidades es una corazonada; con ellas es
 *    una cuenta.
 *
 * `capacidad` es OPCIONAL a propósito: los planos que ya existen en los
 * restaurantes no la traen, y una migración obligatoria dejaría el salón vacío
 * el día de la actualización. Cuando falta se estima del tamaño en la retícula
 * —ver `capacidadDe`, que es la ÚNICA fórmula del sistema— y el editor de
 * salones ofrece fijarla a mano.
 *
 * Patrón de sincronización: el plano es CATÁLOGO, no operación. Se replica con
 * CRUD/LWW por versión (TRD §5.1), no por event sourcing.
 */
import type { ID } from "../comun/ids.js";

export type FormaMesa = "cuadrada" | "redonda" | "rectangular";

export interface Area {
  id: ID;
  nombre: string;
  orden: number;
  /** Tamaño de la retícula sobre la que se dibuja el área. */
  columnas: number;
  filas: number;
}

export interface Mesa {
  id: ID;
  /** Lo que se pinta en la mesa y en el ticket: "1", "12", "Barra 3". */
  nombre: string;
  area_id: ID;
  /** Esquina superior izquierda dentro de la retícula (base 0). */
  columna: number;
  fila: number;
  /** Tamaño en celdas. */
  ancho: number;
  alto: number;
  forma: FormaMesa;
  activa: boolean;
  /**
   * Cuántos comensales caben sentados. Ausente = se estima del tamaño.
   *
   * No se lee nunca directo: se pide por `capacidadDe`, que resuelve la ausencia
   * en un solo sitio. Leerlo a mano es como aparecieron dos fórmulas distintas
   * para la misma mesa, una en el salón y otra en administración.
   */
  capacidad?: number;
}

/** Plano completo del local. Catálogo versionado (TRD §5.2). */
export interface PlanoLocal {
  areas: Area[];
  mesas: Mesa[];
  version: number;
  updated_at: number;
}

export const LIMITES_RETICULA = {
  columnasMin: 4,
  columnasMax: 24,
  filasMin: 3,
  filasMax: 18,
} as const;

/**
 * Hasta cuántos comensales admite una mesa.
 *
 * El techo no es un capricho: una «mesa» de treinta plazas es en realidad un
 * salón, y tratarla como mesa rompe el reparto de propinas y el rol de meseros.
 * Quien de verdad tenga un banquete arma la unión de mesas, que sí sabe contar.
 */
export const LIMITES_MESA = {
  capacidadMin: 1,
  capacidadMax: 20,
} as const;

/** Cuántas mesas puede abarcar UNA sola cuenta. */
export const MAX_MESAS_UNIDAS = 3;

/**
 * Qué tan lejos pueden estar dos mesas que se juntan, en celdas de la retícula.
 *
 * Nadie arrastra una mesa de la terraza al fondo del salón. Sin este límite el
 * sistema proponía uniones imposibles —correctas en la aritmética, absurdas en
 * el piso— y el mesero perdía la confianza en la sugerencia entera.
 */
export const DISTANCIA_MAX_UNION = 6;

// --- Consultas ------------------------------------------------------------------

export function areaDe(plano: PlanoLocal, areaId: ID): Area | undefined {
  return plano.areas.find((a) => a.id === areaId);
}

export function mesaDe(plano: PlanoLocal, mesaId: ID): Mesa | undefined {
  return plano.mesas.find((m) => m.id === mesaId);
}

export function mesasDeArea(plano: PlanoLocal, areaId: ID): Mesa[] {
  return plano.mesas
    .filter((m) => m.area_id === areaId)
    .sort((a, b) => a.fila - b.fila || a.columna - b.columna);
}

/**
 * Cuántos comensales caben en una mesa. LA ÚNICA FÓRMULA DEL SISTEMA.
 *
 * Si el restaurante fijó la capacidad, manda esa y no se discute: él conoce sus
 * muebles. Si no —planos anteriores a la 1.3.5, o mesas recién creadas— se
 * estima a razón de **una plaza por celda de la retícula**, que es la escala con
 * la que se dibujó el plano: una celda ≈ 60 cm de mesa, o sea un cubierto. Una
 * cuadrada de 2×2 da 4, una rectangular de 3×2 da 6, y ninguna baja de 2 porque
 * una mesa de una sola plaza no existe en un restaurante.
 *
 * Que viva aquí y en ningún otro sitio es el punto. Cuando cada pantalla se
 * calculaba la suya, la misma mesa decía «4 comensales» en el salón y «6» en
 * administración, y las dos parecían ciertas.
 */
export function capacidadDe(mesa: Pick<Mesa, "ancho" | "alto" | "capacidad">): number {
  if (typeof mesa.capacidad === "number" && mesa.capacidad > 0) {
    return Math.min(Math.round(mesa.capacidad), LIMITES_MESA.capacidadMax);
  }
  return Math.max(2, mesa.ancho * mesa.alto);
}

/** Lo que suman varias mesas juntas. */
export function capacidadDeMesas(mesas: readonly Mesa[]): number {
  return mesas.reduce((total, m) => total + capacidadDe(m), 0);
}

/** Centro de una mesa en la retícula, para medir cercanía entre dos. */
function centroDe(mesa: Mesa): { x: number; y: number } {
  return { x: mesa.columna + mesa.ancho / 2, y: mesa.fila + mesa.alto / 2 };
}

/** Distancia entre dos mesas en celdas. Solo tiene sentido dentro de un área. */
export function distanciaEntreMesas(a: Mesa, b: Mesa): number {
  const ca = centroDe(a);
  const cb = centroDe(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/** Celdas que ocupa una mesa, como claves "columna:fila". */
export function celdasDe(mesa: Mesa): string[] {
  const celdas: string[] = [];
  for (let f = mesa.fila; f < mesa.fila + mesa.alto; f++) {
    for (let c = mesa.columna; c < mesa.columna + mesa.ancho; c++) {
      celdas.push(`${c}:${f}`);
    }
  }
  return celdas;
}

/** ¿La mesa cabe entera dentro de la retícula de su área? */
export function cabeEnArea(mesa: Mesa, area: Area): boolean {
  return (
    mesa.columna >= 0 &&
    mesa.fila >= 0 &&
    mesa.columna + mesa.ancho <= area.columnas &&
    mesa.fila + mesa.alto <= area.filas
  );
}

/** ¿Esta mesa se encima con alguna otra del mismo área? */
export function haySolape(mesa: Mesa, otras: readonly Mesa[]): boolean {
  const propias = new Set(celdasDe(mesa));
  return otras.some(
    (otra) =>
      otra.id !== mesa.id &&
      otra.area_id === mesa.area_id &&
      celdasDe(otra).some((celda) => propias.has(celda)),
  );
}

/** Primer hueco libre donde quepa una mesa del tamaño indicado. */
export function primerHuecoLibre(
  plano: PlanoLocal,
  areaId: ID,
  ancho = 1,
  alto = 1,
): { columna: number; fila: number } | null {
  const area = areaDe(plano, areaId);
  if (!area) return null;
  const ocupadas = new Set(mesasDeArea(plano, areaId).flatMap(celdasDe));

  for (let fila = 0; fila + alto <= area.filas; fila++) {
    for (let columna = 0; columna + ancho <= area.columnas; columna++) {
      const candidata: Mesa = {
        id: "__tmp__", nombre: "", area_id: areaId,
        columna, fila, ancho, alto, forma: "cuadrada", activa: true,
      };
      if (celdasDe(candidata).every((celda) => !ocupadas.has(celda))) {
        return { columna, fila };
      }
    }
  }
  return null;
}

// --- Dónde sentar a un grupo ----------------------------------------------------

/** Una forma de acomodar al grupo: una mesa, o varias que se juntan. */
export interface OpcionDeAcomodo {
  /** Mesas que se ocuparían. La primera es la principal de la cuenta. */
  mesas: ID[];
  capacidad: number;
  /** Plazas que sobran. Cero es el acomodo perfecto. */
  sobran: number;
  /** Celdas entre la mesa más lejana y la principal. 0 si es una sola. */
  separacion: number;
  /** true = hay que juntar mesas físicamente. */
  unida: boolean;
}

/**
 * Cuántas mesas se miran al armar combinaciones, por área.
 *
 * El coste de probar tríos crece al cubo, y ese fue un defecto real: con
 * cincuenta mesas y un grupo de ocho se generaban casi veinte mil opciones, se
 * recalculaban en cada render y la tableta se arrastraba. Con el tope, el peor
 * caso son 220 tríos por área: instantáneo y con las mesas que de verdad
 * importan, porque el conjunto se elige por capacidad descendente.
 */
const MESAS_A_CONSIDERAR = 12;

/**
 * Dónde sentar a un grupo de `personas`, entre las mesas disponibles.
 *
 * REGLA: si alguna mesa sola alcanza, **solo** se ofrecen mesas solas. Juntar
 * mesas mueve muebles y molesta a quien ya está sentado al lado; no se propone
 * mientras haya una mesa que resuelva. Las uniones aparecen cuando ninguna
 * alcanza, que es justo cuando el mesero las necesita.
 *
 * Las uniones nunca cruzan de área —no se junta la terraza con el salón— ni
 * pasan de `DISTANCIA_MAX_UNION` celdas entre sí.
 *
 * Se ordena por plazas sobrantes y, a igualdad, por cercanía: sentar a 4 en una
 * mesa de 4 antes que en una de 10, y juntar las dos mesas que ya están pegadas
 * antes que las de los extremos.
 */
export function acomodosParaGrupo(
  disponibles: readonly Mesa[],
  personas: number,
  limite = 8,
): OpcionDeAcomodo[] {
  const cuantos = Math.max(1, Math.round(personas) || 1);
  const activas = disponibles.filter((m) => m.activa);

  const solas: OpcionDeAcomodo[] = activas
    .filter((m) => capacidadDe(m) >= cuantos)
    .map((m) => ({
      mesas: [m.id],
      capacidad: capacidadDe(m),
      sobran: capacidadDe(m) - cuantos,
      separacion: 0,
      unida: false,
    }));

  if (solas.length > 0) return ordenarAcomodos(solas).slice(0, limite);

  // Ninguna mesa alcanza: hay que juntar. Se trabaja área por área.
  const porArea = new Map<ID, Mesa[]>();
  for (const mesa of activas) {
    const lista = porArea.get(mesa.area_id);
    if (lista) lista.push(mesa);
    else porArea.set(mesa.area_id, [mesa]);
  }

  const uniones: OpcionDeAcomodo[] = [];
  for (const mesas of porArea.values()) {
    const pool = [...mesas]
      .sort((a, b) => capacidadDe(b) - capacidadDe(a))
      .slice(0, MESAS_A_CONSIDERAR);

    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const par = [pool[i]!, pool[j]!];
        const dPar = distanciaEntreMesas(par[0]!, par[1]!);
        if (dPar > DISTANCIA_MAX_UNION) continue;

        const capPar = capacidadDeMesas(par);
        if (capPar >= cuantos) {
          uniones.push(acomodoDe(par, cuantos, dPar));
          continue;
        }

        // Solo se busca un tercero si el par se queda corto.
        if (MAX_MESAS_UNIDAS < 3) continue;
        for (let k = j + 1; k < pool.length; k++) {
          const tercera = pool[k]!;
          const d = Math.max(
            dPar,
            distanciaEntreMesas(par[0]!, tercera),
            distanciaEntreMesas(par[1]!, tercera),
          );
          if (d > DISTANCIA_MAX_UNION) continue;
          const trio = [...par, tercera];
          if (capacidadDeMesas(trio) >= cuantos) uniones.push(acomodoDe(trio, cuantos, d));
        }
      }
    }
  }

  return ordenarAcomodos(uniones).slice(0, limite);
}

function acomodoDe(mesas: Mesa[], cuantos: number, separacion: number): OpcionDeAcomodo {
  const capacidad = capacidadDeMesas(mesas);
  return {
    mesas: mesas.map((m) => m.id),
    capacidad,
    sobran: capacidad - cuantos,
    separacion: Math.round(separacion * 10) / 10,
    unida: mesas.length > 1,
  };
}

/** Menos desperdicio primero; a igualdad, menos mesas y más cerca. */
function ordenarAcomodos(opciones: OpcionDeAcomodo[]): OpcionDeAcomodo[] {
  return opciones.sort(
    (a, b) =>
      a.sobran - b.sobran ||
      a.mesas.length - b.mesas.length ||
      a.separacion - b.separacion ||
      a.mesas[0]!.localeCompare(b.mesas[0]!),
  );
}

// --- Validación -------------------------------------------------------------------

export type ProblemaPlano =
  | { tipo: "mesa_fuera_de_area"; mesa_id: ID; nombre: string }
  | { tipo: "mesas_encimadas"; mesa_id: ID; nombre: string }
  | { tipo: "nombre_duplicado"; nombre: string }
  | { tipo: "area_sin_mesas"; area_id: ID; nombre: string }
  | { tipo: "mesa_sin_area"; mesa_id: ID; nombre: string };

/** Revisa el plano y devuelve lo que está mal, para mostrarlo en el editor. */
export function validarPlano(plano: PlanoLocal): ProblemaPlano[] {
  const problemas: ProblemaPlano[] = [];
  const vistos = new Map<string, number>();

  for (const mesa of plano.mesas) {
    const area = areaDe(plano, mesa.area_id);
    if (!area) {
      problemas.push({ tipo: "mesa_sin_area", mesa_id: mesa.id, nombre: mesa.nombre });
      continue;
    }
    if (!cabeEnArea(mesa, area)) {
      problemas.push({ tipo: "mesa_fuera_de_area", mesa_id: mesa.id, nombre: mesa.nombre });
    }
    if (haySolape(mesa, plano.mesas)) {
      problemas.push({ tipo: "mesas_encimadas", mesa_id: mesa.id, nombre: mesa.nombre });
    }
    const clave = mesa.nombre.trim().toLowerCase();
    vistos.set(clave, (vistos.get(clave) ?? 0) + 1);
  }

  for (const [nombre, cuenta] of vistos) {
    if (cuenta > 1) problemas.push({ tipo: "nombre_duplicado", nombre });
  }

  for (const area of plano.areas) {
    if (mesasDeArea(plano, area.id).length === 0) {
      problemas.push({ tipo: "area_sin_mesas", area_id: area.id, nombre: area.nombre });
    }
  }

  return problemas;
}

export function describirProblema(problema: ProblemaPlano): string {
  switch (problema.tipo) {
    case "mesa_fuera_de_area":
      return `La mesa ${problema.nombre} se sale de la retícula`;
    case "mesas_encimadas":
      return `La mesa ${problema.nombre} está encimada con otra`;
    case "nombre_duplicado":
      return `Hay más de una mesa llamada "${problema.nombre}"`;
    case "area_sin_mesas":
      return `El área ${problema.nombre} no tiene mesas`;
    case "mesa_sin_area":
      return `La mesa ${problema.nombre} no pertenece a ningún área`;
  }
}

// --- Plano de arranque --------------------------------------------------------------

/** Plano inicial de la demostración: un salón con doce mesas distribuidas. */
export function planoPorDefecto(): PlanoLocal {
  const salon: Area = {
    id: "area-salon",
    nombre: "Salón principal",
    orden: 1,
    columnas: 10,
    filas: 7,
  };
  const terraza: Area = {
    id: "area-terraza",
    nombre: "Terraza",
    orden: 2,
    columnas: 8,
    filas: 5,
  };

  const ubicaciones: [number, number, FormaMesa, number, number][] = [
    [0, 0, "cuadrada", 2, 2],
    [3, 0, "redonda", 2, 2],
    [6, 0, "cuadrada", 2, 2],
    [0, 3, "redonda", 2, 2],
    [3, 3, "rectangular", 3, 2],
    [7, 3, "cuadrada", 2, 2],
    [0, 5, "cuadrada", 2, 2],
    [3, 5, "redonda", 2, 2],
    [6, 5, "rectangular", 3, 2],
  ];

  const mesas: Mesa[] = ubicaciones.map(([columna, fila, forma, ancho, alto], i) => ({
    id: `mesa-${i + 1}`,
    nombre: String(i + 1),
    area_id: salon.id,
    columna,
    fila,
    ancho,
    alto,
    forma,
    activa: true,
  }));

  // Tres mesas más en la terraza, para que el multi-área se note desde el inicio.
  const enTerraza: Mesa[] = [
    { columna: 0, fila: 0 },
    { columna: 3, fila: 0 },
    { columna: 0, fila: 3 },
  ].map((pos, i) => ({
    id: `mesa-${10 + i}`,
    nombre: String(10 + i),
    area_id: terraza.id,
    columna: pos.columna,
    fila: pos.fila,
    ancho: 2,
    alto: 2,
    forma: "redonda" as const,
    activa: true,
  }));

  return {
    areas: [salon, terraza],
    mesas: [...mesas, ...enTerraza],
    version: 1,
    updated_at: Date.now(),
  };
}
