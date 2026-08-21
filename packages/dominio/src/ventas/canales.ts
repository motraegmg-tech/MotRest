/**
 * Canales de venta: el salón, y lo que entra por Rappi, Uber Eats o DiDi.
 *
 * EL PROBLEMA QUE ESTO RESUELVE, Y POR QUÉ NO ES UNA ETIQUETA
 *
 * Hoy los pedidos de agregador llegan a una tablet que presta la plataforma,
 * separada de MotRest. El restaurante los prepara, los cobra la plataforma, y
 * en el sistema NO EXISTEN. Consecuencias, todas reales:
 *
 *   - el inventario no descuenta lo que salió por esos pedidos;
 *   - el food cost sale mal, porque hubo consumo sin venta registrada;
 *   - el corte no cuadra si el mesero los captura como si fueran del salón;
 *   - y nadie sabe cuánto se le está pagando de comisión al agregador.
 *
 * Registrarlos con su canal arregla las cuatro cosas de golpe, sin depender de
 * ningún convenio con las plataformas.
 *
 * LO QUE MÁS SE EQUIVOCA: EL DINERO NO ES DEL RESTAURANTE TODAVÍA
 *
 * Una venta de Rappi de $300 NO son $300 para el local, ni son efectivo en el
 * cajón. La plataforma cobra al comensal, se queda su comisión y deposita el
 * resto días después. Son dos hechos distintos:
 *
 *   1. la VENTA, que ocurre hoy y cuenta para el día, el inventario y el IVA;
 *   2. el COBRO, que ocurre cuando el agregador deposita.
 *
 * Meterlas al corte de caja como si fueran efectivo hace que el cajero aparezca
 * con un sobrante enorme que no existe. Por eso una venta de agregador no toca
 * el cajón: nace como cuenta POR COBRAR.
 */
import { CERO, restar, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";

export type CanalVenta =
  /** Comieron en el restaurante. */
  | "salon"
  /** Vinieron por él al mostrador. */
  | "para_llevar"
  /** Reparto propio del restaurante. */
  | "domicilio_propio"
  | "rappi"
  | "uber_eats"
  | "didi";

export interface DefinicionCanal {
  canal: CanalVenta;
  etiqueta: string;
  /** true = lo cobra un tercero y deposita después. */
  esAgregador: boolean;
  /** Comisión típica, solo como punto de partida al configurar. */
  comisionSugerida: number;
}

export const CANALES: DefinicionCanal[] = [
  { canal: "salon", etiqueta: "Salón", esAgregador: false, comisionSugerida: 0 },
  { canal: "para_llevar", etiqueta: "Para llevar", esAgregador: false, comisionSugerida: 0 },
  { canal: "domicilio_propio", etiqueta: "Reparto propio", esAgregador: false, comisionSugerida: 0 },
  { canal: "rappi", etiqueta: "Rappi", esAgregador: true, comisionSugerida: 0.28 },
  { canal: "uber_eats", etiqueta: "Uber Eats", esAgregador: true, comisionSugerida: 0.3 },
  { canal: "didi", etiqueta: "DiDi Food", esAgregador: true, comisionSugerida: 0.25 },
];

export function definicionCanal(canal: CanalVenta): DefinicionCanal | undefined {
  return CANALES.find((c) => c.canal === canal);
}

export function esAgregador(canal: CanalVenta | undefined): boolean {
  return !!canal && (definicionCanal(canal)?.esAgregador ?? false);
}

/** Lo que el restaurante configura de cada agregador con el que trabaja. */
export interface ConfiguracionCanal {
  canal: CanalVenta;
  activo: boolean;
  /** Comisión real NEGOCIADA, no la de lista. 0.28 = 28 %. */
  comision: number;
  /** Cuántos días tarda en depositar. Sirve para saber qué está vencido. */
  dias_deposito: number;
}

export function configuracionPorDefecto(): ConfiguracionCanal[] {
  return CANALES.filter((c) => c.esAgregador).map((c) => ({
    canal: c.canal,
    activo: false,
    comision: c.comisionSugerida,
    dias_deposito: 7,
  }));
}

/**
 * Lo que el restaurante recibe de verdad por una venta de agregador.
 *
 * La comisión se calcula sobre el TOTAL con IVA, que es sobre lo que la cobran
 * las plataformas. Calcularla sobre el subtotal daría un número más bonito y
 * equivocado, y el restaurante descubriría la diferencia al conciliar el
 * depósito.
 */
export function netoDeAgregador(total: Centavos, comision: number): Centavos {
  const cobra = Math.round(total * Math.max(0, Math.min(1, comision)));
  return restar(total, cobra as Centavos);
}

export function comisionDe(total: Centavos, comision: number): Centavos {
  return restar(total, netoDeAgregador(total, comision));
}

export interface ResumenCanal {
  canal: CanalVenta;
  etiqueta: string;
  cuentas: number;
  /** Lo que pagó el comensal. */
  bruto: Centavos;
  /** Lo que se queda la plataforma. Cero en los canales propios. */
  comision: Centavos;
  /** Lo que le queda al restaurante. */
  neto: Centavos;
}

/**
 * Cuánto entró por cada canal, y cuánto se llevó cada plataforma.
 *
 * Es el reporte que hoy no existe y que decide si un agregador conviene: un
 * canal que factura mucho con 30 % de comisión puede estar dejando menos que
 * uno que factura la mitad sin comisión — y eso no se ve hasta que se separa.
 */
export function ventasPorCanal(
  comandas: readonly EstadoComanda[],
  config: readonly ConfiguracionCanal[],
): ResumenCanal[] {
  const porCanal = new Map<CanalVenta, ResumenCanal>();
  const comisionDelCanal = new Map(config.map((c) => [c.canal, c.comision]));

  for (const c of comandas) {
    // Ni las que se abrieron por error ni las que se cobraron y se deshicieron:
    // el agregador no deposita una venta cancelada, y contarla dejaría un
    // «por cobrar» que nunca va a llegar.
    if (!c.cerrada || c.anulada || c.cancelada) continue;

    const canal = (c.canal ?? "salon") as CanalVenta;
    const previo: ResumenCanal = porCanal.get(canal) ?? {
      canal,
      etiqueta: definicionCanal(canal)?.etiqueta ?? canal,
      cuentas: 0,
      bruto: CERO,
      comision: CERO,
      neto: CERO,
    };

    const total = totalesComanda(c).total;
    /*
     * Se prefiere la comisión GUARDADA en la cuenta sobre la configurada hoy.
     * Cuando el restaurante renegocie su comisión, el histórico tiene que
     * seguir contando lo que de verdad le cobraron entonces.
     */
    const tasa = c.comision_canal ?? comisionDelCanal.get(canal) ?? 0;
    const comision = esAgregador(canal) ? comisionDe(total, tasa) : CERO;

    porCanal.set(canal, {
      ...previo,
      cuentas: previo.cuentas + 1,
      bruto: sumar(previo.bruto, total),
      comision: sumar(previo.comision, comision),
      neto: sumar(previo.neto, restar(total, comision)),
    });
  }

  return [...porCanal.values()].sort((a, b) => b.bruto - a.bruto);
}

export interface PorCobrar {
  canal: CanalVenta;
  etiqueta: string
  cuentas: number;
  /** Lo que la plataforma debe depositar, ya sin su comisión. */
  neto: Centavos;
  /** De eso, lo que ya debió haber llegado según los días pactados. */
  vencido: Centavos;
}

/**
 * Cuánto le deben los agregadores al restaurante.
 *
 * Es un dato que hoy nadie tiene y que se cobra caro no tener: las plataformas
 * depositan con retraso y con descuentos que nadie revisa, porque no hay contra
 * qué compararlos. Esto da ese contra-qué.
 */
export function porCobrarDeAgregadores(
  comandas: readonly EstadoComanda[],
  config: readonly ConfiguracionCanal[],
  ahora = Date.now(),
): PorCobrar[] {
  const porCanal = new Map<CanalVenta, PorCobrar>();
  const porId = new Map(config.map((c) => [c.canal, c]));

  for (const c of comandas) {
    if (!c.cerrada || c.anulada || c.cancelada || !esAgregador(c.canal)) continue;
    // Lo ya conciliado no se sigue debiendo.
    if (c.depositado) continue;

    const canal = c.canal as CanalVenta;
    const cfg = porId.get(canal);
    const total = totalesComanda(c).total;
    const neto = restar(total, comisionDe(total, c.comision_canal ?? cfg?.comision ?? 0));

    const previo: PorCobrar = porCanal.get(canal) ?? {
      canal,
      etiqueta: definicionCanal(canal)?.etiqueta ?? canal,
      cuentas: 0,
      neto: CERO,
      vencido: CERO,
    };

    const dias = (ahora - (c.cerrada_ts ?? c.abierta_ts)) / 86_400_000;
    const yaDebio = dias > (cfg?.dias_deposito ?? 7);

    porCanal.set(canal, {
      ...previo,
      cuentas: previo.cuentas + 1,
      neto: sumar(previo.neto, neto),
      vencido: yaDebio ? sumar(previo.vencido, neto) : previo.vencido,
    });
  }

  return [...porCanal.values()].sort((a, b) => b.neto - a.neto);
}

/** El stream donde vive la configuración de canales de una sucursal. */
export function streamCanales(sucursal_id: ID): ID {
  return `canales:${sucursal_id}`;
}
