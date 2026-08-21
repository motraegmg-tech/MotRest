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
  | "vale"
  /** Lo cobró un agregador. NO entra al cajón: se deposita días después. */
  | "agregador"
  /**
   * Lo cubrió el saldo mensual de un socio del restaurante.
   *
   * Es una FORMA DE PAGO y no una cortesía, y esa es toda la decisión: la venta
   * vale lo que vale —el socio consumió ese producto— y por eso sigue contando
   * completa en finanzas y en inteligencia. Lo que cambia es de dónde salió el
   * dinero: del saldo pactado con el socio, no del cajón. Registrarlo como
   * cortesía habría borrado la venta de los reportes y falseado el consumo real
   * del local, que es justo lo que hay que poder medir.
   */
  | "socio";

export const FORMAS_PAGO: {
  valor: FormaPago;
  etiqueta: string;
  efectivo: boolean;
  /** false = no se elige a mano al cobrar; la registra otro flujo. */
  manual?: boolean;
}[] = [
  { valor: "efectivo", etiqueta: "Efectivo", efectivo: true },
  { valor: "tarjeta_debito", etiqueta: "Débito", efectivo: false },
  { valor: "tarjeta_credito", etiqueta: "Crédito", efectivo: false },
  { valor: "transferencia", etiqueta: "Transferencia", efectivo: false },
  { valor: "vale", etiqueta: "Vale", efectivo: false },
  { valor: "agregador", etiqueta: "Cobrado por la app", efectivo: false },
  // No se ofrece como botón de cobro: exige decir QUÉ socio, y eso vive en su
  // propio panel. Un «Socio» suelto en la lista de formas de pago sería un
  // agujero por el que se cobra sin cargarle el consumo a nadie.
  { valor: "socio", etiqueta: "Consumo de socio", efectivo: false, manual: false },
];

/** Las formas que se pueden elegir a mano en la pantalla de cobro. */
export const FORMAS_PAGO_MANUALES = FORMAS_PAGO.filter((f) => f.manual !== false);

export function etiquetaFormaPago(forma: FormaPago): string {
  return FORMAS_PAGO.find((f) => f.valor === forma)?.etiqueta ?? forma;
}

/** Dinero que se le regresa al comensal al cancelar una venta ya cobrada. */
export interface Devolucion {
  forma: FormaPago;
  monto: Centavos;
}

export type EventoComanda =
  | (EventoBase & {
      tipo: "orden_creada";
      orden_id: ID;
      mesa_id: ID;
      abierta_ts: number;
      /**
       * Por dónde entró la venta. Ausente = salón, que es el caso normal y el
       * que ya escribieron todos los eventos anteriores a esto.
       */
      canal?: import("../ventas/canales.js").CanalVenta;
      /** Folio del pedido en la plataforma, para poder conciliar el depósito. */
      folio_externo?: string;
      /** Comisión pactada EN ESE MOMENTO. Se congela: mañana puede cambiar. */
      comision_canal?: number;
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
      /**
       * De qué promoción vino, si vino de una.
       *
       * Una promoción decide el importe pero el descuento se REGISTRA: el
       * ticket, el corte y el CFDI salen del log, no del reloj. Guardar de qué
       * promoción vino y a qué renglones cubrió es lo que evita aplicarla dos
       * veces cuando llegan platillos nuevos a la misma cuenta.
       */
      promocion_id?: ID;
      renglones_cubiertos?: ID[];
    })
  | (EventoBase & {
      /**
       * Se retira un descuento ya aplicado.
       *
       * Hace falta porque una promoción se aplica con un toque y hasta ahora no
       * se podía deshacer: aplicar la equivocada obligaba a cancelar la cuenta
       * entera. Se identifica por el **id del evento que la aplicó**, y no por
       * la promoción, porque la misma promoción puede haberse aplicado dos veces
       * en la misma cuenta —una por ronda— y quitar «el 2×1» tendría que
       * significar quitar uno, no los dos.
       */
      tipo: "descuento_retirado";
      orden_id: ID;
      /** El `id` del evento `descuento_aplicado` que se deshace. */
      descuento_id: ID;
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
      /**
       * Se retira una cortesía ya otorgada.
       *
       * Se otorga con un botón, así que se quita con el mismo botón: pulsar
       * «Cortesía» dos veces por error dejaba la cuenta en cero sin ninguna
       * forma de deshacerlo salvo cancelar renglón por renglón.
       *
       * NO borra el hecho anterior —el log solo agrega— sino que registra el
       * retiro. En la bitácora quedan las dos cosas, que es lo que permite ver
       * a quién se le regaló la cuenta y quién se lo quitó.
       */
      tipo: "cortesia_retirada";
      orden_id: ID;
      /** Ausente = la cortesía de la cuenta completa. */
      renglon_id?: ID;
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
      /**
       * A qué socio se le carga, cuando la forma es `socio`.
       *
       * Sin esto el consumo no se le puede descontar a nadie de su saldo del
       * mes, y «Consumo de socio» sería una forma de sacar producto sin dueño.
       */
      socio_id?: ID;
      autorizador_id?: ID;
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
    })
  | (EventoBase & {
      /**
       * La sentada se cierra SIN consumo: la mesa vuelve a estar libre.
       *
       * Pasa todos los días: se pone una mesa en servicio, los comensales se
       * mueven a otra o se van antes de pedir, y esa mesa se quedaba ocupada
       * para siempre porque la única forma de liberarla era cobrarla. Solo se
       * puede anular una cuenta sin renglones y sin pagos — con consumo, lo que
       * corresponde es cancelar los renglones o cobrar.
       *
       * NO es una venta y no cuenta como cuenta en ningún reporte, que es
       * exactamente por lo que no se reusa `cuenta_cerrada`: veinte mesas
       * abiertas por error habrían aparecido como veinte cuentas de cero pesos
       * y hundido el ticket promedio de la jornada.
       */
      tipo: "orden_anulada";
      orden_id: ID;
      motivo?: string;
    })
  | (EventoBase & {
      /**
       * Se vuelve a abrir una cuenta ya cobrada.
       *
       * Pasa en cualquier servicio: se cobró de más, el cliente quiere agregar
       * un postre después de pedir la cuenta, o se cobró en la mesa equivocada.
       * Sin esto la única salida es cobrar otra vez y descuadrar el corte.
       *
       * NO borra nada. Los pagos ya registrados siguen en la cuenta —fueron
       * hechos— y hay que devolverlos explícitamente si corresponde. Reabrir sin
       * dejar rastro sería la forma más limpia de sacar dinero de una caja.
       */
      tipo: "cuenta_reabierta";
      orden_id: ID;
      motivo: string;
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /**
       * Se CANCELA una venta ya cobrada: se devuelve el dinero y deja de contar.
       *
       * Es lo que faltaba para cerrar el círculo de `cuenta_reabierta`. Reabrir
       * deja la cuenta viva otra vez con sus pagos dentro, y hasta aquí la única
       * salida era volver a cobrarla. Cuando lo correcto era deshacer el cobro
       * —se cobró la mesa equivocada, el cliente se arrepintió, el cargo salió
       * mal— no había ninguna: cancelar los renglones dejaba la cuenta con
       * `total = 0` y los pagos intactos, o sea **saldo negativo y la mesa
       * ocupada para siempre**. Le pasó a la mesa 8 de Rodizio el 2026-08-15.
       *
       * NO borra nada, como todo en este log. El cobro ocurrió y ahí sigue; lo
       * que se registra es que se deshizo y con qué dinero. De ahí que las
       * `devoluciones` viajen en el evento en vez de deducirse al proyectar: el
       * corte de caja tiene que saber cuánto efectivo SALIÓ del cajón hoy,
       * aunque la venta se hubiera cobrado en el turno de antier.
       *
       * Cierra la sentada —la mesa se libera— y marca la cuenta `cancelada`,
       * que es lo que la saca de todos los reportes. Se distingue de
       * `orden_anulada` en que ahí no hubo consumo ni dinero; aquí hubo los dos.
       */
      tipo: "venta_cancelada";
      orden_id: ID;
      motivo: string;
      autorizador_id?: ID;
      /**
       * Lo que se le devuelve al comensal, por forma de pago.
       *
       * Va explícito y no como «todo lo cobrado» porque el papel que firma la
       * devolución tiene que decir cuánto salió en efectivo y cuánto se
       * reversó por terminal: no son la misma gestión ni el mismo día.
       */
      devoluciones: Devolucion[];
    })
  | (EventoBase & {
      /**
       * Se volvió a imprimir el ticket de una cuenta.
       *
       * Se registra porque una reimpresión es un clásico vector de fraude: se
       * cobra, se entrega el ticket, se reimprime y se cobra otra vez con el
       * mismo papel. El papel lleva impreso «REIMPRESIÓN #n» y el hecho queda
       * en la bitácora; ninguna de las dos cosas por separado basta.
       */
      tipo: "ticket_reimpreso";
      orden_id: ID;
      /** Cuántas veces se ha reimpreso, contando esta. */
      numero: number;
    });

export type TipoEventoComanda = EventoComanda["tipo"];
