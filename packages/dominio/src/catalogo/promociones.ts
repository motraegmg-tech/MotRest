/**
 * Motor de promociones (F2).
 *
 * «Martes de 2×1 en pizzas», «happy hour de 6 a 8», «−20 % los miércoles». Hoy
 * el mesero lo aplica a mano con un descuento, lo que significa que a veces se
 * olvida, a veces se aplica de más, y nunca se sabe cuánto costó la promoción.
 *
 * TRES DECISIONES QUE GOBIERNAN EL DISEÑO
 *
 * 1. **Se calcula, no se guarda.** Una promoción es una regla sobre la cuenta,
 *    y su efecto se deriva de la cuenta y del reloj —igual que los impuestos—.
 *    Guardar el descuento aplicado como un dato haría que una cuenta reabierta
 *    conservara una promoción que ya venció.
 *
 * 2. **Nunca se apilan sobre el mismo renglón.** Dos promociones que se sumen
 *    sobre el mismo platillo regalan producto sin que nadie lo haya decidido.
 *    Se aplica la MEJOR para el cliente y se dice cuál fue.
 *
 * 3. **El 2×1 regala siempre el más barato.** Es la convención universal y la
 *    única defendible: regalar el más caro convierte una promoción en pérdida.
 *
 * El motor corre en el dispositivo, sin consultar nada: una promoción que
 * necesita internet para aplicarse no sirve en un local en modo isla (TRD R3).
 */
import { CERO, sumar, deCentavos, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { importeRenglon } from "../comanda/renglon.js";

export type TipoPromocion =
  | "nxm" /** Lleva N, paga M: el clásico 2×1. */
  | "porcentaje" /** Un descuento sobre lo que aplique. */
  | "precio_fijo"; /** Un precio especial para el producto. */

/** Cuándo aplica. Sin días ni horas, aplica siempre. */
export interface VigenciaPromocion {
  /** Días de la semana, como `Date.getDay()`. Vacío = todos. */
  dias?: number[];
  /** Hora local de inicio, inclusive. */
  desde_hora?: number;
  /** Hora local de fin, exclusive. */
  hasta_hora?: number;
}

export interface Promocion {
  id: ID;
  nombre: string;
  tipo: TipoPromocion;
  /** A qué productos aplica. Vacío = a toda la carta. */
  productos: ID[];
  /** A qué categorías aplica. Se suma a `productos`. */
  categorias: ID[];
  vigencia: VigenciaPromocion;
  activa: boolean;

  /** Para `nxm`: cuántos se llevan. */
  lleva?: number;
  /** Para `nxm`: cuántos se pagan. */
  paga?: number;
  /** Para `porcentaje`: 0.20 = 20 % de descuento. */
  fraccion?: number;
  /** Para `precio_fijo`: el precio especial por unidad. */
  precio?: Centavos;
}

/**
 * ¿Está vigente en este instante?
 *
 * La hora sale del reloj del dispositivo (ADR-17). Una franja que cruza la
 * medianoche —de 22 a 2— se entiende como tal en vez de no aplicar nunca, que
 * es lo que pasaría comparando ingenuamente.
 */
export function estaVigente(promo: Promocion, ahora: number): boolean {
  if (!promo.activa) return false;

  const fecha = new Date(ahora);
  const { dias, desde_hora, hasta_hora } = promo.vigencia;

  if (dias && dias.length > 0 && !dias.includes(fecha.getDay())) return false;
  if (desde_hora === undefined || hasta_hora === undefined) return true;

  const hora = fecha.getHours();
  // Franja normal (18 → 20) o que cruza la medianoche (22 → 2).
  return desde_hora <= hasta_hora
    ? hora >= desde_hora && hora < hasta_hora
    : hora >= desde_hora || hora < hasta_hora;
}

/** ¿Este renglón entra en la promoción? */
export function aplicaA(
  promo: Promocion,
  renglon: RenglonComanda,
  categoriaDe: (productoId: ID) => ID | undefined,
): boolean {
  // Sin productos ni categorías declaradas, aplica a toda la carta.
  if (promo.productos.length === 0 && promo.categorias.length === 0) return true;
  if (promo.productos.includes(renglon.producto_id)) return true;

  const categoria = categoriaDe(renglon.producto_id);
  return categoria !== undefined && promo.categorias.includes(categoria);
}

export interface DescuentoPromocion {
  promocion_id: ID;
  nombre: string;
  /** Renglones a los que se les aplicó. */
  renglones: ID[];
  importe: Centavos;
}

export interface PromocionesAplicadas {
  descuentos: DescuentoPromocion[];
  total: Centavos;
}

/**
 * Cuánto descuenta una promoción sobre los renglones que le tocan.
 *
 * Devuelve `0` cuando no hay nada que descontar, para que el llamador pueda
 * descartarla sin casos especiales.
 */
function descuentoDe(promo: Promocion, renglones: readonly RenglonComanda[]): Centavos {
  if (renglones.length === 0) return CERO;

  if (promo.tipo === "porcentaje") {
    const base = sumar(...renglones.map(importeRenglon));
    return deCentavos(Math.round(base * (promo.fraccion ?? 0)));
  }

  if (promo.tipo === "precio_fijo") {
    const precio = promo.precio ?? CERO;
    let ahorro = 0;
    for (const r of renglones) {
      // Nunca sube el precio: si el especial es más caro, no se aplica.
      const diferencia = r.precio_unitario - precio;
      if (diferencia > 0) ahorro += diferencia * r.cantidad;
    }
    return deCentavos(ahorro);
  }

  // nxm: se regalan (lleva − paga) unidades por cada grupo completo.
  const lleva = promo.lleva ?? 0;
  const paga = promo.paga ?? 0;
  if (lleva <= paga || paga < 1) return CERO;

  /*
   * Se expanden las unidades y se ordenan de MENOR a mayor precio: el 2×1
   * regala el más barato. Regalar el más caro convertiría la promoción en
   * pérdida, y es lo que ningún restaurante hace.
   */
  const unidades: Centavos[] = [];
  for (const r of renglones) {
    for (let i = 0; i < r.cantidad; i++) unidades.push(r.precio_unitario);
  }
  unidades.sort((a, b) => a - b);

  const grupos = Math.floor(unidades.length / lleva);
  const gratis = grupos * (lleva - paga);
  return deCentavos(unidades.slice(0, gratis).reduce((n, p) => n + p, 0));
}

/**
 * Aplica las promociones vigentes a una cuenta.
 *
 * Un renglón NO recibe dos promociones: se le aplica la que más le conviene al
 * cliente y las demás lo saltan. Apilarlas regalaría producto sin que nadie lo
 * haya decidido, y es la forma más común de que una promoción salga cara.
 */
export function aplicarPromociones(
  renglones: readonly RenglonComanda[],
  promociones: readonly Promocion[],
  categoriaDe: (productoId: ID) => ID | undefined,
  ahora: number,
): PromocionesAplicadas {
  const vigentes = promociones.filter((p) => estaVigente(p, ahora));
  const descuentos: DescuentoPromocion[] = [];
  const yaConPromo = new Set<ID>();

  /*
   * Se evalúan todas contra los renglones LIBRES y se toma la mejor en cada
   * pasada, hasta que ninguna aporte. Así el resultado no depende del orden en
   * que se dieron de alta las promociones.
   */
  let quedan = true;
  while (quedan) {
    quedan = false;
    let mejor: { promo: Promocion; aplica: RenglonComanda[]; importe: Centavos } | null = null;

    for (const promo of vigentes) {
      if (descuentos.some((d) => d.promocion_id === promo.id)) continue;

      const aplica = renglones.filter(
        (r) =>
          r.estado !== "cancelado" &&
          !yaConPromo.has(r.id) &&
          aplicaA(promo, r, categoriaDe),
      );
      const importe = descuentoDe(promo, aplica);
      if (importe <= 0) continue;
      if (!mejor || importe > mejor.importe) mejor = { promo, aplica, importe };
    }

    if (mejor) {
      for (const r of mejor.aplica) yaConPromo.add(r.id);
      descuentos.push({
        promocion_id: mejor.promo.id,
        nombre: mejor.promo.nombre,
        renglones: mejor.aplica.map((r) => r.id),
        importe: mejor.importe,
      });
      quedan = true;
    }
  }

  return { descuentos, total: sumar(...descuentos.map((d) => d.importe)) };
}

/** Lo mínimo que hace falta saber de un descuento ya registrado en la cuenta. */
export interface DescuentoYaRegistrado {
  promocion_id?: ID;
  renglones_cubiertos?: ID[];
}

/**
 * Lo que le falta por aplicar a una cuenta que YA tiene promociones registradas.
 *
 * El caso real: se aplica el 2×1, y diez minutos después la mesa pide dos
 * pizzas más. Hay que ofrecer el 2×1 **otra vez** sobre las nuevas, sin volver a
 * regalar las primeras.
 *
 * LO ÚNICO QUE SE EXCLUYE SON LOS RENGLONES YA CUBIERTOS, no las promociones ya
 * usadas. Excluir la promoción entera —que es lo que se hacía— dejaba la mesa
 * sin su 2×1 en cuanto pedía la segunda ronda: la promoción existía, los
 * platillos eran elegibles, y el botón simplemente no volvía a salir. Quien
 * atendía no tenía forma de saber por qué, y el comensal veía dos pizzas al
 * mismo precio que antes había pagado una.
 *
 * Cubrir los renglones ya regalados basta para que nada se regale dos veces:
 * cada aplicación se lleva los suyos y los siguientes entran limpios.
 */
export function promocionesPendientes(
  renglones: readonly RenglonComanda[],
  promociones: readonly Promocion[],
  yaRegistrados: readonly DescuentoYaRegistrado[],
  categoriaDe: (productoId: ID) => ID | undefined,
  ahora: number,
): PromocionesAplicadas {
  const cubiertos = new Set(yaRegistrados.flatMap((d) => d.renglones_cubiertos ?? []));

  return aplicarPromociones(
    renglones.filter((r) => !cubiertos.has(r.id)),
    promociones,
    categoriaDe,
    ahora,
  );
}

/** Cómo se lee una promoción en la carta y en el ticket. */
export function describirPromocion(promo: Promocion): string {
  switch (promo.tipo) {
    case "nxm":
      return `${promo.lleva}×${promo.paga}`;
    case "porcentaje":
      return `−${Math.round((promo.fraccion ?? 0) * 100)} %`;
    case "precio_fijo":
      return "Precio especial";
  }
}
