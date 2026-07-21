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
      tipo: "pago_registrado";
      orden_id: ID;
      monto: Centavos;
      forma: FormaPago;
      propina?: Centavos;
      referencia?: string;
    })
  | (EventoBase & {
      tipo: "cuenta_cerrada";
      orden_id: ID;
    });

export type TipoEventoComanda = EventoComanda["tipo"];
