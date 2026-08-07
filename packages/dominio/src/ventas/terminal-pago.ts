/**
 * Pagos integrados: la terminal bancaria conectada al POS (F5).
 *
 * QUÉ RESUELVE. Hoy el cajero teclea el monto en la terminal a mano. Eso produce
 * dos problemas que el restaurante paga todos los días: se teclea mal —y se
 * cobra de menos o de más— y al cerrar la caja nadie sabe qué cargo del banco
 * corresponde a qué cuenta. Conectada, el monto va del ticket a la terminal y la
 * autorización vuelve al ticket.
 *
 * LA DECISIÓN QUE GOBIERNA ESTE ARCHIVO: **no se ata a ningún proveedor.**
 *
 * MotRest no sabe si el restaurante usa Clip, Mercado Pago, Getnet, Netpay o la
 * terminal que le dio su banco — y no debe saberlo. Cada restaurante ya tiene
 * contrato con alguien, y pedirle que lo cambie para usar el POS es pedirle que
 * renegocie sus comisiones. Aquí se define QUÉ significa cobrar con terminal; el
 * cómo lo implementa un adaptador por proveedor.
 *
 * LO QUE NUNCA PUEDE PASAR, Y ORDENA TODO LO DEMÁS:
 *
 *   1. **Cobrar dos veces.** Si la terminal no contesta, el cajero no sabe si el
 *      cargo pasó. Volver a intentar a ciegas es duplicar el cobro a un cliente
 *      que ya pagó. Por eso cada intento lleva una `referencia` única y se
 *      CONSULTA antes de reintentar.
 *
 *   2. **Dar por cobrado lo que no se cobró.** Una autorización sin número de
 *      autorización del banco no es una autorización. Se rechaza.
 *
 *   3. **Que la terminal bloquee el servicio.** Si se cae, el cajero cobra a
 *      mano en la terminal física y lo registra como siempre. La integración es
 *      una comodidad; la venta no.
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";

/** Con qué proveedor habla el adaptador. Solo para saber qué configurar. */
export type ProveedorPago = "clip" | "mercadopago" | "getnet" | "netpay" | "banco" | "otro";

export interface DefinicionProveedor {
  id: ProveedorPago;
  nombre: string;
  /** Cómo se conecta, dicho para quien va a instalarlo. */
  conexion: string;
}

export const PROVEEDORES_PAGO: DefinicionProveedor[] = [
  { id: "clip", nombre: "Clip", conexion: "Terminal por Bluetooth o su API en la nube" },
  { id: "mercadopago", nombre: "Mercado Pago Point", conexion: "API de Point sobre internet" },
  { id: "getnet", nombre: "Getnet (Santander)", conexion: "Terminal en la red del local" },
  { id: "netpay", nombre: "NetPay", conexion: "Terminal en la red del local" },
  { id: "banco", nombre: "Terminal del banco", conexion: "Depende del banco; suele ser manual" },
  { id: "otro", nombre: "Otra", conexion: "Se cobra a mano y se registra en el POS" },
];

/** Qué se le pide a la terminal. */
export interface PeticionCobro {
  /**
   * Identificador único de ESTE intento, generado por el POS.
   *
   * Es lo que hace idempotente el cobro: si la red se cae después de que el
   * banco autorizó, el POS pregunta por esta referencia en vez de volver a
   * cobrar. Sin ella no hay forma de distinguir "no se cobró" de "se cobró y no
   * me enteré", y esas dos cosas se parecen mucho desde fuera.
   */
  referencia: ID;
  orden_id: ID;
  importe: Centavos;
  /** Propina que el comensal decide en la terminal, si el proveedor lo permite. */
  admite_propina?: boolean;
  /** Meses sin intereses. 0 = pago normal. */
  meses?: number;
}

export type EstadoTransaccion =
  /** Se mandó a la terminal y está esperando a que el cliente pase la tarjeta. */
  | "esperando"
  /** El banco autorizó. Hay número de autorización. */
  | "aprobado"
  /** El banco rechazó: fondos, tarjeta vencida, lo que sea. */
  | "rechazado"
  /** El cliente o el cajero canceló antes de terminar. */
  | "cancelado"
  /**
   * No se sabe. La terminal no contestó a tiempo.
   *
   * ES EL ESTADO MÁS IMPORTANTE DE LA LISTA y el que casi todos los sistemas
   * olvidan. No es un fallo: es no saber. Tratarlo como rechazo cobra dos veces;
   * tratarlo como aprobado regala comida. Lo único correcto es CONSULTAR.
   */
  | "desconocido";

export interface ResultadoCobro {
  referencia: ID;
  estado: EstadoTransaccion;
  /** Número de autorización del banco. Sin esto no hay cobro. */
  autorizacion?: string;
  /** Últimos 4 dígitos, para el ticket y para conciliar. */
  ultimos4?: string;
  /** Débito o crédito, según lo que resultó ser la tarjeta. */
  tipo_tarjeta?: "debito" | "credito";
  /** Lo que de verdad se cobró: puede traer propina que el POS no sabía. */
  importe?: Centavos;
  propina?: Centavos;
  /** Qué decirle al cajero si algo salió mal. */
  mensaje?: string;
}

/**
 * Lo que implementa cada adaptador de proveedor.
 *
 * Tres operaciones y ninguna más. `consultar` es la que hace que esto sea
 * seguro: sin ella, un tiempo de espera agotado obliga a adivinar.
 */
export interface TerminalPago {
  proveedor: ProveedorPago;
  cobrar(peticion: PeticionCobro): Promise<ResultadoCobro>;
  /** ¿Qué pasó con este intento? Se llama tras un `desconocido`. */
  consultar(referencia: ID): Promise<ResultadoCobro>;
  /** Devuelve un cobro ya hecho. No todos los proveedores lo permiten. */
  cancelar?(referencia: ID, autorizacion: string): Promise<ResultadoCobro>;
}

export type VeredictoCobro =
  | { registrar: true; resultado: ResultadoCobro }
  | { registrar: false; motivo: string; reintentable: boolean };

/**
 * ¿Se puede dar este cobro por bueno y registrarlo en la cuenta?
 *
 * Es la única puerta por la que debe pasar un resultado de terminal. Está aparte
 * del adaptador a propósito: así la regla es una sola para todos los
 * proveedores, y se puede probar sin ninguna terminal delante.
 */
export function evaluarCobro(resultado: ResultadoCobro): VeredictoCobro {
  switch (resultado.estado) {
    case "aprobado":
      /*
       * UNA APROBACIÓN SIN NÚMERO DE AUTORIZACIÓN NO ES UNA APROBACIÓN. Pasa con
       * adaptadores mal escritos y con respuestas cortadas a la mitad; si se
       * acepta, el restaurante cree que cobró y el banco no le deposita nada.
       */
      if (!resultado.autorizacion?.trim()) {
        return {
          registrar: false,
          motivo: "La terminal dijo que aprobó pero no dio número de autorización",
          reintentable: false,
        };
      }
      return { registrar: true, resultado };

    case "rechazado":
      return {
        registrar: false,
        motivo: resultado.mensaje ?? "La terminal rechazó el cobro",
        reintentable: true,
      };

    case "cancelado":
      return { registrar: false, motivo: "El cobro se canceló", reintentable: true };

    case "esperando":
      return { registrar: false, motivo: "La terminal sigue esperando la tarjeta", reintentable: false };

    case "desconocido":
      /*
       * NO REINTENTABLE, y es la decisión que evita el doble cobro. Hay que
       * CONSULTAR con la misma referencia; ofrecer "reintentar" aquí es ofrecer
       * cobrarle otra vez a alguien que quizá ya pagó.
       */
      return {
        registrar: false,
        motivo: "No se sabe si el cobro pasó. Consulta antes de volver a intentar.",
        reintentable: false,
      };
  }
}

/**
 * Qué hacer cuando la terminal no contestó.
 *
 * Se consulta, con espera creciente. Si tras todos los intentos sigue sin
 * saberse, se le dice al cajero que lo verifique en la terminal física — que es
 * lo honesto: el sistema no lo sabe, y fingir que sí es lo que produce el doble
 * cobro.
 */
export const ESPERAS_CONSULTA_MS = [1_000, 3_000, 8_000] as const;

export async function resolverDesconocido(
  terminal: TerminalPago,
  referencia: ID,
  esperar: (ms: number) => Promise<void>,
): Promise<ResultadoCobro> {
  let ultimo: ResultadoCobro = { referencia, estado: "desconocido" };

  for (const espera of ESPERAS_CONSULTA_MS) {
    await esperar(espera);
    try {
      ultimo = await terminal.consultar(referencia);
      if (ultimo.estado !== "desconocido" && ultimo.estado !== "esperando") return ultimo;
    } catch {
      // La consulta también puede fallar. Se sigue intentando: es justo el caso
      // en el que hay una red inestable de por medio.
    }
  }

  return {
    ...ultimo,
    estado: "desconocido",
    mensaje:
      "No se pudo confirmar con la terminal. Revisa en el aparato si el cobro pasó " +
      "ANTES de volver a cobrar.",
  };
}

/** La forma de pago que corresponde a lo que resultó ser la tarjeta. */
export function formaPagoDe(resultado: ResultadoCobro): "tarjeta_debito" | "tarjeta_credito" {
  return resultado.tipo_tarjeta === "credito" ? "tarjeta_credito" : "tarjeta_debito";
}

/** Configuración por local. La credencial NO vive aquí: se queda en el Hub. */
export interface ConfiguracionTerminal {
  proveedor: ProveedorPago;
  /** true = el POS manda el monto. false = se teclea a mano, como siempre. */
  integrada: boolean;
  /** Dirección de la terminal en la red del local, si aplica. */
  host?: string;
  puerto?: number;
  /** Si el comensal puede dejar propina en la terminal. */
  propina_en_terminal?: boolean;
  /** Meses sin intereses que ofrece el restaurante. */
  meses_disponibles?: number[];
}

export function configuracionTerminalVacia(): ConfiguracionTerminal {
  // Sin integrar: es lo que hay hoy en todos los restaurantes, y arrancar
  // prometiendo una integración que nadie configuró rompe el cobro el día uno.
  return { proveedor: "otro", integrada: false };
}

export type EventoTerminal =
  | (EventoBase & {
      tipo: "cobro_terminal_aprobado";
      orden_id: ID;
      referencia: ID;
      autorizacion: string;
      importe: Centavos;
      propina?: Centavos;
      ultimos4?: string;
      proveedor: ProveedorPago;
    })
  | (EventoBase & {
      tipo: "cobro_terminal_fallido";
      orden_id: ID;
      referencia: ID;
      estado: EstadoTransaccion;
      motivo: string;
    });

export function streamTerminal(sucursal_id: ID): ID {
  return `terminal:${sucursal_id}`;
}
