/**
 * Pronóstico de demanda (capacidad C3): anticipar el próximo servicio.
 *
 * La realidad de Rodizio son los picos de fin de semana: un viernes no se parece
 * en nada a un martes, y dotarlos igual es de donde salen las dos quejas caras
 * —o falta gente y masa el viernes, o sobra personal el martes—.
 *
 * El método es honesto y sin caja negra: se aprende el patrón del PROPIO local.
 * Para cada día de la semana se promedia lo que de verdad se vendió en los días
 * de ese tipo ya observados, y se proyecta a los días que vienen. La confianza
 * es explícita y depende de cuántas veces se ha visto ese día: con un solo
 * viernes de historia el pronóstico se muestra, pero avisando que es tentativo.
 *
 * No inventa una hora ni un reloj: bucketea con `cerrada_ts`, el momento del
 * cobro, en la hora local del dispositivo (ADR-17). Y agrupa por JORNADA, no por
 * día natural: un viernes que cierra a la una de la madrugada es viernes, y
 * cortar a medianoche le inventaría al sábado un pico fantasma.
 */
import { CERO, sumar, deCentavos, type Centavos } from "../comun/dinero.js";
import { renglonesActivos, type EstadoComanda } from "../comanda/reducers.js";
import { HORA_CORTE_POR_DEFECTO, diaOperativoDe } from "./reportes.js";
import { totalesComanda } from "../comanda/totales.js";

export type Confianza = "alta" | "media" | "baja";

/** Los nombres de los días, indexados como `Date.getDay()` (0 = domingo). */
export const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export interface DemandaDia {
  /** 0 = domingo … 6 = sábado, como `Date.getDay()`. */
  dia_semana: number;
  /** Cuántos días de ese tipo se han observado. Es la base de la confianza. */
  servicios: number;
  cuentas_prom: number;
  venta_prom: Centavos;
  platillos_prom: number;
  /** Hora con más venta en ese día, para dónde poner el personal. */
  hora_pico: number | null;
  confianza: Confianza;
}

export interface PronosticoDia {
  /** Instante en que abre la jornada pronosticada. */
  fecha: number;
  dia_semana: number;
  cuentas_esperadas: number;
  venta_esperada: Centavos;
  hora_pico: number | null;
  confianza: Confianza;
}

export interface Pronostico {
  /** El patrón aprendido, un renglón por día de la semana con datos. */
  patron: DemandaDia[];
  /** Los próximos días, empezando por hoy. */
  proximos: PronosticoDia[];
  /** Días distintos con ventas que se alcanzaron a observar. */
  dias_observados: number;
  /** ¿Ya se vio al menos una semana completa? Antes, todo es tentativo. */
  listo: boolean;
}

interface TotalDia {
  cuentas: number;
  venta: Centavos;
  platillos: number;
}

function confianzaDe(servicios: number): Confianza {
  if (servicios >= 3) return "alta";
  if (servicios === 2) return "media";
  return "baja";
}

function promedioCentavos(total: Centavos, entre: number): Centavos {
  return entre > 0 ? deCentavos(Math.round(total / entre)) : CERO;
}

/**
 * Aprende el patrón semanal y proyecta los próximos días.
 *
 * @param comandas Cuentas cerradas; las abiertas no cuentan como venta.
 * @param opciones `ahora` para fijar el punto de partida (pruebas); `dias` es
 *   cuántos proyectar hacia adelante, contando hoy; `horaCorte` es la hora a la
 *   que el local cierra su jornada contable.
 */
export function pronosticoDemanda(
  comandas: readonly EstadoComanda[],
  opciones: { ahora?: number; dias?: number; horaCorte?: number } = {},
): Pronostico {
  const ahora = opciones.ahora ?? Date.now();
  const diasAdelante = opciones.dias ?? 7;
  const horaCorte = opciones.horaCorte ?? HORA_CORTE_POR_DEFECTO;

  // 1. Cada cuenta cerrada, a su jornada y su hora.
  const porDia = new Map<number, TotalDia>();
  // venta por (dia_semana, hora), para el pico.
  const porHora = new Map<number, Centavos[]>(); // dia_semana -> [24]

  for (const c of comandas) {
    if (!c.cerrada || c.cerrada_ts === undefined) continue;
    const dia = diaOperativoDe(c.cerrada_ts, horaCorte);
    const total = totalesComanda(c).total;
    const platillos = renglonesActivos(c).reduce((n, r) => n + r.cantidad, 0);

    const previo = porDia.get(dia) ?? { cuentas: 0, venta: CERO, platillos: 0 };
    porDia.set(dia, {
      cuentas: previo.cuentas + 1,
      venta: sumar(previo.venta, total),
      platillos: previo.platillos + platillos,
    });

    const diaSemana = new Date(dia).getDay();
    const hora = new Date(c.cerrada_ts).getHours();
    const horas = porHora.get(diaSemana) ?? new Array<Centavos>(24).fill(CERO);
    horas[hora] = sumar(horas[hora]!, total);
    porHora.set(diaSemana, horas);
  }

  // 2. Agrupar los días por día de la semana y promediar.
  const porSemana = new Map<number, TotalDia[]>();
  for (const [dia, total] of porDia) {
    const diaSemana = new Date(dia).getDay();
    const lista = porSemana.get(diaSemana) ?? [];
    lista.push(total);
    porSemana.set(diaSemana, lista);
  }

  const patron: DemandaDia[] = [];
  for (const [diaSemana, dias] of porSemana) {
    const servicios = dias.length;
    const cuentas = dias.reduce((n, d) => n + d.cuentas, 0);
    const venta = sumar(...dias.map((d) => d.venta));
    const platillos = dias.reduce((n, d) => n + d.platillos, 0);

    patron.push({
      dia_semana: diaSemana,
      servicios,
      cuentas_prom: Math.round(cuentas / servicios),
      venta_prom: promedioCentavos(venta, servicios),
      platillos_prom: Math.round(platillos / servicios),
      hora_pico: horaPico(porHora.get(diaSemana)),
      confianza: confianzaDe(servicios),
    });
  }
  patron.sort((a, b) => a.dia_semana - b.dia_semana);

  // 3. Proyectar los próximos días desde hoy.
  const porDiaSemana = new Map(patron.map((p) => [p.dia_semana, p]));
  const proximos: PronosticoDia[] = [];
  const hoy = diaOperativoDe(ahora, horaCorte);
  for (let i = 0; i < diasAdelante; i++) {
    const fecha = new Date(hoy);
    fecha.setDate(fecha.getDate() + i);
    const diaSemana = fecha.getDay();
    const p = porDiaSemana.get(diaSemana);
    proximos.push({
      fecha: fecha.getTime(),
      dia_semana: diaSemana,
      cuentas_esperadas: p?.cuentas_prom ?? 0,
      venta_esperada: p?.venta_prom ?? CERO,
      hora_pico: p?.hora_pico ?? null,
      confianza: p?.confianza ?? "baja",
    });
  }

  return {
    patron,
    proximos,
    dias_observados: porDia.size,
    listo: porDia.size >= 7,
  };
}

/** La hora con más venta acumulada. `null` si no hubo ventas. */
function horaPico(horas: readonly Centavos[] | undefined): number | null {
  if (!horas) return null;
  let mejor = -1;
  let max = CERO;
  for (let h = 0; h < horas.length; h++) {
    if (horas[h]! > max) {
      max = horas[h]!;
      mejor = h;
    }
  }
  return mejor >= 0 ? mejor : null;
}
