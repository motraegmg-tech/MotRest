/**
 * Tablero del KDS: los tickets que ve la cocina.
 *
 * Se deriva de las mismas comandas que el POS — no hay una "cola de cocina"
 * aparte que pueda desincronizarse. Lo que el mesero envía es literalmente lo
 * que la cocina ve.
 */
import type { ID } from "../comun/ids.js";
import type { EstadoComanda } from "../comanda/reducers.js";
import { minutosEnCocina, type RenglonComanda } from "../comanda/renglon.js";
import { semaforoDe, semaforoPeor, type EstacionKds, type Semaforo } from "./estaciones.js";

export interface RenglonKds {
  renglon_id: ID;
  descripcion: string;
  detalle?: string;
  notas?: string;
  cantidad: number;
  estado: RenglonComanda["estado"];
  estacion_id?: ID;
  minutos: number;
  semaforo: Semaforo;
}

export interface TicketKds {
  orden_id: ID;
  mesa_id: ID;
  mesero_id: ID;
  /** Momento en que salió el primer platillo de este ticket. */
  enviado_ts: number;
  renglones: RenglonKds[];
  minutos: number;
  semaforo: Semaforo;
  /** true = todos sus platillos están listos y solo falta entregarlos. */
  completo: boolean;
}

/** Estados que la cocina tiene que atender. */
const EN_COCINA = new Set<RenglonComanda["estado"]>(["enviado", "en_marcha", "listo"]);

export interface OpcionesTablero {
  /** Si se indica, solo se muestran los platillos de esa estación. */
  estacion_id?: ID;
  /** Reloj del dispositivo, para los cronómetros. */
  ahora: number;
  estaciones: readonly EstacionKds[];
  /** true = incluir también los ya entregados (vista de recall). */
  incluirEntregados?: boolean;
}

/** Construye los tickets de cocina a partir de las comandas abiertas. */
export function proyectarTablero(
  comandas: readonly EstadoComanda[],
  opciones: OpcionesTablero,
): TicketKds[] {
  const porId = new Map(opciones.estaciones.map((e) => [e.id, e]));
  const tickets: TicketKds[] = [];

  for (const comanda of comandas) {
    const relevantes = comanda.renglones.filter((r) => {
      if (opciones.estacion_id && r.estacion_id !== opciones.estacion_id) return false;
      if (opciones.incluirEntregados && r.estado === "entregado") return true;
      return EN_COCINA.has(r.estado);
    });
    if (relevantes.length === 0) continue;

    const renglones: RenglonKds[] = relevantes.map((r) => {
      const minutos = minutosEnCocina(r, opciones.ahora);
      return {
        renglon_id: r.id,
        descripcion: r.descripcion,
        detalle: r.detalle,
        notas: r.notas,
        cantidad: r.cantidad,
        estado: r.estado,
        estacion_id: r.estacion_id,
        minutos,
        semaforo: semaforoDe(
          minutos,
          r.estacion_id ? porId.get(r.estacion_id) : undefined,
          r.estado === "listo" || r.estado === "entregado",
        ),
      };
    });

    const enviados = relevantes
      .map((r) => r.enviado_ts)
      .filter((ts): ts is number => ts !== undefined);
    const enviado_ts = enviados.length > 0 ? Math.min(...enviados) : opciones.ahora;

    tickets.push({
      orden_id: comanda.orden_id,
      mesa_id: comanda.mesa_id,
      mesero_id: comanda.mesero_id,
      enviado_ts,
      renglones,
      minutos: Math.max(...renglones.map((r) => r.minutos), 0),
      semaforo: semaforoPeor(renglones.map((r) => r.semaforo)),
      completo: renglones.every((r) => r.estado === "listo" || r.estado === "entregado"),
    });
  }

  // El más urgente primero: la cocina trabaja por antigüedad, no por mesa.
  return tickets.sort((a, b) => a.enviado_ts - b.enviado_ts);
}

/** Cuántos platillos tiene pendientes cada estación, para las pestañas. */
export function cargaPorEstacion(
  comandas: readonly EstadoComanda[],
): Map<ID, number> {
  const carga = new Map<ID, number>();
  for (const comanda of comandas) {
    for (const r of comanda.renglones) {
      if (!EN_COCINA.has(r.estado) || !r.estacion_id) continue;
      carga.set(r.estacion_id, (carga.get(r.estacion_id) ?? 0) + 1);
    }
  }
  return carga;
}
