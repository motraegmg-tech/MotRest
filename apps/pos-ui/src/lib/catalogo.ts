/**
 * Catálogo de demostración, en el modo simple del ADR-16: el administrador
 * captura **costo final y precio** de cada producto.
 *
 * Incluye a propósito platillos que NO son pizza y grupos de modificadores
 * reales (término, extras, quitar, preparación), para demostrar que el software
 * sirve a cualquier restaurante. Las recetas son la capa OPCIONAL: solo las
 * variedades de pizza las traen, para el desglose de insumos del configurador.
 *
 * En la etapa 9 (M9 Administración) esto se sustituye por el catálogo que el
 * propio restaurante da de alta desde la interfaz.
 */
import { IVA_16, estacionesPorDefecto, pesos } from "@motrest/dominio";
import type {
  CatalogoIndex,
  Categoria,
  GrupoModificadores,
  ID,
  MenuLocal,
  PerfilImpuesto,
  Producto,
  Receta,
} from "@motrest/dominio";
import { menu } from "./menu.svelte";

export const impuestos: PerfilImpuesto[] = [IVA_16];

export function cartaVacia(): MenuLocal {
  return {
    version: 1,
    updated_at: 0,
    productos: [],
    categorias: [],
    recetas: [],
    impuestos,
    grupos: [],
    insumos: [],
    estaciones: estacionesPorDefecto(),
  };
}

/**
 * El catálogo vivo.
 *
 * Es un objeto de getters, no una instantánea: cada lectura consulta el store
 * del menú, así que editar la carta se refleja al instante en el POS, el
 * configurador y el inventario **sin que ninguno de ellos cambie una línea**.
 * Leerlo dentro de un `$derived` lo suscribe a los cambios, como cualquier
 * estado de Svelte.
 */
export const catalogo: CatalogoIndex = {
  get productos() {
    return menu.index.productos;
  },
  get categorias() {
    return menu.index.categorias;
  },
  get recetas() {
    return menu.index.recetas;
  },
  get impuestos() {
    return menu.index.impuestos;
  },
  get grupos() {
    return menu.index.grupos;
  },
};

/** Tamaños de pizza, en el orden en que se muestran las pestañas. */
export const tamanosPizza = [
  { clave: "Chica", producto_id: "prod-pizza-chica" },
  { clave: "Mediana", producto_id: "prod-pizza-mediana" },
  { clave: "Familiar", producto_id: "prod-pizza-familiar" },
] as const;
