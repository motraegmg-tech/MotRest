/**
 * El kiosco, del lado del Hub (F4).
 *
 * Dos rutas y nada más: la carta que se enseña, y el pedido que entra. Es
 * deliberadamente lo mínimo, porque quien habla con estas rutas es una tablet
 * montada en la pared de un restaurante — un aparato al que cualquiera puede
 * llegar y que nadie vigila.
 *
 * DE AHÍ LAS TRES DEFENSAS:
 *
 *   1. **La carta se sirve RECORTADA.** Solo nombre, precio y categoría. Ni
 *      costos, ni márgenes, ni recetas, ni el escandallo. Si alguien desmonta la
 *      tablet y mira el tráfico, se lleva la carta que ya está en la pared.
 *
 *   2. **EL PRECIO LO PONE EL HUB, NO LA TABLET.** El pedido que llega solo
 *      trae qué y cuánto; los importes se recalculan aquí contra la carta real.
 *      Sin esto, cambiar un número en el navegador de la tablet sería pedir una
 *      pizza a un peso.
 *
 *   3. **UN PEDIDO NO PUEDE SER INFINITO.** Se acota el número de renglones y
 *      las cantidades. Una tablet manipulada que pida diez mil pizzas no debe
 *      poder tumbar la cocina ni llenar el registro del local.
 */
import { folioDeKiosco, uuidv7, type Modalidad } from "@motrest/dominio";

/** Lo que se le enseña al comensal de cada platillo. */
export interface PlatilloDeKiosco {
  id: string;
  nombre: string;
  /** En centavos. */
  precio: number;
  categoria: string;
}

/** Topes de un pedido. Generosos para un comensal, ridículos para un ataque. */
const MAX_RENGLONES = 40;
const MAX_CANTIDAD = 20;

export interface RenglonPedido {
  producto_id: string;
  cantidad: number;
}

export interface DepsKiosco {
  /** La carta vigente del local, ya recortada. */
  carta: () => PlatilloDeKiosco[];
  /** Cuántos pedidos lleva el kiosco hoy, para el número de recogida. */
  consecutivo: () => number;
  sucursal_id: () => string;
  /** Publica los eventos del pedido en el registro del local. */
  publicar: (eventos: unknown[]) => void;
}

export type RespuestaKiosco =
  | { ok: true; datos: unknown }
  | { ok: false; codigo: number; error: string };

/**
 * Registra un pedido del kiosco.
 *
 * Devuelve el consecutivo para que la pantalla componga el número de recogida.
 * Se devuelve el número y no el `orden_id` a propósito: lo que el comensal
 * necesita es algo que se pueda gritar en un mostrador.
 */
export function registrarPedido(
  cuerpo: { modalidad?: unknown; renglones?: unknown },
  deps: DepsKiosco,
): RespuestaKiosco {
  const renglones = cuerpo.renglones;
  if (!Array.isArray(renglones) || renglones.length === 0) {
    return { ok: false, codigo: 400, error: "El pedido viene vacío" };
  }
  if (renglones.length > MAX_RENGLONES) {
    return { ok: false, codigo: 400, error: "El pedido tiene demasiados renglones" };
  }

  const modalidad: Modalidad =
    cuerpo.modalidad === "para_llevar" ? "para_llevar" : "comer_aqui";

  const carta = new Map(deps.carta().map((p) => [p.id, p]));
  const limpios: { producto: PlatilloDeKiosco; cantidad: number }[] = [];

  for (const crudo of renglones as RenglonPedido[]) {
    const producto = carta.get(String(crudo?.producto_id ?? ""));
    /*
     * Un platillo que no está en la carta se RECHAZA, no se ignora. Ignorarlo
     * dejaría pasar un pedido incompleto que el comensal ya pagó y que en cocina
     * sale distinto de lo que pidió.
     */
    if (!producto) {
      return { ok: false, codigo: 400, error: "Hay un platillo que ya no está en la carta" };
    }

    const cantidad = Math.floor(Number(crudo?.cantidad ?? 0));
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      return { ok: false, codigo: 400, error: "Hay una cantidad que no es válida" };
    }

    limpios.push({ producto, cantidad });
  }

  const orden_id = uuidv7();
  const consecutivo = deps.consecutivo();
  const ahora = Date.now();
  const base = {
    orden_id,
    sucursal_id: deps.sucursal_id(),
    device_id: "kiosco",
    // Sin empleado detrás: lo pidió el propio comensal. Queda constancia de que
    // fue el kiosco y no de un mesero que no estuvo ahí.
    empleado_id: "kiosco",
    ts: ahora,
  };

  deps.publicar([
    {
      ...base,
      id: uuidv7(),
      tipo: "orden_creada",
      mesa_id: `kiosco-${folioDeKiosco(consecutivo)}`,
      canal: modalidad === "para_llevar" ? "para_llevar" : "kiosco",
    },
    ...limpios.map(({ producto, cantidad }) => ({
      ...base,
      id: uuidv7(),
      tipo: "item_agregado",
      renglon_id: uuidv7(),
      producto_id: producto.id,
      descripcion: producto.nombre,
      cantidad,
      // EL PRECIO SALE DE LA CARTA DEL HUB, nunca de lo que mandó la tablet.
      precio_unitario: producto.precio,
    })),
  ]);

  return { ok: true, datos: { consecutivo, orden_id, folio: folioDeKiosco(consecutivo) } };
}
