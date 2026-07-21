/**
 * Semilla de usuarios del local.
 *
 * SEGURIDAD: aquí solo viven DERIVACIONES PBKDF2 (sal + hash), nunca el secreto
 * en claro. De un hash no se puede recuperar la contraseña. Aun así, el hash de
 * una contraseña conocida es un artefacto sensible, por eso el propietario nace
 * con `debe_cambiar_credencial: true`: la aplicación exige cambiarla en el
 * primer inicio de sesión. Ver `docs/SEGURIDAD.md`.
 *
 * En la etapa 4 estos usuarios pasan a la persistencia local, y en la etapa 10
 * al Hub con argon2id, que es lo que pide el TRD §10.
 */
import { permisosDePlantilla, type Credencial, type RolId, type Usuario } from "@motrest/dominio";
import { SUCURSAL_ID } from "../presentacion";

const AHORA = Date.now();

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
    usuario: usuario("usr-gonzalo", "Gonzalo DJA", "G", "propietario", "Dirección General", {
      debe_cambiar_credencial: true,
    }),
    credencial: {
      empleado_id: "usr-gonzalo",
      tipo: "contrasena",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 600_000,
      sal: "IK5KHMUskKpcG7rEXyHyOQ==",
      hash: "ytiJTH9qtOzRxgR+d752IF0ZD2g7WGb/diIPqrFpZBE=",
      creada_ts: AHORA,
    },
    // PIN 2108: firma autorizaciones sin teclear la contraseña completa.
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
    // PIN 1976 (usuario de demostración).
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
    // PIN 4821 (usuario de demostración).
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
