/**
 * Cuánto historial de ventas conserva la caja, y qué se puede tirar.
 *
 * ## Por qué existe
 *
 * El registro de operación vive en el disco de la caja del restaurante, no en
 * una nube. Crece con cada platillo, cada cobro y cada ticket reimpreso, y
 * nunca menguaba: un local con dos años de servicio arrastra cientos de miles
 * de eventos que hay que leer enteros en cada arranque y copiar enteros en cada
 * respaldo.
 *
 * El restaurante ya podía ELEGIR cuánto conservar —la opción y su advertencia
 * llevaban tiempo en la pantalla de ventas— pero nadie borraba nada. Era un
 * ajuste decorativo. Esto es lo que le da efecto.
 *
 * ## Las tres reglas que hacen que esto sea seguro
 *
 * 1. **Solo se tiran cuentas TERMINADAS.** Una mesa abierta no se toca por
 *    vieja que sea: puede llevar días abierta por un turno que nadie cerró, y
 *    borrarla dejaría una mesa ocupada para siempre sin forma de liberarla.
 *
 * 2. **Se tira la orden ENTERA o nada.** Borrar la mitad de los eventos de una
 *    cuenta es peor que no borrar: quedan renglones sueltos que ya no se pueden
 *    ubicar en ninguna mesa, y la proyección enseña una comanda mutilada.
 *
 * 3. **Nunca lo que el Hub no ha confirmado.** Eso lo garantiza el almacén, no
 *    este módulo: un evento que sigue en el outbox es un hecho que todavía no
 *    existe en ninguna otra parte, y tirarlo lo perdería para siempre.
 *
 * ## Lo que NO se borra jamás
 *
 * Nada de dinero: los cortes de caja, los gastos, los movimientos de tesorería
 * y los comprobantes fiscales se quedan. Son pocos —unos cuantos por día frente
 * a cientos de renglones de comanda— y son justo lo que alguien va a venir a
 * buscar dos años después. Lo que ocupa es el detalle del servicio, y es lo
 * único que se retira.
 */
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "./reducers.js";

/** Un mes, para medir la ventana. Treinta días: es una purga, no un calendario. */
const MES_MS = 30 * 24 * 60 * 60 * 1000;

/** El mínimo que se puede conservar. Por debajo, un trimestre no se puede cerrar. */
export const MESES_RETENCION_MINIMO = 3;

export interface Purgable {
  /** Las órdenes que se pueden retirar del disco. */
  ordenes: ID[];
  /** La más reciente que se retira, para poder decir hasta qué fecha se limpió. */
  hasta: number;
}

/**
 * Qué cuentas se pueden retirar del disco de esta terminal.
 *
 * Se mide desde el CIERRE de la cuenta, no desde su apertura: una mesa que
 * abrió el 1 y se cobró el 2 pertenece al historial del 2, que es el día en que
 * el dinero entró y contra el que se cuadró la caja.
 */
export function ordenesPurgables(
  comandas: readonly EstadoComanda[],
  mesesRetencion: number,
  ahora: number = Date.now(),
): Purgable {
  // Un valor absurdo no borra nada: ante la duda, conservar.
  if (!Number.isFinite(mesesRetencion) || mesesRetencion < MESES_RETENCION_MINIMO) {
    return { ordenes: [], hasta: 0 };
  }

  const limite = ahora - mesesRetencion * MES_MS;
  const ordenes: ID[] = [];
  let hasta = 0;

  for (const c of comandas) {
    // Regla 1: solo lo terminado. Una cuenta viva no se toca.
    const terminada = c.cerrada || c.cancelada || c.anulada;
    if (!terminada) continue;

    /*
     * La fecha que cuenta es la del desenlace. Si faltara —un registro viejo o
     * incompleto— se cae a la apertura, que siempre está; sin esa red, una
     * cuenta sin `cerrada_ts` sería inmortal.
     */
    const cuando = c.cancelada_ts ?? c.cerrada_ts ?? c.abierta_ts;
    if (cuando >= limite) continue;

    ordenes.push(c.orden_id);
    if (cuando > hasta) hasta = cuando;
  }

  return { ordenes, hasta };
}

/**
 * Cuántos días de historial hay guardados ahora mismo.
 *
 * Sirve para que la pantalla pueda decir «tiene 47 días guardados» en vez de un
 * número de registros, que no le dice nada a nadie.
 */
export function diasDeHistorial(
  comandas: readonly EstadoComanda[],
  ahora: number = Date.now(),
): number {
  let masVieja = ahora;
  for (const c of comandas) {
    const cuando = c.abierta_ts;
    if (cuando > 0 && cuando < masVieja) masVieja = cuando;
  }
  return Math.max(0, Math.floor((ahora - masVieja) / (24 * 60 * 60 * 1000)));
}
