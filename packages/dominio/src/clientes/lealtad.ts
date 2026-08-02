/**
 * Lealtad y monedero (M7 · F3).
 *
 * Dos cosas distintas que la mayoría de los sistemas revuelve, y revolverlas es
 * caro:
 *
 *   PUNTOS   — los regala la casa por consumir. No son dinero: no se devuelven,
 *              no se transfieren y pueden caducar.
 *   MONEDERO — es DINERO del cliente que el restaurante ya cobró: un saldo a
 *              favor, una gift card, la devolución de un platillo que salió
 *              mal. Es un pasivo del negocio y no caduca por las buenas.
 *
 * Por eso van en dos saldos separados y con reglas propias. Meterlos en un solo
 * número hace imposible responder "¿cuánto le debo a mis clientes?", que es la
 * pregunta que le importa al contador.
 *
 * TODO EN CENTAVOS ENTEROS (ADR-12) y todo como eventos: el saldo es una
 * proyección, no un campo que alguien pueda editar. Un monedero con un campo
 * editable es un agujero por donde se va el dinero sin dejar rastro.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

/** Cuántos puntos da cada peso de consumo, por defecto. */
export const PUNTOS_POR_PESO = 1;

/** Cuánto vale un punto al canjearlo. 100 puntos = $1. */
export const CENTAVOS_POR_PUNTO = 1;

export type MotivoMonedero =
  /** Compró una tarjeta de regalo o abonó saldo. */
  | "compra"
  /** La casa repone algo que salió mal. */
  | "cortesia"
  /** Devolución de un cobro. */
  | "devolucion"
  /** Se usó para pagar. */
  | "consumo";

export type EventoLealtad =
  | (EventoBase & {
      tipo: "puntos_acumulados";
      cliente_id: ID;
      orden_id: ID;
      puntos: number;
      /** Sobre cuánto se calcularon, para poder auditar la regla. */
      base: Centavos;
    })
  | (EventoBase & {
      tipo: "puntos_canjeados";
      cliente_id: ID;
      orden_id: ID;
      puntos: number;
      /** Lo que se descontó de la cuenta a cambio. */
      valor: Centavos;
    })
  | (EventoBase & {
      tipo: "puntos_ajustados";
      cliente_id: ID;
      /** Positivo o negativo. Siempre con motivo: es un regalo o un castigo. */
      puntos: number;
      motivo: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      tipo: "monedero_abonado";
      cliente_id: ID;
      monto: Centavos;
      motivo: MotivoMonedero;
      concepto: string;
      /** Presente si nació de una gift card. */
      folio_regalo?: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      tipo: "monedero_cargado";
      cliente_id: ID;
      monto: Centavos;
      orden_id: ID;
    });

export interface SaldoCliente {
  cliente_id: ID;
  puntos: number;
  /** Saldo a favor, en centavos. Es un PASIVO del restaurante. */
  monedero: Centavos;
}

/** El stream de lealtad de una sucursal. */
export function streamLealtad(sucursal_id: ID): ID {
  return `lealtad:${sucursal_id}`;
}

/** Puntos que corresponden a un consumo. Sobre el SUBTOTAL, no sobre el total. */
export function puntosPorConsumo(subtotal: Centavos, porPeso = PUNTOS_POR_PESO): number {
  /*
   * Sobre el subtotal a propósito: el IVA se recauda para el SAT y no es
   * ingreso del restaurante. Premiar sobre el total sería regalar puntos por
   * el impuesto de otro.
   */
  return Math.floor((subtotal / 100) * porPeso);
}

/** Cuánto dinero valen unos puntos. */
export function valorDePuntos(puntos: number, centavosPorPunto = CENTAVOS_POR_PUNTO): Centavos {
  return Math.max(0, Math.floor(puntos * centavosPorPunto)) as Centavos;
}

export function proyectarSaldos(eventos: readonly EventoLealtad[]): Map<ID, SaldoCliente> {
  const saldos = new Map<ID, SaldoCliente>();

  const de = (clienteId: ID): SaldoCliente => {
    const previo = saldos.get(clienteId) ?? { cliente_id: clienteId, puntos: 0, monedero: CERO };
    saldos.set(clienteId, previo);
    return previo;
  };

  for (const ev of eventos) {
    const saldo = de(ev.cliente_id);

    switch (ev.tipo) {
      case "puntos_acumulados":
        saldos.set(ev.cliente_id, { ...saldo, puntos: saldo.puntos + ev.puntos });
        break;

      case "puntos_canjeados":
        /*
         * No se permite saldo negativo de puntos. Si llega un canje mayor al
         * saldo —dos terminales canjeando a la vez, sin haberse sincronizado—
         * se descuenta hasta cero en vez de dejar un número imposible.
         */
        saldos.set(ev.cliente_id, {
          ...saldo,
          puntos: Math.max(0, saldo.puntos - ev.puntos),
        });
        break;

      case "puntos_ajustados":
        saldos.set(ev.cliente_id, {
          ...saldo,
          puntos: Math.max(0, saldo.puntos + ev.puntos),
        });
        break;

      case "monedero_abonado":
        saldos.set(ev.cliente_id, {
          ...saldo,
          monedero: sumar(saldo.monedero, ev.monto),
        });
        break;

      case "monedero_cargado":
        saldos.set(ev.cliente_id, {
          ...saldo,
          monedero: Math.max(0, restar(saldo.monedero, ev.monto)) as Centavos,
        });
        break;
    }
  }

  return saldos;
}

export function saldoDe(
  eventos: readonly EventoLealtad[] | Map<ID, SaldoCliente>,
  clienteId: ID,
): SaldoCliente {
  const mapa = eventos instanceof Map ? eventos : proyectarSaldos(eventos);
  return mapa.get(clienteId) ?? { cliente_id: clienteId, puntos: 0, monedero: CERO };
}

/**
 * Cuánto le debe el restaurante a sus clientes.
 *
 * Es el número que el contador necesita: el monedero es dinero ya cobrado y
 * todavía no consumido. Los puntos NO entran — no son dinero y no se devuelven.
 */
export function pasivoConClientes(saldos: Map<ID, SaldoCliente>): Centavos {
  return sumar(...[...saldos.values()].map((s) => s.monedero));
}

export interface UsoPosible {
  /** Puntos que se pueden canjear ahora, sin pasarse del total de la cuenta. */
  puntos: number;
  /** Lo que valen esos puntos. */
  valor_puntos: Centavos;
  /** Cuánto del monedero se puede aplicar a esta cuenta. */
  monedero: Centavos;
}

/**
 * Qué puede usar este cliente en ESTA cuenta, sin pasarse.
 *
 * Nunca más que el total: un canje que deje la cuenta en negativo convierte una
 * promoción de lealtad en una devolución de dinero que nadie autorizó.
 */
export function usoPosible(
  saldo: SaldoCliente,
  totalCuenta: Centavos,
  centavosPorPunto = CENTAVOS_POR_PUNTO,
): UsoPosible {
  const valorTodos = valorDePuntos(saldo.puntos, centavosPorPunto);
  const valorPuntos = Math.min(valorTodos, totalCuenta) as Centavos;
  const puntos = Math.ceil(valorPuntos / centavosPorPunto);

  // El monedero cubre lo que quede después de los puntos.
  const resto = restar(totalCuenta, valorPuntos);

  return {
    puntos,
    valor_puntos: valorPuntos,
    monedero: Math.min(saldo.monedero, resto) as Centavos,
  };
}
