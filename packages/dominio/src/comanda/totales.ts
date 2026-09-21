/**
 * Totales de la cuenta, en centavos exactos.
 *
 * El impuesto se desglosa RENGLÓN POR RENGLÓN con el snapshot de tasas que cada
 * uno congeló: en una misma cuenta puede haber alimentos al 16 %, productos al
 * 0 % y bebidas con IEPS. Sumar todo y aplicar una sola tasa daría mal.
 *
 * Descuentos y cortesías reducen la base ANTES de calcular el impuesto, que es
 * como se factura en México: no se cobra IVA sobre lo que no se cobró.
 */
import { CERO, porFraccion, restar, sumar, type Centavos } from "../comun/dinero.js";
import { desglosarConTasas } from "../comun/impuestos.js";
import type { ID } from "../comun/ids.js";
import { renglonesActivos, type Descuento, type EstadoComanda } from "./reducers.js";
import { costoRenglon, importeRenglon, type RenglonComanda } from "./renglon.js";

export interface TotalesComanda {
  /** Suma de importes de línea, antes de impuestos y de rebajas. */
  bruto: Centavos;
  /** Lo rebajado por descuentos. */
  descuentos: Centavos;
  /** Lo regalado como cortesía. */
  cortesias: Centavos;
  /** Base gravable: bruto − descuentos − cortesías. */
  subtotal: Centavos;
  iva: Centavos;
  ieps: Centavos;
  /** Lo que se cobra al comensal, sin propina. */
  total: Centavos;
  /** Costo de los insumos/platillos (las cortesías también cuestan). */
  costo: Centavos;
  /** Margen bruto como fracción (0..1), sobre el subtotal. */
  margen: number;
  propina: Centavos;
  /** Lo cobrado que sigue en poder del negocio: pagos − devoluciones. */
  pagado: Centavos;
  /** Lo que se le regresó al comensal al cancelar la venta. */
  devuelto: Centavos;
  /** Lo que falta por cobrar (total + propina − pagado). */
  saldo: Centavos;
  /** Cambio a devolver cuando se recibió más efectivo del debido. */
  cambio: Centavos;
}

/**
 * Cuánto se regaló de un renglón, con impuestos, en centavos.
 *
 * La ÚNICA respuesta a esa pregunta en todo el sistema: la usan los totales de
 * la cuenta y la factura. Si cada uno hiciera su cuenta, el ticket diría que se
 * regaló una cerveza y el CFDI repartiría el regalo entre todos los platillos.
 *
 * - Cortesía de la cuenta completa → el renglón entero.
 * - Cortesía del renglón sin `cantidad` → el renglón entero.
 * - Con `cantidad` → la parte proporcional de esas piezas. Si después bajaron
 *   las piezas del renglón por debajo de lo regalado, se regala lo que queda y
 *   nunca más: una cortesía no puede dejar un renglón en negativo.
 */
export function cortesiaDeRenglon(estado: EstadoComanda, renglon: RenglonComanda): Centavos {
  const importe = importeRenglon(renglon);
  if (estado.cortesias.some((c) => !c.renglon_id)) return importe;

  const cortesia = estado.cortesias.find((c) => c.renglon_id === renglon.id);
  if (!cortesia) return CERO;
  if (cortesia.cantidad === undefined || cortesia.cantidad >= renglon.cantidad) return importe;
  if (cortesia.cantidad <= 0 || renglon.cantidad <= 0) return CERO;

  return Math.round((importe * cortesia.cantidad) / renglon.cantidad) as Centavos;
}

/**
 * Cuánto de esta cuenta lo cubrió la bolsa de un socio, con impuestos dentro.
 *
 * NO ES UNA VENTA (decisión de Gonzalo, sep-2026). El socio consumió de verdad
 * —el platillo salió de la cocina y sus insumos se gastaron—, pero al
 * restaurante no le entró un peso: lo cubrió el saldo mensual que tiene pactado.
 * Contarlo como venta inflaba la venta del día, las dos utilidades y lo que el
 * sistema esperaba facturar.
 *
 * Hasta la 1.5.5 esto era solo una forma de pago y la venta lo incluía. Desde la
 * 1.5.6, la venta se mide SIN esta parte, y el costo de lo consumido sí sigue
 * contando: es lo que de verdad le cuesta el acuerdo al negocio.
 *
 * Se topa al total de la cuenta: un ajuste raro no puede dejar la venta en
 * negativo.
 */
export function consumoDeSocio(estado: EstadoComanda): Centavos {
  const pagado = sumar(
    ...estado.pagos.filter((p) => p.forma === "socio").map((p) => p.monto),
  );
  if (pagado <= 0) return CERO;
  const { total } = totalesComanda(estado);
  return Math.min(pagado, total) as Centavos;
}

/** Aplica un descuento a un importe. */
function rebajaDe(descuento: Descuento, base: Centavos): Centavos {
  return descuento.modo === "porcentaje"
    ? porFraccion(base, descuento.valor)
    : (Math.min(descuento.valor, base) as Centavos);
}

export function totalesComanda(estado: EstadoComanda): TotalesComanda {
  const activos = renglonesActivos(estado);

  let bruto = CERO;
  let cortesias = CERO;
  let descuentos = CERO;
  let costo = CERO;

  /** Base de cada renglón ya rebajada, para prorratear el impuesto. */
  const bases: { renglon: RenglonComanda; base: Centavos }[] = [];

  for (const renglon of activos) {
    const importe = importeRenglon(renglon);
    bruto = sumar(bruto, importe);
    // Las piezas regaladas también se sirvieron: su costo cuenta completo.
    costo = sumar(costo, costoRenglon(renglon));

    const regalado = cortesiaDeRenglon(estado, renglon);
    cortesias = sumar(cortesias, regalado);
    if (regalado >= importe) {
      bases.push({ renglon, base: CERO });
      continue;
    }

    /*
     * Los descuentos del renglón se aplican sobre lo que QUEDA después de la
     * cortesía. Con tres cervezas, una regalada y un 10 % al renglón, el 10 %
     * es de las dos que se cobran: calcularlo sobre las tres cobraría de menos
     * un descuento que nadie autorizó.
     */
    let base = restar(importe, regalado);
    for (const descuento of estado.descuentos) {
      if (descuento.alcance !== "renglon" || descuento.renglon_id !== renglon.id) continue;
      const rebaja = rebajaDe(descuento, base);
      descuentos = sumar(descuentos, rebaja);
      base = restar(base, rebaja);
    }
    bases.push({ renglon, base });
  }

  // Descuentos sobre el total de la cuenta: se prorratean entre los renglones
  // que aún tienen base, para que el impuesto quede correcto en cada tasa.
  const descuentosDeCuenta = estado.descuentos.filter((d) => d.alcance === "cuenta");
  if (descuentosDeCuenta.length > 0) {
    for (const descuento of descuentosDeCuenta) {
      const baseTotal = bases.reduce((acc, b) => sumar(acc, b.base), CERO);
      if (baseTotal <= 0) break;
      const rebaja = rebajaDe(descuento, baseTotal);
      descuentos = sumar(descuentos, rebaja);

      let repartido = CERO;
      bases.forEach((b, i) => {
        if (b.base <= 0) return;
        const esUltimo = i === bases.length - 1;
        // El último absorbe el residuo para que la suma cuadre al centavo.
        const parte = esUltimo
          ? restar(rebaja, repartido)
          : (Math.round((rebaja * b.base) / baseTotal) as Centavos);
        const aplicada = Math.min(parte, b.base) as Centavos;
        b.base = restar(b.base, aplicada);
        repartido = sumar(repartido, aplicada);
      });
    }
  }

  let subtotal = CERO;
  let iva = CERO;
  let ieps = CERO;

  for (const { renglon, base } of bases) {
    if (base <= 0) continue;
    const desglose = desglosarConTasas(base, renglon.impuesto);
    subtotal = sumar(subtotal, desglose.base);
    iva = sumar(iva, desglose.iva);
    ieps = sumar(ieps, desglose.ieps);
  }

  const total = sumar(subtotal, iva, ieps);
  const propina = estado.propina;
  const aCobrar = sumar(total, propina);

  /*
   * Lo devuelto SE RESTA de lo pagado, y ahí está el arreglo del saldo negativo.
   *
   * Una venta cancelada conserva sus pagos —ocurrieron— pero el dinero ya no lo
   * tiene el negocio. Sin restarlo, una cuenta cobrada y luego cancelada
   * quedaba en «pagado 433, total 0, saldo −433»: una deuda del restaurante con
   * un comensal que ya se fue con su dinero. Con la resta, la cuenta cancelada
   * cierra en cero, que es la verdad.
   */
  const devuelto = sumar(...(estado.devoluciones ?? []).map((d) => d.monto));
  const pagado = restar(sumar(...estado.pagos.map((p) => p.monto)), devuelto);

  const recibido = restar(sumar(...estado.pagos.map((p) => p.recibido ?? p.monto)), devuelto);
  const cambio = recibido > aCobrar ? restar(recibido, aCobrar) : CERO;

  return {
    bruto,
    descuentos,
    cortesias,
    subtotal,
    iva,
    ieps,
    total,
    costo,
    // El margen se calcula sobre el SUBTOTAL (ingreso real), no sobre el total:
    // el IVA se recauda para el SAT, no es ingreso del restaurante.
    margen: subtotal > 0 ? (subtotal - costo) / subtotal : 0,
    propina,
    pagado,
    devuelto,
    // Una venta cancelada no debe nada: el consumo se deshizo junto con el
    // cobro, así que el saldo es cero y no el importe que se dejó de cobrar.
    saldo: estado.cancelada ? CERO : restar(aCobrar, pagado),
    cambio,
  };
}
