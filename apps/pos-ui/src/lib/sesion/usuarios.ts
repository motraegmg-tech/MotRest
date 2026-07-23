/**
 * Semilla de usuarios del local.
 *
 * SEGURIDAD: aquí solo viven DERIVACIONES PBKDF2 (sal + hash), nunca un secreto
 * personal en claro. De un hash no se puede recuperar la contraseña.
 *
 * La contraseña del propietario NO es una credencial personal: es una **clave
 * de fábrica** (`CONTRASENA_INICIAL_PROPIETARIO`), la misma para toda
 * instalación nueva y pensada para cambiarse desde el menú de usuario en cuanto
 * el local abre. Por eso puede vivir aquí sin ser un secreto filtrado —igual
 * que un router sale con una clave por defecto que hay que cambiar—. La
 * contraseña real de una persona jamás se escribe en este archivo ni en las
 * pruebas.
 *
 * En la etapa 4 estos usuarios pasan a la persistencia local, y en la etapa 10
 * al Hub con argon2id, que es lo que pide el TRD §10.
 */
import { permisosDePlantilla, type Credencial, type RolId, type Usuario } from "@motrest/dominio";
import { SUCURSAL_ID } from "../presentacion";

const AHORA = Date.now();

/**
 * Clave de fábrica del propietario en una instalación nueva.
 *
 * No es la contraseña de nadie: es un valor por defecto conocido, que se cambia
 * en el primer arranque desde «Cambiar mi contraseña». Se exporta para que las
 * pruebas la usen sin escribir una credencial real en el código.
 */
export const CONTRASENA_INICIAL_PROPIETARIO = "MotRest.Inicio.2026";

export interface UsuarioSembrado {
  usuario: Usuario;
  /** Credencial principal: contraseña para administración, PIN para piso. */
  credencial: Credencial;
  /** PIN adicional para el cambio rápido y para firmar autorizaciones. */
  pin?: Credencial;
}

function usuario(
  id: string,
  nombre: string,
  iniciales: string,
  rol_id: RolId,
  puesto: string,
  extra: Partial<Usuario> = {},
): Usuario {
  return {
    id,
    nombre,
    iniciales,
    rol_id,
    puesto,
    sucursal_id: SUCURSAL_ID,
    permisos: permisosDePlantilla(rol_id),
    activo: true,
    ...extra,
  };
}

export const USUARIOS_SEMILLA: UsuarioSembrado[] = [
  {
    /*
     * SIN cambio de credencial obligatorio.
     *
     * Lo llevaba porque esta contraseña circuló fuera del sistema al sembrarla,
     * y forzar el cambio en el primer inicio parecía prudente. En la práctica
     * resultó lo contrario: como la obligación solo se levanta al completar el
     * cambio, quien cerraba el diálogo se lo encontraba en cada inicio, y un
     * aviso que se cierra sin leer no protege nada.
     *
     * El cambio de credencial ahora es una acción deliberada, disponible en el
     * menú del usuario. Sigue siendo recomendable hacerlo.
     */
    usuario: usuario("usr-gonzalo", "Gonzalo DJA", "G", "propietario", "Dirección General"),
    // Hash de CONTRASENA_INICIAL_PROPIETARIO (clave de fábrica, no personal).
    credencial: {
      empleado_id: "usr-gonzalo",
      tipo: "contrasena",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 600_000,
      sal: "5RwxxK/p7ufI4DfOR+j6lg==",
      hash: "qdXfT5DaaNq5xERA7IfkZdzQcIUNqniHZDgSXiH2mGI=",
      creada_ts: AHORA,
    },
    // PIN de fábrica para firmar autorizaciones sin teclear la contraseña.
    pin: {
      empleado_id: "usr-gonzalo",
      tipo: "pin",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 310_000,
      sal: "NT9741T4POvkZ2ds+7JLsA==",
      hash: "0uTMfxYldRSeyv6TYMj0yg4dJHXFcogA2NOsx19aPRw=",
      creada_ts: AHORA,
    },
  },
  {
    usuario: usuario("usr-marco", "Marco", "M", "gerente", "Gerente de sucursal"),
    // PIN de fábrica (usuario de demostración).
    credencial: {
      empleado_id: "usr-marco",
      tipo: "pin",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 310_000,
      sal: "mxvL4aRXAh9MUv+ZJGzphg==",
      hash: "cBPP+oKjskUtXf1hvsFLdTgW681486PzGP7RtexHfCY=",
      creada_ts: AHORA,
    },
  },
  {
    usuario: usuario("usr-lucia", "Lucía", "L", "mesero", "Mesera"),
    // PIN de fábrica (usuario de demostración).
    credencial: {
      empleado_id: "usr-lucia",
      tipo: "pin",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 310_000,
      sal: "J6SloW5AyxgPVGgM7itUqQ==",
      hash: "yssNRcmD6YzaOw+Y/Dx/mTxCblYi2lqcYzQUbum3wFY=",
      creada_ts: AHORA,
    },
  },
];

/** Usuario con el que arranca la sesión del POS mientras no se pida login. */
export const USUARIO_POR_DEFECTO = "usr-lucia";
