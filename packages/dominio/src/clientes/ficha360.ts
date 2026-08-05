/**
 * La ficha 360° del comensal (M7 · F3).
 *
 * NO ES UNA TABLA NUEVA. Todo lo que hay aquí ya estaba escrito en el event log
 * —sus cuentas, sus propinas, sus opiniones, sus reservas, sus puntos— solo que
 * repartido entre seis flujos que nadie cruzaba. Esto los junta.
 *
 * Esa es la ventaja de haber construido sobre eventos (ADR-02): el CRM no exige
 * migrar datos ni empezar a capturar nada nuevo. El restaurante que instale
 * MotRest hoy tiene la ficha de sus clientes completa desde el primer día que
 * operó, no desde el día que alguien decidió llenar un formulario.
 *
 * LO QUE SE RESPONDE, Y POR QUÉ ESAS PREGUNTAS
 *
 * No es un tablero de vanidad. Cada dato existe porque alguien lo usa:
 *
 *   - **cuánto gasta y cada cuánto viene** → decide si vale la pena una
 *     promoción y de cuánto;
 *   - **hace cuánto no viene** → el que se está yendo, que es el único al que
 *     todavía se puede recuperar;
 *   - **cómo calificó** → no se le manda una promoción a quien se fue enojado
 *     sin resolverle antes lo que pasó;
 *   - **cuántas veces plantó** → antes de volver a apartarle mesa un viernes;
 *   - **qué pide siempre** → lo que convierte a un mesero en alguien que se
 *     acuerda de ti.
 */
import { CERO, sumar, type Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { renglonesActivos, type EstadoComanda } from "../comanda/reducers.js";
import { totalesComanda } from "../comanda/totales.js";
import type { Opinion } from "./opinion.js";
import type { Reserva } from "./reservas.js";
import type { SaldoCliente } from "./lealtad.js";

/** Un platillo que este comensal pide una y otra vez. */
export interface Favorito {
  producto_id: ID;
  descripcion: string;
  veces: number;
}

export interface Ficha360 {
  cliente_id?: ID;
  nombre: string;
  telefono?: string;

  // --- Lo que ha dejado ---
  visitas: number;
  gastado: Centavos;
  /** Lo que gasta en promedio por visita. Con esto se dimensiona un regalo. */
  ticket_promedio: Centavos;
  propinas: Centavos;

  // --- Cuándo ---
  primera_visita?: number;
  ultima_visita?: number;
  /** Días desde la última visita. `null` si nunca ha venido. */
  dias_sin_venir: number | null;
  /** Cada cuántos días suele volver. `null` con menos de dos visitas. */
  cada_cuantos_dias: number | null;

  // --- Cómo lo trataron ---
  opiniones: number;
  /** De sus opiniones, cuántas fueron malas. Lo que hay que mirar primero. */
  malas: number;
  ultima_opinion?: Opinion;

  // --- Reservas ---
  reservas: number;
  plantones: number;

  // --- Lealtad ---
  puntos: number;
  monedero: Centavos;

  favoritos: Favorito[];
}

/**
 * Con qué se reconoce a un comensal entre visitas.
 *
 * El teléfono manda sobre el nombre: "Familia Ramírez" y "familia ramirez" son
 * la misma gente, pero dos "Juan" distintos no. Sin teléfono, se cae al nombre
 * normalizado, que es mejor que nada y peor que un teléfono — y por eso el
 * portal lo pide.
 */
export function identidadDe(datos: {
  cliente_id?: ID;
  telefono?: string;
  nombre?: string;
}): string | null {
  if (datos.cliente_id) return `cli:${datos.cliente_id}`;

  /*
   * Se comparan los ÚLTIMOS DIEZ DÍGITOS.
   *
   * El mismo cliente da su teléfono de tres formas a lo largo del año: en la
   * mesa lo dicta sin lada, el portal lo manda con `+52`, y WhatsApp lo entrega
   * como `521…`. Comparando la cadena completa, esa persona se parte en tres
   * fichas y el CRM entero deja de servir — que es justo lo que este archivo
   * existe para evitar. Diez dígitos es el número nacional en México.
   */
  const soloDigitos = datos.telefono?.replace(/\D/g, "") ?? "";
  if (soloDigitos.length >= 10) return `tel:${soloDigitos.slice(-10)}`;

  const nombre = datos.nombre
    ?.trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return nombre && nombre.length >= 3 ? `nom:${nombre}` : null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

export interface FuentesFicha {
  comandas: readonly EstadoComanda[];
  opiniones: readonly Opinion[];
  reservas: readonly Reserva[];
  saldo?: SaldoCliente;
  ahora?: number;
}

/**
 * Arma la ficha de UN comensal cruzando todo lo que el local ya sabe de él.
 *
 * Se le pasa su identidad —la que devuelve `identidadDe`— y se recorre lo que
 * haya. Nada de esto se guarda: se recalcula, porque el día que se agregue un
 * dato nuevo al log la ficha lo incluye sin migrar nada.
 */
export function fichaDe(identidad: string, fuentes: FuentesFicha): Ficha360 {
  const ahora = fuentes.ahora ?? Date.now();

  const suyas = fuentes.comandas.filter(
    (c) =>
      c.cerrada &&
      identidadDe({
        cliente_id: c.cliente_id,
        telefono: c.telefono,
        nombre: c.a_nombre_de,
      }) === identidad,
  );

  const ordenes = new Set(suyas.map((c) => c.orden_id));
  const susOpiniones = fuentes.opiniones.filter((o) => ordenes.has(o.orden_id));

  const susReservas = fuentes.reservas.filter(
    (r) => identidadDe({ cliente_id: r.cliente_id, telefono: r.telefono, nombre: r.nombre }) === identidad,
  );

  // --- Dinero -------------------------------------------------------------------
  let gastado = CERO;
  let propinas = CERO;
  const vecesPorProducto = new Map<ID, { descripcion: string; veces: number }>();

  for (const c of suyas) {
    const t = totalesComanda(c);
    gastado = sumar(gastado, t.total);
    propinas = sumar(propinas, t.propina);

    for (const r of renglonesActivos(c)) {
      const previo = vecesPorProducto.get(r.producto_id);
      vecesPorProducto.set(r.producto_id, {
        descripcion: r.descripcion,
        veces: (previo?.veces ?? 0) + r.cantidad,
      });
    }
  }

  // --- Cuándo -------------------------------------------------------------------
  const fechas = suyas
    .map((c) => c.cerrada_ts ?? c.abierta_ts)
    .sort((a, b) => a - b);
  const primera = fechas[0];
  const ultima = fechas.at(-1);

  /*
   * Cada cuánto vuelve: el promedio de días ENTRE visitas, no desde la primera.
   * Con una sola visita no hay intervalo que medir y se dice `null` en vez de
   * inventar una periodicidad que no existe.
   */
  const cadaCuantos =
    fechas.length >= 2 && primera !== undefined && ultima !== undefined
      ? Math.round((ultima - primera) / DIA_MS / (fechas.length - 1))
      : null;

  const nombre =
    suyas.at(-1)?.a_nombre_de ?? susReservas.at(-1)?.nombre ?? identidad.split(":")[1] ?? "";

  return {
    cliente_id: suyas.at(-1)?.cliente_id ?? susReservas.at(-1)?.cliente_id,
    nombre,
    telefono: suyas.at(-1)?.telefono ?? susReservas.at(-1)?.telefono,

    visitas: suyas.length,
    gastado,
    ticket_promedio: (suyas.length > 0 ? Math.round(gastado / suyas.length) : 0) as Centavos,
    propinas,

    primera_visita: primera,
    ultima_visita: ultima,
    dias_sin_venir: ultima === undefined ? null : Math.floor((ahora - ultima) / DIA_MS),
    cada_cuantos_dias: cadaCuantos,

    opiniones: susOpiniones.length,
    malas: susOpiniones.filter((o) => o.calificacion === "mal").length,
    ultima_opinion: susOpiniones.at(-1),

    reservas: susReservas.length,
    plantones: susReservas.filter((r) => r.estado === "no_llego").length,

    puntos: fuentes.saldo?.puntos ?? 0,
    monedero: fuentes.saldo?.monedero ?? CERO,

    favoritos: [...vecesPorProducto.entries()]
      .map(([producto_id, v]) => ({ producto_id, descripcion: v.descripcion, veces: v.veces }))
      .sort((a, b) => b.veces - a.veces)
      .slice(0, 5),
  };
}

/** Todas las identidades que aparecen en la operación, para poder listarlas. */
export function comensalesConocidos(fuentes: FuentesFicha): string[] {
  const vistos = new Set<string>();

  for (const c of fuentes.comandas) {
    const id = identidadDe({
      cliente_id: c.cliente_id,
      telefono: c.telefono,
      nombre: c.a_nombre_de,
    });
    if (id) vistos.add(id);
  }
  for (const r of fuentes.reservas) {
    const id = identidadDe({ cliente_id: r.cliente_id, telefono: r.telefono, nombre: r.nombre });
    if (id) vistos.add(id);
  }

  return [...vistos];
}

/**
 * Quiénes se están yendo.
 *
 * Un cliente que venía cada quince días y lleva cincuenta sin aparecer no se
 * fue "todavía": está a tiempo de volver si alguien se acuerda de él. Ese es el
 * único momento en que una promoción sirve de algo.
 *
 * Se exige que tenga historia —al menos dos visitas— porque quien vino una vez
 * no se está yendo: nunca llegó.
 */
export function enRiesgoDePerderse(
  fichas: readonly Ficha360[],
  factor = 2.5,
): Ficha360[] {
  return fichas
    .filter((f) => {
      if (f.visitas < 2 || f.cada_cuantos_dias === null || f.dias_sin_venir === null) return false;
      // Un cliente diario y uno mensual no se pierden al mismo ritmo: el umbral
      // sale de SU periodicidad, no de un número fijo para todos.
      return f.dias_sin_venir > Math.max(7, f.cada_cuantos_dias * factor);
    })
    .sort((a, b) => b.gastado - a.gastado);
}
