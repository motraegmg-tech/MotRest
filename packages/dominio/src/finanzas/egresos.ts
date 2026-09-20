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
 *
 * LAS DOS UTILIDADES (sep-2026)
 *
 * Gonzalo pidió que la compra de insumos se restara de la utilidad. Restarla a
 * la de arriba era el doble conteo de siempre, así que se enseñan DOS cifras, con
 * nombre fijo en todas partes:
 *
 * - **Utilidad contable** (`resultado`): venta − costo de lo vendido − gastos de
 *   operación. Los insumos pesan cuando se VENDEN. Es la que sirve para fijar
 *   precios, y no cambió.
 * - **Utilidad en efectivo** (`utilidad_efectivo`): venta − todo lo que salió,
 *   compras incluidas. Los insumos pesan cuando se COMPRAN, y por eso no resta
 *   el costo de lo vendido.
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

// --- La compra que carga el almacén -----------------------------------------------

/**
 * Un renglón de mercancía dentro de un gasto.
 *
 * Existe para que registrar la compra del queso sea UN solo acto: sale el
 * dinero y entra el producto al almacén. Antes eran dos capturas en dos
 * pantallas distintas, y la segunda se olvidaba — por eso el inventario decía
 * una cosa y la despensa otra.
 *
 * La cantidad va en la UNIDAD BASE del insumo. La conversión (una caja de 5 kg
 * son 5 000 g) se hace al capturar, donde se sabe qué se compró; guardar aquí
 * «1 caja» dejaría al almacén sin forma de saber cuánto entró.
 */
export interface LineaEgresoInsumo {
  insumo_id: ID;
  /** En la unidad base del insumo. */
  cantidad: number;
  /** Lo que costó ESTE renglón, completo. No es el costo unitario. */
  importe: Centavos;
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
      /**
       * ¿Salió el dinero ya?
       *
       * `false` = se recibió a crédito y queda como cuenta por pagar: el gasto
       * existe desde hoy, pero el dinero sale el día que se liquide. Es como
       * opera un restaurante con sus proveedores, y confundir las dos fechas es
       * lo que hace que el saldo esté mal toda la semana.
       *
       * Ausente = pagado. Es lo que valían todos los eventos anteriores a esta
       * versión, y reinterpretarlos como deuda inventaría pasivos que nadie
       * debe.
       */
      pagado?: boolean;
      /** Cuándo se compromete el pago, en los gastos a crédito. */
      vence_ts?: number;
      /** El proveedor del catálogo de compras, cuando la compra viene de ahí. */
      proveedor_id?: ID;
      /** La orden de compra que lo originó, para poder rastrearlo. */
      orden_id?: ID;
      /**
       * Mercancía que entra al almacén con esta compra.
       *
       * Solo la llevan los gastos de categoría `insumos`. El movimiento de
       * inventario lo emite quien captura, no este evento: el almacén es dueño
       * de sus existencias y no se le escriben desde fuera.
       */
      lineas?: LineaEgresoInsumo[];
    })
  | (EventoBase & {
      /**
       * Se liquida un gasto que estaba a crédito.
       *
       * Es el momento en que el dinero SALE de verdad. El gasto ya existía
       * desde que se recibió la mercancía; esto no lo vuelve a contar, solo
       * dice cuándo y con qué se pagó.
       */
      tipo: "egreso_pagado";
      egreso_id: ID;
      forma_pago: string;
      /** Folio de la transferencia o del cheque. */
      referencia?: string;
      autorizador_id?: ID;
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
  /** Con qué se pagó, o con qué se pagará si todavía es deuda. */
  forma_pago: string;
  proveedor?: string;
  rfc_proveedor?: string;
  folio_comprobante?: string;
  empleado_id: ID;
  ts: number;
  anulado: boolean;
  motivo_anulacion?: string;

  /** false = todavía se debe. */
  pagado: boolean;
  /** Cuándo salió el dinero. Igual a `ts` cuando se pagó de contado. */
  pagado_ts?: number;
  /** Fecha comprometida de pago, en los que están a crédito. */
  vence_ts?: number;
  referencia_pago?: string;
  proveedor_id?: ID;
  orden_id?: ID;
  lineas?: LineaEgresoInsumo[];
}

export function aplicarEventoEgreso(
  registros: readonly RegistroEgreso[],
  ev: EventoEgreso,
): RegistroEgreso[] {
  switch (ev.tipo) {
    case "egreso_registrado": {
      // Idempotente por id: reaplicar el mismo evento no duplica la salida.
      if (registros.some((r) => r.egreso_id === ev.egreso_id)) return [...registros];
      /*
       * Sin la bandera, PAGADO. Los eventos escritos antes de que existieran
       * las cuentas por pagar registraban gastos ya liquidados; leerlos como
       * deuda le inventaría al restaurante pasivos que nunca tuvo.
       */
      const pagado = ev.pagado !== false;
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
          pagado,
          pagado_ts: pagado ? ev.ts : undefined,
          vence_ts: ev.vence_ts,
          proveedor_id: ev.proveedor_id,
          orden_id: ev.orden_id,
          lineas: ev.lineas,
        },
      ];
    }

    case "egreso_pagado":
      return registros.map((r) =>
        /*
         * Solo liquida lo que sigue debiéndose. Reaplicar el evento —una
         * resincronización— no puede mover la fecha de pago ya asentada, que
         * es la que decide en qué día salió el dinero.
         */
        r.egreso_id === ev.egreso_id && !r.pagado
          ? {
              ...r,
              pagado: true,
              pagado_ts: ev.ts,
              forma_pago: ev.forma_pago,
              referencia_pago: ev.referencia,
            }
          : r,
      );

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

/**
 * Los egresos vigentes de un período, por la fecha en que SE INCURRIERON.
 *
 * Es la lectura del resultado: el gas de agosto es gasto de agosto aunque se
 * pague en septiembre. Para saber qué día salió el dinero está
 * `egresosPagadosEn`, que mira la otra fecha.
 */
export function egresosEn(
  registros: readonly RegistroEgreso[],
  rango: Rango,
): RegistroEgreso[] {
  return registros
    .filter((r) => !r.anulado && r.ts >= rango.desde && r.ts < rango.hasta)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Los egresos cuyo DINERO salió en el período.
 *
 * La distinción no es contable-por-contable: es la diferencia entre «cuánto
 * gasté este mes» y «cuánto dinero me queda». Un restaurante que compra a
 * crédito tiene las dos cifras muy separadas, y mezclarlas es lo que hace que
 * el saldo nunca cuadre con el cajón.
 */
export function egresosPagadosEn(
  registros: readonly RegistroEgreso[],
  rango: Rango,
): RegistroEgreso[] {
  return registros
    .filter(
      (r) =>
        !r.anulado &&
        r.pagado &&
        r.pagado_ts !== undefined &&
        r.pagado_ts >= rango.desde &&
        r.pagado_ts < rango.hasta,
    )
    .sort((a, b) => (a.pagado_ts ?? 0) - (b.pagado_ts ?? 0));
}

/** Lo que se debe: gastos vigentes que todavía no se han pagado. */
export function cuentasPorPagar(registros: readonly RegistroEgreso[]): RegistroEgreso[] {
  return registros
    .filter((r) => !r.anulado && !r.pagado)
    // Primero lo que vence antes; lo que no tiene fecha, al final.
    .sort((a, b) => (a.vence_ts ?? Infinity) - (b.vence_ts ?? Infinity));
}

/** El total adeudado a proveedores. */
export function totalPorPagar(registros: readonly RegistroEgreso[]): Centavos {
  return sumar(...cuentasPorPagar(registros).map((r) => r.monto));
}

/** Deuda cuya fecha comprometida ya pasó. Es la que hay que enseñar en rojo. */
export function vencidas(registros: readonly RegistroEgreso[], ahora: number): RegistroEgreso[] {
  return cuentasPorPagar(registros).filter((r) => r.vence_ts !== undefined && r.vence_ts < ahora);
}

/** Lo que se le debe a cada proveedor, de mayor a menor. */
export interface DeudaProveedor {
  proveedor: string;
  proveedor_id?: ID;
  monto: Centavos;
  documentos: number;
  /** El vencimiento más próximo de los pendientes. */
  vence_ts?: number;
}

export function deudaPorProveedor(registros: readonly RegistroEgreso[]): DeudaProveedor[] {
  const porNombre = new Map<string, DeudaProveedor>();

  for (const r of cuentasPorPagar(registros)) {
    const proveedor = r.proveedor?.trim() || "Sin proveedor";
    const previa = porNombre.get(proveedor);
    if (previa) {
      previa.monto = sumar(previa.monto, r.monto);
      previa.documentos += 1;
      if (r.vence_ts !== undefined && (previa.vence_ts === undefined || r.vence_ts < previa.vence_ts)) {
        previa.vence_ts = r.vence_ts;
      }
    } else {
      porNombre.set(proveedor, {
        proveedor,
        proveedor_id: r.proveedor_id,
        monto: r.monto,
        documentos: 1,
        vence_ts: r.vence_ts,
      });
    }
  }

  return [...porNombre.values()].sort((a, b) => b.monto - a.monto);
}

// --- El resultado ------------------------------------------------------------------------

/**
 * Los nombres de las dos utilidades, escritos UNA sola vez.
 *
 * Salen iguales en el resultado del día, en el del mes y en el PDF del estado
 * financiero. Si cada pantalla los tecleara por su cuenta, tarde o temprano una
 * diría «resultado», otra «ganancia» y el papel «utilidad», y el dueño
 * preguntaría —con razón— si son tres números distintos.
 */
export const UTILIDAD_CONTABLE = "Utilidad contable";
export const UTILIDAD_EN_EFECTIVO = "Utilidad en efectivo";

/**
 * En qué se diferencian, dicho como lo diría un restaurantero.
 *
 * Va junto a las dos cifras en todas partes. Sin esta línea, quien vea dos
 * utilidades distintas del mismo día concluirá que una está mal.
 */
export const DIFERENCIA_ENTRE_UTILIDADES =
  "La contable resta los insumos cuando se venden en los platillos; la de efectivo, " +
  "el día que se compran. Por eso un día de surtido baja la de efectivo y no la " +
  "contable. Para decidir precios, mire la contable.";

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
  /**
   * La UTILIDAD CONTABLE: margen bruto − egresos operativos.
   *
   * Conserva el nombre de campo de siempre porque la leen la pantalla del día,
   * el estado financiero y sus pruebas; lo que cambió es cómo se rotula, que es
   * `UTILIDAD_CONTABLE` en todas partes.
   */
  resultado: Centavos;
  /**
   * Compras de insumos del período. NO se restan a la utilidad contable —su
   * costo llega por el consumo de recetas— pero sí salieron de la caja, y hay
   * que verlas.
   */
  compras: Centavos;
  /** Todo lo gastado en el período, compras incluidas: operativos + compras. */
  salida_total: Centavos;
  /**
   * La UTILIDAD EN EFECTIVO: venta sin IVA − todo lo que salió (`salida_total`).
   *
   * NO resta el costo de lo vendido: aquí los insumos pesan el día que se
   * compran, y restar también su consumo sería contarlos dos veces. Ver el
   * cálculo en `calcularResultado`.
   */
  utilidad_efectivo: Centavos;
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

  /*
   * LA UTILIDAD EN EFECTIVO: lo que entró menos TODO lo que salió.
   *
   * Es la segunda utilidad que pidió Gonzalo: la compra de insumos resta aquí,
   * el día que se compra. Por eso NO se resta el costo de lo vendido — ese es
   * el mismo queso visto el día que se vende, y restar las dos cosas es el
   * doble conteo que este módulo existe para evitar. Queda, al centavo:
   *
   *   contable − efectivo = compras de insumos − costo de lo vendido
   *
   * SIN IVA, igual que la contable. Se pensó en usar la venta cobrada con IVA
   * —la que suma `flujo.entradas` en el estado financiero— y se descartó por
   * tres razones:
   *
   * 1. El IVA cobrado no es del restaurante: se entrega al SAT el mes
   *    siguiente. Enseñarlo como utilidad invita a gastárselo, y el día 17 no
   *    hay con qué pagar.
   * 2. Partiendo de la misma venta, lo ÚNICO que separa las dos utilidades es
   *    cuándo pesan los insumos, y la diferencia se explica con una línea. Con
   *    IVA se mezclaría con el 16 % y nadie podría explicarla.
   * 3. La lectura con IVA ya existe y es otra pregunta: el movimiento del
   *    dinero (`flujo`), que además suma propinas y traspasos y respeta el día
   *    en que se paga lo comprado a crédito. Una tercera cifra «casi igual al
   *    flujo, pero no» confundiría más que ayudar.
   *
   * Los gastos son los mismos que los de la contable, por la fecha en que se
   * incurrieron: una compra a crédito pesa el día que llega la mercancía,
   * igual que en «Salió de la caja hoy». El día exacto en que sale el dinero lo
   * cuenta el flujo, no esta cifra.
   */
  const utilidad_efectivo = restar(ventas.subtotal, salida_total);

  return {
    ingreso: ventas.subtotal,
    costo: ventas.costo,
    margen_bruto,
    egresos_operativos,
    resultado,
    compras,
    salida_total,
    utilidad_efectivo,
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
    utilidad_efectivo: CERO,
    por_categoria: [],
    food_cost: 0,
  };
}
