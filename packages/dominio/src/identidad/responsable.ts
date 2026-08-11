/**
 * El responsable del restaurante: la cuenta con el control total del local.
 *
 * A diferencia del soporte, esta cuenta sí pertenece al restaurante y se ve
 * normalmente. Hay dos caminos para que exista, y los dos acaban en el mismo
 * usuario:
 *
 *  1. **La da de alta el propio restaurante en el primer arranque.** Es el
 *     camino normal: el software abre, pide crear la cuenta del responsable con
 *     el PIN que él elija, y a partir de ahí cada apertura pide identificarse.
 *     Nadie tiene que dictarle una clave por teléfono.
 *
 *  2. **La prepara MotRest Central dentro de la licencia firmada.** Sirve para
 *     entregar el local ya con nombre y PIN, y es la vía por la que MOTRAE puede
 *     reponer el acceso de un responsable en remoto. La licencia solo puede dar
 *     el perfil INICIAL; en cuanto el responsable elige su propio PIN, ese
 *     cambio queda guardado en su caja.
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

/**
 * ¿Este local todavía no tiene NINGUNA cuenta que se pueda usar?
 *
 * Es la pregunta que decide si el software arranca pidiendo el alta del
 * responsable en vez de pidiendo un PIN. «Usable» es más estricto que «existe»,
 * y las tres condiciones importan:
 *
 *  - **activo** — una cuenta desactivada no abre el sistema.
 *  - **con credencial** — un usuario sin PIN guardado no puede entrar. Es el
 *    caso de un local recién instalado.
 *  - **sin cambio de credencial pendiente** — la cuenta que MOTRAE preparó en la
 *    licencia y que nadie ha estrenado todavía NO cuenta como usable: su PIN lo
 *    conoce quien la provisionó, no el restaurante. Por eso el primer arranque
 *    le deja elegir el suyo en vez de exigirle uno que quizá nadie le dictó.
 *
 * En cuanto hay una sola cuenta usable —el responsable, o cualquier empleado que
 * ya estrenó su PIN— esta puerta se cierra para siempre: el alta inicial no
 * puede volver a servir para fabricar un propietario en un local que ya opera.
 *
 * `tieneCredencial` se recibe como función porque los hashes NO viven en el
 * dominio ni en el event log: viven en el almacén de secretos del dispositivo.
 */
export function requiereAltaDeResponsable(
  usuariosDelLocal: readonly Usuario[],
  tieneCredencial: (id: ID) => boolean,
  yaEstrenado = false,
): boolean {
  /*
   * EL PORTAZO: un local que ya se estrenó NO vuelve a ver esta pantalla.
   *
   * Sin esta línea, «Bienvenido. Vamos a crear su usuario» reaparecía en
   * aperturas posteriores, y el caso real es fácil de reproducir: MotRest Central
   * reemite la licencia con una provisión nueva —al cobrar, al reponer un
   * acceso—, la caja aplica ese perfil con `debe_cambiar_credencial`, y de golpe
   * NINGUNA cuenta cuenta como «usable». La pantalla de alta es justo la
   * respuesta equivocada a esa situación: lo que hay que pedir ahí es el PIN
   * nuevo, no crear otro dueño encima del que ya existe.
   *
   * El hecho de haberse estrenado se deduce del event log —hay `usuario_creado`
   * o `credencial_cambiada`—, así que sobrevive a reinstalar la aplicación, se
   * replica a las demás terminales y no depende de ninguna bandera aparte que
   * pudiera perderse.
   */
  if (yaEstrenado) return false;

  return !usuariosDelLocal.some(
    (usuario) =>
      usuario.activo &&
      usuario.debe_cambiar_credencial !== true &&
      tieneCredencial(usuario.id),
  );
}

/**
 * ¿Este restaurante ya pasó alguna vez por su puesta en marcha?
 *
 * Se lee del event log y no de una bandera aparte: el log se replica a todas las
 * terminales y sobrevive a reinstalar la aplicación, así que es lo único que de
 * verdad recuerda.
 *
 * **El hecho es `credencial_cambiada`, y solo ese.** Se probó con
 * `usuario_creado` y era la señal equivocada: una caja que se actualiza desde
 * una versión anterior trae en su log el alta del propietario que aquellas
 * versiones sembraban —«Gonzalo DJA», sin ninguna credencial que sirva—, y
 * darla por estrenada dejaba al restaurante fuera de su propio sistema, mirando
 * una lista de usuarios cuya clave nadie vio jamás. Fijar una credencial, en
 * cambio, es algo que solo puede haber hecho alguien de la casa.
 */
export function localYaEstrenado(
  eventos: readonly { tipo: string }[],
): boolean {
  return eventos.some((evento) => evento.tipo === "credencial_cambiada");
}

/**
 * Construye la cuenta visible del restaurante.
 *
 * La usan los dos caminos —el alta que hace el propio local y el perfil firmado
 * que llega en la licencia— justo para que no puedan divergir: mismo rol, mismos
 * permisos y mismo puesto por defecto, venga de donde venga.
 */
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
