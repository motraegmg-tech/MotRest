/**
 * El acceso de soporte de MOTRAE dentro de cada MotRest.
 *
 * QUÉ ES. Un usuario —"Gonzalo DJA"— que existe en cada instalación con
 * licencia de soporte, no
 * aparece en la lista de personal del restaurante y sirve para que MOTRAE entre
 * a resolver un problema sin pedirle a nadie su contraseña. Es lo mismo que
 * tiene cualquier proveedor serio de software administrado: sin él, "no me
 * funciona el KDS" un viernes a las nueve se resuelve por teléfono pidiéndole al
 * gerente que lea menús en voz alta.
 *
 * POR QUÉ ESTO NO ES UNA PUERTA TRASERA. La diferencia no está en si el acceso
 * existe —existe en todos— sino en si se puede auditar y si el cliente lo sabe:
 *
 *   1. **LA CREDENCIAL NO ESTÁ EN EL CÓDIGO.** Viaja dentro de la licencia
 *      firmada y la elige Gonzalo en MOTRAE Central. Nadie que lea este
 *      repositorio puede entrar, y nadie que edite un archivo puede fabricarse
 *      un usuario con estos poderes: sin la firma de MOTRAE no vale.
 *
 *   2. **TODO QUEDA REGISTRADO Y NADIE PUEDE BORRARLO.** La bitácora es el event
 *      log, que solo agrega. Que el usuario esté oculto en las LISTAS no lo
 *      oculta en la bitácora: se filtra en las pantallas de personal, nunca en
 *      la auditoría. Ni MOTRAE puede tapar sus propios pasos.
 *
 *   3. **VA EN EL CONTRATO.** Un acceso de mantenimiento que el cliente conoce y
 *      aceptó es soporte. Uno que no conoce es otra cosa, y no es lo que estamos
 *      construyendo. Ver `docs/SOPORTE-Y-ACCESO-REMOTO.md`.
 *
 * POR QUÉ ESTÁ POR ENCIMA DEL PROPIETARIO. Porque nadie administra a un rango
 * mayor que el suyo (`puedeGestionarA`). Con rango 120 el restaurante no puede
 * desactivarlo, ni cambiarle permisos, ni borrarlo — y eso también protege al
 * restaurante, porque impide que un empleado enojado deje al local sin la vía de
 * auxilio la noche que se rompe algo.
 */
import type { ID } from "../comun/ids.js";
import type { CredencialSoporte, Licencia } from "../organizacion/licencia.js";
import type { Credencial } from "./credenciales.js";
import { permisosDePlantilla, type Usuario } from "./roles.js";

/** Siempre el mismo id, en todas las instalaciones. */
export const USUARIO_SOPORTE_ID = "usr-motrae-soporte";

/** Como lo verá la bitácora del restaurante cuando MOTRAE entre. */
export const NOMBRE_SOPORTE = "Gonzalo DJA";

/**
 * Construye el usuario de soporte para este local.
 *
 * Se arma en memoria a partir de la licencia, NO se guarda como alta de usuario.
 * Es deliberado: si estuviera en el log de identidad, aparecería en cualquier
 * exportación de personal y sobreviviría a que le quiten la licencia. Así, el
 * acceso existe exactamente mientras exista una licencia firmada que lo diga.
 */
export function usuarioSoporte(sucursal_id: ID): Usuario {
  return {
    id: USUARIO_SOPORTE_ID,
    nombre: NOMBRE_SOPORTE,
    iniciales: "GD",
    rol_id: "soporte",
    puesto: "Soporte MOTRAE",
    sucursal_id,
    permisos: permisosDePlantilla("soporte"),
    activo: true,
    oculto: true,
  };
}

/** ¿Este usuario es el acceso de MOTRAE? */
export function esSoporte(usuario: Pick<Usuario, "id"> | null | undefined): boolean {
  return usuario?.id === USUARIO_SOPORTE_ID;
}

/**
 * Saca la credencial de soporte de una licencia ya verificada.
 *
 * `licenciaVerificada` es un booleano aparte y no se deduce aquí a propósito: si
 * esta función pudiera devolver una credencial sin que alguien haya comprobado
 * la firma, bastaría con editar el `licencia.json` a mano —poniendo el hash de
 * una contraseña propia— para entrar como MOTRAE. La firma es lo único que
 * separa el acceso legítimo de ese.
 */
export function credencialDeSoporte(
  licencia: Licencia | null,
  licenciaVerificada: boolean,
  ahora = Date.now(),
): Credencial | null {
  if (!licencia || !licenciaVerificada || !licencia.soporte) return null;
  const { sal, hash, iteraciones }: CredencialSoporte = licencia.soporte;
  if (!sal || !hash || !iteraciones) return null;

  return {
    empleado_id: USUARIO_SOPORTE_ID,
    tipo: "contrasena",
    algoritmo: "PBKDF2-SHA256",
    iteraciones,
    sal,
    hash,
    creada_ts: licencia.emitida_ts || ahora,
  };
}

/**
 * Añade el acceso de soporte a la lista de usuarios, si la licencia lo trae.
 *
 * Se llama al proyectar la identidad. Devuelve la lista tal cual cuando no hay
 * licencia válida: un local sin licencia firmada no tiene acceso de MOTRAE.
 */
export function conSoporte(
  usuarios: readonly Usuario[],
  licencia: Licencia | null,
  licenciaVerificada: boolean,
  sucursal_id: ID,
): Usuario[] {
  const credencial = credencialDeSoporte(licencia, licenciaVerificada);
  if (!credencial) return [...usuarios];
  if (usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)) return [...usuarios];
  return [...usuarios, usuarioSoporte(sucursal_id)];
}

/**
 * ¿La licencia está bloqueada pero el que entra es MOTRAE?
 *
 * ES LA ÚNICA EXCEPCIÓN AL BLOQUEO Y TIENE QUE EXISTIR: si al vencer la licencia
 * nadie pudiera entrar, tampoco podría entrar quien va a reactivarla ni quien va
 * a sacarle sus datos al restaurante para dárselos. Un bloqueo del que ni el
 * proveedor puede salir no es un bloqueo, es un ladrillo.
 */
export function puedeEntrarBloqueado(usuario: Pick<Usuario, "id"> | null | undefined): boolean {
  return esSoporte(usuario);
}
