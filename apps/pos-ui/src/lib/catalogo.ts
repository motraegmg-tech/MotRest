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
import { IVA_16, indexar, pesos } from "@motrest/dominio";
import type {
  CatalogoIndex,
  Categoria,
  GrupoModificadores,
  ID,
  PerfilImpuesto,
  Producto,
  Receta,
} from "@motrest/dominio";

export const impuestos: PerfilImpuesto[] = [IVA_16];

export const categorias: Categoria[] = [
  { id: "cat-pizzas", nombre: "Pizzas", orden: 1 },
  { id: "cat-pastas", nombre: "Pastas", orden: 2 },
  { id: "cat-carnes", nombre: "Carnes", orden: 3 },
  { id: "cat-ensaladas", nombre: "Ensaladas", orden: 4 },
  { id: "cat-bebidas", nombre: "Bebidas", orden: 5 },
  { id: "cat-postres", nombre: "Postres", orden: 6 },
];

/**
 * Recetas opcionales: desglosan los insumos de cada variedad y —cuando declaran
 * `insumo_id`, `cantidad` y `unidad`— descuentan existencias al enviar a cocina.
 * Los costos son los de la cantidad que consume una pizza completa.
 */
export const recetas: Receta[] = [
  {
    id: "rec-margherita",
    nombre: "Margherita",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4),
        insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8),
        insumo_id: "ins-pomodoro", cantidad: 150, unidad: "ml" },
      { id: "mozz-fdl", nombre: "Mozzarella fior di latte", costo: pesos(17.8),
        insumo_id: "ins-mozz-fdl", cantidad: 100, unidad: "g" },
      { id: "albahaca", nombre: "Albahaca fresca", costo: pesos(2.6),
        insumo_id: "ins-albahaca", cantidad: 10, unidad: "g" },
      { id: "aceite", nombre: "Aceite de oliva", costo: pesos(2.6),
        insumo_id: "ins-aceite", cantidad: 20, unidad: "ml" },
    ],
  },
  {
    id: "rec-pepperoni",
    nombre: "Pepperoni",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4),
        insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8),
        insumo_id: "ins-pomodoro", cantidad: 150, unidad: "ml" },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2),
        insumo_id: "ins-mozz", cantidad: 100, unidad: "g" },
      { id: "pepperoni", nombre: "Pepperoni artesanal", costo: pesos(15.8),
        insumo_id: "ins-pepperoni", cantidad: 40, unidad: "g" },
    ],
  },
  {
    id: "rec-cuatro-quesos",
    nombre: "Cuatro quesos",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4),
        insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8),
        insumo_id: "ins-pomodoro", cantidad: 150, unidad: "ml" },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2),
        insumo_id: "ins-mozz", cantidad: 100, unidad: "g" },
      { id: "gorgonzola", nombre: "Gorgonzola", costo: pesos(12),
        insumo_id: "ins-gorgonzola", cantidad: 40, unidad: "g" },
      { id: "parmesano", nombre: "Parmesano", costo: pesos(9),
        insumo_id: "ins-parmesano", cantidad: 25, unidad: "g" },
      { id: "provolone", nombre: "Provolone", costo: pesos(8),
        insumo_id: "ins-provolone", cantidad: 30, unidad: "g" },
    ],
  },
  {
    id: "rec-hawaiana",
    nombre: "Hawaiana",
    ingredientes: [
      { id: "masa", nombre: "Masa madre", costo: pesos(12.4),
        insumo_id: "ins-masa", cantidad: 200, unidad: "g" },
      { id: "pomodoro", nombre: "Salsa pomodoro", costo: pesos(6.8),
        insumo_id: "ins-pomodoro", cantidad: 150, unidad: "ml" },
      { id: "mozz", nombre: "Mozzarella", costo: pesos(14.2),
        insumo_id: "ins-mozz", cantidad: 100, unidad: "g" },
      { id: "jamon", nombre: "Jamón", costo: pesos(10),
        insumo_id: "ins-jamon", cantidad: 50, unidad: "g" },
      { id: "pina", nombre: "Piña", costo: pesos(6),
        insumo_id: "ins-pina", cantidad: 100, unidad: "g" },
    ],
  },
];

// --- Grupos de modificadores ---------------------------------------------------

const opcion = (
  id: ID,
  nombre: string,
  precio: number,
  costo: number,
  orden: number,
  extra: { por_defecto?: boolean; max_repeticiones?: number } = {},
) => ({
  id,
  nombre,
  precio_delta: pesos(precio),
  costo_delta: pesos(costo),
  max_repeticiones: extra.max_repeticiones ?? 1,
  disponible: true,
  por_defecto: extra.por_defecto ?? false,
  orden,
});

export const gruposModificadores: GrupoModificadores[] = [
  {
    id: "gm-termino",
    nombre: "Término",
    seleccion: "uno",
    min: 1,
    max: 1,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 1,
    opciones: [
      opcion("op-rojo", "Rojo", 0, 0, 1),
      opcion("op-medio", "Término medio", 0, 0, 2, { por_defecto: true }),
      opcion("op-tres-cuartos", "Tres cuartos", 0, 0, 3),
      opcion("op-bien-cocido", "Bien cocido", 0, 0, 4),
    ],
  },
  {
    id: "gm-orilla",
    nombre: "Orilla",
    seleccion: "uno",
    min: 1,
    max: 1,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 1,
    opciones: [
      opcion("op-orilla-trad", "Tradicional", 0, 0, 1, { por_defecto: true }),
      opcion("op-orilla-queso", "Rellena de queso", 35, 12, 2),
      opcion("op-orilla-delgada", "Delgada", 0, 0, 3),
    ],
  },
  {
    id: "gm-extras-pizza",
    nombre: "Ingredientes extra",
    seleccion: "varios",
    min: 0,
    max: 5,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 2,
    opciones: [
      opcion("op-extra-queso", "Extra queso", 25, 9, 1, { max_repeticiones: 2 }),
      opcion("op-champinon", "Champiñones", 20, 7, 2),
      opcion("op-jalapeno", "Jalapeños", 15, 4, 3),
      opcion("op-tocino", "Tocino", 30, 11, 4),
      opcion("op-aceituna", "Aceitunas", 18, 6, 5),
    ],
  },
  {
    id: "gm-quitar",
    nombre: "Quitar",
    seleccion: "varios",
    min: 0,
    max: 0,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 3,
    opciones: [
      opcion("op-sin-cebolla", "Sin cebolla", 0, 0, 1),
      opcion("op-sin-picante", "Sin picante", 0, 0, 2),
      opcion("op-sin-queso", "Sin queso", 0, -6, 3),
      opcion("op-sin-nuez", "Sin nuez", 0, 0, 4),
    ],
  },
  {
    id: "gm-guarnicion",
    nombre: "Guarnición",
    seleccion: "uno",
    min: 1,
    max: 1,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 2,
    opciones: [
      opcion("op-papas", "Papas al romero", 0, 8, 1, { por_defecto: true }),
      opcion("op-verduras", "Verduras al grill", 0, 10, 2),
      opcion("op-pure", "Puré de papa", 0, 7, 3),
      opcion("op-ensalada-guarn", "Ensalada verde", 15, 9, 4),
    ],
  },
  {
    id: "gm-aderezo",
    nombre: "Aderezos",
    seleccion: "varios",
    min: 0,
    max: 4,
    /** Los dos primeros van incluidos; del tercero en adelante se cobran. */
    incluidas_gratis: 2,
    ambito: "renglon",
    orden: 2,
    opciones: [
      opcion("op-cesar", "César", 12, 4, 1),
      opcion("op-balsamico", "Balsámico", 12, 4, 2),
      opcion("op-ranch", "Ranch", 12, 4, 3),
      opcion("op-mostaza-miel", "Mostaza y miel", 12, 4, 4),
    ],
  },
  {
    id: "gm-temperatura",
    nombre: "Preparación",
    seleccion: "uno",
    min: 0,
    max: 1,
    incluidas_gratis: 0,
    ambito: "renglon",
    orden: 1,
    opciones: [
      opcion("op-con-hielo", "Con hielo", 0, 0, 1, { por_defecto: true }),
      opcion("op-sin-hielo", "Sin hielo", 0, 0, 2),
      opcion("op-natural", "Al tiempo", 0, 0, 3),
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

const MOD_PIZZA = ["gm-orilla", "gm-extras-pizza", "gm-quitar"];

export const productos: Producto[] = [
  // --- Variedades de pizza (su precio lo pone el producto contenedor) ---
  { id: "var-margherita", nombre: "Margherita", categoria_id: "cat-pizzas", costo: pesos(42.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-margherita", disponible: false, orden: 1 },
  { id: "var-pepperoni", nombre: "Pepperoni", categoria_id: "cat-pizzas", costo: pesos(49.2),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-pepperoni", disponible: false, orden: 2 },
  { id: "var-cuatro-quesos", nombre: "Cuatro quesos", categoria_id: "cat-pizzas", costo: pesos(62.4),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-cuatro-quesos", disponible: false, orden: 3 },
  { id: "var-hawaiana", nombre: "Hawaiana", categoria_id: "cat-pizzas", costo: pesos(49.4),
    precio: pesos(0), impuesto_id: IVA_16.id, receta_id: "rec-hawaiana", disponible: false, orden: 4 },

  // --- Pizzas configurables por tamaño ---
  { id: "prod-pizza-chica", nombre: "Pizza chica mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(149), impuesto_id: IVA_16.id, disponible: true, orden: 10,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"),
    grupos_modificadores: MOD_PIZZA, estacion_id: "est-horno" },
  { id: "prod-pizza-mediana", nombre: "Pizza mediana mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(199), impuesto_id: IVA_16.id, disponible: true, orden: 11,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"),
    grupos_modificadores: MOD_PIZZA, estacion_id: "est-horno" },
  { id: "prod-pizza-familiar", nombre: "Pizza familiar mitad y mitad", categoria_id: "cat-pizzas",
    costo: pesos(0), precio: pesos(249), impuesto_id: IVA_16.id, disponible: true, orden: 12,
    esquema_porciones: ranurasMitades("var-margherita", "var-pepperoni"),
    grupos_modificadores: MOD_PIZZA, estacion_id: "est-horno" },

  // --- Pastas ---
  { id: "prod-pasta-pesto", nombre: "Pasta al pesto", categoria_id: "cat-pastas", costo: pesos(34),
    precio: pesos(139), impuesto_id: IVA_16.id, disponible: true, orden: 20,
    grupos_modificadores: ["gm-quitar"], estacion_id: "est-pastas" },
  { id: "prod-pasta-bolonesa", nombre: "Pasta boloñesa", categoria_id: "cat-pastas", costo: pesos(50),
    precio: pesos(149), impuesto_id: IVA_16.id, disponible: true, orden: 21,
    grupos_modificadores: ["gm-quitar"], estacion_id: "est-pastas" },
  { id: "prod-lasagna", nombre: "Lasaña de la casa", categoria_id: "cat-pastas", costo: pesos(58),
    precio: pesos(169), impuesto_id: IVA_16.id, disponible: true, orden: 22,
    grupos_modificadores: ["gm-quitar"], estacion_id: "est-pastas" },

  // --- Carnes: obligan a elegir término y guarnición ---
  { id: "prod-rib-eye", nombre: "Rib eye 350 g", categoria_id: "cat-carnes", costo: pesos(180),
    precio: pesos(429), impuesto_id: IVA_16.id, disponible: true, orden: 30,
    grupos_modificadores: ["gm-termino", "gm-guarnicion", "gm-quitar"], estacion_id: "est-parrilla" },
  { id: "prod-arrachera", nombre: "Arrachera 250 g", categoria_id: "cat-carnes", costo: pesos(120),
    precio: pesos(289), impuesto_id: IVA_16.id, disponible: true, orden: 31,
    grupos_modificadores: ["gm-termino", "gm-guarnicion"], estacion_id: "est-parrilla" },
  { id: "prod-pollo-parrilla", nombre: "Pechuga a la parrilla", categoria_id: "cat-carnes",
    costo: pesos(72), precio: pesos(199), impuesto_id: IVA_16.id, disponible: true, orden: 32,
    grupos_modificadores: ["gm-guarnicion"], estacion_id: "est-parrilla" },

  // --- Ensaladas: aderezos con dos incluidos ---
  { id: "prod-cesar", nombre: "Ensalada César", categoria_id: "cat-ensaladas", costo: pesos(38),
    precio: pesos(129), impuesto_id: IVA_16.id, disponible: true, orden: 40,
    grupos_modificadores: ["gm-aderezo", "gm-quitar"], estacion_id: "est-fria" },
  { id: "prod-caprese", nombre: "Ensalada caprese", categoria_id: "cat-ensaladas", costo: pesos(44),
    precio: pesos(139), impuesto_id: IVA_16.id, disponible: true, orden: 41,
    grupos_modificadores: ["gm-aderezo"], estacion_id: "est-fria" },

  // --- Bebidas ---
  { id: "prod-limonada", nombre: "Limonada de la casa", categoria_id: "cat-bebidas", costo: pesos(8),
    precio: pesos(45), impuesto_id: IVA_16.id, disponible: true, orden: 50,
    grupos_modificadores: ["gm-temperatura"], estacion_id: "est-barra" },
  { id: "prod-agua", nombre: "Agua mineral", categoria_id: "cat-bebidas", costo: pesos(6),
    precio: pesos(38), impuesto_id: IVA_16.id, disponible: true, orden: 51,
    grupos_modificadores: ["gm-temperatura"], estacion_id: "est-barra" },
  { id: "prod-tinto", nombre: "Copa de tinto", categoria_id: "cat-bebidas", costo: pesos(35),
    precio: pesos(95), impuesto_id: IVA_16.id, disponible: true, orden: 52, estacion_id: "est-barra" },
  { id: "prod-cafe", nombre: "Café americano", categoria_id: "cat-bebidas", costo: pesos(7),
    precio: pesos(42), impuesto_id: IVA_16.id, disponible: true, orden: 53, estacion_id: "est-barra" },

  // --- Postres ---
  { id: "prod-tiramisu", nombre: "Tiramisú", categoria_id: "cat-postres", costo: pesos(28),
    precio: pesos(89), impuesto_id: IVA_16.id, disponible: true, orden: 60, estacion_id: "est-postres" },
  { id: "prod-cheesecake", nombre: "Cheesecake de frutos rojos", categoria_id: "cat-postres",
    costo: pesos(32), precio: pesos(95), impuesto_id: IVA_16.id, disponible: true, orden: 61,
    estacion_id: "est-postres" },
];

export const catalogo: CatalogoIndex = indexar({
  productos,
  categorias,
  recetas,
  impuestos,
  grupos: gruposModificadores,
});

/** Tamaños de pizza, en el orden en que se muestran las pestañas. */
export const tamanosPizza = [
  { clave: "Chica", producto_id: "prod-pizza-chica" },
  { clave: "Mediana", producto_id: "prod-pizza-mediana" },
  { clave: "Familiar", producto_id: "prod-pizza-familiar" },
] as const;
