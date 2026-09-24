import { licencia } from "./licencia.svelte";
import { local } from "./local.svelte";
import { cabecera } from "./presentacion";

/**
 * El nombre del RESTAURANTE, no uno escrito en el código.
 *
 * Manda la ficha que capturó el local; si está vacía, la licencia firmada. Sin
 * licencia todavía no hay restaurante y sale vacío: quien lo pinta lo esconde.
 *
 * Lo leen la barra superior (en computadora y tableta) y el menú de las tres
 * rayas (en teléfono, donde la barra no tiene sitio para él). Es una función y
 * no un valor para que, llamada dentro de un `$derived`, siga a los cambios.
 */
export function nombreDelLocal(): string {
  return local.ficha.nombre.trim() || licencia.licencia?.nombre || cabecera.sucursal;
}
