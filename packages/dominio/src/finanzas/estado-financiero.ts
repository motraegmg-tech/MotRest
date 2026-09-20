/**
 * El estado financiero del mes: un solo documento con todo el dinero.
 *
 * ## Qué pidió Gonzalo
 *
 * «Que den un estado financiero de lo que fue el mes seleccionado, que diga
 * gastos desglosados, ingresos, y todo tipo de movimiento económico que hubo
 * durante el mes.» Esto es esa estructura; el PDF solo la dibuja.
 *
 * ## Las tres preguntas que responde, en este orden
 *
 * 1. **¿Cuánto entró?** La venta del mes, con IVA y sin él, y por dónde se
 *    cobró.
 * 2. **¿Cuánto salió y en qué?** Los gastos categoría por categoría, y dentro
 *    de cada una, renglón por renglón.
 * 3. **¿Ganamos, y cuánto dinero quedó?** Son dos preguntas distintas y por eso
 *    van en dos bloques distintos —ver abajo—.
 *
 * ## Por qué el resultado y el dinero NO son el mismo número
 *
 * Es la confusión que más dinero le cuesta a un restaurante, y el informe la
 * separa a propósito:
 *
 * - El **resultado** dice si el negocio gana. La compra de cien kilos de queso
 *   no lo empeora: ese queso es inventario, y se vuelve costo conforme se vende.
 * - El **flujo** dice cuánto dinero queda. Esa misma compra sí lo baja: los
 *   pesos salieron de la caja el martes.
 *
 * Un mes puede cerrar con utilidad y con menos dinero que al empezar (se
 * surtió la despensa), o al revés (se cobró de un mes anterior). Enseñar un
 * solo número obligaría a elegir cuál de las dos verdades ocultar.
 *
 * ## Y por qué el resultado trae DOS utilidades
 *
 * Desde sep-2026 el bloque del resultado enseña la **utilidad contable** (los
 * insumos pesan al venderse) y la **utilidad en efectivo** (pesan al comprarse).
 * Las dos salen de `calcularResultado`, la misma función del resultado del día,
 * así que el mes y el día nunca pueden decir cosas distintas. Ver `egresos.ts`.
 */
import { sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import type { RegistroCfdi } from "../fiscal/eventos.js";
import type { FacturaGlobalRegistrada } from "../fiscal/global.js";
import type { EstadoCaja } from "../caja/reducers.js";
import { cuentasCerradasEn, resumenVentas } from "../inteligencia/reportes.js";
import { reporteContable, type ReporteContable } from "./contador.js";
import {
  CATEGORIAS_EGRESO,
  categoriaDe,
  cuentasPorPagar,
  egresosEn,
  totalPorPagar,
  type CategoriaEgreso,
  type RegistroEgreso,
} from "./egresos.js";
import { calcularResultado, type ResultadoPeriodo } from "./egresos.js";
import { resumenDeFlujo, type ArrastreDePurga, type ResumenFlujo } from "./flujo.js";
import type { EventoTesoreria } from "./tesoreria.js";

/** Un gasto concreto, tal como se lista debajo de su categoría. */
export interface GastoDetallado {
  ts: number;
  concepto: string;
  proveedor?: string;
  forma_pago: string;
  monto: Centavos;
  /** false = se registró en el mes pero todavía se debe. */
  pagado: boolean;
  folio_comprobante?: string;
}

/** Una categoría de gasto con sus renglones dentro. */
export interface BloqueGastos {
  categoria: CategoriaEgreso;
  nombre: string;
  total: Centavos;
  /**
   * ¿Se resta al resultado?
   *
   * Solo las compras de insumos dicen que no, y el informe lo escribe en el
   * papel: un lector que vea «compras 48 000» restadas de la utilidad y luego
   * no cuadre el total pensará que el sistema se equivocó.
   */
  afectaResultado: boolean;
  renglones: GastoDetallado[];
}

export interface EstadoFinanciero {
  desde: number;
  hasta: number;
  /** Nombre del local, para el encabezado del papel. */
  local: string;
  emitido_ts: number;

  /** Lo vendido y cómo se cobró. Ya lo calculaba el reporte del contador. */
  ventas: ReporteContable;

  /** Los gastos del mes, agrupados y detallados. */
  gastos: BloqueGastos[];
  total_gastos: Centavos;

  /**
   * Las dos utilidades del mes: la contable (`resultado.resultado`) y la de
   * efectivo (`resultado.utilidad_efectivo`).
   */
  resultado: ResultadoPeriodo;

  /** Cuánto dinero entró y salió, y con cuánto se cerró el mes. */
  flujo: ResumenFlujo;

  /** Lo que se debía al cerrar el mes. */
  por_pagar: Centavos;
  documentos_por_pagar: number;

  /**
   * Hasta qué fecha se retiró historial de esta computadora, si se retiró.
   *
   * La retención borra del disco las cuentas más viejas que el plazo elegido.
   * Un informe de un mes ya retirado saldría con CERO ventas —no porque no se
   * vendiera, sino porque el detalle ya no está— y eso es un documento que
   * alguien podría entregarle a su contador.
   *
   * 0 = no se ha retirado nada y el informe está completo.
   */
  historial_retirado_hasta: number;

  /**
   * true = el período pedido cae, entero o en parte, en lo ya retirado.
   *
   * Cuando es true el papel lo dice en su cabecera. Un informe incompleto que
   * no se anuncia como incompleto es peor que no tener informe.
   */
  periodo_incompleto: boolean;

  /** Los cortes de caja del mes y sus diferencias. */
  cortes: {
    turnos: number;
    turnos_abiertos: number;
    declarado: Centavos;
    esperado: Centavos;
    diferencia: Centavos;
  };
}

export interface FuentesEstadoFinanciero {
  local: string;
  comandas: readonly EstadoComanda[];
  egresos: readonly RegistroEgreso[];
  cfdis: readonly RegistroCfdi[];
  /**
   * Las facturas globales del registro (`facturasGlobales`). Sin ellas, lo que
   * ya entró en una global aparecería como «venta sin facturar». Opcional para
   * no romper a quien todavía no las pasa.
   */
  globales?: readonly FacturaGlobalRegistrada[];
  sesiones: readonly EstadoCaja[];
  tesoreria: readonly EventoTesoreria[];
  /**
   * Lo que aportaba el historial ya retirado de esta computadora.
   *
   * Va aquí y no solo como fecha porque el informe lo necesita para DOS cosas
   * distintas: avisar de que al período le faltan cuentas, y que el «dinero al
   * cierre» del papel no se desplome por haber borrado las ventas viejas.
   */
  arrastre?: ArrastreDePurga;
}

/**
 * ¿Qué turnos pertenecen al mes?
 *
 * Por la APERTURA, igual que en el corte por fechas: un turno que abre el 31 a
 * las 20:00 y cierra el 1 a las 2:00 es del 31. Cambiar el criterio entre dos
 * pantallas que enseñan lo mismo es la forma más segura de que nadie confíe en
 * ninguna de las dos.
 */
function turnosDelPeriodo(
  sesiones: readonly EstadoCaja[],
  desde: number,
  hasta: number,
): EstadoCaja[] {
  return sesiones.filter((s) => s.abierta_ts >= desde && s.abierta_ts < hasta);
}

/**
 * El resultado de un período —las dos utilidades— desde los hechos crudos.
 *
 * Existe aparte para que la pantalla del mes y el PDF usen ESTA función y no
 * una copia: si el informe y la pantalla armaran la cuenta cada uno a su modo,
 * el día que discreparan no habría forma de saber cuál miente. Es la misma
 * composición que el resultado del día —cuentas cerradas del rango, resumidas
 * por `resumenVentas`, contra los gastos incurridos en el rango—, así que día,
 * mes y papel dan la misma cifra con los mismos hechos.
 *
 * No necesita migración: los gastos capturados antes de que existiera la
 * utilidad en efectivo entran solos, porque la cifra se deriva al leer.
 */
export function resultadoDelPeriodo(
  comandas: readonly EstadoComanda[],
  egresos: readonly RegistroEgreso[],
  rango: { desde: number; hasta: number },
): ResultadoPeriodo {
  return calcularResultado(
    resumenVentas(cuentasCerradasEn(comandas, rango)),
    egresosEn(egresos, rango),
  );
}

export function armarEstadoFinanciero(
  fuentes: FuentesEstadoFinanciero,
  rango: { desde: number; hasta: number },
  ahora: number = Date.now(),
): EstadoFinanciero {
  const cerradas = cuentasCerradasEn(fuentes.comandas, rango);
  const delMes = egresosEn(fuentes.egresos, rango);

  const ventas = reporteContable(cerradas, fuentes.cfdis, delMes, rango, fuentes.globales ?? []);

  const gastos: BloqueGastos[] = CATEGORIAS_EGRESO.map((def) => {
    const suyos = delMes.filter((e) => e.categoria === def.id);
    return {
      categoria: def.id,
      nombre: def.nombre,
      afectaResultado: def.afectaResultado,
      total: sumar(...suyos.map((e) => e.monto)),
      renglones: suyos.map((e) => ({
        ts: e.ts,
        concepto: e.concepto,
        proveedor: e.proveedor,
        forma_pago: e.forma_pago,
        monto: e.monto,
        pagado: e.pagado,
        folio_comprobante: e.folio_comprobante,
      })),
    };
  }).filter((b) => b.renglones.length > 0);

  /*
   * El costo sale de `resumenVentas`, la MISMA función que usa la pantalla del
   * resultado diario. Recalcularlo aquí con otra aritmética garantizaría que
   * algún día el informe del mes y la pantalla del día dijeran cosas distintas,
   * sin forma de saber cuál miente. Por eso pasa por `resultadoDelPeriodo`, que
   * es también lo que enseña la pantalla del mes.
   */
  const resultado = resultadoDelPeriodo(fuentes.comandas, fuentes.egresos, rango);

  const flujo = resumenDeFlujo(
    {
      comandas: fuentes.comandas,
      egresos: fuentes.egresos,
      sesiones: fuentes.sesiones,
      tesoreria: fuentes.tesoreria,
      arrastre: fuentes.arrastre,
    },
    rango,
  );

  const turnos = turnosDelPeriodo(fuentes.sesiones, rango.desde, rango.hasta);
  const cerrados = turnos.filter((t) => t.cerrada);

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    local: fuentes.local,
    emitido_ts: ahora,
    ventas,
    gastos,
    total_gastos: sumar(...gastos.map((g) => g.total)),
    resultado,
    flujo,
    historial_retirado_hasta: fuentes.arrastre?.hasta ?? 0,
    /*
     * Basta con que el período EMPIECE antes de lo retirado: a partir de ahí
     * le faltan cuentas, aunque el resto del mes esté completo.
     */
    periodo_incompleto:
      (fuentes.arrastre?.hasta ?? 0) > 0 && rango.desde <= (fuentes.arrastre?.hasta ?? 0),
    por_pagar: totalPorPagar(fuentes.egresos),
    documentos_por_pagar: cuentasPorPagar(fuentes.egresos).length,
    cortes: {
      turnos: turnos.length,
      turnos_abiertos: turnos.length - cerrados.length,
      declarado: sumar(...cerrados.map((t) => t.declarado ?? (0 as Centavos))),
      esperado: sumar(...cerrados.map((t) => t.resumen?.efectivo_esperado ?? (0 as Centavos))),
      diferencia: sumar(...cerrados.map((t) => t.diferencia ?? (0 as Centavos))),
    },
  };
}

/** Los gastos de un proveedor concreto dentro del estado, para la vista de deuda. */
export function gastosDeProveedor(
  estado: EstadoFinanciero,
  proveedor: string,
): GastoDetallado[] {
  const buscado = proveedor.trim().toLowerCase();
  return estado.gastos
    .flatMap((b) => b.renglones)
    .filter((r) => (r.proveedor ?? "").trim().toLowerCase() === buscado);
}

/** El nombre legible de una categoría, para quien solo tenga el id. */
export function nombreCategoriaGasto(id: CategoriaEgreso): string {
  return categoriaDe(id).nombre;
}

/** Identificador corto y estable del informe, para nombrar el archivo. */
export function folioDelEstado(estado: EstadoFinanciero, sucursal?: ID): string {
  const d = new Date(estado.desde);
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return sucursal ? `${mes}-${sucursal.slice(0, 6)}` : mes;
}
