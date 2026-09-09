/**
 * Presupuesto mensual por categoría de gasto.
 *
 * ## Para qué sirve de verdad
 *
 * Un restaurante no se descapitaliza de golpe: se descapitaliza porque la luz
 * subió mil pesos, el mantenimiento otros dos mil y nadie lo notó hasta que no
 * alcanzó para la nómina. El gasto ya se registraba; lo que faltaba era el
 * techo contra el que compararlo.
 *
 * ## Por qué avisa ANTES de pasarse
 *
 * Enterarse el día 31 de que se rebasó el presupuesto no sirve de nada: el
 * dinero ya se fue. El aviso salta al 80 %, que es cuando todavía se puede
 * decidir si el pedido de esta semana espera. Ese umbral está aquí y no
 * repartido por las pantallas, para que las tres que lo consultan digan lo
 * mismo.
 *
 * ## Lo que NO hace
 *
 * No bloquea nada. Un presupuesto que impidiera registrar el gasto tendría un
 * único efecto: que el gasto se dejara de registrar. El aviso informa; la
 * decisión sigue siendo de quien manda.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import { CATEGORIAS_EGRESO, categoriaDe, type CategoriaEgreso, type RegistroEgreso } from "./egresos.js";

/** A partir de aquí se avisa, con margen para reaccionar. */
export const UMBRAL_AVISO = 0.8;

/** El techo de una categoría. Ausente = esa categoría no se vigila. */
export type Presupuestos = Partial<Record<CategoriaEgreso, Centavos>>;

export type EstadoPresupuesto = "sin_techo" | "holgado" | "cerca" | "excedido";

export interface SeguimientoCategoria {
  categoria: CategoriaEgreso;
  nombre: string;
  /** Lo presupuestado para el mes. CERO si no se fijó techo. */
  techo: Centavos;
  gastado: Centavos;
  /** Techo − gastado. Negativo = ya se pasó. */
  disponible: Centavos;
  /** Fracción consumida: 0.83 = 83 %. Sin techo, 0. */
  consumido: number;
  estado: EstadoPresupuesto;
}

export interface SeguimientoPresupuesto {
  desde: number;
  hasta: number;
  categorias: SeguimientoCategoria[];
  techo_total: Centavos;
  gastado_total: Centavos;
  /** Las que ya se pasaron o están por pasarse. Es lo que se enseña arriba. */
  alertas: SeguimientoCategoria[];
}

function estadoDe(techo: Centavos, gastado: Centavos): EstadoPresupuesto {
  if (techo <= 0) return "sin_techo";
  if (gastado > techo) return "excedido";
  return gastado / techo >= UMBRAL_AVISO ? "cerca" : "holgado";
}

/**
 * Compara lo gastado del período contra los techos.
 *
 * Los egresos llegan ya filtrados al mes (`egresosEn`): esta función no decide
 * qué gasto cuenta, igual que el resto del módulo de finanzas.
 *
 * Se mide contra la fecha en que se INCURRIÓ el gasto, no en la que se pagó: el
 * presupuesto de mantenimiento de agosto lo consume la reparación de agosto
 * aunque el proveedor cobre en septiembre.
 */
export function seguirPresupuesto(
  presupuestos: Presupuestos,
  egresosDelMes: readonly RegistroEgreso[],
  rango: { desde: number; hasta: number },
): SeguimientoPresupuesto {
  const categorias: SeguimientoCategoria[] = CATEGORIAS_EGRESO.map((def) => {
    const techo = presupuestos[def.id] ?? CERO;
    const gastado = sumar(
      ...egresosDelMes.filter((e) => e.categoria === def.id).map((e) => e.monto),
    );
    return {
      categoria: def.id,
      nombre: def.nombre,
      techo,
      gastado,
      disponible: (techo - gastado) as Centavos,
      consumido: techo > 0 ? gastado / techo : 0,
      estado: estadoDe(techo, gastado),
    };
  })
    // Se esconde solo lo que no tiene ni techo ni gasto: un renglón vacío por
    // categoría llenaría la pantalla de ceros que no dicen nada.
    .filter((c) => c.techo > 0 || c.gastado > 0);

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    categorias,
    techo_total: sumar(...categorias.map((c) => c.techo)),
    gastado_total: sumar(...categorias.map((c) => c.gastado)),
    alertas: categorias
      .filter((c) => c.estado === "cerca" || c.estado === "excedido")
      // Lo más pasado, primero.
      .sort((a, b) => b.consumido - a.consumido),
  };
}

/**
 * Qué decir en pantalla sobre una categoría vigilada.
 *
 * El texto vive aquí porque las tres pantallas que avisan —el resultado, el
 * registro del gasto y el informe del mes— tienen que decir lo mismo. Que una
 * diga «te pasaste» y otra «vas bien» sobre la misma cifra destruye la
 * confianza en las dos.
 */
export function avisoDe(seguimiento: SeguimientoCategoria): string {
  const nombre = categoriaDe(seguimiento.categoria).nombre;
  const porcentaje = Math.round(seguimiento.consumido * 100);

  switch (seguimiento.estado) {
    case "excedido":
      return `${nombre}: te pasaste del presupuesto del mes (${porcentaje} %).`;
    case "cerca":
      return `${nombre}: llevas el ${porcentaje} % del presupuesto del mes.`;
    default:
      return "";
  }
}
