/**
 * El responsable que MOTRAE Central prepara para cada restaurante nuevo.
 *
 * A diferencia del soporte, esta cuenta sí pertenece al restaurante y se ve
 * normalmente. La licencia firmada solo puede darle el perfil inicial; una vez
 * que el responsable cambia su PIN, ese cambio queda guardado en su caja.
 */
import type { ID } from "../comun/ids.js";
import type { Licencia, ResponsableLicenciado } from "../organizacion/licencia.js";
import type { Credencial } from "./credenciales.js";
import { permisosDePlantilla, type Usuario } from "./roles.js";

/** Conserva el id de la semilla histórica para migrar cajas ya instaladas. */
export const USUARIO_RESPONSABLE_ID = "usr-gonzalo";
export const PUESTO_RESPONSABLE = "Responsable del restaurante";

export interface CuentaResponsableLicenciada {
  usuario: Usuario;
  credencial: Credencial;
  provision_id: ID;
}

function esCredencialDePin(
  valor: unknown,
  id: ID,
): valor is Credencial {
  if (!valor || typeof valor !== "object") return false;
  const credencial = valor as Record<string, unknown>;
  return (
    credencial.empleado_id === id &&
    credencial.tipo === "pin" &&
    credencial.algoritmo === "PBKDF2-SHA256" &&
    typeof credencial.iteraciones === "number" &&
    Number.isInteger(credencial.iteraciones) &&
    credencial.iteraciones > 0 &&
    typeof credencial.sal === "string" &&
    credencial.sal.length > 0 &&
    typeof credencial.hash === "string" &&
    credencial.hash.length > 0 &&
    typeof credencial.creada_ts === "number" &&
    Number.isFinite(credencial.creada_ts)
  );
}

/** Construye la cuenta visible del restaurante a partir del perfil firmado. */
export function usuarioResponsable(
  perfil: Pick<ResponsableLicenciado, "id" | "nombre" | "puesto">,
  sucursal_id: ID,
  debeCambiarCredencial: boolean,
): Usuario {
  const nombre = perfil.nombre.trim();
  return {
    id: perfil.id,
    nombre,
    iniciales: nombre.slice(0, 1).toUpperCase(),
    rol_id: "propietario",
    puesto: perfil.puesto.trim() || PUESTO_RESPONSABLE,
    sucursal_id,
    permisos: permisosDePlantilla("propietario"),
    activo: true,
    ...(debeCambiarCredencial ? { debe_cambiar_credencial: true } : {}),
  };
}

/**
 * Extrae una cuenta responsable solamente de una licencia que ya verificó el
 * Hub. Limitar el id mantiene la migración compatible y evita que una licencia
 * antigua pueda crear una segunda cuenta de propietario en la misma caja.
 */
export function cuentaResponsableDeLicencia(
  licencia: Licencia | null,
  licenciaVerificada: boolean,
  sucursal_id: ID,
  debeCambiarCredencial: boolean,
): CuentaResponsableLicenciada | null {
  const responsable = licencia?.responsable;
  if (!licencia || !licenciaVerificada || !responsable) return null;
  if (
    responsable.id !== USUARIO_RESPONSABLE_ID ||
    responsable.nombre.trim().length < 2 ||
    responsable.provision_id.trim().length === 0 ||
    !esCredencialDePin(responsable.credencial, responsable.id)
  ) {
    return null;
  }

  return {
    usuario: usuarioResponsable(responsable, sucursal_id, debeCambiarCredencial),
    credencial: { ...responsable.credencial },
    provision_id: responsable.provision_id,
  };
}
