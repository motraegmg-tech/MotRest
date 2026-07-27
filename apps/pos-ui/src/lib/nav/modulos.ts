/**
 * Registro de los 9 módulos del PRD. Es la fuente de verdad del sidebar.
 *
 * Regla: **todo módulo muestra algo verdadero desde F1**. Los que aún no tienen
 * funcionalidad no dicen "próximamente" y ya: explican qué van a resolver, qué
 * funciones del Anexo A del PRD cubren y en qué etapa del plan llegan.
 */
import type { Accion, ModuloId } from "@motrest/dominio";

export type Fase = "F1" | "F2" | "F3" | "F4";

export interface SeccionModulo {
  clave: string;
  titulo: string;
  /** Permiso mínimo para ver la sección. */
  permiso: Accion;
}

export interface EntradaModulo {
  id: ModuloId;
  /** Segmento de la ruta: #/venta, #/cocina… */
  clave: string;
  titulo: string;
  /** Fase en la que el módulo queda mayormente cubierto. */
  fase: Fase;
  /** Permiso mínimo para que el módulo aparezca en el sidebar. */
  permiso: Accion;
  /** true = ya tiene funcionalidad real; false = vista de roadmap. */
  operativo: boolean;
  secciones: SeccionModulo[];
  /** Una línea sobre qué resuelve el módulo. */
  resumen: string;
  /** Funciones del Anexo A del PRD que cubre. */
  funciones: string[];
  /** Qué queda listo en F1 y en qué etapa del plan. */
  enF1?: string;
  etapa?: string;
}

export const MODULOS: EntradaModulo[] = [
  {
    id: "m1",
    clave: "venta",
    titulo: "Venta",
    fase: "F1",
    permiso: "pos.orden.abrir",
    operativo: true,
    secciones: [{ clave: "salon", titulo: "Salón y comandas", permiso: "pos.orden.abrir" }],
    resumen:
      "Mesas, comandas, cuentas, productos configurables y cobro. El corazón del servicio.",
    funciones: [
      "Gestión de mesas con plano de piso",
      "Modalidades de servicio (comedor, rápido, domicilio, drive-thru)",
      "Comandero móvil",
      "División y traspaso de cuentas con propinas",
      "POS de venta con impuestos y formas de pago",
      "Corte de caja y arqueos",
    ],
    enF1: "Salón, comandas, configurador de productos y cobro.",
    etapa: "Etapas 5 y 6 completan el plano de piso y el POS generalizado.",
  },
  {
    id: "m2",
    clave: "cocina",
    titulo: "Cocina",
    fase: "F1",
    // El menú se administra aquí, así que basta con poder consultar recetas
    // para que el módulo aparezca: un mesero entra a ver de qué está hecho un
    // platillo aunque no tenga acceso al tablero de producción.
    permiso: "cocina.receta.ver",
    operativo: true,
    secciones: [
      { clave: "tablero", titulo: "Tablero de cocina", permiso: "cocina.comanda.ver" },
      { clave: "menu", titulo: "Menú", permiso: "cocina.receta.ver" },
    ],
    resumen:
      "Pantalla de cocina por estación con tiempos y semáforo, recetas y control de producción.",
    funciones: [
      "KDS con comandas, tiempos y estatus por platillo",
      "Impresión de comandas por área (cocina, barra, repostería)",
      "Recall / historial de comandas",
      "Recetas y subrecetas con explosión de insumos",
      "Monitor de tiempos de producción por estación",
    ],
    enF1: "KDS por estación con cronómetro y semáforo por platillo, y recall de lo entregado.",
    etapa: "La impresión de comandas por área llega en la etapa 11.",
  },
  {
    id: "m3",
    clave: "inventario",
    titulo: "Inventario",
    fase: "F1",
    permiso: "inv.existencias.ver",
    operativo: true,
    secciones: [{ clave: "almacen", titulo: "Existencias y mermas", permiso: "inv.existencias.ver" }],
    resumen:
      "Existencias en tiempo real, consumo por receta, mermas, conteos cíclicos y multialmacén.",
    funciones: [
      "Inventario por ingrediente y multialmacén en tiempo real",
      "Control de mermas con alertas y ajustes",
      "Costeo ideal contra real",
      "Producción y rendimientos internos",
    ],
    enF1: "Existencias derivadas de los movimientos, descuento automático al enviar a cocina, mermas y conteos cíclicos.",
    etapa: "El costeo ideal contra real y el multialmacén llegan en F2.",
  },
  {
    id: "m4",
    clave: "compras",
    titulo: "Compras",
    fase: "F2",
    permiso: "compras.proveedor.editar",
    operativo: true,
    secciones: [{ clave: "compras", titulo: "Proveedores y órdenes", permiso: "compras.proveedor.editar" }],
    resumen:
      "Proveedores, órdenes de compra, recepción de mercancía y captura automática desde CFDI.",
    funciones: [
      "Órdenes de compra y proveedores con mínimos y máximos",
      "Registro de compras por CFDI XML (ingesta automática)",
      "Evaluación de desempeño de proveedores",
    ],
    enF1: "Proveedores, qué pedir según el stock mínimo, órdenes de compra y recepción que carga el almacén sola.",
    etapa: "La ingesta automática desde el CFDI XML del proveedor llega en F2.",
  },
  {
    id: "m5",
    clave: "finanzas",
    titulo: "Finanzas",
    fase: "F2",
    permiso: "fin.corte.ver",
    operativo: true,
    secciones: [{ clave: "facturacion", titulo: "Facturación", permiso: "fin.factura.emitir" }],
    resumen:
      "Corte del día, facturación CFDI 4.0, egresos, estado de resultados y enlace contable.",
    funciones: [
      "Emisión y timbrado CFDI 4.0 desde el POS",
      "Autofactura del cliente por QR del ticket",
      "Módulo de egresos y flujo de efectivo",
      "Estado de resultados consultable",
      "Enlace contable (CONTPAQi, Aspel, Microsip)",
    ],
    enF1: "Resultado del día, corte de caja sellado con arqueo contra el efectivo real, y facturación CFDI.",
    etapa: "El enlace contable y el estado de resultados completo llegan en F2.",
  },
  {
    id: "m6",
    clave: "personal",
    titulo: "Personal",
    fase: "F1",
    permiso: "rrhh.checada.registrar",
    operativo: true,
    secciones: [{ clave: "checador", titulo: "Checador", permiso: "rrhh.checada.registrar" }],
    resumen: "Checador de asistencia, turnos, propinas, prenómina y desempeño del equipo.",
    funciones: [
      "Reloj checador / control de asistencia por PIN",
      "Prenómina con horas, propinas e incidencias",
      "Desempeño de meseros (venta, propinas, tiempos)",
    ],
    enF1: "Checador por PIN con turnos, descansos y corrección auditada de checadas olvidadas.",
    etapa: "La prenómina completa llega en F2.",
  },
  {
    id: "m7",
    clave: "clientes",
    titulo: "Clientes",
    fase: "F3",
    permiso: "crm.cliente.ver",
    operativo: false,
    secciones: [],
    resumen:
      "Ficha 360° del comensal, reservas, lealtad, monedero y campañas de retención.",
    funciones: [
      "Perfil 360° del comensal (visitas, gasto, preferencias, alergias)",
      "Motor de reservaciones omnicanal y lista de espera",
      "Programa de lealtad, monedero y tarjetas de regalo",
      "Encuestas de satisfacción y reseñas verificadas",
    ],
    enF1: "Ficha básica del cliente con sus datos fiscales, para domicilio y facturación.",
    etapa: "Fase F3.",
  },
  {
    id: "m8",
    clave: "inteligencia",
    titulo: "Inteligencia",
    fase: "F3",
    permiso: "bi.reporte.ver",
    operativo: true,
    secciones: [{ clave: "reportes", titulo: "Reportes", permiso: "bi.reporte.ver" }],
    resumen:
      "Tableros por rol y las cinco capacidades AI-first: la diferencia de MotRest frente al mercado.",
    funciones: [
      "Reportes por área, servicio, horario, producto y mesero",
      "Gemelo digital operativo y simulador de escenarios",
      "Menu engineering con IA y precios inteligentes",
      "Pronóstico de demanda con compras y turnos autónomos",
      "Centinela de mermas y anomalías",
      "Voz del cliente omnicanal",
    ],
    enF1: "Ventas por producto, mesero y hora; ticket promedio, food cost e ingeniería de menú.",
    etapa: "Las 5 capacidades AI llegan en F3, sobre este mismo event log.",
  },
  {
    id: "m9",
    clave: "administracion",
    titulo: "Administración",
    fase: "F1",
    permiso: "admin.bitacora.ver",
    operativo: true,
    secciones: [
      { clave: "usuarios", titulo: "Usuarios y permisos", permiso: "admin.usuario.editar" },
      { clave: "salones", titulo: "Salones y plano", permiso: "cat.area.editar" },
      { clave: "catalogo", titulo: "Insumos y estaciones", permiso: "cat.producto.editar" },
      { clave: "impresoras", titulo: "Impresoras", permiso: "admin.dispositivo.aprobar" },
      { clave: "hub", titulo: "Hub del local", permiso: "admin.dispositivo.aprobar" },
      { clave: "bitacora", titulo: "Bitácora", permiso: "admin.bitacora.ver" },
    ],
    resumen:
      "Configuración del restaurante, usuarios, permisos, salones y auditoría de todo lo ocurrido.",
    funciones: [
      "Roles y permisos granulares con autorizaciones",
      "Bitácoras de auditoría (cancelaciones, descuentos, reimpresiones)",
      "Catálogo de productos, categorías y precios",
      "Salones, mesas, estaciones e impresoras",
      "Multisucursal y multiempresa",
    ],
    enF1: "Usuarios y permisos granulares, salones, insumos, estaciones y bitácora de auditoría — todo editable sin tocar código.",
    etapa: "Multisucursal y multiempresa llegan en F4.",
  },
];

export const MODULO_POR_CLAVE: ReadonlyMap<string, EntradaModulo> = new Map(
  MODULOS.map((m) => [m.clave, m]),
);

/** Color del distintivo de fase en el sidebar. */
export const COLOR_FASE: Record<Fase, string> = {
  F1: "var(--acento)",
  F2: "var(--acento-2)",
  F3: "#7a9ec4",
  F4: "var(--gris)",
};
