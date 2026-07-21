/**
 * Áreas del local (salones, pisos, terrazas) y plano de piso.
 *
 * DECISIÓN DE GONZALO: cada restaurante edita sus propios espacios, y las mesas
 * se colocan sobre una **retícula** para que el plano virtual corresponda al
 * espacio real. Así el mesero reconoce de un vistazo qué mesa es cuál.
 *
 * La mesa guarda identificador, ubicación y forma — **no** número de comensales.
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
