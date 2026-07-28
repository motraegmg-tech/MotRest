/**
 * Eventos operativos de la comanda (event sourcing, TRD §5.1 y §9).
 *
 * Log append-only: cada evento es un hecho inmutable. El estado de la cuenta es
 * una PROYECCIÓN recomputable, nunca un campo que se sobrescribe.
 *
 * El `stream_id` del sobre es siempre el `orden_id`. Cada sentada de una mesa
 * genera un `orden_id` NUEVO (UUIDv7) — antes se reusaba `"cmd-" + mesa`, lo que
 * mezclaba clientes distintos en un mismo stream.
 *
 * La mesa NO guarda número de comensales (decisión de Gonzalo): solo su
 * identificador y lo que se ordenó.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { RenglonComanda } from "./renglon.js";

export type FormaPago =
  | "efectivo"
  | "tarjeta_debito"
  | "tarjeta_credito"
  | "transferencia"
  | "vale";

export const FORMAS_PAGO: { valor: FormaPago; etiqueta: string; efectivo: boolean }[] = [
  { valor: "efectivo", etiqueta: "Efectivo", efectivo: true },
  { valor: "tarjeta_debito", etiqueta: "Débito", efectivo: false },
  { valor: "tarjeta_credito", etiqueta: "Crédito", efectivo: false },
  { valor: "transferencia", etiqueta: "Transferencia", efectivo: false },
  { valor: "vale", etiqueta: "Vale", efectivo: false },
];

export function etiquetaFormaPago(forma: FormaPago): string {
  return FORMAS_PAGO.find((f) => f.valor === forma)?.etiqueta ?? forma;
}

export type EventoComanda =
  | (EventoBase & {
      tipo: "orden_creada";
      orden_id: ID;
      mesa_id: ID;
      abierta_ts: number;
    })
  | (EventoBase & {
      tipo: "item_agregado";
      orden_id: ID;
      renglon: RenglonComanda;
    })
  | (EventoBase & {
      tipo: "item_cancelado";
      orden_id: ID;
      renglon_id: ID;
      /** Empleado que autorizó (obligatorio si el renglón ya salió a cocina). */
      autorizador_id?: ID;
      motivo?: string;
    })
  | (EventoBase & {
      tipo: "items_enviados";
      orden_id: ID;
      /** Envío por tiempos: se manda un subconjunto, no la cuenta entera. */
      renglon_ids: ID[];
      curso?: number;
    })
  | (EventoBase & {
      tipo: "item_en_marcha";
      orden_id: ID;
      renglon_id: ID;
      estacion_id?: ID;
    })
  | (EventoBase & {
      tipo: "item_listo";
      orden_id: ID;
      renglon_id: ID;
    })
  | (EventoBase & {
      tipo: "item_entregado";
      orden_id: ID;
      renglon_id: ID;
    })
  | (EventoBase & {
      tipo: "item_modificado";
      orden_id: ID;
      renglon_id: ID;
      cantidad?: number;
      notas?: string;
    })
  | (EventoBase & {
      /**
       * Cocina se dio por enterada de un cambio de indicaciones.
       *
       * Es un hecho del servicio y no ruido de interfaz: deja constancia de
       * quién vio el cambio y cuándo. Si un plato sale mal por una indicación
       * tardía, la diferencia entre "no le avisaron" y "le avisaron y no lo
       * aplicó" está en este evento.
       */
      tipo: "cambio_visto";
      orden_id: ID;
      renglon_id: ID;
    })
  | (EventoBase & {
      /** Traspaso de renglones a otra cuenta (dividir o mover de mesa). */
      tipo: "item_transferido";
      orden_id: ID;
      renglon_id: ID;
      a_orden_id: ID;
    })
  | (EventoBase & {
      /** Recepción del renglón en la cuenta destino. */
      tipo: "item_recibido";
      orden_id: ID;
      renglon: RenglonComanda;
      de_orden_id: ID;
    })
  | (EventoBase & {
      tipo: "descuento_aplicado";
      orden_id: ID;
      /** Sobre un renglón concreto o sobre toda la cuenta. */
      alcance: "renglon" | "cuenta";
      renglon_id?: ID;
      /** Fracción 0..1 si es porcentaje; centavos si es monto fijo. */
      modo: "porcentaje" | "monto";
      valor: number;
      motivo: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /** La cortesía tiene semántica contable distinta al descuento. */
      tipo: "cortesia_otorgada";
      orden_id: ID;
      renglon_id?: ID;
      motivo: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      tipo: "propina_registrada";
      orden_id: ID;
      monto: Centavos;
      /** Empleado al que se le acredita, si el reparto es nominal. */
      beneficiario_id?: ID;
    })
  | (EventoBase & {
      tipo: "pago_registrado";
      orden_id: ID;
      monto: Centavos;
      forma: FormaPago;
      /** Efectivo recibido, para calcular el cambio. */
      recibido?: Centavos;
      referencia?: string;
      sesion_caja_id?: ID;
    })
  | (EventoBase & {
      /**
       * A nombre de quién va el pedido.
       *
       * Nace para los pedidos PARA LLEVAR, donde no hay una mesa que sirva de
       * referencia: sin un nombre, cocina prepara y nadie sabe de quién es la
       * bolsa que está en el mostrador. También sirve en mesa —una cuenta a
       * nombre del cliente frecuente— y por eso no se ata a "llevar".
       *
       * El nombre viaja como dato y no solo como `cliente_id`: la mayoría de
       * los pedidos para llevar son de alguien que no está registrado, y
       * obligar a darlo de alta para poder venderle sería absurdo.
       */
      tipo: "orden_identificada";
      orden_id: ID;
      nombre: string;
      telefono?: string;
      /** Cliente del catálogo, cuando el pedido es de alguien ya registrado. */
      cliente_id?: ID;
    })
  | (EventoBase & {
      tipo: "cuenta_cerrada";
      orden_id: ID;
    });

export type TipoEventoComanda = EventoComanda["tipo"];
