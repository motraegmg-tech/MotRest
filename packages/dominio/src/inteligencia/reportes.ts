/**
 * M8 · Reportes de negocio, derivados del event log.
 *
 * Nada de esto se calcula al vender ni se guarda en ninguna tabla: se PROYECTA
 * de los mismos eventos que ya se escriben. Esa es la ventaja del event
 * sourcing — un reporte nuevo no exige migrar datos, solo leer distinto lo que
 * ya está guardado (ADR-02).
 *
 * Es también la materia prima de las capacidades AI-first de F3: el gemelo
 * digital y el menu engineering con IA se alimentan de estas mismas series.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import type { ID } from "../comun/ids.js";
import { renglonesActivos, type EstadoComanda } from "../comanda/reducers.js";
import { costoRenglon, importeRenglon } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";

/** Ventana de tiempo del reporte, en epoch ms del reloj del dispositivo. */
export interface Rango {
  desde: number;
  hasta: number;
}

/**
 * A qué hora empieza contablemente el día en un restaurante.
 *
 * Las 5 de la mañana, no la medianoche. Un viernes de servicio termina a la una
 * o las dos de la madrugada, y esas ventas son **del viernes** para quien las
 * hizo: cortar a medianoche las manda al sábado, hace que el viernes parezca
 * flojo y que el sábado tenga un pico fantasma de madrugada. Con un corte a las
 * 5 el día operativo coincide con la jornada real, porque a esa hora ya no hay
 * un restaurante abierto que confundir.
 */
export const HORA_CORTE_POR_DEFECTO = 5;

/**
 * La JORNADA que contiene un instante: de la hora de corte a la del día
 * siguiente.
 *
 * Es lo que hay que usar para "hoy" en todo lo que mire la operación. `diaDe`
 * sigue existiendo para lo que de verdad es un día natural.
 */
export function jornadaDe(ts: number, horaCorte = HORA_CORTE_POR_DEFECTO): Rango {
  const inicio = new Date(ts);
  // Antes de la hora de corte todavía se está en la jornada que abrió ayer.
  if (inicio.getHours() < horaCorte) inicio.setDate(inicio.getDate() - 1);
  inicio.setHours(horaCorte, 0, 0, 0);

  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);
  return { desde: inicio.getTime(), hasta: fin.getTime() };
}

/**
 * El instante en que abrió la jornada a la que pertenece `ts`.
 *
 * Sirve para AGRUPAR: dos ventas de la misma noche —una a las 23:40 y otra a
 * las 00:20— devuelven el mismo valor y caen en el mismo cubo.
 */
export function diaOperativoDe(ts: number, horaCorte = HORA_CORTE_POR_DEFECTO): number {
  return jornadaDe(ts, horaCorte).desde;
}

/** El día natural que contiene un instante, en hora local del dispositivo. */
export function diaDe(ts: number): Rango {
  const inicio = new Date(ts);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);
  return { desde: inicio.getTime(), hasta: fin.getTime() };
}

/**
 * La semana que contiene un instante, de LUNES a domingo.
 *
 * Arranca en lunes porque es el periodo con el que se paga la raya en México, y
 * porque cortar en domingo partiría el fin de semana —el turno más fuerte de un
 * restaurante— entre dos periodos distintos.
 */
export function semanaDe(ts: number): Rango {
  const inicio = new Date(ts);
  inicio.setHours(0, 0, 0, 0);
  // getDay(): 0 = domingo. Se retrocede al lunes anterior.
  const retroceso = (inicio.getDay() + 6) % 7;
  inicio.setDate(inicio.getDate() - retroceso);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 7);
  return { desde: inicio.getTime(), hasta: fin.getTime() };
}

/**
 * La semana operativa: de lunes a domingo, pero cortando a la hora del local.
 *
 * `semanaDe` corta a medianoche y parte en dos el viernes de noche, que es el
 * turno que de verdad importa. Aquí la semana empieza y termina a la hora de
 * corte, igual que la jornada, para que un cierre de las 00:40 del sábado
 * siga contando en la semana del viernes.
 */
export function semanaOperativa(ts: number, horaCorte = HORA_CORTE_POR_DEFECTO): Rango {
  const inicio = new Date(diaOperativoDe(ts, horaCorte));
  // getDay(): 0 = domingo. Se retrocede al lunes de esa jornada.
  inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));

  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 7);
  return { desde: inicio.getTime(), hasta: fin.getTime() };
}

/**
 * La quincena que contiene un instante: del 1 al 15, o del 16 al fin de mes.
 *
 * Es el periodo con el que se paga en México, y por eso es el que el personal
 * tiene en la cabeza cuando pregunta cuánto lleva de propina. Se ancla también
 * en la jornada, no en el día natural.
 */
export function quincenaDe(ts: number, horaCorte = HORA_CORTE_POR_DEFECTO): Rango {
  const base = new Date(diaOperativoDe(ts, horaCorte));
  const primeraMitad = base.getDate() <= 15;

  const inicio = new Date(base);
  inicio.setDate(primeraMitad ? 1 : 16);

  const fin = new Date(base);
  if (primeraMitad) {
    fin.setDate(16);
  } else {
    // Mes y día a la vez: hacerlo en dos pasos convierte un 31 de enero en
    // marzo, porque febrero no tiene 31.
    fin.setMonth(fin.getMonth() + 1, 1);
  }

  return { desde: inicio.getTime(), hasta: fin.getTime() };
}

/** Lo que el personal lleva de propina en los tres periodos que le importan. */
export interface AcumuladoPropinas {
  dia: Centavos;
  semana: Centavos;
  quincena: Centavos;
  /** Cuentas cobradas que dejaron propina hoy. Da contexto al número. */
  cuentasDelDia: number;
}

/**
 * Cuánta propina se lleva acumulada en la jornada, la semana y la quincena.
 *
 * SOLO CUENTAS COBRADAS. Una propina apuntada en una mesa que sigue abierta
 * todavía puede cambiar —el cliente decide al final—, y un número que baja
 * solo destruye la confianza en el tablero. Como la propina se captura al
 * momento de cobrar, el acumulado igual se mueve durante todo el servicio.
 *
 * Con `meseroId` devuelve lo de esa persona; sin él, lo de todo el local.
 */
export function propinasAcumuladas(
  comandas: readonly EstadoComanda[],
  ahora: number,
  horaCorte = HORA_CORTE_POR_DEFECTO,
  meseroId?: ID,
): AcumuladoPropinas {
  const propinaEn = (rango: Rango): { total: Centavos; cuentas: number } => {
    const conPropina = cuentasCerradasEn(comandas, rango).filter(
      (c) => c.propina > 0 && (meseroId === undefined || c.mesero_id === meseroId),
    );
    return {
      total: sumar(...conPropina.map((c) => c.propina)),
      cuentas: conPropina.length,
    };
  };

  const dia = propinaEn(jornadaDe(ahora, horaCorte));

  return {
    dia: dia.total,
    semana: propinaEn(semanaOperativa(ahora, horaCorte)).total,
    quincena: propinaEn(quincenaDe(ahora, horaCorte)).total,
    cuentasDelDia: dia.cuentas,
  };
}

/**
 * Las cuentas ya cobradas dentro del rango.
 *
 * Solo cuentan las CERRADAS: una mesa en servicio todavía puede cambiar, y meter
 * su importe en el reporte del día haría que las cifras se movieran solas.
 */
export function cuentasCerradasEn(
  comandas: readonly EstadoComanda[],
  rango?: Rango,
): EstadoComanda[] {
  return comandas.filter((c) => {
    if (!c.cerrada) return false;
    // Una mesa que se abrió por error y se liberó sin consumo NO es una cuenta.
    // Contarla metía ventas de cero pesos que hunden el ticket promedio.
    if (c.anulada) return false;
    // Una venta cancelada tampoco: el dinero se devolvió. Dejarla dentro haría
    // que el día siguiera presumiendo un cobro que ya salió del cajón.
    if (c.cancelada) return false;
    if (!rango) return true;
    const ts = c.cerrada_ts ?? c.abierta_ts;
    return ts >= rango.desde && ts < rango.hasta;
  });
}

// --- Resumen del periodo -------------------------------------------------------------

export interface ResumenVentas {
  cuentas: number;
  platillos: number;
  bruto: Centavos;
  descuentos: Centavos;
  cortesias: Centavos;
  subtotal: Centavos;
  iva: Centavos;
  ieps: Centavos;
  total: Centavos;
  costo: Centavos;
  propinas: Centavos;
  /** Ingreso menos costo, sobre el subtotal (el IVA no es ingreso propio). */
  margen: Centavos;
  /** Costo sobre subtotal, como fracción: 0.31 = 31 %. */
  foodCost: number;
  /** Total cobrado entre cuentas cerradas. */
  ticketPromedio: Centavos;
}

export function resumenVentas(comandas: readonly EstadoComanda[]): ResumenVentas {
  let bruto = CERO;
  let descuentos = CERO;
  let cortesias = CERO;
  let subtotal = CERO;
  let iva = CERO;
  let ieps = CERO;
  let total = CERO;
  let costo = CERO;
  let propinas = CERO;
  let platillos = 0;

  for (const comanda of comandas) {
    const t = totalesComanda(comanda);
    bruto = sumar(bruto, t.bruto);
    descuentos = sumar(descuentos, t.descuentos);
    cortesias = sumar(cortesias, t.cortesias);
    subtotal = sumar(subtotal, t.subtotal);
    iva = sumar(iva, t.iva);
    ieps = sumar(ieps, t.ieps);
    total = sumar(total, t.total);
    costo = sumar(costo, t.costo);
    propinas = sumar(propinas, t.propina);
    platillos += renglonesActivos(comanda).reduce((n, r) => n + r.cantidad, 0);
  }

  const cuentas = comandas.length;
  return {
    cuentas,
    platillos,
    bruto,
    descuentos,
    cortesias,
    subtotal,
    iva,
    ieps,
    total,
    costo,
    propinas,
    margen: restar(subtotal, costo),
    foodCost: subtotal > 0 ? costo / subtotal : 0,
    ticketPromedio: cuentas > 0 ? (Math.round(total / cuentas) as Centavos) : CERO,
  };
}

// --- Por producto ----------------------------------------------------------------------

export interface VentaProducto {
  producto_id: ID;
  descripcion: string;
  unidades: number;
  /**
   * Lo que pagó el comensal por ese producto: **con su impuesto dentro.**
   *
   * Es la cifra que el restaurantero compara con lo que ve en la caja y en el
   * corte, y hasta ahora era la única del módulo que salía sin IVA —el resumen y
   * el ranking de meseros ya lo incluían—, así que dos columnas de la misma
   * pantalla no cuadraban entre sí.
   */
  importe: Centavos;
  /** El mismo importe sin impuesto: es la base sobre la que se mide el margen. */
  base: Centavos;
  costo: Centavos;
  margen: Centavos;
  /** Margen sobre la BASE, como fracción. El IVA no es ingreso del restaurante. */
  margenPct: number;
}

/**
 * Ranking de productos por importe vendido.
 *
 * Se agrupa por `producto_id` y no por descripción: dos platillos pueden
 * llamarse igual en categorías distintas, y el mismo producto puede haber
 * cambiado de nombre a media semana sin dejar de ser el mismo.
 */
export function ventasPorProducto(comandas: readonly EstadoComanda[]): VentaProducto[] {
  const acumulado = new Map<ID, VentaProducto>();

  for (const comanda of comandas) {
    for (const renglon of renglonesActivos(comanda)) {
      const previo = acumulado.get(renglon.producto_id) ?? {
        producto_id: renglon.producto_id,
        descripcion: renglon.descripcion,
        unidades: 0,
        importe: CERO,
        base: CERO,
        costo: CERO,
        margen: CERO,
        margenPct: 0,
      };

      const base = importeRenglon(renglon);
      previo.unidades += renglon.cantidad;
      previo.base = sumar(previo.base, base);
      // Con el impuesto dentro: es lo que el comensal pagó por ese platillo.
      previo.importe = sumar(previo.importe, desglosarConTasas(base, renglon.impuesto).total);
      previo.costo = sumar(previo.costo, costoRenglon(renglon));
      acumulado.set(renglon.producto_id, previo);
    }
  }

  return [...acumulado.values()]
    .map((v) => ({
      ...v,
      // El margen se mide contra la BASE: el IVA se recauda para el SAT y
      // meterlo aquí inflaría el margen de todos los platillos un 16 %.
      margen: restar(v.base, v.costo),
      margenPct: v.base > 0 ? (v.base - v.costo) / v.base : 0,
    }))
    .sort((a, b) => b.importe - a.importe);
}

// --- Por mesero ------------------------------------------------------------------------

export interface VentaMesero {
  mesero_id: ID;
  cuentas: number;
  importe: Centavos;
  propinas: Centavos;
  ticketPromedio: Centavos;
  /** Propina sobre lo vendido: mide la satisfacción del servicio. */
  propinaPct: number;
}

export function ventasPorMesero(comandas: readonly EstadoComanda[]): VentaMesero[] {
  const acumulado = new Map<ID, { cuentas: number; importe: Centavos; propinas: Centavos }>();

  for (const comanda of comandas) {
    const t = totalesComanda(comanda);
    const previo = acumulado.get(comanda.mesero_id) ?? {
      cuentas: 0,
      importe: CERO,
      propinas: CERO,
    };
    previo.cuentas += 1;
    previo.importe = sumar(previo.importe, t.total);
    previo.propinas = sumar(previo.propinas, t.propina);
    acumulado.set(comanda.mesero_id, previo);
  }

  return [...acumulado.entries()]
    .map(([mesero_id, v]) => ({
      mesero_id,
      cuentas: v.cuentas,
      importe: v.importe,
      propinas: v.propinas,
      ticketPromedio: v.cuentas > 0 ? (Math.round(v.importe / v.cuentas) as Centavos) : CERO,
      propinaPct: v.importe > 0 ? v.propinas / v.importe : 0,
    }))
    .sort((a, b) => b.importe - a.importe);
}

// --- Curva horaria ---------------------------------------------------------------------

export interface VentaHora {
  /** Hora local del dispositivo, 0..23. */
  hora: number;
  cuentas: number;
  importe: Centavos;
}

/**
 * Ventas por hora del día. Es la curva que revela los picos —el viernes de
 * Rodizio— y la base para dotar turnos y preparar producción.
 *
 * Devuelve solo las horas con actividad: pintar 24 barras vacías esconde la
 * forma real del servicio.
 */
export function ventasPorHora(comandas: readonly EstadoComanda[]): VentaHora[] {
  const acumulado = new Map<number, VentaHora>();

  for (const comanda of comandas) {
    const ts = comanda.cerrada_ts ?? comanda.abierta_ts;
    const hora = new Date(ts).getHours();
    const previo = acumulado.get(hora) ?? { hora, cuentas: 0, importe: CERO };
    previo.cuentas += 1;
    previo.importe = sumar(previo.importe, totalesComanda(comanda).total);
    acumulado.set(hora, previo);
  }

  return [...acumulado.values()].sort((a, b) => a.hora - b.hora);
}

// --- Menu engineering ---------------------------------------------------------------

export type ClaseMenu = "estrella" | "caballo" | "rompecabezas" | "perro";

export interface ProductoClasificado extends VentaProducto {
  clase: ClaseMenu;
  /** Participación en unidades vendidas, como fracción. */
  popularidad: number;
}

export const ETIQUETAS_CLASE: Record<ClaseMenu, string> = {
  estrella: "Estrella",
  caballo: "Caballo de batalla",
  rompecabezas: "Rompecabezas",
  perro: "Perro",
};

export const CONSEJOS_CLASE: Record<ClaseMenu, string> = {
  estrella: "Se vende y deja. Protégelo: cuida su calidad y su lugar en la carta.",
  caballo: "Se vende mucho pero deja poco. Baja su costo antes que subir su precio.",
  rompecabezas: "Deja bien pero casi no se pide. Muévelo de lugar o sugiérelo.",
  perro: "Ni se vende ni deja. Candidato a salir de la carta.",
};

/**
 * Clasificación de Kasavana-Smith: popularidad contra rentabilidad.
 *
 * El umbral de popularidad es el 70 % del reparto equitativo (1/n), que es la
 * convención del método: con 10 productos, "popular" es superar el 7 % de las
 * unidades y no el 10 %. Sin ese ajuste casi nada calificaría, porque en
 * cualquier carta real las ventas se concentran en unos pocos platillos.
 *
 * La rentabilidad se mide contra el margen PROMEDIO del periodo, no contra un
 * porcentaje fijo: lo que es buen margen depende de cada restaurante.
 */
export function menuEngineering(ventas: readonly VentaProducto[]): ProductoClasificado[] {
  const conVenta = ventas.filter((v) => v.unidades > 0);
  if (conVenta.length === 0) return [];

  const unidadesTotales = conVenta.reduce((n, v) => n + v.unidades, 0);
  const umbralPopularidad = (1 / conVenta.length) * 0.7;

  // Margen promedio por unidad, ponderado por lo que realmente se vendió.
  const margenTotal = conVenta.reduce((acc, v) => acc + v.margen, 0);
  const margenPromedio = margenTotal / unidadesTotales;

  return conVenta
    .map((v) => {
      const popularidad = v.unidades / unidadesTotales;
      const margenUnitario = v.margen / v.unidades;
      const popular = popularidad >= umbralPopularidad;
      const rentable = margenUnitario >= margenPromedio;

      const clase: ClaseMenu = popular
        ? rentable
          ? "estrella"
          : "caballo"
        : rentable
          ? "rompecabezas"
          : "perro";

      return { ...v, clase, popularidad };
    })
    .sort((a, b) => b.importe - a.importe);
}

/** Cuántos productos cayeron en cada cuadrante. */
export function conteoPorClase(
  clasificados: readonly ProductoClasificado[],
): Record<ClaseMenu, number> {
  const conteo: Record<ClaseMenu, number> = {
    estrella: 0,
    caballo: 0,
    rompecabezas: 0,
    perro: 0,
  };
  for (const p of clasificados) conteo[p.clase] += 1;
  return conteo;
}
