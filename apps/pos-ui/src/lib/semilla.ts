/**
 * Semilla del salón: comandas iniciales para que la demo abra con contenido.
 *
 * Módulo de TS puro (sin runes) para que sea ejecutable y testeable fuera del
 * navegador. En la etapa 9 (M9 Administración) esto se sustituye por los datos
 * que el propio restaurante da de alta.
 */
import {
  FabricaEventos,
  costearPorciones,
  productoDe,
  proyectarComanda,
  snapshotTasas,
  uuidv7,
  type CatalogoIndex,
  type EventoComanda,
  type ID,
  type PerfilImpuesto,
  type PorcionElegida,
  type RenglonComanda,
} from "@motrest/dominio";

export interface OpcionesSemilla {
  catalogo: CatalogoIndex;
  impuestoPorDefecto: PerfilImpuesto;
  fabrica: FabricaEventos<EventoComanda>;
}

/** Construye un renglón con snapshot de precio, costo e impuesto. */
export function construirRenglon(
  opciones: OpcionesSemilla,
  productoId: ID,
  cantidad: number,
  porciones?: PorcionElegida[],
  detalle?: string,
): RenglonComanda {
  const { catalogo, impuestoPorDefecto } = opciones;
  const p = productoDe(catalogo, productoId);
  const perfil = catalogo.impuestos.get(p.impuesto_id) ?? impuestoPorDefecto;
  return {
    id: uuidv7(),
    producto_id: p.id,
    descripcion: p.nombre,
    detalle,
    cantidad,
    precio_unitario: p.precio,
    costo_unitario: porciones?.length ? costearPorciones(porciones, catalogo) : p.costo,
    impuesto: snapshotTasas(perfil),
    porciones,
    estado: "capturado",
    estacion_id: p.estacion_id,
  };
}

/** Arma las dos porciones de una pizza mitad y mitad. */
export function mitades(izq: ID, der: ID): PorcionElegida[] {
  return [
    { ranura_id: "izq", producto_id: izq, fraccion: 0.5 },
    { ranura_id: "der", producto_id: der, fraccion: 0.5 },
  ];
}

/** Siembra el salón. Devuelve el log de eventos por mesa. */
export function sembrarSalon(opciones: OpcionesSemilla): Record<ID, EventoComanda[]> {
  const { catalogo, fabrica } = opciones;
  const logs: Record<ID, EventoComanda[]> = {};

  const abrir = (mesaId: ID): ID => {
    const orden_id = uuidv7();
    logs[mesaId] = [
      fabrica.crear("orden_creada", orden_id, {
        orden_id,
        mesa_id: mesaId,
        abierta_ts: Date.now(),
      }),
    ];
    return orden_id;
  };

  const add = (mesaId: ID, orden_id: ID, productoId: ID, cantidad = 1, detalle?: string): void => {
    logs[mesaId]?.push(
      fabrica.crear("item_agregado", orden_id, {
        orden_id,
        renglon: construirRenglon(opciones, productoId, cantidad, undefined, detalle),
      }),
    );
  };

  const addPizza = (mesaId: ID, orden_id: ID, tamanoId: ID, izq: ID, der: ID): void => {
    const porciones = mitades(izq, der);
    const detalle = `½ ${productoDe(catalogo, izq).nombre} · ½ ${productoDe(catalogo, der).nombre}`;
    logs[mesaId]?.push(
      fabrica.crear("item_agregado", orden_id, {
        orden_id,
        renglon: construirRenglon(opciones, tamanoId, 1, porciones, detalle),
      }),
    );
  };

  const enviarTodo = (mesaId: ID, orden_id: ID): void => {
    const log = logs[mesaId];
    if (!log) return;
    const ids = proyectarComanda(log).renglones.map((r) => r.id);
    log.push(fabrica.crear("items_enviados", orden_id, { orden_id, renglon_ids: ids }));
  };

  // Mesa 12: la comanda completa del mockup P1.
  const o12 = abrir("mesa-12");
  addPizza("mesa-12", o12, "prod-pizza-familiar", "var-margherita", "var-pepperoni");
  add("mesa-12", o12, "prod-pasta-pesto", 1, "Sin nuez · término al dente");
  add("mesa-12", o12, "prod-limonada", 2);
  add("mesa-12", o12, "prod-agua", 1);

  // Mesas ocupadas (nada enviado aún) → rojo.
  const o1 = abrir("mesa-1");
  add("mesa-1", o1, "prod-pasta-bolonesa");
  const o3 = abrir("mesa-3");
  addPizza("mesa-3", o3, "prod-pizza-mediana", "var-hawaiana", "var-cuatro-quesos");
  add("mesa-3", o3, "prod-limonada", 2);
  const o5 = abrir("mesa-5");
  add("mesa-5", o5, "prod-tinto", 2);
  const o7 = abrir("mesa-7");
  addPizza("mesa-7", o7, "prod-pizza-familiar", "var-pepperoni", "var-pepperoni");
  add("mesa-7", o7, "prod-agua", 3);
  const o8 = abrir("mesa-8");
  add("mesa-8", o8, "prod-tiramisu");
  const o11 = abrir("mesa-11");
  addPizza("mesa-11", o11, "prod-pizza-familiar", "var-cuatro-quesos", "var-margherita");

  // Mesas ya enviadas a cocina → naranja.
  const o4 = abrir("mesa-4");
  add("mesa-4", o4, "prod-pasta-pesto");
  enviarTodo("mesa-4", o4);
  const o10 = abrir("mesa-10");
  addPizza("mesa-10", o10, "prod-pizza-mediana", "var-margherita", "var-hawaiana");
  enviarTodo("mesa-10", o10);

  return logs;
}
