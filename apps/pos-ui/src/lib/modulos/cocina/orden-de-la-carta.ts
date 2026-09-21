/**
 * Las formas de ordenar la carta que ofrece Cocina → Menú (1.5.6).
 *
 * LA CARTA ES LA EXCEPCIÓN. En el resto de la caja, «Ordenar» cambia solo la
 * vista de quien mira la lista. Aquí no: por decisión de Gonzalo, lo que se
 * elige es el orden en que los meseros encuentran las categorías y los
 * platillos en la caja, en todas las terminales. Por eso la opción por defecto
 * es «Orden de la carta» —el que ya está guardado— y cualquier otra se
 * confirma antes de reescribirlo.
 *
 * Vive fuera del componente para poder probarse: qué opciones hay y qué orden
 * propone cada una es justo lo que acaba viendo todo el restaurante.
 */
import type { Categoria, ProductoVisible } from "@motrest/dominio";
import { ordenar, ordenesComunes, type OpcionOrden } from "../../listas/listas.svelte";

/** El id de la opción que deja la carta como está. */
export const ORDEN_DE_LA_CARTA = "carta";

/** Lo que cualquier lista de la carta tiene: un id y su lugar guardado. */
interface ConLugar {
  id: string;
  orden: number;
}

function laDeLaCarta<T extends ConLugar>(): OpcionOrden<T> {
  return {
    id: ORDEN_DE_LA_CARTA,
    etiqueta: "Orden de la carta",
    comparar: (a, b) => a.orden - b.orden,
  };
}

/**
 * Para las categorías: la de la carta, y por nombre.
 *
 * No hay «más recientes»: una categoría no guarda cuándo se creó, y deducirlo
 * del id sería adivinar.
 */
export function ordenesDeCategorias(): OpcionOrden<Categoria>[] {
  return [laDeLaCarta<Categoria>(), ...ordenesComunes<Categoria>({ nombre: (c) => c.nombre })];
}

/**
 * Para los platillos de una categoría: la de la carta, por nombre y por
 * precio.
 *
 * El precio que cuenta es el de la carta, CON el impuesto dentro —el que se
 * lee en la tarjeta y en el menú de la pared—, no la base gravable: ordenar
 * por la base pondría un platillo capturado con el IVA por fuera en otro lugar
 * que el que su precio de carta dice.
 */
export function ordenesDeProductos(): OpcionOrden<ProductoVisible>[] {
  return [
    laDeLaCarta<ProductoVisible>(),
    ...ordenesComunes<ProductoVisible>({ nombre: (p) => p.nombre }),
    {
      id: "precio-sube",
      etiqueta: "Precio: de menor a mayor",
      comparar: (a, b) => a.impuesto.total - b.impuesto.total,
    },
    {
      id: "precio-baja",
      etiqueta: "Precio: de mayor a menor",
      comparar: (a, b) => b.impuesto.total - a.impuesto.total,
    },
  ];
}

/**
 * El orden que quedaría, como lista de ids, y si cambia algo.
 *
 * Se parte SIEMPRE de la lista completa en el orden de la carta —no de la
 * que se ve, que puede venir filtrada por la búsqueda—: ordenar «Pizzas» con
 * «hawa» tecleado en el buscador no puede dejar fuera a las demás pizzas.
 */
export function propuesta<T extends ConLugar>(
  enLaCarta: readonly T[],
  opcion: OpcionOrden<T>,
): { ids: string[]; lista: T[]; cambia: boolean } {
  const actual = ordenar(enLaCarta, laDeLaCarta<T>());
  const nueva = ordenar(actual, opcion);
  return {
    ids: nueva.map((x) => x.id),
    lista: nueva,
    cambia: nueva.some((x, i) => x.id !== actual[i]?.id),
  };
}
