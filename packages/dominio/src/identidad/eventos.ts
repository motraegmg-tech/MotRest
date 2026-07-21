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
import type { Accion } from "./acciones.js";
import type { Permiso, RolId } from "./roles.js";

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
    });

export type TipoEventoIdentidad = EventoIdentidad["tipo"];

/** Stream al que van los eventos de identidad de una sucursal. */
export function streamIdentidad(sucursal_id: ID): ID {
  return `identidad:${sucursal_id}`;
}
