/**
 * Roles y permisos.
 *
 * El `nivel` de cada permiso es literalmente la separación del PRD §2 entre
 * VISIÓN (qué ve) y ADMINISTRACIÓN (qué modifica o autoriza):
 *   - "ver"       → solo consulta
 *   - "operar"    → puede ejecutar la acción
 *   - "autorizar" → puede ejecutarla Y autorizarla a otros con su PIN
 *
 * `limite` acota la magnitud: porcentaje máximo de descuento, monto máximo de
 * retiro. Superarlo convierte la acción en "requiere autorización".
 *
 * Las plantillas son el PUNTO DE PARTIDA al dar de alta un usuario; después el
 * administrador ajusta acción por acción (pedido de Gonzalo).
 */
import type { Centavos } from "../comun/dinero.js";
import type { ID } from "../comun/ids.js";
import { TODAS_LAS_ACCIONES, type Accion } from "./acciones.js";

export type Nivel = "ver" | "operar" | "autorizar";

export interface Permiso {
  accion: Accion;
  nivel: Nivel;
  /** Tope permitido: porcentaje (0..1) para descuentos, centavos para montos. */
  limite?: number;
}

export type RolId =
  /** MOTRAE. No es del restaurante y no aparece en su lista. Ver `soporte.ts`. */
  | "soporte"
  | "propietario"
  | "gerente"
  | "administracion"
  | "compras"
  | "chef"
  | "cajero"
  | "mesero"
  | "comensal";

export interface Rol {
  id: RolId;
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
  /**
   * true = no se ofrece en ninguna pantalla del restaurante.
   *
   * No basta con esconderlo de la lista de usuarios: un rol que aparece entre
   * los que pueden autorizar una cancelación delata su existencia en el diálogo
   * de PIN. Se filtra en el origen.
   */
  oculto?: boolean;
}

const p = (accion: Accion, nivel: Nivel, limite?: number): Permiso => ({
  accion,
  nivel,
  ...(limite === undefined ? {} : { limite }),
});

/** Todas las acciones al nivel indicado (para el rol propietario). */
const todas = (nivel: Nivel): Permiso[] => TODAS_LAS_ACCIONES.map((a) => p(a, nivel));

export const ROLES: Record<RolId, Rol> = {
  /**
   * Soporte de MOTRAE. El proveedor, no el restaurante.
   *
   * Existe para que cuando algo se rompa un viernes a las nueve de la noche,
   * MOTRAE pueda entrar a arreglarlo sin pedirle a nadie su contraseña y sin
   * pedirle al gerente que lea configuraciones por teléfono.
   *
   * TRES COSAS QUE LO HACEN LEGÍTIMO Y NO UNA PUERTA TRASERA:
   *
   *   1. Su credencial NO está en el código: viaja en la licencia firmada y la
   *      elige Gonzalo. Nadie puede fabricarse uno.
   *   2. Todo lo que hace queda en la BITÁCORA con su nombre, y la bitácora es
   *      el event log: solo agrega, nunca borra. Ni MOTRAE puede tapar sus
   *      propios pasos.
   *   3. Está declarado en el contrato del cliente. Un acceso de soporte que el
   *      cliente conoce es mantenimiento; uno que no conoce es otra cosa.
   */
  soporte: {
    id: "soporte",
    nombre: "Soporte MOTRAE",
    descripcion: "Acceso técnico del proveedor. No pertenece al personal del restaurante.",
    permisos: todas("autorizar"),
    oculto: true,
  },

  propietario: {
    id: "propietario",
    nombre: "Dirección / Propietario",
    descripcion:
      "Visión completa del negocio y control total de la configuración. Autoriza cualquier acción.",
    permisos: todas("autorizar"),
  },

  gerente: {
    id: "gerente",
    nombre: "Gerente de sucursal",
    descripcion:
      "Opera el día a día de su sucursal y autoriza descuentos y cortesías dentro de su límite.",
    permisos: [
      p("pos.orden.abrir", "operar"),
      p("pos.orden.ver_ajenas", "ver"),
      p("pos.item.agregar", "operar"),
      p("pos.item.cancelar_previo_envio", "operar"),
      p("pos.item.cancelar_enviado", "autorizar"),
      p("pos.item.enviar_cocina", "operar"),
      p("pos.item.entregar", "operar"),
      p("pos.descuento.aplicar", "autorizar", 0.2),
      p("pos.cortesia.otorgar", "autorizar"),
      // El gerente firma el consumo de un socio; el mesero lo pide y él lo
      // autoriza con su PIN, que es como ocurre en la mesa.
      p("pos.socio.consumir", "autorizar"),
      p("pos.precio.editar_en_linea", "autorizar"),
      p("pos.cuenta.dividir", "operar"),
      p("pos.cuenta.transferir", "operar"),
      p("pos.cuenta.reabrir", "autorizar"),
      p("pos.cobro.registrar", "operar"),
      p("caja.sesion.abrir", "operar"),
      p("caja.retiro.registrar", "autorizar", 500_000),
      p("caja.corte.sellar", "operar"),
      p("caja.arqueo.ver", "ver"),
      p("cocina.comanda.ver", "ver"),
      p("cocina.item.marcar_listo", "operar"),
      p("cocina.receta.ver", "ver"),
      p("cocina.receta.editar", "operar"),
      p("inv.existencias.ver", "ver"),
      p("inv.merma.registrar", "operar"),
      p("inv.ajuste.aplicar", "autorizar"),
      p("inv.conteo.cerrar", "autorizar"),
      p("compras.proveedor.editar", "operar"),
      p("compras.orden.generar", "operar"),
      p("compras.recepcion.registrar", "operar"),
      p("fin.corte.ver", "ver"),
      p("fin.costo.ver", "ver"),
      p("fin.egreso.registrar", "operar"),
      p("fin.factura.emitir", "operar"),
      p("rrhh.checada.registrar", "operar"),
      p("rrhh.checada.ajustar", "autorizar"),
      p("rrhh.empleado.editar", "operar"),
      // Quien reparte la raya tiene que ver el fondo completo, no solo lo suyo.
      p("rrhh.propina.ver", "ver"),
      p("rrhh.propina.ver_local", "ver"),
      p("crm.cliente.ver", "ver"),
      p("crm.cliente.editar", "operar"),
      p("bi.reporte.ver", "ver"),
      p("bi.reporte.exportar", "operar"),
      p("cat.producto.editar", "operar"),
      p("cat.precio.editar", "autorizar"),
      p("cat.area.editar", "operar"),
      p("admin.usuario.crear", "operar"),
      p("admin.usuario.editar", "operar"),
      p("admin.dispositivo.aprobar", "operar"),
      p("admin.bitacora.ver", "ver"),
    ],
  },

  administracion: {
    id: "administracion",
    nombre: "Administración / Contabilidad",
    descripcion: "Cierra periodos, timbra, concilia y gestiona la información fiscal.",
    permisos: [
      p("caja.arqueo.ver", "ver"),
      p("fin.corte.ver", "ver"),
      p("fin.costo.ver", "ver"),
      p("fin.egreso.registrar", "operar"),
      p("fin.factura.emitir", "operar"),
      p("compras.proveedor.editar", "operar"),
      p("rrhh.propina.ver", "ver"),
      p("rrhh.propina.ver_local", "ver"),
      p("crm.cliente.ver", "ver"),
      p("crm.cliente.editar", "operar"),
      p("bi.reporte.ver", "ver"),
      p("bi.reporte.exportar", "operar"),
      p("admin.bitacora.ver", "ver"),
    ],
  },

  compras: {
    id: "compras",
    nombre: "Compras / Almacén",
    descripcion: "Genera y recibe compras, ajusta existencias y evalúa proveedores.",
    permisos: [
      p("inv.existencias.ver", "ver"),
      p("inv.merma.registrar", "operar"),
      p("inv.ajuste.aplicar", "operar"),
      p("inv.conteo.cerrar", "operar"),
      p("compras.proveedor.editar", "operar"),
      p("compras.orden.generar", "operar"),
      p("compras.recepcion.registrar", "operar"),
      p("cocina.receta.ver", "ver"),
      p("fin.costo.ver", "ver"),
      p("bi.reporte.ver", "ver"),
      p("rrhh.checada.registrar", "operar"),
    ],
  },

  chef: {
    id: "chef",
    nombre: "Chef / Jefe de cocina",
    descripcion: "Controla la producción, las recetas y la merma de su área.",
    permisos: [
      p("cocina.comanda.ver", "ver"),
      p("cocina.item.marcar_listo", "operar"),
      p("pos.item.entregar", "operar"),
      p("cocina.receta.ver", "ver"),
      p("cocina.receta.editar", "operar"),
      p("inv.existencias.ver", "ver"),
      p("inv.merma.registrar", "operar"),
      p("fin.costo.ver", "ver"),
      p("bi.reporte.ver", "ver"),
      p("rrhh.checada.registrar", "operar"),
    ],
  },

  cajero: {
    id: "cajero",
    nombre: "Cajero",
    descripcion: "Cobra y administra su caja. Las cancelaciones requieren autorización.",
    permisos: [
      p("pos.orden.abrir", "operar"),
      p("pos.orden.ver_ajenas", "ver"),
      p("pos.item.agregar", "operar"),
      p("pos.item.cancelar_previo_envio", "operar"),
      p("pos.item.enviar_cocina", "operar"),
      p("pos.item.entregar", "operar"),
      p("pos.cuenta.dividir", "operar"),
      p("pos.cobro.registrar", "operar"),
      // Quien cobra es quien registra el consumo del socio: es un cobro más,
      // solo que contra su bolsa en vez de contra el cajón.
      p("pos.socio.consumir", "operar"),
      p("caja.sesion.abrir", "operar"),
      p("caja.arqueo.ver", "ver"),
      p("fin.factura.emitir", "operar"),
      p("cocina.receta.ver", "ver"),
      p("crm.cliente.ver", "ver"),
      p("rrhh.checada.registrar", "operar"),
      p("rrhh.propina.ver", "ver"),
    ],
  },

  mesero: {
    id: "mesero",
    nombre: "Mesero / Servicio",
    descripcion: "Toma comandas, envía a cocina y mueve mesas. Ve solo sus mesas.",
    permisos: [
      p("pos.orden.abrir", "operar"),
      p("pos.item.agregar", "operar"),
      p("pos.item.cancelar_previo_envio", "operar"),
      p("pos.item.enviar_cocina", "operar"),
      p("pos.item.entregar", "operar"),
      p("pos.cuenta.transferir", "operar"),
      // Quien atiende la mesa tiene que poder decir de qué está hecho un
      // platillo: una pregunta por alergias no puede depender de la cocina.
      p("cocina.receta.ver", "ver"),
      p("rrhh.checada.registrar", "operar"),
      // Cuánto lleva de propina. En nivel "ver" son SOLO las suyas: cuánto
      // lleva el compañero de al lado no es asunto de nadie más.
      p("rrhh.propina.ver", "ver"),
    ],
  },

  comensal: {
    id: "comensal",
    nombre: "Comensal",
    descripcion: "Usuario externo: carta, su cuenta, sus reservas y sus puntos.",
    permisos: [p("crm.cliente.ver", "ver")],
  },
};

export const LISTA_ROLES: Rol[] = Object.values(ROLES);

/** Los roles que el restaurante puede ver y asignar. Soporte no está. */
export const ROLES_VISIBLES: Rol[] = LISTA_ROLES.filter((r) => !r.oculto);

/**
 * Rango jerárquico de cada rol.
 *
 * Nadie puede administrar a un igual ni a un superior: un gerente NO edita los
 * permisos de la dirección, ni la desactiva, ni la desbloquea. Sin esta regla,
 * cualquiera con permiso de "editar usuarios" podría escalar privilegios
 * modificando a quien está por encima suyo.
 *
 * Consecuencia deliberada: los permisos del propietario no los edita nadie
 * (tampoco él mismo). Es el ancla de confianza del sistema.
 */
export const RANGO: Record<RolId, number> = {
  // Por encima del propietario, y eso es exactamente lo que lo protege: como
  // nadie administra a un rango mayor, el restaurante no puede desactivar el
  // acceso de soporte, ni cambiarle los permisos, ni borrarlo.
  soporte: 120,
  propietario: 100,
  gerente: 80,
  administracion: 70,
  compras: 50,
  chef: 50,
  cajero: 40,
  mesero: 30,
  comensal: 10,
};

export function rangoDe(rolId: RolId): number {
  return RANGO[rolId];
}

/** Copia de los permisos de una plantilla, lista para ajustarse por usuario. */
export function permisosDePlantilla(rolId: RolId): Permiso[] {
  return ROLES[rolId].permisos.map((x) => ({ ...x }));
}

/** Usuario del sistema, con sus permisos EFECTIVOS (ya ajustados). */
export interface Usuario {
  id: ID;
  nombre: string;
  /** Iniciales para el avatar. */
  iniciales: string;
  rol_id: RolId;
  /** Puesto legible; por defecto el nombre del rol. */
  puesto: string;
  sucursal_id: ID;
  permisos: Permiso[];
  activo: boolean;
  /** true = debe cambiar su credencial en el próximo inicio de sesión. */
  debe_cambiar_credencial?: boolean;
  /**
   * true = no sale en ninguna lista del restaurante.
   *
   * Solo el soporte de MOTRAE. Deliberadamente NO afecta a la bitácora: lo que
   * hace se ve con su nombre, y por eso se filtra en cada pantalla en vez de
   * filtrarse en la proyección.
   */
  oculto?: boolean;
}

/** Los usuarios que el personal del restaurante debe ver. */
export function usuariosVisibles(usuarios: readonly Usuario[]): Usuario[] {
  return usuarios.filter((u) => !u.oculto);
}
