/**
 * Reducers de la comanda: reconstruyen el estado (proyección) desde el log de
 * eventos. Estado inmutable — cada evento produce un objeto nuevo (ADR-02).
 */
import { sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EventoComanda, FormaPago } from "./eventos.js";
import { estaActivo, type EstadoRenglon, type RenglonComanda } from "./renglon.js";

export interface Pago {
  monto: Centavos;
  forma: FormaPago;
  recibido?: Centavos;
  referencia?: string;
}

export interface Descuento {
  alcance: "renglon" | "cuenta";
  renglon_id?: ID;
  modo: "porcentaje" | "monto";
  valor: number;
  motivo: string;
  autorizador_id?: ID;
}

export interface Cortesia {
  renglon_id?: ID;
  motivo: string;
  autorizador_id?: ID;
}

/** Proyección del estado de una comanda. Sin `personas` (decisión de Gonzalo). */
export interface EstadoComanda {
  orden_id: ID;
  mesa_id: ID;
  /** Empleado que abrió la mesa (viene del sobre del evento). */
  mesero_id: ID;
  abierta_ts: number;
  renglones: RenglonComanda[];
  cerrada: boolean;
  /** Momento del cobro. Es la hora que cuenta como venta. */
  cerrada_ts?: number;
  /**
   * A nombre de quién va el pedido. Presente sobre todo en los de PARA LLEVAR,
   * donde no hay una mesa que sirva de referencia.
   */
  a_nombre_de?: string;
  telefono?: string;
  cliente_id?: ID;
  pagos: Pago[];
  descuentos: Descuento[];
  cortesias: Cortesia[];
  propina: Centavos;
}

/**
 * Quita la marca de "la nota cambió".
 *
 * Se usa cuando cocina la da por vista y cuando el platillo queda listo: un
 * plato terminado ya no puede incorporar el cambio, así que dejar la alarma
 * encendida solo estorbaría al siguiente que mire el tablero.
 */
function sinMarcaDeCambio(renglon: RenglonComanda): RenglonComanda {
  if (renglon.notas_cambiadas_ts === undefined) return renglon;
  const { notas_cambiadas_ts: _visto, ...resto } = renglon;
  return resto;
}

/** Cambia el estado de un renglón concreto, dejando el resto intacto. */
function conEstadoRenglon(
  estado: EstadoComanda,
  renglonId: ID,
  nuevo: EstadoRenglon,
  extra?: Partial<RenglonComanda>,
): EstadoComanda {
  return {
    ...estado,
    renglones: estado.renglones.map((r) => {
      if (r.id !== renglonId) return r;
      const base = { ...r, ...extra, estado: nuevo };
      /*
       * Un platillo terminado ya no puede incorporar un cambio de nota, así
       * que la alarma se apaga sola al marcarlo listo. Dejarla encendida solo
       * estorbaría al siguiente que mire el tablero.
       */
      return nuevo === "listo" || nuevo === "entregado" || nuevo === "cancelado"
        ? sinMarcaDeCambio(base)
        : base;
    }),
  };
}

/** Aplica un evento al estado y devuelve el nuevo estado (puro, inmutable). */
export function aplicarEvento(
  estado: EstadoComanda | null,
  ev: EventoComanda,
): EstadoComanda {
  if (ev.tipo === "orden_creada") {
    return {
      orden_id: ev.orden_id,
      mesa_id: ev.mesa_id,
      mesero_id: ev.empleado_id,
      abierta_ts: ev.abierta_ts,
      renglones: [],
      cerrada: false,
      pagos: [],
      descuentos: [],
      cortesias: [],
      propina: 0 as Centavos,
    };
  }

  if (!estado) {
    throw new Error(`Evento "${ev.tipo}" sin comanda previa: falta orden_creada`);
  }

  switch (ev.tipo) {
    case "item_agregado":
      return { ...estado, renglones: [...estado.renglones, ev.renglon] };

    case "item_cancelado":
      return conEstadoRenglon(estado, ev.renglon_id, "cancelado");

    case "items_enviados": {
      const aEnviar = new Set(ev.renglon_ids);
      return {
        ...estado,
        renglones: estado.renglones.map((r) =>
          aEnviar.has(r.id) && r.estado === "capturado"
            ? {
                ...r,
                estado: "enviado" as const,
                curso: ev.curso ?? r.curso,
                enviado_ts: ev.ts,
              }
            : r,
        ),
      };
    }

    case "item_en_marcha":
      return conEstadoRenglon(estado, ev.renglon_id, "en_marcha", {
        estacion_id: ev.estacion_id,
        en_marcha_ts: ev.ts,
      });

    case "item_listo":
      return conEstadoRenglon(estado, ev.renglon_id, "listo", { listo_ts: ev.ts });

    case "item_entregado":
      return conEstadoRenglon(estado, ev.renglon_id, "entregado", { entregado_ts: ev.ts });

    case "item_modificado":
      return {
        ...estado,
        renglones: estado.renglones.map((r) => {
          if (r.id !== ev.renglon_id) return r;

          /*
           * Si la nota cambia cuando el platillo YA se fue a cocina, se marca.
           * El cocinero leyó el ticket una vez y no vuelve a mirarlo: sin esta
           * marca, un "sin tomate" dicho tarde se pierde y el plato regresa.
           *
           * Solo cuenta si la nota cambió de verdad. Reenviar la misma no es
           * un cambio, y encender la alarma por nada enseña a ignorarla.
           */
          const cambioLaNota = ev.notas !== undefined && ev.notas !== r.notas;
          const yaEnCocina = r.estado !== "capturado" && r.estado !== "cancelado";

          return {
            ...r,
            ...(ev.cantidad === undefined ? {} : { cantidad: ev.cantidad }),
            ...(ev.notas === undefined ? {} : { notas: ev.notas }),
            ...(cambioLaNota && yaEnCocina ? { notas_cambiadas_ts: ev.ts } : {}),
          };
        }),
      };

    case "cambio_visto":
      return {
        ...estado,
        renglones: estado.renglones.map((r) =>
          r.id === ev.renglon_id ? sinMarcaDeCambio(r) : r,
        ),
      };

    case "item_transferido":
      // El renglón deja esta cuenta; la destino lo recibe con `item_recibido`.
      return {
        ...estado,
        renglones: estado.renglones.filter((r) => r.id !== ev.renglon_id),
      };

    case "item_recibido":
      return { ...estado, renglones: [...estado.renglones, ev.renglon] };

    case "descuento_aplicado":
      return {
        ...estado,
        descuentos: [
          ...estado.descuentos,
          {
            alcance: ev.alcance,
            renglon_id: ev.renglon_id,
            modo: ev.modo,
            valor: ev.valor,
            motivo: ev.motivo,
            autorizador_id: ev.autorizador_id,
          },
        ],
      };

    case "cortesia_otorgada":
      return {
        ...estado,
        cortesias: [
          ...estado.cortesias,
          {
            renglon_id: ev.renglon_id,
            motivo: ev.motivo,
            autorizador_id: ev.autorizador_id,
          },
        ],
      };

    case "propina_registrada":
      return { ...estado, propina: sumar(estado.propina, ev.monto) };

    case "pago_registrado":
      return {
        ...estado,
        pagos: [
          ...estado.pagos,
          {
            monto: ev.monto,
            forma: ev.forma,
            recibido: ev.recibido,
            referencia: ev.referencia,
          },
        ],
      };

    case "orden_identificada":
      return {
        ...estado,
        a_nombre_de: ev.nombre,
        telefono: ev.telefono,
        cliente_id: ev.cliente_id,
      };

    case "cuenta_cerrada":
      // El sello de cierre es lo que ancla la venta a una hora del día: es la
      // base de la curva horaria y del corte por turno.
      return { ...estado, cerrada: true, cerrada_ts: ev.ts };

    default: {
      // Exhaustividad: agregar un tipo sin manejarlo falla en compilación.
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

/** Reconstruye el estado reproduciendo toda la secuencia de eventos. */
export function proyectarComanda(eventos: readonly EventoComanda[]): EstadoComanda {
  let estado: EstadoComanda | null = null;
  for (const ev of eventos) {
    estado = aplicarEvento(estado, ev);
  }
  if (!estado) {
    throw new Error("No hay eventos: no se puede proyectar la comanda");
  }
  return estado;
}

/** Renglones no cancelados (los que cuentan para totales e impresión). */
export function renglonesActivos(estado: EstadoComanda): RenglonComanda[] {
  return estado.renglones.filter(estaActivo);
}

/** Renglones aún sin mandar a cocina. */
export function renglonesPendientes(estado: EstadoComanda): RenglonComanda[] {
  return estado.renglones.filter((r) => r.estado === "capturado");
}

/**
 * Reagrupa un log plano de eventos por mesa, para rehidratar el POS tras
 * recargar. La correspondencia orden → mesa se aprende del `orden_creada`; los
 * eventos huérfanos (sin su apertura) se descartan.
 */
export function agruparPorMesa(
  eventos: readonly EventoComanda[],
): Record<ID, EventoComanda[]> {
  const ordenAMesa = new Map<ID, ID>();
  const porMesa: Record<ID, EventoComanda[]> = {};

  for (const ev of eventos) {
    if (ev.tipo === "orden_creada") ordenAMesa.set(ev.orden_id, ev.mesa_id);
    const mesa = ordenAMesa.get(ev.orden_id);
    if (!mesa) continue;
    (porMesa[mesa] ??= []).push(ev);
  }

  return porMesa;
}

/** ¿Hay algo ya enviado a cocina en esta comanda? */
export function tieneEnviados(estado: EstadoComanda): boolean {
  return estado.renglones.some(
    (r) => r.estado === "enviado" || r.estado === "en_marcha" || r.estado === "listo" || r.estado === "entregado",
  );
}
