/**
 * Grupos de modificadores — el hueco del TRD.
 *
 * `grupo_modificadores` aparece en el TRD §9 solo como nombre, sin campos. Es
 * justo lo que hace genérico a un POS: sin modificadores, un software sirve
 * para un restaurante y para ninguno más.
 *
 * Regla de deslinde frente a las porciones:
 *   - PORCIÓN     → el platillo se parte en fracciones de variedades distintas
 *                   (mitad y mitad). Ver `catalogo/porciones.ts`.
 *   - MODIFICADOR → agrega, quita o elige sobre el platillo (término, extras,
 *                   sin cebolla, tipo de orilla).
 * Ambos se combinan en el mismo renglón.
 *
 * Costeo en modo simple (ADR-16): cada opción declara su delta de precio y su
 * delta de costo. Quien quiera detalle a nivel insumo usará la capa de recetas.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

export interface OpcionModificador {
  id: ID;
  nombre: string;
  /** Lo que suma (o resta) al precio de carta. Puede ser 0 o negativo. */
  precio_delta: Centavos;
  /** Lo que suma (o resta) al costo del platillo. */
  costo_delta: Centavos;
  /** Cuántas veces se puede repetir la misma opción ("doble queso"). */
  max_repeticiones: number;
  disponible: boolean;
  por_defecto: boolean;
  orden: number;
}

export interface GrupoModificadores {
  id: ID;
  nombre: string;
  /** "uno" = excluyente (término); "varios" = acumulable (extras). */
  seleccion: "uno" | "varios";
  /** Mínimo de opciones a elegir. min ≥ 1 vuelve obligatorio el grupo. */
  min: number;
  /** Máximo de opciones. 0 = sin tope. */
  max: number;
  /**
   * Cuántas unidades no se cobran antes de empezar a aplicar el delta de
   * precio ("tres aderezos incluidos"). Se descuentan por orden de selección.
   */
  incluidas_gratis: number;
  /** ¿Aplica a todo el renglón o a una porción concreta (media pizza)? */
  ambito: "renglon" | "porcion";
  opciones: OpcionModificador[];
  orden: number;
}

/** Lo que el usuario eligió. Se congela como snapshot en el renglón. */
export interface SeleccionModificador {
  grupo_id: ID;
  /** Snapshot: el ticket no depende de que el catálogo cambie después. */
  grupo_nombre: string;
  opcion_id: ID;
  opcion_nombre: string;
  precio_delta: Centavos;
  costo_delta: Centavos;
  /** Repeticiones de esta misma opción. */
  cantidad: number;
  /** Ranura afectada, si el grupo es de ámbito "porcion". */
  ranura_id?: ID;
}

// --- Consultas ---------------------------------------------------------------------

export function opcionDe(grupo: GrupoModificadores, opcionId: ID): OpcionModificador | undefined {
  return grupo.opciones.find((o) => o.id === opcionId);
}

/** ¿El producto obliga a configurar algo antes de agregarlo a la cuenta? */
export function requiereConfiguracion(
  grupos: readonly GrupoModificadores[],
  tienePorciones: boolean,
): boolean {
  return tienePorciones || grupos.some((g) => g.min > 0);
}

/** Selección inicial: las opciones marcadas por defecto de cada grupo. */
export function seleccionPorDefecto(
  grupos: readonly GrupoModificadores[],
): SeleccionModificador[] {
  const selecciones: SeleccionModificador[] = [];
  for (const grupo of grupos) {
    for (const opcion of grupo.opciones) {
      if (!opcion.por_defecto || !opcion.disponible) continue;
      selecciones.push({
        grupo_id: grupo.id,
        grupo_nombre: grupo.nombre,
        opcion_id: opcion.id,
        opcion_nombre: opcion.nombre,
        precio_delta: opcion.precio_delta,
        costo_delta: opcion.costo_delta,
        cantidad: 1,
      });
      if (grupo.seleccion === "uno") break;
    }
  }
  return selecciones;
}

// --- Validación ---------------------------------------------------------------------

export type ProblemaSeleccion =
  | { tipo: "min_no_cumplido"; grupo_id: ID; grupo_nombre: string; min: number }
  | { tipo: "max_excedido"; grupo_id: ID; grupo_nombre: string; max: number }
  | { tipo: "opcion_no_disponible"; opcion_id: ID; opcion_nombre: string }
  | { tipo: "repeticiones_excedidas"; opcion_id: ID; opcion_nombre: string; max: number };

/** Unidades elegidas de un grupo (contando repeticiones). */
export function unidadesDe(
  selecciones: readonly SeleccionModificador[],
  grupoId: ID,
): number {
  return selecciones
    .filter((s) => s.grupo_id === grupoId)
    .reduce((total, s) => total + s.cantidad, 0);
}

export function validarSeleccion(
  grupos: readonly GrupoModificadores[],
  selecciones: readonly SeleccionModificador[],
): ProblemaSeleccion[] {
  const problemas: ProblemaSeleccion[] = [];

  for (const grupo of grupos) {
    const unidades = unidadesDe(selecciones, grupo.id);

    if (unidades < grupo.min) {
      problemas.push({
        tipo: "min_no_cumplido",
        grupo_id: grupo.id,
        grupo_nombre: grupo.nombre,
        min: grupo.min,
      });
    }
    if (grupo.max > 0 && unidades > grupo.max) {
      problemas.push({
        tipo: "max_excedido",
        grupo_id: grupo.id,
        grupo_nombre: grupo.nombre,
        max: grupo.max,
      });
    }

    for (const seleccion of selecciones.filter((s) => s.grupo_id === grupo.id)) {
      const opcion = opcionDe(grupo, seleccion.opcion_id);
      if (!opcion || !opcion.disponible) {
        problemas.push({
          tipo: "opcion_no_disponible",
          opcion_id: seleccion.opcion_id,
          opcion_nombre: seleccion.opcion_nombre,
        });
        continue;
      }
      if (seleccion.cantidad > opcion.max_repeticiones) {
        problemas.push({
          tipo: "repeticiones_excedidas",
          opcion_id: opcion.id,
          opcion_nombre: opcion.nombre,
          max: opcion.max_repeticiones,
        });
      }
    }
  }

  return problemas;
}

export function describirProblemaSeleccion(problema: ProblemaSeleccion): string {
  switch (problema.tipo) {
    case "min_no_cumplido":
      return problema.min === 1
        ? `Elige una opción de "${problema.grupo_nombre}"`
        : `Elige al menos ${problema.min} en "${problema.grupo_nombre}"`;
    case "max_excedido":
      return `"${problema.grupo_nombre}" admite como máximo ${problema.max}`;
    case "opcion_no_disponible":
      return `"${problema.opcion_nombre}" ya no está disponible`;
    case "repeticiones_excedidas":
      return `"${problema.opcion_nombre}" no se puede repetir más de ${problema.max} veces`;
  }
}

// --- Precio y costo -------------------------------------------------------------------

/**
 * Precio que suman los modificadores.
 *
 * Las `incluidas_gratis` de cada grupo se descuentan por orden de selección:
 * si un grupo incluye tres aderezos y el comensal elige cinco, se cobran dos.
 */
export function precioModificadores(
  grupos: readonly GrupoModificadores[],
  selecciones: readonly SeleccionModificador[],
): Centavos {
  let total = CERO;

  for (const grupo of grupos) {
    let gratisRestantes = grupo.incluidas_gratis;
    for (const seleccion of selecciones.filter((s) => s.grupo_id === grupo.id)) {
      const gratis = Math.min(gratisRestantes, seleccion.cantidad);
      gratisRestantes -= gratis;
      const cobradas = seleccion.cantidad - gratis;
      total = sumar(total, (seleccion.precio_delta * cobradas) as Centavos);
    }
  }

  // Selecciones de grupos que ya no existen en el catálogo: se respetan tal cual.
  const conocidos = new Set(grupos.map((g) => g.id));
  for (const seleccion of selecciones.filter((s) => !conocidos.has(s.grupo_id))) {
    total = sumar(total, (seleccion.precio_delta * seleccion.cantidad) as Centavos);
  }

  return total;
}

/** Costo que suman los modificadores. El costo no tiene cortesías: siempre cuenta. */
export function costoModificadores(
  selecciones: readonly SeleccionModificador[],
): Centavos {
  return sumar(
    ...selecciones.map((s) => (s.costo_delta * s.cantidad) as Centavos),
  );
}

/** Texto legible de la configuración, para el ticket y la comanda de cocina. */
export function describirSeleccion(selecciones: readonly SeleccionModificador[]): string {
  return selecciones
    .map((s) => (s.cantidad > 1 ? `${s.cantidad}× ${s.opcion_nombre}` : s.opcion_nombre))
    .join(" · ");
}
