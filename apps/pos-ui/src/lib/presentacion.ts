/** Datos del local y de presentación. */
import { uuidv7 } from "@motrest/dominio";
import type { ID } from "@motrest/dominio";

export const SUCURSAL_ID: ID = "suc-rodizio-centro";

/**
 * ¿Es una instalación de demostración?
 *
 * `true` en desarrollo y en las pruebas; `false` únicamente en el `vite build`
 * que se empaqueta para el restaurante. De aquí cuelga todo lo que existe solo
 * para probar —usuarios de juguete, salón sembrado con comandas falsas— y que
 * NO debe llegar al instalador real, que arranca limpio.
 */
export const MODO_DEMO = import.meta.env.PROD !== true;

/**
 * Empleado con el que se sella la semilla del salón, y respaldo cuando aún no
 * hay sesión.
 *
 * Es el propietario, no un usuario de demostración: el propietario existe en
 * TODA instalación —también en la de producción, donde Marco y Lucía no se
 * siembran—, así que la bitácora nunca queda con un identificador huérfano.
 */
export const EMPLEADO_ACTUAL: ID = "usr-gonzalo";

/**
 * A quién llama el restaurante para reactivar su licencia.
 *
 * Sale en la pantalla de bloqueo. Es un teléfono y no un correo a propósito: lo
 * que el restaurante necesita en ese momento es reactivarse ya, y cada paso
 * entre el bloqueo y el pago es un día más sin cobrar.
 */
export const CONTACTO_MOTRAE = "MOTRAE · 2283536911";

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
