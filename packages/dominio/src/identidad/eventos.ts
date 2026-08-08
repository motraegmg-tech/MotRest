/**
 * Eventos de identidad: sesiones, autorizaciones y gestión de usuarios.
 *
 * Van al mismo event log que la operación, porque el TRD §10 es explícito: el
 * event log ES la bitácora inmutable. Quién entró, quién autorizó qué, en qué
 * dispositivo y a qué hora — todo queda aquí, y es el mismo sustrato que
 * alimentará al Centinela de mermas (C5).
 */
import type { ID } from "../comun/ids.js";
import type { EventoBase } from "../evento.js";
import { definicionAccion, type Accion } from "./acciones.js";
import { ROLES, type Permiso, type RolId } from "./roles.js";

export type EventoIdentidad =
  | (EventoBase & {
      tipo: "sesion_iniciada";
      usuario_id: ID;
      rol_id: RolId;
      /** true si la sesión se abrió con el conmutador rápido del POS. */
      cambio_rapido?: boolean;
    })
  | (EventoBase & {
      tipo: "sesion_cerrada";
      usuario_id: ID;
    })
  | (EventoBase & {
      tipo: "acceso_rechazado";
      usuario_id?: ID;
      motivo: "credencial_invalida" | "usuario_inactivo" | "bloqueo_por_intentos";
    })
  | (EventoBase & {
      tipo: "autorizacion_otorgada";
      accion: Accion;
      solicitante_id: ID;
      autorizador_id: ID;
      /** Referencia al recurso afectado (renglón, orden, sesión de caja…). */
      contexto?: string;
    })
  | (EventoBase & {
      tipo: "autorizacion_denegada";
      accion: Accion;
      solicitante_id: ID;
      motivo: string;
    })
  | (EventoBase & {
      tipo: "usuario_creado";
      usuario_id: ID;
      nombre: string;
      puesto: string;
      rol_id: RolId;
      permisos: Permiso[];
    })
  | (EventoBase & {
      tipo: "usuario_actualizado";
      usuario_id: ID;
      cambios: {
        nombre?: string;
        rol_id?: RolId;
        permisos?: Permiso[];
        activo?: boolean;
      };
    })
  | (EventoBase & {
      tipo: "credencial_cambiada";
      usuario_id: ID;
      tipo_credencial: "contrasena" | "pin";
      /**
       * Quién firmó el restablecimiento, si no lo hizo el propio usuario.
       *
       * Distinguir «cambié mi contraseña» de «alguien me la restableció» es lo
       * que hace útil esta línea de la bitácora: la segunda es la que hay que
       * poder revisar si después aparece un movimiento raro con esa cuenta.
       */
      autorizador_id?: ID;
    })
  | (EventoBase & {
      /**
       * Alguien recuperó el acceso con el código de rescate.
       *
       * Va aparte de `credencial_cambiada` a propósito: es el único camino que
       * no lo firma otra persona, así que tiene que poder auditarse por sí solo.
       * Si aparece una de estas y el dueño no la reconoce, hay que actuar.
       */
      tipo: "acceso_recuperado";
      usuario_id: ID;
    })
  | (EventoBase & {
      /**
       * Baja definitiva de la plantilla. **No se deshace.**
       *
       * Es distinto de `usuario_actualizado { activo: false }`: aquel es «ya no
       * trabaja aquí, de momento» y se revierte el día que vuelve. Esto lo saca
       * de todas las listas del sistema para siempre.
       *
       * El evento SÍ se queda en la bitácora, y ahí está lo importante: el log
       * es el registro del negocio y solo agrega. Quien cobró una mesa el mes
       * pasado la sigue habiendo cobrado aunque hoy ya no exista como usuario, y
       * queda escrito quién lo eliminó y cuándo.
       */
      tipo: "usuario_eliminado";
      usuario_id: ID;
      /** Quién lo firmó. Es una decisión del rango más alto del restaurante. */
      eliminado_por: ID;
      /** Se conserva para poder leer la bitácora sin resolver identificadores. */
      nombre: string;
    })
  | (EventoBase & {
      tipo: "usuario_bloqueado";
      usuario_id: ID;
      /** Intentos fallidos que dispararon el bloqueo. */
      intentos: number;
    })
  | (EventoBase & {
      tipo: "usuario_desbloqueado";
      usuario_id: ID;
      desbloqueado_por: ID;
    });

export type TipoEventoIdentidad = EventoIdentidad["tipo"];

/** Stream al que van los eventos de identidad de una sucursal. */
export function streamIdentidad(sucursal_id: ID): ID {
  return `identidad:${sucursal_id}`;
}

/**
 * Tipos que sí puede consumir la proyección de identidad.
 *
 * El event log también contiene comandas, caja, inventario y eventos futuros.
 * Reducir uno de ellos como si fuera identidad corrompería la proyección: el
 * default exhaustivo del reducer solo es seguro después de esta frontera de
 * ejecución.
 */
const TIPOS_EVENTO_IDENTIDAD = new Set<string>([
  "sesion_iniciada",
  "sesion_cerrada",
  "acceso_rechazado",
  "autorizacion_otorgada",
  "autorizacion_denegada",
  "usuario_creado",
  "usuario_actualizado",
  "usuario_eliminado",
  "credencial_cambiada",
  "acceso_recuperado",
  "usuario_bloqueado",
  "usuario_desbloqueado",
]);

/** Distingue un tipo de identidad antes de intentar reducirlo. */
export function esTipoEventoIdentidad(tipo: string): tipo is TipoEventoIdentidad {
  return TIPOS_EVENTO_IDENTIDAD.has(tipo);
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function esRolId(valor: unknown): valor is RolId {
  return typeof valor === "string" && Object.prototype.hasOwnProperty.call(ROLES, valor);
}

function esAccion(valor: unknown): valor is Accion {
  return typeof valor === "string" && definicionAccion(valor as Accion) !== undefined;
}

function esPermiso(valor: unknown): valor is Permiso {
  if (!esRegistro(valor)) return false;
  return (
    esAccion(valor.accion) &&
    (valor.nivel === "ver" || valor.nivel === "operar" || valor.nivel === "autorizar") &&
    (valor.limite === undefined ||
      (typeof valor.limite === "number" && Number.isFinite(valor.limite) && valor.limite >= 0))
  );
}

function esListaDePermisos(valor: unknown): valor is Permiso[] {
  return Array.isArray(valor) && valor.every(esPermiso);
}

function esSobreDeIdentidad(evento: Record<string, unknown>): boolean {
  return (
    esTexto(evento.id) &&
    typeof evento.ts === "number" &&
    Number.isFinite(evento.ts) &&
    typeof evento.orden_local === "number" &&
    Number.isSafeInteger(evento.orden_local) &&
    esTexto(evento.device_id) &&
    esTexto(evento.empleado_id) &&
    esTexto(evento.sucursal_id) &&
    esTexto(evento.stream_id) &&
    typeof evento.v === "number" &&
    Number.isSafeInteger(evento.v)
  );
}

/**
 * Valida en tiempo de ejecución los once formatos de identidad.
 *
 * El Hub recibe JSON de terminales y el almacenamiento puede contener datos de
 * versiones anteriores. Por eso el tipo de TypeScript no basta antes de pasar
 * algo a aplicarEventoIdentidad.
 */
export function esEventoIdentidad(evento: unknown): evento is EventoIdentidad {
  if (!esRegistro(evento) || !esSobreDeIdentidad(evento) || !esTipoEventoIdentidad(String(evento.tipo))) {
    return false;
  }

  switch (evento.tipo) {
    case "sesion_iniciada":
      return (
        esTexto(evento.usuario_id) &&
        esRolId(evento.rol_id) &&
        (evento.cambio_rapido === undefined || typeof evento.cambio_rapido === "boolean")
      );

    case "sesion_cerrada":
    case "acceso_recuperado":
      return esTexto(evento.usuario_id);

    case "acceso_rechazado":
      return (
        (evento.usuario_id === undefined || esTexto(evento.usuario_id)) &&
        (evento.motivo === "credencial_invalida" ||
          evento.motivo === "usuario_inactivo" ||
          evento.motivo === "bloqueo_por_intentos")
      );

    case "autorizacion_otorgada":
      return (
        esAccion(evento.accion) &&
        esTexto(evento.solicitante_id) &&
        esTexto(evento.autorizador_id) &&
        (evento.contexto === undefined || typeof evento.contexto === "string")
      );

    case "autorizacion_denegada":
      return esAccion(evento.accion) && esTexto(evento.solicitante_id) && esTexto(evento.motivo);

    case "usuario_creado":
      return (
        esTexto(evento.usuario_id) &&
        esTexto(evento.nombre) &&
        esTexto(evento.puesto) &&
        esRolId(evento.rol_id) &&
        esListaDePermisos(evento.permisos)
      );

    case "usuario_actualizado": {
      if (!esTexto(evento.usuario_id) || !esRegistro(evento.cambios)) return false;
      const cambios = evento.cambios;
      const claves = Object.keys(cambios);
      if (claves.length === 0 || claves.some((clave) => !["nombre", "rol_id", "permisos", "activo"].includes(clave))) {
        return false;
      }
      return (
        (cambios.nombre === undefined || esTexto(cambios.nombre)) &&
        (cambios.rol_id === undefined || esRolId(cambios.rol_id)) &&
        (cambios.permisos === undefined || esListaDePermisos(cambios.permisos)) &&
        (cambios.activo === undefined || typeof cambios.activo === "boolean")
      );
    }

    case "usuario_eliminado":
      return (
        esTexto(evento.usuario_id) &&
        esTexto(evento.eliminado_por) &&
        esTexto(evento.nombre) &&
        // Nadie se borra a sí mismo: dejaría el local sin quien administre y es
        // el camino más corto para que una cuenta comprometida tape su rastro.
        evento.usuario_id !== evento.eliminado_por
      );

    case "credencial_cambiada":
      return (
        esTexto(evento.usuario_id) &&
        (evento.tipo_credencial === "contrasena" || evento.tipo_credencial === "pin") &&
        (evento.autorizador_id === undefined || esTexto(evento.autorizador_id))
      );

    case "usuario_bloqueado":
      return (
        esTexto(evento.usuario_id) &&
        typeof evento.intentos === "number" &&
        Number.isSafeInteger(evento.intentos) &&
        evento.intentos > 0
      );

    case "usuario_desbloqueado":
      return esTexto(evento.usuario_id) && esTexto(evento.desbloqueado_por);
  }

  return false;
}
