/**
 * Sesión de caja: apertura, movimientos de efectivo y corte del turno.
 *
 * El `stream_id` de estos eventos es el `sesion_caja_id`.
 *
 * TRD §4.3: el **pre-corte** es un borrador que puede hacerse en modo isla; el
 * **corte definitivo** solo lo sella el hub, porque necesita orden total sobre
 * todos los dispositivos. Hasta la etapa 10 solo existe el pre-corte.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import type { FormaPago } from "../comanda/eventos.js";

export type MotivoMovimientoCaja = "retiro" | "ingreso" | "fondo";

export type EventoCaja =
  | (EventoBase & {
      tipo: "caja_abierta";
      sesion_id: ID;
      /** Efectivo con el que arranca el turno. */
      fondo_inicial: Centavos;
      cajero_id: ID;
    })
  | (EventoBase & {
      tipo: "movimiento_efectivo";
      sesion_id: ID;
      motivo: MotivoMovimientoCaja;
      /** Positivo entra a la caja, negativo sale. */
      monto: Centavos;
      concepto: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /** Conteo declarado por el cajero al cerrar. */
      tipo: "arqueo_registrado";
      sesion_id: ID;
      declarado: Centavos;
    })
  | (EventoBase & {
      tipo: "caja_cerrada";
      sesion_id: ID;
      /** Diferencia entre lo declarado y lo esperado (puede ser negativa). */
      diferencia: Centavos;
    });

export type TipoEventoCaja = EventoCaja["tipo"];

/** Ventas del turno agrupadas por forma de pago. */
export type VentasPorForma = Partial<Record<FormaPago, Centavos>>;
