/**
 * Socios e inversionistas del restaurante, y los beneficios que tienen pactados.
 *
 * ## Por qué es un módulo propio y no una etiqueta del cliente
 *
 * Un socio no es un comensal frecuente: es alguien que puso dinero en el
 * negocio y a cambio tiene DERECHOS sobre él. Lo que consume no se le cobra
 * porque ya está pagado en el trato, no porque se le esté haciendo un favor.
 * Guardarlo en la ficha del comensal habría metido información societaria —quién
 * es dueño de qué parte— en una pantalla que ve cualquiera que atienda mesas.
 *
 * ## La regla que gobierna todo esto
 *
 * **El consumo de un socio ES una venta.** Se registra a precio de carta y sigue
 * contando completo en finanzas y en inteligencia; lo único distinto es de dónde
 * salió el dinero: de su bolsa mensual y no del cajón (ver la forma de pago
 * `socio` en `comanda/eventos.ts`). Tratarlo como cortesía habría borrado esas
 * ventas de los reportes, y entonces el food cost, el consumo de insumos y el
 * ticket promedio del local dirían cosas que no son ciertas — precisamente en un
 * restaurante donde los socios comen seguido.
 *
 * ## La bolsa se mide contra el log, no se guarda
 *
 * No hay un campo «saldo». Lo consumido en el mes se SUMA de los pagos con forma
 * `socio` de ese socio, igual que el resto del sistema deriva su estado del event
 * log (ADR-02). Un saldo guardado se desincroniza en cuanto una terminal cobra
 * en isla y sincroniza más tarde.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import type { EventoBase } from "../evento.js";

// --- Beneficios ------------------------------------------------------------------------

/**
 * Qué puede tener pactado un socio.
 *
 * Son SEIS tipos cerrados y no un texto libre a propósito: un beneficio que el
 * sistema no entiende es un beneficio que el mesero tiene que interpretar en la
 * mesa, y ahí es donde se regala de más. Cada tipo dice cómo se mide y qué hace
 * el POS con él.
 */
export type TipoBeneficio =
  /** Bolsa de consumo al mes: puede gastar hasta ese monto sin pagar. */
  | "saldo_mensual"
  /** Descuento fijo sobre toda su cuenta, se identifique cuando se identifique. */
  | "descuento_permanente"
  /** Cuántos acompañantes al mes consumen también contra su bolsa. */
  | "invitados_mes"
  /** Mesa garantizada sin reservar y prioridad en la lista de espera. */
  | "mesa_preferente"
  /** Comida de cumpleaños de cortesía, para él y N acompañantes, una vez al año. */
  | "cumpleanos"
  /** Consumo a crédito: firma y liquida a fin de mes, hasta un tope. */
  | "credito_mensual";

/** Cómo se lee el `valor` de cada beneficio. */
export type UnidadBeneficio = "dinero" | "porcentaje" | "personas" | "bandera";

export interface DefinicionBeneficio {
  tipo: TipoBeneficio;
  nombre: string;
  unidad: UnidadBeneficio;
  /** Qué significa para el restaurante, en una línea. */
  descripcion: string;
  /** Qué hace el POS con él hoy. Lo que no opera, se dice. */
  efecto: string;
}

export const BENEFICIOS_SOCIO: DefinicionBeneficio[] = [
  {
    tipo: "saldo_mensual",
    nombre: "Bolsa de consumo al mes",
    unidad: "dinero",
    descripcion: "Puede consumir hasta este monto cada mes sin pagar.",
    efecto: "En la cuenta aparece «Cortesía por socio»: se cobra contra su bolsa y la venta cuenta completa.",
  },
  {
    tipo: "descuento_permanente",
    nombre: "Descuento permanente",
    unidad: "porcentaje",
    descripcion: "Rebaja fija sobre su cuenta, se acabe o no la bolsa del mes.",
    efecto: "Se aplica como descuento de la cuenta al identificarlo como socio.",
  },
  {
    tipo: "invitados_mes",
    nombre: "Invitados al mes",
    unidad: "personas",
    descripcion: "Cuántos acompañantes puede traer con el mismo beneficio cada mes.",
    efecto: "Informativo en la mesa: el consumo de la mesa entra a la misma bolsa.",
  },
  {
    tipo: "mesa_preferente",
    nombre: "Mesa preferente",
    unidad: "bandera",
    descripcion: "Mesa garantizada sin reservar y prioridad en la lista de espera.",
    efecto: "Se avisa al abrir la mesa. No mueve dinero.",
  },
  {
    tipo: "cumpleanos",
    nombre: "Comida de cumpleaños",
    unidad: "personas",
    descripcion: "Una comida al año de cortesía, para él y este número de acompañantes.",
    efecto: "Se registra como cortesía de la casa el día que se usa.",
  },
  {
    tipo: "credito_mensual",
    nombre: "Consumo a crédito",
    unidad: "dinero",
    descripcion: "Puede firmar y liquidar a fin de mes, hasta este tope.",
    efecto: "Amplía el tope de «Cortesía por socio» más allá de la bolsa; lo firmado se cobra después.",
  },
];

const INDICE_BENEFICIOS = new Map(BENEFICIOS_SOCIO.map((b) => [b.tipo, b]));

export function definicionBeneficio(tipo: TipoBeneficio): DefinicionBeneficio | undefined {
  return INDICE_BENEFICIOS.get(tipo);
}

export interface BeneficioSocio {
  tipo: TipoBeneficio;
  /**
   * Centavos si la unidad es dinero, fracción 0..1 si es porcentaje, un entero
   * si son personas, y 1 si es una bandera.
   */
  valor: number;
  /** Condiciones del trato: "solo de lunes a jueves", "sin bebidas". */
  nota?: string;
}

// --- El socio ---------------------------------------------------------------------------

export interface DatosSocio {
  nombre: string;
  telefono?: string;
  correo?: string;
  /** Participación en el negocio, fracción 0..1. Solo informativa. */
  participacion?: number;
  /** Día de cumpleaños, "MM-DD". Lo pide el beneficio de cumpleaños. */
  cumpleanos?: string;
  beneficios: BeneficioSocio[];
  notas?: string;
}

export interface Socio extends DatosSocio {
  socio_id: ID;
  activo: boolean;
  registrado_ts: number;
}

export type EventoSocio =
  | (EventoBase & {
      tipo: "socio_registrado";
      socio_id: ID;
      datos: DatosSocio;
    })
  | (EventoBase & {
      tipo: "socio_actualizado";
      socio_id: ID;
      cambios: Partial<DatosSocio>;
    })
  | (EventoBase & {
      /** Se da de baja, no se borra: sus consumos pasados apuntan a él. */
      tipo: "socio_desactivado";
      socio_id: ID;
      motivo?: string;
    })
  | (EventoBase & {
      tipo: "socio_reactivado";
      socio_id: ID;
    });

export type TipoEventoSocio = EventoSocio["tipo"];

export const TIPOS_EVENTO_SOCIO: readonly TipoEventoSocio[] = [
  "socio_registrado",
  "socio_actualizado",
  "socio_desactivado",
  "socio_reactivado",
];

/** Stream al que van los socios de una sucursal. */
export function streamSocios(sucursal_id: ID): ID {
  return `socios:${sucursal_id}`;
}

export function proyectarSocios(eventos: readonly EventoSocio[]): Socio[] {
  const porId = new Map<ID, Socio>();

  for (const ev of eventos) {
    switch (ev.tipo) {
      case "socio_registrado":
        // Reaplicar un alta no pisa lo editado: una resincronización reenvía
        // eventos viejos con toda normalidad.
        if (porId.has(ev.socio_id)) break;
        porId.set(ev.socio_id, {
          socio_id: ev.socio_id,
          ...ev.datos,
          activo: true,
          registrado_ts: ev.ts,
        });
        break;
      case "socio_actualizado": {
        const previo = porId.get(ev.socio_id);
        if (previo) porId.set(ev.socio_id, { ...previo, ...ev.cambios });
        break;
      }
      case "socio_desactivado": {
        const previo = porId.get(ev.socio_id);
        if (previo) porId.set(ev.socio_id, { ...previo, activo: false });
        break;
      }
      case "socio_reactivado": {
        const previo = porId.get(ev.socio_id);
        if (previo) porId.set(ev.socio_id, { ...previo, activo: true });
        break;
      }
    }
  }

  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function sociosActivos(socios: readonly Socio[]): Socio[] {
  return socios.filter((s) => s.activo);
}

export function beneficioDe(socio: Socio, tipo: TipoBeneficio): BeneficioSocio | undefined {
  return socio.beneficios.find((b) => b.tipo === tipo);
}

export function valorBeneficio(socio: Socio, tipo: TipoBeneficio): number {
  return beneficioDe(socio, tipo)?.valor ?? 0;
}

// --- La bolsa del mes -------------------------------------------------------------------

/**
 * El mes natural al que pertenece un momento.
 *
 * La bolsa se cuenta por mes de CALENDARIO y no por treinta días corridos: es
 * como se pacta de viva voz («tienes cinco mil al mes») y como lo revisa el
 * socio. Una ventana móvil obligaría a explicar por qué el día 3 ya no le queda.
 */
export function mesDe(ts: number): { desde: number; hasta: number } {
  const d = new Date(ts);
  return {
    desde: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    hasta: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

/**
 * Lo que este socio lleva consumido contra su bolsa en el periodo.
 *
 * Se suma de los PAGOS con forma `socio`, que es el registro de lo que de verdad
 * se le cargó. Las cuentas anuladas no cuentan —no hubo consumo— y las abiertas
 * tampoco: lo que sigue en la mesa todavía puede cambiar.
 */
export function consumidoPorSocio(
  comandas: readonly EstadoComanda[],
  socioId: ID,
  rango: { desde: number; hasta: number },
): Centavos {
  let total = CERO;
  for (const c of comandas) {
    if (!c.cerrada || c.anulada) continue;
    const ts = c.cerrada_ts ?? c.abierta_ts;
    if (ts < rango.desde || ts >= rango.hasta) continue;
    for (const pago of c.pagos) {
      if (pago.forma === "socio" && pago.socio_id === socioId) {
        total = sumar(total, pago.monto);
      }
    }
  }
  return total;
}

export interface BolsaSocio {
  /** Lo pactado al mes (bolsa + crédito, que es lo que de verdad puede firmar). */
  tope: Centavos;
  /** De ese tope, cuánto es bolsa de consumo y cuánto es crédito a liquidar. */
  saldo_mensual: Centavos;
  credito: Centavos;
  consumido: Centavos;
  disponible: Centavos;
}

/**
 * Cuánto le queda a un socio este mes.
 *
 * El tope suma la bolsa y el crédito porque las dos cosas se firman igual en la
 * mesa; la diferencia aparece después, cuando la bolsa no se cobra y el crédito
 * sí. Separarlas en la mesa habría obligado al mesero a decidir de cuál sale,
 * que no es su decisión.
 */
export function bolsaDelMes(
  socio: Socio,
  comandas: readonly EstadoComanda[],
  ahora = Date.now(),
): BolsaSocio {
  const saldo = Math.max(0, valorBeneficio(socio, "saldo_mensual")) as Centavos;
  const credito = Math.max(0, valorBeneficio(socio, "credito_mensual")) as Centavos;
  const tope = sumar(saldo, credito);
  const consumido = consumidoPorSocio(comandas, socio.socio_id, mesDe(ahora));

  return {
    tope,
    saldo_mensual: saldo,
    credito,
    consumido,
    disponible: consumido >= tope ? CERO : restar(tope, consumido),
  };
}

/**
 * ¿Se le puede cargar este monto al socio ahora mismo?
 *
 * Devuelve el motivo cuando no, para poder decirlo en la mesa en vez de dejar un
 * botón que no hace nada.
 */
export function problemaConsumoSocio(
  socio: Socio,
  monto: Centavos,
  bolsa: BolsaSocio,
): string | null {
  if (!socio.activo) return `${socio.nombre} ya no es socio activo`;
  if (monto <= 0) return "Escribe cuánto se le carga al socio";
  if (bolsa.tope <= 0) return `${socio.nombre} no tiene bolsa de consumo pactada`;
  if (monto > bolsa.disponible) {
    return `A ${socio.nombre} le quedan ${(bolsa.disponible / 100).toFixed(2)} este mes`;
  }
  return null;
}
