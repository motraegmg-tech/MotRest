/**
 * El kiosco de autoservicio (F4).
 *
 * Una pantalla en la entrada donde el comensal arma su pedido solo. Sirve para
 * las horas pico —cuando la fila para pedir es más larga que la de la comida— y
 * para el mostrador de para llevar.
 *
 * LO QUE LO HACE DISTINTO DEL POS, y no es la interfaz:
 *
 *   1. **NADIE VIGILA LA PANTALLA.** No hay un mesero que corrija un error, así
 *      que el kiosco no puede permitir NADA que necesite criterio: ni
 *      descuentos, ni precios a mano, ni cortesías, ni abrir cajón. Lo que en el
 *      POS es "requiere autorización", aquí simplemente no existe.
 *
 *   2. **UN PEDIDO ABANDONADO ES LA NORMA.** Alguien empieza, se distrae y se
 *      va. Un carrito que se queda en pantalla le enseña al siguiente lo que
 *      pidió el anterior, y si además llegara a cocina, el restaurante prepara
 *      comida que nadie pidió. Por eso el kiosco se reinicia solo.
 *
 *   3. **SE PAGA ANTES DE MANDAR A COCINA.** En el salón se manda primero y se
 *      cobra al final porque el comensal está sentado y va a pagar. De pie y sin
 *      nombre no hay a quién cobrarle si se va.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";

/** Cuánto aguanta un pedido sin que nadie lo toque antes de borrarse. */
export const INACTIVIDAD_MS = 90_000;
/** Cuenta atrás visible antes de borrar, para que quien sigue ahí lo detenga. */
export const AVISO_MS = 20_000;

export type PasoKiosco =
  /** La pantalla de atracción: "Toque para ordenar". */
  | "reposo"
  /** ¿Aquí o para llevar? Cambia impuestos y empaques. */
  | "modalidad"
  | "carta"
  | "revisar"
  /** Pagar. Nada llega a cocina antes de esto. */
  | "pago"
  /** Su número de orden, para recogerlo. */
  | "listo";

export type Modalidad = "comer_aqui" | "para_llevar";

export interface EstadoKiosco {
  paso: PasoKiosco;
  modalidad: Modalidad;
  /** Última vez que el comensal tocó algo. */
  ultimo_toque_ts: number;
  /** Número que se le da para recoger, cuando ya pagó. */
  folio?: string;
}

export function kioscoEnReposo(ahora = Date.now()): EstadoKiosco {
  return { paso: "reposo", modalidad: "comer_aqui", ultimo_toque_ts: ahora };
}

export type AccionInactividad = "nada" | "avisar" | "reiniciar";

/**
 * ¿Hay que hacer algo con un pedido que lleva rato quieto?
 *
 * Nunca en la pantalla de pago ni después. Reiniciar mientras alguien está
 * tecleando su tarjeta —o peor, después de que ya cobró— sería quitarle un
 * pedido pagado, que es el peor fallo imaginable en esta máquina.
 */
export function porInactividad(
  estado: EstadoKiosco,
  ahora = Date.now(),
): AccionInactividad {
  if (estado.paso === "reposo" || estado.paso === "pago" || estado.paso === "listo") return "nada";

  const quieto = ahora - estado.ultimo_toque_ts;
  if (quieto >= INACTIVIDAD_MS) return "reiniciar";
  if (quieto >= INACTIVIDAD_MS - AVISO_MS) return "avisar";
  return "nada";
}

/** Segundos que quedan antes de reiniciar. Para la cuenta atrás en pantalla. */
export function segundosParaReiniciar(estado: EstadoKiosco, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((estado.ultimo_toque_ts + INACTIVIDAD_MS - ahora) / 1000));
}

/**
 * Lo que el kiosco NO puede hacer, nunca.
 *
 * Se declara como lista y no como comentario porque es lo que se comprueba en
 * las pruebas. Cada una de estas acciones necesita a alguien con criterio
 * delante, y en un kiosco no hay nadie.
 */
export const PROHIBIDO_EN_KIOSCO = [
  "pos.descuento.aplicar",
  "pos.cortesia.otorgar",
  // Nadie puede firmar contra la bolsa de un socio desde una pantalla sin
  // vigilancia: el socio se entera a fin de mes, y para entonces ya no hay
  // forma de saber quién estuvo delante del kiosco.
  "pos.socio.consumir",
  "pos.precio.editar_en_linea",
  "pos.item.cancelar_enviado",
  "pos.cuenta.reabrir",
  "caja.retiro.registrar",
  "caja.sesion.abrir",
] as const;

export function permitidoEnKiosco(accion: string): boolean {
  return !(PROHIBIDO_EN_KIOSCO as readonly string[]).includes(accion);
}

/**
 * El número que se le da al comensal para recoger.
 *
 * Corto y del día: tres cifras que se cantan en voz alta sin equivocarse. Un
 * UUID en la pantalla de recogida es inservible — nadie grita "el pedido
 * 8f3a-…".
 */
export function folioDeKiosco(consecutivo: number): string {
  return String((consecutivo % 999) + 1).padStart(3, "0");
}

export interface ResumenKiosco {
  articulos: number;
  subtotal: Centavos;
  total: Centavos;
}

/**
 * ¿Se puede mandar este pedido a cocina?
 *
 * Dos condiciones y las dos son obvias en cuanto se enuncian, pero se
 * comprueban aquí porque son las que impiden que la cocina prepare comida que
 * nadie va a recoger.
 */
export function puedeMandarACocina(
  estado: EstadoKiosco,
  resumen: ResumenKiosco,
  pagado: boolean,
): { puede: boolean; razon?: string } {
  if (resumen.articulos === 0) return { puede: false, razon: "No hay nada en el pedido" };
  if (!pagado) return { puede: false, razon: "El pedido todavía no se ha pagado" };
  if (estado.paso !== "pago" && estado.paso !== "listo") {
    return { puede: false, razon: "El pedido no está en el paso de pago" };
  }
  return { puede: true };
}

/** El stream donde el kiosco deja sus pedidos. */
export function streamKiosco(sucursal_id: ID): ID {
  return `kiosco:${sucursal_id}`;
}
