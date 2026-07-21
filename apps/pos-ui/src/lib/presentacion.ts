/** Datos del local y de presentación. */
import { uuidv7 } from "@motrest/dominio";
import type { ID } from "@motrest/dominio";

export const SUCURSAL_ID: ID = "suc-rodizio-centro";

/**
 * Empleado con el que se firma la semilla del salón. Coincide con el usuario
 * `usr-lucia` de `sesion/usuarios.ts`, de modo que la bitácora muestre su
 * nombre y no un identificador huérfano.
 */
export const EMPLEADO_ACTUAL: ID = "usr-lucia";

export const cabecera = {
  titulo: "Punto de venta",
  sucursal: "Rodizio · Centro",
  demo: "Datos de demostración",
};

/**
 * Identidad del dispositivo, persistida en el navegador.
 * Sustituye al antiguo `"pos-caja-01"` hardcodeado: cada equipo tiene su UUID.
 */
const LLAVE_DEVICE = "motrest.device_id";

export function obtenerDeviceId(): ID {
  if (typeof localStorage === "undefined") return "dev-efimero";
  const guardado = localStorage.getItem(LLAVE_DEVICE);
  if (guardado) return guardado;
  const nuevo = uuidv7();
  localStorage.setItem(LLAVE_DEVICE, nuevo);
  return nuevo;
}

/** Número total de mesas del salón. */
export const NUM_MESAS = 12;

/** Mesas del salón. Sin número de comensales (decisión de Gonzalo). */
export interface Mesa {
  id: ID;
  numero: number;
}

export const mesas: Mesa[] = Array.from({ length: NUM_MESAS }, (_, i) => ({
  id: `mesa-${i + 1}`,
  numero: i + 1,
}));
