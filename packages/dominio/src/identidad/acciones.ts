/**
 * Catálogo de acciones atómicas del sistema.
 *
 * Cada acción se nombra `modulo.recurso.verbo` y lleva su etiqueta legible. Este
 * catálogo es EXACTAMENTE la lista que se despliega al dar de alta un usuario
 * (pedido de Gonzalo): el administrador ve todas las actividades, decide el
 * nivel de cada una y sus alcances.
 *
 * La matriz rol × acción se aplica en el cliente para la experiencia y —cuando
 * llegue el Hub— se revalida en el servidor, que es la única verdad (TRD §10).
 */

export type Accion =
  // M1 · Venta y servicio
  | "pos.orden.abrir"
  | "pos.orden.ver_ajenas"
  | "pos.item.agregar"
  | "pos.item.cancelar_previo_envio"
  | "pos.item.cancelar_enviado"
  | "pos.item.enviar_cocina"
  | "pos.descuento.aplicar"
  | "pos.cortesia.otorgar"
  | "pos.precio.editar_en_linea"
  | "pos.cuenta.dividir"
  | "pos.cuenta.transferir"
  | "pos.cuenta.reabrir"
  | "pos.cobro.registrar"
  // Caja
  | "caja.sesion.abrir"
  | "caja.retiro.registrar"
  | "caja.corte.sellar"
  | "caja.arqueo.ver"
  // M2 · Cocina
  | "cocina.comanda.ver"
  | "cocina.item.marcar_listo"
  | "cocina.receta.ver"
  | "cocina.receta.editar"
  // M3 · Inventario
  | "inv.existencias.ver"
  | "inv.merma.registrar"
  | "inv.ajuste.aplicar"
  | "inv.conteo.cerrar"
  // M4 · Compras
  | "compras.proveedor.editar"
  | "compras.orden.generar"
  | "compras.recepcion.registrar"
  // M5 · Finanzas
  | "fin.corte.ver"
  | "fin.costo.ver"
  | "fin.egreso.registrar"
  | "fin.factura.emitir"
  // M6 · Personal
  | "rrhh.checada.registrar"
  | "rrhh.checada.ajustar"
  | "rrhh.empleado.editar"
  // M7 · Clientes
  | "crm.cliente.ver"
  | "crm.cliente.editar"
  // M8 · Inteligencia
  | "bi.reporte.ver"
  | "bi.reporte.exportar"
  // M9 · Administración
  | "cat.producto.editar"
  | "cat.precio.editar"
  | "cat.area.editar"
  | "admin.usuario.crear"
  | "admin.usuario.editar"
  | "admin.rol.editar"
  | "admin.dispositivo.aprobar"
  | "admin.bitacora.ver";

export type ModuloId = "m1" | "m2" | "m3" | "m4" | "m5" | "m6" | "m7" | "m8" | "m9";

export interface DefinicionAccion {
  accion: Accion;
  modulo: ModuloId;
  etiqueta: string;
  descripcion: string;
  /** true = por su riesgo, conviene que exija autorización de un superior. */
  sensible?: boolean;
}

export interface GrupoAcciones {
  modulo: ModuloId;
  titulo: string;
  acciones: DefinicionAccion[];
}

const def = (
  accion: Accion,
  modulo: ModuloId,
  etiqueta: string,
  descripcion: string,
  sensible = false,
): DefinicionAccion => ({ accion, modulo, etiqueta, descripcion, sensible });

/** Catálogo completo, agrupado por módulo — es lo que ve el administrador. */
export const CATALOGO_ACCIONES: GrupoAcciones[] = [
  {
    modulo: "m1",
    titulo: "M1 · Venta y servicio",
    acciones: [
      def("pos.orden.abrir", "m1", "Abrir mesas", "Iniciar una cuenta nueva en una mesa"),
      def("pos.orden.ver_ajenas", "m1", "Ver cuentas de otros", "Consultar mesas que atiende otro mesero"),
      def("pos.item.agregar", "m1", "Agregar productos", "Capturar platillos y bebidas en la cuenta"),
      def("pos.item.cancelar_previo_envio", "m1", "Cancelar antes de enviar", "Quitar un renglón que aún no sale a cocina"),
      def("pos.item.cancelar_enviado", "m1", "Cancelar ya enviado", "Quitar un renglón que la cocina ya recibió", true),
      def("pos.item.enviar_cocina", "m1", "Enviar a cocina", "Mandar los platillos capturados a producción"),
      def("pos.descuento.aplicar", "m1", "Aplicar descuentos", "Rebajar el importe de un renglón o de la cuenta", true),
      def("pos.cortesia.otorgar", "m1", "Otorgar cortesías", "Marcar un consumo como cortesía de la casa", true),
      def("pos.precio.editar_en_linea", "m1", "Editar precio en la venta", "Cambiar el precio de un renglón durante el servicio", true),
      def("pos.cuenta.dividir", "m1", "Dividir cuentas", "Separar una cuenta en varias"),
      def("pos.cuenta.transferir", "m1", "Traspasar cuentas", "Mover renglones o cuentas entre mesas"),
      def("pos.cuenta.reabrir", "m1", "Reabrir cuentas", "Volver a abrir una cuenta ya cerrada", true),
      def("pos.cobro.registrar", "m1", "Cobrar", "Registrar el pago y cerrar la cuenta"),
      def("caja.sesion.abrir", "m1", "Abrir caja", "Iniciar sesión de caja con fondo inicial"),
      def("caja.retiro.registrar", "m1", "Retirar efectivo", "Sacar dinero de la caja durante el turno", true),
      def("caja.corte.sellar", "m1", "Sellar el corte", "Cerrar el turno de caja de forma definitiva", true),
      def("caja.arqueo.ver", "m1", "Ver arqueos", "Consultar cortes y diferencias de caja"),
    ],
  },
  {
    modulo: "m2",
    titulo: "M2 · Cocina y recetas",
    acciones: [
      def("cocina.comanda.ver", "m2", "Ver comandas", "Consultar la pantalla de cocina por estación"),
      def("cocina.item.marcar_listo", "m2", "Marcar platillos listos", "Avanzar el estado de producción de un platillo"),
      def("cocina.receta.ver", "m2", "Ver recetas", "Consultar de qué está hecho un platillo, sin ver sus costos"),
      def("cocina.receta.editar", "m2", "Editar recetas", "Modificar la receta e insumos de un platillo", true),
    ],
  },
  {
    modulo: "m3",
    titulo: "M3 · Inventario",
    acciones: [
      def("inv.existencias.ver", "m3", "Ver existencias", "Consultar el stock actual"),
      def("inv.merma.registrar", "m3", "Registrar mermas", "Dar de baja producto por merma o desperdicio"),
      def("inv.ajuste.aplicar", "m3", "Ajustar inventario", "Corregir existencias fuera de un conteo", true),
      def("inv.conteo.cerrar", "m3", "Cerrar conteos", "Confirmar un conteo cíclico y aplicar diferencias", true),
    ],
  },
  {
    modulo: "m4",
    titulo: "M4 · Compras y proveedores",
    acciones: [
      def("compras.proveedor.editar", "m4", "Gestionar proveedores", "Alta y edición de proveedores"),
      def("compras.orden.generar", "m4", "Generar órdenes de compra", "Crear órdenes a proveedores"),
      def("compras.recepcion.registrar", "m4", "Recibir mercancía", "Registrar la entrada de una compra"),
    ],
  },
  {
    modulo: "m5",
    titulo: "M5 · Finanzas y facturación",
    acciones: [
      def("fin.corte.ver", "m5", "Ver cortes y ventas", "Consultar el resultado del día"),
      def("fin.costo.ver", "m5", "Ver costos y márgenes", "Consultar food cost y margen de los platillos"),
      def("fin.egreso.registrar", "m5", "Registrar egresos", "Capturar gastos y salidas de dinero", true),
      def("fin.factura.emitir", "m5", "Emitir facturas", "Generar y timbrar comprobantes fiscales"),
    ],
  },
  {
    modulo: "m6",
    titulo: "M6 · Personal",
    acciones: [
      def("rrhh.checada.registrar", "m6", "Checar entrada y salida", "Registrar la propia asistencia"),
      def("rrhh.checada.ajustar", "m6", "Ajustar checadas", "Corregir registros de asistencia de otros", true),
      def("rrhh.empleado.editar", "m6", "Gestionar empleados", "Alta y edición de la ficha del personal", true),
    ],
  },
  {
    modulo: "m7",
    titulo: "M7 · Clientes",
    acciones: [
      def("crm.cliente.ver", "m7", "Ver clientes", "Consultar la ficha del comensal"),
      def("crm.cliente.editar", "m7", "Gestionar clientes", "Alta y edición de clientes y datos fiscales"),
    ],
  },
  {
    modulo: "m8",
    titulo: "M8 · Inteligencia",
    acciones: [
      def("bi.reporte.ver", "m8", "Ver reportes", "Consultar tableros y reportes de negocio"),
      def("bi.reporte.exportar", "m8", "Exportar reportes", "Descargar información del negocio"),
    ],
  },
  {
    modulo: "m9",
    titulo: "M9 · Administración",
    acciones: [
      def("cat.producto.editar", "m9", "Editar el menú", "Alta y edición de productos y categorías"),
      def("cat.precio.editar", "m9", "Editar precios", "Cambiar precios de carta y listas de precios", true),
      def("cat.area.editar", "m9", "Editar salones y mesas", "Configurar áreas, plano de piso y mesas"),
      def("admin.usuario.crear", "m9", "Crear usuarios", "Dar de alta personal con acceso al sistema", true),
      def("admin.usuario.editar", "m9", "Editar usuarios", "Modificar permisos y datos de acceso", true),
      def("admin.rol.editar", "m9", "Editar roles", "Modificar las plantillas de permisos", true),
      def("admin.dispositivo.aprobar", "m9", "Aprobar dispositivos", "Autorizar terminales nuevas en el local", true),
      def("admin.bitacora.ver", "m9", "Ver la bitácora", "Consultar la auditoría de todo lo ocurrido"),
    ],
  },
];

/** Todas las acciones en una lista plana. */
export const TODAS_LAS_ACCIONES: Accion[] = CATALOGO_ACCIONES.flatMap((g) =>
  g.acciones.map((a) => a.accion),
);

const indice = new Map<Accion, DefinicionAccion>(
  CATALOGO_ACCIONES.flatMap((g) => g.acciones.map((a) => [a.accion, a] as const)),
);

export function definicionAccion(accion: Accion): DefinicionAccion | undefined {
  return indice.get(accion);
}

export function etiquetaAccion(accion: Accion): string {
  return indice.get(accion)?.etiqueta ?? accion;
}
