/**
 * Catálogo de demostración (Rodizio), en el modo simple del ADR-16:
 * el administrador captura **costo final y precio** de cada producto.
 *
 * Las recetas son la CAPA OPCIONAL: solo las variedades de pizza las traen, para
 * mostrar el desglose de insumos en el configurador. Todo lo demás funciona sin
 * capturar un solo ingrediente.
 *
 * En la etapa 9 (M9 Administración) este archivo se sustituye por el catálogo
 * que el propio restaurante da de alta desde la interfaz.
 */
import { IVA_16, indexar, pesos } from "@motrest/dominio";
import type {
  CatalogoIndex,
  Categoria,
  ID,
  PerfilImpuesto,
  Producto,
  Receta,
} from "@motrest/dominio";

export const impuestos: PerfilImpuesto[] = [IVA_16];

export const categorias: Categoria[] = [
  { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
  { id: "cat-pastas", nombre: "Pastas", orden: 2 },
  { id: "cat-bebidas", nombre: "Bebidas", orden: 3 },
  { id: "cat-postres", nombre: "Postres", orden: 4 },
];

/** Recetas opcionales: solo para desglosar los insumos de cada variedad. */
export const recetas: Receta[] = [
  {
    id: "rec-margherita",
    nombre: "Margherita",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4) },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8) },
      { id: "mozz-fdl", nombre: "Mozzarella fior di latte", costo: pesos(17.8) },
      { id: "albahaca", nombre: "Albahaca fresca", costo: pesos(2.6) },
      { id: "aceite", nombre: "Aceite de oliva", costo: pesos(2.6) },
    ],
  },
  {
    id: "rec-pepperoni",
    nombre: "Pepperoni",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4) },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8) },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2) },
      { id: "pepperoni", nombre: "Pepperoni artesanal", costo: pesos(15.8) },
    ],
  },
  {
    id: "rec-cuatro-quesos",
    nombre: "Cuatro quesos",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4) },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8) },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2) },
      { id: "gorgonzola", nombre: "Gorgonzola", costo: pesos(12) },
      { id: "parmesano", nombre: "Parmesano", costo: pesos(9) },
      { id: "provolone", nombre: "Provolone", costo: pesos(8) },
    ],
  },
  {
    id: "rec-hawaiana",
    nombre: "Hawaiana",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4) },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8) },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2) },
      { id: "jamon", nombre: "Jamón", costo: pesos(10) },
      { id: "pina", nombre: "Piña", costo: pesos(6) },
    ],
  },
];

/** Variedades que pueden ocupar una ranura de la pizza. */
export const idsVariedades: ID[] = [
  "var-margherita",
  "var-pepperoni",
  "var-cuatro-quesos",
  "var-hawaiana",
];

const ranurasMitades = (izq: ID, der: ID) => ({
  presentacion: "circulo" as const,
  ranuras: [
    {
      id: "izq", etiqueta: "Mitad izquierda", fraccion: 0.5, obligatoria: true,
      opciones_producto: idsVariedades, producto_por_defecto: izq,
    },
    {
      id: "der", etiqueta: "Mitad derecha", fraccion: 0.5, obligatoria: true,
      opciones_producto: idsVariedades, producto_por_defecto: der,
    },
  ],
});

export const productos: Producto[] = [
  // --- Variedades (su precio lo pone el producto contenedor) ---
  { id: "var-margherita", nombre: "Margherita", categoria_id: "cat-pizzas", costo: pesos(42.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-margherita", disponible: true, orden: 1 },
  { id: "var-pepperoni", nombre: "Pepperoni", categoria_id: "cat-pizzas", costo: pesos(49.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-pepperoni", disponible: true, orden: 2 },
  { id: "var-cuatro-quesos", nombre: "Cuatro quesos", categoria_id: "cat-pizzas", costo: pesos(62.4),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-cuatro-quesos", disponible: true, orden: 3 },
  { id: "var-hawaiana", nombre: "Hawaiana", categoria_id: "cat-pizzas", costo: pesos(49.4),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-hawaiana", disponible: true, orden: 4 },

  // --- Pizzas configurables por tamaño ---
  { id: "prod-pizza-chica", nombre: "Pizza chica mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(149), impuesto_id: IVA_16.id, disponible: true, orden: 10,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"), estacion_id: "est-horno" },
  { id: "prod-pizza-mediana", nombre: "Pizza mediana mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(199), impuesto_id: IVA_16.id, disponible: true, orden: 11,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"), estacion_id: "est-horno" },
  { id: "prod-pizza-familiar", nombre: "Pizza familiar mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(249), impuesto_id: IVA_16.id, disponible: true, orden: 12,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"), estacion_id: "est-horno" },

  // --- Productos simples: costo y precio finales ---
  { id: "prod-pasta-pesto", nombre: "Pasta al pesto", categoria_id: "cat-pastas", costo: pesos(34),
    precio: pesos(139), impuesto_id: IVA_16.id, disponible: true, orden: 20, estacion_id: "est-pastas" },
  { id: "prod-pasta-bolonesa", nombre: "Pasta boloñesa", categoria_id: "cat-pastas", costo: pesos(50),
    precio: pesos(149), impuesto_id: IVA_16.id, disponible: true, orden: 21, estacion_id: "est-pastas" },
  { id: "prod-limonada", nombre: "Limonada de la casa", categoria_id: "cat-bebidas", costo: pesos(8),
    precio: pesos(45), impuesto_id: IVA_16.id, disponible: true, orden: 30, estacion_id: "est-barra" },
  { id: "prod-agua", nombre: "Agua mineral", categoria_id: "cat-bebidas", costo: pesos(6),
    precio: pesos(38), impuesto_id: IVA_16.id, disponible: true, orden: 31, estacion_id: "est-barra" },
  { id: "prod-tinto", nombre: "Copa de tinto", categoria_id: "cat-bebidas", costo: pesos(35),
    precio: pesos(95), impuesto_id: IVA_16.id, disponible: true, orden: 32, estacion_id: "est-barra" },
  { id: "prod-tiramisu", nombre: "Tiramisú", categoria_id: "cat-postres", costo: pesos(28),
    precio: pesos(89), impuesto_id: IVA_16.id, disponible: true, orden: 40, estacion_id: "est-postres" },
];

export const catalogo: CatalogoIndex = indexar({
  productos,
  categorias,
  recetas,
  impuestos,
});

/** Tamaños de pizza, en el orden en que se muestran las pestañas. */
export const tamanosPizza = [
  { clave: "Chica", producto_id: "prod-pizza-chica" },
  { clave: "Mediana", producto_id: "prod-pizza-mediana" },
  { clave: "Familiar", producto_id: "prod-pizza-familiar" },
] as const;

/** Productos que se agregan de un toque (sin configurar). */
export const productosRapidos: ID[] = [
  "prod-pasta-pesto",
  "prod-pasta-bolonesa",
  "prod-limonada",
  "prod-agua",
  "prod-tinto",
  "prod-tiramisu",
];

/** Categorías presentes en el agregado rápido, en orden. */
export const categoriasRapidas: ID[] = ["cat-pastas", "cat-bebidas", "cat-postres"];
