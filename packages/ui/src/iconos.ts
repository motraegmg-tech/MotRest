/**
 * Iconografía de MotRest — 103 dibujos propios, aprobados uno por uno por
 * Gonzalo en septiembre de 2026.
 *
 * ## Por qué los dibujos viven aquí y no como archivos .svg
 *
 * El POS es LAN-first: no puede pedir nada a un CDN y el instalador no debería
 * cargar 103 peticiones más. Como módulo del workspace, los iconos entran al
 * bundle igual que cualquier otro dato del dominio, se comparten entre el POS,
 * Central y el portal sin configuración de Vite, y las pruebas los pueden leer
 * en Node sin navegador.
 *
 * ## Las dos capas
 *
 * Cada icono son DOS capas superpuestas:
 *
 * - `fondo` — relleno macizo en el tono del icono. Es lo que le da vida.
 * - `linea` — el trazo, siempre en `currentColor`: hereda el color del texto
 *   que lo rodea, así el mismo dibujo sirve sobre el carril negro y sobre un
 *   panel claro sin tocarlo.
 *
 * Un icono sin `fondo` es deliberado: hay 19 donde el relleno ensuciaba el
 * dibujo (flechas, la equis, el copo de la estación fría) y dos —Menú y
 * Permisos— que Gonzalo pidió expresamente en blanco y negro.
 *
 * `fondo2` existe para un solo caso: la propina lleva el billete verde y las
 * monedas doradas, y son dos materiales distintos, no un capricho de color.
 *
 * ## La regla que no se rompe
 *
 * El color NUNCA es el único portador de significado. Cada icono se distingue
 * por su silueta antes que por su tono; el color confirma. Por eso el rojo y el
 * verde conviven sin problema en los movimientos de inventario: las nueve
 * siluetas ya son distintas entre sí.
 */

/** Los tonos, con su contraste medido contra los dos fondos donde viven. */
export interface Tono {
  hex: string;
  /** Contraste contra el panel claro `#F4F6F3`. */
  contrastePanel: number;
  /** Contraste contra el carril oscuro `#14181A`. */
  contrasteCarril: number;
}

/**
 * Paleta de la iconografía.
 *
 * Todos pasan 3:1 contra el panel Y contra el carril — el mínimo de la WCAG
 * 2.2 (SC 1.4.11) para objetos gráficos. La banda es estrecha a propósito: un
 * tono más claro se pierde sobre el panel y uno más oscuro se traga el carril.
 * No agregues uno sin medirlo contra los dos.
 */
export const TONOS = {
  brasa: { hex: "#c25a12", contrastePanel: 4.06, contrasteCarril: 4.05 },
  fuego: { hex: "#c0392b", contrastePanel: 5, contrasteCarril: 3.29 },
  tomate: { hex: "#c1443a", contrastePanel: 4.65, contrasteCarril: 3.54 },
  ambar: { hex: "#a8741a", contrastePanel: 3.73, contrasteCarril: 4.41 },
  mostaza: { hex: "#94781c", contrastePanel: 3.89, contrasteCarril: 4.22 },
  oliva: { hex: "#6f7d2e", contrastePanel: 4.16, contrasteCarril: 3.96 },
  verde: { hex: "#3f7d22", contrastePanel: 4.64, contrasteCarril: 3.55 },
  jade: { hex: "#1c7d5a", contrastePanel: 4.68, contrasteCarril: 3.51 },
  turquesa: { hex: "#17787c", contrastePanel: 4.81, contrasteCarril: 3.42 },
  acero: { hex: "#4a6b7c", contrastePanel: 5.24, contrasteCarril: 3.14 },
  cielo: { hex: "#2a6fa8", contrastePanel: 4.91, contrasteCarril: 3.35 },
  indigo: { hex: "#4f60ae", contrastePanel: 5.34, contrasteCarril: 3.08 },
  ciruela: { hex: "#835392", contrastePanel: 5.34, contrasteCarril: 3.08 },
  vino: { hex: "#9a4d65", contrastePanel: 5.33, contrasteCarril: 3.08 },
  rosa: { hex: "#b04a72", contrastePanel: 4.75, contrasteCarril: 3.46 },
  cafe: { hex: "#835e3e", contrastePanel: 5.31, contrasteCarril: 3.09 },
  pizarra: { hex: "#5a676e", contrastePanel: 5.37, contrasteCarril: 3.06 },
  dorado: { hex: "#8f7422", contrastePanel: 4.12, contrasteCarril: 3.99 },
} as const satisfies Record<string, Tono>;

export type NombreTono = keyof typeof TONOS;

export interface Icono {
  /** Cómo se llama en la interfaz. */
  nombre: string;
  /** Tono del relleno principal. */
  tono: NombreTono;
  /** Segundo tono, solo cuando el icono tiene dos materiales. */
  tono2?: NombreTono;
  /** Formas macizas del relleno. Vacío = el icono va solo en línea. */
  fondo: string;
  /** Formas del segundo relleno. */
  fondo2?: string;
  /** El trazo, en `currentColor`. */
  linea: string;
  /** Qué representa el dibujo. Sirve de `aria-label` cuando el icono va solo. */
  idea: string;
}

/**
 * El catálogo literal.
 *
 * Se declara `as const` para que las CLAVES sean nombres exactos y no `string`:
 * así `<Icono nombre="cocna" />` no compila. Pero eso también estrecha los
 * VALORES a lo que cada icono trae, y sólo la propina tiene `fondo2` — con lo
 * que leer `icono.fondo2` en un icono cualquiera dejaba de compilar. Por eso el
 * catálogo se exporta abajo con el tipo ancho: claves exactas, valores
 * uniformes.
 */
const CATALOGO = {
  // A · Los 9 módulos
  //    apps/pos-ui/src/lib/nav/modulos.ts:51-266
  "venta": {
    nombre: "Venta",
    tono: "brasa",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"5.4\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"5.4\"/><rect x=\"9.7\" y=\"2.4\" width=\"4.6\" height=\"2.3\" rx=\"1.15\"/><rect x=\"9.7\" y=\"19.3\" width=\"4.6\" height=\"2.3\" rx=\"1.15\"/><rect x=\"2.4\" y=\"9.7\" width=\"2.3\" height=\"4.6\" rx=\"1.15\"/><rect x=\"19.3\" y=\"9.7\" width=\"2.3\" height=\"4.6\" rx=\"1.15\"/>",
    idea: "Mesa redonda vista desde arriba con sus cuatro sillas",
  },
  "cocina": {
    nombre: "Cocina",
    tono: "ambar",
    fondo: "<path d=\"M6.6 13h10.8v5.4a1.9 1.9 0 0 1-1.9 1.9H8.5a1.9 1.9 0 0 1-1.9-1.9z\"/>",
    linea: "<path d=\"M6.6 13a3.8 3.8 0 1 1 1.15-7.4 4.3 4.3 0 0 1 8.5 0A3.8 3.8 0 1 1 17.4 13\"/><path d=\"M6.6 13h10.8v5.4a1.9 1.9 0 0 1-1.9 1.9H8.5a1.9 1.9 0 0 1-1.9-1.9z\"/><path d=\"M6.6 16.3h10.8\"/>",
    idea: "El gorro de chef: copa inflada y banda doblada",
  },
  "inventario": {
    nombre: "Inventario",
    tono: "cafe",
    fondo: "<rect x=\"7.9\" y=\"3.9\" width=\"8.2\" height=\"7.6\" rx=\"1.3\"/>",
    linea: "<rect x=\"2.6\" y=\"12.6\" width=\"8.2\" height=\"7.6\" rx=\"1.3\"/><rect x=\"13.2\" y=\"12.6\" width=\"8.2\" height=\"7.6\" rx=\"1.3\"/><rect x=\"7.9\" y=\"3.9\" width=\"8.2\" height=\"7.6\" rx=\"1.3\"/><path d=\"M5.4 12.6v2.3M16 12.6v2.3M10.7 3.9v2.3\"/>",
    idea: "Tres cajas estibadas con su cinta",
  },
  "compras": {
    nombre: "Compras",
    tono: "acero",
    fondo: "<path d=\"M2.4 7.6a1.2 1.2 0 0 1 1.2-1.2h9.4v10.2H3.6a1.2 1.2 0 0 1-1.2-1.2z\"/>",
    linea: "<path d=\"M2.4 7.6a1.2 1.2 0 0 1 1.2-1.2h9.4v10.2H3.6a1.2 1.2 0 0 1-1.2-1.2z\"/><path d=\"M13 9.6h3.7a1.6 1.6 0 0 1 1.3.66l2.4 3.2a1.6 1.6 0 0 1 .3.95v2.2H13z\"/><circle cx=\"7.1\" cy=\"18.4\" r=\"1.9\"/><circle cx=\"17.1\" cy=\"18.4\" r=\"1.9\"/>",
    idea: "La camioneta del proveedor llegando con la mercancía",
  },
  "finanzas": {
    nombre: "Finanzas",
    tono: "verde",
    fondo: "<rect x=\"2.4\" y=\"5.8\" width=\"19.2\" height=\"12.4\" rx=\"2.1\"/>",
    linea: "<rect x=\"2.4\" y=\"5.8\" width=\"19.2\" height=\"12.4\" rx=\"2.1\"/><circle cx=\"12\" cy=\"12\" r=\"2.9\"/><path d=\"M6 9.4v5.2M18 9.4v5.2\"/>",
    idea: "Billete con la moneda al centro",
  },
  "personal": {
    nombre: "Personal",
    tono: "indigo",
    fondo: "<rect x=\"4\" y=\"5\" width=\"16\" height=\"16.2\" rx=\"2.3\"/>",
    linea: "<rect x=\"4\" y=\"5\" width=\"16\" height=\"16.2\" rx=\"2.3\"/><path d=\"M9.6 2.4h4.8v2.6H9.6z\"/><circle cx=\"12\" cy=\"11.2\" r=\"2.2\"/><path d=\"M8.2 17.6a3.9 3.9 0 0 1 7.6 0\"/>",
    idea: "El gafete del empleado, con su broche arriba",
  },
  "clientes": {
    nombre: "Clientes",
    tono: "cielo",
    fondo: "<circle cx=\"12\" cy=\"7.9\" r=\"3.6\"/><path d=\"M4.5 20.6a7.5 7.5 0 0 1 15 0z\"/>",
    linea: "<circle cx=\"12\" cy=\"7.9\" r=\"3.6\"/><path d=\"M4.5 20.6a7.5 7.5 0 0 1 15 0\"/>",
    idea: "El comensal: cabeza y hombros, sin adornos",
  },
  "inteligencia": {
    nombre: "Inteligencia",
    tono: "ciruela",
    fondo: "<path d=\"M18.6 2.8l.78 2.02 2.02.78-2.02.78-.78 2.02-.78-2.02-2.02-.78 2.02-.78z\"/>",
    linea: "<path d=\"M3.4 20.6h17.2\"/><rect x=\"4.7\" y=\"13.4\" width=\"3.4\" height=\"7.2\" rx=\"1\"/><rect x=\"10.3\" y=\"9.8\" width=\"3.4\" height=\"10.8\" rx=\"1\"/><rect x=\"15.9\" y=\"14.6\" width=\"3.4\" height=\"6\" rx=\"1\"/><path d=\"M18.6 2.8l.78 2.02 2.02.78-2.02.78-.78 2.02-.78-2.02-2.02-.78 2.02-.78z\"/>",
    idea: "Barras de reporte con la chispa de la IA",
  },
  "administracion": {
    nombre: "Administración",
    tono: "verde",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.65 5.35l-1.7 1.7M7.05 16.95l-1.7 1.7M18.65 18.65l-1.7-1.7M7.05 7.05l-1.7-1.7\"/>",
    idea: "Engrane: la configuración de todo el local",
  },

  // B · Las secciones del menú
  //    apps/pos-ui/src/lib/nav/modulos.ts — campo nuevo en SeccionModulo
  "salon": {
    nombre: "Salón y comandas",
    tono: "brasa",
    fondo: "<circle cx=\"8\" cy=\"9\" r=\"2\"/><circle cx=\"16\" cy=\"9\" r=\"2\"/><circle cx=\"8\" cy=\"15.6\" r=\"2\"/><circle cx=\"16\" cy=\"15.6\" r=\"2\"/>",
    linea: "<rect x=\"2.6\" y=\"3.6\" width=\"18.8\" height=\"16.8\" rx=\"2.2\"/><circle cx=\"8\" cy=\"9\" r=\"2\"/><circle cx=\"16\" cy=\"9\" r=\"2\"/><circle cx=\"8\" cy=\"15.6\" r=\"2\"/><circle cx=\"16\" cy=\"15.6\" r=\"2\"/>",
    idea: "El plano del salón: mesas repartidas dentro del recinto",
  },
  "tablero": {
    nombre: "Tablero de cocina",
    tono: "brasa",
    fondo: "<rect x=\"2.4\" y=\"4\" width=\"19.2\" height=\"13.4\" rx=\"2.1\"/>",
    linea: "<rect x=\"2.4\" y=\"4\" width=\"19.2\" height=\"13.4\" rx=\"2.1\"/><path d=\"M8.6 21h6.8M12 17.4V21\"/><path d=\"M6.2 8.2h4M6.2 11.4h4M13.8 8.2h4M13.8 11.4h2.4\"/>",
    idea: "La pantalla del KDS con sus comandas en fila",
  },
  "menu": {
    nombre: "Menú / la carta",
    tono: "ambar",
    fondo: "",
    linea: "<path d=\"M12 6.2v14\"/><path d=\"M12 6.2C10.4 4.9 8.4 4.3 5.6 4.3a1.4 1.4 0 0 0-1.4 1.4v11.5a1.4 1.4 0 0 0 1.4 1.4c2.8 0 4.8.6 6.4 1.9\"/><path d=\"M12 6.2c1.6-1.3 3.6-1.9 6.4-1.9a1.4 1.4 0 0 1 1.4 1.4v11.5a1.4 1.4 0 0 1-1.4 1.4c-2.8 0-4.8.6-6.4 1.9\"/>",
    idea: "La carta abierta en dos hojas",
  },
  "facturacion": {
    nombre: "Facturación",
    tono: "verde",
    fondo: "<circle cx=\"11.4\" cy=\"14.4\" r=\"2.9\"/>",
    linea: "<path d=\"M5.4 2.9h9.2l4.6 4.6v11.4a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2V5.1a2.2 2.2 0 0 1 2.2-2.2z\"/><path d=\"M14.2 2.9v4.8h5\"/><circle cx=\"11.4\" cy=\"14.4\" r=\"2.9\"/><path d=\"M9.6 16.9l-.6 3.2 2.4-1.3 2.4 1.3-.6-3.2\"/>",
    idea: "El CFDI: documento timbrado con su sello",
  },
  "canales": {
    nombre: "Canales y apps",
    tono: "verde",
    fondo: "<circle cx=\"12\" cy=\"4.6\" r=\"2.2\"/>",
    linea: "<circle cx=\"12\" cy=\"4.6\" r=\"2.2\"/><circle cx=\"4.6\" cy=\"19.4\" r=\"2.2\"/><circle cx=\"12\" cy=\"19.4\" r=\"2.2\"/><circle cx=\"19.4\" cy=\"19.4\" r=\"2.2\"/><path d=\"M12 6.8v4M12 10.8H4.6v6.4M12 10.8h7.4v6.4M12 10.8v6.4\"/>",
    idea: "Un pedido que se reparte a tres destinos",
  },
  "grupo": {
    nombre: "El grupo",
    tono: "verde",
    fondo: "<path d=\"M3.2 20.6V9.4l5.4-3.6 5.4 3.6v11.2z\"/>",
    linea: "<path d=\"M3.2 20.6V9.4l5.4-3.6 5.4 3.6v11.2\"/><path d=\"M14 20.6V12l3.4-2.2 3.4 2.2v8.6\"/><path d=\"M2.2 20.6h19.6\"/><path d=\"M7 20.6v-3.6h3.2v3.6\"/>",
    idea: "Varias sucursales del mismo dueño",
  },
  "asistencia": {
    nombre: "Asistencia",
    tono: "indigo",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"8.6\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.6\"/><path d=\"M12 7.2V12l3.1 1.9\"/><path d=\"M12 3.4V1.9M12 22.1v-1.5\"/>",
    idea: "El reloj checador con su marca de entrada",
  },
  "prenomina": {
    nombre: "Prenómina",
    tono: "indigo",
    fondo: "<rect x=\"2.6\" y=\"5.4\" width=\"18.8\" height=\"13.2\" rx=\"2.1\"/>",
    linea: "<rect x=\"2.6\" y=\"5.4\" width=\"18.8\" height=\"13.2\" rx=\"2.1\"/><path d=\"M2.9 6.6l8.2 6a1.6 1.6 0 0 0 1.8 0l8.2-6\"/><path d=\"M8.4 18.2l-5.5 0M21.1 18.2l-5.5 0\"/>",
    idea: "El sobre con el pago de la semana",
  },
  "reservas": {
    nombre: "Reservas y espera",
    tono: "cielo",
    fondo: "<rect x=\"10.6\" y=\"12.8\" width=\"4\" height=\"4\" rx=\"1\"/>",
    linea: "<rect x=\"3.2\" y=\"4.9\" width=\"17.6\" height=\"16\" rx=\"2.2\"/><path d=\"M3.2 9.6h17.6M8.4 2.6v4.4M15.6 2.6v4.4\"/><rect x=\"10.6\" y=\"12.8\" width=\"4\" height=\"4\" rx=\"1\"/>",
    idea: "El calendario con el día apartado",
  },
  "reportes": {
    nombre: "Reportes",
    tono: "ciruela",
    fondo: "<path d=\"M5.6 2.9h12.8a2.2 2.2 0 0 1 2.2 2.2v13.8a2.2 2.2 0 0 1-2.2 2.2H5.6a2.2 2.2 0 0 1-2.2-2.2V5.1a2.2 2.2 0 0 1 2.2-2.2z\"/>",
    linea: "<path d=\"M5.6 2.9h12.8a2.2 2.2 0 0 1 2.2 2.2v13.8a2.2 2.2 0 0 1-2.2 2.2H5.6a2.2 2.2 0 0 1-2.2-2.2V5.1a2.2 2.2 0 0 1 2.2-2.2z\"/><path d=\"M8.2 16.6v-3.4M12 16.6V9.4M15.8 16.6v-5.2\"/>",
    idea: "La hoja con la gráfica del día",
  },
  "como-voy": {
    nombre: "Cómo voy",
    tono: "ciruela",
    fondo: "<circle cx=\"12\" cy=\"17.6\" r=\"1.6\"/>",
    linea: "<path d=\"M3.4 17.6a8.6 8.6 0 0 1 17.2 0\"/><path d=\"M12 17.6l4.4-4.8\"/><circle cx=\"12\" cy=\"17.6\" r=\"1.6\"/><path d=\"M3.4 17.6h1.7M18.9 17.6h1.7M6 11.2l1.2 1.2M18 11.2l-1.2 1.2M12 8.6v1.7\"/>",
    idea: "El tablero de aguja: de un vistazo, si voy bien o no",
  },
  "usuarios": {
    nombre: "Usuarios",
    tono: "verde",
    fondo: "<circle cx=\"9.4\" cy=\"8.2\" r=\"3.3\"/><path d=\"M2.8 20.2a6.6 6.6 0 0 1 13.2 0z\"/>",
    linea: "<circle cx=\"9.4\" cy=\"8.2\" r=\"3.3\"/><path d=\"M2.8 20.2a6.6 6.6 0 0 1 13.2 0\"/><path d=\"M16.4 5.4a3.3 3.3 0 0 1 0 6.4\"/><path d=\"M18.2 14.4a6.6 6.6 0 0 1 3 5.8\"/>",
    idea: "El equipo del local: dos personas",
  },
  "permisos": {
    nombre: "Permisos",
    tono: "mostaza",
    fondo: "",
    linea: "<circle cx=\"8.2\" cy=\"8.2\" r=\"4.3\"/><path d=\"M11.3 11.3l8.6 8.6\"/><path d=\"M15.6 15.6l2.3-2.3M18.1 18.1l2.3-2.3\"/>",
    idea: "La llave: quién puede abrir qué",
  },
  "insumos": {
    nombre: "Insumos",
    tono: "ambar",
    fondo: "<path d=\"M10 6.2c-2.6 1.1-4.6 3.8-4.6 7.4v4.6a3 3 0 0 0 3 3h7.2a3 3 0 0 0 3-3v-4.6c0-3.6-2-6.3-4.6-7.4z\"/>",
    linea: "<path d=\"M8.6 2.8h6.8l-1.4 3.4H10z\"/><path d=\"M10 6.2c-2.6 1.1-4.6 3.8-4.6 7.4v4.6a3 3 0 0 0 3 3h7.2a3 3 0 0 0 3-3v-4.6c0-3.6-2-6.3-4.6-7.4\"/><path d=\"M9.4 13.6h5.2\"/>",
    idea: "El costal de ingrediente del almacén",
  },
  "impresoras": {
    nombre: "Impresoras",
    tono: "pizarra",
    fondo: "<path d=\"M6.6 14.4h10.8v6.2H6.6z\"/>",
    linea: "<path d=\"M6.6 8.6V3.6h10.8v5\"/><path d=\"M6.6 17.4H4.8a2 2 0 0 1-2-2v-4.8a2 2 0 0 1 2-2h14.4a2 2 0 0 1 2 2v4.8a2 2 0 0 1-2 2h-1.8\"/><path d=\"M6.6 14.4h10.8v6.2H6.6z\"/><circle cx=\"18.1\" cy=\"12\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/>",
    idea: "La térmica escupiendo el ticket",
  },
  "socios": {
    nombre: "Socios",
    tono: "dorado",
    fondo: "<path d=\"M17.6 14.2l1.05 2.15 2.35.35-1.7 1.65.4 2.35-2.1-1.1-2.1 1.1.4-2.35-1.7-1.65 2.35-.35z\"/>",
    linea: "<circle cx=\"12\" cy=\"7.6\" r=\"3.4\"/><path d=\"M5.4 20.4a6.6 6.6 0 0 1 9.4-6\"/><path d=\"M17.6 14.2l1.05 2.15 2.35.35-1.7 1.65.4 2.35-2.1-1.1-2.1 1.1.4-2.35-1.7-1.65 2.35-.35z\"/>",
    idea: "El inversionista: persona con su distintivo",
  },
  "mensajes": {
    nombre: "Mensajes al cliente",
    tono: "cielo",
    fondo: "<path d=\"M20.6 12.6a7.6 7.6 0 0 1-8.2 7.6L4.4 21.4l1.2-8a7.6 7.6 0 1 1 15 -.8z\"/>",
    linea: "<path d=\"M20.6 12.6a7.6 7.6 0 0 1-8.2 7.6L4.4 21.4l1.2-8a7.6 7.6 0 1 1 15 -.8z\"/><path d=\"M8.8 11.4h6.4M8.8 14.8h4\"/>",
    idea: "La burbuja de conversación",
  },
  "hub": {
    nombre: "Hub del local",
    tono: "acero",
    fondo: "<rect x=\"2.8\" y=\"12.4\" width=\"18.4\" height=\"8.2\" rx=\"2\"/>",
    linea: "<rect x=\"2.8\" y=\"12.4\" width=\"18.4\" height=\"8.2\" rx=\"2\"/><circle cx=\"6.6\" cy=\"16.5\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M10.6 16.5h7.2\"/><path d=\"M8.4 8.6a5.1 5.1 0 0 1 7.2 0M5.6 5.8a9 9 0 0 1 12.8 0\"/>",
    idea: "La caja que guarda todo, con su señal",
  },
  "licencia": {
    nombre: "Licencia del local",
    tono: "jade",
    fondo: "<path d=\"M12 2.6l8 3.2v6.1c0 4.9-3.3 8.8-8 9.5-4.7-.7-8-4.6-8-9.5V5.8z\"/>",
    linea: "<path d=\"M12 2.6l8 3.2v6.1c0 4.9-3.3 8.8-8 9.5-4.7-.7-8-4.6-8-9.5V5.8z\"/><path d=\"M8.8 11.9l2.2 2.3 4.2-4.4\"/>",
    idea: "El escudo con la vigencia",
  },
  "bitacora": {
    nombre: "Bitácora",
    tono: "pizarra",
    fondo: "<circle cx=\"4.4\" cy=\"5.4\" r=\"1.7\"/><circle cx=\"4.4\" cy=\"12\" r=\"1.7\"/><circle cx=\"4.4\" cy=\"18.6\" r=\"1.7\"/>",
    linea: "<path d=\"M9.2 5.4h11.4M9.2 12h11.4M9.2 18.6h7.4\"/><circle cx=\"4.4\" cy=\"5.4\" r=\"1.7\"/><circle cx=\"4.4\" cy=\"12\" r=\"1.7\"/><circle cx=\"4.4\" cy=\"18.6\" r=\"1.7\"/>",
    idea: "La lista de lo ocurrido, con su hora",
  },

  // C · Estado de la mesa
  //    apps/pos-ui/src/lib/pos.svelte.ts:58 y PanelSalon.svelte:191-236
  "mesa-libre": {
    nombre: "Libre",
    tono: "pizarra",
    fondo: "",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/>",
    idea: "Mesa vacía: solo el contorno, nada dentro",
  },
  "mesa-ocupada": {
    nombre: "Ocupada · en servicio",
    tono: "fuego",
    fondo: "<circle cx=\"9\" cy=\"10.2\" r=\"1.9\"/><circle cx=\"15.4\" cy=\"10.2\" r=\"1.9\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><circle cx=\"9\" cy=\"10.2\" r=\"1.9\"/><path d=\"M6 15.8a3.2 3.2 0 0 1 6 0\"/><circle cx=\"15.4\" cy=\"10.2\" r=\"1.9\"/><path d=\"M12.4 15.8a3.2 3.2 0 0 1 6 0\"/>",
    idea: "Dos comensales sentados a la mesa: se ve que hay gente, no una carita",
  },
  "mesa-cocina": {
    nombre: "Enviada a cocina",
    tono: "brasa",
    fondo: "<path d=\"M8.6 12.4h6.8v3a1.2 1.2 0 0 1-1.2 1.2H9.8a1.2 1.2 0 0 1-1.2-1.2z\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><path d=\"M8.6 12.4a2.4 2.4 0 1 1 .8-4.7 2.8 2.8 0 0 1 5.2 0 2.4 2.4 0 1 1 .8 4.7\"/><path d=\"M8.6 12.4h6.8v3a1.2 1.2 0 0 1-1.2 1.2H9.8a1.2 1.2 0 0 1-1.2-1.2z\"/>",
    idea: "La mesa con el gorro: su comanda ya está adentro",
  },
  "mesa-cobrar": {
    nombre: "Por cobrar",
    tono: "verde",
    fondo: "<rect x=\"7.2\" y=\"9.2\" width=\"9.6\" height=\"5.9\" rx=\"1.2\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><rect x=\"7.2\" y=\"9.2\" width=\"9.6\" height=\"5.9\" rx=\"1.2\"/><circle cx=\"12\" cy=\"12.15\" r=\"1.5\"/>",
    idea: "Mesa con el billete: terminó de comer, falta pagar",
  },

  // D · Semáforo del KDS
  //    packages/dominio/src/cocina/estaciones.ts:20,43-54 y cocina/Tablero.svelte:104-126
  "en-tiempo": {
    nombre: "En tiempo",
    tono: "acero",
    fondo: "<circle cx=\"12\" cy=\"13.2\" r=\"7.8\"/>",
    linea: "<circle cx=\"12\" cy=\"13.2\" r=\"7.8\"/><path d=\"M12 9v4.2l2.8 1.7\"/><path d=\"M9.6 2.4h4.8\"/><path d=\"M12 2.4v3\"/>",
    idea: "El cronómetro corriendo tranquilo: nada que atender",
  },
  "tardando": {
    nombre: "Se está tardando",
    tono: "ambar",
    fondo: "<path d=\"M8 20.8v-3.4c0-1.6 1.6-2.9 4-5.4 2.4 2.5 4 3.8 4 5.4v3.4z\"/>",
    linea: "<path d=\"M7 3.2h10M7 20.8h10\"/><path d=\"M8 3.2v3.4c0 1.6 1.6 2.9 4 5.4 2.4-2.5 4-3.8 4-5.4V3.2\"/><path d=\"M8 20.8v-3.4c0-1.6 1.6-2.9 4-5.4 2.4 2.5 4 3.8 4 5.4v3.4\"/>",
    idea: "El reloj de arena a media caída",
  },
  "demorado": {
    nombre: "Demorado",
    tono: "fuego",
    fondo: "<path d=\"M13.5 3.5l8 14a1.7 1.7 0 0 1-1.5 2.6H4a1.7 1.7 0 0 1-1.5-2.6l8-14a1.7 1.7 0 0 1 3 0z\"/>",
    linea: "<path d=\"M13.5 3.5l8 14a1.7 1.7 0 0 1-1.5 2.6H4a1.7 1.7 0 0 1-1.5-2.6l8-14a1.7 1.7 0 0 1 3 0z\"/><path d=\"M12 9.4v4.2\"/><circle cx=\"12\" cy=\"17\" r=\".95\" fill=\"#fff\" stroke=\"none\"/>",
    idea: "El triángulo de alerta, sin ambigüedad",
  },
  "listo": {
    nombre: "Listo",
    tono: "verde",
    fondo: "<path d=\"M4.6 19.4a7.4 7.4 0 0 1 14.8 0z\"/>",
    linea: "<path d=\"M3 19.4h18\"/><path d=\"M4.6 19.4a7.4 7.4 0 0 1 14.8 0\"/><path d=\"M12 12v-2.4\"/><circle cx=\"12\" cy=\"8.2\" r=\"1.4\"/>",
    idea: "El plato servido bajo la campana: sale a la mesa",
  },

  // E · Formas de pago
  //    packages/dominio/src/comanda/eventos.ts:42-66
  "efectivo": {
    nombre: "Efectivo",
    tono: "verde",
    fondo: "<rect x=\"2.4\" y=\"6.4\" width=\"19.2\" height=\"11.2\" rx=\"2\"/>",
    linea: "<rect x=\"2.4\" y=\"6.4\" width=\"19.2\" height=\"11.2\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2.7\"/><path d=\"M6 9.8v4.4M18 9.8v4.4\"/>",
    idea: "Billetes en fajo",
  },
  "debito": {
    nombre: "Débito",
    tono: "cielo",
    fondo: "<rect x=\"2.4\" y=\"5.4\" width=\"19.2\" height=\"13.2\" rx=\"2.2\"/>",
    linea: "<rect x=\"2.4\" y=\"5.4\" width=\"19.2\" height=\"13.2\" rx=\"2.2\"/><path d=\"M2.4 9.8h19.2\"/><path d=\"M6 14.6h3.4\"/>",
    idea: "Tarjeta con su banda magnética",
  },
  "credito": {
    nombre: "Crédito",
    tono: "indigo",
    fondo: "<rect x=\"2.4\" y=\"5.4\" width=\"19.2\" height=\"13.2\" rx=\"2.2\"/>",
    linea: "<rect x=\"2.4\" y=\"5.4\" width=\"19.2\" height=\"13.2\" rx=\"2.2\"/><path d=\"M2.4 9.8h19.2\"/><rect x=\"5.6\" y=\"12.6\" width=\"4.2\" height=\"3.4\" rx=\"0.8\"/><path d=\"M14 14.6h4\"/>",
    idea: "La misma tarjeta, pero con chip: así se distinguen",
  },
  "transferencia": {
    nombre: "Transferencia",
    tono: "turquesa",
    fondo: "",
    linea: "<path d=\"M3.4 8.4h14.2M14.2 5l3.4 3.4-3.4 3.4\"/><path d=\"M20.6 15.6H6.4M9.8 12.2l-3.4 3.4 3.4 3.4\"/>",
    idea: "El dinero que va de una cuenta a otra",
  },
  "vale": {
    nombre: "Vale",
    tono: "mostaza",
    fondo: "<path d=\"M2.6 8.4a2 2 0 0 1 2-2h14.8a2 2 0 0 1 2 2v1.9a1.7 1.7 0 0 0 0 3.4v1.9a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2v-1.9a1.7 1.7 0 0 0 0-3.4z\"/>",
    linea: "<path d=\"M2.6 8.4a2 2 0 0 1 2-2h14.8a2 2 0 0 1 2 2v1.9a1.7 1.7 0 0 0 0 3.4v1.9a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2v-1.9a1.7 1.7 0 0 0 0-3.4z\"/><path d=\"M9.4 9.4v5.2\"/>",
    idea: "El cupón con su muesca",
  },
  "app-pago": {
    nombre: "Cobrado por la app",
    tono: "ciruela",
    fondo: "<rect x=\"6.4\" y=\"2.4\" width=\"11.2\" height=\"19.2\" rx=\"2.4\"/>",
    linea: "<rect x=\"6.4\" y=\"2.4\" width=\"11.2\" height=\"19.2\" rx=\"2.4\"/><path d=\"M10.4 5.4h3.2\"/><path d=\"M9.4 13.2l1.9 1.9 3.9-4\"/>",
    idea: "El teléfono que ya cobró",
  },
  "socio-consumo": {
    nombre: "Consumo de socio",
    tono: "dorado",
    fondo: "<path d=\"M18 13.4l1.1 2.25 2.5.36-1.8 1.75.42 2.48-2.22-1.17-2.22 1.17.42-2.48-1.8-1.75 2.5-.36z\"/>",
    linea: "<circle cx=\"10\" cy=\"8\" r=\"3.3\"/><path d=\"M3.6 20.4a6.5 6.5 0 0 1 9.6-5.7\"/><path d=\"M18 13.4l1.1 2.25 2.5.36-1.8 1.75.42 2.48-2.22-1.17-2.22 1.17.42-2.48-1.8-1.75 2.5-.36z\"/>",
    idea: "Persona con estrella: el beneficio del socio",
  },

  // F · Movimientos de inventario
  //    packages/dominio/src/inventario/eventos.ts:40-75
  "consumo-receta": {
    nombre: "Consumo por receta",
    tono: "brasa",
    fondo: "<path d=\"M4 4.6h9.6a1.9 1.9 0 0 1 1.9 1.9v13a1.9 1.9 0 0 1-1.9 1.9H4a1.9 1.9 0 0 1-1.9-1.9v-13A1.9 1.9 0 0 1 4 4.6z\"/>",
    linea: "<path d=\"M4 4.6h9.6a1.9 1.9 0 0 1 1.9 1.9v13a1.9 1.9 0 0 1-1.9 1.9H4a1.9 1.9 0 0 1-1.9-1.9v-13A1.9 1.9 0 0 1 4 4.6z\"/><path d=\"M5.4 9h6.8M5.4 12.6h6.8M5.4 16.2h4.2\"/><path d=\"M19.4 8.4v7.2M16.6 12.8l2.8 2.8 2.8-2.8\"/>",
    idea: "La receta descuenta del almacén sola al enviar a cocina",
  },
  "devolucion": {
    nombre: "Devolución por cancelación",
    tono: "verde",
    fondo: "<path d=\"M20.4 3.6v5.6h-5.6z\"/>",
    linea: "<path d=\"M20.4 12a8.4 8.4 0 1 1-2.46-5.94\"/><path d=\"M20.4 3.6v5.6h-5.6\"/>",
    idea: "Lo que se canceló regresa solo al almacén",
  },
  "utilizacion": {
    nombre: "Utilización del insumo",
    tono: "fuego",
    fondo: "<path d=\"M3.4 12.6v6a2 2 0 0 0 2 2h13.2a2 2 0 0 0 2-2v-6z\"/>",
    linea: "<path d=\"M3.4 12.6v6a2 2 0 0 0 2 2h13.2a2 2 0 0 0 2-2v-6\"/><path d=\"M2.6 12.6h18.8\"/><path d=\"M12 9.4V2.4M9 5.4l3-3 3 3\"/>",
    idea: "Se toma del almacén a mano, sin receta de por medio",
  },
  "recepcion": {
    nombre: "Recepción de compra",
    tono: "verde",
    fondo: "<path d=\"M3.4 14.2v4.4a2.2 2.2 0 0 0 2.2 2.2h12.8a2.2 2.2 0 0 0 2.2-2.2v-4.4z\"/>",
    linea: "<path d=\"M12 3v8.6M8.4 8.2l3.6 3.4 3.6-3.4\"/><path d=\"M3.4 14.2v4.4a2.2 2.2 0 0 0 2.2 2.2h12.8a2.2 2.2 0 0 0 2.2-2.2v-4.4\"/><path d=\"M3.4 14.2h17.2\"/>",
    idea: "La caja que llega y entra al almacén",
  },
  "merma": {
    nombre: "Merma",
    tono: "fuego",
    fondo: "<path d=\"M4.4 6.8h15.2l-1.1 12.4a2.1 2.1 0 0 1-2.1 1.9H7.6a2.1 2.1 0 0 1-2.1-1.9z\"/>",
    linea: "<path d=\"M4.4 6.8h15.2l-1.1 12.4a2.1 2.1 0 0 1-2.1 1.9H7.6a2.1 2.1 0 0 1-2.1-1.9z\"/><path d=\"M2.6 6.8h18.8M9.2 6.8V4.4a1.6 1.6 0 0 1 1.6-1.6h2.4a1.6 1.6 0 0 1 1.6 1.6v2.4\"/><path d=\"M10 11.4v5M14 11.4v5\"/>",
    idea: "El producto que se tira: la masa y el queso que se pierden",
  },
  "ajuste": {
    nombre: "Ajuste por conteo",
    tono: "acero",
    fondo: "<path d=\"M1.8 14.4a2.8 2.8 0 0 0 5.6 0l-2.8-6z\"/><path d=\"M16.6 14.4a2.8 2.8 0 0 0 5.6 0l-2.8-6z\"/>",
    linea: "<path d=\"M12 3.4v17.2M6.4 20.6h11.2\"/><path d=\"M12 6.4l-7.4 2M12 6.4l7.4 2\"/><path d=\"M1.8 14.4a2.8 2.8 0 0 0 5.6 0l-2.8-6z\"/><path d=\"M16.6 14.4a2.8 2.8 0 0 0 5.6 0l-2.8-6z\"/>",
    idea: "La balanza que corrige lo contado contra lo registrado",
  },
  "traspaso": {
    nombre: "Traspaso entre almacenes",
    tono: "acero",
    fondo: "<rect x=\"1.8\" y=\"6.4\" width=\"7.4\" height=\"7.4\" rx=\"1.4\"/><rect x=\"14.8\" y=\"10.2\" width=\"7.4\" height=\"7.4\" rx=\"1.4\"/>",
    linea: "<rect x=\"1.8\" y=\"6.4\" width=\"7.4\" height=\"7.4\" rx=\"1.4\"/><rect x=\"14.8\" y=\"10.2\" width=\"7.4\" height=\"7.4\" rx=\"1.4\"/><path d=\"M9.8 10.1h4.4M12.4 7.7l2.4 2.4-2.4 2.4\"/>",
    idea: "De una bodega a otra: ni entra ni sale del total",
  },
  "produccion": {
    nombre: "Producción interna",
    tono: "verde",
    fondo: "<path d=\"M3.6 9.8h16.8v6.2a4.6 4.6 0 0 1-4.6 4.6H8.2a4.6 4.6 0 0 1-4.6-4.6z\"/>",
    linea: "<path d=\"M3.6 9.8h16.8v6.2a4.6 4.6 0 0 1-4.6 4.6H8.2a4.6 4.6 0 0 1-4.6-4.6z\"/><path d=\"M2 9.8h20\"/><path d=\"M8.6 6.4c0-1.2 1-1.4 1-2.6M12 6.4c0-1.2 1-1.4 1-2.6M15.4 6.4c0-1.2 1-1.4 1-2.6\"/>",
    idea: "La olla del que se hace en casa: masa, salsa, base",
  },
  "devolucion-proveedor": {
    nombre: "Devolución a proveedor",
    tono: "fuego",
    fondo: "<path d=\"M2.4 11.4a1.2 1.2 0 0 1 1.2-1.2h8.6v8.4H3.6a1.2 1.2 0 0 1-1.2-1.2z\"/>",
    linea: "<path d=\"M2.4 11.4a1.2 1.2 0 0 1 1.2-1.2h8.6v8.4H3.6a1.2 1.2 0 0 1-1.2-1.2z\"/><path d=\"M12.2 12.8h3.2a1.6 1.6 0 0 1 1.3.66l2.1 2.9a1.6 1.6 0 0 1 .3.94v1.3h-6.9z\"/><circle cx=\"6.6\" cy=\"19.2\" r=\"1.7\"/><circle cx=\"16\" cy=\"19.2\" r=\"1.7\"/><path d=\"M20.6 5.6H14.4M17.2 2.8L14.4 5.6l2.8 2.8\"/>",
    idea: "La camioneta se lleva de vuelta lo que trajo",
  },

  // G · Canales de venta
  //    packages/dominio/src/ventas/canales.ts:36-63
  "canal-salon": {
    nombre: "Salón",
    tono: "brasa",
    fondo: "<circle cx=\"6.8\" cy=\"8\" r=\"4\"/><circle cx=\"17.2\" cy=\"8\" r=\"4\"/><circle cx=\"12\" cy=\"17\" r=\"4\"/>",
    linea: "<circle cx=\"6.8\" cy=\"8\" r=\"4\"/><circle cx=\"17.2\" cy=\"8\" r=\"4\"/><circle cx=\"12\" cy=\"17\" r=\"4\"/><circle cx=\"6.8\" cy=\"8\" r=\"1.4\"/><circle cx=\"17.2\" cy=\"8\" r=\"1.4\"/><circle cx=\"12\" cy=\"17\" r=\"1.4\"/>",
    idea: "Varias mesas puestas: el consumo que se queda en el local",
  },
  "para-llevar": {
    nombre: "Para llevar",
    tono: "verde",
    fondo: "<path d=\"M4.4 7.6h15.2l-1 12a2.1 2.1 0 0 1-2.1 1.9H7.5a2.1 2.1 0 0 1-2.1-1.9z\"/>",
    linea: "<path d=\"M4.4 7.6h15.2l-1 12a2.1 2.1 0 0 1-2.1 1.9H7.5a2.1 2.1 0 0 1-2.1-1.9z\"/><path d=\"M8.6 7.6V5.4a3.4 3.4 0 0 1 6.8 0v2.2\"/>",
    idea: "La bolsa de papel con sus asas",
  },
  "reparto-propio": {
    nombre: "Reparto propio",
    tono: "acero",
    fondo: "",
    linea: "<circle cx=\"5\" cy=\"17.4\" r=\"3.2\"/><circle cx=\"19\" cy=\"17.4\" r=\"3.2\"/><path d=\"M8.2 17.4h7.6l-4.2-7.6H8.6\"/><path d=\"M13.4 9.8l1.8-3.6h3.2\"/><path d=\"M15.8 17.4l3.2-7.6\"/>",
    idea: "La moto del repartidor del local",
  },
  "app-reparto": {
    nombre: "App de reparto (neutral)",
    tono: "pizarra",
    fondo: "<path d=\"M14.6 12.6h6.8l-.6 7.4a1.6 1.6 0 0 1-1.6 1.4h-2.4a1.6 1.6 0 0 1-1.6-1.4z\"/>",
    linea: "<rect x=\"2.6\" y=\"2.6\" width=\"11.4\" height=\"18.8\" rx=\"2.4\"/><path d=\"M6.4 5.4h3.8\"/><path d=\"M14.6 12.6h6.8l-.6 7.4a1.6 1.6 0 0 1-1.6 1.4h-2.4a1.6 1.6 0 0 1-1.6-1.4z\"/><path d=\"M16.6 12.6v-1.2a1.4 1.4 0 0 1 2.8 0v1.2\"/>",
    idea: "Sirve para las tres apps, teñido con el color de cada una",
  },

  // H · Acciones del punto de venta
  //    apps/pos-ui/src/lib/PanelCuenta.svelte:663-714, 850-861
  "enviar-cocina": {
    nombre: "Enviar a cocina",
    tono: "ambar",
    fondo: "<path d=\"M8.6 13.4h9.4v4.8a1.7 1.7 0 0 1-1.7 1.7h-6a1.7 1.7 0 0 1-1.7-1.7z\"/>",
    linea: "<path d=\"M8.6 13.4a3.4 3.4 0 0 1 1-6.6 3.8 3.8 0 0 1 7.4 0 3.4 3.4 0 0 1 1 6.6\"/><path d=\"M8.6 13.4h9.4v4.8a1.7 1.7 0 0 1-1.7 1.7h-6a1.7 1.7 0 0 1-1.7-1.7z\"/><path d=\"M1.8 16.6h4.6M4.2 14.4l2.2 2.2-2.2 2.2\"/>",
    idea: "La comanda que entra al gorro: la flecha va hacia la cocina",
  },
  "imprimir": {
    nombre: "Imprimir cuenta",
    tono: "acero",
    fondo: "<path d=\"M6.6 14.2h10.8v6.4H6.6z\"/>",
    linea: "<path d=\"M6.6 8.4V3.4h10.8v5\"/><path d=\"M6.6 17.4H4.8a2 2 0 0 1-2-2v-4.6a2 2 0 0 1 2-2h14.4a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2h-1.8\"/><path d=\"M6.6 14.2h10.8v6.4H6.6z\"/>",
    idea: "La impresora sacando la hoja",
  },
  "cobrar": {
    nombre: "Cobrar",
    tono: "verde",
    fondo: "<rect x=\"2.4\" y=\"10.4\" width=\"19.2\" height=\"10.2\" rx=\"2\"/>",
    linea: "<rect x=\"2.4\" y=\"10.4\" width=\"19.2\" height=\"10.2\" rx=\"2\"/><path d=\"M2.4 14.4h19.2\"/><circle cx=\"12\" cy=\"17.5\" r=\"1.4\"/><path d=\"M12 2.6v5.8M9 5.4l3 3 3-3\"/>",
    idea: "El dinero cayendo dentro del cajón de la caja",
  },
  "liberar-mesa": {
    nombre: "Liberar mesa",
    tono: "jade",
    fondo: "",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><path d=\"M8.4 12l2.6 2.6 4.6-5.2\"/>",
    idea: "La mesa que se limpia y queda libre",
  },
  "dividir": {
    nombre: "Dividir la cuenta",
    tono: "acero",
    fondo: "",
    linea: "<path d=\"M12 2.6v18.8\"/><path d=\"M2.6 7.4h6.2M2.6 11h6.2M2.6 14.6h4\"/><path d=\"M15.2 7.4h6.2M15.2 11h6.2M15.2 14.6h4\"/>",
    idea: "Una cuenta que se parte en dos",
  },
  "traspasar": {
    nombre: "Traspasar",
    tono: "acero",
    fondo: "<circle cx=\"18.6\" cy=\"12\" r=\"3.4\"/>",
    linea: "<circle cx=\"5.4\" cy=\"12\" r=\"3.4\"/><circle cx=\"18.6\" cy=\"12\" r=\"3.4\"/><path d=\"M9.4 12h5.2M12.6 9.6l2.4 2.4-2.4 2.4\"/>",
    idea: "De esta mesa a aquella",
  },
  "cortesia": {
    nombre: "Cortesía",
    tono: "rosa",
    fondo: "<rect x=\"2.8\" y=\"9.6\" width=\"18.4\" height=\"11.4\" rx=\"1.8\"/>",
    linea: "<rect x=\"2.8\" y=\"9.6\" width=\"18.4\" height=\"11.4\" rx=\"1.8\"/><path d=\"M2.8 14.2h18.4M12 9.6v11.4\"/><circle cx=\"8.9\" cy=\"6.6\" r=\"2.6\"/><circle cx=\"15.1\" cy=\"6.6\" r=\"2.6\"/>",
    idea: "Va por la casa: el regalo con su moño",
  },
  "descuento": {
    nombre: "Descuento",
    tono: "brasa",
    fondo: "<circle cx=\"7.4\" cy=\"7.4\" r=\"2.8\"/><circle cx=\"16.6\" cy=\"16.6\" r=\"2.8\"/>",
    linea: "<path d=\"M19.4 4.6L4.6 19.4\"/><circle cx=\"7.4\" cy=\"7.4\" r=\"2.8\"/><circle cx=\"16.6\" cy=\"16.6\" r=\"2.8\"/>",
    idea: "El porcentaje que se resta",
  },
  "propina": {
    nombre: "Propina",
    tono: "verde",
    tono2: "dorado",
    fondo: "<rect x=\"5.2\" y=\"3.6\" width=\"13.6\" height=\"6.8\" rx=\"1.2\"/>",
    fondo2: "<circle cx=\"8.4\" cy=\"13.2\" r=\"2.2\"/><circle cx=\"12\" cy=\"13.2\" r=\"2.2\"/><circle cx=\"15.6\" cy=\"13.2\" r=\"2.2\"/>",
    linea: "<rect x=\"5.2\" y=\"3.6\" width=\"13.6\" height=\"6.8\" rx=\"1.2\"/><circle cx=\"12\" cy=\"7\" r=\"1.5\"/><circle cx=\"8.4\" cy=\"13.2\" r=\"2.2\"/><circle cx=\"12\" cy=\"13.2\" r=\"2.2\"/><circle cx=\"15.6\" cy=\"13.2\" r=\"2.2\"/><path d=\"M2.6 16.6h18.8a5.4 5.4 0 0 1-5.4 4.2H8a5.4 5.4 0 0 1-5.4-4.2z\"/>",
    idea: "El billete verde sobre el platito, con las tres monedas doradas. Es el único icono del set con dos materiales",
  },
  "factura": {
    nombre: "Emitir factura",
    tono: "cielo",
    fondo: "<path d=\"M5.4 2.9h9.2l4.6 4.6v11.4a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2V5.1a2.2 2.2 0 0 1 2.2-2.2z\"/>",
    linea: "<path d=\"M5.4 2.9h9.2l4.6 4.6v11.4a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2V5.1a2.2 2.2 0 0 1 2.2-2.2z\"/><path d=\"M14.2 2.9v4.8h5\"/><path d=\"M8.4 15.6l2.2 2.2 4.6-5\"/>",
    idea: "El documento que se timbra",
  },
  "reabrir": {
    nombre: "Reabrir cuenta",
    tono: "ambar",
    fondo: "<rect x=\"4.4\" y=\"10.6\" width=\"15.2\" height=\"10.4\" rx=\"2.2\"/>",
    linea: "<rect x=\"4.4\" y=\"10.6\" width=\"15.2\" height=\"10.4\" rx=\"2.2\"/><path d=\"M8.2 10.6V7.4a3.8 3.8 0 0 1 7.3-1.4\"/><circle cx=\"12\" cy=\"15.8\" r=\"1.4\"/>",
    idea: "El candado que se vuelve a abrir",
  },
  "cancelar-renglon": {
    nombre: "Cancelar renglón",
    tono: "fuego",
    fondo: "",
    linea: "<path d=\"M3.4 6.6h11.2M3.4 12h8.4M3.4 17.4h6.4\"/><path d=\"M15.8 14l5.6 5.6M21.4 14l-5.6 5.6\"/>",
    idea: "El renglón que se tacha. Sale del grupo de los otros tres botones",
  },
  "reimprimir": {
    nombre: "Reimprimir",
    tono: "acero",
    fondo: "<path d=\"M6.6 14.2h10.8v6.4H6.6z\"/>",
    linea: "<path d=\"M6.6 17.4H4.8a2 2 0 0 1-2-2v-4.6a2 2 0 0 1 2-2h14.4a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2h-1.8\"/><path d=\"M6.6 14.2h10.8v6.4H6.6z\"/><path d=\"M7.6 6.8a4.8 4.8 0 0 1 8.4-1.9\"/><path d=\"M16.6 2v3.4h-3.4\"/>",
    idea: "La impresora con la flecha de «otra vez»",
  },
  "juntar-mesas": {
    nombre: "Juntar mesas",
    tono: "brasa",
    fondo: "",
    linea: "<circle cx=\"7\" cy=\"13.6\" r=\"4.4\"/><circle cx=\"17\" cy=\"13.6\" r=\"4.4\"/><path d=\"M7 6.8V4.6h10v2.2\"/><path d=\"M12 4.6V2.4\"/>",
    idea: "Dos mesas bajo una misma llave: pasan a ser una sola cuenta",
  },

  // I · Acciones de siempre
  //    Literales sueltos en 20+ archivos de apps/pos-ui/src/lib/modulos/
  "guardar": {
    nombre: "Guardar",
    tono: "verde",
    fondo: "",
    linea: "<path d=\"M4.4 12.8l5 5 10.2-11.6\"/>",
    idea: "La marca de que quedó registrado",
  },
  "cancelar": {
    nombre: "Cancelar",
    tono: "pizarra",
    fondo: "",
    linea: "<path d=\"M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4\"/>",
    idea: "La equis limpia, sin peso de peligro",
  },
  "eliminar": {
    nombre: "Eliminar",
    tono: "fuego",
    fondo: "<path d=\"M4.4 6.8h15.2l-1.1 12.4a2.1 2.1 0 0 1-2.1 1.9H7.6a2.1 2.1 0 0 1-2.1-1.9z\"/>",
    linea: "<path d=\"M4.4 6.8h15.2l-1.1 12.4a2.1 2.1 0 0 1-2.1 1.9H7.6a2.1 2.1 0 0 1-2.1-1.9z\"/><path d=\"M2.6 6.8h18.8M9.2 6.8V4.4a1.6 1.6 0 0 1 1.6-1.6h2.4a1.6 1.6 0 0 1 1.6 1.6v2.4\"/>",
    idea: "El bote: distinto de cancelar, porque no es lo mismo",
  },
  "nuevo": {
    nombre: "Nuevo",
    tono: "verde",
    fondo: "",
    linea: "<path d=\"M12 4.4v15.2M4.4 12h15.2\"/>",
    idea: "La cruz de agregar",
  },
  "editar": {
    nombre: "Editar",
    tono: "acero",
    fondo: "<path d=\"M16.4 3.6a2.4 2.4 0 0 1 3.4 3.4L8.4 18.4l-4.4 1.2 1.2-4.4z\"/>",
    linea: "<path d=\"M16.4 3.6a2.4 2.4 0 0 1 3.4 3.4L8.4 18.4l-4.4 1.2 1.2-4.4z\"/><path d=\"M14.6 5.4l3.4 3.4\"/>",
    idea: "El lápiz sobre la línea",
  },
  "buscar": {
    nombre: "Buscar",
    tono: "acero",
    fondo: "",
    linea: "<circle cx=\"10.6\" cy=\"10.6\" r=\"6.8\"/><path d=\"M15.6 15.6l4.8 4.8\"/>",
    idea: "La lupa",
  },
  "exportar": {
    nombre: "Exportar",
    tono: "cielo",
    fondo: "",
    linea: "<path d=\"M12 3.4v11.2M8.4 11l3.6 3.6L15.6 11\"/><path d=\"M3.6 15.4v3.2a2.2 2.2 0 0 0 2.2 2.2h12.4a2.2 2.2 0 0 0 2.2-2.2v-3.2\"/>",
    idea: "Lo que sale del sistema al archivo",
  },
  "importar": {
    nombre: "Importar",
    tono: "cielo",
    fondo: "",
    linea: "<path d=\"M12 14.6V3.4M8.4 7l3.6-3.6L15.6 7\"/><path d=\"M3.6 15.4v3.2a2.2 2.2 0 0 0 2.2 2.2h12.4a2.2 2.2 0 0 0 2.2-2.2v-3.2\"/>",
    idea: "Lo que entra al sistema desde afuera",
  },

  // J · Señales del sistema
  //    apps/pos-ui/src/lib/Header.svelte:51-55 y los ocho avisos de App.svelte:271-412
  "sincronizado": {
    nombre: "Sincronizado",
    tono: "verde",
    fondo: "<path d=\"M18.1 2.4v3.5h-3.5z\"/><path d=\"M5.9 21.6v-3.5h3.5z\"/>",
    linea: "<path d=\"M3.4 12a8.6 8.6 0 0 1 14.7-6.1M20.6 12a8.6 8.6 0 0 1-14.7 6.1\"/><path d=\"M18.1 2.4v3.5h-3.5M5.9 21.6v-3.5h3.5\"/>",
    idea: "Al día con el Hub",
  },
  "conectando": {
    nombre: "Conectando",
    tono: "ambar",
    fondo: "",
    linea: "<path d=\"M12 3.4v3.2M12 17.4v3.2M3.4 12h3.2M17.4 12h3.2\"/><path d=\"M5.95 5.95l2.25 2.25M15.8 15.8l2.25 2.25M18.05 5.95L15.8 8.2M8.2 15.8l-2.25 2.25\"/>",
    idea: "Buscando el Hub",
  },
  "modo-isla": {
    nombre: "Modo isla",
    tono: "ambar",
    fondo: "<path d=\"M12 6.6c-2.2 0-4 1.2-4.8 2.6h9.6C16 7.8 14.2 6.6 12 6.6z\"/>",
    linea: "<path d=\"M2.6 18.6c1.6 0 1.6 1.2 3.2 1.2s1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2\"/><path d=\"M12 15.4V6.6\"/><path d=\"M12 6.6c-2.2 0-4 1.2-4.8 2.6h9.6C16 7.8 14.2 6.6 12 6.6z\"/><path d=\"M12 6.6V3.4\"/>",
    idea: "La terminal trabajando sola, sin dejar de vender",
  },
  "sin-hub": {
    nombre: "Sin Hub",
    tono: "fuego",
    fondo: "",
    linea: "<path d=\"M9.4 14.6l5.2-5.2\"/><path d=\"M7.6 11.2L5.4 13.4a3.7 3.7 0 0 0 5.2 5.2l2.2-2.2\"/><path d=\"M16.4 12.8l2.2-2.2a3.7 3.7 0 0 0-5.2-5.2l-2.2 2.2\"/><path d=\"M3 3l18 18\"/>",
    idea: "El enlace cortado",
  },
  "impresora-lista": {
    nombre: "Impresora lista",
    tono: "verde",
    fondo: "<path d=\"M6.6 14.2h10.8v6.4H6.6z\"/>",
    linea: "<path d=\"M6.6 8.4V3.4h10.8v5\"/><path d=\"M6.6 17.4H4.8a2 2 0 0 1-2-2v-4.6a2 2 0 0 1 2-2h14.4a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2h-1.8\"/><path d=\"M6.6 14.2h10.8v6.4H6.6z\"/><path d=\"M9 17.6l1.8 1.8 3.4-3.6\"/>",
    idea: "La térmica respondiendo",
  },
  "actualizacion": {
    nombre: "Actualización pendiente",
    tono: "brasa",
    fondo: "",
    linea: "<path d=\"M12 20.6V9.4M8.4 12.8L12 9.2l3.6 3.6\"/><circle cx=\"12\" cy=\"12\" r=\"9.4\" stroke-dasharray=\"2.4 3.4\"/>",
    idea: "La versión nueva esperando",
  },
  "reloj-mal": {
    nombre: "Reloj desfasado",
    tono: "fuego",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"8.6\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.6\"/><path d=\"M12 7v5l3 1.9\"/><path d=\"M18.4 5.6L5.6 18.4\"/>",
    idea: "La hora del equipo no cuadra",
  },

  // K · Estaciones de cocina
  //    packages/dominio/src/cocina/estaciones.ts:57-66
  "horno": {
    nombre: "Horno",
    tono: "brasa",
    fondo: "<path d=\"M7.4 13a4.6 4.6 0 0 1 9.2 0z\"/>",
    linea: "<rect x=\"2.6\" y=\"4.4\" width=\"18.8\" height=\"15.2\" rx=\"2.4\"/><path d=\"M2.6 9.4h18.8\"/><path d=\"M6.4 6.9h1.6\"/><path d=\"M7.4 13a4.6 4.6 0 0 1 9.2 0z\"/>",
    idea: "La boca del horno de pizza con la llama dentro",
  },
  "pastas": {
    nombre: "Pastas",
    tono: "ambar",
    fondo: "<path d=\"M3.6 10.4h16.8v5.4a4.8 4.8 0 0 1-4.8 4.8H8.4a4.8 4.8 0 0 1-4.8-4.8z\"/>",
    linea: "<path d=\"M3.6 10.4h16.8v5.4a4.8 4.8 0 0 1-4.8 4.8H8.4a4.8 4.8 0 0 1-4.8-4.8z\"/><path d=\"M2 10.4h20\"/><path d=\"M8.8 7.4c0-1.4 1-1.6 1-3M12 7.4c0-1.4 1-1.6 1-3M15.2 7.4c0-1.4 1-1.6 1-3\"/>",
    idea: "La olla hirviendo",
  },
  "parrilla": {
    nombre: "Parrilla",
    tono: "fuego",
    fondo: "<path d=\"M3.6 12.6h16.8a4 4 0 0 1-4 4H7.6a4 4 0 0 1-4-4z\"/>",
    linea: "<path d=\"M2.6 9.4h18.8\"/><path d=\"M6 9.4v3.2M12 9.4v3.2M18 9.4v3.2\"/><path d=\"M3.6 12.6h16.8a4 4 0 0 1-4 4H7.6a4 4 0 0 1-4-4z\"/><path d=\"M8 20.4l1.6-3.8M16 20.4l-1.6-3.8\"/><path d=\"M9.4 6.4c0-1.2.9-1.4.9-2.6M14.6 6.4c0-1.2.9-1.4.9-2.6\"/>",
    idea: "La rejilla sobre la brasa",
  },
  "fria": {
    nombre: "Fría",
    tono: "turquesa",
    fondo: "",
    linea: "<path d=\"M12 2.6v18.8M3.9 7.3l16.2 9.4M20.1 7.3L3.9 16.7\"/><path d=\"M12 6.4l-2 -1.6M12 6.4l2-1.6M12 17.6l-2 1.6M12 17.6l2 1.6\"/>",
    idea: "El copo: ensaladas y lo que no pasa por fuego",
  },
  "barra": {
    nombre: "Barra",
    tono: "ciruela",
    fondo: "<path d=\"M4.4 4.4h15.2L12 12.6z\"/>",
    linea: "<path d=\"M4.4 4.4h15.2L12 12.6z\"/><path d=\"M12 12.6v7.4M8 20h8\"/>",
    idea: "La copa de la barra",
  },
  "postres": {
    nombre: "Postres",
    tono: "rosa",
    fondo: "<path d=\"M6.4 12h11.2l-1.2 7.4a1.8 1.8 0 0 1-1.8 1.5H9.4a1.8 1.8 0 0 1-1.8-1.5z\"/>",
    linea: "<path d=\"M6.4 12h11.2l-1.2 7.4a1.8 1.8 0 0 1-1.8 1.5H9.4a1.8 1.8 0 0 1-1.8-1.5z\"/><path d=\"M5.4 12a3.2 3.2 0 0 1 2.8-3.2 4 4 0 0 1 7.6 0A3.2 3.2 0 0 1 18.6 12z\"/><path d=\"M12 5.6V3.4\"/>",
    idea: "El pastelillo de la repostería",
  },

  // L · Categorías de la carta
  //    packages/dominio/src/catalogo/menu.ts:40 — campo nuevo en Categoria
  "cat-pizza": {
    nombre: "Pizza",
    tono: "tomate",
    fondo: "<circle cx=\"7.8\" cy=\"9\" r=\"1.15\"/><circle cx=\"8.4\" cy=\"15\" r=\"1.15\"/><circle cx=\"16.2\" cy=\"10.4\" r=\"1.15\"/><circle cx=\"15.4\" cy=\"15.6\" r=\"1.15\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"8.8\"/><path d=\"M12 3.2v17.6\"/><circle cx=\"7.8\" cy=\"9\" r=\"1.15\"/><circle cx=\"8.4\" cy=\"15\" r=\"1.15\"/><circle cx=\"16.2\" cy=\"10.4\" r=\"1.15\"/><circle cx=\"15.4\" cy=\"15.6\" r=\"1.15\"/>",
    idea: "La pizza entera vista de arriba, partida a la mitad: la mitad-y-mitad de Rodizio",
  },
  "cat-pasta": {
    nombre: "Pasta",
    tono: "ambar",
    fondo: "<path d=\"M2.6 11.4h14.8a7.4 7.4 0 0 1-14.8 0z\"/>",
    linea: "<path d=\"M2.6 11.4h14.8a7.4 7.4 0 0 1-14.8 0z\"/><path d=\"M5.8 11.4a4.2 4.2 0 0 1 8.4 0\"/><path d=\"M20.4 3v18M18.6 3v4.2a1.8 1.8 0 0 0 3.6 0V3\"/>",
    idea: "Plato hondo con el montón de espagueti y el tenedor de pie",
  },
  "cat-bebida": {
    nombre: "Bebidas",
    tono: "cielo",
    fondo: "<path d=\"M5.6 6.6h12.8l-1.4 13.2a1.8 1.8 0 0 1-1.8 1.6H8.8a1.8 1.8 0 0 1-1.8-1.6z\"/>",
    linea: "<path d=\"M5.6 6.6h12.8l-1.4 13.2a1.8 1.8 0 0 1-1.8 1.6H8.8a1.8 1.8 0 0 1-1.8-1.6z\"/><path d=\"M5.6 11h12.4\"/><path d=\"M14.4 6.6l2.4-4.2\"/>",
    idea: "El vaso con su popote",
  },
  "cat-postre": {
    nombre: "Postres",
    tono: "rosa",
    fondo: "<path d=\"M6.6 12a5.4 5.4 0 0 1 10.8 0z\"/>",
    linea: "<path d=\"M12 21.6L7.8 12h8.4z\"/><path d=\"M6.6 12a5.4 5.4 0 0 1 10.8 0z\"/><circle cx=\"12\" cy=\"5.4\" r=\"3.2\"/>",
    idea: "El helado en cono: no compite con el pastelillo de la estación de repostería",
  },
  "cat-entrada": {
    nombre: "Entradas",
    tono: "oliva",
    fondo: "<circle cx=\"9\" cy=\"9.6\" r=\"2.2\"/><circle cx=\"15.2\" cy=\"10.4\" r=\"2\"/><circle cx=\"11.6\" cy=\"15.4\" r=\"2.4\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"9\" cy=\"9.6\" r=\"2.2\"/><circle cx=\"15.2\" cy=\"10.4\" r=\"2\"/><circle cx=\"11.6\" cy=\"15.4\" r=\"2.4\"/>",
    idea: "El plato para compartir con tres bocados encima",
  },
  "cat-ensalada": {
    nombre: "Ensaladas",
    tono: "jade",
    fondo: "<path d=\"M2.8 12.6h18.4a9.2 9.2 0 0 1-18.4 0z\"/>",
    linea: "<path d=\"M2.8 12.6h18.4a9.2 9.2 0 0 1-18.4 0z\"/><path d=\"M12 12.6c-.6-4 1.6-6.8 5.4-7.4.4 4.2-1.8 7-5.4 7.4z\"/><path d=\"M12 12.6c-2.8-.6-4.4-2.8-4-6 3 .5 4.6 2.8 4 6z\"/><circle cx=\"8\" cy=\"10.8\" r=\"1.4\"/>",
    idea: "El tazón con las hojas asomando y el jitomate",
  },
  "cat-vino": {
    nombre: "Vinos",
    tono: "vino",
    fondo: "<path d=\"M6.6 2.8h10.8v5.4a5.4 5.4 0 0 1-10.8 0z\"/>",
    linea: "<path d=\"M6.6 2.8h10.8v5.4a5.4 5.4 0 0 1-10.8 0z\"/><path d=\"M12 13.6v6.8M8.4 20.4h7.2\"/><path d=\"M6.6 7.2h10.8\"/>",
    idea: "La copa de tallo",
  },
  "cat-cafe": {
    nombre: "Café",
    tono: "cafe",
    fondo: "<path d=\"M3.4 9.4h13.2v5.6a5 5 0 0 1-5 5H8.4a5 5 0 0 1-5-5z\"/>",
    linea: "<path d=\"M3.4 9.4h13.2v5.6a5 5 0 0 1-5 5H8.4a5 5 0 0 1-5-5z\"/><path d=\"M16.6 10.6h1.8a2.8 2.8 0 0 1 0 5.6h-1.8\"/><path d=\"M7.4 5.8c0-1.2.9-1.4.9-2.6M11.8 5.8c0-1.2.9-1.4.9-2.6\"/>",
    idea: "La taza con su vapor",
  },

  // M · Opinión del comensal
  //    packages/dominio/src/clientes/opinion.ts:31
  "op-bien": {
    nombre: "Bien",
    tono: "verde",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/><path d=\"M8.2 13.8a4.6 4.6 0 0 0 7.6 0\"/><circle cx=\"9.2\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/><circle cx=\"14.8\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/>",
    idea: "La cara satisfecha",
  },
  "op-regular": {
    nombre: "Regular",
    tono: "ambar",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/><path d=\"M8.4 14.6h7.2\"/><circle cx=\"9.2\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/><circle cx=\"14.8\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/>",
    idea: "La cara neutra",
  },
  "op-mal": {
    nombre: "Mal",
    tono: "fuego",
    fondo: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/>",
    linea: "<circle cx=\"12\" cy=\"12\" r=\"9.2\"/><path d=\"M8.2 15.6a4.6 4.6 0 0 1 7.6 0\"/><circle cx=\"9.2\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/><circle cx=\"14.8\" cy=\"9.6\" r=\"1.1\" fill=\"#14181a\" stroke=\"none\"/>",
    idea: "La cara molesta",
  },

} as const satisfies Record<string, Icono>;

/** Los 103 nombres válidos. Un nombre fuera de esta lista no compila. */
export type NombreIcono = keyof typeof CATALOGO;

export const ICONOS: Readonly<Record<NombreIcono, Icono>> = CATALOGO;

/** Los nombres, para recorrerlos en pruebas y en el catálogo de Administración. */
export const NOMBRES_ICONO = Object.keys(CATALOGO) as NombreIcono[];

export function esNombreIcono(valor: unknown): valor is NombreIcono {
  return typeof valor === "string" && valor in CATALOGO;
}
