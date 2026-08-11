/**
 * En qué paso del servicio va CADA mesa.
 *
 * ## El problema que resuelve
 *
 * El panel de venta guardaba su paso —cuenta, cobro, traspaso— en una sola
 * variable del componente, compartida por todo el salón. La consecuencia se veía
 * en cualquier viernes: el mesero deja la mesa 1 a medio cobrar mientras los
 * comensales deciden la propina, toca la mesa 4 para tomarles el pedido y se
 * encuentra la pantalla de cobro de una mesa que no ha consumido nada. Y si
 * pulsaba «Volver a la cuenta» para poder trabajar, la mesa 1 volvía también:
 * la forma de pago elegida, el efectivo recibido y la propina tecleada se
 * perdían.
 *
 * Aquí el paso pasa a ser un dato DE LA MESA, no de la pantalla. Ir y venir
 * entre mesas ya no cambia nada: cada una se reencuentra donde se dejó.
 *
 * ## Por qué no se persiste
 *
 * Esto es intención a medio expresar —«iba a cobrar con tarjeta»—, no un hecho
 * del negocio. Lo que sí ocurrió (el pago, la propina, el descuento) son eventos
 * y viven en el log. Guardar esto en disco solo serviría para que una terminal
 * amaneciera con la pantalla de cobro de anoche puesta.
 */
import type { FormaPago, ID } from "@motrest/dominio";

/** Forma de cobro tal como se elige en pantalla. */
export type FormaCobro =
  | FormaPago
  /**
   * Una parte en efectivo y el resto con tarjeta. NO es una forma de pago del
   * dominio: al registrarlo se parte en dos pagos reales, para que el corte y
   * las finanzas sigan sabiendo cuánto entró al cajón y cuánto a la terminal.
   */
  | "mixto";

export interface PasoDeMesa {
  /** Columna central: la ficha de la mesa o la carta para pedir. */
  modo: "mesa" | "pedido";
  /** Panel de la derecha: la cuenta, el cobro, el traspaso o el cargo a un socio. */
  vista: "cuenta" | "cobro" | "traspaso" | "socio";
  forma: FormaCobro;
  /** Efectivo que entregó el comensal, para calcular el cambio. */
  recibido: string;
  /** En un cobro mixto, cuánto de lo cobrado entra en efectivo. */
  efectivoMixto: string;
  /** Con qué tarjeta se cubre el resto de un cobro mixto. */
  formaTarjeta: FormaPago;
  /** Propina tecleada a mano, en pesos. Vacío = se usan los porcentajes. */
  propinaLibre: string;
  partes: number;
  renglonATraspasar: string | null;
  /** Socio al que se le va a cargar el consumo, mientras se decide el monto. */
  socioElegido: string | null;
  /** Cuánto se le carga al socio, en pesos y tal como se teclea. */
  montoSocio: string;
}

/**
 * Congelado: es el valor que devuelve una mesa de la que nadie ha tocado nada.
 * Si se pudiera mutar, tocar una mesa nueva cambiaría el punto de partida de
 * todas las demás.
 */
const RECIEN_ABIERTA: Readonly<PasoDeMesa> = Object.freeze({
  modo: "mesa",
  vista: "cuenta",
  forma: "efectivo",
  recibido: "",
  efectivoMixto: "",
  formaTarjeta: "tarjeta_debito",
  propinaLibre: "",
  partes: 2,
  renglonATraspasar: null,
  socioElegido: null,
  montoSocio: "",
} as const);

class VistaPorMesa {
  private pasos = $state<Record<ID, PasoDeMesa>>({});

  /**
   * Dónde va esta mesa. **Leer nunca escribe**: una mesa que nadie ha tocado
   * devuelve el punto de partida sin ocupar sitio, que es lo que permite llamar
   * a esto desde el render sin provocar una mutación en medio de un derivado.
   */
  de(mesaId: ID): Readonly<PasoDeMesa> {
    return this.pasos[mesaId] ?? RECIEN_ABIERTA;
  }

  /** Cambia una parte del paso de una mesa, sin tocar el resto. */
  fijar(mesaId: ID, cambios: Partial<PasoDeMesa>): void {
    if (!mesaId) return;
    this.pasos[mesaId] = { ...this.de(mesaId), ...cambios };
  }

  /**
   * La mesa se cobró y se liberó: su paso vuelve al principio.
   *
   * Sin esto, la siguiente sentada heredaría el efectivo recibido y la propina
   * tecleada de los comensales anteriores.
   */
  reiniciar(mesaId: ID): void {
    if (!(mesaId in this.pasos)) return;
    const { [mesaId]: _liberada, ...resto } = this.pasos;
    this.pasos = resto;
  }
}

export const vistaMesa = new VistaPorMesa();
