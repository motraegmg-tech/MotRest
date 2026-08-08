/**
 * Proyección de la lista de usuarios a partir del event log.
 *
 * Los usuarios no se guardan como una tabla que se sobrescribe: se reconstruyen
 * reproduciendo los eventos de identidad sobre la semilla inicial. Así, al
 * recargar la aplicación, las altas y los cambios de permisos siguen ahí — y
 * quedan además auditados, porque son los mismos eventos que ve la bitácora.
 */
import type { ID } from "../comun/ids.js";
import type { EventoIdentidad } from "./eventos.js";
import { permisosDePlantilla, type Usuario } from "./roles.js";

export interface EstadoIdentidad {
  usuarios: Usuario[];
  /** Usuarios cuya credencial quedó bloqueada por agotar los intentos. */
  bloqueados: Set<ID>;
}

/** Aplica un evento de identidad al estado (puro, inmutable). */
export function aplicarEventoIdentidad(
  estado: EstadoIdentidad,
  ev: EventoIdentidad,
): EstadoIdentidad {
  switch (ev.tipo) {
    case "usuario_creado": {
      if (estado.usuarios.some((u) => u.id === ev.usuario_id)) return estado;
      const nombre = ev.nombre.trim();
      const nuevo: Usuario = {
        id: ev.usuario_id,
        nombre,
        iniciales: nombre.slice(0, 1).toUpperCase(),
        rol_id: ev.rol_id,
        puesto: ev.puesto.trim() || nombre,
        sucursal_id: ev.sucursal_id,
        permisos: ev.permisos.length > 0 ? ev.permisos : permisosDePlantilla(ev.rol_id),
        activo: true,
      };
      return { ...estado, usuarios: [...estado.usuarios, nuevo] };
    }

    case "usuario_actualizado":
      return {
        ...estado,
        usuarios: estado.usuarios.map((u) =>
          u.id === ev.usuario_id
            ? {
                ...u,
                ...(ev.cambios.nombre === undefined ? {} : { nombre: ev.cambios.nombre }),
                ...(ev.cambios.rol_id === undefined ? {} : { rol_id: ev.cambios.rol_id }),
                ...(ev.cambios.permisos === undefined ? {} : { permisos: ev.cambios.permisos }),
                ...(ev.cambios.activo === undefined ? {} : { activo: ev.cambios.activo }),
              }
            : u,
        ),
      };

    /*
     * Baja definitiva: desaparece de la plantilla, no se marca de ningún color.
     *
     * Se quita del arreglo en vez de dejarlo con una bandera porque «eliminado»
     * no es un estado del empleado: es que ya no es uno. Mientras siguiera en la
     * lista, cada pantalla tendría que acordarse de filtrarlo —y la que se
     * olvidara lo ofrecería para iniciar sesión, para asignarle una mesa o para
     * firmar una cancelación—.
     *
     * También sale de `bloqueados`: no tiene sentido arrastrar el bloqueo de una
     * credencial de alguien que ya no existe.
     */
    case "usuario_eliminado": {
      const bloqueados = new Set(estado.bloqueados);
      bloqueados.delete(ev.usuario_id);
      return {
        usuarios: estado.usuarios.filter((u) => u.id !== ev.usuario_id),
        bloqueados,
      };
    }

    // Recuperar el acceso levanta el bloqueo: quien llegó al código de rescate
    // ya agotó sus intentos intentando recordar la contraseña.
    case "acceso_recuperado": {
      const bloqueados = new Set(estado.bloqueados);
      bloqueados.delete(ev.usuario_id);
      return { ...estado, bloqueados };
    }

    case "credencial_cambiada":
      // El hash vive fuera del log; aquí solo se levanta la obligación de cambio.
      return {
        ...estado,
        usuarios: estado.usuarios.map((u) =>
          u.id === ev.usuario_id ? { ...u, debe_cambiar_credencial: false } : u,
        ),
      };

    case "usuario_bloqueado": {
      const bloqueados = new Set(estado.bloqueados);
      bloqueados.add(ev.usuario_id);
      return { ...estado, bloqueados };
    }

    case "usuario_desbloqueado": {
      const bloqueados = new Set(estado.bloqueados);
      bloqueados.delete(ev.usuario_id);
      return { ...estado, bloqueados };
    }

    // Sesiones, accesos y autorizaciones son bitácora pura: no alteran el estado.
    case "sesion_iniciada":
    case "sesion_cerrada":
    case "acceso_rechazado":
    case "autorizacion_otorgada":
    case "autorizacion_denegada":
      return estado;

    default: {
      const _exhaustivo: never = ev;
      return _exhaustivo;
    }
  }
}

/** Reconstruye usuarios y bloqueos reproduciendo el log sobre la semilla. */
export function proyectarIdentidad(
  semilla: readonly Usuario[],
  eventos: readonly EventoIdentidad[],
): EstadoIdentidad {
  let estado: EstadoIdentidad = {
    usuarios: semilla.map((u) => ({ ...u })),
    bloqueados: new Set(),
  };
  for (const ev of eventos) {
    estado = aplicarEventoIdentidad(estado, ev);
  }
  return estado;
}
