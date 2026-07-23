/** Datos del local y de presentación. */
import { uuidv7 } from "@motrest/dominio";
import type { ID } from "@motrest/dominio";

export const SUCURSAL_ID: ID = "suc-rodizio-centro";

/**
 * Empleado con el que se sella la semilla del salón, y respaldo cuando aún no
 * hay sesión.
 *
 * Es el propietario, no un usuario de demostración: el propietario existe en
 * TODA instalación —también en la de producción, donde Marco y Lucía no se
 * siembran—, así que la bitácora nunca queda con un identificador huérfano.
 */
export const EMPLEADO_ACTUAL: ID = "usr-gonzalo";

export const cabecera = {
  titulo: "Punto de venta",
  /*
   * Solo el nombre del restaurante, por ahora.
   *
   * Cuando el alta del restaurante se capture desde Administración, aquí irá el
   * nombre real del negocio y la sucursal en la que está esta caja
   * ("Rodizio · Centro"). Hasta entonces, media etiqueta inventada confunde más
   * que un nombre a secas.
   */
  sucursal: "Rodizio",
};

/**
 * Encabezado del ticket impreso.
 *
 * Son los datos que el comensal se lleva en el papel. En F2 se capturan desde
 * Administración junto con el resto del perfil fiscal del emisor.
 */
export const datosLocal = {
  nombre: "Rodizio",
  direccion: "Av. Central 100, Centro",
  rfc: "XAXX010101000",
  telefono: "55 1234 5678",
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

/**
 * Las mesas ya no viven aquí: son parte del plano de piso que cada restaurante
 * edita (ver `plano.svelte.ts` y `catalogo/areas.ts` en el dominio).
 */
