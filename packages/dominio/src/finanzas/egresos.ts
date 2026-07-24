/**
 * Egresos y resultado del período.
 *
 * Un restaurantero no necesita un estado de resultados de contador; necesita
 * saber, al cerrar el día, **si ganó dinero**. Eso son dos cifras que ya
 * existen —lo vendido y lo que costó producirlo— menos una que faltaba: lo que
 * salió de la caja para operar.
 *
 * LA TRAMPA QUE ESTE MÓDULO EVITA
 *
 * Restar "compra de insumos" al margen sería contar el costo DOS VECES: el
 * costo de lo que se vendió ya está en `ResumenVentas.costo`, calculado desde
 * las recetas. Comprar cien kilos de queso un martes no es un gasto del martes:
 * es inventario que se vuelve costo conforme se vende.
 *
 * Por eso cada categoría declara si afecta al resultado. Las compras se
 * informan aparte, como salida de efectivo, que es lo que realmente son.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { Rango } from "../inteligencia/reportes.js";

export type CategoriaEgreso =
  | "insumos"
  | "nomina"
  | "servicios"
  | "renta"
  | "mantenimiento"
  | "impuestos"
  | "otros";

export interface DefinicionCategoria {
  id: CategoriaEgreso;
  nombre: string;
  /**
   * ¿Se resta al margen para obtener el resultado?
   *
   * `false` solo para insumos: su costo ya viene del consumo de recetas. Ver la
   * nota de arriba — es el error que más falsea la utilidad de un restaurante.
   */
  afectaResultado: boolean;
  descripcion: string;
}

export const CATEGORIAS_EGRESO: DefinicionCategoria[] = [
  {
    id: "insumos",
    nombre: "Compra de insumos",
    afectaResultado: false,
    descripcion: "Mercancía para el inventario. Se vuelve costo al venderse, no al comprarse.",
  },
  { id: "nomina", nombre: "Nómina y personal", afectaResultado: true, descripcion: "Sueldos, propinas asumidas, finiquitos." },
  { id: "servicios", nombre: "Servicios", afectaResultado: true, descripcion: "Luz, agua, gas, internet, teléfono." },
  { id: "renta", nombre: "Renta", afectaResultado: true, descripcion: "Arrendamiento del local." },
  { id: "mantenimiento", nombre: "Mantenimiento", afectaResultado: true, descripcion: "Reparaciones, equipo, limpieza." },
  { id: "impuestos", nombre: "Impuestos y derechos", afectaResultado: true, descripcion: "Pagos al SAT, licencias, permisos." },
  { id: "otros", nombre: "Otros", afectaResultado: true, descripcion: "Lo que no cabe en las anteriores." },
];

export function categoriaDe(id: CategoriaEgreso): DefinicionCategoria {
  return CATEGORIAS_EGRESO.find((c) => c.id === id) ?? CATEGORIAS_EGRESO[CATEGORIAS_EGRESO.length - 1]!;
}

// --- Eventos ---------------------------------------------------------------------------

export type EventoEgreso =
  | (EventoBase & {
      tipo: "egreso_registrado";
      egreso_id: ID;
      categoria: CategoriaEgreso;
      concepto: string;
      monto: Centavos;
      /** Cómo se pagó: efectivo, transferencia, tarjeta… */
      forma_pago: string;
      proveedor?: string;
      /** RFC y folio del comprobante recibido, si lo hay. */
      rfc_proveedor?: string;
      folio_comprobante?: string;
    })
  | (EventoBase & {
      /**
       * Un egreso capturado por error se ANULA, no se borra.
       *
       * El log es la bitácora: borrar una salida de dinero es exactamente lo
       * que haría alguien encubriendo un faltante. Se anula dejando constancia
       * de quién y por qué.
       */
      tipo: "egreso_anulado";
      egreso_id: ID;
      motivo: string;
      autorizador_id?: ID;
    });

export interface RegistroEgreso {
  egreso_id: ID;
  categoria: CategoriaEgreso;
  concepto: string;
  monto: Centavos;
  forma_pago: string;
  proveedor?: string;
  rfc_proveedor?: string;
  folio_comprobante?: string;
  empleado_id: ID;
  ts: number;
  anulado: boolean;
  motivo_anulacion?: string;
}

export function aplicarEventoEgreso(
  registros: readonly RegistroEgreso[],
  ev: EventoEgreso,
): RegistroEgreso[] {
  switch (ev.tipo) {
    case "egreso_registrado": {
      // Idempotente por id: reaplicar el mismo evento no duplica la salida.
      if (registros.some((r) => r.egreso_id === ev.egreso_id)) return [...registros];
      return [
        ...registros,
        {
          egreso_id: ev.egreso_id,
          categoria: ev.categoria,
          concepto: ev.concepto,
          monto: ev.monto,
          forma_pago: ev.forma_pago,
          proveedor: ev.proveedor,
          rfc_proveedor: ev.rfc_proveedor,
          folio_comprobante: ev.folio_comprobante,
          empleado_id: ev.empleado_id,
          ts: ev.ts,
          anulado: false,
        },
      ];
    }

    case "egreso_anulado":
      return registros.map((r) =>
        r.egreso_id === ev.egreso_id
          ? { ...r, anulado: true, motivo_anulacion: ev.motivo }
          : r,
      );

    default: {
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

export function proyectarEgresos(eventos: readonly EventoEgreso[]): RegistroEgreso[] {
  let registros: RegistroEgreso[] = [];
  for (const ev of eventos) registros = aplicarEventoEgreso(registros, ev);
  return registros;
}

/** Los egresos vigentes de un período. Los anulados no cuentan. */
export function egresosEn(
  registros: readonly RegistroEgreso[],
  rango: Rango,
): RegistroEgreso[] {
  return registros
    .filter((r) => !r.anulado && r.ts >= rango.desde && r.ts < rango.hasta)
    .sort((a, b) => a.ts - b.ts);
}

// --- El resultado ------------------------------------------------------------------------

export interface TotalCategoria {
  categoria: CategoriaEgreso;
  nombre: string;
  monto: Centavos;
  afectaResultado: boolean;
}

export interface ResultadoPeriodo {
  /** Venta sin IVA: el IVA se cobra para el SAT, no es ingreso del negocio. */
  ingreso: Centavos;
  /** Costo de lo vendido, desde las recetas. */
  costo: Centavos;
  /** Ingreso − costo. Lo que deja la operación antes de gastos. */
  margen_bruto: Centavos;
  /** Gastos que sí se restan (nómina, renta, servicios…). */
  egresos_operativos: Centavos;
  /** Margen bruto − egresos operativos. La cifra que importa. */
  resultado: Centavos;
  /**
   * Compras de insumos del período. NO se restan —su costo llega por el consumo
   * de recetas— pero sí salieron de la caja, y hay que verlas.
   */
  compras: Centavos;
  /** Salida real de efectivo: todo lo que se pagó, compras incluidas. */
  salida_total: Centavos;
  por_categoria: TotalCategoria[];
  /** Costo sobre ingreso, como fracción. 0.31 = 31 %. */
  food_cost: number;
}

/**
 * Calcula el resultado del período.
 *
 * Recibe las ventas YA resumidas (`resumenVentas`) y los egresos vigentes del
 * mismo rango. No recalcula ventas: si el resultado y el corte de caja
 * discreparan, sería imposible saber cuál miente.
 */
export function calcularResultado(
  ventas: { subtotal: Centavos; costo: Centavos },
  egresos: readonly RegistroEgreso[],
): ResultadoPeriodo {
  const por_categoria: TotalCategoria[] = CATEGORIAS_EGRESO.map((def) => ({
    categoria: def.id,
    nombre: def.nombre,
    afectaResultado: def.afectaResultado,
    monto: sumar(
      ...egresos.filter((e) => e.categoria === def.id).map((e) => e.monto),
    ),
  })).filter((t) => t.monto > 0);

  const egresos_operativos = sumar(
    ...por_categoria.filter((t) => t.afectaResultado).map((t) => t.monto),
  );
  const compras = sumar(
    ...por_categoria.filter((t) => !t.afectaResultado).map((t) => t.monto),
  );

  const margen_bruto = restar(ventas.subtotal, ventas.costo);
  const resultado = restar(margen_bruto, egresos_operativos);
  const salida_total = sumar(egresos_operativos, compras);

  return {
    ingreso: ventas.subtotal,
    costo: ventas.costo,
    margen_bruto,
    egresos_operativos,
    resultado,
    compras,
    salida_total,
    por_categoria,
    food_cost: ventas.subtotal > 0 ? ventas.costo / ventas.subtotal : 0,
  };
}

/** Resultado vacío, para cuando no hubo ni ventas ni egresos. */
export function resultadoVacio(): ResultadoPeriodo {
  return {
    ingreso: CERO,
    costo: CERO,
    margen_bruto: CERO,
    egresos_operativos: CERO,
    resultado: CERO,
    compras: CERO,
    salida_total: CERO,
    por_categoria: [],
    food_cost: 0,
  };
}
