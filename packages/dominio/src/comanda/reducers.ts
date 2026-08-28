/**
 * Reducers de la comanda: reconstruyen el estado (proyección) desde el log de
 * eventos. Estado inmutable — cada evento produce un objeto nuevo (ADR-02).
 */
import { sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { Devolucion, EventoComanda, FormaPago } from "./eventos.js";
import { estaActivo, type EstadoRenglon, type RenglonComanda } from "./renglon.js";

export interface Pago {
  monto: Centavos;
  forma: FormaPago;
  recibido?: Centavos;
  referencia?: string;
  /** A qué socio se le carga el consumo, cuando la forma es `socio`. */
  socio_id?: ID;
}

export interface Descuento {
  /**
   * El `id` del evento que lo aplicó. Es lo que permite retirar UNO concreto
   * cuando la cuenta lleva varios —dos rondas del mismo 2×1, por ejemplo—.
   */
  id: ID;
  alcance: "renglon" | "cuenta";
  renglon_id?: ID;
  modo: "porcentaje" | "monto";
  valor: number;
  motivo: string;
  autorizador_id?: ID;
  /** Presente cuando el descuento lo originó una promoción del catálogo. */
  promocion_id?: ID;
  renglones_cubiertos?: ID[];
}

export interface Cortesia {
  renglon_id?: ID;
  motivo: string;
  autorizador_id?: ID;
}

/** Proyección del estado de una comanda. Sin `personas` (decisión de Gonzalo). */
export interface EstadoComanda {
  orden_id: ID;
  /** Mesa principal. Con mesas juntadas, la que da nombre a la cuenta. */
  mesa_id: ID;
  /** Las demás mesas que ocupa la cuenta. Ausente = una sola mesa. */
  mesas_unidas?: ID[];
  /** Empleado que abrió la mesa (viene del sobre del evento). */
  mesero_id: ID;
  abierta_ts: number;
  renglones: RenglonComanda[];
  cerrada: boolean;
  /** Momento del cobro. Es la hora que cuenta como venta. */
  cerrada_ts?: number;
  /**
   * true = esta cuenta se cobró y se volvió a abrir.
   *
   * Se conserva para siempre: una cuenta reabierta merece una segunda mirada al
   * revisar el corte, y esconderlo sería justo lo contrario de una bitácora.
   */
  reabierta?: boolean;
  /**
   * true = la sentada se cerró SIN consumo, para liberar la mesa.
   *
   * No es una venta y los reportes la excluyen. Se conserva en la proyección
   * —y en el log— porque saber cuántas mesas se abren por error, y quién las
   * abre, es información de operación que hoy nadie tiene.
   */
  anulada?: boolean;
  /**
   * true = la venta se canceló DESPUÉS de cobrada y el dinero se devolvió.
   *
   * No es lo mismo que `anulada`: aquí sí hubo consumo y sí hubo cobro. Los dos
   * comparten destino en los reportes —ninguna cuenta como venta— pero se
   * distinguen en la bitácora, que es donde importa la diferencia entre «se
   * abrió una mesa por error» y «se deshizo un cobro de 433 pesos».
   */
  cancelada?: boolean;
  /** Cuándo se canceló. La hora del cobro sigue en `cerrada_ts`. */
  cancelada_ts?: number;
  motivo_cancelacion?: string;
  /** Lo que se le regresó al comensal al cancelar. */
  devoluciones?: Devolucion[];
  /** Cuántas veces se volvió a imprimir el ticket. Ausente = ninguna. */
  reimpresiones?: number;
  /**
   * A nombre de quién va el pedido. Presente sobre todo en los de PARA LLEVAR,
   * donde no hay una mesa que sirva de referencia.
   */
  a_nombre_de?: string;
  telefono?: string;
  cliente_id?: ID;
  /** Por dónde entró. Ausente = salón. */
  canal?: import("../ventas/canales.js").CanalVenta;
  folio_externo?: string;
  /** La comisión que se pactó cuando se vendió, no la de hoy. */
  comision_canal?: number;
  /** true = el agregador ya depositó esta venta y está conciliada. */
  depositado?: boolean;
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
      mesas_unidas: ev.mesas_unidas?.length ? ev.mesas_unidas : undefined,
      mesero_id: ev.empleado_id,
      abierta_ts: ev.abierta_ts,
      canal: ev.canal,
      folio_externo: ev.folio_externo,
      comision_canal: ev.comision_canal,
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
            id: ev.id,
            alcance: ev.alcance,
            renglon_id: ev.renglon_id,
            modo: ev.modo,
            valor: ev.valor,
            motivo: ev.motivo,
            autorizador_id: ev.autorizador_id,
            promocion_id: ev.promocion_id,
            renglones_cubiertos: ev.renglones_cubiertos,
          },
        ],
      };

    /*
     * Se quita UN descuento, el que se señala por el id de su evento.
     *
     * Los renglones que ese descuento tenía cubiertos vuelven a quedar libres
     * —el estado no los guarda aparte—, así que la promoción se vuelve a
     * ofrecer sola en cuanto se retira. Es lo que se espera de deshacer.
     */
    case "descuento_retirado":
      return {
        ...estado,
        descuentos: estado.descuentos.filter((d) => d.id !== ev.descuento_id),
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

    /*
     * Se RETIRA la cortesía que apunta al mismo alcance.
     *
     * Se filtra por `renglon_id` y no se vacía la lista entera: una cuenta
     * puede tener regalado un postre y, aparte, un descuento de la casa sobre
     * otro renglón. Quitar el postre no puede llevarse por delante lo demás.
     */
    case "cortesia_retirada":
      return {
        ...estado,
        cortesias: estado.cortesias.filter((c) => c.renglon_id !== ev.renglon_id),
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
            socio_id: ev.socio_id,
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

    /*
     * La mesa se libera sin haber consumido nada. Se marca `anulada` para que
     * los reportes la dejen fuera: cerrarla a secas la habría contado como una
     * venta de cero pesos y hundido el ticket promedio de la jornada.
     */
    case "orden_anulada":
      return { ...estado, cerrada: true, cerrada_ts: ev.ts, anulada: true };

    /*
     * La venta se deshace: la mesa se libera y la cuenta sale de los reportes.
     *
     * Se CIERRA aunque estuviera reabierta —ese es medio arreglo: una cuenta
     * cancelada no puede seguir ocupando la mesa— pero `cerrada_ts` conserva la
     * hora del cobro original si la hubo. Son dos hechos distintos y cada uno
     * tiene su sello: cuándo se cobró y cuándo se deshizo.
     */
    case "venta_cancelada":
      return {
        ...estado,
        cerrada: true,
        cerrada_ts: estado.cerrada_ts ?? ev.ts,
        cancelada: true,
        cancelada_ts: ev.ts,
        motivo_cancelacion: ev.motivo,
        devoluciones: [...(estado.devoluciones ?? []), ...ev.devoluciones],
      };

    case "ticket_reimpreso":
      // Se cuenta en la comanda para poder numerar el papel y para que el
      // total de reimpresiones se vea sin recorrer la bitácora entera.
      return { ...estado, reimpresiones: ev.numero };

    case "cuenta_reabierta":
      /*
       * Se quita el cierre Y su sello. Dejar el `cerrada_ts` viejo haría que la
       * venta siguiera contando en el corte del turno en que se cobró mal,
       * mientras la cuenta está otra vez abierta: el dinero aparecería dos
       * veces. Los PAGOS no se tocan —fueron hechos— y se ven al reabrir.
       */
      return { ...estado, cerrada: false, cerrada_ts: undefined, reabierta: true };

    default: {
      // Exhaustividad: agregar un tipo sin manejarlo falla en compilación.
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

/**
 * Reconstruye UNA comanda —una sentada— reproduciendo sus eventos.
 *
 * EXIGE los eventos de una sola orden. Si recibe el log completo de una mesa
 * servida varias veces, FALLA en vez de devolver la última en silencio.
 *
 * Es a propósito, y es la lección más cara de este proyecto. `orden_creada`
 * arranca estado nuevo, así que un log de mesa entero devolvía calladamente
 * solo la última sentada: el contador y los reportes veían una fracción de la
 * noche mientras el corte de caja —que suma pagos— las veía todas. Dos números
 * distintos para el mismo viernes, y ninguna forma de saber cuál creer.
 *
 * Con este candado la equivocación deja de ser posible: quien tenga un log de
 * mesa tiene que decir cuál de las dos cosas quiere, `ultimaSentada` o
 * `proyectarSentadas`.
 */
export function proyectarComanda(eventos: readonly EventoComanda[]): EstadoComanda {
  let estado: EstadoComanda | null = null;
  let aperturas = 0;

  for (const ev of eventos) {
    if (ev.tipo === "orden_creada") aperturas += 1;
    estado = aplicarEvento(estado, ev);
  }

  if (!estado) {
    throw new Error("No hay eventos: no se puede proyectar la comanda");
  }
  if (aperturas > 1) {
    throw new Error(
      `Este log tiene ${aperturas} sentadas, no una. Proyectarlo de corrido perdería ` +
        "todas menos la última. Usa ultimaSentada() para la cuenta en curso, o " +
        "proyectarSentadas() para todas.",
    );
  }
  return estado;
}

/** Agrupa los eventos por orden. Cada grupo es una sentada. */
function porOrden(eventos: readonly EventoComanda[]): Map<ID, EventoComanda[]> {
  const grupos = new Map<ID, EventoComanda[]>();
  for (const ev of eventos) {
    const grupo = grupos.get(ev.orden_id) ?? [];
    grupo.push(ev);
    grupos.set(ev.orden_id, grupo);
  }
  return grupos;
}

/**
 * La sentada en curso de una mesa: la cuenta que el mesero tiene enfrente.
 *
 * Se filtra por `orden_id`, no por posición en el log. Un postre de la sentada
 * anterior que cocina marca entregado tarde llega DESPUÉS de que la mesa se
 * volvió a abrir, y cortar por posición lo metería en la cuenta equivocada.
 *
 * Devuelve `null` si la mesa nunca se abrió.
 */
export function ultimaSentada(eventos: readonly EventoComanda[]): EstadoComanda | null {
  let ultima: ID | null = null;
  for (const ev of eventos) {
    if (ev.tipo === "orden_creada") ultima = ev.orden_id;
  }
  if (!ultima) return null;

  return proyectarComanda(eventos.filter((e) => e.orden_id === ultima));
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
/**
 * TODAS las sentadas de un log: una comanda por cuenta, no por mesa.
 *
 * Es lo que tienen que consumir los reportes y el contador. Una mesa se sirve
 * cinco veces un viernes, y las cinco son ventas.
 */
export function proyectarSentadas(eventos: readonly EventoComanda[]): EstadoComanda[] {
  const comandas: EstadoComanda[] = [];

  for (const grupo of porOrden(eventos).values()) {
    // Un grupo sin `orden_creada` no se puede proyectar: son eventos sueltos de
    // una orden que vive en otro dispositivo y todavía no llega.
    if (!grupo.some((e) => e.tipo === "orden_creada")) continue;
    comandas.push(proyectarComanda(grupo));
  }
  return comandas.sort((a, b) => a.abierta_ts - b.abierta_ts);
}

/**
 * Mesas con MÁS DE UNA cuenta abierta a la vez.
 *
 * Una mesa no puede tener dos cuentas abiertas: es una mesa. Ocurre cuando dos
 * terminales la ponen en servicio casi al mismo tiempo — cada una la ve libre
 * porque el `orden_creada` de la otra todavía no le llega, y al sincronizar
 * aparecen las dos. En un mismo dispositivo ya no puede pasar; entre terminales
 * distintas sí, y hay que verlo.
 *
 * No se fusionan solas: quién junta dos cuentas y con qué criterio es una
 * decisión del restaurante, no del software. Lo que sí es obligación del
 * software es no esconderlo — antes, una de las dos desaparecía de la pantalla
 * con todo lo que le habían pedido.
 */
export function mesasConCuentaDuplicada(comandas: readonly EstadoComanda[]): ID[] {
  const abiertasPorMesa = new Map<ID, number>();
  for (const c of comandas) {
    if (c.cerrada) continue;
    abiertasPorMesa.set(c.mesa_id, (abiertasPorMesa.get(c.mesa_id) ?? 0) + 1);
  }

  return [...abiertasPorMesa.entries()].filter(([, cuantas]) => cuantas > 1).map(([mesa]) => mesa);
}

/**
 * Todas las mesas que ocupa una cuenta: la principal primero.
 *
 * Se pregunta siempre por aquí y nunca leyendo `mesas_unidas` a pelo, para que
 * una cuenta de una sola mesa y una de tres se traten igual en toda la app.
 */
export function mesasDeComanda(estado: EstadoComanda): ID[] {
  return [estado.mesa_id, ...(estado.mesas_unidas ?? [])];
}

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
